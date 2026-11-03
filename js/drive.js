// Backup of the training log to the user's own Google Drive. Always on once signed in.
// Scope drive.file: the app can only see the one file it created, nothing else in Drive.
import { accessToken, driveGranted, forget, getConfig } from './auth.js';

const NAME = '我的健康 训练记录备份.json';
const K = 'drive-backup';

const LS = {
  get() { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(K, JSON.stringify(v)); } catch {} },
};
// { at (last backup ms), err, kind: '' | 'disabled' | 'scope' | 'auth' | 'net' | 'other', link, fileId }
export const status = () => ({ at: 0, err: '', kind: '', link: '', fileId: null, ...LS.get() });
const update = (patch) => LS.set({ ...status(), ...patch });
export const granted = () => driveGranted();
// Does backup need the user to allow Drive? '' no, 'first' not yet, 'again' it worked before and has to be allowed again
export function ask() {
  const { at, kind } = status();
  const lost = kind === 'auth' || kind === 'scope';
  if (!granted()) return at || lost ? 'again' : 'first';
  return lost ? 'again' : '';
}
// the log changed after the last backup
export const behind = (training) => (training?.sessions?.length || 0) > 0 && (training.updatedAt || 0) > status().at;

// Where to turn the Drive API on for the Cloud project this app's OAuth client belongs to.
// The client ID starts with the project number.
function enableLink() {
  const n = (getConfig().clientId || '').split('-')[0];
  return /^\d+$/.test(n)
    ? `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${n}`
    : 'https://console.cloud.google.com/apis/library/drive.googleapis.com';
}

const fail = (msg, kind, link = '') => Object.assign(new Error(msg), { kind, link });

const EXPIRED = 'Google Drive 的授权过期了，重新授权后继续备份';

async function req(url, opts = {}, renewed = false) {
  let tok;
  try { tok = await accessToken('drive'); } catch (e) {
    if (e.code === 'net') throw fail('没有网络，稍后自动再备份', 'net');
    throw /^(DRIVE_EXPIRED|NOT_SIGNED_IN)$/.test(e.message) ? fail(EXPIRED, 'auth') : fail(e.message, 'other');
  }
  let r;
  try { r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tok, ...(opts.headers || {}) } }); } catch { throw fail('没有网络，稍后自动再备份', 'net'); }
  if (r.ok || r.status === 404) return r;
  const j = await r.json().catch(() => ({}));
  const raw = JSON.stringify(j);
  if (r.status === 401) {
    if (!renewed) { forget('drive'); return req(url, opts, true); }
    throw fail(EXPIRED, 'auth');
  }
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used|it is disabled/.test(raw)) {
    const link = (j.error?.details || []).map((d) => d?.metadata?.activationUrl).find(Boolean)
      || (raw.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/drive\.googleapis\.com\/overview\?project=[\w-]+/) || [])[0]
      || enableLink();
    throw fail('Google Cloud 项目里还没启用 Google Drive API', 'disabled', link);
  }
  if (r.status === 403 && /insufficient|scope/i.test(raw)) throw fail('需要再授权一次 Google Drive', 'scope');
  throw fail(`Google Drive ${r.status}：${j.error?.message || r.statusText}`, 'other');
}

// run a Drive call and remember how it went (the banner and settings read it)
async function track(fn) {
  try {
    const out = await fn();
    update({ err: '', kind: '', link: '' });
    return out;
  } catch (e) {
    update({ err: e.message, kind: e.kind || 'other', link: e.link || '' });
    throw e;
  }
}

async function findFile() {
  const known = status().fileId;
  if (known) return known;
  const q = encodeURIComponent(`name = '${NAME}' and trashed = false`);
  const r = await req(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`);
  const j = await r.json().catch(() => ({}));
  const id = j.files?.[0]?.id || null;
  if (id) update({ fileId: id });
  return id;
}

async function create(body) {
  const b = 'b' + Math.random().toString(36).slice(2);
  const meta = { name: NAME, mimeType: 'application/json' };
  const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
  const r = await req('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: multipart,
  });
  return (await r.json()).id;
}

export function backup(training) {
  return track(async () => {
    const body = JSON.stringify({ app: 'open-fitbit', kind: 'training-log', savedAt: Date.now(), training });
    let id = await findFile();
    if (id) {
      const r = await req(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status === 404) id = null; // deleted in Drive: make a new one
    }
    if (!id) id = await create(body);
    update({ fileId: id, at: Date.now() });
  });
}

// The saved training log, or null when there is no backup yet.
export function restore() {
  return track(async () => {
    update({ fileId: null });
    const id = await findFile();
    if (!id) return null;
    const r = await req(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    if (r.status === 404) return null;
    const j = await r.json().catch(() => null);
    return j?.training || null;
  });
}

// Back up a few seconds after the last change (several edits in a row → one upload).
let timer = null;
export function backupSoon(getTraining, delay = 4000, done) {
  if (!granted()) return;
  clearTimeout(timer);
  timer = setTimeout(() => backup(getTraining()).catch((e) => console.warn('backup', e)).finally(() => done?.()), delay);
}
