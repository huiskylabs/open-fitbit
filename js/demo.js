// A deterministic sample world with the same shape as the API, so every page can be tried
// before connecting (and the training flow can be tested without touching the real log).
import { DAY, ymd, parseYmd, addDays, today, startOfDay, clamp, mean, uid } from './util.js';
import { kindOf } from './api.js';

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
function rng(seed) { let s = hash(seed) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const ZONES = { LIGHT: [99, 112], MODERATE: [113, 135], VIGOROUS: [136, 162], PEAK: [163, 220] };
const SICK = [38, 42]; // days ago with a cold: no workouts, worse vitals

const cache = new Map();
function dayOf(date) {
  if (cache.has(date)) return cache.get(date);
  const d = parseYmd(date);
  const ago = Math.round((+today() - +d) / DAY);
  const r = rng('day' + date);
  const sick = ago >= SICK[0] && ago <= SICK[1];
  const wdN = d.getDay(); // 0 Sun
  const weekendMorning = wdN === 0 || wdN === 6;
  // ---- the night ending this morning ----
  const prev = addDays(d, -1);
  const lateNight = prev.getDay() === 5 || prev.getDay() === 6; // Fri / Sat night
  const bed = new Date(prev); bed.setHours(23, 15 + (lateNight ? 55 : 0) + Math.round((r() - 0.5) * 60) + (sick ? -40 : 0), 0, 0);
  const wake = new Date(d); wake.setHours(weekendMorning ? 7 : 6, (weekendMorning ? 55 : 50) + Math.round((r() - 0.5) * 40) + (sick ? 30 : 0), 0, 0);
  const sleep = makeNight(+bed, +wake, r, date);
  const nap = wdN === 0 && r() < 0.5 ? makeNap(date, r) : null;
  // ---- workouts ----
  const ev = [];
  const at = (h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return +x; };
  if (!sick && ago >= 0) {
    if ([1, 3, 5].includes(wdN) && r() > 0.08) {
      const s = at(7, 5 + Math.round(r() * 12));
      ev.push({ kind: 'strength', start: s, end: s + (48 + Math.round(r() * 10)) * 60e3, sets: 9 });
    }
    if (wdN === 4 && r() > 0.1) { const s = at(19, Math.round(r() * 10)); ev.push({ kind: 'basketball', start: s, end: s + (70 + Math.round(r() * 20)) * 60e3 }); }
    if (wdN === 6 && r() > 0.15) { const s = at(16, 30 + Math.round(r() * 30)); ev.push({ kind: 'basketball', start: s, end: s + (75 + Math.round(r() * 40)) * 60e3 }); }
    if ([2, 5].includes(wdN) && r() > 0.3) { const s = at(12, 20 + Math.round(r() * 20)); ev.push({ kind: 'walk', start: s, end: s + (25 + Math.round(r() * 20)) * 60e3 }); }
  }
  const metrics = {
    rhr: Math.round(59 + 1.2 * Math.sin(ago / 9) + (r() - 0.5) * 2.4 + (sick ? 5 : 0)),
    hrv: +(47 + 5 * Math.cos(ago / 7) + (r() - 0.5) * 9 - (sick ? 13 : 0)).toFixed(1),
    resp: +(15.2 + (r() - 0.5) * 0.6 + (sick ? 1.3 : 0)).toFixed(1),
    spo2: +(96 + (r() - 0.5) * 1.3).toFixed(1),
    skinRel: +((r() - 0.5) * 0.35 + (sick ? 0.65 : 0)).toFixed(2),
    vo2: +(45.6 + 1.5 * (1 - ago / 120) + (r() - 0.5) * 0.25).toFixed(1),
  };
  metrics.nremHr = metrics.rhr + 2 + Math.round(r() * 2);
  const out = { date, d, ago, sleep, nap, ev, metrics, seed: r() };
  cache.set(date, out);
  return out;
}

function makeNight(start, end, r, date) {
  const stages = [];
  let t = start + (6 + r() * 14) * 60e3;
  stages.push({ type: 'AWAKE', s: start, e: t });
  let cycle = 0;
  while (t < end - 5 * 60e3) {
    const seq = cycle < 2
      ? [['LIGHT', 18, 32], ['DEEP', 28, 48], ['LIGHT', 10, 18], ['REM', 6, 14]]
      : [['LIGHT', 25, 42], ['DEEP', 0, 14], ['LIGHT', 8, 16], ['REM', 18, 32], ['AWAKE', 1, 5]];
    for (const [type, a, b] of seq) {
      const len = a + r() * (b - a);
      if (len < 2) continue;
      const e = Math.min(end, t + len * 60e3);
      if (e <= t) break;
      stages.push({ type, s: t, e });
      t = e;
    }
    cycle++;
  }
  if (t < end) stages.push({ type: 'AWAKE', s: t, e: end });
  const byStage = {};
  for (const s of stages) byStage[s.type] = (byStage[s.type] || 0) + Math.round((s.e - s.s) / 60e3);
  const short = [];
  for (let i = 0; i < 4; i++) { const at = start + (0.15 + 0.8 * r()) * (end - start); short.push({ s: at, e: at + 60e3 }); }
  const inBed = Math.round((end - start) / 60e3);
  return {
    id: 'demo-sleep-' + date, start, end, main: true, nap: false, hasStages: true, stages, short, outOfBed: [],
    asleep: inBed - (byStage.AWAKE || 0), awake: byStage.AWAKE || 0, inBed, toFallAsleep: Math.round((stages[0].e - stages[0].s) / 60e3), byStage,
  };
}
function makeNap(date, r) {
  const d = parseYmd(date); d.setHours(15, Math.round(r() * 20), 0, 0);
  const s = +d, e = s + (25 + r() * 20) * 60e3;
  const m = Math.round((e - s) / 60e3);
  return { id: 'demo-nap-' + date, start: s, end: e, main: false, nap: true, hasStages: false, stages: [{ type: 'ASLEEP', s, e }], short: [], outOfBed: [], asleep: m, awake: 0, inBed: m, toFallAsleep: 0, byStage: { ASLEEP: m } };
}

const days = (since, endEx = addDays(today(), 1)) => { const out = []; for (let d = startOfDay(since); d < endEx; d = addDays(d, 1)) if (d <= today()) out.push(ymd(d)); return out; };
const sleepsOn = (date) => { const x = dayOf(date); return [x.sleep, x.nap].filter(Boolean); };

// ---- minute-level heart rate and steps ----
// the sleeps that can cover a minute of `date`: its own night and nap, and the night that starts that evening
const sleepsFor = new Map();
function sleepsAround(date) {
  if (sleepsFor.has(date)) return sleepsFor.get(date);
  const x = dayOf(date), nd = ymd(addDays(parseYmd(date), 1));
  const out = [x.sleep, nd <= ymd(today()) ? dayOf(nd).sleep : null, x.nap].filter(Boolean);
  sleepsFor.set(date, out);
  return out;
}

function minuteAt(t, date = ymd(new Date(t))) {
  const x = dayOf(date);
  const r = rng('m' + Math.floor(t / 60e3));
  const n = r() - 0.5;
  for (const s of sleepsAround(date)) {
    if (t >= s.start && t < s.end) {
      const st = s.stages.find((g) => t >= g.s && t < g.e)?.type || 'LIGHT';
      const v = x.metrics.rhr - 4 + { DEEP: -2, LIGHT: 0, REM: 5, AWAKE: 9, ASLEEP: 0 }[st] + n * 3 + 2 * Math.sin(t / 900e3);
      return { v, spread: 3, steps: 0 };
    }
  }
  for (const e of x.ev) {
    if (t < e.start || t >= e.end) continue;
    const k = (t - e.start) / 60e3;
    if (e.kind === 'strength') {
      const warm = 6, per = 4;
      if (k < warm) return { v: 88 + k * 2 + n * 4, spread: 5, steps: 12 + Math.round(r() * 10) };
      const j = Math.floor((k - warm) / per), ph = (k - warm) % per;
      if (j < e.sets) {
        const peak = j < 5 ? 132 + j * 2 : 124 + (j - 5) * 2;
        const v = ph < 1 ? peak - 6 + n * 4 : ph < 2 ? peak + n * 3 : 104 - (ph - 2) * 6 + n * 4;
        return { v, spread: ph < 2 ? 9 : 5, steps: Math.round(r() * 10) };
      }
      return { v: 92 + n * 4, spread: 4, steps: Math.round(r() * 15) };
    }
    if (e.kind === 'basketball') {
      const v = 142 + 14 * Math.sin(k / 6) + 8 * Math.sin(k / 2.3) + n * 10 - (k < 5 ? (5 - k) * 8 : 0);
      return { v, spread: 10, steps: 70 + Math.round(r() * 60) };
    }
    return { v: 104 + n * 6, spread: 5, steps: 100 + Math.round(r() * 15) };
  }
  const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  const walking = r() < 0.07;
  return { v: x.metrics.rhr + 14 + 6 * Math.sin(h / 2.2) + n * 8 + (walking ? 18 : 0), spread: 6, steps: walking ? 60 + Math.round(r() * 50) : Math.round(r() * r() * 30) };
}

function series(start, end, windowSec, pick) {
  const out = [];
  const lim = Math.min(end, Date.now());
  for (let t = Math.floor(start / 60e3) * 60e3; t < lim; t += windowSec * 1000) {
    const vals = [];
    for (let u = t; u < Math.min(t + windowSec * 1000, lim); u += 60e3) vals.push(minuteAt(u));
    if (vals.length) out.push(pick(t, vals));
  }
  return out;
}

function zoneSecs(start, end) {
  const z = { light: 0, moderate: 0, vigorous: 0, peak: 0 };
  for (let t = start; t < Math.min(end, Date.now()); t += 60e3) {
    const v = minuteAt(t).v;
    if (v >= ZONES.PEAK[0]) z.peak += 60; else if (v >= ZONES.VIGOROUS[0]) z.vigorous += 60; else if (v >= ZONES.MODERATE[0]) z.moderate += 60; else if (v >= ZONES.LIGHT[0]) z.light += 60;
  }
  return z;
}

// ---- the API-shaped source ----
export const demoSource = {
  async getSleeps(since) { return days(since).flatMap(sleepsOn); },
  async getExercises(since) {
    const out = [];
    for (const date of days(since)) {
      for (const e of dayOf(date).ev) {
        if (e.kind === 'strength' || e.end > Date.now()) continue;
        const type = e.kind === 'basketball' ? 'BASKETBALL' : 'WALKING';
        const hr = series(e.start, e.end, 60, (t, v) => v[0].v);
        const mins = (e.end - e.start) / 60e3;
        out.push({
          id: `demo-ex-${date}-${e.kind}`, type, kind: kindOf(type), name: '', start: e.start, end: e.end, activeSec: mins * 60,
          kcal: Math.round(mins * (e.kind === 'basketball' ? 9.6 : 4.6)), avgHr: Math.round(mean(hr)), steps: Math.round(mins * (e.kind === 'basketball' ? 95 : 108)),
          azm: null, zones: zoneSecs(e.start, e.end), manual: false,
        });
      }
    }
    return out;
  },
  async getDaily(key, since) {
    const out = [];
    for (const date of days(since)) {
      const m = dayOf(date).metrics;
      if (key === 'rhr') out.push({ date, rhr: m.rhr });
      if (key === 'hrv') out.push({ date, hrv: m.hrv, nremHr: m.nremHr });
      if (key === 'resp') out.push({ date, resp: m.resp });
      if (key === 'spo2') out.push({ date, spo2: m.spo2 });
      if (key === 'temp') out.push({ date, skinRel: m.skinRel, skinSd: 0.2 });
      if (key === 'vo2' && parseYmd(date).getDay() === 1) out.push({ date, vo2: m.vo2, vo2Level: m.vo2 >= 46.5 ? 'VERY_GOOD' : 'GOOD' });
      if (key === 'zones') out.push({ date, hrZones: ZONES });
    }
    return out;
  },
  // the day's total is the sum of the minute-level steps (so "平时到这个钟点" agrees with it)
  async getDailySteps(start, end) {
    return days(start, end).map((date) => {
      const a = +parseYmd(date), b = Math.min(a + DAY, Date.now());
      let v = 0;
      for (let t = a; t < b; t += 60e3) v += minuteAt(t, date).steps;
      return { date, steps: v };
    });
  },
  async getDailyZones(start, end) {
    return days(start, end).map((date) => {
      const x = dayOf(date), r = rng('z' + date);
      const z = { light: (60 + r() * 50) * 60, moderate: (8 + r() * 14) * 60, vigorous: r() * 4 * 60, peak: 0 };
      for (const e of x.ev) { if (e.start > Date.now()) continue; const s = zoneSecs(e.start, e.end); for (const k in z) z[k] += s[k]; }
      if (x.ago === 0) for (const k in z) z[k] = Math.round(z[k] * clamp((new Date().getHours() - 6) / 16, 0.05, 1));
      return { date, zoneSec: z };
    });
  },
  async getDailyHr(start, end) {
    return days(start, end).map((date) => {
      const x = dayOf(date), r = rng('hr' + date);
      const peak = x.ev.some((e) => e.kind === 'basketball') ? 165 + r() * 10 : x.ev.length ? 138 + r() * 12 : 112 + r() * 14;
      return { date, hrMin: x.metrics.rhr - 9 + Math.round(r() * 3), hrMax: Math.round(peak), hrAvg: Math.round(x.metrics.rhr + 13 + r() * 6) };
    });
  },
  async getPersonalRanges() { return []; },
  async getDevices() { return [{ name: 'Fitbit 手表（示例）', type: 'TRACKER', battery: 64, batteryStatus: 'Medium', lastSync: Date.now() - 12 * 60e3 }]; },
  async getHrSeries(start, end, windowSec = 300) {
    return series(start, end, windowSec, (t, v) => ({ t, v: Math.round(mean(v.map((x) => x.v))), lo: Math.round(Math.min(...v.map((x) => x.v - x.spread / 2))), hi: Math.round(Math.max(...v.map((x) => x.v + x.spread))) }));
  },
  async getStepsSeries(start, end, windowSec = 60) {
    return series(start, end, windowSec, (t, v) => ({ t, v: v.reduce((a, x) => a + x.steps, 0) }));
  },
};

// ---- a matching training history: one main lift + pull-ups, three mornings a week ----
export function demoTraining() {
  const sessions = [];
  const plan = ['squat', 'bench', 'deadlift'];
  const w = { squat: 90, bench: 62.5, deadlift: 120 };
  let pullReps = 7, i = 0;
  for (let ago = 92; ago >= 1; ago--) {
    const date = ymd(addDays(today(), -ago));
    const ev = dayOf(date).ev.find((e) => e.kind === 'strength');
    if (!ev) continue;
    const main = plan[i % 3];
    const r = rng('tr' + date);
    let sets;
    if (main === 'squat') sets = Array.from({ length: 5 }, () => ({ reps: 5, kg: w.squat }));
    if (main === 'bench') sets = [8, 8, 8, r() < 0.4 ? 6 : 8].map((reps, k) => ({ reps, kg: w.bench, ...(k === 3 && reps < 8 ? { hard: true, note: '最后一组很吃力' } : {}) }));
    if (main === 'deadlift') sets = Array.from({ length: 3 }, () => ({ reps: 5, kg: w.deadlift }));
    const pulls = Array.from({ length: 4 }, (_, k) => ({ reps: Math.max(5, Math.round(pullReps) - (k >= 2 ? 1 : 0) - (k === 3 && r() < 0.5 ? 1 : 0)), kg: 0 }));
    sessions.push({ id: uid(), date, start: ev.start, end: ev.end, source: 'detected', items: [{ lift: main, sets }, { lift: 'pullup', sets: pulls }], savedAt: ev.end + 3600e3 });
    if (main === 'squat' && r() < 0.85) w.squat += 2.5;
    if (main === 'bench' && !sets.some((s) => s.hard) && r() < 0.5) w.bench += 2.5;
    if (main === 'deadlift' && r() < 0.85) w.deadlift += 5;
    pullReps = Math.min(11, pullReps + 0.12);
    i++;
  }
  return { v: 1, sessions, lib: {}, pending: [], dismissed: [], scanned: {}, settings: { hints: true }, updatedAt: Date.now() };
}

export const DEMO_ZONES = ZONES;
