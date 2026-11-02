// Sample data with the same shape as api.js output, so the UI can be tried before connecting.
import { daysAgo, ymd } from './api.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => a + rnd() * (b - a);

function makeNight(n) {
  const wake = daysAgo(n); wake.setHours(7, Math.round(between(0, 50)));
  const start = new Date(wake.getTime() - between(6.3, 8.2) * 3600e3);
  const stages = [];
  let t = new Date(start.getTime() + between(5, 18) * 60e3);
  stages.push({ type: 'AWAKE', start: new Date(start), end: new Date(t) });
  let cycle = 0;
  while (t < wake) {
    const seq = cycle < 2
      ? [['LIGHT', 20, 35], ['DEEP', 25, 45], ['LIGHT', 10, 20], ['REM', 6, 14]]
      : [['LIGHT', 25, 45], ['DEEP', 0, 12], ['LIGHT', 8, 15], ['REM', 18, 32], ['AWAKE', 1, 6]];
    for (const [type, a, b] of seq) {
      const d = between(a, b);
      if (d < 2) continue;
      const e = new Date(Math.min(wake, t.getTime() + d * 60e3));
      if (e <= t) break;
      stages.push({ type, start: new Date(t), end: e });
      t = e;
    }
    cycle++;
  }
  const byStage = {};
  for (const s of stages) byStage[s.type] = (byStage[s.type] || 0) + Math.round((s.end - s.start) / 60e3);
  const inBed = Math.round((wake - start) / 60e3);
  return {
    id: 'demo-sleep-' + n, start, end: wake, main: true, nap: false, hasStages: true, stages,
    asleep: inBed - (byStage.AWAKE || 0), awake: byStage.AWAKE || 0, inBed,
    toFallAsleep: Math.round((stages[0].end - stages[0].start) / 60e3), byStage,
    awakenings: stages.filter((s) => s.type === 'AWAKE').length,
  };
}

const TYPES = [
  ['RUNNING', '跑步', 1800, 3600, 152],
  ['WALKING', '步行', 1500, 3000, 108],
  ['WEIGHTLIFTING', '力量训练', 2400, 3600, 118],
  ['BIKING', '骑行', 2400, 4200, 135],
  ['SWIMMING', '游泳', 1800, 2700, 128],
];

export function demoData() {
  seed = 7;
  const sleeps = Array.from({ length: 14 }, (_, i) => makeNight(i));
  const exercises = [];
  for (let d = 0; d < 30; d++) {
    if (rnd() < 0.45) continue;
    const [type, name, a, b, hr] = TYPES[Math.floor(rnd() * TYPES.length)];
    const start = daysAgo(d); start.setHours(Math.round(between(7, 19)), Math.round(between(0, 59)));
    const dur = between(a, b);
    const total = dur;
    const zones = { light: total * between(.15, .3), moderate: total * between(.2, .4), vigorous: total * between(.05, .3), peak: total * between(0, .08) };
    exercises.push({
      id: 'demo-ex-' + d, type, name, start, end: new Date(start.getTime() + dur * 1000), activeSec: dur,
      kcal: Math.round(dur / 60 * between(6, 11)), avgHr: Math.round(hr + between(-8, 8)),
      distanceM: ['RUNNING', 'WALKING', 'BIKING', 'SWIMMING'].includes(type) ? dur * ({ RUNNING: 2.8, WALKING: 1.4, BIKING: 6, SWIMMING: .7 })[type] : null,
      steps: ['RUNNING', 'WALKING'].includes(type) ? Math.round(dur * (type === 'RUNNING' ? 2.7 : 1.8)) : null,
      azm: Math.round((zones.moderate + 2 * (zones.vigorous + zones.peak)) / 60), zones,
      manual: false, gps: type !== 'WEIGHTLIFTING' && type !== 'SWIMMING',
    });
  }
  exercises.sort((a, b) => b.start - a.start);
  const rhr = Array.from({ length: 30 }, (_, i) => ({ date: ymd(daysAgo(29 - i)), v: Math.round(58 + Math.sin(i / 4) * 2 + between(-1.5, 1.5)) }));
  const hrv = Array.from({ length: 30 }, (_, i) => ({ date: ymd(daysAgo(29 - i)), v: +(42 + Math.cos(i / 5) * 6 + between(-4, 4)).toFixed(1) }));
  const steps = Array.from({ length: 14 }, (_, i) => ({ date: ymd(daysAgo(13 - i)), v: Math.round(between(4500, 13500)) }));
  steps[13].v = Math.round(steps[13].v * Math.min(1, new Date().getHours() / 21));
  return { sleeps, exercises, rhr, hrv, steps };
}

export function demoHr(start, end, windowSec = 300, workout) {
  const out = [];
  const night = (h) => h < 6.5 || h > 23;
  for (let t = start.getTime(); t < Math.min(end.getTime(), Date.now()); t += windowSec * 1000) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60;
    let v = workout ? workout.avgHr + Math.sin((t - start) / 240e3) * 12 + between(-4, 4)
      : night(h) ? 54 + between(-3, 4) : 72 + Math.sin(h) * 6 + between(-6, 10);
    if (!workout && h > 18 && h < 19) v = 135 + between(-10, 15);
    out.push({ t: d, v: Math.round(v), lo: Math.round(v - between(3, 9)), hi: Math.round(v + between(3, 12)) });
  }
  return out;
}
