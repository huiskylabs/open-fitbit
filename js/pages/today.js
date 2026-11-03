// 今天：先做什么，再看什么。要确认的训练、两个分数和原因、昨晚、身体状态、下次训练、今天的运动、步数
import { ymd, today, fmtInt, esc, hm } from '../util.js';
import * as C from '../charts.js';
import { card, facts, workouts, sleepWhy, recoveryWhy, METRIC, withUnit, rangeText, sp } from './common.js';
import { pendingCards, nextCard } from './trainpage.js';
import { wCard, fillMinis } from './workouts.js';
import { isWorse, WORSE } from '../scores.js';
import { stepsUsualByNow } from '../data.js';

export function render(ctx) {
  const { v } = ctx;
  const t = ymd(today());
  const n = v.nights[t];
  let out = pendingCards(ctx);
  // the two scores side by side, each with the reason behind it
  const sw = sleepWhy(v, t), rw = recoveryWhy(v, t), rec = v.recovery[t];
  if (sw || rw) {
    const score = (k, total, why, warn, tab, range) => `<div class="score" style="--p:${total}" data-act="goto" data-tab="${tab}" data-range="${range}"><div class="k">${k}</div><div class="v">${total}</div><div class="why${warn ? ' warn' : ''}">${esc(why)}</div></div>`;
    out += `<section class="card flat"><div class="scores">${sw ? score('睡眠分', sw.total, sw.why, false, 'sleep', 'd') : ''}${rw ? score('恢复分', rec.total, rw.why, rw.warn, 'heart', 'w') : ''}</div></section>`;
  }
  if (n) {
    // the 作息 row already has the times; without it (first nights) they go next to the title
    const hasTimes = sw?.rows.some((r) => r[0] === '作息');
    out += card('昨晚', C.barcode([{ date: t, night: n }], { rowH: 24, axis: false, label: null }) + (sw ? facts(sw.rows) : ''),
      { cls: 'tap', act: ' data-act="goto" data-tab="sleep" data-range="d"', sub: hasTimes ? '' : `${hm(new Date(n.start))}–${hm(new Date(n.end))}` });
  }
  const d = v.daily[t] || {};
  const keys = ['rhr', 'hrv', 'resp', 'skinRel'].filter((k) => d[k] != null);
  if (keys.length) {
    const b = (k) => v.base[k]?.[t];
    const worse = keys.filter((k) => isWorse(k, d[k], b(k)));
    // name · value with the normal range under it · where the value sits in that range
    const rows = keys.map((k) => `<div><span class="k">${METRIC[k].name}</span><span class="vb"><b class="${worse.includes(k) ? 'warn' : ''}">${withUnit(k, d[k])}</b><span class="n">${rangeText(k, b(k))}</span></span>${C.rangeMini(d[k], b(k), { W: 96, H: 16, worse: WORSE[k] })}</div>`).join('');
    out += card('身体状态', `<div class="vrows">${rows}</div>`, {
      cls: 'tap', act: ' data-act="goto" data-tab="heart" data-range="w"',
      right: worse.length ? `<span class="sub warn">${worse.map((k) => `${sp(METRIC[k].name)}偏${WORSE[k] === 'low' ? '低' : '高'}`).join('、')}</span>` : '',
    });
  }
  out += nextCard(ctx, { link: true });
  out += workouts(v).filter((w) => ymd(new Date(w.start)) === t).map((w) => wCard(w)).join('');
  if (d.steps != null) {
    const max = Math.max(d.steps, v.stepsAvg || 0, 1000) * 1.08;
    out += card('步数', `<div id="steps" data-max="${max}">${C.progressBar(d.steps, { max })}</div>`, { right: `<b class="big">${fmtInt(d.steps)}<small>步</small></b>` });
  }
  if (!out) out = '<div class="empty">还没有数据</div>';
  return out;
}

// steps you usually have by this time of day (needs the last 14 days in 15-minute steps)
async function fillSteps(root) {
  const el = root.querySelector('#steps');
  if (!el) return;
  const usual = await stepsUsualByNow().catch(() => null);
  const mark = el.querySelector('.mark');
  if (!usual || !mark || !el.isConnected) return;
  const pct = Math.min(100, (usual / +el.dataset.max) * 100);
  mark.style.left = `${pct}%`;
  const em = mark.querySelector('em');
  em.textContent = `平时到这个钟点 ${fmtInt(usual)}`;
  // keep the label inside the card near either end
  em.style.transform = pct > 62 ? 'translateX(-100%)' : pct < 38 ? 'translateX(-4px)' : '';
  mark.hidden = false;
}

export async function after(ctx, root) {
  const { after: trainAfter } = await import('./trainpage.js');
  await Promise.all([fillMinis(root), trainAfter(ctx, root), fillSteps(root)]);
}
