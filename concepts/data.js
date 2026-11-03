// Believable sample data for the concept mockups: one full Wednesday (sleep from Tuesday night,
// strength in the morning, a lunch walk, basketball in the evening) and the 30 nights before it.
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const M = 60e3;
export const NOW = new Date('2026-11-04T21:30:00').getTime();
const at = (d, h, m) => new Date(`2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();

// one night: 4-5 cycles, deep early, REM late, a few short wakes
export function night(bed, wake, seed) {
  const r = rng(seed); const st = []; let t = bed;
  const push = (type, min) => { const e = Math.min(wake, t + min * M); if (e > t) st.push({ type, s: t, e }); t = e; };
  push('AWAKE', 8 + r() * 10);
  for (let c = 0; t < wake - 10 * M; c++) {
    push('LIGHT', c < 2 ? 18 + r() * 14 : 26 + r() * 16);
    push('DEEP', c === 0 ? 36 + r() * 14 : c === 1 ? 22 + r() * 14 : c === 2 ? r() * 10 : 0);
    push('LIGHT', 8 + r() * 10);
    push('REM', c === 0 ? 7 + r() * 6 : 16 + c * 5 + r() * 8);
    if (c >= 1 && r() < .6) push('AWAKE', 1 + r() * 4);
  }
  if (t < wake) push('AWAKE', (wake - t) / M);
  const hr = [];
  const base = 49 + r() * 4;
  for (let u = bed; u < wake; u += M) {
    const g = st.find((x) => u >= x.s && u < x.e)?.type || 'LIGHT';
    const p = (u - bed) / (wake - bed);
    const drift = 9 * Math.exp(-p * 5) + 3 * p * p;
    hr.push({ t: u, v: base + drift + { DEEP: -1.5, LIGHT: 1, REM: 5, AWAKE: 9 }[g] + (r() - .5) * 2.6 + 1.2 * Math.sin(u / 7e5) });
  }
  const mins = (k) => st.filter((x) => x.type === k).reduce((a, x) => a + (x.e - x.s) / M, 0);
  const asleep = (wake - bed) / M - mins('AWAKE');
  return { bed, wake, stages: st, hr, asleep, deep: mins('DEEP'), light: mins('LIGHT'), rem: mins('REM'), awake: mins('AWAKE'), low: Math.min(...hr.map((x) => x.v)) };
}

// last night
export const last = night(at(3, 23, 26), at(4, 6, 44), 20261104);

// the day after waking: minute heart rate + what happened
export const events = [
  { kind: 'strength', name: '力量', s: at(4, 7, 11), e: at(4, 8, 3), lifts: [{ n: '卧推', sets: [8, 8, 8, 6], kg: 70, note: '和上次一样' }, { n: '引体向上', sets: [11, 11, 10, 9], kg: 0, note: '+1 次' }], peak: 149 },
  { kind: 'walk', name: '散步', s: at(4, 12, 34), e: at(4, 13, 6), peak: 108 },
  { kind: 'ball', name: '篮球', s: at(4, 19, 5), e: at(4, 20, 21), peak: 172 },
];
export const dayHr = (() => {
  const r = rng(77); const out = [];
  for (let u = last.wake; u < NOW; u += M) {
    const h = new Date(u).getHours() + new Date(u).getMinutes() / 60;
    let v = 66 + 6 * Math.sin((h - 9) / 3) + (r() - .5) * 8;
    const ev = events.find((e) => u >= e.s && u < e.e);
    if (ev?.kind === 'strength') {
      const k = (u - ev.s) / M; const j = Math.floor((k - 6) / 5.5), ph = (k - 6) % 5.5;
      v = k < 6 ? 86 + k * 3 : j < 8 ? (ph < 1.2 ? 128 + (j < 4 ? j * 4 : (j - 4) * 3) + r() * 6 : 104 - ph * 4 + r() * 5) : 92 + r() * 6;
    } else if (ev?.kind === 'walk') v = 98 + r() * 9;
    else if (ev?.kind === 'ball') { const k = (u - ev.s) / M; v = 146 + 14 * Math.sin(k / 5) + 7 * Math.sin(k / 1.7) + (r() - .5) * 10 - (k < 6 ? (6 - k) * 9 : 0); v = Math.min(v, 172); }
    else if (h > 20.4) v = 70 + (r() - .5) * 6 + Math.max(0, 14 - (h - 20.35) * 18);
    out.push({ t: u, v });
  }
  return out;
})();

// 30 nights before (oldest first), with a cold 9-11 nights ago and late weekends
export const nights = Array.from({ length: 30 }, (_, i) => {
  const ago = 29 - i; const d = 4 - ago; const r = rng(900 + i);
  const date = new Date(at(4, 0, 0) - ago * 864e5);
  const wd = date.getDay(); const lateNight = wd === 6 || wd === 0;
  const sick = ago >= 9 && ago <= 11;
  const bed = date.getTime() - (24 * 60 - (23 * 60 + 15 + (lateNight ? 55 : 0) + (r() - .5) * 50)) * M;
  const wake = date.getTime() + ((wd === 6 || wd === 0 ? 7 * 60 + 55 : 6 * 60 + 48) + (r() - .5) * 30) * M;
  if (ago === 0) return { ...last, date, sick: false, hrv: 56, rhr: 58 };
  const n = night(bed, wake, 4000 + i);
  if (sick) n.hr = n.hr.map((x) => ({ ...x, v: x.v + 6 }));
  return { ...n, date, sick, hrv: Math.round(47 + 5 * Math.cos(ago / 6) + (r() - .5) * 8 - (sick ? 13 : 0)), rhr: Math.round(58 + (r() - .5) * 2.4 + (sick ? 5 : 0)) };
});

export const today = { sleepScore: 84, recovery: 78, steps: 11240, rhr: 58, hrv: 56, resp: 15.4, rhrRange: [56, 61], hrvRange: [39, 52], restingTrend: -1, activeMin: 112 };
export const hm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const dur = (min) => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`; };

// ---- 30 days, midnight to midnight, for the month of dials ----
function dayEvents(date, r, sick) {
  const wd = date.getDay(); const out = []; const t = (h, m) => { const d = new Date(date); d.setHours(h, m, 0, 0); return +d; };
  if (sick) return out;
  if ([1, 3, 5].includes(wd) && r() > .1) { const s = t(7, 2 + Math.round(r() * 14)); out.push({ kind: 'strength', s, e: s + (46 + r() * 12) * M }); }
  if ([2, 5].includes(wd) && r() > .3) { const s = t(12, 20 + Math.round(r() * 20)); out.push({ kind: 'walk', s, e: s + (22 + r() * 18) * M }); }
  if (wd === 4 && r() > .1) { const s = t(19, Math.round(r() * 12)); out.push({ kind: 'ball', s, e: s + (68 + r() * 20) * M }); }
  if (wd === 6 && r() > .15) { const s = t(16, 20 + Math.round(r() * 30)); out.push({ kind: 'ball', s, e: s + (80 + r() * 30) * M }); }
  return out;
}
export const days = nights.map((n, i) => {
  const date = n.date; const r = rng(5000 + i);
  const ev = i === nights.length - 1 ? events : dayEvents(date, r, n.sick);
  const next = nights[i + 1];
  // coarse heart rate every 4 minutes for the small dials
  const hr = []; const d0 = +date, d1 = d0 + 864e5;
  for (let u = d0; u < Math.min(d1, NOW); u += 4 * M) {
    const inN = (x) => x && u >= x.bed && u < x.wake;
    const nn = inN(n) ? n : inN(next) ? next : null;
    let v;
    if (nn) { const p = nn.hr[Math.round((u - nn.bed) / M)]; v = p ? p.v : 54; }
    else {
      const e = ev.find((x) => u >= x.s && u < x.e); const h = new Date(u).getHours();
      v = e ? (e.kind === 'ball' ? 140 + r() * 25 : e.kind === 'strength' ? 100 + r() * 40 : 98 + r() * 8) : 64 + 6 * Math.sin((h - 9) / 3) + (r() - .5) * 10;
      if (n.sick) v += 6;
    }
    hr.push({ t: u, v });
  }
  const sleepToday = (n.asleep);
  return { date, night: n, next, ev, hr, sick: n.sick, asleep: sleepToday, worse: n.sick };
});
