// 睡眠：睡够没有、规律吗。日 = 一晚的分期；周 = 每晚几点睡、睡多久；月 = 规律；3 个月 = 每周的变化
import { hm, md, parseYmd, mean, nightMin, clockLabel, hmDur, isWeekend, quantile, eveOf, ymd, addDays, wk, esc } from '../util.js';
import * as Dl from '../dial.js';
import * as C from '../charts.js';
import { card, nums, num, durHtml, empty, nightRows, facts, sleepWhy, usualStages, nightLabel, METRIC, unitHtml, rangeText, sp, offText, clockDur } from './common.js';
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

const nightCenter = (v, n, date) => ({ k: '睡着', v: clockDur(n.asleep), n: v.sleepScores[date] ? `睡眠分 ${v.sleepScores[date].total}` : '' });

function day(ctx) {
  const { v, per } = ctx;
  const date = per.to;
  const n = v.nights[date];
  if (!n) return empty(`${nightLabel(date)}没有睡眠记录`);
  const sw = sleepWhy(v, date);
  let out = `<section class="card dialcard"><div class="dialwrap" id="nightdial" data-date="${date}">${Dl.nightDial(n, { center: nightCenter(v, n, date) })}</div></section>`;
  // three numbers: lowest heart rate (filled in once the night's heart rate is read), HRV, time to fall asleep
  const d = v.daily[date] || {}, bh = v.base.hrv?.[date];
  const hrvBad = isWorse('hrv', d.hrv, bh);
  out += `<section class="card flat"><div class="trio">
    <div><div class="k"><i style="background:var(--hr)"></i>最低心率</div><div class="v" id="lowhr">${d.nremHr != null ? `${Math.round(d.nremHr)}<small>bpm</small>` : '—'}</div><div class="n" id="lowhr-n">${d.nremHr != null ? '睡眠心率' : ''}</div></div>
    ${d.hrv != null ? `<div><div class="k"><i style="background:var(--light)"></i>HRV</div><div class="v${hrvBad ? ' warn' : ''}">${Math.round(d.hrv)}<small>ms</small></div><div class="n${hrvBad ? ' warn' : ''}">${rangeText('hrv', bh)}</div></div>` : ''}
    <div><div class="k"><i style="background:var(--text)"></i>入睡用了</div><div class="v">${n.toFallAsleep ?? 0}<small>分钟</small></div><div class="n">${hm(new Date(n.start))} 上床</div></div>
  </div></section>`;
  if (sw) out += card(esc(sw.why), facts(sw.rows));
  if (n.hasStages) {
    const u = usualStages(v, date);
    const mx = Math.max(...C.STAGES.map((s) => Math.max(n.byStage[s.key] || 0, u?.[s.key] || 0))) * 1.08;
    const col = { DEEP: 'var(--deep)', LIGHT: 'var(--light)', REM: 'var(--rem)', AWAKE: 'var(--awake-strong)' };
    const rows = C.STAGES.map((s) => { const m = n.byStage[s.key] || 0, uu = u?.[s.key]; return `<div class="sbar"><span class="k">${s.name}</span><span class="tr"><i style="width:${(m / mx) * 100}%;background:${col[s.key]}"></i>${uu != null ? `<u style="left:${(uu / mx) * 100}%"></u>` : ''}</span><span class="vv">${clockDur(m)}${uu != null ? `<small>平时 ${clockDur(uu)}</small>` : ''}</span></div>`; }).join('');
    let title = '每个阶段';
    if (u) {
      const diffs = C.STAGES.filter((s) => s.key !== 'AWAKE').map((s) => [s, (n.byStage[s.key] || 0) - u[s.key]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const [s0, dd] = diffs[0];
      title = Math.abs(dd) < 15 ? '每个阶段都和平时差不多' : `${sp(s0.name)}比平时${dd > 0 ? '多' : '少'} ${hmDur(dd)}`;
    }
    out += card(title, `<div class="sbars">${rows}</div>`, { sub: u ? '虚线是平时' : '' });
  }
  // the seven nights up to this one, as small watch faces
  const week = Array.from({ length: 7 }, (_, i) => ymd(addDays(parseYmd(date), i - 6)));
  out += card('这一周', `<div class="week7">${week.map((dt) => { const x = v.nights[dt]; const ev = eveOf(dt); return `<div class="d${dt === date ? ' on' : ''}" data-act="night" data-date="${dt}">${Dl.miniNight(x)}<div class="v">${x ? clockDur(x.asleep) : '—'}</div><div class="n">${dt === date ? nightLabel(dt) : '周' + wk(ev)}</div></div>`; }).join('')}</div>`);
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
  const el = root.querySelector('#nightdial');
  const n = el && ctx.v.nights[el.dataset.date];
  if (!n) return;
  try {
    const pts = await hrSeries(n.start - 10 * 60e3, n.end + 10 * 60e3, 120);
    if (!el.isConnected) return;
    el.innerHTML = Dl.nightDial(n, { hr: pts, center: nightCenter(ctx.v, n, el.dataset.date) });
    const inN = pts.filter((p) => p.t >= n.start && p.t <= n.end && p.v != null);
    if (inN.length) {
      const m = inN.reduce((a, p) => (p.v < a.v ? p : a));
      const lv = root.querySelector('#lowhr'), ln = root.querySelector('#lowhr-n');
      if (lv) lv.innerHTML = `${Math.round(m.v)}<small>bpm</small>`;
      if (ln) ln.textContent = `${hm(new Date(m.t))}，红点`;
    }
  } catch (e) { console.warn(e); }
}
