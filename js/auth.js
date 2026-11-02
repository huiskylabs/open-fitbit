// Google OAuth 2.0 (authorization code + PKCE) done entirely in the browser.
// The client ID/secret are typed in on the phone and live only in this device's storage.
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  // training-log backup; this scope only reaches files the app itself created
  'https://www.googleapis.com/auth/drive.file',
];

export function redirectUri() {
  // Exactly this string must be listed under "Authorized redirect URIs" in Google Cloud.
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export const getConfig = () => LS.get('cfg') || {};
export const setConfig = (cfg) => LS.set('cfg', cfg);
export const isConfigured = () => { const c = getConfig(); return !!(c.clientId && c.clientSecret); };
export const isSignedIn = () => !!(LS.get('tok') || {}).refresh_token || !!(LS.get('tok') || {}).access_token;
export const signOut = () => LS.del('tok');
export const tokenInfo = () => LS.get('tok');

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startLogin({ extraScopes = [] } = {}) {
  const { clientId } = getConfig();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  // localStorage (not sessionStorage): on iOS the redirect can come back in a fresh page context.
  LS.set('pkce', { verifier, state });
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: [...SCOPES, ...extraScopes].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`登录失败：${j.error_description || j.error || r.status}`);
  return j;
}

function saveTokens(j) {
  const old = LS.get('tok') || {};
  LS.set('tok', {
    access_token: j.access_token,
    refresh_token: j.refresh_token || old.refresh_token,
    expires_at: Date.now() + (j.expires_in - 60) * 1000,
    obtained_at: j.refresh_token ? Date.now() : (old.obtained_at || Date.now()),
    scope: j.scope || old.scope || '',
  });
}

export const hasScope = (s) => ((LS.get('tok') || {}).scope || '').split(' ').includes(s);

// Returns true if the current URL was an OAuth redirect that we handled.
// Also accepts a pasted URL (fallback when iOS returns to Safari instead of the home-screen app).
export async function handleRedirect(urlString = location.href) {
  const url = new URL(urlString);
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
  saveTokens(j);
  LS.del('pkce');
  return true;
}

let refreshing = null;
export async function accessToken() {
  const t = LS.get('tok');
  if (!t) throw new Error('NOT_SIGNED_IN');
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) throw new Error('NOT_SIGNED_IN');
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
    .then(saveTokens)
    .catch((e) => { signOut(); throw new Error('登录已过期（测试模式每 7 天需重新登录），请重新连接'); })
    .finally(() => { refreshing = null; });
  await refreshing;
  return LS.get('tok').access_token;
}
