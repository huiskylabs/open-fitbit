// 睡眠：睡够没有、规律吗。日 = 一晚的分期；周 = 每晚几点睡、睡多久；月 = 规律；3 个月 = 每周的变化
import { hm, md, parseYmd, mean, nightMin, clockLabel, hmDur, isWeekend, quantile, eveOf } from '../util.js';
import * as C from '../charts.js';
import { card, nums, num, durHtml, empty, nightRows, facts, sleepWhy, usualStages, nightLabel, METRIC, unitHtml, rangeText, sp, offText } from './common.js';
import { isWorse, WORSE } from '../scores.js';
import { hrSeries } from '../data.js';

export const VITALS = ['nremHr', 'hrv', 'resp', 'spo2', 'skinRel'];

// "22:55–00:10": the bedtimes of most nights (the middle 70 %)
const mostBeds = (ns) => {
  const beds = ns.map((n) => nightMin(new Date(n.start)));
  return beds.length >= 3 ? `${clockLabel(quantile(beds, 0.15))}–${clockLabel(quantile(beds, 0.85))}` : null;
};

export function render(ctx) {
  const { v, per } = ctx;
  if (per.range === 'd') return day(ctx);
  const rows = nightRows(v, per);
  const ns = rows.map((r) => r.night).filter(Boolean);
  if (!ns.length) return empty('这段时间没有睡眠记录');
  const enough = ns.filter((n) => n.asleep >= v.goalMin).length;
  const beds = mostBeds(ns);
  let out = card('', nums(
    num('平均睡着', durHtml(mean(ns.map((n) => n.asleep)))),
    per.range === 'q' ? num(`睡够 ${hmDur(v.goalMin)}`, `${enough}/${ns.length}`, '晚', 'sm') : '',
    beds ? num('多数晚上上床', beds, '', 'sm') : '',
  ), { cls: 'flat' });
  if (per.range === 'w') {
    out += card('几点睡、几点起', C.barcode(rows, { rowH: 22 }));
    out += card(`睡够 ${hmDur(v.goalMin)}：${enough}/${ns.length} 晚`, C.sleepBars(rows, { goal: v.goalMin }));
  } else if (per.range === 'm') {
    out += card('几点睡、几点起', C.barcode(rows, { rowH: 10, stages: false, label: (r, i) => (i % 7 === 0 ? String(eveOf(r.date).getDate()) : '') }), { lead: weekendLine(rows) });
    out += card(`睡够 ${hmDur(v.goalMin)}：${enough}/${ns.length} 晚`, C.sleepBars(rows, { goal: v.goalMin, avgLine: true, xLabel: (r, i) => (i % 7 === 0 ? String(eveOf(r.date).getDate()) : '') }));
  } else {
    const weeks = weekBuckets(rows);
    out += trendCard('时长', weeks.map((w) => ({ ...w, v: w.asleep })), hmDur, (d) => `比 3 个月前${d > 0 ? '多' : '少'} ${hmDur(d)}`);
    out += trendCard('上床', weeks.map((w) => ({ ...w, v: w.bed })), clockLabel, (d) => `比 3 个月前${d > 0 ? '晚' : '早'} ${hmDur(d)}`);
  }
  out += vitalsCard(ctx);
  const naps = per.days.flatMap((d) => v.naps[d] || []);
  if (naps.length && per.range !== 'q') out += card(`小睡 ${naps.length} 次`, facts(naps.slice(-8).reverse().map((n) => [md(new Date(n.end)), `${hm(new Date(n.start))}–${hm(new Date(n.end))}`, hmDur(n.asleep)])));
  return out;
}

// "周五、周六晚上平均晚睡 52 分钟" — only when it's a real difference
function weekendLine(rows) {
  const bed = (r) => nightMin(new Date(r.night.start));
  const we = rows.filter((r) => r.night && isWeekend(parseYmd(r.date))).map(bed);
  const wd = rows.filter((r) => r.night && !isWeekend(parseYmd(r.date))).map(bed);
  if (we.length < 2 || wd.length < 4) return '';
  const d = mean(we) - mean(wd);
  return Math.abs(d) < 20 ? '周末和平时差不多' : `周五、周六晚上平均${d > 0 ? '晚' : '早'}睡 ${hmDur(d)}`;
}

// 13 blocks of 7 nights; the last one ends today
function weekBuckets(rows) {
  return Array.from({ length: 13 }, (_, i) => {
    const ns = rows.slice(i * 7, i * 7 + 7).map((r) => r.night).filter(Boolean);
    const a = rows[i * 7]?.date, b = rows[i * 7 + 6]?.date;
    return {
      label: a && b ? `${md(parseYmd(a))}–${md(parseYmd(b))}` : '',
      short: i === 0 ? '12 周前' : i === 12 ? '近 7 天' : '',
      bed: ns.length ? mean(ns.map((n) => nightMin(new Date(n.start)))) : null,
      asleep: ns.length ? mean(ns.map((n) => n.asleep)) : null,
    };
  });
}

// one weekly line; the title compares the last 4 weeks with the first 4
function trendCard(what, weeks, fmt, change) {
  const first = mean(weeks.slice(0, 4).map((w) => w.v)), last = mean(weeks.slice(-4).map((w) => w.v));
  if (first == null || last == null) return '';
  const d = last - first;
  return card(`${what}：${Math.abs(d) < 10 ? '和 3 个月前差不多' : change(d)}`, C.weekLine(weeks, { fmt }), { sub: '每周平均' });
}

// One cell per vital: the average of the period, today's normal range, and a small trend (orange
// dots = nights on the worse side). 3 months use weekly averages so the trend isn't lost in noise.
// The title flags only an average outside the range: single nights out of range happen often.
function vitalsCard(ctx) {
  const { v, per } = ctx;
  const avgs = [];
  const cells = VITALS.map((k) => {
    const daily = per.days.map((date) => ({ date, v: v.daily[date]?.[k] ?? null }));
    const vals = daily.filter((p) => p.v != null);
    if (vals.length < 2) return '';
    const s = per.range === 'q' ? Array.from({ length: 13 }, (_, i) => { const w = daily.slice(i * 7, i * 7 + 7); return { date: w.at(-1).date, v: mean(w.map((p) => p.v)) }; }) : daily;
    const avg = mean(vals.map((p) => p.v)), b = v.base[k]?.[vals.at(-1).date];
    avgs.push({ k, v: avg, b });
    return `<div class="vital"><div class="vk">${METRIC[k].name}</div><div class="vv${isWorse(k, avg, b) ? ' warn' : ''}">${unitHtml(k, avg)}</div><div class="vn">${rangeText(k, b)}</div>${C.sparkBand(s, v.base[k] || {}, { worse: WORSE[k] })}</div>`;
  }).join('');
  if (!cells) return '';
  const t = offText(avgs, '平均都在正常范围');
  return card(`夜间体征：${t.warn ? `<span class="warn">${t.text}</span>` : t.text}`, `<div class="vitals">${cells}</div>`, { sub: per.range === 'q' ? '每周平均' : `${per.n} 晚平均` });
}

function day(ctx) {
  const { v, per } = ctx;
  const date = per.to;
  const n = v.nights[date];
  if (!n) return empty(`${nightLabel(date)}没有睡眠记录`);
  const sw = sleepWhy(v, date);
  const durRow = sw?.rows.find((r) => r[0] === '时长');
  let out = card('', nums(num('睡着', durHtml(n.asleep), '', '', durRow?.[2] || ''), sw ? num('睡眠分', sw.total, '', 'sm') : '')
    + (sw ? facts(sw.rows.filter((r) => r !== durRow)) : ''), { cls: 'flat' });
  const short = (n.short || []).length;
  out += card('分期和心率', `<div id="hypno" data-date="${date}">${C.hypnogram(n)}</div>`, { sub: n.hasStages ? (short ? `短暂醒来 ${short} 次` : '') : '这晚只有总时长' });
  if (n.hasStages) {
    const u = usualStages(v, date);
    const rows = C.STAGES.map((s) => [s.name, hmDur(n.byStage[s.key] || 0), u ? `平时 ${hmDur(u[s.key])}` : '']);
    let title = '分期';
    if (u) {
      const diffs = C.STAGES.filter((s) => s.key !== 'AWAKE').map((s) => [s, (n.byStage[s.key] || 0) - u[s.key]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const [s, d] = diffs[0];
      title = Math.abs(d) < 15 ? '分期和平时差不多' : `${sp(s.name)}比平时${d > 0 ? '多' : '少'} ${hmDur(d)}`;
    }
    out += card(title, facts(rows));
  }
  const cells = VITALS.map((k) => {
    const val = v.daily[date]?.[k];
    if (val == null) return '';
    const b = v.base[k]?.[date], bad = isWorse(k, val, b);
    return `<div class="vital"><div class="vk">${METRIC[k].name}</div><div class="vv${bad ? ' warn' : ''}">${unitHtml(k, val)}</div><div class="vn">${rangeText(k, b)}</div>${C.rangeMini(val, b, { worse: WORSE[k] })}</div>`;
  }).join('');
  if (cells) {
    const t = offText(VITALS.map((k) => ({ k, v: v.daily[date]?.[k], b: v.base[k]?.[date] })), '都在正常范围');
    out += card(`夜间体征：${t.warn ? `<span class="warn">${t.text}</span>` : t.text}`, `<div class="vitals">${cells}</div>`);
  }
  const naps = v.naps[date] || [];
  if (naps.length) out += card(`小睡 ${naps.length} 次`, facts(naps.map((x) => [`${hm(new Date(x.start))}–${hm(new Date(x.end))}`, hmDur(x.asleep), ''])));
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
