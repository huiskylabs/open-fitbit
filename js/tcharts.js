// Charts for the training page: set blocks, per-lift progress, body heat map, calendar, weekly sets.
import { esc, md, clamp, parseYmd, ymd, addDays, wd } from './util.js';
import { lift, setLoad } from './training.js';
import { tipAttr, niceTicks } from './charts.js';

const r1 = (n) => Math.round(n * 10) / 10;
const svg = (W, H, body, cls = '') => `<svg viewBox="0 0 ${W} ${H}" class="${cls}" role="img">${body}</svg>`;
const T = (x, y, s, cls = 'ax', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const R = (x, y, w, h, fill, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}" fill="${fill}"${extra}/>`;
const C = (cx, cy, r, fill, extra = '') => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"${extra}/>`;

// One block per set: width = reps, height = weight (shared scale across rows so lifts compare).
export function setBlocks(id, sets, { W = 190, H = 30, maxReps = 12, maxLoad = 150, slots = 5 } = {}) {
  const lf = lift(id);
  const n = Math.max(slots, sets.length);
  const slot = W / n;
  let g = '';
  sets.forEach((s, i) => {
    const load = setLoad(id, s);
    const w = clamp(s.reps / maxReps, 0.22, 1) * (slot - 5);
    const h = lf.bodyweight ? (load > 0 ? 10 + (load / maxLoad) * (H - 10) : H * 0.42) : 7 + clamp(load / maxLoad, 0, 1) * (H - 7);
    const tip = `<b>${lf.name} 第 ${i + 1} 组</b><br>${s.reps} 次${lf.bodyweight ? (load ? ` · +${load} kg` : '') : ` · ${s.kg} kg`}${s.note ? `<br>${esc(s.note)}` : s.hard ? '<br>很吃力' : ''}`;
    g += R(i * slot, H - h, w, h, lf.color, ` rx="3"${s.hard ? ' stroke="var(--awake)" stroke-width="2"' : ''}${tipAttr(tip)}`);
  });
  return svg(W, H, g, 'blocks');
}

// dots = top set per session, line = estimated 1RM, bars = volume, ring = latest personal record
export function liftProgress(points, { id, from, to, W = 156, H = 118 } = {}) {
  if (!points.length) return '';
  const lf = lift(id);
  const t0 = +parseYmd(from), t1 = +parseYmd(to);
  const x = (d) => 6 + ((+parseYmd(d) - t0) / (t1 - t0 || 1)) * (W - 12);
  const top = 8, mid = H - 26;
  const vals = points.flatMap((p) => [p.top, p.e1rm].filter((v) => v != null && v > 0));
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 2;
  const y = (v) => top + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (mid - top);
  const vmax = Math.max(...points.map((p) => p.vol), 1);
  let g = '';
  const bw = clamp((W - 12) / Math.max(points.length, 8) * 0.55, 2, 6);
  for (const p of points) {
    const h = 3 + (p.vol / vmax) * 15;
    g += R(x(p.date) - bw / 2, H - 4 - h, bw, h, 'var(--track)', ' rx="1"');
  }
  const e = points.filter((p) => p.e1rm);
  if (e.length > 1) g += `<path d="${e.map((p, i) => `${i ? 'L' : 'M'}${r1(x(p.date))},${r1(y(p.e1rm))}`).join(' ')}" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>`;
  for (const p of points) {
    g += C(x(p.date), y(p.top), 3.3, lf.color, ` data-act="session" data-id="${esc(p.id)}"${tipAttr(`<b>${md(parseYmd(p.date))}</b> ${lf.bodyweight ? `${p.top} 次` : `${p.top} kg`}${p.e1rm ? `<br>估算 1RM ${Math.round(p.e1rm)} kg` : ''}<br>训练量 ${Math.round(p.vol)}${lf.bodyweight ? ' 次' : ' kg'}`)}`);
  }
  const prs = points.filter((p) => p.pr);
  const lastPr = prs.at(-1);
  if (lastPr && prs.length > 1) g += C(x(lastPr.date), y(lastPr.top), 7.5, 'none', ' stroke="var(--text)" stroke-width="1.4"');
  return svg(W, H, g, 'lp');
}

// Front and back silhouettes; darker = more sets.
const FRONT = [
  ['shoulders', 'c', [-26, 38, 9]], ['shoulders', 'c', [26, 38, 9]],
  ['chest', 'r', [-21, 31, 42, 24, 6]], ['abs', 'r', [-17, 58, 34, 34, 6]],
  ['biceps', 'r', [-37, 47, 9, 42, 4]], ['biceps', 'r', [28, 47, 9, 42, 4]],
  ['quads', 'r', [-18, 96, 16, 52, 6]], ['quads', 'r', [2, 96, 16, 52, 6]],
  ['calves', 'r', [-17, 152, 14, 36, 6]], ['calves', 'r', [3, 152, 14, 36, 6]],
];
const BACK = [
  ['shoulders', 'c', [-26, 38, 9]], ['shoulders', 'c', [26, 38, 9]],
  ['back', 'r', [-23, 31, 46, 34, 7]], ['lowback', 'r', [-17, 68, 34, 22, 6]],
  ['triceps', 'r', [-37, 47, 9, 42, 4]], ['triceps', 'r', [28, 47, 9, 42, 4]],
  ['glutes', 'r', [-20, 92, 40, 20, 7]],
  ['hams', 'r', [-18, 114, 16, 36, 6]], ['hams', 'r', [2, 114, 16, 36, 6]],
  ['calves', 'r', [-17, 154, 14, 34, 6]], ['calves', 'r', [3, 154, 14, 34, 6]],
];
export function bodyMap(parts, names, { W = 300, H = 214 } = {}) {
  const max = Math.max(1, ...Object.values(parts));
  const fig = (shapes, cx) => {
    let g = C(cx, 14, 11, 'var(--track)');
    for (const [k, type, a] of shapes) {
      const v = parts[k] || 0;
      const o = r1(0.07 + 0.83 * (v / max));
      const tip = tipAttr(`<b>${names[k]}</b> ${Math.round(v * 10) / 10} 组`);
      if (type === 'c') g += C(cx + a[0], a[1], a[2], 'var(--text)', ` fill-opacity="${o}"${tip}`);
      else g += R(cx + a[0], a[1], a[2], a[3], 'var(--text)', ` rx="${a[4]}" fill-opacity="${o}"${tip}`);
    }
    return g;
  };
  const g = fig(FRONT, W * 0.27) + fig(BACK, W * 0.73) + T(W * 0.27, H - 4, '正面', 'ax', 'middle') + T(W * 0.73, H - 4, '背面', 'ax', 'middle');
  return svg(W, H, g);
}
export const heatScale = () => `<div class="heat-legend ink">少${[0.12, 0.3, 0.5, 0.7, 0.9].map((o) => `<i style="opacity:${o}"></i>`).join('')}多</div>`;

// calendar: small squares for the lifts done that day, a dot for basketball
export function trainCal({ start, end, byDate, todayKey }) {
  const s = addDays(start, -wd(start));
  let html = `<div class="cal">${'一二三四五六日'.split('').map((c) => `<div class="cal-h">${c}</div>`).join('')}`;
  for (let d = s; ; d = addDays(d, 1)) {
    const key = ymd(d), inRange = d >= start && d <= end;
    const x = inRange ? byDate[key] : null;
    const tip = x ? `<b>${md(d)}</b> ${[...(x.lifts || []).map((l) => lift(l).name), x.ball ? '篮球' : ''].filter(Boolean).join(' · ')}` : '';
    html += `<div class="cal-c${inRange ? '' : ' off'}${key === todayKey ? ' today' : ''}"${x?.session ? ` data-act="session" data-id="${esc(x.session)}"` : ''}${tip ? tipAttr(tip) : ''}>`;
    if (x) html += `<span class="sq">${(x.lifts || []).map((l) => `<i style="background:${lift(l).color}"></i>`).join('')}</span>${x.ball ? '<b class="ball"></b>' : ''}`;
    html += '</div>';
    if (d >= end && wd(d) === 6) break;
  }
  return html + '</div>';
}

// sets per week stacked by lift
export function weeklySets(weeks, order, { W = 330, H = 150 } = {}) {
  const Lw = 24, top = 18, B = 20;
  const tot = (w) => order.reduce((a, k) => a + (w.by[k] || 0), 0);
  const max = Math.max(4, ...weeks.map(tot)) * 1.1;
  const y = (v) => top + (1 - v / max) * (H - top - B);
  const step = (W - Lw) / weeks.length, bw = Math.min(22, step * 0.62);
  let g = '';
  for (const t of niceTicks(0, max, 3)) g += `<line x1="${Lw}" x2="${W}" y1="${r1(y(t))}" y2="${r1(y(t))}" stroke="var(--grid)"/>` + T(0, y(t) + 4, String(t));
  weeks.forEach((w, i) => {
    const cx = Lw + step * i + step / 2;
    let acc = 0;
    for (const k of order) {
      const v = w.by[k] || 0;
      if (!v) continue;
      g += R(cx - bw / 2, y(acc + v), bw, y(acc) - y(acc + v) - 0.8, lift(k).color);
      acc += v;
    }
    g += R(cx - step / 2, 0, step, H - B, 'transparent', ` class="hit"${tipAttr(`<b>${w.label}</b> ${tot(w)} 组<br>${order.filter((k) => w.by[k]).map((k) => `${lift(k).name} ${w.by[k]}`).join(' · ')}`)}`);
  });
  const last = weeks.at(-1);
  if (tot(last)) g += T(Lw + step * (weeks.length - 0.5), y(tot(last)) - 5, `${tot(last)} 组`, 'lbl b', 'middle');
  g += T(Lw, H - 4, `${weeks.length - 1} 周前`, 'ax') + T(W, H - 4, '本周', 'ax', 'end');
  return svg(W, H, g);
}

// heart rate through a session: a colored dot per set, a colored bar per lift
export function sessionHr(points, { start, end, peaks = [], spans = [], W = 330, H = 110 } = {}) {
  if (points.length < 2) return '';
  const top = 10, bottom = H - 22;
  const lo = Math.min(...points.map((p) => p.v)) - 4, hi = Math.max(...points.map((p) => p.v)) + 6;
  const x = (t) => 4 + ((t - start) / (end - start || 1)) * (W - 8);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bottom - top);
  let g = `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${r1(x(p.t))},${r1(y(p.v))}`).join(' ')}" fill="none" stroke="var(--c-red)" stroke-width="1.6" stroke-linejoin="round"/>`;
  g += `<line x1="4" x2="${W - 4}" y1="${bottom + 4}" y2="${bottom + 4}" stroke="var(--grid)"/>`;
  for (const p of peaks) g += C(x(p.t), y(p.v), 4, p.color || 'var(--text)', tipAttr(`${Math.round(p.v)} bpm`));
  for (const s of spans) g += R(x(s.a), bottom + 10, Math.max(6, x(s.b) - x(s.a)), 6, s.color, ' rx="3"');
  return svg(W, H, g);
}
