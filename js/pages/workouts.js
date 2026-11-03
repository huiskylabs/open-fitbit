// 运动（力量也在这里）：动得够不够、力量有没有进步。日 = 每次运动和中高强度分钟；周 = 每天的中高强度和运动列表；
// 月 = 日历；3 个月 = 每周时长和有氧能力
import { hm, md, wk, parseYmd, ymd, addDays, sum, fmtInt, hmDur, esc, today, mean } from '../util.js';
import * as C from '../charts.js';
import { card, nums, num, durHtml, empty, xLabels, workouts, inDays, kindLabel, kindsLine, zonesMin, activeZoneMin, zoneAvg, recRow, shortKind } from './common.js';
import * as Dl from '../dial.js';
import { hrSeries } from '../data.js';
import { zoneOf } from '../scores.js';
import { pendingCards, after as trainAfter, sessionCard, nextCard, progressCard, partsCard, weeklyCard } from './trainpage.js';
import * as tr from '../training.js';

const LEVEL = { POOR: '较差', FAIR: '一般', AVERAGE: '中等', GOOD: '好', VERY_GOOD: '很好', EXCELLENT: '优秀' };

// detected strength sessions not confirmed yet aren't in the count; say so next to it
export const pendingNote = (per) => {
  const n = tr.get().pending.filter((p) => p.date >= per.from && p.date <= per.to).length;
  return n ? `另有 ${n} 次待确认` : '';
};

function totals(v, per, list) {
  const min = sum(list.map((w) => w.activeSec / 60));
  const kcal = sum(list.map((w) => w.kcal || 0));
  const zone = sum(per.days.map((d) => (v.daily[d]?.zoneSec ? activeZoneMin(v.daily[d].zoneSec) : 0)));
  return card('', nums(
    num('运动', list.length, '次', '', per.range === 'd' ? '' : pendingNote(per)),
    num('时长', durHtml(min), '', 'sm'),
    per.range === 'd' ? (kcal ? num('消耗', fmtInt(kcal), 'kcal', 'sm') : '') : num('中高强度', fmtInt(zone), '分钟', 'sm'),
  ) + (per.range === 'd' ? '' : kindsLine(list)), { cls: 'flat' });
}

export function render(ctx) {
  const { v, per } = ctx;
  const all = workouts(v);
  const list = inDays(all, per);
  const xl = xLabels(per.range);
  if (per.range === 'd') {
    const pend = pendingCards(ctx, { date: per.to });
    let out = list.length ? totals(v, per, list) : '';
    out += pend;
    if (!list.length && !pend) out += empty('这天没有运动');
    if (per.offset === 0) out += nextCard(ctx);
    const sess = tr.sessions().filter((x) => x.date === per.to);
    out += sess.map((x) => sessionCard(x)).join('');
    const rest = list.filter((w) => !(w.kind === 'strength' && sess.some((x) => x.id === w.sessionId)));
    if (rest.length) out += `<section class="card"><h2><span>${sess.length ? '其他运动' : '这天的运动'}</span></h2>${rest.map((w) => recRow(w)).join('')}</section>`;
    const withHr = list.filter((w) => w.avgHr);
    const detail = withHr.find((w) => w.id === ctx.focus) || withHr.sort((a, b) => (b.kind === 'basketball') - (a.kind === 'basketball') || b.activeSec - a.activeSec)[0];
    if (detail) out += `<div id="wk-detail" data-id="${esc(detail.id)}">${detailShell(detail)}</div>`;
    const z = v.daily[per.to]?.zoneSec;
    if (z) {
      const avg = zoneAvg(v, per.to);
      out += card(`中高强度 ${Math.round(activeZoneMin(z))} 分钟`, C.zoneRows(zonesMin(z), { order: [4, 3, 2] }), { sub: avg ? `平时全天 ${Math.round(avg)} 分钟` : '' });
    }
    out += `<div class="btns center"><button class="link" data-act="sess-new" data-date="${per.to}">记一次没被认出的力量训练</button></div>`;
    return out;
  }
  if (!list.length) return pendingCards(ctx, { from: per.from, to: per.to }) + empty('这段时间没有运动');
  let out = pendingCards(ctx, { from: per.from, to: per.to });
  out += per.range === 'q' ? totals(v, per, list) : kindTotals(list);
  if (per.range === 'm') {
    out += card(`30 天里运动了 ${new Set(list.map((w) => ymd(new Date(w.start)))).size} 天`, dialCal(per, list));
    out += card('最近', [...list].reverse().slice(0, 6).map((w) => recRow(w, { withDay: true })).join(''));
    out += progressCard(ctx) + partsCard(ctx);
    return out;
  }
  if (per.range !== 'q') {
    const zd = per.days.map((date) => ({ date, z: v.daily[date]?.zoneSec ? zonesMin(v.daily[date].zoneSec) : null }));
    if (zd.some((d) => d.z)) {
      const avg = zoneAvg(v, per.from), perDay = mean(zd.filter((d) => d.z).map((d) => d.z.moderate + d.z.vigorous + d.z.peak));
      out += card(`中高强度：平均每天 ${Math.round(perDay)} 分钟`, C.zoneBars(zd, { avg, xLabels: (s) => xl(s.map((p) => ({ date: p.date }))) }), { sub: avg ? `平时 ${Math.round(avg)} 分钟` : '' });
    }
    if (per.range === 'w') out += card('这 7 天', [...list].reverse().map((w) => recRow(w, { withDay: true })).join(''));
    return out;
  }
  // 3 months: 13 blocks of 7 days, the last one ending today
  const weeks = [];
  for (let i = 0; i < 13; i++) {
    const a = addDays(per.start, i * 7), b = addDays(a, 7);
    const ws = list.filter((w) => w.start >= +a && w.start < +b);
    const h = (k) => sum(ws.filter((w) => w.kind === k).map((w) => w.activeSec / 3600));
    weeks.push({ label: `${md(a)}–${md(addDays(b, -1))}`, strength: h('strength'), basketball: h('basketball'), other: h('other') });
  }
  const avgH = mean(weeks.map((w) => w.strength + w.basketball + w.other));
  out += card(`平均每周 ${hmDur(avgH * 60)}`, C.weeklyHours(weeks));
  const vo = per.days.filter((d) => v.daily[d]?.vo2 != null).map((d) => ({ t: +parseYmd(d), v: v.daily[d].vo2, levelName: LEVEL[v.daily[d].vo2Level] }));
  if (vo.length) {
    const last = vo.at(-1), d = last.v - vo[0].v;
    const change = vo.length < 2 ? '' : Math.abs(d) < 0.3 ? '和 3 个月前差不多' : `比 3 个月前${d > 0 ? '高' : '低'} ${Math.abs(d).toFixed(1)}`;
    out += last.levelName
      ? card(`有氧能力：${last.levelName}`, C.vo2(vo), { sub: `VO2 max ${last.v.toFixed(1)}${change ? `，${change}` : ''}` })
      : card(`有氧能力 ${last.v.toFixed(1)}`, C.vo2(vo), { sub: change });
  }
  out += progressCard(ctx) + weeklyCard(ctx);
  return out;
}

// 力量 12 次 · 篮球 8 次 · 步行 4 次, each with its total time
function kindTotals(list) {
  const by = new Map();
  for (const w of list) { const k = shortKind(w); const x = by.get(k) || { k, kind: w.kind, n: 0, min: 0 }; x.n++; x.min += w.activeSec / 60; by.set(k, x); }
  const top = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  const col = { strength: 'var(--strength)', basketball: 'var(--ball)', other: 'var(--other)' };
  return `<section class="card flat"><div class="kchips">${top.map((x) => `<div><span class="kk" style="background:${col[x.kind] || col.other}">${esc(x.k)}</span><div class="v">${x.n}<small>次</small></div><div class="n">共 ${hmDur(x.min)}</div></div>`).join('')}</div></section>`;
}

// the month as small dials: each day filled with its main workout's color and name
function dialCal(per, list) {
  const byDate = {};
  for (const w of list) (byDate[ymd(new Date(w.start))] ||= []).push({ start: w.start, end: w.end, kind: w.kind, short: shortKind(w) });
  let h = '一二三四五六日'.split('').map((x) => `<div class="h">${x}</div>`).join('');
  const pad = (per.start.getDay() + 6) % 7;
  for (let i = 0; i < pad; i++) h += '<div></div>';
  const tk = ymd(today());
  for (const date of per.days) {
    const d = parseYmd(date), ws = byDate[date] || [];
    const label = d.getDate() === 1 ? `${d.getMonth() + 1}月` : String(d.getDate());
    const min = Math.round(ws.reduce((a, w) => a + (w.end - w.start) / 60e3, 0));
    h += `<div class="c" data-act="goto-day" data-date="${date}">${Dl.miniWorkoutDay({ dayStart: +d, ws, label, today: date === tk })}<div class="m">${min ? `${min}′` : ''}</div></div>`;
  }
  return `<div class="dcal">${h}</div>`;
}

// one workout: name (and its day, in a list of several days), when and how long; on the right its
// heart rate, with the average under it
export function wCard(w, compact = false) {
  const mins = Math.round(w.activeSec / 60), d = new Date(w.start);
  return `<button class="wk" data-act="${w.sessionId && w.src === 'app' ? 'session' : 'workout'}" data-id="${esc(w.sessionId && w.src === 'app' ? w.sessionId : w.id)}">
    <span class="ic" style="background:${C.KIND[w.kind].color}"></span>
    <span class="body"><span class="t">${kindLabel(w)}${compact ? `<small>${md(d)} 周${wk(d)}</small>` : ''}</span><span class="m">${hm(d)}–${hm(new Date(w.end))} · ${hmDur(mins)}</span></span>
    <span class="viz"><span class="hrmini" data-hrmini="${esc(w.id)}" data-s="${w.start}" data-e="${w.end}"></span>${w.avgHr ? `<span class="hra">平均 ${w.avgHr} bpm</span>` : ''}</span>
  </button>`;
}

function detailShell(w) {
  return card(`这次${kindLabel(w)}的心率`, `<div class="hrbars"><div class="empty sm">读取中…</div></div>`, { sub: w.avgHr ? `平均 ${w.avgHr} bpm` : '' });
}

// "比上次多 5 分钟": this workout against the last one of the same type
const delta = (a, b, unit, more = '多', less = '少') => {
  const d = Math.round(a - b);
  return d === 0 ? '和上次一样' : `比上次${d > 0 ? more : less} ${Math.abs(d)} ${unit}`;
};

export function detailBody(v, w, pts) {
  const max = pts.length ? Math.round(Math.max(...pts.map((p) => p.v))) : null;
  let out = C.hrBarcode(pts, v.zones, { zoneOf });
  out += `<div class="sub-h">每个心率区间的分钟</div>` + C.zoneRows(zonesMin(w.zones || {}));
  const prev = workouts(v).filter((x) => x.kind === w.kind && x.type === w.type && x.start < w.start && x.avgHr).at(-1);
  if (prev) {
    const rows = [
      ['时长', hmDur(w.activeSec / 60), delta(w.activeSec / 60, prev.activeSec / 60, '分钟')],
      w.avgHr && prev.avgHr ? ['平均心率', `${w.avgHr} bpm`, delta(w.avgHr, prev.avgHr, 'bpm', '高', '低')] : null,
      w.kcal && prev.kcal ? ['消耗', `${fmtInt(w.kcal)} kcal`, delta(w.kcal, prev.kcal, 'kcal')] : null,
    ].filter(Boolean);
    out += `<div class="sub-h">和上次比（${md(new Date(prev.start))}）</div><div class="facts">${rows.map(([k, a, n]) => `<div><span class="k">${k}</span><b>${a}</b><span class="n">${n}</span></div>`).join('')}</div>`;
  }
  return { html: out, max };
}

export async function fillMinis(root) {
  for (const el of root.querySelectorAll('[data-hrmini]')) {
    try {
      const pts = await hrSeries(+el.dataset.s, +el.dataset.e, 60);
      if (el.isConnected && pts.length > 2) el.innerHTML = C.hrMini(pts, { W: 96, H: 30, start: +el.dataset.s, end: +el.dataset.e });
    } catch { /* leave empty */ }
  }
}

export async function after(ctx, root) {
  const det = root.querySelector('#wk-detail');
  if (det) {
    const w = workouts(ctx.v).find((x) => x.id === det.dataset.id);
    if (w) {
      const box = det.querySelector('.hrbars');
      try {
        const pts = await hrSeries(w.start, w.end, 60);
        if (box?.isConnected) {
          const { html, max } = detailBody(ctx.v, w, pts);
          box.innerHTML = html;
          const sub = det.querySelector('h2 .sub');
          if (sub && max) sub.textContent = `平均 ${w.avgHr} bpm · 最高 ${max} bpm`;
        }
      } catch { if (box) box.innerHTML = '<div class="empty sm">没读到这次的心率</div>'; }
    }
  }
  await Promise.all([fillMinis(root), trainAfter(ctx, root)]);
}
