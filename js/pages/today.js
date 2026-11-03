// 今天：先确认训练，再看这一天。24 小时表盘（夜里在下、中午在上）画出睡眠分期、每次运动和心率；
// 点下面的一段，表盘上其余变暗，中间换成那一段的数字。
import { ymd, today, fmtInt, esc, hm, hmDur, mean } from '../util.js';
import * as C from '../charts.js';
import * as Dl from '../dial.js';
import { workouts, sleepWhy, recoveryWhy, METRIC, rangeText, sp, zonesMin, shortKind, lifts2, recRow, clockDur } from './common.js';
import { pendingCards, nextCard } from './trainpage.js';
import { isWorse, WORSE } from '../scores.js';
import { hrSeries, stepsUsualByNow } from '../data.js';
import * as tr from '../training.js';

const KCOL = { sleep: 'var(--light)', strength: 'var(--strength)', basketball: 'var(--ball)', other: 'var(--other)' };

// everything the dial shows, for the 24 hours before now
function model(v) {
  const end = Date.now(), start = end - 864e5, t = ymd(today());
  const n = v.nights[t];
  const sleeps = v.m.sleeps.filter((s) => s.end > start && s.start < end);
  const ws = workouts(v).filter((w) => w.end > start && w.start < end);
  const items = [];
  if (n) items.push({ key: 'sleep', kind: 'sleep', start: n.start, end: n.end, short: '睡', chip: clockDur(n.asleep), title: `睡 ${hmDur(n.asleep)}`, sub: `${hm(new Date(n.start))}–${hm(new Date(n.end))}` });
  for (const w of ws) {
    const mins = Math.round(w.activeSec / 60);
    items.push({ key: w.id, kind: w.kind, start: w.start, end: w.end, w, short: shortKind(w), chip: String(mins), title: `${shortKind(w)} ${mins} 分钟`, sub: w.avgHr ? `平均 ${w.avgHr} bpm` : hm(new Date(w.start)) });
  }
  // a strength session the app spotted but you haven't confirmed yet still shows on the dial
  for (const p of tr.get().pending || []) {
    if (!(p.end > start && p.start < end) || ws.some((w) => w.start < p.end && p.start < w.end)) continue;
    const mins = Math.round((p.end - p.start) / 60e3);
    const pw = { id: 'pend-' + p.id, kind: 'strength', start: p.start, end: p.end };
    ws.push(pw);
    items.push({ key: pw.id, kind: 'strength', start: p.start, end: p.end, w: pw, short: '力量?', chip: String(mins), title: `力量？${mins} 分钟`, sub: '待确认' });
  }
  items.sort((a, b) => a.start - b.start);
  return { end, start, n, sleeps, ws, items };
}

function dialSvg(v, M, hr, sel) {
  const t = ymd(today());
  const sc = v.sleepScores[t], rec = v.recovery[t];
  let center;
  const it = M.items.find((x) => x.key === sel);
  if (it?.kind === 'sleep') center = { k: `${hm(new Date(it.start))}–${hm(new Date(it.end))}`, v: it.chip, n: sc ? `睡眠分 ${sc.total}` : '' };
  else if (it) {
    const pts = (hr || []).filter((p) => p.t >= it.start && p.t <= it.end);
    const top = pts.length ? Math.round(Math.max(...pts.map((p) => p.hi ?? p.v))) : null;
    center = { k: `${it.short} · ${hm(new Date(it.start))}–${hm(new Date(it.end))}`, v: it.chip, unit: '分钟', n: [it.w?.avgHr ? `平均 ${it.w.avgHr}` : '', top ? `最高 ${top}` : ''].filter(Boolean).join('　') };
  } else if (rec) center = { k: '恢复分', v: rec.total, n: sc ? `睡眠分 ${sc.total}` : '' };
  else if (sc) center = { k: '睡眠分', v: sc.total };
  return Dl.dayDial({
    end: M.end, sleeps: M.sleeps, hr, sel, center,
    workouts: M.ws.map((w) => ({ key: w.id, kind: w.kind, start: w.start, end: w.end })),
    labels: M.items.map((x) => ({ key: x.key, t: (x.start + x.end) / 2, title: x.title, sub: x.sub })),
  });
}

function chips(M, sel) {
  if (!M.items.length) return '';
  return `<div class="chips">${M.items.map((x) => `<button class="chip2" data-sel="${esc(x.key)}" aria-pressed="${x.key === sel}"><i style="background:${KCOL[x.kind] || KCOL.other}"></i>${esc(x.short)} <b>${esc(x.chip)}</b></button>`).join('')}</div>`;
}

// under the dial: the body numbers, or the selected thing's details
function below(v, M, sel) {
  const t = ymd(today());
  const it = M.items.find((x) => x.key === sel);
  if (it?.kind === 'sleep') {
    const n = M.n, sw = sleepWhy(v, t);
    const rows = n.hasStages ? C.STAGES.map((s) => `<div><span class="k">${s.name}</span><b>${hmDur(n.byStage[s.key] || 0)}</b><span class="n"></span></div>`).join('') : '';
    return `<section class="card"><h2><span>${sw ? esc(sw.why) : '昨晚'}</span></h2>${rows ? `<div class="facts">${rows}</div>` : ''}</section>`;
  }
  if (it) {
    const w = it.w;
    let out = '';
    if (!w.type) return '';
    if (w.kind === 'strength' && w.sessionId) {
      const s = tr.get().sessions.find((x) => x.id === w.sessionId);
      if (s) out += `<section class="card"><h2><span>练了什么</span></h2>${lifts2(s.items)}</section>`;
    }
    if (w.zones && Object.values(w.zones).some(Boolean)) out += `<section class="card"><h2><span>心率区间</span></h2>${C.zoneRows(zonesMin(w.zones))}</section>`;
    return out;
  }
  const d = v.daily[t] || {};
  const b = (k) => v.base[k]?.[t];
  const cell = (k, color) => {
    if (d[k] == null) return '';
    const bad = isWorse(k, d[k], b(k));
    return `<div><div class="k"><i style="background:${color}"></i>${METRIC[k].name}</div><div class="v${bad ? ' warn' : ''}">${METRIC[k].fmt(d[k])}<small>${METRIC[k].unit}</small></div><div class="n${bad ? ' warn' : ''}">${bad ? `偏${WORSE[k] === 'low' ? '低' : '高'}，` : ''}${rangeText(k, b(k))}</div></div>`;
  };
  const steps = d.steps != null ? `<div><div class="k"><i style="background:var(--text)"></i>步数</div><div class="v">${fmtInt(d.steps)}</div><div class="n" id="steps-usual">${v.stepsAvg ? `平时一天 ${fmtInt(v.stepsAvg)}` : ''}</div></div>` : '';
  const cells = [cell('rhr', 'var(--hr)'), cell('hrv', 'var(--light)'), steps].filter(Boolean);
  let out = cells.length ? `<section class="card flat"><div class="trio">${cells.join('')}</div></section>` : '';
  // the other two body signs only when one is off
  const off = ['resp', 'skinRel'].filter((k) => d[k] != null && isWorse(k, d[k], b(k)));
  if (off.length) out += `<p class="note warn">${off.map((k) => `${sp(METRIC[k].name)}偏${WORSE[k] === 'low' ? '低' : '高'}（${METRIC[k].fmt(d[k])} ${METRIC[k].unit}，${rangeText(k, b(k))}）`).join('；')}</p>`;
  return out;
}

// The app only sees what the watch has uploaded (watch → Fitbit app on the phone → Google).
// When that was a while ago, say so, so a just-finished workout that isn't here yet makes sense.
function watchNote(v) {
  const last = Math.max(0, ...(v.m.devices || []).map((d) => d.lastSync || 0));
  if (!last) return '';
  const min = Math.round((Date.now() - last) / 60e3);
  if (min < 20) return '';
  const t = min < 60 ? `${min} 分钟前` : min < 1440 ? `${Math.round(min / 60)} 小时前` : hm(new Date(last));
  return `<p class="note">手表 ${t}同步过，之后的还没上来。打开 Fitbit app 让手表同步一下，再回来就有了。</p>`;
}

export function render(ctx) {
  const { v } = ctx;
  const M = model(v);
  let out = watchNote(v) + pendingCards(ctx);
  if (M.items.length || v.recovery[ymd(today())]) {
    out += `<section class="card dialcard" id="today-dial"><div class="dialwrap">${dialSvg(v, M, null, null)}</div>${chips(M, null)}</section>`;
    out += `<div id="today-below">${below(v, M, null)}</div>`;
  }
  out += nextCard(ctx, { link: true });
  const todays = workouts(v).filter((w) => ymd(new Date(w.start)) === ymd(today()));
  if (todays.length) out += `<section class="card"><h2><span>今天的运动</span></h2>${[...todays].reverse().map((w) => recRow(w)).join('')}</section>`;
  if (!out) out = '<div class="empty">还没有数据</div>';
  return out;
}

export async function after(ctx, root) {
  const { v } = ctx;
  const box = root.querySelector('#today-dial');
  const { after: trainAfter } = await import('./trainpage.js');
  const tasks = [trainAfter(ctx, root)];
  if (box) {
    const M = model(v);
    let hr = null, sel = null, usual = null;
    const draw = () => {
      box.querySelector('.dialwrap').innerHTML = dialSvg(v, M, hr, sel);
      box.querySelectorAll('.chip2').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sel === sel)));
      const bl = root.querySelector('#today-below');
      if (bl) bl.innerHTML = below(v, M, sel);
      const su = root.querySelector('#steps-usual'); if (su && usual) su.textContent = `平时到这会 ${fmtInt(usual)}`;
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.chip2');
      if (!b) return;
      sel = sel === b.dataset.sel ? null : b.dataset.sel;
      draw();
    });
    tasks.push(hrSeries(M.start, M.end, 300).then((pts) => { hr = pts; if (box.isConnected) draw(); }).catch((e) => console.warn(e)));
    tasks.push(stepsUsualByNow().then((u) => { usual = u; const el = root.querySelector('#steps-usual'); if (u && el) el.textContent = `平时到这会 ${fmtInt(u)}`; }).catch(() => {}));
  }
  await Promise.all(tasks);
}
