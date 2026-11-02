// Shared bits for the pages: periods, cards, number blocks, merged workout list.
import { ymd, parseYmd, addDays, today, md, wk, esc, hmDur, mean, dayDiff } from '../util.js';
import * as tr from '../training.js';
import { zoneOf } from '../scores.js';

export const RANGES = [['d', '日'], ['w', '周'], ['m', '月'], ['q', '3月']];
export const MAX_OFFSET = { d: 119, w: 16, m: 3, q: 0 };

export function period(range, offset) {
  const t0 = today();
  const n = { d: 1, w: 7, m: 30, q: 91 }[range];
  const end = addDays(t0, -n * offset);
  const start = addDays(end, -(n - 1));
  const days = Array.from({ length: n }, (_, i) => ymd(addDays(start, i)));
  let label;
  if (range === 'd') label = offset === 0 ? '今天' : offset === 1 ? '昨天' : `${md(end)} 周${wk(end)}`;
  else if (offset === 0) label = { w: '近 7 天', m: '近 30 天', q: '近 3 个月' }[range];
  else label = `${md(start)} – ${md(end)}`;
  return { range, offset, start, end, n, days, label, from: days[0], to: days.at(-1) };
}

export const card = (title, body, { sub = '', cls = '', act = '', right = '' } = {}) =>
  `<section class="card ${cls}"${act}>${title ? `<h2><span>${title}</span>${right || (sub ? `<span class="sub">${sub}</span>` : '')}</h2>` : ''}${body}</section>`;

export const num = (k, v, unit = '', cls = '') => `<div class="num ${cls}"><div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
export const nums = (...items) => `<div class="nums">${items.join('')}</div>`;
export const durHtml = (min) => {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}<small>h</small> ${String(m).padStart(2, '0')}<small>m</small>` : `${m}<small>m</small>`;
};
export const empty = (s = '这段时间没有数据') => `<div class="empty">${s}</div>`;

// x labels for long series: first / last (and weekdays for a week)
export function xLabels(range) {
  return (series) => {
    const n = series.length;
    if (n <= 7) return series.map((p, i) => [i, wk(parseYmd(p.date))]);
    const last = series.at(-1).date === ymd(today()) ? '今天' : md(parseYmd(series.at(-1).date));
    return [[0, md(parseYmd(series[0].date))], [n - 1, last]];
  };
}

export const nightRows = (v, per) => per.days.map((date) => ({ date, night: v.nights[date] || null }));

export const series = (v, per, key) => per.days.map((date) => ({ date, v: v.daily[date]?.[key] ?? null }));

// Fitbit-recorded workouts + strength sessions found by the app (not double counted)
export function workouts(v) {
  const list = v.m.exercises.map((e) => ({ ...e, src: 'fitbit' }));
  for (const s of tr.sessions()) {
    if (!s.start || !s.end) continue;
    const ex = list.find((e) => (s.exId && e.id === s.exId) || (e.kind === 'strength' && e.start < s.end && s.start < e.end));
    if (ex) { ex.sessionId = s.id; continue; }
    list.push({
      id: 'tr-' + s.id, sessionId: s.id, type: 'STRENGTH_TRAINING', kind: 'strength', name: '力量训练', start: s.start, end: s.end,
      activeSec: (s.end - s.start) / 1000, kcal: null, avgHr: s.hr?.avg ?? null, steps: null,
      zones: s.hr?.zones || { light: 0, moderate: 0, vigorous: 0, peak: 0 }, src: 'app',
    });
  }
  return list.sort((a, b) => a.start - b.start);
}

export const inDays = (list, per) => list.filter((w) => { const d = ymd(new Date(w.start)); return d >= per.from && d <= per.to; });

export function kindLabel(w) {
  return { strength: '力量训练', basketball: '篮球' }[w.kind] || ({
    WALKING: '步行', RUNNING: '跑步', HIKING: '徒步', BIKING: '骑行', SWIMMING: '游泳', YOGA: '瑜伽', ELLIPTICAL: '椭圆机', TENNIS: '网球',
    BADMINTON: '羽毛球', SOCCER: '足球', DANCING: '跳舞', TREADMILL: '跑步机', HIIT: 'HIIT', OUTDOOR_BIKE: '骑行', STATIONARY_BIKE: '单车',
  }[w.type] || w.name || '运动');
}

export const zonesMin = (z) => ({ light: (z.light || 0) / 60, moderate: (z.moderate || 0) / 60, vigorous: (z.vigorous || 0) / 60, peak: (z.peak || 0) / 60 });
export const activeZoneMin = (z) => ((z.moderate || 0) + (z.vigorous || 0) + (z.peak || 0)) / 60;

// zone seconds of a 1-minute HR series
export function zoneSecsOf(points, zones) {
  const z = { light: 0, moderate: 0, vigorous: 0, peak: 0 };
  for (const p of points) {
    const k = zoneOf(p.v, zones);
    if (k) z[['', 'light', 'moderate', 'vigorous', 'peak'][k]] += 60;
  }
  return z;
}

// average daily active-zone minutes over the 30 days before `date`
export function zoneAvg(v, date) {
  const vals = [];
  for (let i = 1; i <= 30; i++) { const z = v.daily[ymd(addDays(parseYmd(date), -i))]?.zoneSec; if (z) vals.push(activeZoneMin(z)); }
  return vals.length >= 5 ? mean(vals) : null;
}

export const dayName = (date) => {
  const d = parseYmd(date), diff = dayDiff(today(), d);
  return diff === 0 ? '今天' : diff === 1 ? '昨天' : `${md(d)} 周${wk(d)}`;
};

export { esc, hmDur };
