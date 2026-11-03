// One drawing routine for every dial in the 日晷 concept: a day (24 h, midnight at the bottom),
// a night (12 h watch face, 12 at the top), a workout (the session is one lap) and the small month dials.
const TAU = Math.PI * 2;
export const COLORS = { DEEP: 'var(--deep)', LIGHT: 'var(--light)', REM: 'var(--rem)', AWAKE: 'var(--awake)', strength: 'var(--str)', walk: 'var(--walk)', ball: 'var(--ball)' };
const hoursOf = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

export function makeDial({ cx, cy, mode, from, to, gap = 0 }) {
  let ang;
  if (mode === 'day') ang = (t) => (hoursOf(t) / 24) * TAU + Math.PI;
  else if (mode === 'night') ang = (t) => ((hoursOf(t) % 12) / 12) * TAU;
  else ang = (t) => gap / 2 + ((t - from) / (to - from)) * (TAU - gap);
  const span = mode === 'day' ? 864e5 : mode === 'night' ? 432e5 : (to - from) * TAU / (TAU - gap);
  const pt = (a, r) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const P = (a, r) => pt(a, r).map((v) => v.toFixed(2)).join(',');
  const arc = (t0, t1, r0, r1) => {
    const a0 = ang(t0), a1 = a0 + ((t1 - t0) / span) * TAU, big = a1 - a0 > Math.PI ? 1 : 0;
    return `M${P(a0, r1)}A${r1},${r1} 0 ${big} 1 ${P(a1, r1)}L${P(a1, r0)}A${r0},${r0} 0 ${big} 0 ${P(a0, r0)}Z`;
  };
  // a continuous polar line through points [{t, r}], unwrapping the angle so it never jumps
  const polar = (pts) => { let prev = null, off = 0; return pts.map((p, i) => { let a = ang(p.t) + off; if (prev != null && a < prev - Math.PI) { off += TAU; a += TAU; } prev = a; return (i ? 'L' : 'M') + P(a, p.r); }).join(''); };
  const ticks = ({ r, n, every, label, long = 1, fmt = (i) => i, lr = r + 12, cls = 'tk' }) => {
    let g = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (mode === 'day' ? Math.PI : 0), isL = i % every === 0;
      g += `<line x1="${P(a, r).split(',')[0]}" y1="${P(a, r).split(',')[1]}" x2="${P(a, r - (isL ? 7 * long : 3.5 * long)).split(',')[0]}" y2="${P(a, r - (isL ? 7 * long : 3.5 * long)).split(',')[1]}" class="${isL ? 'tkl' : 'tk'}"/>`;
      if (label && isL) { const [x, y] = pt(a, lr); g += `<text x="${x}" y="${y + 4.5}" text-anchor="middle" class="tn">${fmt(i)}</text>`; }
    }
    return g;
  };
  return { ang, pt, P, arc, polar, ticks, span, cx, cy };
}

export const smooth = (pts, k = 2) => pts.map((p, i) => { const w = pts.slice(Math.max(0, i - k), i + k + 1); return { t: p.t, v: w.reduce((a, x) => a + x.v, 0) / w.length }; });

// the heart-rate corona: a filled band whose outer edge follows bpm
export function corona(D, hr, r0, r1, { lo = 45, hi = 175, id = 'cg', color = 'var(--hr)', width = 1.2, fill = true } = {}) {
  const pts = hr.map((p) => ({ t: p.t, r: r0 + (Math.max(lo, Math.min(hi, p.v)) - lo) / (hi - lo) * (r1 - r0) }));
  const line = D.polar(pts);
  let g = '';
  if (fill) {
    const inner = D.polar([...hr].reverse().map((p) => ({ t: p.t, r: r0 })));
    g += `<defs><radialGradient id="${id}" cx="${D.cx}" cy="${D.cy}" r="${r1}" gradientUnits="userSpaceOnUse"><stop offset="${(r0 / r1).toFixed(2)}" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity=".32"/></radialGradient></defs>`;
    g += `<path d="${line}L${inner.slice(1)}Z" fill="url(#${id})"/>`;
  }
  return g + `<path d="${line}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;
}
