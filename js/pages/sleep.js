// 睡眠：日 = 一晚的分期；周 = 作息条形码；月 = 规律；3 月 = 趋势
import { hm, md, parseYmd, ymd, addDays, mean, sd, nightMin, clockLabel, hmDur, signed, wd, today } from '../util.js';
import * as C from '../charts.js';
import { card, nums, num, durHtml, empty, nightRows, xLabels, esc } from './common.js';
import { hrSeries } from '../data.js';

export const VITALS = [
  { key: 'nremHr', name: '睡眠心率', unit: 'bpm', fmt: (v) => Math.round(v) },
  { key: 'hrv', name: 'HRV', unit: 'ms', fmt: (v) => Math.round(v) },
  { key: 'resp', name: '呼吸率', unit: '', fmt: (v) => v.toFixed(1) },
  { key: 'spo2', name: '血氧', unit: '%', fmt: (v) => Math.round(v) },
  { key: 'skinRel', name: '皮温', unit: '°C', fmt: (v) => signed(v, 1) },
];

const avgClock = (vals) => (vals.length ? mean(vals) : null);

export function render(ctx) {
  const { v, per } = ctx;
  if (per.range === 'd') return day(ctx);
  const rows = nightRows(v, per);
  const ns = rows.map((r) => r.night).filter(Boolean);
  if (!ns.length) return empty('这段时间没有睡眠记录');
  const avgSleep = mean(ns.map((n) => n.asleep));
  const bed = avgClock(ns.map((n) => nightMin(new Date(n.start))));
  const wake = avgClock(ns.map((n) => nightMin(new Date(n.end))));
  const bedSd = sd(ns.map((n) => nightMin(new Date(n.start))));
  const top = per.range === 'w'
    ? nums(num('平均时长', durHtml(avgSleep)), num('平均上床 → 起床', `${clockLabel(bed)} → ${clockLabel(wake)}`, '', 'sm'))
    : per.range === 'm'
      ? nums(num('平均时长', durHtml(avgSleep)), num('上床波动', `±${Math.round(bedSd || 0)}`, '分', 'sm'), num('上床 → 起床', `${clockLabel(bed)} → ${clockLabel(wake)}`, '', 'sm'))
      : nums(num('平均时长', durHtml(avgSleep)), num('上床波动', `±${Math.round(bedSd || 0)}`, '分', 'sm'), num('睡够 8 小时', ns.filter((n) => n.asleep >= v.goalMin).length, '晚', 'sm'));
  let out = card('', top, { cls: 'flat' });
  if (per.range === 'w') {
    out += card('睡眠条形码', C.barcode(rows, { rowH: 22 }));
    out += card('每晚时长', C.sleepBars(rows, { goal: v.goalMin }), { sub: '虚线 = 8 小时' });
  } else if (per.range === 'm') {
    out += card('睡眠条形码', C.barcode(rows, { rowH: 10, label: (r, i) => (i % 7 === 0 ? String(parseYmd(r.date).getDate()) : '') }), { sub: '灰底 = 周末' });
    out += card('每晚时长', C.sleepBars(rows, { goal: v.goalMin, stacked: false, avgLine: true, xLabel: (r, i) => (i % 7 === 0 ? String(parseYmd(r.date).getDate()) : '') }), { sub: '线 = 7 天平均' });
    out += card('平均阶段构成', stageAvgBar(ns));
  } else {
    const byDate = Object.fromEntries(rows.filter((r) => r.night).map((r) => [r.date, r.night.asleep]));
    out += card('日历热力图', C.calHeat(byDate, { start: per.start, end: per.end, max: v.goalMin + 60, min: v.goalMin - 180 }) + C.heatLegend(), { sub: '一列一周' });
    const weeks = weekBuckets(per, rows);
    out += card('作息漂移', C.drift(weeks), { sub: '每周平均上床 → 起床' });
    out += card('每周平均分期', C.weeklyStages(weeks, { goal: v.goalMin }), { sub: '虚线 = 8 小时' });
  }
  out += vitalsTrend(ctx);
  const naps = per.days.flatMap((d) => v.naps[d] || []);
  if (naps.length && per.range !== 'q') out += card('小睡', `<div class="chips">${naps.slice(-8).map((n) => `<span class="chip">${md(new Date(n.end))} ${hm(new Date(n.start))} · ${Math.round(n.asleep)} 分钟</span>`).join('')}</div>`);
  return out;
}

function stageAvgBar(ns) {
  const keys = ['DEEP', 'LIGHT', 'REM', 'AWAKE'];
  const staged = ns.filter((n) => n.hasStages);
  if (!staged.length) return '';
  const avg = Object.fromEntries(keys.map((k) => [k, mean(staged.map((n) => n.byStage[k] || 0))]));
  return C.stageBar(avg) + C.stageLegend(avg);
}

function weekBuckets(per, rows) {
  const out = [];
  for (let i = 0; i < 13; i++) {
    const chunk = rows.slice(i * 7, i * 7 + 7).filter((r) => r.night);
    const ns = chunk.map((r) => r.night);
    const st = ns.filter((n) => n.hasStages);
    const beds = ns.map((n) => nightMin(new Date(n.start))), wakes = ns.map((n) => nightMin(new Date(n.end)));
    const startD = parseYmd(rows[i * 7]?.date || per.from);
    out.push({
      label: `${md(startD)} 起一周`, short: i === 0 ? '13 周前' : i === 12 ? '本周' : '',
      bed: ns.length ? mean(beds) : null, wake: ns.length ? mean(wakes) : null,
      bedLo: ns.length ? Math.min(...beds) : null, bedHi: ns.length ? Math.max(...beds) : null,
      wakeLo: ns.length ? Math.min(...wakes) : null, wakeHi: ns.length ? Math.max(...wakes) : null,
      asleep: ns.length ? mean(ns.map((n) => n.asleep)) : 0,
      DEEP: st.length ? mean(st.map((n) => n.byStage.DEEP || 0)) : 0,
      LIGHT: st.length ? mean(st.map((n) => n.byStage.LIGHT || 0)) : ns.length ? mean(ns.map((n) => n.asleep)) : 0,
      REM: st.length ? mean(st.map((n) => n.byStage.REM || 0)) : 0,
      AWAKE: st.length ? mean(st.map((n) => n.byStage.AWAKE || 0)) : 0,
    });
  }
  return out;
}

function vitalsTrend(ctx) {
  const { v, per } = ctx;
  const cards = VITALS.map((x) => {
    const s = per.days.map((date) => ({ date, v: v.daily[date]?.[x.key] ?? null }));
    const vals = s.filter((p) => p.v != null);
    if (vals.length < 2) return '';
    const last = vals.at(-1).v;
    return `<div class="vital"><div class="vk">${x.name}</div><div class="vv">${x.fmt(last)}<small>${x.unit}</small></div>${C.sparkBand(s, v.base[x.key] || {})}</div>`;
  }).join('');
  if (!cards) return '';
  const lab = { w: '7 晚', m: '30 晚', q: '13 周' }[per.range];
  return card(`夜间体征 · ${lab}`, `<div class="vitals">${cards}</div>`, { sub: '蓝带 = 你的正常范围' });
}

function day(ctx) {
  const { v, per } = ctx;
  const date = per.to;
  const n = v.nights[date];
  if (!n) return empty('这晚没有睡眠记录');
  const sc = v.sleepScores[date];
  let out = card('', nums(
    num('总时长', durHtml(n.asleep)),
    num('上床 → 起床', `${hm(new Date(n.start))} → ${hm(new Date(n.end))}`, '', 'sm'),
    sc ? num('睡眠分', sc.total, '', 'sm score') : '',
  ), { cls: 'flat' });
  out += card('夜间心率 · 分期', `<div id="hypno" data-date="${date}">${C.hypnogram(n)}</div>`, { sub: n.hasStages ? '' : '这晚只有总时长' });
  if (n.hasStages) {
    // your 30-night average composition (for the ▼ marks)
    const prev = [];
    for (let i = 1; i <= 30; i++) { const p = v.nights[ymd(addDays(parseYmd(date), -i))]; if (p?.hasStages) prev.push(p); }
    const avg = prev.length >= 5 ? Object.fromEntries(['DEEP', 'LIGHT', 'REM', 'AWAKE'].map((k) => [k, mean(prev.map((p) => p.byStage[k] || 0))])) : null;
    out += card('阶段构成', C.stageBar(n.byStage, avg) + C.stageLegend(n.byStage), { sub: avg ? '▼ = 你的 30 天平均' : '' });
  }
  const vit = VITALS.map((x) => {
    const val = v.daily[date]?.[x.key];
    if (val == null) return '';
    return `<div class="vital"><div class="vk">${x.name}</div><div class="vv">${x.fmt(val)}<small>${x.unit}</small></div>${C.rangeMini(val, v.base[x.key]?.[date])}</div>`;
  }).join('');
  if (vit) out += card('夜间体征', `<div class="vitals">${vit}</div>`, { sub: '蓝带 = 你的正常范围' });
  const naps = v.naps[date] || [];
  if (naps.length) out += card('小睡', `<div class="chips">${naps.map((x) => `<span class="chip">${hm(new Date(x.start))}–${hm(new Date(x.end))} · ${Math.round(x.asleep)} 分钟</span>`).join('')}</div>`);
  return out;
}

export async function after(ctx, root) {
  if (ctx.per.range !== 'd') return;
  const el = root.querySelector('#hypno');
  const n = el && ctx.v.nights[el.dataset.date];
  if (!n) return;
  try {
    const pts = await hrSeries(n.start - 10 * 60e3, n.end + 10 * 60e3, 120);
    if (el.isConnected) el.innerHTML = C.hypnogram(n, pts);
  } catch (e) { console.warn(e); }
}
