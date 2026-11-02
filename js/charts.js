// Dependency-free SVG/HTML charts. Every mark carries data-tip (tap for exact values); curves get
// a crosshair layer (press and drag). Colors come from CSS variables so light/dark both work.
import { esc, hm, clockLabel, nightMin, md, wk, clamp, mean, hmDur, fmtInt, parseYmd, ymd, addDays, isWeekend, wd } from './util.js';

export const STAGES = [
  { key: 'DEEP', name: '深睡', color: 'var(--deep)' },
  { key: 'LIGHT', name: '浅睡', color: 'var(--light)' },
  { key: 'REM', name: 'REM', color: 'var(--rem)' },
  { key: 'AWAKE', name: '清醒', color: 'var(--awake)' },
];
const STAGE = Object.fromEntries(STAGES.map((s) => [s.key, s]));
export const stageKey = (t) => ({ ASLEEP: 'LIGHT', RESTLESS: 'AWAKE' })[t] || t;
export const KIND = {
  strength: { name: '力量训练', color: 'var(--c-blue)' },
  basketball: { name: '篮球', color: 'var(--c-magenta)' },
  other: { name: '其他', color: 'var(--c-grey)' },
};
export const ZONE_NAME = ['', '轻度', '燃脂', '有氧', '峰值'];
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
const tri = (x, y, s, fill) => `<path d="M${r1(x - s)},${r1(y - s)} L${r1(x + s)},${r1(y - s)} L${r1(x)},${r1(y + s * 0.6)} Z" fill="${fill}"/>`;

export function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
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

// ---------- score ring ----------
export function ring(score, { size = 92, color = 'var(--c-blue)' } = {}) {
  const r = size / 2 - 8, c = 2 * Math.PI * r, v = clamp(score ?? 0, 0, 100) / 100;
  return `<svg viewBox="0 0 ${size} ${size}" class="ring" role="img" aria-label="${score ?? ''}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="9"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${r1(c * v)} ${r1(c)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="${size / 2}" y="${size / 2 + 10}" text-anchor="middle" class="ring-n">${score ?? '–'}</text></svg>`;
}

// ---------- sleep: one night ----------
export function hypnogram(night, hr = [], { W = 330 } = {}) {
  const Lw = 40, Rw = 4, hrTop = 6, hrH = 44, tickY = 60, rowsTop = 72, rowH = 26, H = rowsTop + rowH * 4 + 24;
  const t0 = night.start, t1 = night.end;
  const x = (t) => Lw + ((t - t0) / (t1 - t0)) * (W - Lw - Rw);
  const order = ['AWAKE', 'REM', 'LIGHT', 'DEEP'];
  let g = '';
  order.forEach((k, i) => {
    const y = rowsTop + i * rowH + rowH / 2;
    g += L(Lw, y, W - Rw, y, 'var(--grid)', ' stroke-dasharray="2 4"');
    g += T(0, y + 4, STAGE[k].name, 'lbl');
  });
  // heart rate during the night
  const hrIn = hr.filter((p) => p.t >= t0 && p.t <= t1);
  if (hrIn.length > 3) {
    const lo = Math.min(...hrIn.map((p) => p.v)) - 2, hi = Math.max(...hrIn.map((p) => p.v)) + 2;
    const y = (v) => hrTop + (1 - (v - lo) / (hi - lo)) * hrH;
    g += P(linePath(hrIn.map((p) => ({ x: x(p.t), y: y(p.v) }))), 'var(--c-red)', ' stroke-width="1.6" stroke-linejoin="round"');
    const mn = hrIn.reduce((a, p) => (p.v < a.v ? p : a));
    g += T(x(mn.t), y(mn.v) + 12, `${Math.round(mn.v)}`, 'ax', 'middle');
  }
  // short awakenings
  for (const s of night.short || []) g += L(x(s.s), tickY - 4, x(s.s), tickY + 3, 'var(--awake)', ' stroke-width="2" stroke-linecap="round"');
  // stage transitions + blocks
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
    const tip = `<b>${STAGE[k].name}</b> ${hm(new Date(st.s))}–${hm(new Date(st.e))} · ${Math.round((st.e - st.s) / 60e3)} 分钟`;
    g += R(x(st.s), rowsTop + i * rowH + 4, Math.max(1.5, x(st.e) - x(st.s) - 1), rowH - 8, STAGE[k].color, ` rx="3"${tipAttr(tip)}`);
  }
  // time axis
  const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
  for (let t = +first; t < t1; t += 3600e3) {
    const d = new Date(t);
    if (d.getHours() % 2 || x(t) - Lw < 34 || W - Rw - x(t) < 34) continue;
    g += T(x(t), H - 6, `${d.getHours()}:00`, 'ax', 'middle');
  }
  g += T(Lw, H - 6, hm(new Date(t0)), 'lbl', 'start') + T(W - Rw, H - 6, hm(new Date(t1)), 'lbl', 'end');
  return svg(W, H, g);
}

// composition bar with ▼ = your 30-day average boundaries
export function stageBar(byStage, avg, { W = 330 } = {}) {
  const keys = ['DEEP', 'LIGHT', 'REM', 'AWAKE'];
  const total = keys.reduce((a, k) => a + (byStage[k] || 0), 0) || 1;
  const H = 30, y = 12, h = 16;
  let g = '', x = 0;
  for (const k of keys) {
    const w = ((byStage[k] || 0) / total) * W;
    if (w > 0) g += R(x, y, Math.max(0, w - 1.5), h, STAGE[k].color, tipAttr(`<b>${STAGE[k].name}</b> ${hmDur(byStage[k])} · ${Math.round(((byStage[k] || 0) / total) * 100)}%`));
    x += w;
  }
  if (avg) {
    const at = (byStage.ASLEEP && !byStage.DEEP) ? null : avg;
    if (at) {
      let acc = 0;
      const atot = keys.reduce((a, k) => a + (at[k] || 0), 0) || 1;
      for (const k of keys.slice(0, 3)) { acc += at[k] || 0; g += tri((acc / atot) * W, 5, 4.5, 'var(--text)'); }
    }
  }
  return svg(W, H, g);
}
export function stageLegend(byStage) {
  return `<div class="legend">${STAGES.map((s) => `<span><i style="background:${s.color}"></i>${s.name} <b>${hmDur(byStage[s.key] || (s.key === 'LIGHT' ? byStage.ASLEEP : 0) || 0)}</b></span>`).join('')}</div>`;
}

// ---------- sleep: many nights ----------
// rows: [{date, night}] top → bottom. Each night drawn on a clock axis, colored by stage.
export function barcode(rows, { W = 330, rowH = 18, label = (r) => wk(parseYmd(r.date)) } = {}) {
  const nights = rows.map((r) => r.night).filter(Boolean);
  if (!nights.length) return '';
  const Lw = 24, Rw = 4, top = 18;
  let from = Math.min(...nights.map((n) => nightMin(new Date(n.start)))) - 20;
  let to = Math.max(...nights.map((n) => nightMin(new Date(n.end)))) + 20;
  from = Math.floor(from / 60) * 60; to = Math.ceil(to / 60) * 60;
  const H = top + rows.length * rowH + 4;
  const x = (t) => Lw + ((nightMin(new Date(t)) - from) / (to - from)) * (W - Lw - Rw);
  let g = '';
  const step = to - from > 600 ? 120 : 60;
  for (let m = Math.ceil(from / step) * step; m <= to; m += step) {
    const xx = Lw + ((m - from) / (to - from)) * (W - Lw - Rw);
    g += L(xx, top - 4, xx, H, 'var(--grid)') + T(xx, 11, clockLabel(m).replace(/^0(\d):/, '$1:'), 'ax', 'middle');
  }
  const gap = rowH > 12 ? 3 : 1.5;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const d = parseYmd(r.date);
    if (isWeekend(d)) g += R(0, y, W, rowH, 'var(--shade)', ' rx="4"');
    const lab = label(r, i);
    if (lab) g += T(4, y + rowH / 2 + 4, lab, rowH > 12 ? 'lbl' : 'ax');
    const n = r.night;
    if (!n) return;
    const segs = n.stages.length ? n.stages : [{ type: 'LIGHT', s: n.start, e: n.end }];
    for (const st of segs) {
      const k = stageKey(st.type);
      if (!STAGE[k]) continue;
      g += R(x(st.s), y + gap, Math.max(1, x(st.e) - x(st.s) - 0.6), rowH - gap * 2, STAGE[k].color, rowH > 12 ? ' rx="2"' : '');
    }
    const tip = `<b>${md(d)}</b> ${hmDur(n.asleep)}<br>${hm(new Date(n.start))} → ${hm(new Date(n.end))}`;
    g += R(0, y, W, rowH, 'transparent', ` class="hit" data-act="night" data-date="${r.date}"${tipAttr(tip)}`);
  });
  return svg(W, H, g);
}

// nightly bars; stacked by stage (week) or plain with a 7-day average line (month)
export function sleepBars(rows, { W = 330, H = 150, goal = 480, stacked = true, avgLine = false, xLabel } = {}) {
  const Lw = 26, B = 18, top = 8;
  const tot = (n) => (n ? n.asleep + (n.byStage.AWAKE || n.awake || 0) : 0);
  const max = Math.max(goal + 60, ...rows.map((r) => tot(r.night)));
  const y = (m) => top + (1 - m / max) * (H - top - B);
  const step = (W - Lw) / rows.length, bw = Math.min(stacked ? 26 : 12, step * 0.62);
  let g = '';
  for (const h of [4, 6, 8, 10].filter((h) => h * 60 <= max)) g += L(Lw, y(h * 60), W, y(h * 60), 'var(--grid)') + T(0, y(h * 60) + 4, `${h}h`);
  g += L(Lw, y(goal), W, y(goal), 'var(--muted)', ' stroke-dasharray="4 4"');
  rows.forEach((r, i) => {
    const cx = Lw + step * i + step / 2, n = r.night;
    if (n) {
      if (stacked) {
        let acc = 0;
        for (const k of ['DEEP', 'LIGHT', 'REM', 'AWAKE']) {
          const m = n.byStage[k] || (k === 'LIGHT' && !n.hasStages ? n.asleep : 0);
          if (!m) continue;
          g += R(cx - bw / 2, y(acc + m), bw, y(acc) - y(acc + m) - 1, STAGE[k].color);
          acc += m;
        }
      } else g += R(cx - bw / 2, y(n.asleep), bw, y(0) - y(n.asleep), 'var(--light)', ' rx="2"');
      const tip = `<b>${md(parseYmd(r.date))}</b> 睡了 ${hmDur(n.asleep)}<br>深睡 ${hmDur(n.byStage.DEEP || 0)} · REM ${hmDur(n.byStage.REM || 0)}`;
      g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit" data-act="night" data-date="${r.date}"${tipAttr(tip)}`);
    }
    const lab = xLabel ? xLabel(r, i) : wk(parseYmd(r.date));
    if (lab) g += T(cx, H - 3, lab, 'ax', 'middle');
  });
  if (avgLine) {
    const pts = rows.map((r, i) => {
      const win = rows.slice(Math.max(0, i - 6), i + 1).map((x) => x.night?.asleep).filter((v) => v != null);
      return win.length ? { x: Lw + step * i + step / 2, y: y(mean(win)) } : null;
    });
    g += P(linePath(pts), 'var(--text)', ' stroke-width="2" stroke-linejoin="round"');
  }
  return svg(W, H, g);
}

// calendar heat map: one column per week, Monday on top; darker = longer
export function calHeat(byDate, { start, end, W = 330, max = 540, min = 300, tipFn } = {}) {
  const s = addDays(start, -wd(start));
  const weeks = Math.ceil((+end - +s) / 864e5 / 7 + 1e-9) || 1;
  const Lw = 22, cell = Math.min(22, (W - Lw) / weeks), gap = 3;
  const H = cell * 7 + 4;
  let g = '';
  ['一', '三', '五', '日'].forEach((t, i) => { g += T(0, (i * 2) * cell + cell / 2 + 4, t, 'ax'); });
  for (let w = 0; w < weeks; w++) {
    for (let k = 0; k < 7; k++) {
      const d = addDays(s, w * 7 + k);
      if (d < start || d > end) continue;
      const key = ymd(d), v = byDate[key];
      const x = Lw + w * cell, y = k * cell;
      if (v == null) { g += R(x, y, cell - gap, cell - gap, 'none', ' rx="4" stroke="var(--grid)"'); continue; }
      const o = clamp((v - min) / (max - min), 0.08, 1);
      g += R(x, y, cell - gap, cell - gap, 'var(--c-blue)', ` rx="4" fill-opacity="${r1(o)}" data-act="night" data-date="${key}"${tipAttr(tipFn ? tipFn(key, v) : `<b>${md(d)}</b> ${hmDur(v)}`)}`);
    }
  }
  return svg(W, H, g);
}
export const heatLegend = (lo = '短', hi = '长') => `<div class="heat-legend">${lo}${[0.12, 0.3, 0.5, 0.75, 1].map((o) => `<i style="opacity:${o}"></i>`).join('')}${hi}</div>`;

// weekly sleep window: box = average bedtime → wake time; whiskers = earliest/latest
export function drift(weeks, { W = 330, H = 190 } = {}) {
  const ok = weeks.filter((w) => w.bed != null);
  if (!ok.length) return '';
  const Lw = 38, top = 8, B = 20;
  let from = Math.min(...ok.map((w) => w.bedLo)) - 30, to = Math.max(...ok.map((w) => w.wakeHi)) + 30;
  from = Math.floor(from / 60) * 60; to = Math.ceil(to / 60) * 60;
  const y = (m) => top + ((m - from) / (to - from)) * (H - top - B);
  const step = (W - Lw) / weeks.length, bw = Math.min(16, step * 0.5);
  let g = '';
  for (let m = from; m <= to; m += 120) g += L(Lw, y(m), W, y(m), 'var(--grid)') + T(0, y(m) + 4, clockLabel(m));
  weeks.forEach((w, i) => {
    if (w.bed == null) return;
    const cx = Lw + step * i + step / 2;
    g += L(cx, y(w.bedLo), cx, y(w.bedHi), 'var(--c-blue)') + L(cx, y(w.wakeLo), cx, y(w.wakeHi), 'var(--c-blue)');
    g += R(cx - bw / 2, y(w.bed), bw, y(w.wake) - y(w.bed), 'var(--light)', ` rx="4" stroke="var(--c-blue)"${tipAttr(`<b>${w.label}</b><br>平均 ${clockLabel(w.bed)} → ${clockLabel(w.wake)}<br>上床 ${clockLabel(w.bedLo)}–${clockLabel(w.bedHi)}`)}`);
  });
  g += T(Lw + step / 2, H - 4, weeks[0].short || '', 'ax', 'middle') + T(Lw + step * (weeks.length - 0.5), H - 4, weeks.at(-1).short || '', 'ax', 'middle');
  return svg(W, H, g);
}

// weekly average stages, stacked
export function weeklyStages(weeks, { W = 330, H = 140, goal = 480 } = {}) {
  const Lw = 26, B = 18, top = 8;
  const tot = (w) => ['DEEP', 'LIGHT', 'REM', 'AWAKE'].reduce((a, k) => a + (w[k] || 0), 0);
  const max = Math.max(goal + 60, ...weeks.map(tot));
  const y = (m) => top + (1 - m / max) * (H - top - B);
  const step = (W - Lw) / weeks.length, bw = Math.min(18, step * 0.6);
  let g = '';
  for (const h of [4, 6, 8].filter((h) => h * 60 <= max)) g += L(Lw, y(h * 60), W, y(h * 60), 'var(--grid)') + T(0, y(h * 60) + 4, `${h}h`);
  g += L(Lw, y(goal), W, y(goal), 'var(--muted)', ' stroke-dasharray="4 4"');
  weeks.forEach((w, i) => {
    const cx = Lw + step * i + step / 2;
    let acc = 0;
    if (!tot(w)) return;
    for (const k of ['DEEP', 'LIGHT', 'REM', 'AWAKE']) {
      const m = w[k] || 0;
      if (!m) continue;
      g += R(cx - bw / 2, y(acc + m), bw, y(acc) - y(acc + m) - 1, STAGE[k].color);
      acc += m;
    }
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${w.label}</b> 平均 ${hmDur(w.asleep)}<br>深睡 ${hmDur(w.DEEP || 0)} · REM ${hmDur(w.REM || 0)}`)}`);
  });
  g += T(Lw + step / 2, H - 3, weeks[0].short || '', 'ax', 'middle') + T(Lw + step * (weeks.length - 0.5), H - 3, weeks.at(-1).short || '', 'ax', 'middle');
  return svg(W, H, g);
}

// ---------- body metrics ----------
// one value + where it falls in your normal range
export function rangeMini(v, b, { W = 100, H = 14 } = {}) {
  if (v == null) return '';
  const lo = b ? Math.min(b.lo, v) : v - 1, hi = b ? Math.max(b.hi, v) : v + 1;
  const pad = (hi - lo) * 0.35 || 1;
  const x = (u) => 4 + ((u - (lo - pad)) / (hi - lo + 2 * pad)) * (W - 8);
  const out = b && (v < b.lo || v > b.hi);
  let g = L(4, H / 2, W - 4, H / 2, 'var(--track)', ' stroke-width="4" stroke-linecap="round"');
  if (b) g += R(x(b.lo), H / 2 - 5, x(b.hi) - x(b.lo), 10, 'var(--band-strong)', ' rx="5"');
  g += C(x(v), H / 2, 5, out ? 'var(--awake)' : 'var(--text)');
  return svg(W, H, g, 'mini');
}

// trend for small cards: rolling normal range + line + last dot
export function sparkBand(series, bands = {}, { W = 100, H = 30 } = {}) {
  const pts = series.filter((p) => p.v != null);
  if (pts.length < 2) return '';
  const vals = pts.map((p) => p.v).concat(series.flatMap((p) => (bands[p.date] ? [bands[p.date].lo, bands[p.date].hi] : [])));
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 1;
  const x = (i) => 3 + (i / (series.length - 1)) * (W - 8);
  const y = (v) => 3 + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (H - 6);
  let g = `<path d="${bandPath(series.map((p, i) => (bands[p.date] ? { x: x(i), lo: y(bands[p.date].lo), hi: y(bands[p.date].hi) } : null)))}" fill="var(--band)"/>`;
  g += P(linePath(series.map((p, i) => (p.v == null ? null : { x: x(i), y: y(p.v) }))), 'var(--text)', ' stroke-width="1.4" stroke-linejoin="round"');
  const li = series.map((p) => p.v != null).lastIndexOf(true);
  const last = series[li], b = bands[last.date];
  g += C(x(li), y(last.v), 3.2, b && (last.v < b.lo || last.v > b.hi) ? 'var(--awake)' : 'var(--text)');
  return svg(W, H, g, 'mini');
}

// daily dots + your normal range (band) + 7-day average line; out-of-range dots turn orange
export function trendBand(series, bands = {}, { W = 330, H = 150, unit = '', digits = 0, xLabels } = {}) {
  const pts = series.filter((p) => p.v != null);
  if (!pts.length) return '';
  const Lw = 28, Rw = 6, top = 8, B = 20;
  const vals = pts.map((p) => p.v).concat(series.flatMap((p) => (bands[p.date] ? [bands[p.date].lo, bands[p.date].hi] : [])));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
  const n = series.length;
  const x = (i) => Lw + (n === 1 ? (W - Lw - Rw) / 2 : (i / (n - 1)) * (W - Lw - Rw));
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  const fmtV = (v) => (digits ? v.toFixed(digits) : Math.round(v));
  let g = '';
  for (const t of niceTicks(lo, hi, 3)) g += L(Lw, y(t), W - Rw, y(t), 'var(--grid)') + T(0, y(t) + 4, String(t));
  g += `<path d="${bandPath(series.map((p, i) => (bands[p.date] ? { x: x(i), lo: y(bands[p.date].lo), hi: y(bands[p.date].hi) } : null)))}" fill="var(--band)"/>`;
  const avg = series.map((p, i) => { const w = series.slice(Math.max(0, i - 6), i + 1).map((q) => q.v).filter((v) => v != null); return w.length >= 3 ? { x: x(i), y: y(mean(w)) } : null; });
  g += P(linePath(avg), 'var(--text)', ' stroke-width="1.6" stroke-linejoin="round" opacity=".85"');
  const rad = n > 60 ? 2 : n > 20 ? 2.6 : 3.4;
  const hv = [];
  series.forEach((p, i) => {
    if (p.v == null) return;
    const b = bands[p.date], out = b && (p.v < b.lo || p.v > b.hi);
    g += C(x(i), y(p.v), out ? rad + 0.8 : rad, out ? 'var(--awake)' : 'var(--dot)');
    hv.push({ x: x(i), y: y(p.v), color: out ? 'var(--awake)' : 'var(--text)', html: `<b>${fmtV(p.v)} ${unit}</b> · ${md(parseYmd(p.date))}${b ? `<br><span class="muted">你的正常 ${fmtV(b.lo)}–${fmtV(b.hi)}</span>` : ''}` });
  });
  const labs = xLabels ? xLabels(series) : [];
  for (const [i, s] of labs) g += T(x(i), H - 4, s, 'ax', i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
  g += hoverLayer(hv, { x0: Lw - 4, x1: W, top, bottom: H - B });
  return svg(W, H, g);
}

// daily min → max line with the average as a dot
export function rangeBars(days, { W = 330, H = 150, xLabels } = {}) {
  const ok = days.filter((d) => d.min != null);
  if (!ok.length) return '';
  const Lw = 28, top = 8, B = 20;
  const lo = Math.max(30, Math.min(...ok.map((d) => d.min)) - 8), hi = Math.max(...ok.map((d) => d.max)) + 8;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  const n = days.length, step = (W - Lw) / n, sw = clamp(step * 0.45, 1.5, 6);
  let g = '';
  for (const t of niceTicks(lo, hi, 3)) g += L(Lw, y(t), W, y(t), 'var(--grid)') + T(0, y(t) + 4, String(t));
  days.forEach((d, i) => {
    if (d.min == null) return;
    const cx = Lw + step * i + step / 2;
    g += L(cx, y(d.min), cx, y(d.max), 'var(--z2)', ` stroke-width="${r1(sw)}" stroke-linecap="round"`);
    if (d.avg != null) g += C(cx, y(d.avg), Math.min(3.2, sw * 0.75 + 0.8), 'var(--c-red)');
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${md(parseYmd(d.date))}</b><br>最低 ${Math.round(d.min)} · 平均 ${Math.round(d.avg)} · 最高 ${Math.round(d.max)}`)}`);
  });
  const labs = xLabels ? xLabels(days) : [];
  for (const [i, s] of labs) g += T(Lw + step * i + step / 2, H - 4, s, 'ax', 'middle');
  return svg(W, H, g);
}

// ---------- heart: one day ----------
export function dayCurve(points, { start, end, zones, sleeps = [], workouts = [], rest, now, W = 330, H = 212 } = {}) {
  const Lw = 28, Rw = 40, top = 16, bottom = 168, B = 22;
  const x = (t) => Lw + ((t - start) / (end - start)) * (W - Lw - Rw);
  const lo = 40, hi = Math.max(zones.VIGOROUS[0] + 12, Math.max(...points.map((p) => p.hi || p.v)) + 6);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bottom - top);
  let g = '';
  // zone bands
  const zs = [[2, zones.MODERATE[0], zones.VIGOROUS[0]], [3, zones.VIGOROUS[0], zones.PEAK[0]], [4, zones.PEAK[0], hi]];
  for (const [z, a, b] of zs) {
    if (a >= hi) continue;
    g += R(Lw, y(Math.min(b, hi)), W - Rw - Lw, y(a) - y(Math.min(b, hi)), ZONE_COLOR[z], ' opacity=".2"');
    g += T(W - 2, (y(a) + y(Math.min(b, hi))) / 2 + 4, ZONE_NAME[z], 'ax', 'end');
  }
  for (const t of [60, 90, 120, 150, 180].filter((v) => v < hi - 4)) g += T(0, y(t) + 4, String(t));
  // sleep shading
  for (const s of sleeps) {
    const a = Math.max(start, s.start), b = Math.min(end, s.end);
    if (b <= a) continue;
    g += R(x(a), top, x(b) - x(a), bottom - top, 'var(--shade-strong)');
    if (x(b) - x(a) > 40) g += T((x(a) + x(b)) / 2, top + 12, '睡眠', 'ax', 'middle');
  }
  // curve
  const pts = points.filter((p) => p.t >= start && p.t <= end);
  const gapMs = 20 * 60e3;
  const withGaps = [];
  pts.forEach((p, i) => { if (i && p.t - pts[i - 1].t > gapMs) withGaps.push(null); withGaps.push(p); });
  g += `<path d="${bandPath(withGaps.map((p) => (p ? { x: x(p.t), lo: y(p.lo ?? p.v), hi: y(p.hi ?? p.v) } : null)))}" fill="var(--c-red)" opacity=".18"/>`;
  g += P(linePath(withGaps.map((p) => (p ? { x: x(p.t), y: y(p.v) } : null))), 'var(--c-red)', ' stroke-width="1.6" stroke-linejoin="round"');
  if (rest) g += L(Lw, y(rest), W - Rw, y(rest), 'var(--text-2)', ' stroke-dasharray="4 4"') + T(W - 2, y(rest) + 4, `静息 ${rest}`, 'ax', 'end');
  if (now && now > start && now < end) g += L(x(now), top - 4, x(now), bottom, 'var(--muted)', ' stroke-dasharray="3 3"') + T(x(now), top - 6, '现在', 'ax', 'middle');
  g += L(Lw, bottom, W - Rw, bottom, 'var(--grid)');
  // workouts under the axis
  for (const w of workouts) {
    const a = Math.max(start, w.start), b = Math.min(end, w.end);
    if (b <= a) continue;
    g += R(x(a), bottom + 5, Math.max(4, x(b) - x(a)), 6, KIND[w.kind]?.color || 'var(--c-grey)', ` rx="3" data-act="workout" data-id="${esc(w.id)}"${tipAttr(`<b>${KIND[w.kind]?.name || '运动'}</b> ${hm(new Date(w.start))}–${hm(new Date(w.end))}`)}`);
  }
  for (const h of [0, 6, 12, 18, 24]) g += T(x(+start + h * 3600e3), H - 4, String(h), 'ax', 'middle');
  const hv = pts.map((p) => ({ x: x(p.t), y: y(p.v), html: `<b>${Math.round(p.v)} bpm</b> · ${hm(new Date(p.t))}${p.lo != null ? `<br><span class="muted">${Math.round(p.lo)}–${Math.round(p.hi)}</span>` : ''}` }));
  g += hoverLayer(hv, { x0: Lw, x1: W - Rw, top, bottom, color: 'var(--c-red)' });
  return svg(W, H, g);
}

// zone minutes as labeled rows (峰值 → 轻度)
export function zoneRows(min, { order = [4, 3, 2, 1] } = {}) {
  const keys = { 1: 'light', 2: 'moderate', 3: 'vigorous', 4: 'peak' };
  const max = Math.max(1, ...order.map((z) => min[keys[z]] || 0));
  return `<div class="hbars">${order.map((z) => {
    const v = Math.round(min[keys[z]] || 0);
    return `<div class="hb"><span class="k">${ZONE_NAME[z]}</span><span class="bar"><i style="width:${(v / max) * 100}%;background:${ZONE_COLOR[z]}"></i></span><span class="v">${v} 分钟</span></div>`;
  }).join('')}</div>`;
}

// stacked daily zone minutes (燃脂 / 有氧 / 峰值) + dashed average
export function zoneStack(days, { W = 330, H = 140, avg, xLabels } = {}) {
  const Lw = 26, top = 10, B = 20;
  const tot = (d) => (d.z ? d.z.moderate + d.z.vigorous + d.z.peak : 0);
  const max = Math.max(30, avg || 0, ...days.map(tot)) * 1.1;
  const y = (v) => top + (1 - v / max) * (H - top - B);
  const n = days.length, step = (W - Lw) / n, bw = Math.min(26, step * 0.62);
  let g = '';
  for (const t of niceTicks(0, max, 3)) g += L(Lw, y(t), W, y(t), 'var(--grid)') + T(0, y(t) + 4, String(t));
  days.forEach((d, i) => {
    if (!d.z) return;
    const cx = Lw + step * i + step / 2;
    let acc = 0;
    for (const [k, z] of [['moderate', 2], ['vigorous', 3], ['peak', 4]]) {
      const v = d.z[k] || 0;
      if (v <= 0) continue;
      g += R(cx - bw / 2, y(acc + v), bw, y(acc) - y(acc + v) - (acc + v < max ? 0.8 : 0), ZONE_COLOR[z]);
      acc += v;
    }
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${md(parseYmd(d.date))}</b> ${Math.round(tot(d))} 分钟<br>燃脂 ${Math.round(d.z.moderate)} · 有氧 ${Math.round(d.z.vigorous)} · 峰值 ${Math.round(d.z.peak)}`)}`);
  });
  if (avg) g += L(Lw, y(avg), W, y(avg), 'var(--text)', ' stroke-dasharray="4 4"');
  const labs = xLabels ? xLabels(days) : [];
  for (const [i, s] of labs) g += T(Lw + step * i + step / 2, H - 4, s, 'ax', i === 0 && n > 7 ? 'start' : i === n - 1 && n > 7 ? 'end' : 'middle');
  return svg(W, H, g);
}

// ---------- workouts ----------
export function hrMini(points, { W = 120, H = 30, start, end, peaks = [], stroke = 'var(--c-red)' } = {}) {
  if (points.length < 2) return '';
  const a = start ?? points[0].t, b = end ?? points.at(-1).t;
  const lo = Math.min(...points.map((p) => p.v)) - 3, hi = Math.max(...points.map((p) => p.v)) + 3;
  const x = (t) => 2 + ((t - a) / (b - a || 1)) * (W - 4);
  const y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (H - 6);
  let g = P(linePath(points.map((p) => ({ x: x(p.t), y: y(p.v) }))), stroke, ' stroke-width="1.5" stroke-linejoin="round"');
  for (const p of peaks) g += C(x(p.t), y(p.v), 3.2, p.color || 'var(--text)');
  return svg(W, H, g, 'mini');
}

export function zoneStrip(z, { W = 120, H = 6 } = {}) {
  const parts = [[z.light, 1], [z.moderate, 2], [z.vigorous, 3], [z.peak, 4]];
  const tot = parts.reduce((a, [v]) => a + (v || 0), 0);
  if (!tot) return '';
  let x = 0, g = '';
  for (const [v, k] of parts) { if (!v) continue; const w = (v / tot) * W; g += R(x, 0, Math.max(0, w - 1), H, ZONE_COLOR[k], ' rx="1.5"'); x += w; }
  return svg(W, H, g, 'mini');
}

// per-minute heart rate bars colored by zone
export function hrBarcode(points, zones, { W = 330, H = 140, zoneOf } = {}) {
  if (!points.length) return '';
  const Lw = 34, top = 6, B = 18;
  const lo = Math.max(40, Math.min(...points.map((p) => p.v)) - 10), hi = Math.max(...points.map((p) => p.v)) + 6;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  const step = (W - Lw) / points.length;
  let g = '';
  for (const [z, k] of [[1, 'LIGHT'], [2, 'MODERATE'], [3, 'VIGOROUS'], [4, 'PEAK']]) {
    const v = zones[k]?.[0];
    if (v == null || v < lo || v > hi) continue;
    g += L(Lw, y(v), W, y(v), 'var(--grid)', ' stroke-dasharray="2 3"') + T(0, y(v) + 4, ZONE_NAME[z], 'ax');
  }
  points.forEach((p, i) => {
    const z = zoneOf(p.v, zones);
    g += R(Lw + i * step, y(p.v), Math.max(0.8, step - 0.6), y(lo) - y(p.v), ZONE_COLOR[Math.max(1, z)]);
  });
  const t0 = points[0].t, t1 = points.at(-1).t;
  g += T(Lw, H - 3, hm(new Date(t0)), 'ax') + T(Lw + (W - Lw) / 2, H - 3, hm(new Date((t0 + t1) / 2)), 'ax', 'middle') + T(W, H - 3, hm(new Date(t1 + 60e3)), 'ax', 'end');
  const hv = points.map((p, i) => ({ x: Lw + i * step + step / 2, y: y(p.v), html: `<b>${Math.round(p.v)} bpm</b> · ${hm(new Date(p.t))}` }));
  g += hoverLayer(hv, { x0: Lw, x1: W, top, bottom: H - B, color: 'var(--c-red)' });
  return svg(W, H, g);
}

export function hbars(rows, { fmt = (v) => v } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return `<div class="hbars">${rows.map((r) => `<div class="hb"${r.tip ? tipAttr(r.tip) : ''}><span class="k">${esc(r.k)}</span><span class="bar"><i style="width:${(r.v / max) * 100}%;background:${r.color}"></i></span><span class="v">${esc(fmt(r.v))}</span></div>`).join('')}</div>`;
}

// this vs last time, two bars per metric
export function compare(rows) {
  return `<div class="cmp">${rows.map((r) => {
    const max = Math.max(r.a || 0, r.b || 0, 1);
    return `<div class="cmp-row"><span class="k">${esc(r.k)}</span><div class="cmp-bars">
      <span class="bar"><i style="width:${((r.a || 0) / max) * 100}%;background:${r.color}"></i></span>
      <span class="bar"><i style="width:${((r.b || 0) / max) * 100}%;background:var(--c-grey)"></i></span></div>
      <div class="cmp-v"><b>${esc(r.fa)}</b><span>${esc(r.fb)}</span></div></div>`;
  }).join('')}</div>`;
}

// week: 7 rows × hours, a block per workout
export function timeGrid(rows, { W = 330, from = 6, to = 24, todayKey } = {}) {
  const Lw = 26, rowH = 26, top = 2, B = 20;
  const H = top + rows.length * rowH + B;
  const x = (t, date) => { const m = (t - +parseYmd(date)) / 60e3 / 60; return Lw + ((clamp(m, from, to) - from) / (to - from)) * (W - Lw - 6); };
  let g = '';
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    if (r.date === todayKey) g += R(0, y, W, rowH, 'var(--shade-strong)', ' rx="5"');
    else g += R(Lw, y + 3, W - Lw - 6, rowH - 6, 'var(--shade)', ' rx="3"');
    g += T(6, y + rowH / 2 + 4, wk(parseYmd(r.date)), 'lbl');
  });
  for (let h = from; h <= to; h += 3) { const xx = Lw + ((h - from) / (to - from)) * (W - Lw - 6); g += L(xx, top, xx, H - B, 'var(--grid)') + T(xx, H - 4, String(h), 'ax', 'middle'); }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    for (const w of r.items) {
      const a = x(w.start, r.date), b = x(w.end, r.date);
      g += R(a, y + 4, Math.max(8, b - a), rowH - 8, KIND[w.kind].color, ` rx="5" data-act="workout" data-id="${esc(w.id)}"${tipAttr(`<b>${KIND[w.kind].name}</b> ${hm(new Date(w.start))}–${hm(new Date(w.end))}`)}`);
    }
  });
  return svg(W, H, g);
}

// month calendar: a dot per workout, size = duration, color = type
export function workoutCal({ start, end, byDate, todayKey }) {
  const s = addDays(start, -wd(start));
  let html = `<div class="cal">${'一二三四五六日'.split('').map((c) => `<div class="cal-h">${c}</div>`).join('')}`;
  for (let d = s; d <= end || wd(d) !== 0; d = addDays(d, 1)) {
    const key = ymd(d), inRange = d >= start && d <= end;
    const items = inRange ? byDate[key] || [] : [];
    html += `<div class="cal-c${inRange ? '' : ' off'}${key === todayKey ? ' today' : ''}">${items.map((w) => {
      const sz = clamp(6 + w.min / 9, 7, 20);
      return `<i class="dot" style="width:${sz}px;height:${sz}px;background:${KIND[w.kind].color}" data-act="workout" data-id="${esc(w.id)}"${tipAttr(`<b>${KIND[w.kind].name}</b> ${md(d)} · ${Math.round(w.min)} 分钟`)}></i>`;
    }).join('')}</div>`;
    if (d > end && wd(d) === 6) break;
  }
  return html + '</div>';
}

// weekly hours stacked by type + 4-week average line
export function weeklyHours(weeks, { W = 330, H = 160 } = {}) {
  const Lw = 26, top = 18, B = 20;
  const tot = (w) => w.strength + w.basketball + w.other;
  const max = Math.max(2, ...weeks.map(tot)) * 1.12;
  const y = (v) => top + (1 - v / max) * (H - top - B);
  const step = (W - Lw) / weeks.length, bw = Math.min(18, step * 0.6);
  let g = '';
  for (const t of niceTicks(0, max, 3)) g += L(Lw, y(t), W, y(t), 'var(--grid)') + T(0, y(t) + 4, `${t}h`);
  weeks.forEach((w, i) => {
    const cx = Lw + step * i + step / 2;
    let acc = 0;
    for (const k of ['strength', 'basketball', 'other']) {
      const v = w[k];
      if (!v) continue;
      g += R(cx - bw / 2, y(acc + v), bw, y(acc) - y(acc + v) - 0.8, KIND[k].color);
      acc += v;
    }
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${w.label}</b> ${tot(w).toFixed(1)} h<br>力量 ${w.strength.toFixed(1)} · 篮球 ${w.basketball.toFixed(1)} · 其他 ${w.other.toFixed(1)}`)}`);
  });
  const avg = weeks.map((w, i) => (i >= 3 ? { x: Lw + step * i + step / 2, y: y(mean(weeks.slice(i - 3, i + 1).map(tot))) } : null));
  g += P(linePath(avg), 'var(--text)', ' stroke-width="1.6" stroke-linejoin="round"');
  for (const p of avg) if (p) g += C(p.x, p.y, 2.2, 'var(--text)');
  const last = weeks.at(-1);
  g += T(W, 11, `本周 ${tot(last).toFixed(1)} h`, 'lbl', 'end');
  g += T(Lw + step / 2, H - 4, `${weeks.length} 周前`, 'ax', 'start') + T(W, H - 4, '本周', 'ax', 'end');
  return svg(W, H, g);
}

// duration × average HR, one dot per game; newer = darker, latest ringed
export function scatter(points, { W = 330, H = 190, color = 'var(--c-magenta)' } = {}) {
  if (!points.length) return '';
  const Lw = 30, top = 10, B = 34;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.floor((Math.min(...xs) - 8) / 10) * 10, x1 = Math.ceil((Math.max(...xs) + 8) / 10) * 10;
  const y0 = Math.floor(Math.min(...ys) - 4), y1 = Math.ceil(Math.max(...ys) + 4);
  const x = (v) => Lw + ((v - x0) / (x1 - x0)) * (W - Lw - 8);
  const y = (v) => top + (1 - (v - y0) / (y1 - y0)) * (H - top - B);
  let g = '';
  for (const t of niceTicks(y0, y1, 3)) g += L(Lw, y(t), W - 8, y(t), 'var(--grid)') + T(0, y(t) + 4, String(t));
  for (const t of niceTicks(x0, x1, 4)) g += T(x(t), H - 18, String(t), 'ax', 'middle');
  g += T(W - 8, H - 3, '时长（分钟）', 'ax', 'end') + T(Lw + 4, top + 10, '平均心率', 'ax');
  const n = points.length;
  points.forEach((p, i) => {
    const age = n > 1 ? i / (n - 1) : 1;
    g += C(x(p.x), y(p.y), 4.5, color, ` fill-opacity="${r1(0.25 + 0.75 * age)}" data-act="workout" data-id="${esc(p.id)}"${tipAttr(`<b>${md(new Date(p.t))}</b> ${Math.round(p.x)} 分钟 · ${Math.round(p.y)} bpm`)}`);
  });
  const last = points.at(-1);
  g += C(x(last.x), y(last.y), 8, 'none', ' stroke="var(--text)" stroke-width="1.5"') + T(x(last.x) + 11, y(last.y) - 8, last.label || '最近', 'lbl b');
  return svg(W, H, g);
}

export function vo2(points, { W = 330, H = 130 } = {}) {
  if (!points.length) return '';
  const Lw = 30, top = 10, B = 20;
  const lo = Math.floor(Math.min(...points.map((p) => p.v)) - 1), hi = Math.ceil(Math.max(...points.map((p) => p.v)) + 1);
  const t0 = points[0].t, t1 = points.at(-1).t;
  const x = (t) => Lw + ((t - t0) / (t1 - t0 || 1)) * (W - Lw - 10);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - B);
  let g = '';
  for (const t of niceTicks(lo, hi, 3)) g += L(Lw, y(t), W - 10, y(t), 'var(--grid)') + T(0, y(t) + 4, String(t));
  g += P(linePath(points.map((p) => ({ x: x(p.t), y: y(p.v) }))), 'var(--text)', ' stroke-width="1.6" stroke-linejoin="round"');
  for (const p of points) g += C(x(p.t), y(p.v), 2.6, 'var(--text)');
  const last = points.at(-1);
  g += C(x(last.t), y(last.v), 4.5, 'var(--text)');
  g += T(Lw, H - 4, md(new Date(t0)), 'ax') + T(W - 10, H - 4, md(new Date(t1)), 'ax', 'end');
  const hv = points.map((p) => ({ x: x(p.t), y: y(p.v), html: `<b>${p.v.toFixed(1)}</b> · ${md(new Date(p.t))}${p.levelName ? ` · ${p.levelName}` : ''}` }));
  g += hoverLayer(hv, { x0: Lw, x1: W, top, bottom: H - B });
  return svg(W, H, g);
}

// weekday × hour habit: dot size = how often, color = most common type
export function habit(cells, { W = 330, from = 6, to = 22 } = {}) {
  const Lw = 22, rowH = 22, top = 4, B = 18;
  const H = top + 7 * rowH + B;
  const cols = to - from;
  const cw = (W - Lw) / cols;
  const max = Math.max(1, ...cells.flat().map((c) => c.n));
  let g = '';
  '一二三四五六日'.split('').forEach((c, i) => { g += T(2, top + i * rowH + rowH / 2 + 4, c, 'lbl'); });
  for (let i = 0; i < 7; i++) for (let h = 0; h < cols; h++) {
    const c = cells[i][h + from];
    const cx = Lw + h * cw + cw / 2, cy = top + i * rowH + rowH / 2;
    if (!c.n) { g += C(cx, cy, 1.4, 'var(--grid)'); continue; }
    g += C(cx, cy, 3 + 6 * Math.sqrt(c.n / max), KIND[c.kind].color, tipAttr(`<b>周${'一二三四五六日'[i]} ${h + from}点</b> ${c.n} 次`));
  }
  for (let h = from; h <= to; h += 3) g += T(Lw + (h - from) * cw, H - 4, String(h), 'ax', 'middle');
  return svg(W, H, g);
}

// ---------- small things ----------
export function spark(series, { W = 140, H = 34, kind = 'line', color = 'var(--text)', highlight = 'var(--c-blue)', band } = {}) {
  const vals = series.map((p) => p.v).filter((v) => v != null);
  if (!vals.length) return '';
  const n = series.length;
  if (kind === 'bar') {
    const max = Math.max(...vals, 1), step = W / n, bw = Math.min(14, step * 0.6);
    let g = '';
    series.forEach((p, i) => {
      if (p.v == null) return;
      const h = Math.max(2, (p.v / max) * (H - 4));
      g += R(i * step + (step - bw) / 2, H - h, bw, h, i === n - 1 ? highlight : 'var(--track)', ` rx="2"${tipAttr(`${md(parseYmd(p.date))} · ${Math.round(p.v)}`)}`);
    });
    return svg(W, H, g, 'mini');
  }
  const bl = band ? band.flatMap((b) => (b ? [b.lo, b.hi] : [])) : [];
  const lo = Math.min(...vals, ...bl), hi = Math.max(...vals, ...bl), pad = (hi - lo) * 0.15 || 1;
  const x = (i) => 3 + (i / Math.max(1, n - 1)) * (W - 8);
  const y = (v) => 3 + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (H - 6);
  let g = band ? `<path d="${bandPath(series.map((p, i) => (band[i] ? { x: x(i), lo: y(band[i].lo), hi: y(band[i].hi) } : null)))}" fill="var(--band)"/>` : '';
  g += P(linePath(series.map((p, i) => (p.v == null ? null : { x: x(i), y: y(p.v) }))), color, ' stroke-width="1.6" stroke-linejoin="round"');
  const li = series.map((p) => p.v != null).lastIndexOf(true);
  if (li >= 0) g += C(x(li), y(series[li].v), 3.2, color);
  return svg(W, H, g, 'mini');
}

export function progressBar(v, avg, { color = 'var(--c-steps)', fmt = fmtInt, avgLabel = '你的日均' } = {}) {
  const max = Math.max(v || 0, avg || 0, 1) * 1.15;
  return `<div class="pbar"><span class="track"><i style="width:${((v || 0) / max) * 100}%;background:${color}"></i></span>${avg ? `<span class="mark" style="left:${(avg / max) * 100}%"><em>${avgLabel} ${fmt(avg)}</em></span>` : ''}</div>`;
}
