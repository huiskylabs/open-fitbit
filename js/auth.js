// Google OAuth 2.0 (authorization code + PKCE) done entirely in the browser.
// The client ID/secret are typed in on the phone and live only in this device's storage.
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
];
// training-log backup; this scope only reaches files the app itself created
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Google Health refuses any access token that also carries a scope from outside Google Health
// (403 DISALLOWED_OAUTH_SCOPES). So each access token is made for one use:
//   health: only the Google Health scopes        drive: only drive.file
// One sign-in can grant both: each refresh then asks for just one use's scopes (`scope` param,
// a subset of the grant). If Google still hands back a Health token with Drive in it, the app
// switches to separate sign-ins for Fitbit and Drive ('auth-split') and asks to reconnect once.
const USES = { health: HEALTH_SCOPES, drive: [DRIVE_SCOPE] };
const HEALTH_PREFIX = 'https://www.googleapis.com/auth/googlehealth.';
const words = (scope) => (scope || '').split(/\s+/).filter(Boolean);
const has = (scope, s) => words(scope).includes(s);
const healthOnly = (scope) => words(scope).length > 0 && words(scope).every((s) => s.startsWith(HEALTH_PREFIX));
const live = (a) => !!a?.token && Date.now() < a.exp;
const expiry = (j) => Date.now() + ((+j.expires_in || 3600) - 60) * 1000;

export function redirectUri() {
  // Exactly this string must be listed under "Authorized redirect URIs" in Google Cloud.
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export const getConfig = () => LS.get('cfg') || {};
export const setConfig = (cfg) => LS.set('cfg', cfg);
export const isConfigured = () => { const c = getConfig(); return !!(c.clientId && c.clientSecret); };

// A stored sign-in:
//   'tok'        the Fitbit sign-in (covers backup too when Drive was allowed on the same screen)
//   'tok-drive'  a sign-in for backup only
// { refresh_token, scope, obtained_at, access: { health?: {token, exp}, drive?: {token, exp} }, split?, mixed? }
function grant(name) {
  const g = LS.get(name);
  if (!g || g.access) return g;
  // saved by v2.1 or earlier: one access token for everything
  const a = { token: g.access_token, exp: g.expires_at || 0 };
  const out = { refresh_token: g.refresh_token, scope: g.scope || '', obtained_at: g.obtained_at || Date.now(), access: {} };
  if (healthOnly(out.scope)) out.access.health = a;
  if (has(out.scope, DRIVE_SCOPE)) out.access.drive = a;
  LS.set(name, out);
  return out;
}

export const isSignedIn = () => { const t = grant('tok'); return !!(t && (t.refresh_token || live(t.access.health))); };
export const tokenInfo = () => grant('tok');
export const signOut = () => { LS.del('tok'); LS.del('tok-drive'); LS.del('pkce'); };

function driveGrant() {
  const d = grant('tok-drive');
  if (d && (d.refresh_token || live(d.access.drive))) return 'tok-drive';
  const t = grant('tok');
  if (t && has(t.scope, DRIVE_SCOPE) && (t.refresh_token || live(t.access.drive))) return 'tok';
  return null;
}
export const driveGranted = () => !!driveGrant();

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// kind 'health': connect Fitbit (and allow backup on the same screen, unless sign-ins are split)
// kind 'drive': allow backup only
export async function startLogin(kind = 'health') {
  const { clientId } = getConfig();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const split = !!LS.get('auth-split');
  const scope = (kind === 'drive' ? [DRIVE_SCOPE] : split ? HEALTH_SCOPES : [...HEALTH_SCOPES, DRIVE_SCOPE]).join(' ');
  // localStorage (not sessionStorage): on iOS the redirect can come back in a fresh page context.
  LS.set('pkce', { verifier, state, kind, split, scope });
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    // No include_granted_scopes: the token covers exactly these scopes, not everything allowed before.
    scope,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch { throw Object.assign(new Error('连不上 Google，稍后再试'), { code: 'net' }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`登录失败：${j.error_description || j.error || r.status}`), { code: j.error || String(r.status) });
  return j;
}

// Returns 'health' or 'drive' if the URL was an OAuth redirect that we handled, else false.
// Also accepts a pasted URL (fallback when iOS returns to Safari instead of the home-screen app).
export async function handleRedirect(urlString = location.href) {
  let url;
  try { url = new URL(urlString); } catch { throw new Error('请粘贴完整的网址'); }
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (!code && !err) return false;
  if (urlString === location.href) history.replaceState(null, '', redirectUri());
  if (err) throw new Error(`Google 返回错误：${err}`);
  const pk = LS.get('pkce') || {};
  if (pk.state && url.searchParams.get('state') && pk.state !== url.searchParams.get('state')) {
    throw new Error('登录状态不匹配，请重新登录');
  }
  const j = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    ...(pk.verifier ? { code_verifier: pk.verifier } : {}),
  });
  LS.del('pkce');
  const scope = j.scope || pk.scope || '';
  const kind = pk.kind || (words(scope).some((s) => s.startsWith(HEALTH_PREFIX)) ? 'health' : 'drive');
  const g = { refresh_token: j.refresh_token, scope, obtained_at: Date.now(), access: {}, ...(pk.split ? { split: true } : {}) };
  // the token that came with the code serves only a use it fits exactly
  if (healthOnly(scope)) g.access.health = { token: j.access_token, exp: expiry(j) };
  if (has(scope, DRIVE_SCOPE)) g.access.drive = { token: j.access_token, exp: expiry(j) };
  if (kind === 'drive') LS.set('tok-drive', g);
  else {
    LS.set('tok', g);
    if (has(scope, DRIVE_SCOPE)) LS.del('tok-drive'); // this sign-in covers backup as well
  }
  return kind;
}

// The Fitbit sign-in can't give a Health-only token. Keep it for backup, and ask for a Fitbit-only sign-in.
// 'REVOKE': it already was a Fitbit-only sign-in, so Google is adding scopes allowed earlier;
// removing the app's access in the Google account clears them.
function notHealthOnly() {
  const t = grant('tok');
  if (!t) return 'NOT_SIGNED_IN';
  if (!t.split) {
    LS.set('auth-split', true);
    if (has(t.scope, DRIVE_SCOPE) && !LS.get('tok-drive')) LS.set('tok-drive', { ...t, access: { drive: t.access.drive } });
  }
  LS.set('tok', { ...t, mixed: true, access: {} });
  return t.split ? 'REVOKE' : 'RECONNECT';
}

// Google Health answered 403 DISALLOWED_OAUTH_SCOPES. Returns the error code for the app to show.
export const healthRefused = () => notHealthOnly();

// Drop a cached access token that Google no longer takes; the next call gets a fresh one.
export function forget(use) {
  for (const name of ['tok', 'tok-drive']) {
    const g = grant(name);
    if (g?.access[use]) { delete g.access[use]; LS.set(name, g); }
  }
}

async function mint(name, use) {
  const g = grant(name);
  const ask = USES[use].filter((s) => !g.scope || has(g.scope, s)).join(' ');
  const refresh = (scope) => tokenRequest({ grant_type: 'refresh_token', refresh_token: g.refresh_token, ...(scope ? { scope } : {}) });
  let j, asked = ask;
  try {
    try { j = await refresh(ask); } catch (e) {
      // Google didn't take the narrower scope: get the full set (a Health token then turns out mixed, see below)
      if (!ask || !['invalid_scope', 'invalid_request'].includes(e.code)) throw e;
      asked = '';
      j = await refresh();
    }
  } catch (e) {
    if (e.code === 'invalid_grant') { // expired (testing mode: 7 days) or access removed in the Google account
      if (grant(name)?.refresh_token === g.refresh_token) LS.del(name);
      throw new Error(name === 'tok' ? 'NOT_SIGNED_IN' : 'DRIVE_EXPIRED');
    }
    throw e; // offline, or a wrong secret: keep the sign-in and try again later
  }
  if (use === 'health' && !healthOnly(j.scope || asked || g.scope)) throw new Error(notHealthOnly());
  const cur = grant(name);
  if (cur?.refresh_token === g.refresh_token) { cur.access[use] = { token: j.access_token, exp: expiry(j) }; LS.set(name, cur); }
  return j.access_token;
}

const pending = {};
// An access token for one use: 'health' (Google Health API) or 'drive' (backup).
export async function accessToken(use = 'health') {
  const name = use === 'drive' ? driveGrant() : grant('tok') ? 'tok' : null;
  if (!name) throw new Error(use === 'drive' ? 'DRIVE_EXPIRED' : 'NOT_SIGNED_IN');
  const g = grant(name);
  if (use === 'health' && g.mixed) throw new Error(g.split ? 'REVOKE' : 'RECONNECT');
  if (live(g.access[use])) return g.access[use].token;
  if (!g.refresh_token) throw new Error(use === 'drive' ? 'DRIVE_EXPIRED' : 'NOT_SIGNED_IN');
  pending[use] ||= mint(name, use).finally(() => { pending[use] = null; });
  return pending[use];
}
