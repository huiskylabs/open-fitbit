// Shared bits for the pages: periods, cards, number blocks, merged workout list, and the sentences
// that say why a score is what it is.
import { ymd, parseYmd, addDays, today, md, wk, hm, esc, hmDur, mean, dayDiff, eveOf, fmt1, signed } from '../util.js';
import * as tr from '../training.js';
import { zoneOf, isWorse, WORSE } from '../scores.js';
import { KIND } from '../charts.js';

export const RANGES = [['d', '日'], ['w', '周'], ['m', '月'], ['q', '3个月']];
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
  else label = `${md(start)}–${md(end)}`;
  return { range, offset, start, end, n, days, label, from: days[0], to: days.at(-1) };
}
// a night is named by the evening it began: "昨晚", "11月1日晚"
export const nightLabel = (date) => (dayDiff(today(), parseYmd(date)) === 0 ? '昨晚' : `${md(eveOf(date))}晚`);

// title = the card's answer; sub = a short fact on the right; lead = one line under the title
export const card = (title, body, { sub = '', cls = '', act = '', right = '', lead = '' } = {}) =>
  `<section class="card ${cls}"${act}>${title ? `<h2><span>${title}</span>${right || (sub ? `<span class="sub">${sub}</span>` : '')}</h2>` : ''}${lead ? `<p class="lead">${lead}</p>` : ''}${body}</section>`;

export const num = (k, v, unit = '', cls = '', note = '') => `<div class="num ${cls}"><div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
export const nums = (...items) => `<div class="nums">${items.join('')}</div>`;
// 452 → 7<small>小时</small>32<small>分钟</small>
export const durHtml = (min) => {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}<small>小时</small>${m ? `${m}<small>分钟</small>` : ''}` : `${m}<small>分钟</small>`;
};
export const empty = (s = '这段时间没有数据') => `<div class="empty">${s}</div>`;

// rows of [label, value, note] in aligned columns
export const facts = (rows) => `<div class="facts">${rows.filter(Boolean).map(([k, v, n = '']) => `<div><span class="k">${k}</span><b>${v}</b><span class="n">${n}</span></div>`).join('')}</div>`;

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

// "● 力量 3 次 · ● 篮球 2 次": the count of each type, its dot names the color used in the charts below
export function kindsLine(list) {
  const parts = ['strength', 'basketball', 'other'].map((k) => [k, list.filter((w) => w.kind === k).length]).filter(([, n]) => n);
  return parts.length ? `<div class="kinds">${parts.map(([k, n]) => `<span><i style="background:${KIND[k].color}"></i>${KIND[k].short} ${n} 次</span>`).join('')}</div>` : '';
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

// usual whole-day minutes at moderate or harder: the 30 days before `date`
export function zoneAvg(v, date) {
  const vals = [];
  for (let i = 1; i <= 30; i++) { const z = v.daily[ymd(addDays(parseYmd(date), -i))]?.zoneSec; if (z) vals.push(activeZoneMin(z)); }
  return vals.length >= 5 ? mean(vals) : null;
}

export const dayName = (date) => {
  const d = parseYmd(date), diff = dayDiff(today(), d);
  return diff === 0 ? '今天' : diff === 1 ? '昨天' : `${md(d)} 周${wk(d)}`;
};

// ---------- why a score is what it is ----------
const later = (dev, what) => (Math.abs(dev) < 15 ? null : `${what}比平时${dev > 0 ? '晚' : '早'} ${hmDur(dev)}`);

// average minutes per stage over the 30 nights before `date` (nights with stages, at least 5)
export function usualStages(v, date) {
  const prev = [];
  for (let i = 1; i <= 30; i++) { const p = v.nights[ymd(addDays(parseYmd(date), -i))]; if (p?.hasStages) prev.push(p); }
  if (prev.length < 5) return null;
  return Object.fromEntries(['DEEP', 'LIGHT', 'REM', 'AWAKE'].map((k) => [k, mean(prev.map((p) => p.byStage[k] || 0))]));
}

// The three parts of the sleep score, each as a fact with a number, plus one line that names the
// part that cost the most points.
export function sleepWhy(v, date) {
  const n = v.nights[date], sc = v.sleepScores[date];
  if (!n || !sc) return null;
  const goal = v.goalMin, short = goal - n.asleep;
  const rows = [['时长', hmDur(n.asleep), short > 0 ? `目标 ${hmDur(goal)}` : '睡够了']];
  const bedTxt = sc.bedDev != null ? later(sc.bedDev, '上床') : null, wakeTxt = sc.wakeDev != null ? later(sc.wakeDev, '起床') : null;
  if (sc.reg != null) rows.push(['作息', `${hm(new Date(n.start))}–${hm(new Date(n.end))}`, [bedTxt, wakeTxt].filter(Boolean).join('，') || '和平时差不多']);
  let stageTxt = null;
  if (n.hasStages) {
    const dr = (n.byStage.DEEP || 0) + (n.byStage.REM || 0);
    const u = usualStages(v, date), ud = u ? u.DEEP + u.REM : null;
    rows.push(['深睡 + REM', hmDur(dr), ud != null ? `平时 ${hmDur(ud)}` : '']);
    if (ud != null && ud - dr >= 15) stageTxt = `深睡 + REM 比平时少 ${hmDur(ud - dr)}`;
    else stageTxt = `深睡 + REM 只有 ${hmDur(dr)}`;
  }
  const loss = [['dur', (1 - sc.dur) * 50], ['reg', sc.reg == null ? 0 : (1 - sc.reg) * 25], ['stage', sc.stage == null ? 0 : (1 - sc.stage) * 25]].sort((a, b) => b[1] - a[1])[0];
  let why;
  if (loss[1] < 4) why = short > 0 ? `只比 ${hmDur(goal)}少 ${hmDur(short)}` : `睡够了 ${hmDur(goal)}`;
  else if (loss[0] === 'dur') why = `比 ${hmDur(goal)}少 ${hmDur(short)}`;
  else if (loss[0] === 'reg') why = (Math.abs(sc.bedDev) >= Math.abs(sc.wakeDev) ? bedTxt || wakeTxt : wakeTxt || bedTxt) || '作息和平时差不多';
  else why = stageTxt;
  return { why, rows, total: sc.total };
}

// body metrics: names, units, number format
export const METRIC = {
  rhr: { name: '静息心率', unit: 'bpm', fmt: (x) => String(Math.round(x)) },
  hrv: { name: 'HRV', unit: 'ms', fmt: (x) => String(Math.round(x)) },
  nremHr: { name: '睡眠心率', unit: 'bpm', fmt: (x) => String(Math.round(x)) },
  resp: { name: '呼吸率', unit: '次/分', fmt: fmt1 },
  spo2: { name: '血氧', unit: '%', fmt: (x) => String(Math.round(x)) },
  skinRel: { name: '皮温', unit: '°C', fmt: (x) => signed(x, 1) },
};
export const withUnit = (k, x) => `${METRIC[k].fmt(x)} ${METRIC[k].unit}`;
// the same, with the unit set smaller (for big numbers)
export const unitHtml = (k, x) => `${METRIC[k].fmt(x)}<small>${METRIC[k].unit}</small>`;
// "正常 58–62"; with a minus sign in it, "正常 −0.4 至 +0.4" (a dash next to a minus reads as one)
export const rangeText = (k, b) => (b ? `正常 ${METRIC[k].fmt(b.lo)}${b.lo < 0 ? ' 至 ' : '–'}${METRIC[k].fmt(b.hi)}` : '');
// a space between a Latin word and the Chinese after it: "HRV 偏低"
export const sp = (name) => (/[A-Za-z0-9]$/.test(name) ? `${name} ` : name);
// "呼吸率比平时高 1.3 次/分", against the 30-day average
export const vsUsual = (k, x, b) => {
  const d = x - b.mean, m = METRIC[k];
  const amt = k === 'skinRel' ? `${Math.abs(d).toFixed(1)} °C` : `${k === 'resp' ? Math.abs(d).toFixed(1) : Math.round(Math.abs(d))} ${m.unit}`;
  return `${sp(m.name)}比平时${d > 0 ? '高' : '低'} ${amt}`;
};

// What a title says about some values against their normal ranges ([{ k, v, b }]): the ones on the
// worse side ("呼吸率偏高、HRV 偏低", in orange); else the ones out on the good side, plainly
// ("HRV 比平时高"); else `fine`.
export function offText(items, fine) {
  const worse = items.filter(({ k, v, b }) => isWorse(k, v, b));
  if (worse.length) return { text: worse.map(({ k }) => `${sp(METRIC[k].name)}偏${WORSE[k] === 'low' ? '低' : '高'}`).join('、'), warn: true };
  const good = items.filter(({ v, b }) => v != null && b && (v < b.lo || v > b.hi));
  if (good.length) return { text: good.map(({ k, v, b }) => `${sp(METRIC[k].name)}比平时${v > b.hi ? '高' : '低'}`).join('、') };
  return { text: fine };
}
// Days of a metric against their ranges: "3 天偏高"; "一天都没偏高" when some were out on the good side only.
export function daysOff(k, series, bands) {
  const dir = WORSE[k] === 'low' ? '低' : '高';
  const bad = series.filter((p) => isWorse(k, p.v, bands[p.date])).length;
  const out = series.filter((p) => p.v != null && bands[p.date] && (p.v < bands[p.date].lo || p.v > bands[p.date].hi)).length;
  return bad ? `${bad} 天偏${dir}` : out ? `一天都没偏${dir}` : '都在正常范围';
}

// One line for the recovery score: what is worse than usual first, then what is better.
export function recoveryWhy(v, date) {
  const r = v.recovery[date];
  if (!r) return null;
  const d = v.daily[date] || {}, b = (k) => v.base[k]?.[date];
  for (const k of ['resp', 'skinRel', 'rhr', 'hrv']) if (isWorse(k, d[k], b(k))) return { why: vsUsual(k, d[k], b(k)), warn: true };
  if (d.hrv != null && b('hrv') && d.hrv > b('hrv').hi) return { why: vsUsual('hrv', d.hrv, b('hrv')) };
  if (d.rhr != null && b('rhr') && d.rhr < b('rhr').lo) return { why: vsUsual('rhr', d.rhr, b('rhr')) };
  if (r.parts.sleep != null && r.parts.sleep < 0.7) return { why: '昨晚没睡好' };
  return { why: '各项都在正常范围' };
}

// 7:03 — a duration read like a watch, used inside dials and on chips
export const clockDur = (min) => { min = Math.round(min || 0); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; };
// the short name on a dial or a calendar day: 力量 / 篮球 / 步行…
export const shortKind = (w) => (w.kind === 'strength' ? '力量' : kindLabel(w));
// lifts as "卧推  8 · 8 · 8 · 6  70 kg"
export function lifts2(items) {
  return `<div class="lifts2">${items.map((it) => {
    const lf = tr.lift(it.lift), reps = it.sets.map((s) => s.reps).join(' · ');
    const kg = [...new Set(it.sets.map((s) => (lf.bodyweight ? s.add || 0 : s.kg || 0)))];
    const unit = lf.bodyweight ? (kg.some(Boolean) ? `次 · +${kg.join('/')} kg` : '次') : `${kg.join('/')} kg`;
    return `<div class="lift2"><b>${esc(lf.name)}</b><span class="sets">${reps}<small>${unit}</small></span><span class="n"></span></div>`;
  }).join('')}</div>`;
}
// one workout in a list: a colored disc with its name, when, the key numbers, minutes
const KCOL = { strength: 'var(--strength)', basketball: 'var(--ball)', other: 'var(--other)' };
export function recRow(w, { withDay = false } = {}) {
  const d = new Date(w.start), mins = Math.round(w.activeSec / 60);
  let detail = w.avgHr ? `平均 ${w.avgHr} bpm` : '';
  if (w.kind === 'strength' && w.sessionId) {
    const s = tr.get().sessions.find((x) => x.id === w.sessionId);
    if (s) detail = s.items.map((it) => `${tr.lift(it.lift).name} ${tr.setsLabel(it.lift, it.sets)}`).join('　');
  }
  const when = withDay ? `${dayName(ymd(d))} ${hm(d)}` : `${hm(d)}–${hm(new Date(w.end))}`;
  const act = w.sessionId && w.src === 'app' ? 'session' : 'workout', id = w.sessionId && w.src === 'app' ? w.sessionId : w.id;
  return `<button class="rec" data-act="${act}" data-id="${esc(id)}"><span class="dot" style="background:${KCOL[w.kind] || KCOL.other}">${esc(shortKind(w))}</span><span><span class="t" style="display:block">${when}</span><span class="s" style="display:block">${esc(detail)}</span></span><span class="r">${mins}<small>分钟</small></span></button>`;
}

export { esc, hmDur };
