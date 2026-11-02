// 运动：日 = 每次运动的强度；周 = 时间网格；月 = 日历；3 月 = 进步
import { hm, md, wd, parseYmd, ymd, addDays, mean, sum, fmtInt, hmDur, esc, today } from '../util.js';
import * as C from '../charts.js';
import { card, nums, num, durHtml, empty, xLabels, workouts, inDays, kindLabel, zonesMin, activeZoneMin, zoneAvg } from './common.js';
import { hrSeries } from '../data.js';
import { zoneOf } from '../scores.js';
import { pendingCards, after as trainAfter } from './trainpage.js';

const LEVEL = { POOR: '较差', FAIR: '一般', AVERAGE: '中等', GOOD: '好', VERY_GOOD: '很好', EXCELLENT: '优秀' };

function totals(list) {
  const min = sum(list.map((w) => w.activeSec / 60));
  const kcal = sum(list.map((w) => w.kcal || 0));
  return nums(num('次数', list.length), num('时长', durHtml(min)), num('消耗', kcal ? fmtInt(kcal) : '–', kcal ? 'kcal' : ''));
}

export function render(ctx) {
  const { v, per } = ctx;
  const all = workouts(v);
  const list = inDays(all, per);
  const xl = xLabels(per.range);
  let out = card('', totals(list), { cls: 'flat' });
  if (per.range === 'd') {
    const pend = pendingCards(ctx, { date: per.to });
    out += pend;
    if (!list.length && !pend) out += empty('这天没有运动');
    out += list.map((w) => wCard(w)).join('');
    const withHr = list.filter((w) => w.avgHr);
    const detail = withHr.find((w) => w.id === ctx.focus) || withHr.sort((a, b) => (b.kind === 'basketball') - (a.kind === 'basketball') || b.activeSec - a.activeSec)[0];
    if (detail) out += `<div id="wk-detail" data-id="${esc(detail.id)}">${detailShell(detail)}</div>`;
    const z = v.daily[per.to]?.zoneSec;
    if (z) {
      const m = zonesMin(z), tot = activeZoneMin(z), avg = zoneAvg(v, per.to);
      const max = Math.max(tot, avg || 0, 1) * 1.15;
      const seg = [['moderate', 2], ['vigorous', 3], ['peak', 4]].map(([k, zi]) => `<i style="width:${(m[k] / max) * 100}%;background:${C.ZONE_COLOR[zi]}"${C.tipAttr(`${C.ZONE_NAME[zi]} ${Math.round(m[k])} 分钟`)}></i>`).join('');
      out += card('心率区间分钟', `<div class="pbar stack"><span class="track">${seg}</span>${avg ? `<span class="mark" style="left:${(avg / max) * 100}%"><em>你的平均 ${Math.round(avg)}</em></span>` : ''}</div>`, { right: `<b class="big">${Math.round(tot)}<small> 分钟</small></b>` });
    }
    return out;
  }
  if (!list.length) return out + empty('这段时间没有运动');
  if (per.range === 'w') {
    const rows = per.days.map((date) => ({ date, items: list.filter((w) => ymd(new Date(w.start)) === date) }));
    out += card('时间网格', C.timeGrid(rows, { todayKey: ymd(today()) }));
  }
  if (per.range === 'm') {
    const byDate = {};
    for (const w of list) (byDate[ymd(new Date(w.start))] ||= []).push({ kind: w.kind, min: w.activeSec / 60, id: w.id });
    out += card('运动日历', C.workoutCal({ start: per.start, end: per.end, byDate, todayKey: ymd(today()) }), { sub: '圆点大小 = 时长' });
  }
  if (per.range !== 'q') {
    const zd = per.days.map((date) => ({ date, z: v.daily[date]?.zoneSec ? zonesMin(v.daily[date].zoneSec) : null }));
    if (zd.some((d) => d.z)) out += card('每天心率区间分钟', C.zoneStack(zd, { avg: zoneAvg(v, per.to), xLabels: (s) => xl(s.map((p) => ({ date: p.date }))) }), { sub: '虚线 = 你的平均' });
    out += card('类型', typeBars(list));
    if (per.range === 'w') out += [...list].reverse().map((w) => wCard(w, true)).join('');
    return out;
  }
  // 3 months
  const weeks = [];
  for (let i = 0; i < 13; i++) {
    const a = addDays(per.start, i * 7), b = addDays(a, 7);
    const ws = list.filter((w) => w.start >= +a && w.start < +b);
    const h = (k) => sum(ws.filter((w) => w.kind === k).map((w) => w.activeSec / 3600));
    weeks.push({ label: `${md(a)} 起一周`, strength: h('strength'), basketball: h('basketball'), other: h('other') });
  }
  out += card('每周运动时长', C.weeklyHours(weeks), { sub: '折线 = 4 周平均' });
  const games = all.filter((w) => w.kind === 'basketball' && w.avgHr && w.start >= +per.start);
  if (games.length) out += card('篮球强度', C.scatter(games.map((w, i) => ({ x: w.activeSec / 60, y: w.avgHr, t: w.start, id: w.id, label: i === games.length - 1 ? (ymd(new Date(w.start)) === ymd(today()) ? '今天' : md(new Date(w.start))) : '' }))), { sub: '每个点 = 一场，越新越深' });
  const vo = per.days.filter((d) => v.daily[d]?.vo2 != null).map((d) => ({ t: +parseYmd(d), v: v.daily[d].vo2, levelName: LEVEL[v.daily[d].vo2Level] }));
  if (vo.length) out += card('有氧能力 VO2 max', C.vo2(vo), { right: `<b class="big">${vo.at(-1).v.toFixed(1)}${vo.at(-1).levelName ? `<small> ${vo.at(-1).levelName}</small>` : ''}</b>` });
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, k: {} })));
  for (const w of list) { const d = new Date(w.start), c = cells[wd(d)][d.getHours()]; c.n++; c.k[w.kind] = (c.k[w.kind] || 0) + 1; }
  for (const row of cells) for (const c of row) c.kind = Object.entries(c.k).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
  out += card('运动时间习惯', C.habit(cells), { sub: '圆点大小 = 次数' });
  return out;
}

function typeBars(list) {
  const rows = ['basketball', 'strength', 'other'].map((k) => ({ k: C.KIND[k].name, v: sum(list.filter((w) => w.kind === k).map((w) => w.activeSec / 60)), color: C.KIND[k].color })).filter((r) => r.v > 0);
  return C.hbars(rows, { fmt: hmDur });
}

export function wCard(w, compact = false) {
  const mins = Math.round(w.activeSec / 60);
  const z = w.zones || {};
  const day = compact ? `${md(new Date(w.start))} ` : '';
  return `<button class="wk" data-act="${w.sessionId && w.src === 'app' ? 'session' : 'workout'}" data-id="${esc(w.sessionId && w.src === 'app' ? w.sessionId : w.id)}">
    <span class="ic" style="background:${C.KIND[w.kind].color}"></span>
    <span class="body"><span class="t">${kindLabel(w)}</span><span class="m">${day}${hm(new Date(w.start))}–${hm(new Date(w.end))} · ${mins} 分钟${w.avgHr && !compact ? ` · ${w.avgHr} bpm` : ''}</span></span>
    <span class="viz"><span class="hrmini" data-hrmini="${esc(w.id)}" data-s="${w.start}" data-e="${w.end}"></span>${C.zoneStrip(z, { W: 110 })}</span>
  </button>`;
}

function detailShell(w) {
  return card(`${kindLabel(w)} · 详情`, `<div class="hrbars"><div class="empty sm">读取中…</div></div>`, { right: `<span class="sub">平均 ${w.avgHr || '–'}</span>` });
}

export function detailBody(v, w, pts) {
  const max = pts.length ? Math.round(Math.max(...pts.map((p) => p.v))) : null;
  let out = C.hrBarcode(pts, v.zones, { zoneOf });
  out += C.zoneRows(zonesMin(w.zones || {}));
  const prev = workouts(v).filter((x) => x.kind === w.kind && x.type === w.type && x.start < w.start && x.avgHr).at(-1);
  if (prev) {
    out += `<div class="sub-h">和上次${kindLabel(w)}比 <span class="leg"><i style="background:${C.KIND[w.kind].color}"></i>这次 <i style="background:var(--c-grey)"></i>${md(new Date(prev.start))}</span></div>`;
    out += C.compare([
      { k: '时长', a: w.activeSec / 60, b: prev.activeSec / 60, fa: `${Math.round(w.activeSec / 60)} 分钟`, fb: `${Math.round(prev.activeSec / 60)} 分钟`, color: C.KIND[w.kind].color },
      w.avgHr && prev.avgHr ? { k: '平均心率', a: w.avgHr, b: prev.avgHr, fa: `${w.avgHr} bpm`, fb: `${prev.avgHr} bpm`, color: C.KIND[w.kind].color } : null,
      w.kcal && prev.kcal ? { k: '消耗', a: w.kcal, b: prev.kcal, fa: `${Math.round(w.kcal)} kcal`, fb: `${Math.round(prev.kcal)} kcal`, color: C.KIND[w.kind].color } : null,
    ].filter(Boolean));
  }
  return { html: out, max };
}

export async function fillMinis(root) {
  for (const el of root.querySelectorAll('[data-hrmini]')) {
    try {
      const pts = await hrSeries(+el.dataset.s, +el.dataset.e, 60);
      if (el.isConnected && pts.length > 2) el.innerHTML = C.hrMini(pts, { W: 110, H: 26, start: +el.dataset.s, end: +el.dataset.e });
    } catch { /* leave empty */ }
  }
}

export async function after(ctx, root) {
  const det = root.querySelector('#wk-detail');
  if (det) {
    const w = workouts(ctx.v).find((x) => x.id === det.dataset.id);
    if (w) {
      try {
        const pts = await hrSeries(w.start, w.end, 60);
        const box = det.querySelector('.hrbars');
        if (box?.isConnected) {
          const { html, max } = detailBody(ctx.v, w, pts);
          box.innerHTML = html;
          const sub = det.querySelector('h2 .sub');
          if (sub && max) sub.textContent = `平均 ${w.avgHr} · 最高 ${max}`;
        }
      } catch (e) { const box = det.querySelector('.hrbars'); if (box) box.innerHTML = `<div class="empty sm">${esc(e.message)}</div>`; }
    }
  }
  await Promise.all([fillMinis(root), trainAfter(ctx, root)]);
}
