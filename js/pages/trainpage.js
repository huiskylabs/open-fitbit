// 训练：确认卡（app 猜的）、下次练什么、单次训练、动作进度、部位热力图、训练日历、每周组数
import { hm, md, parseYmd, ymd, addDays, today, esc, fmtInt, sum } from '../util.js';
import * as tr from '../training.js';
import * as T from '../tcharts.js';
import { tipAttr } from '../charts.js';
import { card, empty, workouts } from './common.js';
import { hrSeries } from '../data.js';
import { talkLabel } from '../trainui.js';

const scaleFor = (items) => {
  const all = items.flatMap((it) => it.sets.map((s) => ({ id: it.lift, s })));
  return {
    maxReps: Math.max(10, ...all.map((x) => x.s.reps)),
    maxLoad: Math.max(60, ...all.map((x) => tr.setLoad(x.id, x.s))),
    slots: Math.max(5, ...items.map((it) => it.sets.length)),
  };
};

function liftRows(items, { right } = {}) {
  const sc = scaleFor(items);
  return `<div class="lifts">${items.map((it) => `<div class="lift-row">
    <span class="ln">${esc(tr.lift(it.lift).name)}<small>${esc(tr.setsLabel(it.lift, it.sets))}</small></span>
    <span class="lb">${T.setBlocks(it.lift, it.sets, { ...sc, W: 180, H: 28 })}</span>
    ${right ? `<span class="lr">${right(it)}</span>` : ''}</div>`).join('')}</div>`;
}

// ---------- the confirm card ----------
export function pendingCards(ctx, { date } = {}) {
  const st = tr.get();
  const list = st.pending.filter((p) => !date || p.date === date);
  if (!list.length) return '';
  return list.sort((a, b) => b.start - a.start).map((p) => {
    const g = tr.guess(p.date);
    const when = `${p.date === ymd(today()) ? '' : md(parseYmd(p.date)) + ' '}${hm(new Date(p.start))}–${hm(new Date(p.end))}`;
    const body = `<div class="pend-hr" data-pending="${esc(p.id)}"></div>
      ${g ? `<div class="sub-h">猜的内容 <span class="muted">按上次 + 轮换预填</span></div>${liftRows(g.items)}` : '<div class="sub-h">第一次：说一下练了什么，以后就会自动猜</div>'}
      <div class="btns">
        ${g ? `<button class="btn pri" data-act="pend-ok" data-id="${esc(p.id)}">✓ 对</button>` : ''}
        <button class="btn talk" data-act="pend-talk" data-id="${esc(p.id)}">${talkLabel()}</button>
        <button class="btn ghost" data-act="pend-edit" data-id="${esc(p.id)}">改</button>
      </div>`;
    return card('检测到一次训练', body, { cls: 'confirm', right: `<span class="sub">${when}</span><button class="x" data-act="pend-no" data-id="${esc(p.id)}" aria-label="不是训练">×</button>` });
  }).join('');
}

// ---------- what to lift next ----------
function nextCard(ctx) {
  const rec = ctx.v.recovery[ymd(today())]?.total ?? null;
  const recent = new Set(tr.sessionsIn(ymd(addDays(today(), -42)), ymd(today())).flatMap((s) => s.items.map((i) => i.lift)));
  const ids = [...new Set([...tr.BIG.filter((id) => tr.lastItem(id)), ...[...recent].filter((id) => !tr.BIG.includes(id))])];
  const rows = ids.map((id) => ({ id, n: tr.nextFor(id, rec) })).filter((x) => x.n);
  if (!rows.length) return '';
  const items = rows.map((x) => ({ lift: x.id, sets: x.n.sets }));
  const sc = scaleFor(items);
  const pill = (x) => {
    const s = x.n.suggestion;
    if (!s) return '';
    if (s.keep) return '<span class="pill">保持</span>';
    return `<span class="pill up">${s.kg ? `+${s.kg} 公斤` : `+${s.reps} 次`}</span>`;
  };
  const body = `<div class="lifts">${rows.map((x) => `<div class="lift-row">
      <span class="ln">${esc(tr.lift(x.id).name)}<small>${esc(tr.setsLabel(x.id, x.n.sets))}</small><small>${md(parseYmd(x.n.date))}</small></span>
      <span class="lb">${T.setBlocks(x.id, x.n.sets, { ...sc, W: 180, H: 28 })}</span>
      <span class="lr">${pill(x)}</span></div>`).join('')}</div>
    <div class="foot">每个方块 = 一组：宽 = 次数，高 = 重量</div>`;
  return card('下次练什么', body, { right: '<span class="sub">上次 · 建议</span>' });
}

// ---------- one session ----------
export function sessionCard(s, { title = '单次训练' } = {}) {
  const when = `${md(parseYmd(s.date))}${s.start ? ` ${hm(new Date(s.start))}–${hm(new Date(s.end))}` : ''}`;
  const right = (it) => {
    const v = tr.volume(it.lift, it.sets);
    return tr.lift(it.lift).bodyweight ? `${v} 次` : `${fmtInt(v)} kg`;
  };
  return card(title, `${s.start ? `<div class="sess-hr" data-session="${esc(s.id)}"></div>` : ''}${liftRows(s.items, { right })}
    <div class="btns small"><button class="btn ghost" data-act="sess-edit" data-id="${esc(s.id)}">改</button><button class="btn ghost danger" data-act="sess-del" data-id="${esc(s.id)}">删除</button></div>`,
  { right: `<span class="sub">${when}</span>` });
}

// ---------- long term ----------
function progressCard(ctx) {
  const { per } = ctx;
  const ids = tr.allLiftIds().filter((id) => tr.progress(id, per.from, per.to).length);
  if (!ids.length) return '';
  const cells = ids.slice(0, 6).map((id) => {
    const p = tr.progress(id, per.from, per.to);
    const lf = tr.lift(id);
    const first = p[0].top, last = p.at(-1).top;
    const d = Math.round((last - first) * 10) / 10;
    const unit = lf.bodyweight ? '次' : 'kg';
    return `<div class="lp-cell"><div class="lp-h"><span>${esc(lf.name)} <em>${d > 0 ? '+' : ''}${d === 0 ? '±0' : d}</em></span><b>${last} ${unit}</b></div>${T.liftProgress(p, { id, from: per.from, to: per.to })}</div>`;
  }).join('');
  return card(`动作进度 · ${per.range === 'q' ? '3 个月' : '30 天'}`, `<div class="lp-grid">${cells}</div><div class="foot">点 = 每次最重一组 · 线 = 估算 1RM · 柱 = 训练量 · 圈 = 个人记录</div>`);
}

function bodyCard(ctx) {
  const { per } = ctx;
  const parts = tr.setsPerPart(per.from, per.to);
  if (!Object.values(parts).some((v) => v > 0)) return '';
  return card(`部位热力图 · ${per.range === 'w' ? '近 7 天' : '30 天'}`, T.bodyMap(parts, tr.PARTS), { right: T.heatScale() });
}

function calendarCard(ctx) {
  const { per, v } = ctx;
  const byDate = {};
  for (const s of tr.sessionsIn(per.from, per.to)) {
    const x = (byDate[s.date] ||= { lifts: [] });
    x.lifts.push(...s.items.map((i) => i.lift).filter((l) => !x.lifts.includes(l)));
    x.session = s.id;
  }
  for (const w of workouts(v)) {
    if (w.kind !== 'basketball') continue;
    const d = ymd(new Date(w.start));
    if (d < per.from || d > per.to) continue;
    (byDate[d] ||= { lifts: [] }).ball = true;
  }
  if (!Object.keys(byDate).length) return '';
  const leg = `<div class="legend">${tr.BIG.map((id) => `<span><i style="background:${tr.lift(id).color}"></i>${tr.lift(id).name}</span>`).join('')}<span><i class="round" style="background:var(--c-magenta)"></i>篮球</span></div>`;
  return card('训练日历', T.trainCal({ start: per.start, end: per.end, byDate, todayKey: ymd(today()) }) + leg);
}

function weeklyCard(ctx) {
  const { per } = ctx;
  const n = per.range === 'q' ? 13 : 12;
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = addDays(per.end, -7 * i), start = addDays(end, -6);
    const by = {};
    for (const s of tr.sessionsIn(ymd(start), ymd(end))) for (const it of s.items) by[it.lift] = (by[it.lift] || 0) + it.sets.length;
    weeks.push({ label: `${md(start)} – ${md(end)}`, by });
  }
  if (!weeks.some((w) => Object.keys(w.by).length)) return '';
  const order = [...tr.BIG, ...Object.keys(tr.get().lib)];
  return card(`每周组数 · ${n} 周`, T.weeklySets(weeks, order));
}

export function render(ctx) {
  const { per } = ctx;
  let out = pendingCards(ctx);
  const has = tr.sessions().length > 0;
  if (!has && !out) {
    return card('', `<div class="empty">练完不用点任何按钮：app 会从心率里找出这次训练，打开就能确认。<br>也可以现在手动记一次。</div>
      <div class="btns"><button class="btn" data-act="sess-new">记一次训练</button></div>`, { cls: 'flat' });
  }
  out += nextCard(ctx);
  if (per.range === 'd') {
    const ss = tr.sessions().filter((s) => s.date === per.to);
    out += ss.map((s) => sessionCard(s)).join('');
    if (!ss.length && !tr.get().pending.some((p) => p.date === per.to)) out += card('', empty('这天没有训练记录'), { cls: 'flat' });
  } else {
    if (per.range !== 'w') out += progressCard(ctx);
    if (per.range !== 'q') out += bodyCard(ctx);
    out += calendarCard(ctx);
    out += weeklyCard(ctx);
  }
  out += `<div class="btns center"><button class="btn ghost" data-act="sess-new" data-date="${per.to}">+ 手动记一次</button></div>`;
  return out;
}

// heart-rate strips inside confirm / session cards
export async function after(ctx, root) {
  const { v } = ctx;
  for (const el of root.querySelectorAll('[data-pending]')) {
    const p = tr.get().pending.find((x) => x.id === el.dataset.pending);
    if (!p) continue;
    try {
      const pts = await hrSeries(p.start - 3 * 60e3, p.end + 3 * 60e3, 60);
      const g = tr.guess(p.date);
      const { peaks, spans } = tr.colorPeaks(p.peaks || [], g ? g.items : []);
      if (el.isConnected) el.innerHTML = T.sessionHr(pts, { start: p.start - 3 * 60e3, end: p.end + 3 * 60e3, peaks, spans });
    } catch { /* no HR */ }
  }
  for (const el of root.querySelectorAll('[data-session]')) {
    const s = tr.get().sessions.find((x) => x.id === el.dataset.session);
    if (!s?.start) continue;
    try {
      const a = s.start - 3 * 60e3, b = s.end + 3 * 60e3;
      const pts = await hrSeries(a, b, 60);
      const base = v.daily[s.date]?.rhr || 60;
      const raw = s.hr?.peaks?.length ? s.hr.peaks : tr.findPeaks(pts.filter((p) => p.t >= s.start && p.t <= s.end), base);
      const { peaks, spans } = tr.colorPeaks(raw, s.items);
      if (el.isConnected) el.innerHTML = T.sessionHr(pts, { start: a, end: b, peaks, spans });
    } catch { /* no HR */ }
  }
}
