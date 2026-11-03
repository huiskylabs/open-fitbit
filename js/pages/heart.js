// 心率：恢复得怎么样。日 = 静息心率、HRV 和全天曲线；周 / 月 / 3 个月 = 静息心率和 HRV 在不在你的正常范围
import { parseYmd, addDays, ymd, mean, hm } from '../util.js';
import * as C from '../charts.js';
import { card, nums, num, empty, series, xLabels, workouts, kindLabel, METRIC, rangeText, daysOff } from './common.js';
import { hrSeries } from '../data.js';
import { isWorse, WORSE } from '../scores.js';

const KEYS = ['rhr', 'hrv'];
const SPAN = { rhr: 10, hrv: 20 }; // the y axis shows at least this much, so 1 bpm doesn't look like a swing
const fmtK = (k, x) => METRIC[k].fmt(x);

// the 7-day average for each day of the period, using the days before it too
const rolling = (v, per, k) => per.days.map((date) => {
  const w = [];
  for (let i = 0; i < 7; i++) { const x = v.daily[ymd(addDays(parseYmd(date), -i))]?.[k]; if (x != null) w.push(x); }
  return w.length >= 3 ? mean(w) : null;
});

// "比前 7 天低 1 bpm"; for 3 months, the last 4 weeks against the first 4
function change(v, per, k, s) {
  const m = METRIC[k];
  let a, b, what;
  if (per.range === 'q') {
    a = mean(s.slice(-28).map((p) => p.v)); b = mean(s.slice(0, 28).map((p) => p.v)); what = '3 个月前';
  } else {
    const prev = [];
    for (let i = 1; i <= per.n; i++) { const x = v.daily[ymd(addDays(per.start, -i))]?.[k]; if (x != null) prev.push(x); }
    a = mean(s.map((p) => p.v)); b = prev.length >= Math.min(3, per.n) ? mean(prev) : null; what = `前 ${per.n} 天`;
  }
  if (a == null || b == null) return '';
  const d = Math.round(a - b), w = /^\d/.test(what) ? ` ${what}` : what;
  return d === 0 ? `和${w}差不多` : `比${w}${d > 0 ? '高' : '低'} ${Math.abs(d)} ${m.unit}`;
}

export function render(ctx) {
  const { v, per } = ctx;
  if (per.range === 'd') return day(ctx);
  const s = Object.fromEntries(KEYS.map((k) => [k, series(v, per, k)]));
  const has = (k) => s[k].some((p) => p.v != null);
  if (!KEYS.some(has)) return empty('这段时间没有心率数据');
  let out = card('', nums(...KEYS.filter(has).map((k, i) =>
    num(`平均${k === 'hrv' ? ' ' : ''}${METRIC[k].name}`, fmtK(k, mean(s[k].map((p) => p.v))), METRIC[k].unit, i ? 'sm' : '', change(v, per, k, s[k])))), { cls: 'flat' });
  const xl = xLabels(per.range);
  for (const k of KEYS.filter(has)) out += trendCard(v, per, k, s[k], xl);
  return out;
}

// the title says how many days were on the worse side; the band is the normal range, its numbers in the sub
function trendCard(v, per, k, s, xl) {
  const bands = v.base[k] || {};
  const m = METRIC[k];
  const title = `${m.name}：${daysOff(k, s, bands)}`;
  const b = bands[s.filter((p) => bands[p.date]).at(-1)?.date];
  return card(title, C.trendBand(s, bands, { unit: m.unit, xLabels: xl, worse: WORSE[k], minSpan: SPAN[k], avg: per.range === 'w' ? false : rolling(v, per, k) }),
    { sub: b ? `${rangeText(k, b)} ${m.unit}` : '' });
}

function day(ctx) {
  const { v, per } = ctx;
  const date = per.to;
  const d = v.daily[date] || {};
  const b = (k) => v.base[k]?.[date];
  const cell = (k, i) => num(METRIC[k].name, `<span class="${isWorse(k, d[k], b(k)) ? 'warn' : ''}">${fmtK(k, d[k])}</span>`, METRIC[k].unit, i ? 'sm' : '', rangeText(k, b(k)));
  const keys = KEYS.filter((k) => d[k] != null);
  let out = keys.length ? card('', nums(...keys.map(cell)), { cls: 'flat' }) : '';
  out += card('全天心率', `<div id="hrday" data-date="${date}"><div class="empty sm">读取中…</div></div>`);
  return out;
}

export async function after(ctx, root) {
  if (ctx.per.range !== 'd') return;
  const el = root.querySelector('#hrday');
  if (!el) return;
  const { v } = ctx;
  const date = el.dataset.date;
  const start = +parseYmd(date), end = +addDays(parseYmd(date), 1);
  try {
    const pts = await hrSeries(start, end, 300);
    if (!el.isConnected) return;
    if (!pts.length) { el.innerHTML = '<div class="empty sm">这天没有心率数据</div>'; return; }
    const sleeps = v.m.sleeps.filter((s) => s.end > start && s.start < end);
    const ws = workouts(v).filter((w) => w.end > start && w.start < end);
    el.innerHTML = C.dayCurve(pts, { start, end, sleeps, workouts: ws, rest: v.daily[date]?.rhr, now: Date.now() });
    // "最高 172 bpm · 19:05 篮球": the highest point, and what you were doing then
    const top = pts.reduce((a, p) => ((p.hi ?? p.v) > (a.hi ?? a.v) ? p : a));
    const w = ws.find((x) => top.t >= x.start - 5 * 60e3 && top.t <= x.end + 5 * 60e3);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `最高 ${Math.round(top.hi ?? top.v)} bpm · ${hm(new Date(top.t))}${w ? ` ${kindLabel(w)}` : ''}`;
    el.closest('.card')?.querySelector('h2')?.append(sub);
  } catch (e) {
    console.warn(e);
    if (el.isConnected) el.innerHTML = '<div class="empty sm">没读到这天的心率，稍后再试</div>';
  }
}
