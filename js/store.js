// Tiny IndexedDB key-value store (falls back to memory when IndexedDB is unavailable).
// Holds the synced health data and the training log on this phone.
const DB = 'my-health', STORE = 'kv';
let dbp = null;
const memory = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}

const unwrap = (out) => (out && typeof out === 'object' && 'result' in out ? out.result : out);

function tx(mode, fn) {
  return open().then((db) => new Promise((res) => {
    if (!db) { res(unwrap(fn(null))); return; }
    try {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(unwrap(out));
      t.onerror = () => res(undefined);
      t.onabort = () => res(undefined);
    } catch { res(unwrap(fn(null))); }
  }));
}

export async function get(key) {
  const v = await tx('readonly', (st) => (st ? st.get(key) : { result: memory.get(key) }));
  return v === undefined ? memory.get(key) : v;
}

export async function set(key, value) {
  memory.set(key, value);
  await tx('readwrite', (st) => st && st.put(value, key));
}

export async function del(key) {
  memory.delete(key);
  await tx('readwrite', (st) => st && st.delete(key));
}

export async function keys(prefix = '') {
  const all = await tx('readonly', (st) => (st ? st.getAllKeys() : { result: [...memory.keys()] }));
  return (all || []).filter((k) => String(k).startsWith(prefix));
}

// Ask iOS not to evict this app's storage (home-screen apps are usually exempt anyway).
export function persist() { try { navigator.storage?.persist?.(); } catch {} }
