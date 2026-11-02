// Backup of the training log to the user's own Google Drive.
// Scope drive.file: the app can only see the one file it created, nothing else in Drive.
import { accessToken, hasScope } from './auth.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const NAME = '我的健康 训练记录备份.json';
const K = 'drive-backup';

const LS = {
  get() { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(K, JSON.stringify(v)); } catch {} },
};
// { on, at (last backup ms), err, fileId }
export const status = () => ({ on: false, at: 0, err: '', fileId: null, ...LS.get() });
const update = (patch) => LS.set({ ...status(), ...patch });
export const setOn = (on) => update({ on, err: '' });
export const granted = () => hasScope(SCOPE);

async function req(url, opts = {}) {
  const tok = await accessToken();
  let r;
  try { r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tok, ...(opts.headers || {}) } }); } catch { throw new Error('没有网络'); }
  if (r.ok || r.status === 404) return r;
  const j = await r.json().catch(() => ({}));
  const raw = JSON.stringify(j);
  if (r.status === 401) throw new Error('NOT_SIGNED_IN');
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used/.test(raw)) throw new Error('Google Cloud 项目里还没启用 Google Drive API');
  if (r.status === 403 && /insufficient|scope/i.test(raw)) throw new Error('需要重新授权 Google Drive');
  throw new Error(`Google Drive ${r.status}：${j.error?.message || r.statusText}`);
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

export async function backup(training) {
  const body = JSON.stringify({ app: 'open-fitbit', kind: 'training-log', savedAt: Date.now(), training });
  try {
    let id = await findFile();
    if (id) {
      const r = await req(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status === 404) id = null; // deleted in Drive: make a new one
    }
    if (!id) id = await create(body);
    update({ fileId: id, at: Date.now(), err: '' });
  } catch (e) {
    update({ err: e.message === 'NOT_SIGNED_IN' ? '登录过期，重新连接后会继续备份' : e.message });
    throw e;
  }
}

// The saved training log, or null when there is no backup yet.
export async function restore() {
  update({ fileId: null });
  const id = await findFile();
  if (!id) return null;
  const r = await req(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  if (r.status === 404) return null;
  const j = await r.json().catch(() => null);
  return j?.training || null;
}

// Back up a few seconds after the last change (several edits in a row → one upload).
let timer = null;
export function backupSoon(getTraining, delay = 4000) {
  if (!status().on || !granted()) return;
  clearTimeout(timer);
  timer = setTimeout(() => backup(getTraining()).catch((e) => console.warn('backup', e)), delay);
}
