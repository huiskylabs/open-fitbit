// Keeps ~4 months of Google Health data on the phone (IndexedDB), refreshes only recent days,
// and derives what the pages draw: one main sleep per night, personal baselines, scores.
import * as api from './api.js';
import * as store from './store.js';
import { DAY, ymd, parseYmd, addDays, today, startOfDay, mean, baselineAt } from './util.js';
import { sleepScore, recoveryScore, zonesOrDefault } from './scores.js';

export const KEEP_DAYS = 120; // 91 days are shown; the extra month feeds the baselines
export const SHOW_DAYS = 91;

let source = api;
let prefix = '';
export function useSource(src, keyPrefix = '') { source = src; prefix = keyPrefix; mem.clear(); }

export const emptyModel = () => ({ v: 2, syncedAt: 0, fullAt: 0, sleeps: [], exercises: [], daily: {}, hrZones: null, devices: [], devicesAt: 0 });

export async function loadCached() {
  const m = await store.get(prefix + 'model');
  return m && m.v === 2 ? m : null;
}

export async function clearAll() {
  for (const k of await store.keys(prefix + 'hr:')) await store.del(k);
  for (const k of await store.keys(prefix + 'st:')) await store.del(k);
  await store.del(prefix + 'model');
  mem.clear();
}

const byId = (list) => { const seen = new Map(); for (const x of list) seen.set(x.id, x); return [...seen.values()]; };

export async function sync(model, { force = false } = {}) {
  const now = Date.now(), t0 = today();
  const full = force || !model || !model.fullAt || now - model.fullAt > 7 * DAY;
  const since = full ? addDays(t0, -KEEP_DAYS) : addDays(startOfDay(new Date(model.syncedAt)), -3);
  const end = addDays(t0, 1);
  const m = full ? emptyModel() : JSON.parse(JSON.stringify(model));
  if (!full) { m.devices ||= []; m.daily ||= {}; }
  // Only sleep and exercise are required; any other type may be missing on this device.
  const soft = (p) => p.catch((e) => { if (/^(NOT_SIGNED_IN|RECONNECT|REVOKE)$/.test(e.message)) throw e; console.warn(e); return null; });
  const [sleeps, exercises, steps, zones, hr, ranges, devices, ...dailies] = await Promise.all([
    source.getSleeps(since),
    source.getExercises(since),
    soft(source.getDailySteps(since, end)),
    soft(source.getDailyZones(since, end)),
    soft(source.getDailyHr(since, end)),
    soft(source.getPersonalRanges(since, end)),
    soft(source.getDevices()), // every time: its last-sync time says whether a just-finished workout can be here yet
    ...api.DAILY_KEYS.map((k) => soft(source.getDaily(k, since))),
  ]);
  const s0 = +since;
  m.sleeps = byId(m.sleeps.filter((s) => s.end < s0).concat(sleeps));
  m.exercises = byId(m.exercises.filter((e) => e.start < s0).concat(exercises));
  for (const recs of [steps, zones, hr, ranges, ...dailies]) {
    for (const r of recs || []) {
      const { date, hrZones, ...rest } = r;
      if (hrZones) { if (!m.hrZonesDate || date >= m.hrZonesDate) { m.hrZones = hrZones; m.hrZonesDate = date; } continue; }
      m.daily[date] = { ...(m.daily[date] || {}), ...rest };
    }
  }
  if (devices) { m.devices = devices; m.devicesAt = now; }
  // trim to the kept window
  const cut = +addDays(t0, -KEEP_DAYS - 1), cutDate = ymd(new Date(cut));
  m.sleeps = m.sleeps.filter((s) => s.end >= cut).sort((a, b) => a.start - b.start);
  m.exercises = m.exercises.filter((e) => e.start >= cut).sort((a, b) => a.start - b.start);
  for (const d of Object.keys(m.daily)) if (d < cutDate) delete m.daily[d];
  m.syncedAt = now;
  if (full) m.fullAt = now;
  await store.set(prefix + 'model', m);
  pruneCache();
  return m;
}

// ---------- derived view model ----------
// smallest SD used for each personal range, so a very steady month doesn't make a hair-trigger range
const BASE_KEYS = { rhr: 1.5, hrv: 3, nremHr: 1.5, resp: 0.4, spo2: 0.8, skinRel: 0.25 };

export function derive(m, { goalMin = 480 } = {}) {
  const t0 = today();
  const nights = {}, naps = {};
  for (const s of [...m.sleeps].sort((a, b) => a.start - b.start)) {
    const date = ymd(new Date(s.end));
    const candidate = s.main || (!s.nap && s.end - s.start >= 3 * 3600e3);
    if (!candidate) { (naps[date] ||= []).push(s); continue; }
    const cur = nights[date];
    if (!cur || (s.main && !cur.main) || (s.main === cur.main && s.asleep > cur.asleep)) {
      if (cur) (naps[date] ||= []).push(cur);
      nights[date] = s;
    } else (naps[date] ||= []).push(s);
  }
  const nightDates = Object.keys(nights).sort();
  const sleepScores = {};
  nightDates.forEach((d, i) => {
    const prev = nightDates.slice(Math.max(0, i - 7), i).map((x) => nights[x]);
    sleepScores[d] = sleepScore(nights[d], prev, goalMin);
  });

  // personal baselines (30 days before each day)
  const base = {};
  const firstShown = ymd(addDays(t0, -SHOW_DAYS - 7));
  for (const [k, minHalf] of Object.entries(BASE_KEYS)) {
    const vals = {};
    for (const [d, v] of Object.entries(m.daily)) if (v[k] != null) vals[d] = v[k];
    base[k] = {};
    for (let i = 0; i <= SHOW_DAYS + 7; i++) {
      const d = ymd(addDays(t0, -i));
      if (d < firstShown) break;
      let b = baselineAt(vals, d, { minHalf });
      const day = m.daily[d] || {};
      if (k === 'rhr' && day.rhrLo != null) b = { ...(b || {}), lo: day.rhrLo, hi: day.rhrHi, mean: b?.mean ?? (day.rhrLo + day.rhrHi) / 2, sd: b?.sd ?? (day.rhrHi - day.rhrLo) / 2 };
      if (k === 'hrv' && day.hrvLo != null) b = { ...(b || {}), lo: day.hrvLo, hi: day.hrvHi, mean: b?.mean ?? (day.hrvLo + day.hrvHi) / 2, sd: b?.sd ?? (day.hrvHi - day.hrvLo) / 2 };
      if (b) base[k][d] = b;
    }
  }

  const recovery = {};
  for (const d of new Set([...Object.keys(m.daily), ...nightDates])) {
    const r = recoveryScore(m.daily[d] || {}, Object.fromEntries(Object.keys(BASE_KEYS).map((k) => [k, base[k][d]])), sleepScores[d]);
    if (r) recovery[d] = r;
  }

  const stepVals = [];
  for (let i = 1; i <= 30; i++) { const v = m.daily[ymd(addDays(t0, -i))]?.steps; if (v != null) stepVals.push(v); }
  const latestRhr = Object.keys(m.daily).sort().reverse().map((d) => m.daily[d].rhr).find((v) => v != null);

  return {
    m, nights, naps, nightDates, sleepScores, base, recovery,
    daily: m.daily,
    stepsAvg: stepVals.length >= 5 ? mean(stepVals) : null,
    zones: zonesOrDefault(m.hrZones, latestRhr || 60),
    goalMin,
  };
}

// ---------- intraday series, fetched on demand and cached ----------
const mem = new Map();
const FRESH_MS = 5 * 60e3;

async function cached(kind, start, end, windowSec, fetcher) {
  const key = `${prefix}${kind}:${ymd(new Date(start))}:${windowSec}:${start}:${end}`;
  const settled = end < Date.now() - 6 * 3600e3; // past windows stop changing once the watch has uploaded them
  const hit = mem.get(key) || (await store.get(key));
  if (hit && (hit.settled || Date.now() - hit.t < FRESH_MS)) { mem.set(key, hit); return hit.v; }
  const v = await fetcher(start, Math.min(end, Date.now()), windowSec);
  const rec = { t: Date.now(), v, settled };
  mem.set(key, rec);
  store.set(key, rec);
  return v;
}

export const hrSeries = (start, end, windowSec = 300) => cached('hr', +start, +end, windowSec, (a, b, w) => source.getHrSeries(a, b, w));
export const stepsSeries = (start, end, windowSec = 60) => cached('st', +start, +end, windowSec, (a, b, w) => source.getStepsSeries(a, b, w));

// Steps you usually have by this time of day: the 14 days before today, midnight to now, from
// 15-minute counts (one request; past days never change, so it is cached).
export async function stepsUsualByNow(now = Date.now()) {
  const t0 = today(), from = addDays(t0, -14);
  const pts = await stepsSeries(+from, +t0, 900);
  const sinceMidnight = now - +t0;
  const byDay = new Map();
  for (const p of pts) {
    const day = +startOfDay(new Date(p.t)), cut = day + sinceMidnight;
    const part = p.t + 900e3 <= cut ? 1 : p.t < cut ? (cut - p.t) / 900e3 : 0;
    byDay.set(day, (byDay.get(day) || 0) + p.v * part);
  }
  const vals = [...byDay.values()];
  return vals.length >= 5 ? mean(vals) : null;
}

async function pruneCache() {
  const cut = ymd(addDays(today(), -21));
  for (const k of [...(await store.keys(prefix + 'hr:')), ...(await store.keys(prefix + 'st:'))]) {
    const d = String(k).slice(prefix.length).split(':')[1];
    if (d && d < cut) { store.del(k); mem.delete(k); }
  }
}

export const dateOf = (t) => ymd(new Date(t));
export { parseYmd };
