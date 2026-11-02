// Voice → sets. The phone's speech recognition (zh-CN) turns speech into text; Claude turns the
// text into lifts and sets. The Anthropic API key is typed in on this phone and stays in localStorage.
import * as tr from './training.js';

const KEY = 'anthropic-key';
export const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setKey = (k) => { try { if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch {} };
export const hasKey = () => !!getKey();

const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = () => !!Rec;

const REC_ERR = {
  'not-allowed': '没有麦克风权限：在 iPhone 设置 → Safari → 麦克风 里允许',
  'service-not-allowed': '这里不能用语音识别，可以用键盘上的麦克风说',
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

// ---------- Claude ----------
const MODEL = 'claude-opus-5-5';
const URL = 'https://api.anthropic.com/v1/messages';
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
- A feeling said about "最后一组" belongs to the last set of that exercise.`;

const API_ERR = {
  401: 'Claude API 密钥不对，去设置里重新填',
  403: '这个 Claude API 密钥没有权限',
  429: 'Claude 请求太多，等一下再试',
  529: 'Claude 现在太忙，等一下再试',
};

async function post(body, withFallback) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': getKey(),
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (withFallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  let r;
  try {
    r = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(withFallback ? { ...body, fallbacks: 'default' } : body) });
  } catch { throw new Error('连不上 Claude，检查一下网络'); }
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

// Parse a transcript into [{ lift, sets, def? }] (def = name/parts/bodyweight for a new exercise).
export async function parse(said, current = []) {
  if (!getKey()) throw Object.assign(new Error('先在设置里填 Claude API 密钥，才能用语音记录'), { code: 'NO_KEY' });
  const lifts = Object.fromEntries(tr.allLiftIds().map((id) => [id, tr.lift(id).name]));
  const body = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify({ lifts, current: current.map((it) => ({ lift: it.lift, sets: it.sets })), said }) }],
  };
  let { r, j } = await post(body, true);
  // Older accounts may not have the fallback beta yet: retry once without it.
  if (r.status === 400 && /fallback|beta/i.test(j.error?.message || '')) ({ r, j } = await post(body, false));
  if (!r.ok) throw new Error(API_ERR[r.status] || `Claude 出错（${r.status}）：${j.error?.message || ''}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude 没有处理这段话，换个说法再试');
  if (j.stop_reason === 'max_tokens') throw new Error('说的内容太长，分两次说');
  const text = (j.content || []).find((b) => b.type === 'text')?.text;
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('没听懂，再说一次'); }
  return normalize(out.items || []);
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
      (it.parts || []).forEach((p, i) => { if (tr.PARTS[p]) parts[p] = i === 0 ? 1 : 0.5; });
      out.def = { name: String(it.name || id).slice(0, 20), parts, bodyweight: !!it.bodyweight };
    }
    return out;
  }).filter((it) => it.sets.length);
}

// Quick check that the key works (used by the settings sheet).
export async function test() {
  const items = await parse('深蹲 100 公斤 5 组 5 个');
  return items[0]?.lift === 'squat';
}
