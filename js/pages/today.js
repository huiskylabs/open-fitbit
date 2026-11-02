// 今天：早上打开一屏看完——昨晚、身体状态、待确认训练、步数、近 7 天
import { hm, ymd, addDays, today, parseYmd, fmtInt, signed, esc } from '../util.js';
import * as C from '../charts.js';
import { card, durHtml, workouts, activeZoneMin } from './common.js';
import { pendingCards } from './trainpage.js';
import { wCard, fillMinis } from './workouts.js';

const bar = (k, f) => `<div class="sbar"><span class="k">${k}</span><span class="track"><i style="width:${Math.round((f ?? 0) * 100)}%"></i></span></div>`;

export function render(ctx) {
  const { v } = ctx;
  const t = ymd(today());
  const n = v.nights[t];
  const sc = v.sleepScores[t];
  let out = '';
  if (n) {
    out += `<section class="card tap" data-act="goto" data-tab="sleep" data-range="d">
      <h2><span>昨晚</span></h2>
      <div class="score-row">
        <div class="score">${C.ring(sc?.total)}<div class="lab">睡眠分</div></div>
        <div class="score-body">
          <div class="hero">${durHtml(n.asleep)}<span class="when">${hm(new Date(n.start))} → ${hm(new Date(n.end))}</span></div>
          ${sc ? bar('时长', sc.dur) + (sc.reg != null ? bar('规律', sc.reg) : '') + (sc.stage != null ? bar('深睡 + REM', sc.stage) : '') : ''}
        </div>
      </div>
      ${C.barcode([{ date: t, night: n }], { rowH: 26, label: () => '' })}
    </section>`;
  }
  const rec = v.recovery[t];
  const d = v.daily[t] || {};
  const rows = [
    ['静息心率', d.rhr, 'rhr', (x) => `${x}`],
    ['HRV', d.hrv, 'hrv', (x) => `${Math.round(x)} ms`],
    ['呼吸率', d.resp, 'resp', (x) => x.toFixed(1)],
    ['皮温', d.skinRel, 'skinRel', (x) => `${signed(x, 1)} °C`],
  ].filter((r) => r[1] != null);
  if (rec || rows.length) {
    out += `<section class="card tap" data-act="goto" data-tab="heart" data-range="w">
      <h2><span>身体状态</span>${rec?.flags?.length ? '<span class="sub warn">呼吸率或皮温偏高</span>' : ''}</h2>
      <div class="score-row">
        ${rec ? `<div class="score">${C.ring(rec.total)}<div class="lab">恢复分</div></div>` : ''}
        <div class="score-body">${rows.map(([k, val, key, f]) => `<div class="vrow"><span class="k">${k}</span><b>${f(val)}</b>${C.rangeMini(val, v.base[key]?.[t], { W: 110 })}</div>`).join('')}</div>
      </div>
    </section>`;
  }
  out += pendingCards(ctx);
  const steps = d.steps;
  if (steps != null) out += card('步数', C.progressBar(steps, v.stepsAvg), { right: `<b class="big">${fmtInt(steps)}</b>` });
  const todays = workouts(v).filter((w) => ymd(new Date(w.start)) === t);
  out += todays.map((w) => wCard(w)).join('');
  // last 7 days
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(today(), i - 6)));
  const sl = days.map((date) => ({ date, v: v.nights[date] ? v.nights[date].asleep / 60 : null }));
  const rhr = days.map((date) => ({ date, v: v.daily[date]?.rhr ?? null }));
  const hrv = days.map((date) => ({ date, v: v.daily[date]?.hrv ?? null }));
  const all = workouts(v);
  const mins = days.map((date) => ({ date, v: all.filter((w) => ymd(new Date(w.start)) === date).reduce((a, w) => a + w.activeSec / 60, 0) }));
  const last = (s, f = (x) => x) => { const p = s.filter((x) => x.v != null).at(-1); return p ? f(p.v) : '–'; };
  const cell = (k, val, chart, tab) => `<div class="sp" data-act="goto" data-tab="${tab}" data-range="w"><div class="sp-h"><span>${k}</span><b>${val}</b></div>${chart}</div>`;
  out += card('近 7 天', `<div class="sparks">
    ${cell('睡眠', last(sl, (x) => `${x.toFixed(1)} h`), C.spark(sl, { band: days.map(() => ({ lo: v.goalMin / 60 - 0.02, hi: v.goalMin / 60 + 0.02 })) }), 'sleep')}
    ${cell('静息心率', last(rhr), C.spark(rhr, { band: days.map((x) => v.base.rhr[x] || null) }), 'heart')}
    ${cell('HRV', last(hrv, Math.round), C.spark(hrv, { band: days.map((x) => v.base.hrv[x] || null) }), 'heart')}
    ${cell('运动分钟', Math.round(mins.at(-1).v), C.spark(mins, { kind: 'bar' }), 'workouts')}
  </div>`);
  if (!out) out = '<div class="empty">还没有数据</div>';
  return out;
}

export async function after(ctx, root) {
  const { after: trainAfter } = await import('./trainpage.js');
  await Promise.all([fillMinis(root), trainAfter(ctx, root)]);
}
