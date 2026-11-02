// Strength-training log: detect sessions from heart rate + steps, guess what was trained,
// keep the log on the phone, and compute progress (top set, estimated 1RM, volume, sets per week).
import * as store from './store.js';
import { ymd, parseYmd, addDays, dayDiff, startOfDay, uid, median, mean, sum } from './util.js';

export const PARTS = {
  chest: '胸', shoulders: '肩', biceps: '二头', triceps: '三头', abs: '腹', quads: '大腿前', calves: '小腿',
  back: '背', lowback: '下背', glutes: '臀', hams: '大腿后',
};

export const LIFTS = {
  squat: { name: '深蹲', color: 'var(--c-blue)', parts: { quads: 1, glutes: 1, hams: 0.5, lowback: 0.5, abs: 0.3 }, step: 2.5 },
  bench: { name: '卧推', color: 'var(--c-orange)', parts: { chest: 1, shoulders: 0.5, triceps: 0.5 }, step: 2.5 },
  deadlift: { name: '硬拉', color: 'var(--c-violet)', parts: { hams: 1, glutes: 1, lowback: 1, back: 0.5, quads: 0.3 }, step: 5 },
  pullup: { name: '引体向上', color: 'var(--c-green)', parts: { back: 1, biceps: 0.5, shoulders: 0.2 }, step: 2.5, bodyweight: true },
};
export const BIG = Object.keys(LIFTS);

let prefix = '';
let state = null;
let onSave = () => {};
export const setPrefix = (p) => { prefix = p; state = null; };
export const setOnSave = (fn) => { onSave = fn; };

export const emptyState = () => ({ v: 1, sessions: [], lib: {}, pending: [], dismissed: [], scanned: {}, settings: { hints: true }, updatedAt: 0 });

export async function load() {
  if (state) return state;
  state = (await store.get(prefix + 'training')) || emptyState();
  state.settings ||= { hints: true };
  state.lib ||= {};
  return state;
}
export const get = () => state || emptyState();

export async function save(changed = true) {
  if (changed) state.updatedAt = Date.now();
  await store.set(prefix + 'training', state);
  if (changed) onSave(state);
}

export async function replaceAll(next) {
  state = { ...emptyState(), ...next };
  await save(false);
}

// ---------- lift library ----------
export function lift(id) {
  if (LIFTS[id]) return { id, ...LIFTS[id] };
  const c = get().lib[id];
  return { id, name: c?.name || id, color: 'var(--c-grey)', parts: c?.parts || {}, step: c?.step || 2.5, bodyweight: !!c?.bodyweight };
}
export const liftColor = (id) => lift(id).color;
export const allLiftIds = () => [...BIG, ...Object.keys(get().lib)];

export function ensureLift(id, def = {}) {
  if (LIFTS[id] || get().lib[id]) return id;
  const name = String(def.name || id).replace(/[<>&"']/g, '').slice(0, 20) || id;
  get().lib[id] = { name, parts: def.parts || {}, step: def.step || 2.5, bodyweight: !!def.bodyweight };
  return id;
}

// ---------- per-set maths ----------
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + Math.min(reps, 12) / 30) : 0);
export const setLoad = (id, s) => (lift(id).bodyweight ? s.add || 0 : s.kg || 0);
export const topSet = (id, sets) => sets.reduce((best, s) => {
  const w = setLoad(id, s);
  return !best || w > setLoad(id, best) || (w === setLoad(id, best) && s.reps > best.reps) ? s : best;
}, null);
export const volume = (id, sets) => sum(sets.map((s) => (lift(id).bodyweight ? s.reps : s.reps * (s.kg || 0))));

// "5×5 · 102.5 kg", "4×10", "8/8/6 · 60 kg"
export function setsLabel(id, sets) {
  if (!sets?.length) return '';
  const reps = sets.map((s) => s.reps);
  const same = reps.every((r) => r === reps[0]);
  const loads = sets.map((s) => setLoad(id, s));
  const top = Math.max(...loads);
  const repTxt = same ? `${sets.length}×${reps[0]}` : reps.join('/');
  if (lift(id).bodyweight) return top > 0 ? `${repTxt} · +${top} kg` : repTxt;
  return `${repTxt} · ${top} kg`;
}

// ---------- history queries ----------
export const sessions = () => [...get().sessions].sort((a, b) => a.date.localeCompare(b.date) || (a.start || 0) - (b.start || 0));
export const sessionsIn = (from, to) => sessions().filter((s) => s.date >= from && s.date <= to);

export function lastItem(id, beforeDate = '9999') {
  const ss = sessions().filter((s) => s.date < beforeDate);
  for (let i = ss.length - 1; i >= 0; i--) {
    const it = ss[i].items.find((x) => x.lift === id && x.sets?.length);
    if (it) return { session: ss[i], item: it };
  }
  return null;
}

// What did they probably do: the routine (set of lifts) done longest ago among the recent ones,
// each lift pre-filled with its latest sets.
export function guess(date) {
  const hist = sessions().filter((s) => s.date < date && s.items.length);
  if (!hist.length) return null;
  let pool = hist.filter((s) => dayDiff(parseYmd(date), parseYmd(s.date)) <= 42);
  if (!pool.length) pool = hist.slice(-6);
  const sig = (s) => s.items.map((i) => i.lift).sort().join('+');
  const count = new Map();
  for (const s of pool) count.set(sig(s), (count.get(sig(s)) || 0) + 1);
  const repeated = pool.filter((s) => count.get(sig(s)) >= 2);
  if (repeated.length) pool = repeated;
  const last = new Map();
  for (const s of pool) last.set(sig(s), s);
  const due = [...last.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.start || 0) - (b.start || 0))[0];
  return {
    items: due.items.map((it) => {
      const l = lastItem(it.lift, date);
      return { lift: it.lift, sets: (l ? l.item.sets : it.sets).map((s) => ({ reps: s.reps, kg: s.kg, ...(s.add ? { add: s.add } : {}) })) };
    }),
  };
}

// "下次练什么": last sets of a lift + a suggestion that can be turned off in settings.
// Suggest adding weight only when every set of the top weight hit the usual reps, no set was
// called hard, and today's recovery score is not low.
export function nextFor(id, recoveryToday = null) {
  const l = lastItem(id);
  if (!l) return null;
  const sets = l.item.sets;
  const reps = median(sets.map((s) => s.reps));
  const top = Math.max(...sets.map((s) => setLoad(id, s)));
  const atTop = sets.filter((s) => setLoad(id, s) === top);
  const full = atTop.every((s) => s.reps >= Math.floor(reps)) && !sets.some((s) => s.hard);
  let suggestion = null;
  if (get().settings.hints !== false) {
    const lf = lift(id);
    if (full && (recoveryToday == null || recoveryToday >= 60)) suggestion = lf.bodyweight && top === 0 ? { reps: 1 } : { kg: lf.step };
    else suggestion = { keep: true };
  }
  return { date: l.session.date, sets, suggestion, top };
}

// Progress series per session for one lift
export function progress(id, from, to) {
  const out = [];
  for (const s of sessionsIn(from, to)) {
    const it = s.items.find((x) => x.lift === id && x.sets?.length);
    if (!it) continue;
    const t = topSet(id, it.sets);
    const bw = lift(id).bodyweight;
    out.push({
      date: s.date, id: s.id,
      top: bw ? Math.max(...it.sets.map((x) => x.reps)) : t.kg,
      e1rm: bw ? null : Math.max(...it.sets.map((x) => e1rm(x.kg, x.reps))),
      vol: volume(id, it.sets),
    });
  }
  let best = -Infinity;
  for (const p of out) { p.pr = p.top > best; if (p.top > best) best = p.top; }
  return out;
}

export function setsPerPart(from, to) {
  const acc = Object.fromEntries(Object.keys(PARTS).map((k) => [k, 0]));
  for (const s of sessionsIn(from, to)) for (const it of s.items) {
    const parts = lift(it.lift).parts;
    for (const [p, w] of Object.entries(parts)) if (p in acc) acc[p] += w * it.sets.length;
  }
  return acc;
}

// ---------- session CRUD ----------
export async function saveSession(sess) {
  const st = get();
  const s = { id: sess.id || uid(), savedAt: Date.now(), ...sess };
  s.items = (s.items || []).filter((it) => it.lift && it.sets?.length).map((it) => ({
    lift: it.lift,
    sets: it.sets.map((x) => ({ reps: Math.max(0, Math.round(+x.reps || 0)), kg: +x.kg || 0, ...(x.add ? { add: +x.add } : {}), ...(x.note ? { note: String(x.note).slice(0, 60) } : {}), ...(x.hard ? { hard: true } : {}) })).filter((x) => x.reps > 0),
  })).filter((it) => it.sets.length);
  st.sessions = st.sessions.filter((x) => x.id !== s.id).concat(s);
  if (sess.pendingId) st.pending = st.pending.filter((p) => p.id !== sess.pendingId);
  delete s.pendingId;
  await save();
  return s;
}

export async function deleteSession(id) {
  const st = get();
  st.sessions = st.sessions.filter((x) => x.id !== id);
  await save();
}

export async function dismissPending(id) {
  const st = get();
  const p = st.pending.find((x) => x.id === id);
  if (p) st.dismissed = [...new Set([...(st.dismissed || []), p.key])].slice(-200);
  st.pending = st.pending.filter((x) => x.id !== id);
  await save();
}

// ---------- detection ----------
// One local day of 1-minute heart rate and steps → candidate strength sessions:
// heart rate well above resting for ≥ 15 min, few steps, and ≥ 3 separate peaks (one per set).
export function detect({ dayStart, hr, steps, sleeps = [], exercises = [], rest }) {
  const N = 1440, t0 = +dayStart;
  const H = new Array(N).fill(null), HX = new Array(N).fill(null), S = new Array(N).fill(0), X = new Array(N).fill(false);
  for (const p of hr) { const i = Math.floor((p.t - t0) / 60e3); if (i >= 0 && i < N) { H[i] = p.v; HX[i] = p.hi ?? p.v; } }
  for (const p of steps) { const i = Math.floor((p.t - t0) / 60e3); if (i >= 0 && i < N) S[i] = p.v; }
  const block = (a, b) => { for (let i = Math.max(0, Math.floor((a - t0) / 60e3) - 3); i < Math.min(N, Math.ceil((b - t0) / 60e3) + 3); i++) X[i] = true; };
  for (const s of sleeps) block(s.start, s.end);
  for (const e of exercises) if (e.kind !== 'strength') block(e.start, e.end);
  const awake = H.filter((v, i) => v != null && !X[i]).sort((a, b) => a - b);
  const base = rest || awake[Math.floor(awake.length * 0.1)] || 60;
  const med = (i) => median(H.slice(Math.max(0, i - 2), i + 3));
  const stepAvg = (i) => mean(S.slice(Math.max(0, i - 2), i + 3));
  const on = H.map((v, i) => !X[i] && v != null && med(i) >= base + 25 && stepAvg(i) <= 35);
  const spans = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    if (on[i]) { if (cur && i - cur.b <= 4) cur.b = i; else { cur = { a: i, b: i }; spans.push(cur); } }
  }
  const out = [];
  for (const sp of spans) {
    if (sp.b - sp.a + 1 < 15) continue;
    const peaks = [];
    for (let i = sp.a; i <= sp.b; i++) {
      const v = HX[i];
      if (v == null || v < base + 40) continue;
      const win = HX.slice(Math.max(sp.a, i - 2), Math.min(sp.b, i + 2) + 1).filter((x) => x != null);
      if (v < Math.max(...win)) continue;
      const around = H.slice(Math.max(0, i - 3), i + 4).filter((x) => x != null);
      if (v - Math.min(...around) < 10) continue;
      if (peaks.length && i - peaks.at(-1).i < 2) continue;
      peaks.push({ i, t: t0 + i * 60e3, v });
    }
    const mins = sp.b - sp.a + 1;
    if (peaks.length < 3 || sum(S.slice(sp.a, sp.b + 1)) / mins > 30) continue;
    const vals = H.slice(sp.a, sp.b + 1).filter((x) => x != null);
    // sets come every few minutes; random bursts during the day don't
    const gap = median(peaks.slice(1).map((p, k) => p.i - peaks[k].i));
    if (gap < 2 || gap > 8 || mean(vals) < base + 30) continue;
    out.push({ start: t0 + sp.a * 60e3, end: t0 + (sp.b + 1) * 60e3, peaks: peaks.map(({ t, v }) => ({ t, v })), avgHr: Math.round(mean(vals)), maxHr: Math.max(...vals), source: 'detected' });
  }
  // strength workouts Fitbit (or the watch) already recorded
  for (const e of exercises) {
    if (e.kind !== 'strength' || e.start < t0 || e.start >= t0 + 864e5) continue;
    if (out.some((c) => c.start < e.end && e.start < c.end)) {
      const c = out.find((x) => x.start < e.end && e.start < x.end);
      Object.assign(c, { start: Math.min(c.start, e.start), end: Math.max(c.end, e.end), source: 'exercise', exId: e.id });
      continue;
    }
    const a = Math.floor((e.start - t0) / 60e3), b = Math.ceil((e.end - t0) / 60e3);
    const peaks = [];
    for (let i = a + 1; i < b - 1; i++) {
      const v = HX[i];
      if (v == null || v < base + 25) continue;
      if (v >= Math.max(...HX.slice(Math.max(0, i - 2), i + 3).filter((x) => x != null)) && (!peaks.length || i - peaks.at(-1).i >= 2)) peaks.push({ i, t: t0 + i * 60e3, v });
    }
    out.push({ start: e.start, end: e.end, peaks: peaks.map(({ t, v }) => ({ t, v })), avgHr: e.avgHr, source: 'exercise', exId: e.id });
  }
  return out.sort((a, b) => a.start - b.start);
}

// Add new candidates for a day to the pending list (skips ones already saved or dismissed).
export async function addCandidates(date, cands) {
  const st = get();
  let changed = false;
  for (const c of cands) {
    if (c.end > Date.now() - 10 * 60e3) continue; // still going
    const key = `${date}:${Math.round(c.start / 600e3)}`;
    if ((st.dismissed || []).includes(key)) continue;
    if (st.sessions.some((s) => s.start && s.start < c.end && c.start < s.end)) continue;
    const ex = st.pending.find((p) => p.start < c.end && c.start < p.end);
    if (ex) { Object.assign(ex, { start: c.start, end: c.end, peaks: c.peaks, avgHr: c.avgHr, maxHr: c.maxHr, source: c.source, exId: c.exId }); changed = true; continue; }
    st.pending.push({ id: uid(), key, date, ...c });
    changed = true;
  }
  st.scanned[date] = Date.now();
  for (const d of Object.keys(st.scanned)) if (dayDiff(new Date(), parseYmd(d)) > 30) delete st.scanned[d];
  await save(changed);
  return changed;
}

// Days to scan: today and the two days before, unless already scanned after the day ended.
export function daysToScan() {
  const st = get();
  const out = [];
  for (let i = 0; i < 3; i++) {
    const d = addDays(startOfDay(new Date()), -i);
    const key = ymd(d);
    const last = st.scanned[key];
    if (last && last > +addDays(d, 1) + 3600e3) continue;
    if (i === 0 && last && Date.now() - last < 20 * 60e3) continue;
    out.push(d);
  }
  return out;
}

// Local maxima of a 1-minute heart-rate series: one per set.
export function findPeaks(points, base) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i].hi ?? points[i].v;
    if (v == null || v < base + 30) continue;
    const win = points.slice(Math.max(0, i - 2), i + 3).map((p) => p.hi ?? p.v);
    if (v < Math.max(...win)) continue;
    const around = points.slice(Math.max(0, i - 3), i + 4).map((p) => p.v);
    if (v - Math.min(...around) < 8) continue;
    if (out.length && points[i].t - out.at(-1).t < 120e3) continue;
    out.push({ t: points[i].t, v: points[i].v });
  }
  return out;
}

// Heart-rate summary saved with a confirmed session (average, max, seconds per zone).
export function summarizeHr(points, zoneOfFn, zones) {
  if (!points.length) return null;
  const z = { light: 0, moderate: 0, vigorous: 0, peak: 0 };
  for (const p of points) { const k = zoneOfFn(p.v, zones); if (k) z[['', 'light', 'moderate', 'vigorous', 'peak'][k]] += 60; }
  return { avg: Math.round(mean(points.map((p) => p.v))), max: Math.round(Math.max(...points.map((p) => p.hi ?? p.v))), zones: z };
}

// Color each detected peak by the set it belongs to (in the order the sets were done).
export function colorPeaks(peaks, items) {
  const order = items.flatMap((it) => it.sets.map(() => it.lift));
  const colored = peaks.map((p, i) => ({ ...p, lift: order[i] || null, color: order[i] ? liftColor(order[i]) : 'var(--muted)' }));
  const spans = [];
  for (const it of items) {
    const ps = colored.filter((p) => p.lift === it.lift);
    if (ps.length) spans.push({ a: ps[0].t - 90e3, b: ps.at(-1).t + 90e3, color: liftColor(it.lift) });
  }
  return { peaks: colored, spans };
}

export function weekKey(date) {
  const d = parseYmd(date);
  const mon = addDays(d, -((d.getDay() + 6) % 7));
  return ymd(mon);
}
