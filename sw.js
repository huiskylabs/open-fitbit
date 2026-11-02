// App-shell cache so the app opens instantly and offline. API calls are never cached here.
const V = 'shell-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'js/auth.js', 'js/api.js', 'js/demo.js', 'js/charts.js', 'manifest.webmanifest', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET' || u.searchParams.has('code')) return;
  // network first, fall back to cache (so updates show up right away when online)
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((cc) => cc.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
