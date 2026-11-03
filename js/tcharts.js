// Charts for the strength page: set blocks, per-lift progress, sets per body part, calendar,
// weekly sets, heart rate through a session. Lifts are named, never color-coded.
import { esc, md, clamp, parseYmd, ymd, addDays, wd, wk } from './util.js';
import { lift, setLoad } from './training.js';
import { tipAttr, niceTicks, tw } from './charts.js';

const r1 = (n) => Math.round(n * 10) / 10;
const svg = (W, H, body, cls = '') => `<svg viewBox="0 0 ${W} ${H}" class="${cls}" role="img">${body}</svg>`;
const T = (x, y, s, cls = 'ax', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const R = (x, y, w, h, fill, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}" fill="${fill}"${extra}/>`;
const C = (cx, cy, r, fill, extra = '') => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"${extra}/>`;
const L = (x1, y1, x2, y2, stroke, extra = '') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${stroke}"${extra}/>`;

// One block per set: width = reps, height = weight (one scale across rows so lifts compare).
// A set called hard is hatched.
let pat = 0;
export function setBlocks(id, sets, { W = 190, H = 30, maxReps = 12, maxLoad = 150, slots = 5 } = {}) {
  const lf = lift(id);
  const n = Math.max(slots, sets.length);
  const slot = W / n;
  const hatch = 'sb' + ++pat;
  let g = sets.some((s) => s.hard)
    ? `<defs><pattern id="${hatch}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--strength-soft)"/><rect width="2.2" height="5" fill="var(--strength)"/></pattern></defs>`
    : '';
  sets.forEach((s, i) => {
    const load = setLoad(id, s);
    const w = clamp(s.reps / maxReps, 0.22, 1) * (slot - 5);
    const h = lf.bodyweight ? (load > 0 ? 10 + (load / maxLoad) * (H - 10) : H * 0.42) : 7 + clamp(load / maxLoad, 0, 1) * (H - 7);
    const tip = `<b>${lf.name} 第 ${i + 1} 组</b><br>${s.reps} 次${lf.bodyweight ? (load ? ` · 负重 ${load} kg` : '') : ` · ${s.kg} kg`}${s.note ? `<br>${esc(s.note)}` : s.hard ? '<br>吃力' : ''}`;
    g += R(i * slot, H - h, w, h, s.hard ? `url(#${hatch})` : 'var(--strength)', ` rx="3"${s.hard ? ' stroke="var(--strength)" stroke-width="1.2"' : ''}${tipAttr(tip)}`);
  });
  return svg(W, H, g, 'blocks');
}

// The heaviest set of each session (most reps for body-weight lifts). The first and last values
// are written out; the latest personal record is named.
export function liftProgress(points, { id, from, to, W = 330, H = 64 } = {}) {
  if (!points.length) return '';
  const lf = lift(id), unit = lf.bodyweight ? '次' : 'kg';
  const t0 = +parseYmd(from), t1 = +parseYmd(to);
  const Lx = 5, Rx = 5, top = 20, bottom = H - 6;
  const x = (d) => Lx + ((+parseYmd(d) - t0) / (t1 - t0 || 1)) * (W - Lx - Rx);
  let lo = Math.min(...points.map((p) => p.top)), hi = Math.max(...points.map((p) => p.top));
  const span = lf.bodyweight ? 3 : 10;
  if (hi - lo < span) { const c = (hi + lo) / 2; lo = c - span / 2; hi = c + span / 2; }
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bottom - top);
  let g = '';
  if (points.length > 1) g += `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${r1(x(p.date))},${r1(y(p.top))}`).join(' ')}" fill="none" stroke="var(--strength)" stroke-width="1.6" stroke-linejoin="round"/>`;
  for (const p of points) {
    g += C(x(p.date), y(p.top), 3.2, 'var(--strength)', ` data-act="session" data-id="${esc(p.id)}"${tipAttr(`<b>${md(parseYmd(p.date))}</b> ${p.top} ${unit}${p.pr ? ' · 新纪录' : ''}<br>训练量 ${Math.round(p.vol).toLocaleString('en-US')}${lf.bodyweight ? ' 次' : ' kg'}`)}`);
  }
  const first = points[0], last = points.at(-1), pr = points.filter((p) => p.pr).at(-1);
  const lastText = `${last.top} ${unit}${pr === last ? ' · 新纪录' : ''}`;
  const lastX0 = x(last.date) + 2 - tw(lastText, 13); // where the last label starts
  if (points.length > 1) g += T(x(first.date), y(first.top) - 8, String(first.top), 'ax ref', 'start');
  g += T(x(last.date) + 2, y(last.top) - 8, lastText, 'lbl b ref', 'end');
  if (pr && pr !== last) {
    // "新纪录" goes where it touches neither the line nor the other labels:
    // above its ring, then above to the left, then below
    const px = x(pr.date), py = y(pr.top), w = tw('新纪录');
    const pts = points.map((p) => [x(p.date), y(p.top)]);
    const labels = [[lastX0, x(last.date) + 2, y(last.top) - 8]];
    if (points.length > 1) labels.push([x(first.date), x(first.date) + tw(String(first.top)), y(first.top) - 8]);
    const free = ([x0, base]) => {
      const a = x0 - 3, b = x0 + w + 3, t = base - 12, u = base + 5; // the text box plus a dot's radius
      if (x0 < 0 || x0 + w > W || base - 9 < 0 || base + 2 > H) return false;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1] || pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
        for (let s = 0; s <= n; s++) { const qx = x1 + ((x2 - x1) * s) / n, qy = y1 + ((y2 - y1) * s) / n; if (qx >= a && qx <= b && qy >= t && qy <= u) return false; }
      }
      return labels.every(([l0, l1, lb]) => l1 + 2 < x0 || l0 - 2 > x0 + w || lb - 11 > base + 2 || lb + 2 < base - 9);
    };
    const spots = [[px - w / 2, py - 9], [Math.min(px - 7, lastX0 - 4) - w, py - 9], [px - w / 2, py + 17], [px - 7 - w, py + 15]];
    const at = spots.find(free);
    g += C(px, py, 5.5, 'none', ' stroke="var(--text)" stroke-width="1.2"');
    if (at) g += T(at[0], at[1], '新纪录', 'ax ref', 'start');
  }
  return svg(W, H, g, 'lp');
}

// sets per body part, most first, in whole sets; the parts not trained go on one line
export function partBars(parts, names) {
  const rows = Object.entries(parts).map(([k, v]) => ({ k, n: Math.round(v) })).sort((a, b) => b.n - a.n);
  const done = rows.filter((r) => r.n > 0), none = rows.filter((r) => r.n <= 0);
  const max = Math.max(1, ...done.map((r) => r.n));
  return `<div class="hbars">${done.map((r) => `<div class="hb"><span class="k">${esc(names[r.k])}</span><span class="bar"><i style="width:${(r.n / max) * 100}%;background:var(--strength)"></i></span><span class="v">${r.n} 组</span></div>`).join('')}</div>${none.length ? `<div class="foot">没练：${none.map((r) => esc(names[r.k])).join('、')}</div>` : ''}`;
}

// Calendar: the date in every cell, the lifts done that day by their one-character name
// (蹲 推 拉 引), 篮 for basketball. row = one row of 7 days ending today (the week view).
export function trainCal({ start, end, byDate, todayKey, row = false }) {
  const cell = (d, inRange) => {
    const key = ymd(d), x = inRange ? byDate[key] : null;
    const names = (x?.lifts || []).map((l) => lift(l).abbr);
    const tip = x ? `<b>${md(d)}</b> ${[...(x.lifts || []).map((l) => lift(l).name), x.ball ? '篮球' : ''].filter(Boolean).join(' · ')}` : '';
    const dn = d.getDate() === 1 ? `${d.getMonth() + 1}月` : String(d.getDate());
    return `<div class="cal-c${inRange ? '' : ' off'}${key === todayKey ? ' today' : ''}${names.length ? ' on' : ''}"${x?.session ? ` data-act="session" data-id="${esc(x.session)}"` : ''}${tip ? tipAttr(tip) : ''}>`
      + (inRange ? `<span class="dn">${dn}</span><span class="tl">${names.map((a) => `<b>${esc(a)}</b>`).join('')}${x?.ball ? '<b class="ball">篮</b>' : ''}</span>` : '') + '</div>';
  };
  if (row) {
    let html = '<div class="cal">';
    for (let d = start; d <= end; d = addDays(d, 1)) html += `<div class="cal-h">${wk(d)}</div>`;
    for (let d = start; d <= end; d = addDays(d, 1)) html += cell(d, true);
    return html + '</div>';
  }
  const s = addDays(start, -wd(start));
  let html = `<div class="cal">${'一二三四五六日'.split('').map((c) => `<div class="cal-h">${c}</div>`).join('')}`;
  for (let d = s; ; d = addDays(d, 1)) {
    html += cell(d, d >= start && d <= end);
    if (d >= end && wd(d) === 6) break;
  }
  return html + '</div>';
}

// sets per 7 days, one color; the latest week's total is written on its bar
export function weeklySets(weeks, { W = 330, H = 140 } = {}) {
  const tot = (w) => Object.values(w.by).reduce((a, v) => a + v, 0);
  const max = Math.max(4, ...weeks.map(tot)) * 1.15;
  const ticks = niceTicks(0, max, 3).filter((t) => t > 0 && t <= max);
  const top = 16, B = 20;
  const lab = (t) => (t === Math.max(...ticks) ? `${t} 组` : String(t));
  const Lw = Math.ceil(Math.max(...ticks.map((t) => tw(lab(t))))) + 6;
  const y = (v) => top + (1 - v / max) * (H - top - B);
  const step = (W - Lw) / weeks.length, bw = Math.min(22, step * 0.62);
  let g = ticks.map((t) => L(Lw, y(t), W, y(t), 'var(--grid)') + T(0, y(t) + 4, lab(t))).join('') + L(Lw, y(0), W, y(0), 'var(--line)');
  weeks.forEach((w, i) => {
    const cx = Lw + step * i + step / 2, v = tot(w);
    if (v) g += R(cx - bw / 2, y(v), bw, y(0) - y(v), 'var(--strength)', ' rx="2"');
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${w.label}</b> ${v} 组<br>${Object.entries(w.by).map(([k, n]) => `${lift(k).name} ${n}`).join(' · ')}`)}`);
  });
  const last = weeks.at(-1);
  if (tot(last)) g += T(Lw + step * (weeks.length - 0.5), y(tot(last)) - 5, String(tot(last)), 'lbl b', 'middle');
  g += T(Lw, H - 4, `${weeks.length - 1} 周前`, 'ax') + T(W, H - 4, '近 7 天', 'ax', 'end');
  return svg(W, H, g);
}

// heart rate through a session: a dot per set, and under the curve the stretch each lift took, named
export function sessionHr(points, { start, end, peaks = [], spans = [], W = 330, H = 112 } = {}) {
  if (points.length < 2) return '';
  const top = 20, bottom = H - 34;
  const lo = Math.min(...points.map((p) => p.v)) - 4, hi = Math.max(...points.map((p) => p.v)) + 6;
  const x = (t) => 4 + ((t - start) / (end - start || 1)) * (W - 8);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bottom - top);
  let g = `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${r1(x(p.t))},${r1(y(p.v))}`).join(' ')}" fill="none" stroke="var(--hr)" stroke-width="1.6" stroke-linejoin="round"/>`;
  for (const p of peaks) g += C(x(p.t), y(p.v), 3.4, 'var(--text)', tipAttr(`${Math.round(p.v)} bpm`));
  const pk = peaks.length ? peaks.reduce((a, p) => (p.v > a.v ? p : a)) : null;
  if (pk) g += T(clamp(x(pk.t), 40, W - 40), 10, `最高 ${Math.round(pk.v)} bpm`, 'ax ref', 'middle');
  g += L(4, bottom + 6, W - 4, bottom + 6, 'var(--line)');
  for (const s of spans) {
    const a = x(s.a), w = Math.max(6, x(s.b) - a);
    const name = tw(s.name) + 4 < w ? s.name : s.abbr;
    g += R(a, bottom + 11, w, 5, 'var(--strength)', ' rx="2.5"') + T(a + w / 2, bottom + 29, name, 'ax', 'middle');
  }
  return svg(W, H, g);
}
