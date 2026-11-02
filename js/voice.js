// Voice → sets.
// Speech → text is the iPhone's own: the 🎤 on the keyboard in the home-screen app (Safari's speech
// recognition is not available there), or Safari's speech recognition when the page runs in Safari.
// Text → sets happens on the phone (sayparse.js). Only what the phone can't place goes to an AI model,
// and only when a key is filled in: OpenRouter (sk-or-…) or Anthropic (sk-ant-…). The key stays in
// this phone's localStorage.
import * as tr from './training.js';

const LS = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} },
};
const KEY = 'ai-key', MODEL_K = 'ai-model';
export const getKey = () => LS.get(KEY) || LS.get('anthropic-key');
export function setKey(k) { LS.set(KEY, k); LS.set('anthropic-key', ''); }
export const hasKey = () => !!getKey();
export const provider = (k = getKey()) => (/^sk-or-/.test(k) ? 'openrouter' : /^sk-ant-/.test(k) ? 'anthropic' : k ? 'unknown' : '');

export const MODELS = {
  haiku: { label: 'Haiku（最便宜）', openrouter: 'anthropic/claude-haiku-5.5', anthropic: 'claude-haiku-5-5' },
  sonnet: { label: 'Sonnet', openrouter: 'anthropic/claude-sonnet-5.5', anthropic: 'claude-sonnet-5-5' },
};
export const getModel = () => (MODELS[LS.get(MODEL_K)] ? LS.get(MODEL_K) : 'haiku');
export const setModel = (m) => LS.set(MODEL_K, MODELS[m] ? m : '');

// ---------- speech ----------
export const standalone = () => globalThis.navigator?.standalone === true || !!globalThis.matchMedia?.('(display-mode: standalone)').matches;
const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
// iOS only offers speech recognition to pages open in Safari, not to home-screen apps.
export const canListen = () => !!Rec && !standalone();

const REC_ERR = {
  'not-allowed': '没有麦克风权限：在 iPhone 设置 → Safari → 麦克风 里允许',
  'service-not-allowed': '这里不能用语音识别，可以用键盘上的 🎤 说',
  'audio-capture': '找不到麦克风',
  network: '语音识别需要网络',
};

// Start listening. onText(finalText, interimText) fires as words arrive.
// Returns { stop, abort, done } where done resolves with the full transcript when listening ends.
export function listen({ onText } = {}) {
  const r = new Rec();
  r.lang = 'zh-CN';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let fin = '', mid = '';
  const done = new Promise((resolve, reject) => {
    // Rebuild from all results each time: Safari can resend results it already marked final.
    r.onresult = (e) => {
      fin = ''; mid = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0]?.transcript || '';
        if (e.results[i].isFinal) fin += t; else mid += t;
      }
      onText?.(fin, mid);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      reject(Object.assign(new Error(REC_ERR[e.error] || `语音识别出错：${e.error}`), { code: e.error }));
    };
    r.onend = () => resolve((fin + mid).trim());
  });
  try { r.start(); } catch (e) { return { stop() {}, abort() {}, done: Promise.reject(e) }; }
  return { stop: () => { try { r.stop(); } catch {} }, abort: () => { try { r.abort(); } catch {} }, done };
}

// ---------- text → sets (AI, only for what sayparse.js couldn't place) ----------
const PART_IDS = Object.keys(tr.PARTS);
const SET = {
  type: 'object',
  properties: {
    reps: { type: 'integer' },
    kg: { type: 'number', description: 'kilograms; one dumbbell for dumbbell moves; 0 for bodyweight moves' },
    add: { type: 'number', description: 'extra kilograms hung on the body for bodyweight moves, else 0' },
    note: { type: 'string', description: 'how this set felt, in the user\'s words, or ""' },
    hard: { type: 'boolean' },
  },
  required: ['reps', 'kg', 'add', 'note', 'hard'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lift: { type: 'string', description: 'known id, or a new lowercase snake_case English id' },
          name: { type: 'string', description: 'Chinese name of the exercise' },
          parts: { type: 'array', items: { type: 'string', enum: PART_IDS }, description: 'body parts trained, main one first; [] for known ids' },
          bodyweight: { type: 'boolean' },
          sets: { type: 'array', items: SET },
        },
        required: ['lift', 'name', 'parts', 'bodyweight', 'sets'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const SYSTEM = `You turn what the user said about one strength-training session into a structured log.
The text comes from Chinese speech recognition, so expect homophones and misheard words (e.g. "饮体" means 引体).

The user message is JSON with:
- lifts: the user's known exercises, id → Chinese name.
- current: the log as it stands now (may be empty), in the order the exercises were done.
- said: what the user said.

Return the complete log after applying what was said, in the order the exercises were done:
- If "said" describes the whole session, return exactly that.
- If "said" only corrects or adds to part of "current" (e.g. "卧推最后一组只做了6个", "深蹲改成102.5", "再加一组引体"), keep everything else from "current" unchanged and apply the change.
- If "said" says an exercise in "current" was not done ("今天没练硬拉"), drop it.
- If nothing in "said" is about training, return "current" unchanged.

Exercises:
- Use a known id whenever the exercise matches one: 深蹲 = squat, 卧推 = bench, 硬拉 = deadlift, 引体向上 / 引体 = pullup, or any id in "lifts".
- For a new exercise, make a short lowercase snake_case English id (e.g. "dumbbell_row"), give its Chinese name, the body parts it trains (main one first), and bodyweight = true only for bodyweight moves. For known ids, give the known name, parts = [] and bodyweight = false.

Sets:
- "5组5个", "5乘5", "五五" mean 5 sets of 5 reps. "8 8 6" means three sets of 8, 8 and 6 reps. When the weight changes between sets, give each set its own kg.
- kg is in kilograms: 1 斤 = 0.5 kg; 1 磅 / lb = 0.4536 kg, rounded to 0.25. For dumbbells, the weight of one dumbbell. For barbell lifts, the total weight as said.
- Pull-ups and other bodyweight moves: kg = 0, add = extra weight on the body in kg (0 if none).
- When reps or weight of a set is not said, take it from "current" for the same exercise, or from the previous set.
- note: a short Chinese phrase only when the user said how that set felt (e.g. "很吃力", "力竭", "腰有点不舒服"), otherwise "". hard = true when the set was hard, 吃力, 力竭, failed or barely completed.
- A feeling said about "最后一组" belongs to the last set of that exercise.

Reply with the JSON object only.`;

const ERR = {
  openrouter: { 401: 'OpenRouter 密钥不对，去设置里重新填', 402: 'OpenRouter 余额不够了', 403: 'OpenRouter 拒绝了这次请求', 408: 'OpenRouter 超时，再试一次', 429: 'OpenRouter 请求太多，等一下再试', 502: '模型暂时不可用，等一下再试', 503: '模型暂时不可用，等一下再试' },
  anthropic: { 401: 'Anthropic 密钥不对，去设置里重新填', 403: '这个 Anthropic 密钥没有权限', 429: 'Claude 请求太多，等一下再试', 529: 'Claude 现在太忙，等一下再试' },
};

async function call(url, headers, body) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); } catch { throw new Error('连不上 AI，检查一下网络'); }
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

function fail(p, r, j) {
  const msg = j.error?.message || j.error?.metadata?.raw || '';
  return new Error(ERR[p][r.status] || `AI 出错（${r.status}）${msg ? '：' + String(msg).slice(0, 120) : ''}`);
}

function jsonOf(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('AI 没给出能用的结果，再说一次'); }
}

// The AI path: returns [{ lift, sets, def? }] (def = name/parts/bodyweight for a new exercise).
export async function parseAI(said, current = []) {
  const key = getKey(), p = provider(key);
  if (!key) throw Object.assign(new Error('没有填 AI 密钥'), { code: 'NO_KEY' });
  if (p === 'unknown') throw new Error('认不出这个密钥：OpenRouter 的以 sk-or- 开头，Anthropic 的以 sk-ant- 开头');
  const model = MODELS[getModel()][p];
  const lifts = Object.fromEntries(tr.allLiftIds().map((id) => [id, tr.lift(id).name]));
  const user = JSON.stringify({ lifts, current: current.map((it) => ({ lift: it.lift, sets: it.sets })), said });
  let text;
  if (p === 'openrouter') {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
    const base = { model, max_tokens: 4000, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] };
    const strict = { ...base, response_format: { type: 'json_schema', json_schema: { name: 'training_log', strict: true, schema: SCHEMA } }, reasoning: { effort: 'low' } };
    let { r, j } = await call(url, headers, strict);
    // an endpoint that doesn't take the schema or the effort setting: ask again with the prompt alone
    if (r.status === 400) ({ r, j } = await call(url, headers, base));
    if (!r.ok || j.error) throw fail(p, r, j);
    const c = j.choices?.[0];
    if (c?.finish_reason === 'length') throw new Error('说的内容太长，分两次说');
    const m = c?.message?.content;
    text = Array.isArray(m) ? m.map((x) => x.text || '').join('') : m;
  } else {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model, max_tokens: 4000, system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: user }],
    };
    const { r, j } = await call('https://api.anthropic.com/v1/messages', headers, body);
    if (!r.ok) throw fail(p, r, j);
    if (j.stop_reason === 'refusal') throw new Error('模型没有处理这段话，换个说法再试');
    if (j.stop_reason === 'max_tokens') throw new Error('说的内容太长，分两次说');
    text = (j.content || []).find((b) => b.type === 'text')?.text;
  }
  return normalize(jsonOf(text).items || []);
}

function normalize(items) {
  const known = new Set(tr.allLiftIds());
  return items.filter((it) => it.lift && it.sets?.length).map((it) => {
    const id = String(it.lift).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'lift';
    const bw = known.has(id) ? tr.lift(id).bodyweight : !!it.bodyweight;
    const sets = it.sets.map((s) => ({
      reps: Math.max(0, Math.round(+s.reps || 0)),
      kg: bw ? 0 : Math.max(0, +s.kg || 0),
      ...(bw && +s.add > 0 ? { add: +s.add } : {}),
      ...(s.note ? { note: String(s.note).slice(0, 60) } : {}),
      ...(s.hard ? { hard: true } : {}),
    })).filter((s) => s.reps > 0);
    const out = { lift: id, sets };
    if (!known.has(id)) {
      const parts = {};
      (it.parts || []).forEach((q, i) => { if (tr.PARTS[q]) parts[q] = i === 0 ? 1 : 0.5; });
      out.def = { name: String(it.name || id).slice(0, 20), parts, bodyweight: !!it.bodyweight };
    }
    return out;
  }).filter((it) => it.sets.length);
}

// Quick check that the key works (used by the settings sheet).
export async function test() {
  const items = await parseAI('深蹲 100 公斤 5 组 5 个');
  return items[0]?.lift === 'squat';
}
