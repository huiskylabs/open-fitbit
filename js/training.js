// Strength-training log: detect sessions from heart rate + steps, guess what was trained,
// keep the log on the phone, and compute progress (heaviest set, records, volume, sets per week).
import * as store from './store.js';
import { ymd, parseYmd, addDays, dayDiff, startOfDay, uid, median, mean, sum } from './util.js';

export const PARTS = {
  chest: '胸', shoulders: '肩', biceps: '二头', triceps: '三头', abs: '腹', quads: '大腿前', calves: '小腿',
  back: '背', lowback: '下背', glutes: '臀', hams: '大腿后',
};

// Lifts are told apart by name, not color: every lift is drawn in the strength color.
// abbr = the one character used where a name doesn't fit (the calendar).
export const LIFTS = {
  squat: { name: '深蹲', abbr: '蹲', parts: { quads: 1, glutes: 1, hams: 0.5, lowback: 0.5, abs: 0.3 }, step: 2.5 },
  bench: { name: '卧推', abbr: '推', parts: { chest: 1, shoulders: 0.5, triceps: 0.5 }, step: 2.5 },
  deadlift: { name: '硬拉', abbr: '拉', parts: { hams: 1, glutes: 1, lowback: 1, back: 0.5, quads: 0.3 }, step: 5 },
  pullup: { name: '引体向上', abbr: '引', parts: { back: 1, biceps: 0.5, shoulders: 0.2 }, step: 2.5, bodyweight: true },
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
  const name = c?.name || id;
  return { id, name, abbr: name.slice(0, 1), parts: c?.parts || {}, step: c?.step || 2.5, bodyweight: !!c?.bodyweight };
}
export const allLiftIds = () => [...BIG, ...Object.keys(get().lib)];

export function ensureLift(id, def = {}) {
  if (LIFTS[id] || get().lib[id]) return id;
  const name = String(def.name || id).replace(/[<>&"']/g, '').slice(0, 20) || id;
  get().lib[id] = { name, parts: def.parts || {}, step: def.step || 2.5, bodyweight: !!def.bodyweight };
  return id;
}

// ---------- per-set maths ----------
export const setLoad = (id, s) => (lift(id).bodyweight ? s.add || 0 : s.kg || 0);
export const topSet = (id, sets) => sets.reduce((best, s) => {
  const w = setLoad(id, s);
  return !best || w > setLoad(id, best) || (w === setLoad(id, best) && s.reps > best.reps) ? s : best;
}, null);
export const volume = (id, sets) => sum(sets.map((s) => (lift(id).bodyweight ? s.reps : s.reps * (s.kg || 0))));

// "5×5 · 102.5 kg", "4×10", "8/8/6 · 60 kg", "11/11/10/9 次"
// Sets the way lifters write them: sets × reps. "4×11", "3×8 + 1×6"; the weight once when it is the same,
// else with each group: "1×8 60 kg + 3×5 70 kg". Returns { reps, kg } so pages can size them differently.
const kgTxt = (v) => String(Math.round((+v || 0) * 100) / 100);
export function setsParts(sets, bodyweight) {
  if (!sets?.length) return { reps: '', kg: '' };
  const load = (s) => (bodyweight ? s.add || 0 : s.kg || 0);
  const groups = [];
  for (const s of sets) {
    const g = groups.at(-1);
    if (g && g.reps === s.reps && g.load === load(s)) g.n++;
    else groups.push({ n: 1, reps: s.reps, load: load(s) });
  }
  const oneLoad = groups.every((g) => g.load === groups[0].load);
  const w = (v) => (bodyweight ? (v ? `+${kgTxt(v)} kg` : '') : `${kgTxt(v)} kg`);
  if (oneLoad) return { reps: groups.map((g) => `${g.n}×${g.reps}`).join(' + '), kg: w(groups[0].load) };
  return { reps: groups.map((g) => `${g.n}×${g.reps}${w(g.load) ? ' ' + w(g.load) : ''}`).join(' + '), kg: '' };
}
export function setsLabel(id, sets) {
  const p = setsParts(sets, lift(id).bodyweight);
  return [p.reps, p.kg].filter(Boolean).join(' · ');
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

// What comes next for one lift: last time's sets, and whether to add a step of weight (or a rep).
// Add only when every set at the top weight hit the usual reps, no set was called hard, and today's
// recovery score is not low. Settings can turn the suggestion off.
export function nextFor(id, recoveryToday = null) {
  const l = lastItem(id);
  if (!l) return null;
  const sets = l.item.sets;
  const reps = median(sets.map((s) => s.reps));
  const top = Math.max(...sets.map((s) => setLoad(id, s)));
  const hard = sets.some((s) => s.hard);
  const allReps = sets.filter((s) => setLoad(id, s) === top).every((s) => s.reps >= Math.floor(reps));
  const lowRec = recoveryToday != null && recoveryToday < 60;
  let suggestion = null;
  if (get().settings.hints !== false) {
    const lf = lift(id);
    if (allReps && !hard && !lowRec) suggestion = lf.bodyweight && top === 0 ? { reps: 1 } : { kg: lf.step };
    else suggestion = { keep: true, why: hard ? '上次有一组吃力' : !allReps ? '上次没做满' : '今天恢复分低' };
  }
  return { date: l.session.date, sets, suggestion, top, reps };
}

// The next session: the routine that is due (see guess), each lift with its target sets.
export function nextPlan(recoveryToday = null) {
  const g = guess(ymd(addDays(new Date(), 1)));
  if (!g) return null;
  const plan = g.items.map(({ lift: id }) => {
    const n = nextFor(id, recoveryToday);
    if (!n) return null;
    const lf = lift(id), s = n.suggestion || {};
    const f = lf.bodyweight ? 'add' : 'kg';
    let sets = n.sets.map(({ reps, kg, add }) => ({ reps, kg: kg || 0, ...(add ? { add } : {}) }));
    if (s.kg) sets = sets.map((x) => ((x[f] || 0) === n.top ? { ...x, [f]: n.top + s.kg } : x));
    else if (s.reps) sets = sets.map((x) => ({ ...x, reps: x.reps + s.reps }));
    // same weight: the target is to do the usual reps on every set (8/8/8/6 → 4×8)
    else if (s.keep) sets = sets.map((x) => ({ ...x, reps: Math.max(x.reps, Math.floor(n.reps)) }));
    const note = s.kg ? `上次 ${lf.bodyweight ? '+' : ''}${n.top} kg` : s.reps ? `上次 ${setsLabel(id, n.sets)}` : s.keep ? s.why : '';
    return { lift: id, sets, note };
  }).filter(Boolean);
  return plan.length ? plan : null;
}

// Progress series per session for one lift: the heaviest set (most reps for body-weight lifts).
// pr = heavier than every earlier session of that lift, the first one ever doesn't count.
const topOf = (id, sets) => (lift(id).bodyweight ? Math.max(...sets.map((x) => x.reps)) : topSet(id, sets).kg);
export function progress(id, from, to) {
  const out = [];
  let best = null;
  for (const s of sessions()) {
    const it = s.items.find((x) => x.lift === id && x.sets?.length);
    if (!it || s.date > to) continue;
    const top = topOf(id, it.sets);
    if (s.date >= from) out.push({ date: s.date, id: s.id, top, vol: volume(id, it.sets), pr: best != null && top > best });
    best = Math.max(best ?? -Infinity, top);
  }
  return out;
}

// every new personal record in a period, all lifts
export const records = (from, to) => allLiftIds().flatMap((id) => progress(id, from, to).filter((p) => p.pr).map((p) => ({ ...p, lift: id })));

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
  return p || null;
}

// undo: put a detected session back on the list to confirm
export async function restorePending(p) {
  const st = get();
  st.dismissed = (st.dismissed || []).filter((k) => k !== p.key);
  if (!st.pending.some((x) => x.id === p.id)) st.pending.push(p);
  await save();
}

// ---------- detection ----------
// One local day of 1-minute heart rate and steps → candidate strength sessions:
// heart rate above resting for ≥ 12 min, few steps, and ≥ 3 separate peaks (one per set).
// Thresholds are loose on purpose: lifting raises HR far less than cardio, and 不是训练 dismisses a wrong guess.
// `diag`, if given, collects every raised stretch and why it was or wasn't counted (shown in settings).
export function detect({ dayStart, hr, steps, sleeps = [], exercises = [], rest, diag }) {
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
  const on = H.map((v, i) => !X[i] && v != null && med(i) >= base + 15 && stepAvg(i) <= 40);
  const spans = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    if (on[i]) { if (cur && i - cur.b <= 4) cur.b = i; else { cur = { a: i, b: i }; spans.push(cur); } }
  }
  const out = [];
  for (const sp of spans) {
    const mins = sp.b - sp.a + 1;
    const vals = H.slice(sp.a, sp.b + 1).filter((x) => x != null);
    const note = (why) => diag?.push({ start: t0 + sp.a * 60e3, end: t0 + (sp.b + 1) * 60e3, mins, avg: Math.round(mean(vals)), max: Math.max(...vals), base, peaks: peaks.length, steps: Math.round(sum(S.slice(sp.a, sp.b + 1)) / mins), why });
    const peaks = [];
    if (mins < 12) { if (mins >= 6) note('不到 12 分钟'); continue; }
    for (let i = sp.a; i <= sp.b; i++) {
      const v = HX[i];
      if (v == null || v < base + 25) continue;
      const win = HX.slice(Math.max(sp.a, i - 2), Math.min(sp.b, i + 2) + 1).filter((x) => x != null);
      if (v < Math.max(...win)) continue;
      const around = H.slice(Math.max(0, i - 3), i + 4).filter((x) => x != null);
      if (v - Math.min(...around) < 6) continue;
      if (peaks.length && i - peaks.at(-1).i < 2) continue;
      peaks.push({ i, t: t0 + i * 60e3, v });
    }
    if (peaks.length < 3) { note(`只有 ${peaks.length} 个心率高峰，要 3 个`); continue; }
    if (sum(S.slice(sp.a, sp.b + 1)) / mins > 40) { note('步数太多，像走路'); continue; }
    // sets come every few minutes; random bursts during the day don't
    const gap = median(peaks.slice(1).map((p, k) => p.i - peaks[k].i));
    if (gap < 2 || gap > 10) { note(`高峰间隔 ${gap} 分钟，不像一组一组`); continue; }
    if (mean(vals) < base + 18) { note(`平均心率 ${Math.round(mean(vals))}，比静息高得不够`); continue; }
    note('');
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
    if (c.end > Date.now() - 2 * 60e3) continue; // probably still going; a later scan updates it
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

// Which lift each heart-rate peak belongs to (in the order the sets were done) and the stretch
// of the session each lift took, so the chart can name it.
export function setSpans(peaks, items) {
  const order = items.flatMap((it) => it.sets.map(() => it.lift));
  const ps = peaks.map((p, i) => ({ ...p, lift: order[i] || null }));
  const spans = [];
  for (const it of items) {
    const mine = ps.filter((p) => p.lift === it.lift);
    if (mine.length) spans.push({ a: mine[0].t - 90e3, b: mine.at(-1).t + 90e3, name: lift(it.lift).name, abbr: lift(it.lift).abbr });
  }
  return { peaks: ps, spans };
}

export function weekKey(date) {
  const d = parseYmd(date);
  const mon = addDays(d, -((d.getDay() + 6) % 7));
  return ymd(mon);
}
