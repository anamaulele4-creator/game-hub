/* TXAPILOG service worker — funciona em qualquer basePath (ex.: /game-hub/) porque usa o scope do registo. */
const VERSION = 'gh-v5'; // v5: botão instalar app (captura antecipada do beforeinstallprompt)
const SCOPE = self.registration.scope; // ex.: https://anamaulele4-creator.github.io/game-hub/
const BASE = new URL(SCOPE).pathname.replace(/\/$/, ''); // ex.: /game-hub
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const PRECACHE = [`${BASE}/`, `${BASE}/offline.html`, `${BASE}/manifest.webmanifest`, `${BASE}/icons/icon-192.png`, `${BASE}/icons/icon-512.png`, `${BASE}/logo.svg`, `${BASE}/brand/txapilog-logo.svg`];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE + '/')) return;

  // 1) Ficheiros com hash (/_next/static) e ícones: cache-first (imutáveis)
  if (url.pathname.includes('/_next/static/') || url.pathname.includes('/icons/') || /\.(?:png|svg|woff2?|ico)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // 2) Navegação (páginas HTML): network-first, cache como reserva, offline.html no fim
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)).then(() => trimCache(PAGES, 40)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match(`${BASE}/offline.html`))),
    );
    return;
  }

  // 3) Restante (RSC .txt, manifest, json): stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});

// ---------- Web Push ----------
// Payload esperado (JSON): { title, body, category, url, icon?, tag? }  — ver lib/push.ts (PushPayload)
self.addEventListener('push', (e) => {
  let p = { title: 'TXAPILOG', body: 'Tens novidades', url: '/', category: 'sistema' };
  try { if (e.data) p = { ...p, ...e.data.json() }; } catch { if (e.data) p.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(p.title, {
    body: p.body,
    icon: p.icon || `${BASE}/icons/icon-192.png`,
    badge: `${BASE}/icons/icon-192.png`,
    tag: p.tag || p.category,
    data: { url: p.url.startsWith(BASE) ? p.url : BASE + p.url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || `${BASE}/`;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(SCOPE) && 'focus' in c) { c.navigate(target); return c.focus(); }
      return self.clients.openWindow(target);
    }),
  );
});
