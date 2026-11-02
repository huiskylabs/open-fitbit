import * as auth from './js/auth.js';
import * as api from './js/api.js';
import { demoData, demoHr } from './js/demo.js';
import { STAGES, hypnogram, sleepNights, lineChart, lineHover, clearHover, barChart, hm, dur } from './js/charts.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const state = { tab: 'today', nightIdx: 0, hrDay: 0, data: null, demo: false, loading: false, error: null };

const EX = {
  RUNNING: ['🏃', '跑步'], WALKING: ['🚶', '步行'], HIKING: ['🥾', '徒步'], BIKING: ['🚴', '骑行'], SWIMMING: ['🏊', '游泳'],
  WEIGHTLIFTING: ['🏋️', '力量训练'], FREE_WEIGHTS: ['🏋️', '自由重量'], FUNCTIONAL_STRENGTH_TRAINING: ['🏋️', '功能性力量'],
  YOGA: ['🧘', '瑜伽'], PILATES: ['🧘', '普拉提'], ELLIPTICAL: ['⚙️', '椭圆机'], HIIT: ['🔥', 'HIIT'], TENNIS: ['🎾', '网球'],
  BADMINTON: ['🏸', '羽毛球'], BASKETBALL: ['🏀', '篮球'], SOCCER: ['⚽️', '足球'], DANCING: ['💃', '跳舞'], ROWING_MACHINE: ['🚣', '划船机'],
  TREADMILL: ['🏃', '跑步机'], INDOOR_CLIMBING: ['🧗', '攀岩'], CLIMBING: ['🧗', '攀岩'], GOLF: ['⛳️', '高尔夫'], CROSSFIT: ['🔥', 'CrossFit'],
  SPINNING: ['🚴', '动感单车'], STAIR_CLIMBING: ['🪜', '爬楼梯'], BOXING: ['🥊', '拳击'], MARTIAL_ARTS: ['🥋', '武术'],
};
const exInfo = (e) => { const x = EX[e.type]; return x ? [x[0], x[1]] : ['⚡️', e.name || (e.type || '运动').toLowerCase().replace(/_/g, ' ')]; };
const ZONES = [['moderate', '燃脂', 'var(--z1)'], ['vigorous', '有氧', 'var(--z2)'], ['peak', '峰值', 'var(--z3)']];
const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' 公里' : Math.round(m) + ' 米');
const dayLabel = (d) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((t - dd) / 864e5);
  const wk = '日一二三四五六'[dd.getDay()];
  return diff === 0 ? '今天' : diff === 1 ? '昨天' : `${dd.getMonth() + 1}月${dd.getDate()}日 周${wk}`;
};

// ---------- data ----------
async function load(force = false) {
  state.demo = !auth.isSignedIn();
  if (state.demo) { state.data = demoData(); render(); return; }
  if (force) api.clearCache();
  state.loading = true; state.error = null; spin(true); render();
  try {
    const [sleeps, exercises, rhr, hrv, steps] = await Promise.all([
      api.getSleeps(21), api.getExercises(45), api.getRestingHr(30), api.getHrv(30).catch(() => []), api.getDailySteps(14),
    ]);
    state.data = { sleeps, exercises, rhr, hrv, steps };
  } catch (e) {
    state.error = e.message;
    if (e.message === 'NOT_SIGNED_IN') { state.error = null; state.demo = true; state.data = demoData(); }
  }
  state.loading = false; spin(false); render();
}
const spin = (on) => $('#refresh').classList.toggle('spin', on);

async function hrFor(start, end, win, workout) {
  if (state.demo) return demoHr(start, end, win, workout);
  return api.getHrSeries(start, end, win);
}

// ---------- shell ----------
function banner() {
  const b = $('#banner');
  if (state.error) { b.className = 'banner err'; b.innerHTML = `${state.error} <button data-act="settings">去设置</button>`; b.hidden = false; return; }
  if (state.demo) { b.className = 'banner'; b.innerHTML = `现在显示的是示例数据。<button data-act="settings">连接我的 Fitbit →</button>`; b.hidden = false; return; }
  b.hidden = true;
}

function render() {
  banner();
  $('#title').textContent = { today: '今天', sleep: '睡眠', workouts: '运动', heart: '心率' }[state.tab];
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  if (!state.data) { view.innerHTML = `<div class="empty">${state.loading ? '正在读取数据…' : ''}</div>`; return; }
  view.innerHTML = { today: viewToday, sleep: viewSleep, workouts: viewWorkouts, heart: viewHeart }[state.tab]();
  if (state.tab === 'heart') fillHeartDay();
}

const mainNights = () => {
  const all = state.data.sleeps;
  const main = all.filter((s) => s.main || !s.nap);
  // one main sleep per wake-up date
  const seen = new Set();
  return main.filter((s) => { const k = s.end.toDateString(); if (seen.has(k)) return false; seen.add(k); return true; });
};

function stageRows(s) {
  const total = STAGES.reduce((a, st) => a + (s.byStage[st.key] || 0), 0) || 1;
  if (!s.hasStages) return `<div class="note">这晚没有分期数据（手表佩戴太松或睡眠时间太短时只记录总时长）。</div>`;
  return STAGES.map((st) => {
    const m = s.byStage[st.key] || 0;
    return `<div class="stage-row"><span class="name">${st.name}</span><div class="bar"><span style="width:${(m / total) * 100}%;background:${st.color}"></span></div><span class="val">${dur(m)} · ${Math.round((m / total) * 100)}%</span></div>`;
  }).join('');
}
const stack = (s) => `<div class="stack">${['DEEP', 'LIGHT', 'REM', 'AWAKE'].map((k) => { const st = STAGES.find((x) => x.key === k); const m = s.byStage[k] || 0; return m ? `<span style="flex:${m};background:${st.color}" title="${st.name}"></span>` : ''; }).join('')}</div>`;
const legend = () => `<div class="legend">${STAGES.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;

const nightLabel = (s) => {
  const d = new Date(s.end); d.setDate(d.getDate() - 1);
  const l = dayLabel(d);
  return l === '昨天' ? '昨晚' : l === '今天' ? '今晚' : l + ' 晚上';
};

// ---------- Today ----------
function viewToday() {
  const n = mainNights()[0];
  const rhr = state.data.rhr.at(-1);
  const steps = state.data.steps.at(-1);
  const recent = state.data.exercises.slice(0, 3);
  return `
  <div class="card" data-act="tab" data-tab-to="sleep" style="cursor:pointer">
    <h2>昨晚睡眠 <span class="sub">${n ? `${hm(n.start)} – ${hm(n.end)}` : ''}</span></h2>
    ${n ? `<div class="hero">${Math.floor(n.asleep / 60)}<small>小时</small> ${n.asleep % 60}<small>分</small></div>${n.hasStages ? stack(n) + legend() : ''}` : '<div class="muted">还没有睡眠记录</div>'}
  </div>
  <div class="row">
    <div class="stat" data-act="tab" data-tab-to="heart"><div class="k">静息心率</div><div class="v">${rhr ? rhr.v : '–'}<small>次/分</small></div></div>
    <div class="stat"><div class="k">今日步数</div><div class="v">${steps ? steps.v.toLocaleString() : '–'}</div></div>
  </div>
  <div class="day-h">最近运动 · 自动识别 + 手表记录</div>
  ${recent.length ? recent.map(workoutCard).join('') : '<div class="empty">最近 45 天没有运动记录</div>'}
  <div class="card"><h2>最近 14 天步数</h2>${barChart(state.data.steps, { unit: '步', goal: 10000 })}</div>`;
}

// ---------- Sleep ----------
function viewSleep() {
  const nights = mainNights();
  if (!nights.length) return '<div class="empty">最近没有睡眠记录</div>';
  state.nightIdx = Math.min(state.nightIdx, nights.length - 1);
  const s = nights[state.nightIdx];
  const nap = state.data.sleeps.filter((x) => x.nap && x.end.toDateString() === s.end.toDateString());
  return `
  <div class="nav-day">
    <button data-act="night" data-d="1" ${state.nightIdx >= nights.length - 1 ? 'disabled' : ''}>‹</button>
    <span class="d">${nightLabel(s)}</span>
    <button data-act="night" data-d="-1" ${state.nightIdx === 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="card">
    <h2>总睡眠 <span class="sub">${hm(s.start)} 上床 · ${hm(s.end)} 起床</span></h2>
    <div class="hero">${Math.floor(s.asleep / 60)}<small>小时</small> ${s.asleep % 60}<small>分</small></div>
    <div style="margin-top:12px">${s.stages.length ? hypnogram(s) : ''}</div>
    <div class="note">点一下色块可以看每段的时间。</div>
  </div>
  <div class="card"><h2>各阶段</h2>${stageRows(s)}</div>
  <div class="card"><h2>细节</h2>
    <div class="grid4">
      <div><div class="k">在床时间</div><div class="v">${dur(s.inBed)}</div></div>
      <div><div class="k">入睡用时</div><div class="v">${dur(s.toFallAsleep)}</div></div>
      <div><div class="k">清醒次数</div><div class="v">${s.awakenings} 次</div></div>
      <div><div class="k">清醒总时长</div><div class="v">${dur(s.byStage.AWAKE || s.awake)}</div></div>
    </div>
    ${nap.length ? `<div class="note">当天还有 ${nap.length} 次小睡，共 ${dur(nap.reduce((a, x) => a + x.asleep, 0))}。</div>` : ''}
  </div>
  <div class="card"><h2>最近每晚 <span class="sub">点柱子切换</span></h2>${sleepNights(nights.slice(0, 14))}${legend()}
    <details><summary>表格</summary><table class="data"><tr><th>日期</th><th>睡眠</th><th>深睡</th><th>REM</th></tr>
    ${nights.slice(0, 14).map((n) => `<tr><td>${n.end.getMonth() + 1}/${n.end.getDate()}</td><td>${dur(n.asleep)}</td><td>${dur(n.byStage.DEEP || 0)}</td><td>${dur(n.byStage.REM || 0)}</td></tr>`).join('')}</table></details>
  </div>`;
}

// ---------- Workouts ----------
function workoutCard(e) {
  const [ic, name] = exInfo(e);
  const bits = [dur(e.activeSec / 60)];
  if (e.distanceM) bits.push(fmtKm(e.distanceM));
  if (e.kcal) bits.push(Math.round(e.kcal) + ' 千卡');
  if (e.avgHr) bits.push('♥︎ ' + e.avgHr);
  const zt = ZONES.reduce((a, [k]) => a + (e.zones[k] || 0), 0);
  return `<button class="wk" data-act="workout" data-id="${e.id}">
    <div class="ic">${ic}</div>
    <div class="body">
      <div class="t">${name} ${e.manual ? '<span class="tag">手动</span>' : ''}</div>
      <div class="m">${dayLabel(e.start)} ${hm(e.start)} · ${bits.join(' · ')}</div>
      ${zt ? `<div class="zones">${ZONES.map(([k, , c]) => (e.zones[k] ? `<span style="flex:${e.zones[k]};background:${c}"></span>` : '')).join('')}<span style="flex:${Math.max(0, e.activeSec - zt)};background:var(--card-2)"></span></div>` : ''}
    </div></button>`;
}

function viewWorkouts() {
  const ex = state.data.exercises;
  if (!ex.length) return '<div class="empty">最近 45 天没有运动记录。<br>Fitbit 会自动识别 10 分钟以上的步行、跑步、骑行等。</div>';
  const week = ex.filter((e) => e.start > api.daysAgo(6));
  const mins = week.reduce((a, e) => a + e.activeSec / 60, 0);
  const kcal = week.reduce((a, e) => a + (e.kcal || 0), 0);
  let out = `<div class="row">
    <div class="stat"><div class="k">近 7 天运动</div><div class="v">${week.length}<small>次</small></div></div>
    <div class="stat"><div class="k">总时长</div><div class="v">${Math.round(mins)}<small>分钟</small></div></div>
    <div class="stat"><div class="k">消耗</div><div class="v">${Math.round(kcal)}<small>千卡</small></div></div>
  </div>
  <div class="legend" style="margin:0 2px 4px">${ZONES.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}区间</span>`).join('')}</div>`;
  let last = '';
  for (const e of ex) {
    const d = dayLabel(e.start);
    if (d !== last) { out += `<div class="day-h">${d}</div>`; last = d; }
    out += workoutCard(e);
  }
  return out;
}

async function openWorkout(id) {
  const e = state.data.exercises.find((x) => x.id === id);
  if (!e) return;
  const [ic, name] = exInfo(e);
  const pace = e.distanceM && ['RUNNING', 'WALKING', 'TREADMILL', 'HIKING'].includes(e.type) ? e.activeSec / (e.distanceM / 1000) : null;
  const sheet = openSheet(`<h3>${ic} ${name}</h3>
    <div class="muted">${dayLabel(e.start)} ${hm(e.start)} – ${hm(e.end)}${e.manual ? ' · 手动记录' : ''}</div>
    <div class="card" style="margin-top:12px"><div class="grid4" style="margin-top:0">
      <div><div class="k">时长</div><div class="v">${dur(e.activeSec / 60)}</div></div>
      <div><div class="k">平均心率</div><div class="v">${e.avgHr ? e.avgHr + ' 次/分' : '–'}</div></div>
      <div><div class="k">消耗</div><div class="v">${e.kcal ? Math.round(e.kcal) + ' 千卡' : '–'}</div></div>
      <div><div class="k">${pace ? '配速' : '距离'}</div><div class="v">${pace ? `${Math.floor(pace / 60)}'${String(Math.round(pace % 60)).padStart(2, '0')}"/公里` : e.distanceM ? fmtKm(e.distanceM) : '–'}</div></div>
      ${e.steps ? `<div><div class="k">步数</div><div class="v">${e.steps.toLocaleString()}</div></div>` : ''}
      ${e.azm ? `<div><div class="k">活动区间分钟</div><div class="v">${e.azm}</div></div>` : ''}
    </div></div>
    <div class="card"><h2>心率</h2><div id="wk-hr"><div class="empty">读取中…</div></div></div>
    <div class="card"><h2>心率区间</h2>${ZONES.map(([k, n, c]) => { const m = (e.zones[k] || 0) / 60; return `<div class="stage-row"><span class="name">${n}</span><div class="bar"><span style="width:${Math.min(100, (m * 60 / e.activeSec) * 100)}%;background:${c}"></span></div><span class="val">${dur(m)}</span></div>`; }).join('')}</div>`);
  try {
    const pts = await hrFor(e.start, e.end, 30, e);
    $('#wk-hr', sheet).innerHTML = lineChart(pts, { unit: '次/分', fmtX: (a, b) => [[a, hm(new Date(a))], [b, hm(new Date(b))]], band: false });
  } catch (err) { $('#wk-hr', sheet).innerHTML = `<div class="empty">${err.message}</div>`; }
}

// ---------- Heart ----------
function viewHeart() {
  const { rhr, hrv } = state.data;
  const avg = rhr.length ? Math.round(rhr.reduce((a, x) => a + x.v, 0) / rhr.length) : null;
  const d = api.daysAgo(state.hrDay);
  return `
  <div class="nav-day">
    <button data-act="hrday" data-d="1" ${state.hrDay >= 13 ? 'disabled' : ''}>‹</button>
    <span class="d">${dayLabel(d)}</span>
    <button data-act="hrday" data-d="-1" ${state.hrDay === 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="card"><h2>全天心率 <span class="sub">每 5 分钟平均 · 阴影为最高/最低</span></h2><div id="hr-day"><div class="empty">读取中…</div></div></div>
  <div class="card"><h2>静息心率 <span class="sub">30 天平均 ${avg ?? '–'}</span></h2>
    <div class="hero">${rhr.at(-1)?.v ?? '–'}<small>次/分</small></div>
    ${lineChart(rhr.map((x) => ({ t: new Date(x.date + 'T12:00'), v: x.v })), { color: 'var(--hr)', unit: '次/分', ref: avg, fmtX: dateTicks })}
  </div>
  ${hrv.length ? `<div class="card"><h2>心率变异性 HRV <span class="sub">睡眠期间 RMSSD</span></h2>
    <div class="hero">${Math.round(hrv.at(-1).v)}<small>毫秒</small></div>
    ${lineChart(hrv.map((x) => ({ t: new Date(x.date + 'T12:00'), v: x.v })), { color: 'var(--accent)', unit: '毫秒', fmtX: dateTicks })}
    <div class="note">HRV 越高通常代表恢复越好；看自己的趋势比看绝对值更有意义。</div></div>` : ''}`;
}
const dateTicks = (a, b) => { const out = []; for (let t = a; t <= b; t += 7 * 864e5) { const d = new Date(t); out.push([t, `${d.getMonth() + 1}/${d.getDate()}`]); } return out; };

async function fillHeartDay() {
  const start = api.daysAgo(state.hrDay), end = api.daysAgo(state.hrDay - 1);
  const want = state.hrDay;
  try {
    const pts = await hrFor(start, new Date(Math.min(end, Date.now())), 300);
    if (want !== state.hrDay || state.tab !== 'heart') return;
    const el = $('#hr-day'); if (!el) return;
    el.innerHTML = lineChart(pts, { band: true, unit: '次/分', fmtX: (a) => [0, 6, 12, 18].map((h) => [+start + h * 3600e3, `${h}点`]).filter(([t]) => t >= a - 1) });
  } catch (e) { const el = $('#hr-day'); if (el) el.innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ---------- settings ----------
function openSettings() {
  const c = auth.getConfig();
  const t = auth.tokenInfo();
  const days = t?.obtained_at ? Math.max(0, 7 - Math.floor((Date.now() - t.obtained_at) / 864e5)) : null;
  const sheet = openSheet(`<h3>设置</h3>
    ${auth.isSignedIn() ? `<div class="card"><b>已连接 Fitbit ✓</b><div class="note">测试模式下登录大约 ${days ?? 7} 天后过期，到时点下面重新连接即可。</div>
      <button class="btn ghost" data-act="login">重新连接</button><button class="btn danger" data-act="logout">断开连接</button></div>` : ''}
    <label class="field"><span>Client ID</span><input id="cid" autocomplete="off" autocapitalize="off" spellcheck="false" value="${c.clientId || ''}" placeholder="xxxx.apps.googleusercontent.com"></label>
    <label class="field"><span>Client Secret</span><input id="csec" type="password" autocomplete="off" value="${c.clientSecret || ''}" placeholder="GOCSPX-…"></label>
    <div class="note">只保存在这台手机上，不会上传到任何地方。在 Google Cloud 的 OAuth 客户端里，"已获授权的重定向 URI" 需要加上：<br><code>${auth.redirectUri()}</code></div>
    <button class="btn" data-act="save-login">保存并连接 Fitbit</button>
    <details style="margin-top:14px"><summary>登录后跳回了 Safari 而不是这个 app？</summary>
      <div class="note">把 Safari 地址栏里那个以 <code>${auth.redirectUri()}?…code=</code> 开头的完整网址复制，粘贴到这里：</div>
      <label class="field"><input id="paste-url" placeholder="粘贴网址"></label>
      <button class="btn ghost" data-act="paste-code">完成连接</button>
    </details>`);
  return sheet;
}

let sheetEls = [];
function openSheet(html) {
  closeSheet();
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.dataset.act = 'close-sheet';
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bg, sh); sheetEls = [bg, sh];
  return sh;
}
function closeSheet() { sheetEls.forEach((e) => e.remove()); sheetEls = []; hideTip(); }

// ---------- tooltip ----------
const tip = $('#tip');
let tipTimer;
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
  tip.style.top = Math.max(8, y - r.height - 14) + 'px';
  clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 3500);
}
function hideTip() { tip.hidden = true; document.querySelectorAll('svg').forEach(clearHover); }

function pointer(ev) {
  const el = ev.target;
  if (el.dataset?.line) { const h = lineHover(el, ev.clientX); if (h) showTip(h, ev.clientX, ev.clientY); return true; }
  if (el.dataset?.tip) { showTip(el.dataset.tip, ev.clientX, ev.clientY); return true; }
  return false;
}
document.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) pointer(ev); });
document.addEventListener('pointerdown', (ev) => { if (!pointer(ev)) hideTip(); });

// ---------- events ----------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act], [data-tab], [data-night]');
  if (!t) return;
  if (t.dataset.tab && t.closest('.tabs')) { state.tab = t.dataset.tab; render(); scrollTo(0, 0); return; }
  if (t.dataset.night) { const i = mainNights().findIndex((n) => n.id === t.dataset.night); if (i >= 0) { state.nightIdx = i; render(); } return; }
  const act = t.dataset.act;
  try {
    if (act === 'tab') { state.tab = t.dataset.tabTo; render(); scrollTo(0, 0); }
    else if (act === 'night') { state.nightIdx += +t.dataset.d; render(); }
    else if (act === 'hrday') { state.hrDay += +t.dataset.d; render(); }
    else if (act === 'workout') openWorkout(t.dataset.id);
    else if (act === 'settings') openSettings();
    else if (act === 'close-sheet') closeSheet();
    else if (act === 'save-login') {
      const clientId = $('#cid').value.trim(), clientSecret = $('#csec').value.trim();
      if (!clientId || !clientSecret) { alert('请填写 Client ID 和 Client Secret'); return; }
      auth.setConfig({ clientId, clientSecret });
      await auth.startLogin();
    } else if (act === 'login') await auth.startLogin();
    else if (act === 'logout') { auth.signOut(); api.clearCache(); closeSheet(); load(); }
    else if (act === 'paste-code') { await auth.handleRedirect($('#paste-url').value.trim()); closeSheet(); load(true); }
  } catch (e) { alert(e.message); }
});
$('#open-settings').addEventListener('click', openSettings);
$('#refresh').addEventListener('click', () => load(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.demo) load(); });

// ---------- boot ----------
(async () => {
  try { if (await auth.handleRedirect()) state.tab = 'today'; } catch (e) { state.error = e.message; }
  load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
