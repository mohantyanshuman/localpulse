// LocalPulse service worker — offline resilience for slow phones / bad internet.
// Shell is cache-first; API responses are network-first with a cache fallback,
// so the dashboard still shows the last-known status when the connection drops.
const CACHE = 'localpulse-v2';
const SHELL = ['/', '/responder', '/voice', '/css/app.css', '/js/app.js', '/js/voice.js', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Push: show the notification the server sent.
self.addEventListener('push', (e) => {
  let data = { title: 'LocalPulse', body: 'New alert', url: '/' };
  try { if (e.data) data = Object.assign(data, e.data.json()); } catch (_) { /* keep default */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, tag: data.tag || 'lp', renotify: true,
    icon: '/favicon.svg', badge: '/favicon.svg', data: { url: data.url || '/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then((ws) => {
    for (const w of ws) { if ('focus' in w) { w.navigate(url); return w.focus(); } }
    return clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // let CDN/tiles/fonts pass through

  if (url.pathname.startsWith('/api/')) {
    // Network-first: freshest data wins; fall back to last cached response offline.
    e.respondWith(
      fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }
  // Static + pages: cache-first, refresh in the background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; }).catch(() => cached);
      return cached || net;
    })
  );
});
