// Google Health API v4 client + normalization into the small models the UI uses.
import { accessToken } from './auth.js';

const BASE = 'https://health.googleapis.com/v4/users/me/';
const CACHE_MS = 10 * 60 * 1000;
const mem = new Map();

export function clearCache() {
  mem.clear();
  try { Object.keys(localStorage).filter((k) => k.startsWith('c:')).forEach((k) => localStorage.removeItem(k)); } catch {}
}

async function call(path, { method = 'GET', body } = {}) {
  const key = 'c:' + method + path + (body ? JSON.stringify(body) : '');
  const hit = mem.get(key) || (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })();
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const tok = await accessToken();
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || r.statusText;
    if (/ACCOUNT_NOT_LINKED/.test(JSON.stringify(j))) throw new Error('Google Health 账号还没有关联 Fitbit：请先在手机上的 Google Health app 登录并完成迁移');
    throw new Error(`API ${r.status}：${msg}`);
  }
  const rec = { t: Date.now(), v: j };
  mem.set(key, rec);
  try { localStorage.setItem(key, JSON.stringify(rec)); } catch {}
  return j;
}

async function list(type, filter, { pageSize, maxPages = 6 } = {}) {
  const out = [];
  let token = '';
  for (let i = 0; i < maxPages; i++) {
    const p = new URLSearchParams();
    if (filter) p.set('filter', filter);
    if (pageSize) p.set('pageSize', pageSize);
    if (token) p.set('pageToken', token);
    const j = await call(`dataTypes/${type}/dataPoints?${p}`);
    out.push(...(j.dataPoints || []));
    token = j.nextPageToken;
    if (!token) break;
  }
  return out;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateObj = (d) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
const fromDate = (o) => `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`;
export const secs = (s) => (s == null ? 0 : parseFloat(String(s).replace('s', '')) || 0);
export const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

// ---------- Sleep ----------
export function normSleep(dp) {
  const s = dp.sleep;
  const byStage = {};
  for (const st of s.summary?.stagesSummary || []) byStage[st.type] = +st.minutes || 0;
  return {
    id: dp.name,
    start: new Date(s.interval.startTime),
    end: new Date(s.interval.endTime),
    main: !!s.metadata?.mainSleep,
    nap: !!s.metadata?.nap,
    hasStages: (s.stages || []).some((x) => ['DEEP', 'REM', 'LIGHT'].includes(x.type)),
    stages: (s.stages || []).map((x) => ({ type: x.type, start: new Date(x.startTime), end: new Date(x.endTime) }))
      .sort((a, b) => a.start - b.start),
    asleep: +s.summary?.minutesAsleep || 0,
    awake: +s.summary?.minutesAwake || 0,
    inBed: +s.summary?.minutesInSleepPeriod || 0,
    toFallAsleep: +s.summary?.minutesToFallAsleep || 0,
    byStage,
    awakenings: (s.stages || []).filter((x) => x.type === 'AWAKE').length,
  };
}

export async function getSleeps(days = 14) {
  const since = daysAgo(days);
  const pts = await list('sleep', `sleep.interval.civil_end_time >= "${ymd(since)}"`, { pageSize: 25 });
  return pts.filter((p) => p.sleep).map(normSleep).sort((a, b) => b.end - a.end);
}

// ---------- Exercise ----------
export function normExercise(dp) {
  const e = dp.exercise;
  const m = e.metricsSummary || {};
  const z = m.heartRateZoneDurations || {};
  return {
    id: dp.name,
    type: e.exerciseType,
    name: e.displayName,
    start: new Date(e.interval.startTime),
    end: new Date(e.interval.endTime),
    activeSec: secs(e.activeDuration) || (new Date(e.interval.endTime) - new Date(e.interval.startTime)) / 1000,
    kcal: m.caloriesKcal ?? null,
    avgHr: m.averageHeartRateBeatsPerMinute ? +m.averageHeartRateBeatsPerMinute : null,
    distanceM: m.distanceMillimeters ? m.distanceMillimeters / 1000 : null,
    steps: m.steps ? +m.steps : null,
    azm: m.activeZoneMinutes ? +m.activeZoneMinutes : null,
    zones: { light: secs(z.lightTime), moderate: secs(z.moderateTime), vigorous: secs(z.vigorousTime), peak: secs(z.peakTime) },
    manual: dp.dataSource?.recordingMethod === 'MANUAL',
    gps: !!e.exerciseMetadata?.hasGps,
  };
}

export async function getExercises(days = 30) {
  const pts = await list('exercise', `exercise.interval.civil_start_time >= "${ymd(daysAgo(days))}"`, { pageSize: 25, maxPages: 8 });
  return pts.filter((p) => p.exercise).map(normExercise).sort((a, b) => b.start - a.start);
}

// ---------- Heart ----------
export async function getRestingHr(days = 30) {
  const pts = await list('daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${ymd(daysAgo(days))}"`, { pageSize: 100 });
  return pts.filter((p) => p.dailyRestingHeartRate)
    .map((p) => ({ date: fromDate(p.dailyRestingHeartRate.date), v: +p.dailyRestingHeartRate.beatsPerMinute }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getHrv(days = 30) {
  const pts = await list('daily-heart-rate-variability', `daily_heart_rate_variability.date >= "${ymd(daysAgo(days))}"`, { pageSize: 100 });
  return pts.filter((p) => p.dailyHeartRateVariability)
    .map((p) => ({ date: fromDate(p.dailyHeartRateVariability.date), v: p.dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds }))
    .filter((x) => x.v != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Heart rate rolled up into windows (avg/min/max) between two instants.
export async function getHrSeries(start, end, windowSec = 300) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const j = await call('dataTypes/heart-rate/dataPoints:rollUp', {
      method: 'POST',
      body: { range: { startTime: start.toISOString(), endTime: end.toISOString() }, windowSize: `${windowSec}s`, pageSize: 2000, ...(pageToken ? { pageToken } : {}) },
    });
    for (const r of j.rollupDataPoints || []) {
      if (!r.heartRate || r.heartRate.beatsPerMinuteAvg == null) continue;
      out.push({ t: new Date(r.startTime), v: r.heartRate.beatsPerMinuteAvg, lo: r.heartRate.beatsPerMinuteMin, hi: r.heartRate.beatsPerMinuteMax });
    }
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------- Steps ----------
export async function getDailySteps(days = 14) {
  const start = daysAgo(days - 1);
  const end = daysAgo(-1);
  const j = await call('dataTypes/steps/dataPoints:dailyRollUp', {
    method: 'POST',
    body: { range: { start: { date: dateObj(start) }, end: { date: dateObj(end) } }, windowSizeDays: 1 },
  });
  return (j.rollupDataPoints || [])
    .map((r) => ({ date: fromDate(r.civilStartTime.date), v: +(r.steps?.countSum || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export { ymd };
