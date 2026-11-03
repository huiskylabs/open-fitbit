// 力量：要确认的训练；日 = 下次练什么 + 这天的训练；周 / 月 / 3 个月 = 有没有进步
import { hm, md, parseYmd, ymd, addDays, today, esc } from '../util.js';
import * as tr from '../training.js';
import * as T from '../tcharts.js';
import { card, empty, nums, num, workouts } from './common.js';
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

// lift name + its sets in words; blocks show the sets one by one (hatched = 吃力)
function liftRows(items, { blocks = true } = {}) {
  const sc = scaleFor(items);
  return `<div class="lifts">${items.map((it) => `<div class="lift-row${blocks ? '' : ' plain'}">
    <span class="ln">${esc(tr.lift(it.lift).name)}</span><span class="ls">${esc(tr.setsLabel(it.lift, it.sets))}</span>
    ${blocks ? `<span class="lb">${T.setBlocks(it.lift, it.sets, { ...sc, W: 150, H: 26 })}</span>` : ''}</div>`).join('')}</div>`;
}

const whenOf = (p) => `${p.date === ymd(today()) ? '' : md(parseYmd(p.date)) + ' '}${hm(new Date(p.start))}–${hm(new Date(p.end))}`;

// ---------- the confirm card: a question, three answers, and "not a workout" ----------
// Only the sessions in the day or period being looked at: a past day shouldn't show today's question.
export function pendingCards(ctx, { date, from, to } = {}) {
  const st = tr.get();
  const list = st.pending.filter((p) => (!date || p.date === date) && (!from || p.date >= from) && (!to || p.date <= to));
  if (!list.length) return '';
  return list.sort((a, b) => b.start - a.start).map((p) => {
    const g = tr.guess(p.date);
    const body = `<div class="pend-hr" data-pending="${esc(p.id)}"></div>
      ${g ? liftRows(g.items, { blocks: false }) : ''}
      <div class="btns">
        ${g ? `<button class="btn pri" data-act="pend-ok" data-id="${esc(p.id)}">是</button>` : ''}
        <button class="btn talk" data-act="pend-talk" data-id="${esc(p.id)}">${talkLabel()}</button>
        <button class="btn" data-act="pend-edit" data-id="${esc(p.id)}">手动改</button>
      </div>
      <div class="btns end"><button class="link" data-act="pend-no" data-id="${esc(p.id)}">不是训练</button></div>`;
    return card(`${whenOf(p)} ${g ? '练的是这些吗？' : '练了什么？'}`, body, { cls: 'confirm' });
  }).join('');
}

// ---------- what to lift next ----------
// Hidden while today's session waits to be confirmed: until then it would name the same lifts again.
export function nextCard(ctx, { link = false } = {}) {
  if (tr.get().pending.some((p) => p.date === ymd(today()))) return '';
  const rec = ctx.v.recovery[ymd(today())]?.total ?? null;
  const plan = tr.nextPlan(rec);
  if (!plan) return '';
  const rows = plan.map((p) => `<div><span class="k">${esc(tr.lift(p.lift).name)}</span><b>${esc(tr.setsLabel(p.lift, p.sets))}</b><span class="n">${esc(p.note)}</span></div>`).join('');
  return card(`下次：${plan.map((p) => esc(tr.lift(p.lift).name)).join(' + ')}`, `<div class="facts">${rows}</div>`,
    link ? { cls: 'tap', act: ' data-act="goto" data-tab="train" data-range="d"' } : {});
}

// ---------- one session (day view only: the header already has the date) ----------
export function sessionCard(s) {
  const when = s.start ? `${hm(new Date(s.start))}–${hm(new Date(s.end))}` : '手动记录';
  return card(when, `${s.start ? `<div class="sess-hr" data-session="${esc(s.id)}"></div>` : ''}${liftRows(s.items)}
    <div class="btns small"><button class="btn" data-act="sess-edit" data-id="${esc(s.id)}">改</button><button class="btn danger" data-act="sess-del" data-id="${esc(s.id)}">删除</button></div>`);
}

// ---------- long term ----------
function summary(ctx) {
  const { per } = ctx;
  const ss = tr.sessionsIn(per.from, per.to);
  if (!ss.length) return '';
  const sets = ss.reduce((a, s) => a + s.items.reduce((b, it) => b + it.sets.length, 0), 0);
  const prs = tr.records(per.from, per.to).length;
  const pend = tr.get().pending.filter((p) => p.date >= per.from && p.date <= per.to).length;
  return card('', nums(num('训练', ss.length, '次', '', pend ? `另有 ${pend} 次待确认` : ''), num('共', sets, '组', 'sm'), num('新纪录', prs, '次', 'sm')), { cls: 'flat' });
}

function progressCard(ctx) {
  const { per } = ctx;
  const rows = tr.allLiftIds().map((id) => ({ id, p: tr.progress(id, per.from, per.to) })).filter((x) => x.p.length).slice(0, 6);
  if (!rows.length) return '';
  const body = rows.map(({ id, p }) => {
    const lf = tr.lift(id), d = Math.round((p.at(-1).top - p[0].top) * 10) / 10;
    const delta = p.length < 2 ? '' : d > 0 ? `+${d} ${lf.bodyweight ? '次' : 'kg'}` : d < 0 ? `${d} ${lf.bodyweight ? '次' : 'kg'}` : '持平';
    return `<div class="lp"><div class="lp-h"><b>${esc(lf.name)}</b><span>${delta}</span></div>${T.liftProgress(p, { id, from: per.from, to: per.to })}</div>`;
  }).join('');
  return card('每次最重的一组', body);
}

function partsCard(ctx) {
  const { per } = ctx;
  const parts = tr.setsPerPart(per.from, per.to);
  if (!Object.values(parts).some((v) => v >= 0.5)) return '';
  return card('练了哪些部位', T.partBars(parts, tr.PARTS));
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
  const days = Object.values(byDate).filter((x) => x.lifts.length).length;
  if (!days) return '';
  return card(`${per.range === 'w' ? '7' : '30'} 天里练了 ${days} 天`, T.trainCal({ start: per.start, end: per.end, byDate, todayKey: ymd(today()), row: per.range === 'w' }));
}

function weeklyCard(ctx) {
  const { per } = ctx;
  const n = per.range === 'q' ? 13 : 4;
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = addDays(per.end, -7 * i), start = addDays(end, -6);
    const by = {};
    for (const s of tr.sessionsIn(ymd(start), ymd(end))) for (const it of s.items) by[it.lift] = (by[it.lift] || 0) + it.sets.length;
    weeks.push({ label: `${md(start)}–${md(end)}`, by });
  }
  const tot = weeks.map((w) => Object.values(w.by).reduce((a, x) => a + x, 0));
  if (!tot.some(Boolean)) return '';
  return card(`平均每周 ${Math.round(tot.reduce((a, x) => a + x, 0) / n)} 组`, T.weeklySets(weeks));
}

export function render(ctx) {
  const { per } = ctx;
  let out = pendingCards(ctx, per.range === 'd' ? { date: per.to } : { from: per.from, to: per.to });
  if (!tr.sessions().length && !tr.get().pending.length) {
    return card('', `<div class="empty">练完打开 app 确认就行。</div>
      <div class="btns center"><button class="btn" data-act="sess-new">记一次训练</button></div>`, { cls: 'flat' });
  }
  if (per.range === 'd') {
    if (per.offset === 0) out += nextCard(ctx);
    const ss = tr.sessions().filter((s) => s.date === per.to);
    out += ss.map((s) => sessionCard(s)).join('');
    if (!ss.length && !tr.get().pending.some((p) => p.date === per.to)) out += empty(per.offset === 0 ? '今天还没有训练记录' : '这天没有训练记录');
  } else {
    const sum = summary(ctx);
    if (!sum) out += empty('这段时间没有训练记录');
    out += sum;
    if (per.range !== 'w') out += progressCard(ctx);
    if (per.range !== 'q') out += partsCard(ctx) + calendarCard(ctx);
    if (per.range !== 'w') out += weeklyCard(ctx);
  }
  out += `<div class="btns center"><button class="btn" data-act="sess-new" data-date="${per.to}">手动记一次</button></div>`;
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
      const { peaks, spans } = tr.setSpans(p.peaks || [], g ? g.items : []);
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
      const { peaks, spans } = tr.setSpans(raw, s.items);
      if (el.isConnected) el.innerHTML = T.sessionHr(pts, { start: a, end: b, peaks, spans });
    } catch { /* no HR */ }
  }
}
