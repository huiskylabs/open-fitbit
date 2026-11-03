// Dependency-free SVG/HTML charts. Every mark carries data-tip (tap for exact values); curves get
// a crosshair layer (press and drag). Colors come from CSS variables so light/dark both work.
//
// One grammar for every chart: a reference line (goal, usual, average) is dashed and named at its
// right end; your normal range is a light grey band; the latest point is drawn in the text color
// with its value; an axis writes its unit on the top tick only ("8 小时", then "6", "4"). Orange
// means one thing: worse than your usual.
import { esc, hm, clockLabel, nightMin, md, wk, clamp, mean, hmDur, parseYmd, ymd, addDays, wd, eveOf, nightName } from './util.js';

export const STAGES = [
  { key: 'DEEP', name: '深睡', color: 'var(--deep)' },
  { key: 'LIGHT', name: '浅睡', color: 'var(--light)' },
  { key: 'REM', name: 'REM', color: 'var(--rem)' },
  { key: 'AWAKE', name: '清醒', color: 'var(--awake)' },
];
const STAGE = Object.fromEntries(STAGES.map((s) => [s.key, s]));
export const stageKey = (t) => ({ ASLEEP: 'LIGHT', RESTLESS: 'AWAKE' })[t] || t;
export const KIND = {
  strength: { name: '力量训练', short: '力量', color: 'var(--strength)' },
  basketball: { name: '篮球', short: '篮球', color: 'var(--ball)' },
  other: { name: '其他', short: '其他', color: 'var(--other)' },
};
export const ZONE_NAME = ['', '轻度', '中等', '高强度', '峰值'];
export const ZONE_COLOR = ['var(--card-2)', 'var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)'];

// ---------- primitives ----------
const r1 = (n) => Math.round(n * 10) / 10;
export const tipAttr = (html) => ` data-tip="${esc(html)}"`;
const svg = (W, H, body, cls = '') => `<svg viewBox="0 0 ${W} ${H}" class="${cls}" role="img">${body}</svg>`;
const T = (x, y, s, cls = 'ax', anchor = 'start', extra = '') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`;
const R = (x, y, w, h, fill, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}" fill="${fill}"${extra}/>`;
const L = (x1, y1, x2, y2, stroke, extra = '') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${stroke}"${extra}/>`;
const C = (cx, cy, r, fill, extra = '') => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"${extra}/>`;
const P = (d, stroke, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}"${extra}/>`;

// rough width of a label, for fitting it (CJK full width, digits and Latin a bit over half)
export const tw = (s, size = 11) => [...String(s)].reduce((a, c) => a + (/[⺀-鿿＀-￯]/.test(c) ? size : c === ' ' ? size * 0.3 : size * 0.6), 0);

export function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// y gridlines with labels on the left; the unit goes on the top tick only
const tickText = (t, ticks, unit) => (unit && t === Math.max(...ticks) ? `${t} ${unit}` : String(t));
const gutter = (ticks, unit) => (ticks.length ? Math.ceil(Math.max(...ticks.map((t) => tw(tickText(t, ticks, unit))))) + 6 : 4);
function yAxis(ticks, y, x0, x1, unit = '') {
  return ticks.map((t) => L(x0, y(t), x1, y(t), 'var(--grid)') + T(0, y(t) + 4, tickText(t, ticks, unit))).join('');
}

// dashed reference line named at its right end (above it, or below when asked)
function refLine(x0, x1, yy, label, below = false) {
  return L(x0, yy, x1, yy, 'var(--ref)', ' stroke-dasharray="4 3" stroke-width="1.2"') + (label ? T(x1, below ? yy + 13 : yy - 5, label, 'ax ref', 'end') : '');
}

// polyline path that breaks across gaps (null values)
function linePath(pts) {
  let d = '', pen = false;
  for (const p of pts) {
    if (p == null || p.y == null || Number.isNaN(p.y)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${r1(p.x)},${r1(p.y)} `;
    pen = true;
  }
  return d.trim();
}
// closed area between upper and lower points (segments break on gaps)
function bandPath(pts) {
  const segs = [];
  let cur = [];
  for (const p of pts) { if (p && p.lo != null && p.hi != null) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  return segs.map((s) => {
    const seg = s.length === 1 ? [{ ...s[0], x: s[0].x - 3 }, { ...s[0], x: s[0].x + 3 }] : s;
    return 'M' + seg.map((p) => `${r1(p.x)},${r1(p.hi)}`).join(' L') + ' L' + [...seg].reverse().map((p) => `${r1(p.x)},${r1(p.lo)}`).join(' L') + ' Z';
  }).join(' ');
}

const worseThan = (v, b, worse) => !!b && v != null && (worse === 'low' ? v < b.lo : worse === 'high' ? v > b.hi : false);

// ---------- crosshair layer ----------
const hovers = new Map();
let hid = 0;
function hoverLayer(points, { x0, x1, top, bottom, color = 'var(--text)' }) {
  const id = 'h' + ++hid;
  hovers.set(id, { points, top, bottom, color });
  if (hovers.size > 300) hovers.delete(hovers.keys().next().value);
  return `<g class="xh" data-for="${id}"></g><rect class="hit" data-hover="${id}" x="${r1(x0)}" y="${r1(top)}" width="${r1(x1 - x0)}" height="${r1(bottom - top)}"/>`;
}
export function hover(el, clientX) {
  const st = hovers.get(el.dataset.hover);
  if (!st || !st.points.length) return null;
  const s = el.ownerSVGElement, box = s.getBoundingClientRect(), vb = s.viewBox.baseVal;
  const vx = ((clientX - box.left) / box.width) * vb.width;
  let best = null, bd = Infinity;
  for (const p of st.points) { const d = Math.abs(p.x - vx); if (d < bd) { bd = d; best = p; } }
  const g = s.querySelector(`.xh[data-for="${el.dataset.hover}"]`);
  if (g) g.innerHTML = L(best.x, st.top, best.x, st.bottom, 'var(--muted)', ' stroke-width="1"') + (best.y != null ? C(best.x, best.y, 4, best.color || st.color, ' stroke="var(--card)" stroke-width="2"') : '');
  return best.html;
}
export const clearHover = () => document.querySelectorAll('.xh').forEach((g) => (g.innerHTML = ''));

// ---------- sleep: one night ----------
// heart rate on top, then one row per stage; rows and the curve are named on the left
export function hypnogram(night, hr = [], { W = 330 } = {}) {
  const Lw = 40, Rw = 4, hrTop = 6, hrH = 42, rowsTop = 70, rowH = 26, H = rowsTop + rowH * 4 + 22;
  const t0 = night.start, t1 = night.end;
  const x = (t) => Lw + ((t - t0) / (t1 - t0)) * (W - Lw - Rw);
  const order = ['AWAKE', 'REM', 'LIGHT', 'DEEP'];
  let g = '';
  order.forEach((k, i) => {
    const y = rowsTop + i * rowH + rowH / 2;
    g += L(Lw, y, W - Rw, y, 'var(--grid)', ' stroke-dasharray="2 4"');
    g += T(0, y + 4, STAGE[k].name, 'lbl');
  });
  const hrIn = hr.filter((p) => p.t >= t0 && p.t <= t1);
  if (hrIn.length > 3) {
    const lo = Math.min(...hrIn.map((p) => p.v)) - 2, hi = Math.max(...hrIn.map((p) => p.v)) + 2;
    const y = (v) => hrTop + (1 - (v - lo) / (hi - lo)) * hrH;
    g += T(0, hrTop + hrH / 2 + 4, '心率', 'lbl');
    g += P(linePath(hrIn.map((p) => ({ x: x(p.t), y: y(p.v) }))), 'var(--hr)', ' stroke-width="1.6" stroke-linejoin="round"');
    const mn = hrIn.reduce((a, p) => (p.v < a.v ? p : a));
    const label = `最低 ${Math.round(mn.v)} bpm`, half = tw(label) / 2;
    g += C(x(mn.t), y(mn.v), 2.6, 'var(--hr)') + T(clamp(x(mn.t), Lw + half, W - Rw - half), y(mn.v) + 14, label, 'ax ref', 'middle');
  }
  let prev = null;
  const rowOf = (t) => order.indexOf(stageKey(t));
  for (const st of night.stages) {
    const i = rowOf(st.type);
    if (i < 0) continue;
    if (prev != null && prev !== i) g += L(x(st.s), rowsTop + prev * rowH + rowH / 2, x(st.s), rowsTop + i * rowH + rowH / 2, 'var(--line)');
    prev = i;
  }
  for (const st of night.stages) {
    const i = rowOf(st.type);
    if (i < 0) continue;
    const k = order[i];
    const tip = `<b>${STAGE[k].name}</b> ${hm(new Date(st.s))}–${hm(new Date(st.e))} · ${hmDur((st.e - st.s) / 60e3)}`;
    g += R(x(st.s), rowsTop + i * rowH + 4, Math.max(1.5, x(st.e) - x(st.s) - 1), rowH - 8, STAGE[k].color, ` rx="3"${tipAttr(tip)}`);
  }
  const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
  for (let t = +first; t < t1; t += 3600e3) {
    const d = new Date(t);
    if (d.getHours() % 2 || x(t) - Lw < 34 || W - Rw - x(t) < 34) continue;
    g += T(x(t), H - 6, `${d.getHours()}:00`, 'ax', 'middle');
  }
  g += T(Lw, H - 6, hm(new Date(t0)), 'lbl', 'start') + T(W - Rw, H - 6, hm(new Date(t1)), 'lbl', 'end');
  return svg(W, H, g);
}

// ---------- sleep: many nights ----------
// One row per night (top → bottom) on a clock axis, named by the evening it began. With stages the
// row is colored by stage; without, asleep is one color and the gaps are when you were awake.
export function barcode(rows, { W = 330, rowH = 18, stages = true, axis = true, label = (r) => wk(eveOf(r.date)) } = {}) {
  const nights = rows.map((r) => r.night).filter(Boolean);
  if (!nights.length) return '';
  const Lw = label ? 24 : 0, Rw = 4, top = axis ? 18 : 0;
  let from = Math.min(...nights.map((n) => nightMin(new Date(n.start)))) - 20;
  let to = Math.max(...nights.map((n) => nightMin(new Date(n.end)))) + 20;
  from = Math.floor(from / 60) * 60; to = Math.ceil(to / 60) * 60;
  const H = top + rows.length * rowH;
  const x = (t) => Lw + ((nightMin(new Date(t)) - from) / (to - from)) * (W - Lw - Rw);
  let g = '';
  if (axis) {
    const step = to - from > 600 ? 120 : 60;
    for (let m = Math.ceil(from / step) * step; m <= to; m += step) {
      const xx = Lw + ((m - from) / (to - from)) * (W - Lw - Rw);
      g += L(xx, top - 4, xx, H, 'var(--grid)') + T(xx, 11, clockLabel(m).replace(/^0(\d):/, '$1:'), 'ax', 'middle');
    }
  }
  const gap = rowH > 12 ? 3 : 1.5;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const lab = label ? label(r, i) : '';
    if (lab) g += T(0, y + rowH / 2 + 4, lab, rowH > 12 ? 'lbl' : 'ax');
    const n = r.night;
    if (!n) return;
    const segs = n.stages.length ? n.stages : [{ type: 'LIGHT', s: n.start, e: n.end }];
    for (const st of segs) {
      const k = stageKey(st.type);
      if (!STAGE[k] || (!stages && k === 'AWAKE')) continue;
      g += R(x(st.s), y + gap, Math.max(1, x(st.e) - x(st.s) - (stages ? 0.6 : 0)), rowH - gap * 2, stages ? STAGE[k].color : 'var(--sleep)', stages && rowH > 12 ? ' rx="2"' : '');
    }
    const tip = `<b>${nightName(r.date)}</b><br>睡了 ${hmDur(n.asleep)} · ${hm(new Date(n.start))}–${hm(new Date(n.end))}`;
    g += R(0, y, W, rowH, 'transparent', ` class="hit" data-act="night" data-date="${r.date}"${tipAttr(tip)}`);
  });
  return svg(W, H, g);
}

// Time asleep per night, one color, against the goal. The month adds a 7-day average line; with
// 30 bars there is no room among them, so both lines are named in a margin on the right.
export function sleepBars(rows, { W = 330, H = 150, goal = 480, avgLine = false, xLabel } = {}) {
  const Lw = 14, B = 18, top = 16, Rw = avgLine ? 48 : 0;
  const max = Math.max(goal + 60, ...rows.map((r) => r.night?.asleep || 0));
  const y = (m) => top + (1 - m / max) * (H - top - B);
  const x1 = W - Rw, step = (x1 - Lw) / rows.length, bw = Math.min(26, step * 0.62);
  let g = '';
  for (const h of [4, 6]) g += L(Lw, y(h * 60), x1, y(h * 60), 'var(--grid)') + T(0, y(h * 60) + 4, String(h));
  rows.forEach((r, i) => {
    const cx = Lw + step * i + step / 2, n = r.night;
    if (n) {
      g += R(cx - bw / 2, y(n.asleep), bw, y(0) - y(n.asleep), 'var(--sleep)', ' rx="2"');
      g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit" data-act="night" data-date="${r.date}"${tipAttr(`<b>${nightName(r.date)}</b><br>睡了 ${hmDur(n.asleep)}`)}`);
    }
    const lab = xLabel ? xLabel(r, i) : wk(eveOf(r.date));
    if (lab) g += T(cx, H - 3, lab, 'ax', 'middle');
  });
  const yg = y(goal);
  if (!avgLine) return svg(W, H, g + refLine(Lw, W, yg, hmDur(goal)));
  const pts = rows.map((r, i) => {
    const win = rows.slice(Math.max(0, i - 6), i + 1).map((x) => x.night?.asleep).filter((v) => v != null);
    return win.length ? { x: Lw + step * i + step / 2, y: y(mean(win)) } : null;
  });
  g += P(linePath(pts), 'var(--text)', ' stroke-width="2" stroke-linejoin="round"');
  g += refLine(Lw, x1, yg, '');
  // the two names sit beside their lines' ends, pushed apart when the lines are close
  const end = pts.filter(Boolean).at(-1);
  let ga = yg + 4, aa = end ? end.y + 4 : null;
  if (aa != null && Math.abs(aa - ga) < 13) { const mid = (aa + ga) / 2, up = end.y < yg; aa = mid + (up ? -6.5 : 6.5); ga = mid + (up ? 6.5 : -6.5); }
  g += T(W, ga, hmDur(goal), 'ax', 'end');
  if (aa != null) g += T(W, aa, '7 天平均', 'ax', 'end');
  return svg(W, H, g);
}

// One point per week on an axis zoomed to the data. The first and last values are written out, each
// on the side of its point away from the line next to it; the dashed average is named in the margin.
export function weekLine(weeks, { W = 330, H = 128, fmt = String, minSpan = 30 } = {}) {
  const pts = weeks.map((w, i) => ({ i, v: w.v, w })).filter((p) => p.v != null);
  if (pts.length < 2) return '';
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  const pad = (hi - lo) * 0.2; lo -= pad; hi += pad;
  const Lx = 6, Rx = 32, top = 18, B = 20;
  const x = (i) => Lx + (i / (weeks.length - 1)) * (W - Lx - Rx);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  const avg = mean(pts.map((p) => p.v)), ya = y(avg);
  let g = refLine(Lx, W - Rx + 4, ya, '') + T(W, ya + 4, '平均', 'ax', 'end');
  g += P(linePath(weeks.map((w, i) => (w.v == null ? null : { x: x(i), y: y(w.v) }))), 'var(--text)', ' stroke-width="1.8" stroke-linejoin="round"');
  for (const p of pts) g += C(x(p.i), y(p.v), 2.6, 'var(--dot)');
  const a = pts[0], a2 = pts[1], b = pts.at(-1), b1 = pts.at(-2);
  g += C(x(b.i), y(b.v), 4, 'var(--text)');
  const above = (p, q) => y(q.v) >= y(p.v); // the neighbor is lower on screen: room above
  g += T(x(a.i), above(a, a2) ? y(a.v) - 8 : y(a.v) + 15, fmt(a.v), 'ax ref', 'start');
  g += T(x(b.i) + 4, above(b, b1) ? y(b.v) - 9 : y(b.v) + 17, fmt(b.v), 'lbl b ref', 'end');
  g += T(Lx, H - 4, weeks[0].short || '', 'ax', 'start') + T(W - Rx, H - 4, weeks.at(-1).short || '', 'ax', 'end');
  const hv = pts.map((p) => ({ x: x(p.i), y: y(p.v), html: `<b>${fmt(p.v)}</b> · ${p.w.label}` }));
  g += hoverLayer(hv, { x0: 0, x1: W, top, bottom: H - B });
  return svg(W, H, g);
}

// ---------- body metrics ----------
// one value against your normal range (grey band); orange only on the worse side
export function rangeMini(v, b, { W = 100, H = 14, worse } = {}) {
  if (v == null) return '';
  const lo = b ? Math.min(b.lo, v) : v - 1, hi = b ? Math.max(b.hi, v) : v + 1;
  const pad = (hi - lo) * 0.35 || 1;
  const x = (u) => 5 + ((u - (lo - pad)) / (hi - lo + 2 * pad)) * (W - 10);
  let g = L(5, H / 2, W - 5, H / 2, 'var(--track)', ' stroke-width="4" stroke-linecap="round"');
  if (b) g += R(x(b.lo), H / 2 - 5, x(b.hi) - x(b.lo), 10, 'var(--band-strong)', ' rx="5"');
  g += C(x(v), H / 2, 5, worseThan(v, b, worse) ? 'var(--worse)' : 'var(--text)');
  return svg(W, H, g, 'mini');
}

// small trend: normal range band + line; worse days and the latest value get a dot
export function sparkBand(series, bands = {}, { W = 100, H = 30, worse } = {}) {
  const pts = series.filter((p) => p.v != null);
  if (pts.length < 2) return '';
  const vals = pts.map((p) => p.v).concat(series.flatMap((p) => (bands[p.date] ? [bands[p.date].lo, bands[p.date].hi] : [])));
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 1;
  const x = (i) => 4 + (i / (series.length - 1)) * (W - 8);
  const y = (v) => 4 + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (H - 8);
  let g = `<path d="${bandPath(series.map((p, i) => (bands[p.date] ? { x: x(i), lo: y(bands[p.date].lo), hi: y(bands[p.date].hi) } : null)))}" fill="var(--band)"/>`;
  g += P(linePath(series.map((p, i) => (p.v == null ? null : { x: x(i), y: y(p.v) }))), 'var(--text-2)', ' stroke-width="1.4" stroke-linejoin="round"');
  const li = series.map((p) => p.v != null).lastIndexOf(true);
  series.forEach((p, i) => {
    const bad = worseThan(p.v, bands[p.date], worse);
    if (bad || i === li) g += C(x(i), y(p.v), i === li ? 3.2 : 2.6, bad ? 'var(--worse)' : 'var(--text)');
  });
  return svg(W, H, g, 'mini');
}

// Daily dots on your normal range (band) with a 7-day average line. A dot turns orange only on the
// worse side; the latest one is drawn in the text color. The latest value and the average line are
// named in a margin on the right, beside the ends they name. `avg`: the average line's values
// (aligned with the series, so it can use days before the first one), or false for none.
export function trendBand(series, bands = {}, { W = 330, H = 156, unit = '', digits = 0, xLabels, worse, minSpan = 0, avg: avgVals = null } = {}) {
  const pts = series.filter((p) => p.v != null);
  if (!pts.length) return '';
  const vals = pts.map((p) => p.v).concat(series.flatMap((p) => (bands[p.date] ? [bands[p.date].lo, bands[p.date].hi] : [])));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const ticks = niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi);
  const fmtV = (v) => (digits ? v.toFixed(digits) : String(Math.round(v)));
  const n = series.length, li = series.map((p) => p.v != null).lastIndexOf(true), lastTxt = fmtV(series[li].v);
  const Lw = gutter(ticks, unit), Rw = avgVals === false ? Math.ceil(tw(lastTxt, 13)) + 12 : 52, top = 16, B = 20, x1 = W - Rw;
  const x = (i) => Lw + (n === 1 ? (x1 - Lw) / 2 : (i / (n - 1)) * (x1 - Lw));
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  let g = yAxis(ticks, y, Lw, x1, unit);
  g += `<path d="${bandPath(series.map((p, i) => (bands[p.date] ? { x: x(i), lo: y(bands[p.date].lo), hi: y(bands[p.date].hi) } : null)))}" fill="var(--band)"/>`;
  const avg = avgVals === false ? [] : series.map((p, i) => {
    if (avgVals) return avgVals[i] == null ? null : { x: x(i), y: y(clamp(avgVals[i], lo, hi)) };
    const w = series.slice(Math.max(0, i - 6), i + 1).map((q) => q.v).filter((v) => v != null);
    return w.length >= 3 ? { x: x(i), y: y(mean(w)) } : null;
  });
  if (avg.length) g += P(linePath(avg), 'var(--text)', ' stroke-width="1.6" stroke-linejoin="round"');
  const rad = n > 60 ? 2 : n > 20 ? 2.6 : 3.4;
  const hv = [];
  series.forEach((p, i) => {
    if (p.v == null) return;
    const b = bands[p.date], bad = worseThan(p.v, b, worse);
    g += C(x(i), y(p.v), bad ? rad + 0.8 : rad, bad ? 'var(--worse)' : i === li ? 'var(--text)' : 'var(--dot)');
    hv.push({ x: x(i), y: y(p.v), color: bad ? 'var(--worse)' : 'var(--text)', html: `<b>${fmtV(p.v)} ${unit}</b> · ${md(parseYmd(p.date))}${b ? `<br><span class="muted">正常 ${fmtV(b.lo)}–${fmtV(b.hi)}</span>` : ''}` });
  });
  const end = avg.filter(Boolean).at(-1), lv = y(series[li].v);
  let ly = lv + 4, ay = end ? end.y + 4 : null;
  if (ay != null && Math.abs(ay - ly) < 14) { const mid = (ay + ly) / 2, up = end.y < lv; ay = mid + (up ? -7 : 7); ly = mid + (up ? 7 : -7); }
  g += T(x1 + 7, clamp(ly, 11, H - B), lastTxt, 'lbl b', 'start');
  if (ay != null) g += T(x1 + 7, clamp(ay, 11, H - B), '7 天平均', 'ax', 'start');
  const labs = xLabels ? xLabels(series) : [];
  for (const [i, s] of labs) g += T(x(i), H - 4, s, 'ax', i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
  g += hoverLayer(hv, { x0: Lw - 4, x1: W, top, bottom: H - B });
  return svg(W, H, g);
}

// ---------- heart: one day ----------
// Heart rate from midnight (to now, for today). Under the curve, one strip says what you were
// doing: asleep, or a workout. The dashed line is your resting heart rate.
export function dayCurve(points, { start, end, sleeps = [], workouts = [], rest, now, W = 330, H = 206 } = {}) {
  const today = now && now > start && now < end;
  const stop = today ? Math.max(now, start + 3 * 3600e3) : end;
  const pts = points.filter((p) => p.t >= start && p.t <= stop);
  const lo = 40, hi = Math.max(110, Math.max(...pts.map((p) => p.hi || p.v)) + 8);
  const ticks = [60, 90, 120, 150, 180].filter((v) => v < hi - 4);
  const Lw = gutter(ticks, 'bpm'), Rw = 4, top = 8, bottom = H - 50;
  const x = (t) => Lw + ((t - start) / (stop - start)) * (W - Lw - Rw);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bottom - top);
  let g = yAxis(ticks, y, Lw, W - Rw, 'bpm');
  const gapMs = 20 * 60e3, withGaps = [];
  pts.forEach((p, i) => { if (i && p.t - pts[i - 1].t > gapMs) withGaps.push(null); withGaps.push(p); });
  g += `<path d="${bandPath(withGaps.map((p) => (p ? { x: x(p.t), lo: y(p.lo ?? p.v), hi: y(p.hi ?? p.v) } : null)))}" fill="var(--hr)" opacity=".16"/>`;
  g += P(linePath(withGaps.map((p) => (p ? { x: x(p.t), y: y(p.v) } : null))), 'var(--hr)', ' stroke-width="1.6" stroke-linejoin="round"');
  if (rest) g += refLine(Lw, W - Rw, y(rest), `静息 ${rest}`, true);
  g += L(Lw, bottom, W - Rw, bottom, 'var(--line)');
  const sy = bottom + 7;
  const strip = (a, b, color, name, tip, extra = '') => {
    a = Math.max(start, a); b = Math.min(stop, b);
    if (b <= a) return '';
    const w = Math.max(4, x(b) - x(a));
    return R(x(a), sy, w, 8, color, ` rx="3"${extra}${tipAttr(tip)}`) + (w > tw(name) + 6 ? T(x(a) + w / 2, sy + 21, name, 'ax', 'middle') : '');
  };
  for (const s of sleeps) g += strip(s.start, s.end, 'var(--sleep)', '睡眠', `<b>睡眠</b> ${hm(new Date(s.start))}–${hm(new Date(s.end))}`);
  for (const w of workouts) g += strip(w.start, w.end, KIND[w.kind]?.color || 'var(--other)', KIND[w.kind]?.short || '运动', `<b>${KIND[w.kind]?.name || '运动'}</b> ${hm(new Date(w.start))}–${hm(new Date(w.end))}`, ` data-act="workout" data-id="${esc(w.id)}"`);
  for (let h = 0; h < 24; h += 3) {
    const t = start + h * 3600e3;
    if (t > stop - 75 * 60e3) break;
    g += T(x(t), H - 3, String(h), 'ax', h ? 'middle' : 'start');
  }
  g += T(W - Rw, H - 3, today ? '现在' : '24', 'ax', 'end');
  const hv = pts.map((p) => ({ x: x(p.t), y: y(p.v), html: `<b>${Math.round(p.v)} bpm</b> · ${hm(new Date(p.t))}${p.lo != null ? `<br><span class="muted">${Math.round(p.lo)}–${Math.round(p.hi)} bpm</span>` : ''}` }));
  g += hoverLayer(hv, { x0: Lw, x1: W - Rw, top, bottom, color: 'var(--hr)' });
  return svg(W, H, g);
}

// minutes per heart-rate zone as labeled rows, hardest first
export function zoneRows(min, { order = [4, 3, 2, 1] } = {}) {
  const keys = { 1: 'light', 2: 'moderate', 3: 'vigorous', 4: 'peak' };
  const max = Math.max(1, ...order.map((z) => min[keys[z]] || 0));
  return `<div class="hbars">${order.map((z) => {
    const v = Math.round(min[keys[z]] || 0);
    return `<div class="hb"><span class="k">${ZONE_NAME[z]}</span><span class="bar"><i style="width:${(v / max) * 100}%;background:${ZONE_COLOR[z]}"></i></span><span class="v">${v} 分钟</span></div>`;
  }).join('')}</div>`;
}

// minutes at moderate or harder, per day; the dashed line is your usual, named in the right margin
export function zoneBars(days, { W = 330, H = 140, avg, xLabels } = {}) {
  const tot = (d) => (d.z ? d.z.moderate + d.z.vigorous + d.z.peak : 0);
  const max = Math.max(30, avg || 0, ...days.map(tot)) * 1.15;
  const ticks = niceTicks(0, max, 3).filter((t) => t > 0 && t <= max);
  const Lw = gutter(ticks, '分钟'), Rw = avg ? 32 : 0, top = 14, B = 20, x1 = W - Rw;
  const y = (v) => top + (1 - v / max) * (H - top - B);
  const n = days.length, step = (x1 - Lw) / n, bw = Math.min(26, step * 0.62);
  let g = yAxis(ticks, y, Lw, x1, '分钟') + L(Lw, y(0), x1, y(0), 'var(--line)');
  days.forEach((d, i) => {
    if (!d.z) return;
    const cx = Lw + step * i + step / 2, v = tot(d);
    if (v > 0) g += R(cx - bw / 2, y(v), bw, y(0) - y(v), 'var(--z3)', ' rx="2"');
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${md(parseYmd(d.date))}</b> ${Math.round(v)} 分钟<br>中等 ${Math.round(d.z.moderate)} · 高强度 ${Math.round(d.z.vigorous)} · 峰值 ${Math.round(d.z.peak)}`)}`);
  });
  if (avg) g += refLine(Lw, x1 + 4, y(avg), '') + T(W, y(avg) + 4, '平时', 'ax', 'end');
  const labs = xLabels ? xLabels(days) : [];
  for (const [i, s] of labs) g += T(Lw + step * i + step / 2, H - 4, s, 'ax', i === 0 && n > 7 ? 'start' : i === n - 1 && n > 7 ? 'end' : 'middle');
  return svg(W, H, g);
}

// ---------- workouts ----------
export function hrMini(points, { W = 120, H = 30, start, end, peaks = [], stroke = 'var(--hr)' } = {}) {
  if (points.length < 2) return '';
  const a = start ?? points[0].t, b = end ?? points.at(-1).t;
  const lo = Math.min(...points.map((p) => p.v)) - 3, hi = Math.max(...points.map((p) => p.v)) + 3;
  const x = (t) => 2 + ((t - a) / (b - a || 1)) * (W - 4);
  const y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (H - 6);
  let g = P(linePath(points.map((p) => ({ x: x(p.t), y: y(p.v) }))), stroke, ' stroke-width="1.5" stroke-linejoin="round"');
  for (const p of peaks) g += C(x(p.t), y(p.v), 3.2, 'var(--text)');
  return svg(W, H, g, 'mini');
}

// per-minute heart rate, a bar per minute colored by zone; zone edges are dashed and named on the right
export function hrBarcode(points, zones, { W = 330, H = 150, zoneOf } = {}) {
  if (!points.length) return '';
  const lo = Math.max(40, Math.min(...points.map((p) => p.v)) - 10), hi = Math.max(...points.map((p) => p.v)) + 8;
  const ticks = niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi);
  const Lw = gutter(ticks, 'bpm'), Rw = 2, top = 8, B = 18;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  const step = (W - Lw - Rw) / points.length;
  let g = yAxis(ticks, y, Lw, W - Rw, 'bpm');
  points.forEach((p, i) => {
    const z = zoneOf(p.v, zones);
    g += R(Lw + i * step, y(p.v), Math.max(0.8, step - 0.6), y(lo) - y(p.v), ZONE_COLOR[Math.max(1, z)]);
  });
  for (const [z, k] of [[2, 'MODERATE'], [3, 'VIGOROUS'], [4, 'PEAK']]) {
    const v = zones[k]?.[0];
    if (v != null && v > lo && v < hi) g += refLine(Lw, W - Rw, y(v), ZONE_NAME[z]);
  }
  const t0 = points[0].t, t1 = points.at(-1).t;
  g += T(Lw, H - 3, hm(new Date(t0)), 'ax') + T(Lw + (W - Lw) / 2, H - 3, hm(new Date((t0 + t1) / 2)), 'ax', 'middle') + T(W, H - 3, hm(new Date(t1 + 60e3)), 'ax', 'end');
  const hv = points.map((p, i) => ({ x: Lw + i * step + step / 2, y: y(p.v), html: `<b>${Math.round(p.v)} bpm</b> · ${hm(new Date(p.t))}` }));
  g += hoverLayer(hv, { x0: Lw, x1: W, top, bottom: H - B, color: 'var(--hr)' });
  return svg(W, H, g);
}

export function hbars(rows, { fmt = (v) => v } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return `<div class="hbars">${rows.map((r) => `<div class="hb"${r.tip ? tipAttr(r.tip) : ''}><span class="k">${esc(r.k)}</span><span class="bar"><i style="width:${(r.v / max) * 100}%;background:${r.color}"></i></span><span class="v">${esc(fmt(r.v))}</span></div>`).join('')}</div>`;
}

// month calendar: the date in every cell, a dot per workout (color = type)
export function workoutCal({ start, end, byDate, todayKey }) {
  const s = addDays(start, -wd(start));
  let html = `<div class="cal">${'一二三四五六日'.split('').map((c) => `<div class="cal-h">${c}</div>`).join('')}`;
  for (let d = s; ; d = addDays(d, 1)) {
    const key = ymd(d), inRange = d >= start && d <= end;
    const items = inRange ? byDate[key] || [] : [];
    const dn = d.getDate() === 1 ? `${d.getMonth() + 1}月` : String(d.getDate());
    html += `<div class="cal-c${inRange ? '' : ' off'}${key === todayKey ? ' today' : ''}">${inRange ? `<span class="dn">${dn}</span>` : ''}<span class="dots">${items.map((w) =>
      `<i class="dot" style="background:${KIND[w.kind].color}" data-act="workout" data-id="${esc(w.id)}"${tipAttr(`<b>${KIND[w.kind].name}</b> ${md(d)} · ${hmDur(w.min)}`)}></i>`).join('')}</span></div>`;
    if (d >= end && wd(d) === 6) break;
  }
  return html + '</div>';
}

// hours per week stacked by type (the colors are named in the summary above the chart)
export function weeklyHours(weeks, { W = 330, H = 160 } = {}) {
  const tot = (w) => w.strength + w.basketball + w.other;
  const max = Math.max(2, ...weeks.map(tot)) * 1.12;
  const ticks = niceTicks(0, max, 3).filter((t) => t > 0 && t <= max);
  const Lw = gutter(ticks, '小时'), top = 12, B = 20;
  const y = (v) => top + (1 - v / max) * (H - top - B);
  const step = (W - Lw) / weeks.length, bw = Math.min(18, step * 0.6);
  let g = yAxis(ticks, y, Lw, W, '小时') + L(Lw, y(0), W, y(0), 'var(--line)');
  weeks.forEach((w, i) => {
    const cx = Lw + step * i + step / 2;
    let acc = 0;
    for (const k of ['strength', 'basketball', 'other']) {
      const v = w[k];
      if (!v) continue;
      g += R(cx - bw / 2, y(acc + v), bw, y(acc) - y(acc + v) - 0.8, KIND[k].color);
      acc += v;
    }
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${w.label}</b> ${hmDur(tot(w) * 60)}<br>力量 ${hmDur(w.strength * 60)} · 篮球 ${hmDur(w.basketball * 60)} · 其他 ${hmDur(w.other * 60)}`)}`);
  });
  g += T(Lw, H - 4, `${weeks.length - 1} 周前`, 'ax', 'start') + T(W, H - 4, '近 7 天', 'ax', 'end');
  return svg(W, H, g);
}

export function vo2(points, { W = 330, H = 124 } = {}) {
  if (!points.length) return '';
  let lo = Math.min(...points.map((p) => p.v)), hi = Math.max(...points.map((p) => p.v));
  if (hi - lo < 2) { const c = (hi + lo) / 2; lo = c - 1; hi = c + 1; }
  lo -= 0.5; hi += 0.5;
  const ticks = niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi);
  const Lw = gutter(ticks, ''), Rw = 8, top = 16, B = 20;
  const t0 = points[0].t, t1 = points.at(-1).t;
  const x = (t) => Lw + ((t - t0) / (t1 - t0 || 1)) * (W - Lw - Rw);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  let g = yAxis(ticks, y, Lw, W - Rw);
  g += P(linePath(points.map((p) => ({ x: x(p.t), y: y(p.v) }))), 'var(--text)', ' stroke-width="1.6" stroke-linejoin="round"');
  for (const p of points) g += C(x(p.t), y(p.v), 2.6, 'var(--dot)');
  const first = points[0], last = points.at(-1);
  g += C(x(last.t), y(last.v), 4, 'var(--text)');
  if (points.length > 1) g += T(x(first.t), y(first.v) - 8, first.v.toFixed(1), 'ax ref', 'start');
  g += T(x(last.t) + 4, y(last.v) - 9, last.v.toFixed(1), 'lbl b ref', 'end');
  g += T(Lw, H - 4, md(new Date(t0)), 'ax') + T(W - Rw, H - 4, md(new Date(t1)), 'ax', 'end');
  const hv = points.map((p) => ({ x: x(p.t), y: y(p.v), html: `<b>${p.v.toFixed(1)}</b> · ${md(new Date(p.t))}${p.levelName ? ` · ${p.levelName}` : ''}` }));
  g += hoverLayer(hv, { x0: Lw, x1: W, top, bottom: H - B });
  return svg(W, H, g);
}

// ---------- small things ----------
// a value on a bar, with a dashed mark for your usual (filled in later when it needs a request)
export function progressBar(v, { max, mark = null, markLabel = '' } = {}) {
  const pct = (u) => clamp((u / max) * 100, 0, 100);
  return `<div class="pbar"><span class="track"><i style="width:${pct(v || 0)}%"></i></span><span class="mark"${mark == null ? ' hidden' : ''} style="left:${mark == null ? 0 : pct(mark)}%"><em>${esc(markLabel)}</em></span></div>`;
}
