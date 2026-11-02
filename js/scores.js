// Self-computed scores (the API has no sleep / readiness score) and heart-rate zone helpers.
import { clamp, sum, median, nightMin } from './util.js';

// Sleep score 0–100 = duration (50) + regularity (25) + deep & REM share (25).
// Duration: 4 h → 0, goal (8 h) → full. Regularity: bed + wake time vs the median of the previous nights;
// ≤ 30 min total drift is full marks, 3 h is zero. Deep + REM: 40 % of time asleep or more is full marks.
export function sleepScore(night, prevNights = [], goalMin = 480) {
  if (!night) return null;
  const asleep = night.asleep || 0;
  const dur = clamp((asleep - 240) / (goalMin - 240), 0, 1);
  let reg = null;
  if (prevNights.length >= 3) {
    const bed = median(prevNights.map((n) => nightMin(new Date(n.start))));
    const wake = median(prevNights.map((n) => nightMin(new Date(n.end))));
    const dev = Math.abs(nightMin(new Date(night.start)) - bed) + Math.abs(nightMin(new Date(night.end)) - wake);
    reg = clamp(1 - (dev - 30) / 150, 0, 1);
  }
  let stage = null;
  if (night.hasStages && asleep > 0) stage = clamp(((night.byStage.DEEP || 0) + (night.byStage.REM || 0)) / asleep / 0.4, 0, 1);
  const parts = [[dur, 50], [reg, 25], [stage, 25]].filter(([v]) => v != null);
  const total = Math.round((100 * sum(parts.map(([v, w]) => v * w))) / sum(parts.map(([, w]) => w)));
  return { total, dur, reg, stage };
}

// Recovery score 0–100: HRV vs your baseline (35), resting HR vs baseline (30), last night's sleep score (35).
// Breathing rate or skin temperature clearly above your normal (an early sign of getting sick) costs 8 points each.
export function recoveryScore(day = {}, base = {}, sleep = null) {
  const parts = {};
  const b = (k) => base[k];
  if (day.hrv != null && b('hrv')) parts.hrv = clamp(0.5 + (day.hrv - b('hrv').mean) / Math.max(b('hrv').sd || 0, 3) / 4, 0, 1);
  if (day.rhr != null && b('rhr')) parts.rhr = clamp(0.5 - (day.rhr - b('rhr').mean) / Math.max(b('rhr').sd || 0, 1) / 4, 0, 1);
  if (sleep?.total != null) parts.sleep = sleep.total / 100;
  const w = { hrv: 35, rhr: 30, sleep: 35 };
  const keys = Object.keys(parts);
  if (!keys.length || (keys.length === 1 && keys[0] === 'sleep')) return null;
  let total = (100 * sum(keys.map((k) => parts[k] * w[k]))) / sum(keys.map((k) => w[k]));
  const flags = [];
  if (day.resp != null && b('resp') && day.resp > b('resp').mean + 2 * Math.max(b('resp').sd || 0, 0.3)) { total -= 8; flags.push('resp'); }
  if (day.skinRel != null && day.skinRel > 0.5) { total -= 8; flags.push('temp'); }
  return { total: Math.round(clamp(total, 0, 100)), parts, flags };
}

// Zone thresholds { LIGHT: [min, max], MODERATE, VIGOROUS, PEAK } from the API, or a Karvonen estimate.
export function zonesOrDefault(z, rest = 60) {
  if (z && z.MODERATE && z.VIGOROUS && z.PEAK) return z;
  const max = 190, hrr = max - rest;
  const at = (p) => Math.round(rest + p * hrr);
  return { LIGHT: [at(0.3), at(0.4) - 1], MODERATE: [at(0.4), at(0.6) - 1], VIGOROUS: [at(0.6), at(0.85) - 1], PEAK: [at(0.85), max + 30] };
}

// 0 = below zones, 1 light, 2 moderate (燃脂), 3 vigorous (有氧), 4 peak
export function zoneOf(hr, z) {
  if (hr == null) return 0;
  if (hr >= z.PEAK[0]) return 4;
  if (hr >= z.VIGOROUS[0]) return 3;
  if (hr >= z.MODERATE[0]) return 2;
  if (z.LIGHT && hr >= z.LIGHT[0]) return 1;
  return 0;
}
