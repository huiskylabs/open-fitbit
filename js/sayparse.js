// Understands what was said about a training session, on the phone: no network, no key.
//   "深蹲 100 公斤 5 组 5 个，引体向上加 5 公斤 4 组 8 个，最后一组很吃力"
// Returns the whole log after applying what was said to `current` (the same shape the AI path
// returns), plus the words it could not place, so the caller can hand those to the AI or show them.
import * as tr from './training.js';

// ---------- names ----------
// Speech recognition mishears; these are the ways each lift has come out.
const HEADS = {
  squat: ['杠铃深蹲', '颈后深蹲', '高杠深蹲', '低杠深蹲', '深蹲', '身蹲', '深吨', '深墩', '深顿', '生蹲', '神蹲', '森蹲', '背蹲', '后蹲'],
  bench: ['杠铃卧推', '平板卧推', '卧推', '握推', '卧堆', '沃推', '窝推'],
  deadlift: ['杠铃硬拉', '传统硬拉', '硬拉', '硬啦', '应拉', '硬蜡', '印拉', '英拉'],
  pullup: ['负重引体', '正手引体', '反手引体', '引体', '饮体', '隐体', '引提', '因体', '银体', '引题', '印体', '英体'],
};
// words that can sit in front of a lift name without making it a different exercise
const MODS = { squat: ['杠铃', '传统', '标准', '自由'], bench: ['杠铃', '平板', '标准', '自由'], deadlift: ['杠铃', '传统', '标准'], pullup: ['负重', '正手', '标准', '宽距', '自重'] };

function names() {
  const out = [];
  for (const [id, heads] of Object.entries(HEADS)) {
    for (const h of heads) {
      out.push([h, id]);
      if (id === 'pullup') out.push([h + '向上', id], [h + '上', id]);
    }
  }
  out.push(['squat', 'squat'], ['bench', 'bench'], ['deadlift', 'deadlift'], ['pull up', 'pullup'], ['pullup', 'pullup'], ['pull-up', 'pullup']);
  for (const [id, c] of Object.entries(tr.get().lib || {})) if (c?.name) out.push([c.name, id]);
  return out.sort((a, b) => b[0].length - a[0].length); // longest first
}

// body parts and bodyweight, guessed from a new exercise's name
const PART_HINTS = [
  [/腿弯举|罗马尼亚|直腿硬拉|腘绳/, ['hams', 'glutes']],
  [/臀推|臀桥|驴踢|蚌式/, ['glutes', 'hams']],
  [/卧推|推胸|飞鸟|夹胸|俯卧撑|双杠|胸/, ['chest', 'triceps']],
  [/推肩|推举|侧平举|前平举|面拉|耸肩|肩/, ['shoulders']],
  [/划船|下拉|引体|背/, ['back', 'biceps']],
  [/弯举|二头/, ['biceps']],
  [/臂屈伸|下压|三头|窄距/, ['triceps']],
  [/硬拉|山羊挺身|早安/, ['hams', 'lowback']],
  [/蹲|腿举|箭步|弓步|腿屈伸|保加利亚/, ['quads', 'glutes']],
  [/提踵|小腿/, ['calves']],
  [/卷腹|腹|平板支撑|举腿|转体|支撑/, ['abs']],
];
const BW_NAME = /引体|俯卧撑|双杠|臂屈伸|卷腹|平板支撑|悬垂|深蹲跳|自重|徒手|举腿|仰卧起坐|开合跳/;
export function newDef(name) {
  const parts = {};
  const hit = PART_HINTS.find(([re]) => re.test(name));
  (hit?.[1] || []).forEach((p, i) => { parts[p] = i === 0 ? 1 : 0.5; });
  return { name: name.slice(0, 20), parts, bodyweight: BW_NAME.test(name) };
}

// ---------- text → plain form ----------
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT_AFTER = /^(?:\s*)(?:[组个次下斤磅×乘,]|公斤|千克|kg|lb|$|\d)/i;

function cnInt(s) {
  let total = 0, num = 0, unit = 1, before = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c in CN) { num = CN[c]; before = s[i - 1] || ''; continue; }
    const u = c === '十' ? 10 : c === '百' ? 100 : 1000;
    total += (num || (u === 10 ? 1 : 0)) * u;
    num = 0; unit = u;
  }
  // 一百二 = 120, 一百零二 = 102
  if (num) total += before === '百' || before === '千' ? (num * unit) / 10 : num;
  return total;
}

// "一百零二点五" → "102.5"; "五五" → "5×5"; "八八六" → "8 8 6"; "七八个" → "7个"
function cnRun(run, next) {
  // "五五一百": digits said one by one, then a number. A real number has one digit before each 十/百/千.
  const m = run.match(/^([零〇一二两俩三四五六七八九]{2,})([一二两三四五六七八九][十百千].*)$/);
  if (m) return `${cnRun(m[1], ' ')} ${cnRun(m[2], next)}`;
  const [ip, dp] = run.split('点');
  if (/[十百千]/.test(ip) || ip.length === 1) {
    let v = /[十百千]/.test(ip) ? cnInt(ip) : CN[ip];
    if (dp) v = +(`${v}.${[...dp].map((c) => CN[c]).join('')}`);
    return String(v);
  }
  const ds = [...ip].map((c) => CN[c]);
  if (/^[组个次下]/.test(next) && ds.length === 2 && Math.abs(ds[1] - ds[0]) === 1) return String(ds[0]); // about 7–8
  if (ds.length === 2 && !/^[组个次下斤磅公千kl]/i.test(next)) return `${ds[0]}×${ds[1]}`;
  return ds.join(' ');
}

export function normalize(said) {
  let s = String(said || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、；;。！!？?…：:\n\r]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[“”"'‘’（）()【】\[\]]/g, ' ');
  s = s.replace(/\./g, (m, i) => (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '') ? '.' : ','));
  // Chinese numerals, only where a number belongs (before a unit / separator / end), so 一共, 三头 stay words
  s = s.replace(/[零〇一二两俩三四五六七八九十百千]+(?:点[零〇一二三四五六七八九]+)?/g, (run, i, all) => {
    const next = all.slice(i + run.length);
    const prev = all[i - 1] || '';
    if (!UNIT_AFTER.test(next) && prev !== '第' && !/^点/.test(next)) return run;
    if (/^[两俩]$/.test(run) && !/^[组个次下]/.test(next.trim())) return run;
    return cnRun(run, next.trim());
  });
  s = s
    .replace(/(\d)\s*(?:[xX＊*✕✖×]|乘以?)\s*(\d)/g, '$1×$2')
    .replace(/(\d(?:\.\d+)?)\s*(公斤|千克|kg|斤)半/gi, (m, n, u) => `${+n + 0.5}${u}`)
    .replace(/(\d)\s+(?=公斤|千克|kg|lb|磅|斤|组|个|次|下)/gi, '$1')
    .replace(/\s+/g, ' ')
    .replace(/(,\s*)+/g, ',')
    .trim();
  return s;
}

// ---------- tokens ----------
const FEEL_HARD = /^(没做完|没起来|差点没起来|差一点没起来|差点起不来|起不来|做不动了?|推不动了?|拉不动了?|蹲不起来|拉不起来|差一点|勉强|力竭|非常吃力|特别吃力|很吃力|挺吃力|比较吃力|有点吃力|有些吃力|有一点吃力|吃力|很难|好难|太难|挺难|很累|好累|太累|很重|好重|太重|有点重|失败了?|爆了)/;
const FEEL_EASY = /^(很轻松|挺轻松|比较轻松|轻松|很顺|状态很好|状态不错|不错)/;
const FEEL_PAIN = /^((?:后腰|下背|后背|膝盖|肩膀|手腕|手肘|胳膊|手臂|大腿|小腿|屁股|脖子|脚踝|腰|背|膝|肩|腕|肘|胸|腿|臀|颈|髋)(?:有点|有些|有一点|比较|很|特别|好|一直|还是)?(?:疼|痛|酸|不舒服|难受|紧))/;
const FEEL_PAIN2 = /^((?:有点|有些|有一点|很)(?:疼|痛|不舒服|难受))/;
const FILLERS = ['今天练的是', '今天练了', '今天做了', '今天是', '练的是', '然后', '接着', '之后', '还有', '另外', '以及', '最后', '首先', '完成了', '完成', '练了', '练的', '做了', '做的', '今天', '刚才', '刚刚', '上午', '下午', '晚上', '早上', '那个', '就是', '这个', '主要', '只有', '只做了', '只做', '比上次', '跟上次', '和上次', '上次', '一样', '不对', '应该', '感觉', '觉得', '大概', '左右', '差不多', '大约', '总共', '一共', '分别是', '分别', '依次是', '依次', '重量是', '重量', '次数', '组数', '每组的'];
const WHOLE = /^(今天只练了|今天就练了|只练了|就练了)/;
// single characters that mean nothing on their own; they are dropped from the ends of unknown words
const SOFT = new Set([...'了的是和跟与及有就也还再又我先练做吧呢啊嗯呃哦呀啦嘛哈个组次下共只都']);

function tokenize(s, NAMES) {
  const toks = [];
  let i = 0;
  const push = (t, len) => { toks.push({ ...t, a: i, b: i + len }); i += len; };
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if (rest[0] === ',') { push({ t: 'sep' }, 1); continue; }
    if (rest[0] === ' ') { i++; continue; }
    if ((m = rest.match(/^(\d+(?:\.\d+)?)(公斤|千克|kgs?|斤|磅|lbs?|组|个|次|下|reps?)?/i))) {
      const u = (m[2] || '').toLowerCase();
      const unit = !u ? null : /^(公斤|千克|kg)/.test(u) ? 'kg' : u === '斤' ? 'jin' : /^(磅|lb)/.test(u) ? 'lb' : u === '组' ? 'set' : 'rep';
      push({ t: 'num', v: +m[1], u: unit }, m[0].length);
      continue;
    }
    if (rest[0] === '×') { push({ t: 'x' }, 1); continue; }
    if (rest[0] === '+' && /\d/.test(rest[1] || '')) { push({ t: 'mark', k: 'add' }, 1); continue; }
    if ((m = rest.match(FEEL_HARD))) { push({ t: 'feel', note: m[0], hard: true }, m[0].length); continue; }
    if ((m = rest.match(FEEL_PAIN) || rest.match(FEEL_PAIN2))) { push({ t: 'feel', note: m[0], hard: false }, m[0].length); continue; }
    if ((m = rest.match(FEEL_EASY))) { push({ t: 'feel', note: m[0], hard: false }, m[0].length); continue; }
    if ((m = rest.match(/^最后(\d+)?组/))) { push({ t: 'ref', k: 'last', n: +(m[1] || 1) }, m[0].length); continue; }
    if ((m = rest.match(/^第(\d+)组/))) { push({ t: 'ref', k: 'nth', i: +m[1] - 1 }, m[0].length); continue; }
    if ((m = rest.match(/^前(\d+)组/))) { push({ t: 'ref', k: 'first', n: +m[1] }, m[0].length); continue; }
    if ((m = rest.match(/^后(?:面)?(\d+)组/))) { push({ t: 'ref', k: 'last', n: +m[1] }, m[0].length); continue; }
    if ((m = rest.match(/^(每一组都|每组都|每组|每一组|每个|都是|全部都|全部|全都|每次|各|都)/))) { push({ t: 'mark', k: 'each' }, m[0].length); continue; }
    if ((m = rest.match(/^(再加了?|再来了?|再做了?|又做了?|多做了?|多加了?|多了|加了?)(?=\d+组)/))) { push({ t: 'mark', k: 'more' }, m[0].length); continue; }
    if ((m = rest.match(/^(少做了?|少了|减了?)(?=\d+组)/))) { push({ t: 'mark', k: 'fewer' }, m[0].length); continue; }
    if ((m = rest.match(/^(加到|加至|升到|涨到|改成|改为|换成|应该是|其实是|减到|降到)/))) { push({ t: 'mark', k: 'to' }, m[0].length); continue; }
    if ((m = rest.match(/^(加了|多加了|负重|挂了|挂|带了|带|加)(?=\d)/))) { push({ t: 'mark', k: 'add' }, m[0].length); continue; }
    if ((m = rest.match(/^(减了|减|少了|降了)(?=\d)/))) { push({ t: 'mark', k: 'minus' }, m[0].length); continue; }
    if ((m = rest.match(/^(没有练|没练|没有做|没做|没有|不是|去掉|删掉|删除|不算|取消|不要)/))) { push({ t: 'mark', k: 'neg' }, m[0].length); continue; }
    if ((m = rest.match(WHOLE))) { push({ t: 'mark', k: 'whole' }, m[0].length); continue; }
    const nm = NAMES.find(([n]) => rest.toLowerCase().startsWith(n.toLowerCase()));
    if (nm) { push({ t: 'lift', id: nm[1], raw: rest.slice(0, nm[0].length) }, nm[0].length); continue; }
    const f = FILLERS.find((w) => rest.startsWith(w));
    if (f) { push({ t: 'fill' }, f.length); continue; }
    // anything else: part of an unknown word (an exercise name we don't know yet, or noise)
    const last = toks.at(-1);
    if (last?.t === 'word' && last.b === i) { last.s += rest[0]; last.b++; i++; }
    else push({ t: 'word', s: rest[0] }, 1);
  }
  return toks;
}

const trimSoft = (w) => {
  let a = 0, b = w.length;
  while (a < b && SOFT.has(w[a])) a++;
  while (b > a && SOFT.has(w[b - 1])) b--;
  return w.slice(a, b);
};
const NOT_NAMES = /^(重量|次数|组数|感觉|状态|今天|昨天|上次|这次|一样|正常|还行|一般|左右|大概)$/;

// ---------- tokens → one segment per exercise ----------
function segment(toks) {
  const pre = { pre: true, toks: [] };
  const segs = [pre];
  const unknown = [];
  let cur = pre, whole = false;
  const byKey = new Map();
  const start = (key, init) => {
    if (byKey.has(key)) { cur = byKey.get(key); cur.toks.push({ t: 'sep' }); return cur; }
    cur = { ...init, toks: [] };
    byKey.set(key, cur);
    segs.push(cur);
    return cur;
  };
  // tokens right in front of a lift name that belong to it: "没练硬拉", "再加一组引体"
  const takeLead = () => {
    const lead = [];
    const tk = cur.toks;
    while (tk.length) {
      const t = tk.at(-1);
      if (t.t === 'fill') { tk.pop(); continue; }
      if (t.t === 'mark' && t.k === 'neg') { lead.unshift(tk.pop()); break; }
      if (t.t === 'num' && t.u === 'set' && tk.at(-2)?.t === 'mark' && /more|fewer/.test(tk.at(-2).k)) { lead.unshift(tk.pop()); lead.unshift(tk.pop()); break; }
      break;
    }
    return lead;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'mark' && t.k === 'whole') { whole = true; continue; }
    if (t.t === 'lift') {
      let id = t.id, name = t.raw, isNew = false;
      // a word stuck to the name makes another exercise: 哑铃 + 卧推, 罗马尼亚 + 硬拉, 深蹲 + 跳
      const before = toks[i - 1]?.t === 'word' && toks[i - 1].b === t.a ? toks[i - 1] : null;
      const after = toks[i + 1]?.t === 'word' && toks[i + 1].a === t.b ? toks[i + 1] : null;
      const pw = before ? trimSoft(before.s.replace(/^[了的是和跟与及有就也还再又我先吧呢啊嗯呃哦呀啦嘛]+/, '')) : '';
      const aw = after ? trimSoft(after.s) : '';
      if (pw && !(MODS[id] || []).includes(pw)) { name = pw + name; isNew = true; }
      if (aw && !/^(向上|上)$/.test(aw)) { name += aw; isNew = true; }
      if (before && pw) { const k = unknown.lastIndexOf(before.s); if (k >= 0) unknown.splice(k, 1); }
      if (after && aw) { after.used = true; i++; }
      if (isNew) {
        const lib = Object.entries(tr.get().lib || {}).find(([, c]) => c?.name === name);
        id = lib ? lib[0] : null;
      }
      const lead = takeLead();
      start(id || 'new:' + name, { lift: id, name, def: id ? null : newDef(name) });
      if (lead.some((x) => x.k === 'neg')) cur.neg = true;
      cur.toks.push(...lead.filter((x) => x.k !== 'neg'));
      continue;
    }
    if (t.t === 'word') {
      const w = trimSoft(t.s);
      const nx = toks.slice(i + 1).find((x) => x.t !== 'fill');
      if (w.length >= 2 && w.length <= 12 && !NOT_NAMES.test(w) && nx && (nx.t === 'num' || (nx.t === 'mark' && nx.k === 'add'))) {
        const lib = Object.entries(tr.get().lib || {}).find(([, c]) => c?.name === w);
        const lead = takeLead();
        start(lib ? lib[0] : 'new:' + w, { lift: lib ? lib[0] : null, name: w, def: lib ? null : newDef(w) });
        if (lead.some((x) => x.k === 'neg')) cur.neg = true;
        cur.toks.push(...lead.filter((x) => x.k !== 'neg'));
        continue;
      }
      if (w) unknown.push(t.s);
      continue;
    }
    // "硬拉没练": a negation right after a name, before any numbers
    if (t.t === 'mark' && t.k === 'neg' && !cur.pre && !cur.toks.some((x) => x.t === 'num' || x.t === 'feel')) {
      const nx = toks[i + 1];
      if (!nx || nx.t === 'sep' || nx.t === 'fill' || nx.t === 'word') { cur.neg = true; continue; }
    }
    cur.toks.push(t);
  }
  return { segs, unknown: unknown.map(trimSoft).filter(Boolean), whole };
}

// ---------- one segment → what was said about that exercise ----------
const toKg = (v, u) => (u === 'jin' ? v / 2 : u === 'lb' ? Math.round(v * 0.4536 * 4) / 4 : v);
const isW = (u) => u === 'kg' || u === 'jin' || u === 'lb';

function read(seg, bw) {
  const p = { n: null, reps: null, repsL: [], kg: null, kgL: [], add: null, rel: 0, more: 0, per: [], feelAll: [], feelLast: [], said: false, del: [] };
  let ref = null, mode = null;
  const per = () => { const o = { ref, o: {} }; p.per.push(o); return o.o; };
  const weight = (w) => {
    p.said = true;
    if (bw) { if (ref) per().add = w; else p.add = w; return; }
    if (ref) { per().kg = w; return; }
    if (mode === 'add') { p.rel += w; return; }
    if (mode === 'minus') { p.rel -= w; return; }
    if (p.kg == null && !p.kgL.length) p.kg = w;
    else { if (!p.kgL.length) p.kgL.push(p.kg); p.kgL.push(w); }
  };
  const reps = (r) => {
    p.said = true;
    if (ref) { per().reps = r; return; }
    if (mode === 'each') { p.reps = r; p.repsL = []; return; }
    if (p.reps == null && !p.repsL.length) p.reps = r;
    else { if (!p.repsL.length) p.repsL.push(p.reps); p.repsL.push(r); }
  };
  const tk = seg.toks;
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    if (t.t === 'sep') { ref = null; mode = null; continue; }
    if (t.t === 'fill') continue;
    if (t.t === 'ref') { ref = t; mode = null; continue; }
    if (t.t === 'mark') {
      if (t.k === 'neg') { if (ref) { p.del.push(ref); p.said = true; } else seg.neg = true; continue; }
      mode = t.k; continue;
    }
    if (t.t === 'feel') {
      p.said = true;
      const f = { note: t.note, hard: t.hard };
      if (ref) Object.assign(per(), { feel: f });
      else if (mode === 'each') p.feelAll.push(f);
      else p.feelLast.push(f);
      continue;
    }
    if (t.t !== 'num') continue;
    // a × b
    if (tk[i + 1]?.t === 'x' && tk[i + 2]?.t === 'num') {
      const a = t, b = tk[i + 2];
      i += 2;
      p.said = true;
      if (isW(a.u)) { weight(toKg(a.v, a.u)); p.reps = b.v; }
      else if (isW(b.u)) { reps(a.v); weight(toKg(b.v, b.u)); }
      else if (a.u === 'set' || (!a.u && a.v <= 12)) { p.n = a.v; p.reps = b.v; p.repsL = []; }
      else if (!bw) { weight(a.v); p.reps = b.v; }
      else { p.n = a.v; p.reps = b.v; }
      mode = null;
      continue;
    }
    if (isW(t.u)) { weight(toKg(t.v, t.u)); mode = null; continue; }
    if (t.u === 'set') {
      p.said = true;
      if (mode === 'more') p.more += t.v;
      else if (mode === 'fewer') p.more -= t.v;
      else p.n = t.v;
      mode = mode === 'each' ? 'each' : null;
      continue;
    }
    if (t.u === 'rep') { reps(t.v); continue; }
    // a bare number: a weight when it is big (or for "加 5" on a bodyweight move), else reps
    if (mode === 'add' || mode === 'minus' || (!bw && (t.v > 20 || t.v % 1))) { weight(t.v); mode = mode === 'each' ? mode : null; continue; }
    reps(t.v);
  }
  return p;
}

const has = (p) => p.said;

function build(p, base, bw, keepFlags) {
  const said = p.n != null || p.repsL.length > 1 || p.kgL.length > 1;
  let n = p.n ?? (p.repsL.length > 1 ? p.repsL.length : p.kgL.length > 1 ? p.kgL.length : null) ?? (base.length || 1);
  if (!said && !base.length) n = 1;
  n = Math.max(0, n + p.more);
  const def = bw ? { reps: 8, kg: 0 } : { reps: 5, kg: 0 };
  const sets = [];
  for (let i = 0; i < n; i++) {
    const b = base[i] || base.at(-1) || def;
    const s = { reps: p.repsL.length ? p.repsL[i] ?? p.repsL.at(-1) : p.reps ?? b.reps ?? def.reps };
    if (bw) {
      s.kg = 0;
      const add = p.add ?? b.add ?? 0;
      if (add) s.add = add;
    } else {
      let kg = p.kgL.length ? p.kgL[i] ?? p.kgL.at(-1) : p.kg ?? b.kg ?? 0;
      if (p.rel && p.kg == null && !p.kgL.length) kg = Math.max(0, Math.round(((b.kg || 0) + p.rel) * 100) / 100);
      s.kg = kg;
    }
    if (keepFlags && base[i]) { if (base[i].hard) s.hard = true; if (base[i].note) s.note = base[i].note; }
    sets.push(s);
  }
  const idx = (ref) => {
    const L = sets.length;
    if (ref.k === 'nth') return [ref.i];
    if (ref.k === 'first') return [...Array(Math.min(ref.n, L)).keys()];
    return [...Array(Math.min(ref.n, L)).keys()].map((k) => L - Math.min(ref.n, L) + k);
  };
  const feel = (s, f) => {
    if (f.hard) s.hard = true;
    if (f.note && !(s.note || '').includes(f.note)) s.note = s.note ? `${s.note}，${f.note}` : f.note;
  };
  for (const { ref, o } of p.per) {
    for (const k of idx(ref)) {
      if (k < 0) continue;
      while (sets.length <= k) { const { note, hard, ...l } = sets.at(-1) || def; sets.push({ ...l }); }
      const s = sets[k];
      if (o.reps != null) s.reps = o.reps;
      if (o.kg != null && !bw) s.kg = o.kg;
      if (o.add != null && bw) { if (o.add) s.add = o.add; else delete s.add; }
      if (o.feel) feel(s, o.feel);
    }
  }
  for (const ref of p.del) for (const k of idx(ref).sort((a, b) => b - a)) sets.splice(k, 1);
  for (const f of p.feelAll) sets.forEach((s) => feel(s, f));
  for (const f of p.feelLast) if (sets.length) feel(sets.at(-1), f);
  return sets.filter((s) => s.reps > 0);
}

const MAIN = ['squat', 'bench', 'deadlift'];
const plain = (sets) => sets.map(({ reps, kg, add }) => ({ reps, kg, ...(add ? { add } : {}) }));

// current: [{ lift, sets }] as the editor has it now. fromGuess: those items are the app's guess,
// not something the user entered, so naming a different main lift replaces the guessed one.
export function parseLocal(said, current = [], { fromGuess = false } = {}) {
  const text = normalize(said);
  const NAMES = names();
  const { segs, unknown, whole } = segment(tokenize(text, NAMES));
  const cur = current.map((it) => ({ lift: it.lift, sets: it.sets.map((s) => ({ ...s })) }));
  const defs = {};
  let k = 0;
  const stamp = Date.now().toString(36);
  for (const s of segs) {
    if (s.pre || s.lift) continue;
    s.lift = `c_${stamp}${k++}`;
    defs[s.lift] = s.def;
  }
  const bwOf = (id) => (defs[id] ? !!defs[id].bodyweight : tr.lift(id).bodyweight);
  const baseOf = (id) => {
    const c = cur.find((it) => it.lift === id);
    if (c) return { sets: c.sets, mine: true };
    const l = tr.lastItem(id);
    return { sets: l ? plain(l.item.sets) : [], mine: false };
  };
  const [pre, ...named] = segs;
  // numbers said before any name go with the first name ("100 公斤 5 组深蹲")
  if (named.length && pre.toks.some((t) => t.t === 'num')) named[0].toks.unshift(...pre.toks, { t: 'sep' });
  const reads = named.map((s) => ({ s, p: read(s, bwOf(s.lift)) }));
  const removed = new Set(reads.filter((r) => r.s.neg && !has(r.p)).map((r) => r.s.lift));
  const told = reads.filter((r) => !removed.has(r.s.lift));
  const itemFor = ({ s, p }) => {
    const b = baseOf(s.lift);
    return { lift: s.lift, sets: build(p, b.sets, bwOf(s.lift), b.mine) };
  };
  let items, touched = removed.size > 0, sure = true;
  if (told.length && (whole || told.length >= 2)) {
    items = told.map(itemFor);
    touched = true;
  } else if (told.length === 1) {
    const it = itemFor(told[0]);
    touched = true;
    items = [];
    let slot = -1;
    cur.forEach((c) => { if (removed.has(c.lift)) { if (slot < 0) slot = items.length; } else items.push(c); });
    const at = items.findIndex((c) => c.lift === it.lift);
    const mains = items.map((c, i) => (MAIN.includes(c.lift) ? i : -1)).filter((i) => i >= 0);
    if (at >= 0) items[at] = it;
    else if (slot >= 0) items.splice(slot, 0, it);
    else if (fromGuess && MAIN.includes(it.lift) && mains.length === 1) items[mains[0]] = it;
    else items.push(it);
  } else {
    items = cur.filter((c) => !removed.has(c.lift));
    const p = read(pre, false);
    if (has(p)) {
      // nothing named: it is about the one exercise in play, the weighted one when a weight was said,
      // or the last one done for "最后一组…"
      const weighted = p.kg != null || p.kgL.length || p.rel;
      let i = items.length === 1 ? 0 : -1;
      if (i < 0 && weighted) i = items.findIndex((c) => !bwOf(c.lift));
      if (i < 0 && !p.n && !p.reps && !p.repsL.length && (p.feelLast.length || p.per.length)) i = items.length - 1;
      if (i >= 0) {
        const id = items[i].lift;
        const q = read(pre, bwOf(id));
        items[i] = { lift: id, sets: build(q, items[i].sets, bwOf(id), true) };
        touched = true;
      } else sure = false;
    }
  }
  if (unknown.length) sure = false;
  items = items.filter((it) => it.sets.length);
  const used = new Set(items.map((it) => it.lift));
  const outDefs = Object.fromEntries(Object.entries(defs).filter(([id]) => used.has(id)));
  const noKg = items.filter((it) => !bwOf(it.lift) && it.sets.some((s) => !s.kg)).map((it) => it.lift);
  return {
    items: items.map((it) => ({ lift: it.lift, sets: it.sets, ...(outDefs[it.lift] ? { def: outDefs[it.lift] } : {}) })),
    unknown,
    sure: sure && touched,
    touched,
    noKg,
  };
}
