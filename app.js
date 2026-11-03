// 我的健康 v3 — app shell: four tabs, one shared 日 / 周 / 月 / 3个月 switch, sync, training detection, settings.
import * as auth from './js/auth.js';
import * as api from './js/api.js';
import * as data from './js/data.js';
import * as tr from './js/training.js';
import * as drive from './js/drive.js';
import * as voice from './js/voice.js';
import * as store from './js/store.js';
import * as ui from './js/ui.js';
import * as editor from './js/trainui.js';
import { demoSource, demoTraining, DEMO_ZONES } from './js/demo.js';
import { zoneOf, zonesOrDefault } from './js/scores.js';
import { esc, ymd, parseYmd, addDays, today, dayDiff, hm, md, wk, clamp } from './js/util.js';
import { MAX_OFFSET, period, workouts, nightLabel } from './js/pages/common.js';
import * as pToday from './js/pages/today.js';
import * as pSleep from './js/pages/sleep.js';
import * as pWork from './js/pages/workouts.js';
import * as pHeart from './js/pages/heart.js';

const PAGES = { today: pToday, sleep: pSleep, workouts: pWork, heart: pHeart };
const TITLES = { today: '今天', sleep: '睡眠', workouts: '运动', heart: '心率' };
const SIZE = { d: 1, w: 7, m: 30, q: 91 };
const $ = (s, el = document) => el.querySelector(s);

const pref = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('ui:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ui:' + k, JSON.stringify(v)); } catch {} },
};

const S = {
  tab: PAGES[pref.get('tab')] ? pref.get('tab') : 'today',
  range: SIZE[pref.get('range')] ? pref.get('range') : 'w',
  offset: 0,
  demo: true, expired: false, reconnect: '', model: null, v: null, syncing: false, err: '', focus: null, dayKey: ymd(today()),
};

// ---------- render ----------
function currentPeriod() { return S.tab === 'today' ? period('d', 0) : period(S.range, S.offset); }

// the page name with the days it shows next to it ("睡眠 近 7 天"); a sleep day is named by its night
function header(per) {
  $('#title').textContent = TITLES[S.tab];
  const d = today();
  $('#plabel').textContent = S.tab === 'today' ? `${md(d)} 周${wk(d)}` : S.tab === 'sleep' && per.range === 'd' ? nightLabel(per.to) : per.label;
  const p = $('#period');
  p.hidden = S.tab === 'today';
  if (!p.hidden) {
    p.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.range === S.range)));
    $('[data-nav="1"]').disabled = S.offset >= MAX_OFFSET[S.range];
    $('[data-nav="-1"]').disabled = S.offset <= 0;
  }
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
}

// A failed sync in one plain sentence with the one button that helps; Google's own words go under 详情.
function syncError(e) {
  const m = String(e?.message || e || '');
  if (e?.name === 'TypeError' || /Failed to fetch|Load failed|NetworkError|network connection/i.test(m)) return { text: '没连上网络', act: 'sync', btn: '重试' };
  if (e?.status === 401 || e?.status === 403) return { text: '需要重新授权', act: 'login', btn: '重新连接', detail: m };
  if (/[\u4e00-\u9fff]/.test(m) && !/^API \d/.test(m)) return { text: m, act: 'sync', btn: '重试' };
  return { text: '同步失败', act: 'sync', btn: '重试', detail: m };
}

function banner() {
  const b = $('#banner');
  const signed = !S.demo && auth.isSignedIn();
  const ask = signed ? drive.ask() : '';
  let h = '';
  if (S.demo) h = '现在看到的是示例数据 <button data-act="settings">连接我的 Fitbit</button>';
  else if (S.expired) h = '登录过期了（测试模式每 7 天一次）<button data-act="login">重新连接</button>';
  else if (S.reconnect === 'REVOKE') h = 'Google Health 不接受这次登录。先在 Google 账号里移除这个 app 的访问权限，再重新连接。<a class="bn" href="https://myaccount.google.com/connections" target="_blank" rel="noopener">去移除</a> <button data-act="login">重新连接</button>';
  else if (S.reconnect) h = '要重新连接一次 Fitbit，同步才能继续 <button data-act="login">重新连接</button>';
  else if (S.err) {
    const f = syncError(S.err);
    h = `<span>${esc(f.text)}</span>${f.detail ? '<button class="bn-more" data-act="err-detail">详情</button>' : ''}<button data-act="${f.act}">${f.btn}</button>${f.detail ? `<div class="bn-detail" hidden>${esc(f.detail)}</div>` : ''}`;
  }
  else if (ask === 'first') h = '训练记录自动备份到 Google Drive，还差授权一次 <button data-act="drive-auth">授权</button>';
  else if (ask === 'again') h = 'Google Drive 备份要重新授权一次 <button data-act="drive-auth">授权</button>';
  else if (signed && drive.status().kind === 'disabled') h = `备份还差一步：在 Google Cloud 里启用 Drive API <a class="bn" href="${esc(drive.status().link)}" target="_blank" rel="noopener">去启用</a>`;
  b.innerHTML = h;
  b.hidden = !h;
}

function syncUi() { $('#sync').classList.toggle('spin', S.syncing); }

let renderSeq = 0;
function render({ keepScroll = false } = {}) {
  const per = currentPeriod();
  header(per);
  banner();
  const view = $('#view');
  if (!S.v) { view.innerHTML = `<div class="empty">${S.syncing ? '正在读取数据…' : ''}</div>`; return; }
  const ctx = { v: S.v, per, focus: S.focus, demo: S.demo };
  const y = scrollY;
  try { view.innerHTML = PAGES[S.tab].render(ctx); } catch (e) { console.error(e); view.innerHTML = `<div class="empty">页面出错：${esc(e.message)}</div>`; }
  if (keepScroll) scrollTo(0, y);
  const seq = ++renderSeq;
  Promise.resolve(PAGES[S.tab].after?.(ctx, view)).catch((e) => { if (seq === renderSeq) console.warn(e); });
}

function go({ tab = S.tab, range = S.range, offset = 0, focus = null, keepScroll = false } = {}) {
  const changed = tab !== S.tab || range !== S.range || offset !== S.offset;
  S.tab = tab; S.range = range; S.offset = clamp(offset, 0, MAX_OFFSET[range]); S.focus = focus;
  pref.set('tab', tab); pref.set('range', range);
  ui.hideTip();
  render({ keepScroll: keepScroll && !changed });
  if (changed && !keepScroll) scrollTo(0, 0);
}

// keep the same days in view when switching 日 / 周 / 月 / 3月
function switchRange(range) {
  const daysBack = SIZE[S.range] * S.offset;
  go({ range, offset: Math.floor(daysBack / SIZE[range]) });
}

function nav(step) {
  const next = clamp(S.offset + step, 0, MAX_OFFSET[S.range]);
  if (next === S.offset) return;
  const view = $('#view');
  view.classList.remove('slide-l', 'slide-r');
  void view.offsetWidth;
  view.classList.add(step > 0 ? 'slide-r' : 'slide-l');
  go({ offset: next });
}

// ---------- data ----------
async function useDemo() {
  S.demo = true;
  data.useSource(demoSource, 'demo:');
  tr.setPrefix('demo:');
  await tr.load();
  if (!tr.get().sessions.length) {
    const t = demoTraining();
    const z = zonesOrDefault(DEMO_ZONES);
    for (const s of t.sessions) {
      const pts = await demoSource.getHrSeries(s.start, s.end, 60);
      s.hr = tr.summarizeHr(pts, zoneOf, z);
      if (s.hr) s.hr.peaks = tr.findPeaks(pts, 62);
    }
    await tr.replaceAll(t);
  }
  S.model = await data.loadCached();
}

async function useReal(cached) {
  S.demo = false;
  data.useSource(api, '');
  tr.setPrefix('');
  await tr.load();
  S.model = cached === undefined ? await data.loadCached() : cached;
}

async function syncNow({ force = false } = {}) {
  if (S.syncing) return;
  if (!S.demo && !auth.isSignedIn()) { S.expired = true; render({ keepScroll: true }); return; }
  S.syncing = true; S.err = ''; syncUi();
  if (!S.v) render();
  try {
    S.model = await data.sync(S.model, { force });
    S.v = data.derive(S.model);
    S.expired = false; S.reconnect = '';
    S.dayKey = ymd(today());
    render({ keepScroll: true });
    await scan();
  } catch (e) {
    console.warn(e);
    if (!S.demo && !auth.isSignedIn()) S.expired = true;
    else if (e.message === 'RECONNECT' || e.message === 'REVOKE') S.reconnect = e.message;
    else if (e.message !== 'NOT_SIGNED_IN') S.err = e;
  }
  S.syncing = false; syncUi();
  if (S.v) banner(); else render(); // no data yet: drop "正在读取数据…"
}

// Look for strength sessions in today's and the last two days' heart rate.
async function scan() {
  let changed = false;
  for (const d of tr.daysToScan()) {
    const date = ymd(d), end = addDays(d, 1);
    try {
      const [hr, steps] = await Promise.all([data.hrSeries(+d, +end, 60), data.stepsSeries(+d, +end, 60)]);
      if (!hr.length) continue;
      const m = S.model;
      const cands = tr.detect({
        dayStart: d, hr, steps, rest: m.daily[date]?.rhr,
        sleeps: m.sleeps.filter((s) => s.end > +d && s.start < +end),
        exercises: m.exercises.filter((e) => e.end > +d && e.start < +end),
      });
      if (await tr.addCandidates(date, cands)) changed = true;
    } catch (e) { console.warn('scan', date, e); }
  }
  if (changed) render({ keepScroll: true });
}

async function summarize(start, end, peaks) {
  const pts = await data.hrSeries(start, end, 60);
  const s = tr.summarizeHr(pts, zoneOf, S.v.zones);
  if (s) s.peaks = peaks?.length ? peaks : tr.findPeaks(pts, S.model.daily[ymd(new Date(start))]?.rhr || 60);
  return s;
}

// ---------- training actions ----------
const pendingOf = (id) => tr.get().pending.find((p) => p.id === id);
const editPending = (p, talk = false) => {
  const g = tr.guess(p.date);
  editor.open({ pendingId: p.id, date: p.date, start: p.start, end: p.end, source: p.source, exId: p.exId, peaks: p.peaks, items: g?.items || [], fromGuess: !!g }, { talk });
};

async function confirmPending(p) {
  const g = tr.guess(p.date);
  if (!g) { editPending(p); return; }
  const hr = await summarize(p.start, p.end, p.peaks).catch(() => null);
  const s = await tr.saveSession({ date: p.date, start: p.start, end: p.end, source: p.source, exId: p.exId, items: g.items, pendingId: p.id, hr });
  render({ keepScroll: true });
  ui.toast('已保存', { action: '撤销', onAction: async () => { await tr.deleteSession(s.id); await tr.restorePending(p); render({ keepScroll: true }); } });
}

// ---------- backup ----------
function backupState(ds) {
  if (S.demo) return '连接 Fitbit 后自动开始';
  if (!auth.isSignedIn()) return '重新连接后继续';
  const a = drive.ask();
  if (a) return a === 'again' ? '要重新授权一次' : '还差授权一次';
  if (ds.kind === 'disabled') return '还差启用 Drive API';
  if (ds.at) return `上次 ${ago(ds.at)}`;
  return tr.get().sessions.length ? '等待第一次备份' : '有训练记录后开始';
}

// On open / after login: bring the log back on a new phone, or upload what changed since the last backup.
let checking = false;
async function backupCheck() {
  if (S.demo || checking || !auth.isSignedIn() || !drive.granted()) { banner(); return; }
  checking = true;
  try {
    if (!tr.get().sessions.length) await autoRestore();
    else if (drive.behind(tr.get()) || drive.status().err) await drive.backup(tr.get()).catch((e) => console.warn('backup', e));
  } finally { checking = false; }
  banner();
  if ($('.settings')) openSettings();
}

// ---------- settings ----------
const ago = (t) => {
  if (!t) return '–';
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${md(new Date(t))} ${hm(new Date(t))}`;
};
const BATT = { High: '电量高', Medium: '电量中', Low: '电量低', Critical: '电量很低' };

function openSettings() {
  const c = auth.getConfig();
  const t = auth.tokenInfo();
  const signed = auth.isSignedIn();
  const left = t?.obtained_at ? Math.max(0, 7 - Math.floor((Date.now() - t.obtained_at) / 864e5)) : null;
  const ds = drive.status();
  const devs = S.demo ? [] : S.model?.devices || [];
  ui.openSheet(`<div class="sheet-nav"><span></span><h3>设置</h3><button type="button" class="nav-btn b" data-act="close-sheet">完成</button></div>
    <section class="set-g"><h4>Fitbit 连接</h4>
      ${signed ? `<div class="set-row"><span>${S.reconnect ? '要重新连接一次' : '已连接'}</span><small>${S.reconnect ? '' : `测试模式下大约 ${left ?? 7} 天后要重新连接`}</small></div>
        <div class="btns"><button class="btn" data-act="login">重新连接</button><button class="btn danger" data-act="logout">断开</button></div>` : ''}
      <details ${signed ? '' : 'open'}><summary>Client ID 和 Secret</summary>
        <label class="field"><span>Client ID</span><input id="cid" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(c.clientId || '')}" placeholder="xxxx.apps.googleusercontent.com"></label>
        <label class="field"><span>Client Secret</span><input id="csec" type="password" autocomplete="off" value="${esc(c.clientSecret || '')}" placeholder="GOCSPX-…"></label>
        <div class="note">只保存在这台手机上。Google Cloud 里“已获授权的重定向 URI”要填：<br><code>${esc(auth.redirectUri())}</code></div>
        <button class="btn pri" data-act="save-login">保存并连接</button>
        <details class="sub-d"><summary>登录后跳回了 Safari？</summary>
          <div class="note">把 Safari 地址栏里以 <code>${esc(auth.redirectUri())}?</code> 开头的完整网址复制到这里：</div>
          <label class="field"><input id="paste-url" placeholder="粘贴网址" autocomplete="off"></label>
          <button class="btn" data-act="paste-code">完成连接</button>
        </details>
      </details>
    </section>
    ${devs.length ? `<section class="set-g"><h4>设备</h4>${devs.map((d) => `<div class="set-row"><span>${esc(d.name)}</span><small>${d.battery != null ? `电量 ${d.battery}%` : BATT[d.batteryStatus] || ''}${d.lastSync ? ` · 同步于 ${ago(d.lastSync)}` : ''}</small></div>`).join('')}</section>` : ''}
    <section class="set-g"><h4>语音记录</h4>
      <details class="plain"${voice.hasKey() ? ' open' : ''}><summary>手机听不懂的交给 AI（可选）</summary>
        <label class="field"><span>OpenRouter 或 Anthropic 密钥</span><input id="akey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(voice.getKey())}" placeholder="sk-or-… 或 sk-ant-…"></label>
        <label class="field row"><span>模型</span><select id="ai-model">${Object.entries(voice.MODELS).map(([k, m]) => `<option value="${k}"${voice.getModel() === k ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <div class="note">密钥只保存在这台手机上。只有手机听不懂的那句话会发给模型。</div>
        <button class="btn" data-act="key-save">保存并试一下</button>
      </details>
    </section>
    <section class="set-g"><h4>训练记录备份</h4>
      <div class="set-row col"><span>自动备份到你的 Google Drive</span><small>${esc(backupState(ds))}</small></div>
      ${ds.err && ds.kind !== 'net' ? `<div class="note"><span class="warn">${esc(ds.kind === 'other' ? '上次备份没成功' : ds.err)}</span>${ds.kind === 'other' ? `<details class="sub-d"><summary>详情</summary>${esc(ds.err)}</details>` : ''}</div>` : ''}
      ${!S.demo && signed && ds.kind === 'disabled' ? `<a class="btn pri" href="${esc(ds.link)}" target="_blank" rel="noopener">去 Google Cloud 启用 Drive API</a>` : ''}
      ${!S.demo && signed ? (drive.ask() ? `<button class="btn pri" data-act="drive-auth">${drive.ask() === 'again' ? '重新授权' : '授权'} Google Drive</button>` : '<div class="btns"><button class="btn" data-act="backup-now">立即备份</button><button class="btn" data-act="restore">从备份恢复</button></div>') : ''}
      <button class="btn" data-act="export">导出训练记录（JSON）</button>
    </section>
    <section class="set-g"><h4>力量训练</h4>
      <label class="sw"><span>下次训练自动加重量<small>上次每组都做满、不吃力时</small></span><input type="checkbox" id="hints"${tr.get().settings.hints !== false ? ' checked' : ''}></label>
    </section>
    <section class="set-g"><h4>数据</h4>
      <div class="set-row"><span>上次同步</span><small>${ago(S.model?.syncedAt)}</small></div>
      ${S.demo ? '' : '<button class="btn" data-act="resync">重新下载最近 120 天</button>'}
    </section>
    <div class="note center">v3</div>`, { cls: 'settings' });
}

async function settingsChange(e) {
  const t = e.target;
  if (t.id === 'hints') { tr.get().settings.hints = t.checked; await tr.save(); render({ keepScroll: true }); }
  if (t.id === 'ai-model') { voice.setModel(t.value); ui.toast(`之后用 ${voice.MODELS[voice.getModel()].label}`); }
}

async function backupNow() {
  try { await drive.backup(tr.get()); ui.toast('已备份到 Google Drive'); } catch (e) { ui.toast(e.message); }
  banner();
  if ($('.settings')) openSettings();
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ app: 'open-fitbit', kind: 'training-log', savedAt: Date.now(), training: tr.get() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `训练记录-${ymd(today())}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
}

const login = () => auth.startLogin('health');

// ---------- events ----------
async function onAction(el) {
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case 'goto': go({ tab: el.dataset.tab, range: el.dataset.range || S.range }); break;
    case 'goto-day': go({ tab: 'workouts', range: 'd', offset: dayDiff(today(), parseYmd(el.dataset.date)) }); break;
    case 'night': go({ tab: 'sleep', range: 'd', offset: dayDiff(today(), parseYmd(el.dataset.date)) }); break;
    case 'session': {
      const s = tr.get().sessions.find((x) => x.id === id);
      if (s) go({ tab: 'workouts', range: 'd', offset: dayDiff(today(), parseYmd(s.date)) });
      break;
    }
    case 'workout': {
      const w = workouts(S.v).find((x) => x.id === id);
      if (!w) break;
      go({ tab: 'workouts', range: 'd', offset: dayDiff(today(), new Date(w.start)), focus: id, keepScroll: true });
      requestAnimationFrame(() => $('#wk-detail')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      break;
    }
    case 'pend-ok': { const p = pendingOf(id); if (p) await confirmPending(p); break; }
    case 'pend-talk': { const p = pendingOf(id); if (p) editPending(p, true); break; } // tap mode; must stay synchronous (keyboard)
    case 'pend-edit': { const p = pendingOf(id); if (p) editPending(p); break; }
    case 'pend-no': {
      const p = await tr.dismissPending(id);
      render({ keepScroll: true });
      ui.toast('已标记为不是训练', { action: '撤销', onAction: async () => { if (p) { await tr.restorePending(p); render({ keepScroll: true }); } } });
      break;
    }
    case 'sess-new': editor.open({ date: el.dataset.date && el.dataset.date <= ymd(today()) ? el.dataset.date : ymd(today()), items: [] }); break;
    case 'sess-edit': { const s = tr.get().sessions.find((x) => x.id === id); if (s) editor.open(s); break; }
    case 'sess-del': {
      const s = tr.get().sessions.find((x) => x.id === id);
      if (!s || !confirm('删除这次训练记录？')) break;
      await tr.deleteSession(id);
      render({ keepScroll: true });
      ui.toast('已删除', { action: '撤销', onAction: async () => { await tr.saveSession(s); render({ keepScroll: true }); } });
      break;
    }
    case 'settings': openSettings(); break;
    case 'close-sheet': ui.closeSheet(); break;
    case 'err-detail': { const d = $('#banner .bn-detail'); if (d) d.hidden = !d.hidden; break; }
    case 'sync': syncNow(); break;
    case 'login': if (auth.isConfigured()) await login(); else openSettings(); break;
    case 'drive-auth': if (auth.isConfigured()) await auth.startLogin('drive'); else openSettings(); break;
    case 'save-login': {
      const clientId = $('#cid').value.trim(), clientSecret = $('#csec').value.trim();
      if (!clientId || !clientSecret) { ui.toast('请填写 Client ID 和 Client Secret'); break; }
      auth.setConfig({ clientId, clientSecret });
      await login();
      break;
    }
    case 'paste-code': {
      const back = await auth.handleRedirect($('#paste-url').value.trim());
      if (!back) { ui.toast('这个网址里没有登录结果，请复制完整的网址'); break; }
      ui.closeSheet();
      if (back === 'drive') { ui.toast('Google Drive 备份已开启'); await backupCheck(); } else await afterLogin();
      break;
    }
    case 'logout':
      if (!confirm('断开后手机上的 Fitbit 数据会清掉（训练记录保留）。继续？')) break;
      auth.signOut();
      S.reconnect = '';
      await data.clearAll();
      ui.closeSheet();
      await useDemo();
      S.v = S.model ? data.derive(S.model) : null;
      render();
      syncNow();
      break;
    case 'key-save': {
      const k = $('#akey').value.trim();
      voice.setKey(k);
      if (!k) { ui.toast('已清除密钥'); break; }
      el.disabled = true; el.textContent = '试一下…';
      const who = `${voice.provider() === 'openrouter' ? 'OpenRouter' : 'Anthropic'} · ${voice.MODELS[voice.getModel()].label}`;
      try { ui.toast((await voice.test()) ? `密钥可以用（${who}）` : '能连上模型，但结果不对'); } catch (e) { ui.toast(e.message, { ms: 5000 }); }
      el.disabled = false; el.textContent = '保存并试一下';
      break;
    }
    case 'backup-now': await backupNow(); break;
    case 'restore': {
      try {
        const t = await drive.restore();
        if (!t) { ui.toast('Google Drive 里还没有备份'); break; }
        if (!confirm(`用备份替换手机上的训练记录？\n备份里有 ${t.sessions?.length || 0} 次训练，手机上现在有 ${tr.get().sessions.length} 次。`)) break;
        await tr.replaceAll(t);
        ui.closeSheet();
        render();
        ui.toast('已恢复');
      } catch (e) { ui.toast(e.message); }
      break;
    }
    case 'export': exportJson(); break;
    case 'resync': ui.closeSheet(); syncNow({ force: true }); break;
    default: break;
  }
}

function bind() {
  ui.initTips();
  document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS show :active (pressed) styles
  document.addEventListener('click', async (ev) => {
    const tab = ev.target.closest('.tabs [data-tab]');
    if (tab) { go({ tab: tab.dataset.tab }); return; }
    const r = ev.target.closest('#period [data-range]');
    if (r) { switchRange(r.dataset.range); return; }
    const n = ev.target.closest('[data-nav]');
    if (n) { nav(+n.dataset.nav); return; }
    const el = ev.target.closest('[data-act]');
    if (!el || el.closest('.ed-sheet')) return;
    if (el.dataset.act === 'pend-talk' && voice.canListen()) return; // press and hold, see below
    try { await onAction(el); } catch (e) { console.error(e); ui.toast(e.message); }
  });
  // hold "按住说话" on a confirm card: open the editor with the guess and start listening
  document.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('[data-act="pend-talk"]');
    if (!b || !voice.canListen()) return;
    ev.preventDefault();
    const p = pendingOf(b.dataset.id);
    if (p) editPending(p, true);
  });
  document.addEventListener('change', (ev) => { if (ev.target.closest('.settings')) settingsChange(ev).catch((e) => ui.toast(e.message)); });
  $('#open-settings').addEventListener('click', openSettings);
  $('#sync').addEventListener('click', () => syncNow());

  // swipe left / right on a page = newer / older period
  const view = $('#view');
  let sw = null;
  view.addEventListener('touchstart', (e) => {
    sw = null;
    if (S.tab === 'today' || e.touches.length !== 1) return;
    if (e.target.closest('[data-hover], input, textarea, button')) return;
    sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!sw) return;
    const dx = e.changedTouches[0].clientX - sw.x, dy = e.changedTouches[0].clientY - sw.y, dt = Date.now() - sw.t;
    sw = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && dt < 700) nav(dx > 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (S.dayKey !== ymd(today()) && S.model) { S.v = data.derive(S.model); S.dayKey = ymd(today()); render(); }
    if (!S.model || Date.now() - (S.model.syncedAt || 0) > 10 * 60e3) syncNow().then(backupCheck);
    else if (drive.status().err) backupCheck(); // e.g. just came back from turning on the Drive API
  });
}

async function afterLogin() {
  ui.toast('已连接 Fitbit');
  await useReal();
  S.v = S.model ? data.derive(S.model) : null;
  render();
  await syncNow({ force: !S.model });
  await backupCheck();
}

// New phone (or cleared storage): bring the training log back from Drive.
async function autoRestore() {
  try {
    const t = await drive.restore();
    if (t?.sessions?.length && !tr.get().sessions.length) { await tr.replaceAll(t); render({ keepScroll: true }); ui.toast(`已从 Google Drive 恢复 ${t.sessions.length} 次训练`); }
  } catch (e) { console.warn('restore', e); }
}

// ---------- boot ----------
(async () => {
  bind();
  store.persist();
  try { Object.keys(localStorage).filter((k) => k.startsWith('c:')).forEach((k) => localStorage.removeItem(k)); } catch {} // v1 cache
  editor.setHooks({ summarize, done: () => render({ keepScroll: true }), openSettings });
  tr.setOnSave(() => { if (!S.demo) drive.backupSoon(() => tr.get(), 4000, banner); });
  let back = false; // just came back from Google: 'health' (Fitbit) or 'drive' (backup)
  try { back = await auth.handleRedirect(); } catch (e) { S.err = e.message; }
  // Real mode when signed in, or when real data is cached (sign-in expired: keep showing it).
  data.useSource(api, '');
  const cached = await data.loadCached();
  if (auth.isSignedIn() || cached) await useReal(cached);
  else await useDemo();
  S.expired = !S.demo && !auth.isSignedIn();
  if (S.model) S.v = data.derive(S.model);
  render();
  if (back === 'health') { ui.toast('已连接 Fitbit'); await syncNow({ force: !S.model }); }
  else { if (back === 'drive') ui.toast('Google Drive 备份已开启'); await syncNow(); }
  await backupCheck();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
