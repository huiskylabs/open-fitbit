// 日晷: every page draws its data on a dial.
// - day: 24 hours, midnight at the bottom and noon at the top (today, heart rate)
// - night: a 12-hour watch face, so a night sits on the hours you slept (sleep)
// - session: one workout is one lap, with a gap at the top for the heart-rate scale (strength)
// - mini: the same day / night dials at calendar size
// Everything returns SVG strings; colors come from CSS variables, as in charts.js.
const TAU = Math.PI * 2;
const f2 = (x) => (Math.round(x * 100) / 100).toString();
const hoursOf = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export const STAGE_COLOR = { DEEP: 'var(--deep)', LIGHT: 'var(--light)', REM: 'var(--rem)', AWAKE: 'var(--awake-strong)', ASLEEP: 'var(--light)' };
export const KIND_COLOR = { strength: 'var(--strength)', basketball: 'var(--ball)', other: 'var(--other)' };

export function makeDial({ cx, cy, mode, from = 0, to = 1, gap = 0 }) {
  let ang;
  if (mode === 'day') ang = (t) => (hoursOf(t) / 24) * TAU + Math.PI;
  else if (mode === 'night') ang = (t) => ((hoursOf(t) % 12) / 12) * TAU;
  else ang = (t) => gap / 2 + ((t - from) / (to - from)) * (TAU - gap);
  const span = mode === 'day' ? 864e5 : mode === 'night' ? 432e5 : ((to - from) * TAU) / (TAU - gap);
  const pt = (a, r) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const P = (a, r) => pt(a, r).map(f2).join(',');
  // a ring segment from t0 to t1 between radii r0 and r1
  const arc = (t0, t1, r0, r1) => {
    const a0 = ang(t0), a1 = a0 + (Math.max(0, t1 - t0) / span) * TAU, big = a1 - a0 > Math.PI ? 1 : 0;
    return `M${P(a0, r1)}A${f2(r1)},${f2(r1)} 0 ${big} 1 ${P(a1, r1)}L${P(a1, r0)}A${f2(r0)},${f2(r0)} 0 ${big} 0 ${P(a0, r0)}Z`;
  };
  const line = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + P(ang(p.t), p.r)).join('');
  return { ang, pt, P, arc, line, span, cx, cy };
}

const svg = (w, h, body, cls = 'dial') => `<svg class="${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const T = (x, y, s, cls = '', anchor = 'middle', style = '') => `<text x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}"${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}>${s}</text>`;

// heart rate as a line whose distance from the centre is the bpm; breaks where there is no data
function hrPath(K, pts, rOf, maxGap = 15 * 60e3) {
  let d = '', prev = null;
  for (const p of pts) {
    if (p.v == null) continue;
    d += (prev && p.t - prev.t <= maxGap ? 'L' : 'M') + K.P(K.ang(p.t), rOf(p.v));
    prev = p;
  }
  return d;
}

// leader from the ring to the nearest side edge, with two lines of text; never leaves the screen
function edgeLabel(K, t, title, sub, { dy = 0, r = 130, W = 393, dim = false } = {}) {
  const a = K.ang(t), right = Math.sin(a) >= 0, [lx, ly] = K.pt(a, r), y = ly + dy, x = right ? W - 8 : 8;
  const ex = right ? Math.max(lx + 10, W - 93) : Math.min(lx - 10, 93);
  return `<g class="dl${dim ? ' dim' : ''}"><polyline points="${f2(lx)},${f2(ly)} ${f2(ex)},${f2(y + 18)} ${x},${f2(y + 18)}" fill="none" class="lead"/>`
    + T(x, y - 2, esc(title), 'lb', right ? 'end' : 'start') + T(x, y + 13, esc(sub), 'ls', right ? 'end' : 'start') + '</g>';
}
// spread labels on each side so they don't overlap
function placeLabels(K, items, { gapPx = 40 } = {}) {
  const sides = { L: [], R: [] };
  for (const it of items) { const a = K.ang(it.t); const [, y] = K.pt(a, 130); (Math.sin(a) >= 0 ? sides.R : sides.L).push({ ...it, y }); }
  for (const list of Object.values(sides)) {
    list.sort((a, b) => a.y - b.y);
    let floor = -Infinity;
    for (const it of list) { const y = Math.max(it.y - 16, floor); it.dy = y - it.y + 0; floor = y + gapPx; }
  }
  return [...sides.L, ...sides.R];
}

/**
 * The 24-hour dial for Today.
 * end: the dial shows the 24 hours before it. sleeps: [{start, end, stages}], workouts: [{start, end, kind, title, sub, key}].
 * hr: [{t, v}] or null while loading. sel: key of the highlighted thing. center: {k, v, unit, n}.
 */
export function dayDial({ end, sleeps = [], workouts = [], hr = null, sel = null, center, labels = [] }) {
  const W = 393, H = 372, cx = W / 2, cy = 184;
  const K = makeDial({ cx, cy, mode: 'day' });
  const start = end - 864e5;
  const R0 = 86, R1 = 124, rOf = (v) => R0 + (Math.max(45, Math.min(175, v)) - 45) / 130 * (R1 - R0);
  let g = `<circle cx="${cx}" cy="${cy}" r="128" class="rim"/>`;
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * TAU + Math.PI, L = h % 6 === 0;
    const [x0, y0] = K.pt(a, 128), [x1, y1] = K.pt(a, L ? 119 : 124);
    g += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="${L ? 'tkl' : 'tk'}"/>`;
    if (L) { const [tx, ty] = K.pt(a, 141); g += T(tx, ty + 5, h, 'tn'); }
  }
  // bpm reference rings, labelled next to the now hand
  for (const v of [60, 120]) {
    g += `<circle cx="${cx}" cy="${cy}" r="${f2(rOf(v))}" class="refc"/>`;
    const [x, y] = K.pt(K.ang(end) + 0.09, rOf(v)); g += T(x, y + 4, v, 'halo refn');
  }
  if (hr?.length) {
    const pts = hr.filter((p) => p.t >= start && p.t <= end);
    const selW = workouts.find((w) => w.key === sel);
    g += `<path d="${hrPath(K, pts, rOf)}" class="hrl${sel ? ' dim' : ''}"/>`;
    if (selW) g += `<path d="${hrPath(K, pts.filter((p) => p.t >= selW.start && p.t <= selW.end), rOf)}" class="hrl strong"/>`;
  }
  const clip = (a, b) => [Math.max(a, start), Math.min(b, end)];
  for (const s of sleeps) {
    const dim = sel && sel !== 'sleep' ? ' opacity=".22"' : '';
    const stages = s.stages?.length ? s.stages : [{ type: 'ASLEEP', s: s.start, e: s.end }];
    for (const st of stages) { const [a, b] = clip(st.s, st.e); if (b > a) g += `<path d="${K.arc(a, b, st.type === 'DEEP' ? 66 : 71, 82)}" fill="${STAGE_COLOR[st.type] || 'var(--light)'}"${dim}/>`; }
  }
  for (const w of workouts) {
    const [a, b] = clip(w.start, w.end); if (b <= a) continue;
    const on = sel === w.key, dim = sel && !on ? ' opacity=".22"' : '';
    g += `<path d="${K.arc(a, b, on ? 62 : 66, on ? 86 : 82)}" fill="${KIND_COLOR[w.kind] || 'var(--other)'}"${dim}/>`;
  }
  const [nx, ny] = K.pt(K.ang(end), 131), [nx2, ny2] = K.pt(K.ang(end), 64);
  g += `<line x1="${f2(nx2)}" y1="${f2(ny2)}" x2="${f2(nx)}" y2="${f2(ny)}" class="hand"/><circle cx="${f2(nx)}" cy="${f2(ny)}" r="3.5" class="handdot"/>`;
  for (const l of placeLabels(K, labels)) g += edgeLabel(K, l.t, l.title, l.sub, { dy: l.dy, dim: sel && sel !== l.key });
  g += centerText(cx, cy, center);
  return svg(W, H, g);
}

function centerText(cx, cy, c) {
  if (!c) return '';
  const big = String(c.v).length > 3 ? 56 : 76;
  return T(cx, cy - 34, esc(c.k), 'ck') + `<text x="${cx}" y="${cy + 24}" text-anchor="middle" class="cv" style="font-size:${big}px">${esc(c.v)}${c.unit ? `<tspan class="cu" dx="4">${esc(c.unit)}</tspan>` : ''}</text>` + (c.n ? T(cx, cy + 46, esc(c.n), 'ck') : '');
}

// One ring per sleep stage, like a hypnogram wrapped around a 12-hour watch: deep inside, awake outside.
const BAND = { AWAKE: [118, 126], REM: [104, 115], LIGHT: [90, 101], DEEP: [68, 87], ASLEEP: [90, 101] };
export function nightDial(n, { hr = null, center } = {}) {
  const W = 393, H = 384, cx = W / 2, cy = 194;
  const K = makeDial({ cx, cy, mode: 'night' });
  let g = `<circle cx="${cx}" cy="${cy}" r="150" class="rim"/>`;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU, L = i % 5 === 0;
    const [x0, y0] = K.pt(a, 150), [x1, y1] = K.pt(a, L ? 144 : 147);
    g += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="${L ? 'tkl' : 'tk'}"/>`;
  }
  for (const [h, lab] of [[0, '12'], [3, '3'], [6, '6'], [9, '9']]) { const [x, y] = K.pt((h / 12) * TAU, 164); g += T(x, y + 5, lab, 'tn', 'middle', 'font-size:17px'); }
  const stages = n.hasStages ? n.stages : [{ type: 'ASLEEP', s: n.start, e: n.end }];
  const used = n.hasStages ? ['AWAKE', 'REM', 'LIGHT', 'DEEP'] : ['ASLEEP'];
  for (const k of used) { const [r0, r1] = BAND[k]; g += `<path d="${K.arc(n.start, n.end, r0, r1)}" class="track"/>`; }
  stages.forEach((st, i) => {
    const nx = stages[i + 1]; if (!nx || !BAND[st.type] || !BAND[nx.type]) return;
    const a = BAND[st.type], b = BAND[nx.type], lo = Math.min(a[0], b[0]), hi = Math.max(a[1], b[1]);
    const [x0, y0] = K.pt(K.ang(st.e), lo), [x1, y1] = K.pt(K.ang(st.e), hi);
    g += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="step"/>`;
  });
  for (const st of stages) { const b = BAND[st.type]; if (b) g += `<path d="${K.arc(st.s, st.e, b[0], b[1])}" fill="${STAGE_COLOR[st.type]}"/>`; }
  if (n.hasStages) for (const [k, name] of [['AWAKE', '清醒'], ['REM', 'REM'], ['LIGHT', '浅睡'], ['DEEP', '深睡']]) { const [r0, r1] = BAND[k]; const [x, y] = K.pt(K.ang(n.start) - 0.05, (r0 + r1) / 2); g += T(x - 4, y + 4, name, 'ls', 'end', 'font-size:11px'); }
  // heart rate just outside the awake ring, with its lowest point
  if (hr?.length) {
    const pts = hr.filter((p) => p.t >= n.start && p.t <= n.end && p.v != null);
    if (pts.length > 2) {
      const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(lo + 12, Math.max(...pts.map((p) => p.v)));
      const rOf = (v) => 130 + ((v - lo) / (hi - lo)) * 16;
      g += `<path d="${hrPath(K, pts, rOf)}" class="hrl thin"/>`;
      const m = pts.reduce((a, p) => (p.v < a.v ? p : a)); const [x, y] = K.pt(K.ang(m.t), rOf(m.v));
      g += `<circle cx="${f2(x)}" cy="${f2(y)}" r="3" class="hrdot"/>`;
    }
  }
  for (const [t, lab] of [[n.start, `${hm(n.start)} 入睡`], [n.end, `${hm(n.end)} 醒来`]]) {
    const a = K.ang(t), [x0, y0] = K.pt(a, 66), [x1, y1] = K.pt(a, 152), [tx, ty] = K.pt(a, 176);
    g += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="hand thin"/>` + T(tx, ty, lab, 'lb', Math.sin(a) > 0 ? 'start' : 'end');
  }
  g += centerText(cx, cy - 4, center);
  return svg(W, H, g);
}

// a small night dial for a row of seven
export function miniNight(n, S = 48) {
  const c = S / 2, K = makeDial({ cx: c, cy: c, mode: 'night' });
  const BB = { AWAKE: [20.5, 23], REM: [17, 20], LIGHT: [13.5, 16.5], DEEP: [8.5, 13], ASLEEP: [13.5, 16.5] };
  let g = `<circle cx="${c}" cy="${c}" r="${c - 1}" class="rim"/>`;
  if (n) for (const st of (n.hasStages ? n.stages : [{ type: 'ASLEEP', s: n.start, e: n.end }])) { const b = BB[st.type]; if (b) g += `<path d="${K.arc(st.s, st.e, b[0], b[1])}" fill="${STAGE_COLOR[st.type]}"/>`; }
  return svg(S, S, g, 'mini');
}

/**
 * A calendar day for 运动: filled with the main workout's color and name, the ring shows when.
 * ws: [{start, end, kind, short}] (short = 力量 / 篮球 / 散步…)
 */
export function miniWorkoutDay({ dayStart, ws, label, today = false, S = 50 }) {
  const c = S / 2, K = makeDial({ cx: c, cy: c, mode: 'day' }), r = c - 7;
  const has = (k) => ws.some((w) => w.kind === k);
  const both = has('strength') && has('basketball');
  const main = [...ws].sort((a, b) => (b.kind !== 'other') - (a.kind !== 'other') || (b.end - b.start) - (a.end - a.start))[0];
  let g = `<circle cx="${c}" cy="${c}" r="${c - 1.5}" class="mtrack"/>`;
  if (both) g += `<path d="M${c - r},${c}A${r},${r} 0 0 1 ${c + r},${c}Z" fill="var(--strength)"/><path d="M${c - r},${c}A${r},${r} 0 0 0 ${c + r},${c}Z" fill="var(--ball)"/><line x1="${c - r}" x2="${c + r}" y1="${c}" y2="${c}" class="split"/>`;
  else if (main) g += `<circle cx="${c}" cy="${c}" r="${r}" fill="${KIND_COLOR[main.kind]}"/>`;
  for (const w of ws) g += `<path d="${K.arc(Math.max(dayStart, w.start - 12e5), Math.min(dayStart + 864e5, w.end + 12e5), c - 4.5, c + 1)}" fill="${KIND_COLOR[w.kind]}"/>`;
  if (today) g += `<circle cx="${c}" cy="${c}" r="${c + 1}" class="todayc"/>`;
  if (both) g += T(c, c - 4, '力量', 'mname', 'middle', 'font-size:10px') + T(c, c + 12, '篮球', 'mname', 'middle', 'font-size:10px');
  else if (main) g += T(c, c - 1, esc(main.short), 'mname') + T(c, c + 12, esc(label), 'mdate');
  else g += T(c, c + 5, esc(label), 'mempty');
  return `<svg class="mini" viewBox="-2 -2 ${S + 4} ${S + 4}" width="${S}" height="${S}">${g}</svg>`;
}

/**
 * One strength session as one lap. pts: 1-minute HR; peaks: [{t, v, lift}] one per set;
 * sets: [{reps, lift}] in the same order; groups: [{name, sub, a, b}] for the labels outside.
 */
export function sessionDial({ start, end, pts = [], peaks = [], sets = [], groups = [], zones }) {
  const W = 393, H = 392, cx = W / 2, cy = 200, GAP = 0.5;
  const K = makeDial({ cx, cy, mode: 'session', from: start, to: end, gap: GAP });
  const vals = pts.map((p) => p.v).filter((v) => v != null);
  const LO = vals.length ? Math.max(40, Math.floor((Math.min(...vals) - 5) / 10) * 10) : 80;
  const HI = vals.length ? Math.max(LO + 50, Math.ceil((Math.max(...vals) + 5) / 10) * 10) : 150;
  const R0 = 100, R1 = 148, rOf = (v) => R0 + (Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO) * (R1 - R0);
  let g = '';
  if (zones) {
    const band = (v0, v1, op) => (v1 > LO && v0 < HI ? `<path d="${K.arc(start, end, rOf(Math.max(v0, LO)), rOf(Math.min(v1, HI)))}" fill="var(--hr)" opacity="${op}"/>` : '');
    g += band(zones.moderate[0], zones.vigorous[0], 0.07) + band(zones.vigorous[0], HI, 0.15);
    for (const [v0, v1, name] of [[zones.moderate[0], zones.vigorous[0], '中等'], [zones.vigorous[0], HI, '剧烈']]) {
      if (v0 >= HI || rOf(Math.min(v1, HI)) - rOf(Math.max(v0, LO)) < 13) continue;
      const [x, y] = K.pt(GAP / 2 + 0.02, (rOf(Math.max(v0, LO)) + rOf(Math.min(v1, HI))) / 2); g += T(x + 2, y + 4, name, 'zn', 'start');
    }
  }
  const step = HI - LO > 70 ? 30 : 20;
  for (let v = Math.ceil(LO / step) * step; v <= HI; v += step) {
    if (v === LO) continue;
    g += `<path d="${K.arc(start, end, rOf(v) - 0.4, rOf(v) + 0.4)}" class="refa"/>` + T(cx, cy - rOf(v) + 4, v, 'refn');
  }
  g += T(cx, cy - R1 - 6, 'bpm', 'ls', 'middle', 'font-size:10px');
  const min = (end - start) / 60e3;
  g += `<circle cx="${cx}" cy="${cy}" r="158" class="rim"/>`;
  const every = min > 75 ? 15 : 10;
  for (let m = 0; m <= min; m++) {
    const a = K.ang(start + m * 60e3), L = m % every === 0;
    const [x0, y0] = K.pt(a, 158), [x1, y1] = K.pt(a, L ? 151 : 155);
    if (L || min <= 90) g += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="${L ? 'tkl' : 'tk'}"/>`;
    if (L) { const [tx, ty] = K.pt(a, 170); g += T(tx, ty + 5, m ? `${m} 分` : hm(start), 'tn', 'middle', 'font-size:14px'); }
  }
  if (pts.length) g += `<path d="${hrPath(K, pts.filter((p) => p.t >= start && p.t <= end), rOf, 5 * 60e3)}" class="hrl"/>`;
  peaks.forEach((p, i) => {
    const s = sets[i];
    g += `<path d="${K.arc(p.t - 80e3, p.t + 80e3, 62, 86)}" fill="var(${s && s.second ? '--strength-2' : '--strength'})"/>`;
    if (s) { const [x, y] = K.pt(K.ang(p.t), 74); g += T(x, y + 6, s.reps, 'reps'); }
    const [px, py] = K.pt(K.ang(p.t), rOf(p.v)); g += `<circle cx="${f2(px)}" cy="${f2(py)}" r="2.6" class="hrdot"/>`;
    const [qx, qy] = K.pt(K.ang(p.t), rOf(p.v) - 12); g += T(qx, qy + 4, Math.round(p.v), 'halo pkn');
  });
  for (const gr of groups) {
    const a = K.ang((gr.a + gr.b) / 2), [, y] = K.pt(a, 186), right = Math.sin(a) > 0, x = right ? W - 8 : 8;
    g += T(x, y, esc(gr.name), 'lb', right ? 'end' : 'start') + T(x, y + 15, esc(gr.sub), 'ls', right ? 'end' : 'start');
  }
  const top = vals.length ? Math.round(Math.max(...pts.filter((p) => p.t >= start && p.t <= end).map((p) => p.hi ?? p.v))) : null;
  g += centerText(cx, cy, { k: '一共', v: peaks.length || '—', unit: peaks.length ? '组' : '', n: top ? `最高 ${top} bpm` : '' });
  return svg(W, H, g);
}

/** Heart rate for one day on the 24-hour dial, with labelled bpm rings and the resting rate. */
export function hrDayDial({ dayStart, pts = [], rest, sleeps = [], workouts = [], now }) {
  const W = 393, H = 380, cx = W / 2, cy = 190;
  const K = makeDial({ cx, cy, mode: 'day' });
  const end = Math.min(dayStart + 864e5, now ?? Infinity);
  const vals = pts.map((p) => p.hi ?? p.v).filter((v) => v != null);
  const LO = 40, HI = Math.max(140, Math.ceil(((vals.length ? Math.max(...vals) : 140) + 5) / 20) * 20);
  const R0 = 70, R1 = 140, rOf = (v) => R0 + (Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO) * (R1 - R0);
  let g = `<circle cx="${cx}" cy="${cy}" r="150" class="rim"/>`;
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * TAU + Math.PI, L = h % 6 === 0;
    const [x0, y0] = K.pt(a, 150), [x1, y1] = K.pt(a, L ? 141 : 146);
    g += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="${L ? 'tkl' : 'tk'}"/>`;
    if (L) { const [tx, ty] = K.pt(a, 163); g += T(tx, ty + 5, h, 'tn'); }
  }
  // what you were doing, on a thin inner ring
  for (const s of sleeps) { const a = Math.max(s.start, dayStart), b = Math.min(s.end, dayStart + 864e5); if (b > a) g += `<path d="${K.arc(a, b, 58, 64)}" fill="var(--light)"/>`; }
  for (const w of workouts) { const a = Math.max(w.start, dayStart), b = Math.min(w.end, dayStart + 864e5); if (b > a) g += `<path d="${K.arc(a, b, 56, 66)}" fill="${KIND_COLOR[w.kind] || 'var(--other)'}"/>`; }
  for (let v = 60; v <= HI; v += 40) {
    g += `<circle cx="${cx}" cy="${cy}" r="${f2(rOf(v))}" class="refc"/>`;
    g += T(cx + 3, cy - rOf(v) + 4, v, 'halo refn', 'start');
  }
  if (rest) { g += `<circle cx="${cx}" cy="${cy}" r="${f2(rOf(rest))}" class="restc"/>`; g += T(cx, cy + rOf(rest) - 6, `静息 ${Math.round(rest)}`, 'halo restn', 'middle'); }
  const ps = pts.filter((p) => p.t >= dayStart && p.t <= end);
  if (ps.length) {
    g += `<path d="${hrPath(K, ps, rOf)}" class="hrl"/>`;
    const top = ps.reduce((a, p) => ((p.hi ?? p.v) > (a.hi ?? a.v) ? p : a));
    const [x, y] = K.pt(K.ang(top.t), rOf(top.hi ?? top.v)); g += `<circle cx="${f2(x)}" cy="${f2(y)}" r="3" class="hrdot"/>`;
    const [qx, qy] = K.pt(K.ang(top.t), rOf(top.hi ?? top.v) + 12); g += T(qx, qy + 4, Math.round(top.hi ?? top.v), 'halo pkn');
  }
  if (now && now < dayStart + 864e5) { const [nx, ny] = K.pt(K.ang(now), 152), [nx2, ny2] = K.pt(K.ang(now), 50); g += `<line x1="${f2(nx2)}" y1="${f2(ny2)}" x2="${f2(nx)}" y2="${f2(ny)}" class="hand"/><circle cx="${f2(nx)}" cy="${f2(ny)}" r="3.5" class="handdot"/>`; }
  return svg(W, H, g);
}
