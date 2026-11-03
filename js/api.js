// Google Health API v4 client and normalization into the small records the app stores.
import { accessToken, forget, healthRefused } from './auth.js';
import { ymd, dateObj, fromDateObj, secs, addDays, limiter } from './util.js';

const BASE = 'https://health.googleapis.com/v4/users/me/';
const run = limiter(3);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(path, { method = 'GET', body } = {}, attempt = 0, renewed = false) {
  const tok = await accessToken('health');
  const r = await run(() => fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  if ((r.status === 429 || r.status >= 500) && attempt < 3) { await wait(800 * 2 ** attempt); return call(path, { method, body }, attempt + 1, renewed); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const raw = JSON.stringify(j);
    if (/ACCOUNT_NOT_LINKED/.test(raw)) throw new ApiError('Google Health 账号还没有关联 Fitbit：先在手机上的 Google Health app 里登录并完成迁移', r.status);
    // the token carries a scope from outside Google Health (e.g. Drive): needs a Fitbit-only sign-in
    if (r.status === 403 && /DISALLOWED_OAUTH_SCOPES|disallowed OAuth scope/i.test(raw)) throw new ApiError(healthRefused(), 403);
    if (r.status === 401) {
      if (!renewed) { forget('health'); return call(path, { method, body }, attempt, true); }
      throw new ApiError('RECONNECT', 401);
    }
    throw new ApiError(`API ${r.status}：${j.error?.message || r.statusText}`, r.status);
  }
  return j;
}

async function list(type, filter, { pageSize = 1000, maxPages = 10 } = {}) {
  const out = [];
  let token = '';
  for (let i = 0; i < maxPages; i++) {
    const p = new URLSearchParams();
    if (filter) p.set('filter', filter);
    p.set('pageSize', pageSize);
    if (token) p.set('pageToken', token);
    const j = await call(`dataTypes/${type}/dataPoints?${p}`);
    out.push(...(j.dataPoints || []));
    token = j.nextPageToken;
    if (!token) break;
  }
  return out;
}

// ---------- sleep ----------
const ms = (s) => +new Date(s);
export function normSleep(dp) {
  const s = dp.sleep;
  const byStage = {};
  for (const st of s.summary?.stagesSummary || []) byStage[st.type] = (byStage[st.type] || 0) + (+st.minutes || 0);
  const stages = (s.stages || []).map((x) => ({ type: x.type, s: ms(x.startTime), e: ms(x.endTime) })).sort((a, b) => a.s - b.s);
  return {
    id: dp.name || `sleep-${s.interval.startTime}`,
    start: ms(s.interval.startTime),
    end: ms(s.interval.endTime),
    main: !!s.metadata?.mainSleep,
    nap: !!s.metadata?.nap,
    hasStages: stages.some((x) => ['DEEP', 'REM', 'LIGHT'].includes(x.type)),
    stages,
    short: (s.shortAwakenings || []).map((x) => ({ s: ms(x.startTime), e: ms(x.endTime) })),
    outOfBed: (s.outOfBedSegments || []).map((x) => ({ s: ms(x.startTime), e: ms(x.endTime) })),
    asleep: +s.summary?.minutesAsleep || 0,
    awake: +s.summary?.minutesAwake || 0,
    inBed: +s.summary?.minutesInSleepPeriod || Math.round((ms(s.interval.endTime) - ms(s.interval.startTime)) / 60e3),
    toFallAsleep: +s.summary?.minutesToFallAsleep || 0,
    byStage,
  };
}

export async function getSleeps(since) {
  const pts = await list('sleep', `sleep.interval.civil_end_time >= "${ymd(since)}"`, { pageSize: 25, maxPages: 12 });
  return pts.filter((p) => p.sleep).map(normSleep);
}

// ---------- exercise ----------
const STRENGTH = new Set(['WEIGHTLIFTING', 'STRENGTH_TRAINING', 'FREE_WEIGHTS', 'FUNCTIONAL_STRENGTH_TRAINING', 'WEIGHTS', 'WEIGHT_MACHINES', 'POWERLIFTING', 'CALISTHENICS', 'BODY_WEIGHT', 'CORE_TRAINING', 'CIRCUIT_TRAINING', 'CROSSFIT', 'TRX', 'RESISTANCE_BANDS']);
export const kindOf = (type) => (STRENGTH.has(type) ? 'strength' : type === 'BASKETBALL' ? 'basketball' : 'other');

export function normExercise(dp) {
  const e = dp.exercise;
  const m = e.metricsSummary || {};
  const z = m.heartRateZoneDurations || {};
  const start = ms(e.interval.startTime), end = ms(e.interval.endTime);
  return {
    id: dp.name || `ex-${e.interval.startTime}`,
    type: e.exerciseType,
    kind: kindOf(e.exerciseType),
    name: e.displayName || '',
    start, end,
    activeSec: secs(e.activeDuration) || (end - start) / 1000,
    kcal: m.caloriesKcal != null ? +m.caloriesKcal : null,
    avgHr: m.averageHeartRateBeatsPerMinute ? +m.averageHeartRateBeatsPerMinute : null,
    steps: m.steps ? +m.steps : null,
    azm: m.activeZoneMinutes ? +m.activeZoneMinutes : null,
    zones: { light: secs(z.lightTime), moderate: secs(z.moderateTime), vigorous: secs(z.vigorousTime), peak: secs(z.peakTime) },
    manual: dp.dataSource?.recordingMethod === 'MANUAL',
  };
}

export async function getExercises(since) {
  const pts = await list('exercise', `exercise.interval.civil_start_time >= "${ymd(since)}"`, { pageSize: 25, maxPages: 16 });
  return pts.filter((p) => p.exercise).map(normExercise);
}

// ---------- daily summaries (one value per day) ----------
const num = (x) => (x == null ? null : +x);
const DAILY = {
  rhr: ['daily-resting-heart-rate', 'dailyRestingHeartRate', (x) => ({ rhr: num(x.beatsPerMinute) })],
  hrv: ['daily-heart-rate-variability', 'dailyHeartRateVariability', (x) => ({ hrv: num(x.averageHeartRateVariabilityMilliseconds), nremHr: num(x.nonRemHeartRateBeatsPerMinute) })],
  resp: ['daily-respiratory-rate', 'dailyRespiratoryRate', (x) => ({ resp: num(x.breathsPerMinute) })],
  spo2: ['daily-oxygen-saturation', 'dailyOxygenSaturation', (x) => ({ spo2: num(x.averagePercentage) })],
  temp: ['daily-sleep-temperature-derivations', 'dailySleepTemperatureDerivations', (x) => ({
    skinRel: x.baselineTemperatureCelsius != null && x.nightlyTemperatureCelsius != null ? x.nightlyTemperatureCelsius - x.baselineTemperatureCelsius : null,
    skinSd: num(x.relativeNightlyStddev30dCelsius),
  })],
  vo2: ['daily-vo2-max', 'dailyVo2Max', (x) => ({ vo2: num(x.vo2Max), vo2Level: x.cardioFitnessLevel || null })],
  zones: ['daily-heart-rate-zones', 'dailyHeartRateZones', (x) => ({
    hrZones: Object.fromEntries((x.heartRateZones || []).map((z) => [z.heartRateZoneType, [num(z.minBeatsPerMinute), num(z.maxBeatsPerMinute)]])),
  })],
};
export const DAILY_KEYS = Object.keys(DAILY);

export async function getDaily(key, since) {
  const [type, field, map] = DAILY[key];
  const snake = type.replace(/-/g, '_');
  const pts = await list(type, `${snake}.date >= "${ymd(since)}"`, { pageSize: 1000, maxPages: 3 });
  return pts.filter((p) => p[field]?.date).map((p) => ({ date: fromDateObj(p[field].date), ...map(p[field]) }));
}

// ---------- daily rollups (civil days) ----------
async function dailyRollUp(type, start, endExclusive, chunkDays) {
  const jobs = [];
  for (let s = start; s < endExclusive; s = addDays(s, chunkDays)) {
    const e = new Date(Math.min(+addDays(s, chunkDays), +endExclusive));
    jobs.push(call(`dataTypes/${type}/dataPoints:dailyRollUp`, {
      method: 'POST',
      body: { range: { start: { date: dateObj(s) }, end: { date: dateObj(e) } }, windowSizeDays: 1, pageSize: chunkDays },
    }).then((j) => j.rollupDataPoints || []));
  }
  return (await Promise.all(jobs)).flat().filter((r) => r.civilStartTime?.date);
}
const rdate = (r) => fromDateObj(r.civilStartTime.date);

export async function getDailySteps(start, endExclusive) {
  const rs = await dailyRollUp('steps', start, endExclusive, 90);
  return rs.map((r) => ({ date: rdate(r), steps: +(r.steps?.countSum || 0) }));
}

export async function getDailyZones(start, endExclusive) {
  const rs = await dailyRollUp('time-in-heart-rate-zone', start, endExclusive, 90);
  return rs.map((r) => {
    const z = { light: 0, moderate: 0, vigorous: 0, peak: 0 };
    for (const v of r.timeInHeartRateZone?.timeInHeartRateZones || []) {
      const k = { LIGHT: 'light', MODERATE: 'moderate', VIGOROUS: 'vigorous', PEAK: 'peak' }[v.heartRateZone];
      if (k) z[k] += secs(v.duration);
    }
    return { date: rdate(r), zoneSec: z };
  });
}

export async function getDailyHr(start, endExclusive) {
  const rs = await dailyRollUp('heart-rate', start, endExclusive, 14);
  return rs.filter((r) => r.heartRate?.beatsPerMinuteAvg != null).map((r) => ({
    date: rdate(r), hrAvg: r.heartRate.beatsPerMinuteAvg, hrMin: r.heartRate.beatsPerMinuteMin, hrMax: r.heartRate.beatsPerMinuteMax,
  }));
}

// Google's own personal ranges for resting HR and HRV (if the API returns them).
export async function getPersonalRanges(start, endExclusive) {
  const [rhr, hrv] = await Promise.all([
    dailyRollUp('daily-resting-heart-rate', start, endExclusive, 90).catch(() => []),
    dailyRollUp('daily-heart-rate-variability', start, endExclusive, 90).catch(() => []),
  ]);
  const out = [];
  for (const r of rhr) { const p = r.restingHeartRatePersonalRange; if (p?.beatsPerMinuteMin != null) out.push({ date: rdate(r), rhrLo: p.beatsPerMinuteMin, rhrHi: p.beatsPerMinuteMax }); }
  for (const r of hrv) { const p = r.heartRateVariabilityPersonalRange; if (p?.averageHeartRateVariabilityMillisecondsMin != null) out.push({ date: rdate(r), hrvLo: p.averageHeartRateVariabilityMillisecondsMin, hrvHi: p.averageHeartRateVariabilityMillisecondsMax }); }
  return out;
}

// ---------- intraday rollups (physical time windows) ----------
async function rollUp(type, start, end, windowSec) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 6; i++) {
    const j = await call(`dataTypes/${type}/dataPoints:rollUp`, {
      method: 'POST',
      body: { range: { startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() }, windowSize: `${windowSec}s`, pageSize: 10000, ...(pageToken ? { pageToken } : {}) },
    });
    out.push(...(j.rollupDataPoints || []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// [{t (ms), v, lo, hi}] sorted by time
export async function getHrSeries(start, end, windowSec = 300) {
  const rs = await rollUp('heart-rate', start, end, windowSec);
  return rs.filter((r) => r.heartRate?.beatsPerMinuteAvg != null)
    .map((r) => ({ t: ms(r.startTime), v: r.heartRate.beatsPerMinuteAvg, lo: r.heartRate.beatsPerMinuteMin, hi: r.heartRate.beatsPerMinuteMax }))
    .sort((a, b) => a.t - b.t);
}

export async function getStepsSeries(start, end, windowSec = 60) {
  const rs = await rollUp('steps', start, end, windowSec);
  return rs.map((r) => ({ t: ms(r.startTime), v: +(r.steps?.countSum || 0) })).sort((a, b) => a.t - b.t);
}

// ---------- devices ----------
export async function getDevices() {
  const j = await call('pairedDevices?pageSize=20');
  return (j.pairedDevices || []).map((d) => ({
    name: d.deviceVersion || '设备', type: d.deviceType, battery: d.batteryLevel ?? null, batteryStatus: d.batteryStatus || null,
    lastSync: d.lastSyncTime ? ms(d.lastSyncTime) : null,
  }));
}
