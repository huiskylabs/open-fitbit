// Training editor (bottom sheet): confirm or correct a detected session, log one by hand, or say it.
// Saying it: in the home-screen app, tap 说 and use the microphone key on the iPhone keyboard; in
// Safari, hold the button and talk. The phone turns the words into lifts and sets (sayparse.js); an
// AI model (OpenRouter or Anthropic key in settings) reads every sentence when a key is set.
// 取消 (or tapping outside) asks first when something was changed.
import * as tr from './training.js';
import * as voice from './voice.js';
import { parseLocal } from './sayparse.js';
import * as T from './tcharts.js';
import { hrSeries } from './data.js';
import { openSheet, closeSheet, sheetEl, toast } from './ui.js';
import { esc, md, hm, parseYmd, ymd, today } from './util.js';

let ed = null;
let hooks = {}; // { summarize(start, end, peaks) → hr summary, done(), openSettings() }
export const setHooks = (h) => { hooks = h; };

const clone = (x) => JSON.parse(JSON.stringify(x));
const snap = () => JSON.stringify([ed.date, ed.items, ed.defs]);
const dirty = () => !!ed && snap() !== ed.saved;
const pref = {
  get(k) { try { return localStorage.getItem('ui:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('ui:' + k, v); } catch {} },
};
const nameOf = (id) => ed?.defs[id]?.name || tr.lift(id).name;
const isBw = (id) => (ed?.defs[id] ? !!ed.defs[id].bodyweight : tr.lift(id).bodyweight);
const fmtKg = (v) => String(Math.round((+v || 0) * 100) / 100);

// init: { id?, pendingId?, date, start?, end?, items, source?, exId?, peaks?, hr?, said? }
export function open(init, { title, talk = false } = {}) {
  ed = { ...clone(init), items: clone(init.items || []), defs: {}, title: title || (init.id ? '改训练' : init.start ? '确认训练' : '记一次训练') };
  ed.saved = snap();
  draw();
  if (talk) startTalk();
}

function when() {
  if (!ed.start) return '';
  const d = parseYmd(ed.date);
  return `${ed.date === ymd(today()) ? '' : md(d) + ' '}${hm(new Date(ed.start))}–${hm(new Date(ed.end))}`;
}

// Read view first: each lift is one line, "卧推  8 · 8 · 8 · 6  70 kg". Tap a line to change its numbers.
function setRow(it, i, s, k) {
  const bw = isBw(it.lift);
  const f = bw ? 'add' : 'kg';
  const v = bw ? s.add || 0 : s.kg || 0;
  return `<div class="ed-row">
    <span class="n">${k + 1}</span>
    <label><input data-f="reps" data-i="${i}" data-k="${k}" inputmode="numeric" value="${s.reps}" aria-label="第 ${k + 1} 组次数"><span>次</span></label>
    <label><input data-f="${f}" data-i="${i}" data-k="${k}" inputmode="decimal" value="${fmtKg(v)}" aria-label="第 ${k + 1} 组${bw ? '负重' : '重量'}"><span>${bw ? '+kg' : 'kg'}</span></label>
    <button type="button" class="hard${s.hard ? ' on' : ''}" data-ed="hard" data-i="${i}" data-k="${k}" aria-pressed="${!!s.hard}">吃力</button>
    <button type="button" class="x" data-ed="del-set" data-i="${i}" data-k="${k}" aria-label="删除这组">×</button>
  </div>`;
}

function sumLine(it) {
  const bw = isBw(it.lift);
  const reps = it.sets.map((s) => s.reps).join(' · ');
  const kg = [...new Set(it.sets.map((s) => fmtKg(bw ? s.add || 0 : s.kg || 0)))];
  const unit = bw ? (kg.some((x) => +x) ? `次 · +${kg.join('/')} kg` : '次') : `${kg.join('/')} kg`;
  const hard = it.sets.map((s, k) => (s.hard && !s.note ? k + 1 : 0)).filter(Boolean); // a set with its own words shows those instead
  const notes = it.sets.map((s) => s.note).filter(Boolean);
  const sub = [hard.length ? (hard.length === 1 && hard[0] === it.sets.length ? '最后一组吃力' : `第 ${hard.join('、')} 组吃力`) : '', ...notes.map((n) => `“${n}”`)].filter(Boolean).join('　');
  return `<span class="sets">${reps}<small>${esc(unit)}</small></span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
}

function html() {
  const lib = tr.allLiftIds().filter((id) => !ed.items.some((it) => it.lift === id));
  return `<div class="ed">
    <div class="sheet-nav"><button type="button" class="nav-btn" data-ed="cancel">取消</button><h3>${esc(ed.title)}${ed.start ? `<small>${when()}</small>` : ''}</h3><span class="nav-btn"></span></div>
    ${ed.start ? '<div class="ed-hr"></div>' : `<label class="field row"><span>日期</span><input type="date" id="ed-date" value="${ed.date}" max="${ymd(today())}"></label>`}
    ${ed.said ? `<div class="ed-said">“${esc(ed.said)}”</div>` : ''}
    ${ed.items.length ? '' : '<div class="empty sm">点麦克风说，比如：卧推 70 公斤 8 8 8 6，引体 4 组 11 个</div>'}
    <div class="ed-list">${ed.items.map((it, i) => ed.openI === i ? `<div class="ed-item open" data-i="${i}">
      <div class="ed-ih"><b>${esc(nameOf(it.lift))}</b><button type="button" class="link" data-ed="close">好了</button></div>
      ${it.sets.map((s, k) => setRow(it, i, s, k)).join('')}
      <div class="ed-foot"><button type="button" class="link" data-ed="add-set" data-i="${i}">加一组</button><button type="button" class="link danger" data-ed="del-item" data-i="${i}">删除这个动作</button></div>
    </div>` : `<button type="button" class="ed-item" data-ed="open" data-i="${i}"><b>${esc(nameOf(it.lift))}</b>${sumLine(it)}</button>`).join('')}</div>
    ${ed.adding ? `<div class="ed-add">${lib.map((id) => `<button type="button" class="chip" data-ed="add-lift" data-id="${esc(id)}">${esc(tr.lift(id).name)}</button>`).join('')}<button type="button" class="chip" data-ed="new-lift">其他…</button></div>`
      : '<button type="button" class="link ed-addl" data-ed="adding">+ 加一个动作</button>'}
    <div class="ed-bar cbtns"><button type="button" class="btn pri" data-ed="save">${ed.id ? '保存' : '确认'}</button><button type="button" class="btn mic talk" data-ed="talk" aria-label="${talkLabel()}">${MIC}</button></div>
  </div>`;
}
const MIC = '<svg viewBox="0 0 24 24"><rect x="8.5" y="2.5" width="7" height="12.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function draw() {
  let el = sheetEl();
  const box = el?.querySelector('.ed');
  if (box) {
    const top = el.scrollTop;
    box.outerHTML = html();
    el.scrollTop = top;
  } else {
    el = openSheet(html(), { cls: 'ed-sheet', canClose: () => !dirty() || confirm('放弃修改？'), onClose: () => { stopAll(); ed = null; } });
    el.addEventListener('click', onClick);
    el.addEventListener('change', onInput);
    el.addEventListener('pointerdown', onDown);
  }
  drawHr();
}

async function drawHr() {
  const box = sheetEl()?.querySelector('.ed-hr');
  if (!box || !ed?.start) return;
  try {
    const a = ed.start - 3 * 60e3, b = ed.end + 3 * 60e3;
    const pts = await hrSeries(a, b, 60);
    const raw = ed.hr?.peaks?.length ? ed.hr.peaks : ed.peaks || [];
    const { peaks, spans } = tr.setSpans(raw, ed.items);
    if (box.isConnected) box.innerHTML = T.sessionHr(pts, { start: a, end: b, peaks, spans, H: 90 });
  } catch { /* no heart rate */ }
}

// read typed values (inputs are not redrawn while typing)
function onInput(e) {
  const t = e.target;
  if (t.id === 'ed-date') { if (t.value) ed.date = t.value; return; }
  if (!t.dataset.f) return;
  const s = ed.items[+t.dataset.i]?.sets[+t.dataset.k];
  if (!s) return;
  const v = Math.max(0, parseFloat(String(t.value).replace(',', '.')) || 0);
  if (t.dataset.f === 'reps') s.reps = Math.round(v); else s[t.dataset.f] = v;
  ed.fromGuess = false;
  // no redraw while typing, so the next field keeps focus and the keyboard stays up
}

function defaultSets(id) {
  const last = tr.lastItem(id);
  if (last) return clone(last.item.sets).map(({ note, hard, ...s }) => s);
  return isBw(id) ? [{ reps: 8, kg: 0 }] : [{ reps: 5, kg: 60 }];
}

async function onClick(e) {
  const b = e.target.closest('[data-ed]');
  if (!b || !ed) return;
  const i = +b.dataset.i, k = +b.dataset.k;
  const it = ed.items[i];
  switch (b.dataset.ed) {
    case 'open': ed.openI = i; draw(); return;
    case 'close': ed.openI = null; draw(); return;
    case 'adding': ed.adding = true; draw(); return;
    case 'hard': it.sets[k].hard = !it.sets[k].hard; if (!it.sets[k].hard) delete it.sets[k].note; break;
    case 'del-set': it.sets.splice(k, 1); if (!it.sets.length) { delItem(i); return; } break;
    case 'add-set': { const l = it.sets.at(-1) || defaultSets(it.lift)[0]; const { note, hard, ...s } = l; it.sets.push({ ...s }); break; }
    case 'del-item': delItem(i); return;
    case 'add-lift': ed.items.push({ lift: b.dataset.id, sets: defaultSets(b.dataset.id) }); ed.openI = ed.items.length - 1; ed.adding = false; break;
    case 'new-lift': {
      const name = (prompt('动作名称（比如：哑铃划船）') || '').trim();
      if (!name) return;
      const id = 'c_' + Date.now().toString(36);
      ed.defs[id] = { name: name.slice(0, 20), parts: {}, bodyweight: /引体|俯卧撑|双杠|臂屈伸|卷腹|平板|悬垂|深蹲跳/.test(name) };
      ed.items.push({ lift: id, sets: ed.defs[id].bodyweight ? [{ reps: 10, kg: 0 }] : [{ reps: 10, kg: 20 }] });
      ed.openI = ed.items.length - 1; ed.adding = false;
      break;
    }
    case 'save': await save(); return;
    case 'cancel': closeSheet(); return;
    case 'talk': if (!hold()) startTalk(); return; // tap: keyboard dictation; hold: see onDown
    default: return;
  }
  ed.fromGuess = false;
  draw();
}

// a whole lift goes with an undo (the × next to a set only takes that set)
function delItem(i) {
  const [gone] = ed.items.splice(i, 1);
  ed.fromGuess = false; ed.openI = null;
  draw();
  const me = ed;
  toast(`已删除${nameOf(gone.lift)}`, { action: '撤销', onAction: () => { if (ed !== me) return; ed.items.splice(Math.min(i, ed.items.length), 0, gone); draw(); } });
}

async function save() {
  const items = ed.items.filter((it) => it.sets.length);
  if (!items.length) { toast('还没有加动作'); return; }
  const btn = sheetEl()?.querySelector('[data-ed="save"]');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  for (const it of items) if (ed.defs[it.lift]) tr.ensureLift(it.lift, ed.defs[it.lift]);
  const s = { date: ed.date, items, ...(ed.id ? { id: ed.id } : {}), ...(ed.pendingId ? { pendingId: ed.pendingId } : {}) };
  for (const k of ['start', 'end', 'source', 'exId', 'said']) if (ed[k] != null) s[k] = ed[k];
  if (!ed.start) s.source = 'manual';
  if (ed.hr) s.hr = ed.hr;
  else if (ed.start && hooks.summarize) s.hr = await hooks.summarize(ed.start, ed.end, ed.peaks).catch(() => null);
  await tr.saveSession(s);
  ed = null;
  closeSheet({ force: true });
  toast('已保存');
  hooks.done?.();
}

// ---------- voice ----------
// hold to talk where the page may use speech recognition (Safari); elsewhere (the home-screen app)
// tap and dictate with the keyboard's microphone key
const hold = () => voice.canListen();
export const talkLabel = () => (hold() ? '按住说话' : '说');

let talk = null; // { rec, t0, mode: 'hold' | 'tap' }
let vo = null;

function voShow({ said = '', status = '', buttons = '', text = false } = {}) {
  if (!vo) {
    vo = document.createElement('div');
    vo.addEventListener('click', onVoClick);
    vo.addEventListener('input', preview);
    vo.addEventListener('keydown', onVoKey);
    document.body.append(vo);
  }
  vo.className = text ? 'vo text' : 'vo';
  vo.innerHTML = `<div class="vo-in">
    ${text ? `<textarea id="vo-text" rows="3" enterkeyhint="done" placeholder="深蹲 100 公斤 5 组 5 个，引体向上 4 组 8 个，最后一组很吃力">${esc(said)}</textarea>
      <div class="vo-pv"></div>` : `<div class="vo-said">${esc(said) || '<span class="muted">…</span>'}</div>`}
    ${status ? `<div class="vo-st">${status}</div>` : ''}
    ${buttons ? `<div class="btns">${buttons}</div>` : ''}</div>`;
  if (text) {
    // focus inside the tap itself, or iOS won't bring up the keyboard
    const ta = vo.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    preview();
  }
}
const voSaid = (s) => { const el = vo?.querySelector('.vo-said'); if (el) el.textContent = s || '…'; };
function voHide() { vo?.remove(); vo = null; }

const current = () => (ed ? ed.items.map((it) => ({ lift: it.lift, sets: it.sets })) : []);
const nameIn = (it) => it.def?.name || nameOf(it.lift);

// what the phone understands so far, as you speak
function preview() {
  const ta = vo?.querySelector('textarea'), pv = vo?.querySelector('.vo-pv');
  if (!ta || !pv || !ed) return;
  const t = ta.value.trim();
  if (!t) { pv.innerHTML = hint ? `<span class="vo-hint">${hint}</span>` : ''; return; }
  const r = parseLocal(t, current(), { fromGuess: !!ed.fromGuess });
  const chip = (it) => {
    const bw = it.def ? it.def.bodyweight : tr.lift(it.lift).bodyweight;
    const top = Math.max(0, ...it.sets.map((s) => (bw ? s.add || 0 : s.kg || 0)));
    const reps = it.sets.map((s) => s.reps), same = reps.every((x) => x === reps[0]);
    const lbl = `${same ? `${it.sets.length}×${reps[0]}` : reps.join('/')}${bw ? (top ? ` +${fmtKg(top)}` : '') : ` · ${top ? fmtKg(top) : '?'} kg`}${it.sets.some((s) => s.hard) ? ' · 吃力' : ''}`;
    return `<span class="pv-it">${esc(nameIn(it))}<small>${esc(lbl)}</small></span>`;
  };
  pv.innerHTML = (r.touched ? r.items.map(chip).join('') : '') + (r.unknown.length ? `<span class="pv-unk" title="没听懂">${esc(r.unknown.join(' '))}</span>` : '');
}

// the keyboard's microphone key is pointed out once, the first time
let hint = '';
function textMode(msg = '', said = '') {
  hint = pref.get('mic-hint') ? '' : '点键盘上的麦克风键说，说完点“好了”';
  pref.set('mic-hint', '1');
  voShow({ text: true, said, status: msg ? `<span class="warn">${esc(msg)}</span>` : '', buttons: '<button type="button" class="btn ghost" data-vo="cancel">取消</button><button type="button" class="btn pri" data-vo="parse">好了</button>' });
}

export function startTalk() {
  if (!ed || talk) return;
  if (!hold()) { textMode(); return; }
  voShow({ status: '正在听…　松开结束' });
  const rec = voice.listen({ onText: (f, m) => voSaid(f + m) });
  talk = { rec, t0: Date.now(), mode: 'hold' };
  const t0 = Date.now();
  rec.done.then((said) => finish(said, t0), (e) => { talk = null; if (/not-allowed|service/.test(e.code || '')) textMode(e.message); else voError(e.message); });
  addEventListener('pointerup', release, { once: true });
  addEventListener('pointercancel', release, { once: true });
}

function release() {
  if (!talk || talk.mode !== 'hold') return;
  if (Date.now() - talk.t0 < 450) { // a quick tap: keep listening until 说完了
    talk.mode = 'tap';
    voShow({ said: '', status: '正在听…', buttons: '<button type="button" class="btn ghost" data-vo="cancel">取消</button><button type="button" class="btn pri" data-vo="stop">说完了</button>' });
    return;
  }
  talk.rec.stop();
}

async function finish(said, t0) {
  talk = null;
  if (!ed) { voHide(); return; }
  if (!said && Date.now() - t0 < 1500) { textMode('这里用不了语音识别，用键盘上的麦克风键说'); return; } // ended at once: not available here
  if (!said) { voHide(); toast('没听到，再按住说一次'); return; }
  await parseSaid(said);
}

// The phone reads it first. Words it can't place go to the AI model when a key is set;
// otherwise what it did understand is filled in and the rest is shown.
async function parseSaid(said) {
  if (!ed) return;
  const loc = parseLocal(said, current(), { fromGuess: !!ed.fromGuess });
  let r = loc, warn = '';
  // with an AI key, the AI reads every sentence (the phone's own reading is only the fallback)
  if (voice.hasKey()) {
    voShow({ said, status: '<span class="spin-dot"></span> 正在整理…' });
    try { r = { items: await voice.parseAI(said, current()), unknown: [], sure: true, touched: true, noKg: [] }; } catch (e) { warn = e.message; }
    if (!ed) return;
  }
  ed.said = said;
  if (!r.touched) { voError(warn || (r.unknown.length ? `没听懂：${r.unknown.join('、')}` : '没听懂，换个说法试试')); return; }
  for (const it of r.items) if (it.def) ed.defs[it.lift] = it.def;
  ed.items = r.items.map(({ lift, sets }) => ({ lift, sets }));
  ed.fromGuess = false; ed.openI = null;
  voHide();
  draw();
  const noKg = (r.noKg || []).map((id) => nameOf(id));
  if (warn) toast(`AI 没用上（${warn}），先按手机听懂的填了`, { ms: 5000 });
  else if (!voice.hasKey() && !r.sure) toast('在设置里填上 OpenRouter 密钥，说的话会认得更准', { ms: 5000 });
  else if (!r.sure && r.unknown.length) toast(`这些没听懂：${r.unknown.join('、')}`, { ms: 5000 });
  else if (noKg.length) toast(`${noKg.join('、')}还没说重量`);
}

function voError(msg) {
  voShow({
    said: ed?.said || '', status: `<span class="warn">${esc(msg)}</span>`,
    buttons: '<button type="button" class="btn ghost" data-vo="cancel">关闭</button><button type="button" class="btn pri" data-vo="type">再说一次</button>',
  });
}

function onVoClick(e) {
  const b = e.target.closest('[data-vo]');
  if (!b) return;
  const a = b.dataset.vo;
  if (a === 'stop') talk?.rec.stop();
  else if (a === 'cancel') { stopAll(); if (ed) draw(); }
  else if (a === 'type') textMode('', ed?.said || '');
  else if (a === 'parse') submitText();
}

function submitText() {
  const v = vo?.querySelector('textarea')?.value.trim();
  if (v) parseSaid(v); else voHide();
}

function onVoKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.matches('textarea')) { e.preventDefault(); submitText(); }
}

function onDown(e) {
  const b = e.target.closest('[data-ed="talk"]');
  if (!b || !hold()) return;
  e.preventDefault();
  startTalk();
}

function stopAll() {
  if (talk) { talk.rec.abort(); talk = null; }
  voHide();
}
