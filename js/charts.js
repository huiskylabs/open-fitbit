// Small dependency-free SVG charts. Every mark carries data-tip for the tap/hover tooltip.
export const STAGES = [
  { key: 'AWAKE', name: '清醒', color: 'var(--awake)' },
  { key: 'REM', name: 'REM', color: 'var(--rem)' },
  { key: 'LIGHT', name: '浅睡', color: 'var(--light)' },
  { key: 'DEEP', name: '深睡', color: 'var(--deep)' },
];
const CLASSIC = { ASLEEP: 'LIGHT', RESTLESS: 'AWAKE' };
export const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const dur = (min) => { min = Math.round(min); const h = Math.floor(min / 60); return h ? `${h}小时${min % 60 ? (min % 60) + '分' : ''}` : `${min}分钟`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Hypnogram: one labeled row per stage, a 2px-gapped block for each stage segment.
export function hypnogram(sleep) {
  const W = 340, L = 40, R = 6, rowH = 26, top = 4, H = top + rowH * 4 + 22;
  const t0 = sleep.start.getTime(), t1 = sleep.end.getTime();
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const rowOf = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
  let g = '';
  STAGES.forEach((s, i) => {
    const y = top + i * rowH;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y + rowH / 2}" y2="${y + rowH / 2}" stroke-dasharray="2 4"/>`;
    g += `<text class="lbl" x="0" y="${y + rowH / 2 + 4}">${s.name}</text>`;
  });
  // thin connectors between consecutive segments to show transitions
  let prev = null;
  for (const st of sleep.stages) {
    const key = CLASSIC[st.type] || st.type;
    const i = rowOf[key]; if (i == null) continue;
    if (prev != null && prev !== i) {
      const xx = x(st.start.getTime());
      const y1 = top + prev * rowH + rowH / 2, y2 = top + i * rowH + rowH / 2;
      g += `<line x1="${xx}" x2="${xx}" y1="${y1}" y2="${y2}" stroke="var(--line)" stroke-width="1"/>`;
    }
    prev = i;
  }
  for (const st of sleep.stages) {
    const key = CLASSIC[st.type] || st.type;
    const i = rowOf[key]; if (i == null) continue;
    const s = STAGES[i];
    const x1 = x(st.start.getTime()), x2 = x(st.end.getTime());
    const w = Math.max(1.5, x2 - x1 - 1);
    const y = top + i * rowH + 4;
    const tip = `<b>${s.name}</b> ${hm(st.start)}–${hm(st.end)}<br>${dur((st.end - st.start) / 60e3)}`;
    g += `<rect x="${x1}" y="${y}" width="${w}" height="${rowH - 8}" rx="3" fill="${s.color}" data-tip="${esc(tip)}"/>`;
  }
  // hour ticks
  const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
  for (let t = first.getTime(); t < t1; t += 3600e3) {
    const d = new Date(t);
    if (d.getHours() % 2 || x(t) - L < 40 || W - R - x(t) < 40) continue;
    g += `<text x="${x(t)}" y="${H - 4}" text-anchor="middle">${d.getHours()}点</text>`;
  }
  g += `<text x="${L}" y="${H - 4}" text-anchor="start" class="lbl">${hm(sleep.start)}</text>`;
  g += `<text x="${W - R}" y="${H - 4}" text-anchor="end" class="lbl">${hm(sleep.end)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="睡眠阶段图">${g}</svg>`;
}

// Stacked nightly bars (deep at the baseline), 2px gaps between segments.
export function sleepNights(nights, onPickAttr = 'data-night') {
  const W = 340, H = 150, L = 26, B = 18, top = 6;
  const data = [...nights].reverse();
  const maxMin = Math.max(480, ...data.map((n) => n.asleep + (n.byStage.AWAKE || 0)));
  const step = (W - L) / Math.max(data.length, 1);
  const bw = Math.min(16, step - 6);
  const y = (m) => top + (1 - m / maxMin) * (H - top - B);
  let g = '';
  for (const h of [4, 6, 8, 10].filter((h) => h * 60 <= maxMin)) {
    g += `<line class="grid" x1="${L}" x2="${W}" y1="${y(h * 60)}" y2="${y(h * 60)}"/><text x="0" y="${y(h * 60) + 4}">${h}h</text>`;
  }
  data.forEach((n, i) => {
    const cx = L + step * i + step / 2;
    let acc = 0;
    const order = ['DEEP', 'LIGHT', 'REM', 'AWAKE'];
    const segs = order.map((k) => [k, n.byStage[k] || (k === 'LIGHT' && !n.hasStages ? n.asleep : 0)]).filter(([, m]) => m > 0);
    segs.forEach(([k, m], j) => {
      const s = STAGES.find((x) => x.key === k);
      const y0 = y(acc), y1 = y(acc + m);
      const gap = j ? 2 : 0;
      const hgt = Math.max(1, y0 - y1 - gap);
      const isTop = j === segs.length - 1;
      g += isTop
        ? `<path d="M${cx - bw / 2},${y0 - gap} V${y1 + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${y0 - gap} Z" fill="${s.color}"/>`
        : `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${hgt}" fill="${s.color}"/>`;
      acc += m;
    });
    const d = n.end;
    const tip = `<b>${d.getMonth() + 1}月${d.getDate()}日</b> 睡了 ${dur(n.asleep)}<br>深睡 ${dur(n.byStage.DEEP || 0)} · REM ${dur(n.byStage.REM || 0)}<br>浅睡 ${dur(n.byStage.LIGHT || 0)} · 清醒 ${dur(n.byStage.AWAKE || 0)}`;
    g += `<rect class="hit" x="${cx - step / 2}" y="0" width="${step}" height="${H}" data-tip="${esc(tip)}" ${onPickAttr}="${n.id}"/>`;
    if (i % 2 === (data.length - 1) % 2) g += `<text x="${cx}" y="${H - 3}" text-anchor="middle">${d.getDate()}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近每晚睡眠">${g}</svg>`;
}

// Line chart with optional min/max band and a crosshair tooltip.
const lineStore = new Map();
let lineId = 0;
export function lineChart(points, { band = false, color = 'var(--hr)', unit = '', fmtX, height = 150, yPad = 4, ref } = {}) {
  if (!points.length) return '<div class="empty">暂无数据</div>';
  const W = 340, H = height, L = 30, R = 6, top = 8, B = 18;
  const xs = points.map((p) => +p.t);
  const lo = Math.min(...points.map((p) => (band ? p.lo ?? p.v : p.v))) - yPad;
  const hi = Math.max(...points.map((p) => (band ? p.hi ?? p.v : p.v))) + yPad;
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const x = (t) => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
  const y = (v) => top + (1 - (v - lo) / (hi - lo || 1)) * (H - top - B);
  let g = '';
  const ticks = niceTicks(lo, hi, 4);
  for (const t of ticks) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="0" y="${y(t) + 4}">${t}</text>`;
  if (band) {
    const up = points.map((p) => `${x(+p.t)},${y(p.hi ?? p.v)}`).join(' L');
    const dn = [...points].reverse().map((p) => `${x(+p.t)},${y(p.lo ?? p.v)}`).join(' L');
    g += `<path d="M${up} L${dn} Z" fill="var(--hr-band)"/>`;
  }
  // break the line across gaps (no data while the tracker was off)
  const gapMs = Math.max(...xs.slice(1).map((t, i) => t - xs[i]).sort((a, b) => a - b).slice(0, 1), 1) * 4;
  let d = '';
  points.forEach((p, i) => { d += (i && +p.t - +points[i - 1].t <= gapMs ? ' L' : ' M') + `${x(+p.t)},${y(p.v)}`; });
  g += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (ref != null) g += `<line x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
  const labels = fmtX ? fmtX(x0, x1) : [];
  for (const [t, s] of labels) g += `<text x="${x(t)}" y="${H - 3}" text-anchor="middle">${s}</text>`;
  const id = 'l' + ++lineId;
  lineStore.set(id, { points, x, y, W, H, unit, color, band });
  g += `<g class="xh" data-for="${id}"></g><rect class="hit" data-line="${id}" x="${L}" y="0" width="${W - L - R}" height="${H}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" data-line-svg="${id}" role="img">${g}</svg>`;
}

export function lineHover(rect, clientX) {
  const id = rect.dataset.line, st = lineStore.get(id);
  if (!st) return null;
  const svg = rect.ownerSVGElement, box = svg.getBoundingClientRect();
  const vx = ((clientX - box.left) / box.width) * st.W;
  let best = st.points[0], bd = Infinity;
  for (const p of st.points) { const dd = Math.abs(st.x(+p.t) - vx); if (dd < bd) { bd = dd; best = p; } }
  const gx = svg.querySelector(`.xh[data-for="${id}"]`);
  const px = st.x(+best.t), py = st.y(best.v);
  gx.innerHTML = `<line x1="${px}" x2="${px}" y1="0" y2="${st.H - 18}" stroke="var(--muted)" stroke-width="1"/><circle cx="${px}" cy="${py}" r="4.5" fill="${st.color}" stroke="var(--card)" stroke-width="2"/>`;
  const t = best.t instanceof Date ? best.t : new Date(best.t);
  const when = best.label || (st.band ? hm(t) : `${t.getMonth() + 1}月${t.getDate()}日`);
  const range = st.band && best.lo != null ? `<br><span class="muted">范围 ${Math.round(best.lo)}–${Math.round(best.hi)}</span>` : '';
  return `<b>${Math.round(best.v * 10) / 10} ${st.unit}</b> · ${when}${range}`;
}
export function clearHover(svg) { svg?.querySelectorAll('.xh').forEach((g) => (g.innerHTML = '')); }

export function barChart(items, { color = 'var(--steps)', unit = '', goal } = {}) {
  const W = 340, H = 130, L = 30, B = 18, top = 6;
  const max = Math.max(goal || 0, ...items.map((d) => d.v)) * 1.08 || 1;
  const step = (W - L) / items.length, bw = Math.min(16, step - 6);
  const y = (v) => top + (1 - v / max) * (H - top - B);
  let g = '';
  for (const t of niceTicks(0, max, 3)) g += `<line class="grid" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="0" y="${y(t) + 4}">${t >= 1000 ? t / 1000 + 'k' : t}</text>`;
  if (goal) g += `<line x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
  items.forEach((d, i) => {
    const cx = L + step * i + step / 2, yy = y(d.v), h = H - B - yy;
    if (h > 0) g += `<path d="M${cx - bw / 2},${H - B} V${yy + Math.min(4, h)} q0,-${Math.min(4, h)} 4,-${Math.min(4, h)} H${cx + bw / 2 - 4} q4,0 4,${Math.min(4, h)} V${H - B} Z" fill="${color}"/>`;
    const dt = new Date(d.date + 'T12:00');
    g += `<rect class="hit" x="${cx - step / 2}" y="0" width="${step}" height="${H}" data-tip="${esc(`<b>${d.v.toLocaleString()} ${unit}</b> · ${dt.getMonth() + 1}月${dt.getDate()}日`)}"/>`;
    if (i % 2 === (items.length - 1) % 2) g += `<text x="${cx}" y="${H - 3}" text-anchor="middle">${dt.getDate()}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

function niceTicks(lo, hi, n) {
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const stp = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / stp) * stp; v <= hi; v += stp) out.push(Math.round(v * 100) / 100);
  return out;
}
