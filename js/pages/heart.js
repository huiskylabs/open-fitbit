// 心率：日 = 24 小时曲线；周 / 月 / 3 月 = 静息心率、HRV 和你的基线
import { parseYmd, addDays, ymd, mean } from '../util.js';
import * as C from '../charts.js';
import { card, nums, num, empty, series, xLabels, workouts, zonesMin, activeZoneMin, zoneAvg } from './common.js';
import { hrSeries } from '../data.js';
import { VITALS } from './sleep.js';

export function render(ctx) {
  const { v, per } = ctx;
  if (per.range === 'd') return day(ctx);
  const rhr = series(v, per, 'rhr'), hrv = series(v, per, 'hrv');
  const xl = xLabels(per.range);
  const last = (s) => s.filter((p) => p.v != null).at(-1)?.v;
  let out = '';
  if (rhr.some((p) => p.v != null)) out += card('静息心率', C.trendBand(rhr, v.base.rhr, { unit: 'bpm', xLabels: xl }), { right: `<b class="big">${last(rhr)}<small> bpm</small></b>` });
  if (hrv.some((p) => p.v != null)) out += card('HRV', C.trendBand(hrv, v.base.hrv, { unit: 'ms', xLabels: xl }), { right: `<b class="big">${Math.round(last(hrv))}<small> ms</small></b>` });
  if (!out) return empty('这段时间没有心率数据');
  const ranges = per.days.map((date) => { const d = v.daily[date] || {}; return { date, min: d.hrMin ?? null, max: d.hrMax ?? null, avg: d.hrAvg ?? null }; });
  if (ranges.some((r) => r.min != null)) out += card('每日心率范围', C.rangeBars(ranges, { xLabels: (s) => xl(s.map((p) => ({ date: p.date }))) }), { sub: '竖条 = 最低到最高 · 点 = 平均' });
  if (per.range !== 'q') {
    const zd = per.days.map((date) => ({ date, z: v.daily[date]?.zoneSec ? zonesMin(v.daily[date].zoneSec) : null }));
    if (zd.some((d) => d.z)) out += card('每日心率区间分钟', C.zoneStack(zd, { avg: zoneAvg(v, per.to), xLabels: (s) => xl(s.map((p) => ({ date: p.date }))) }), { sub: '虚线 = 你的平均' });
  }
  const vit = VITALS.filter((x) => ['resp', 'spo2', 'skinRel'].includes(x.key)).map((x) => {
    const s = per.days.map((date) => ({ date, v: v.daily[date]?.[x.key] ?? null }));
    const vals = s.filter((p) => p.v != null);
    if (vals.length < 2) return '';
    return `<div class="vital"><div class="vk">${x.name}</div><div class="vv">${x.fmt(vals.at(-1).v)}<small>${x.unit}</small></div>${C.sparkBand(s, v.base[x.key] || {})}</div>`;
  }).join('');
  if (vit) out += card('夜间体征', `<div class="vitals three">${vit}</div>`, { sub: '蓝带 = 你的正常范围' });
  return out;
}

function day(ctx) {
  const { v, per } = ctx;
  const d = v.daily[per.to] || {};
  let out = card('', nums(
    num('静息', d.rhr ?? '–'), num('最低', d.hrMin != null ? Math.round(d.hrMin) : '–'),
    num('最高', d.hrMax != null ? Math.round(d.hrMax) : '–'), num('平均', d.hrAvg != null ? Math.round(d.hrAvg) : '–', 'bpm'),
  ), { cls: 'flat' });
  out += card('全天心率', `<div id="hrday" data-date="${per.to}"><div class="empty sm">读取中…</div></div>`);
  if (d.zoneSec) out += card('心率区间分钟', C.zoneRows(zonesMin(d.zoneSec)), { sub: `合计 ${Math.round(activeZoneMin(d.zoneSec))} 分钟` });
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
    el.innerHTML = C.dayCurve(pts, { start, end, zones: v.zones, sleeps, workouts: ws, rest: v.daily[date]?.rhr, now: Date.now() });
  } catch (e) { if (el.isConnected) el.innerHTML = `<div class="empty sm">${e.message}</div>`; }
}
