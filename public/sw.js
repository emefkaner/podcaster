// Minimaler Service Worker: macht die App installierbar (PWA) und cacht die Hülle.
// Bewusst schlank – dynamische Daten (Feed, API) werden NICHT gecacht.
const CACHE = 'podcast-shell-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API, Feed und Medien immer frisch aus dem Netz.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') ||
      url.pathname === '/feed.xml' || e.request.method !== 'GET') {
    return; // Standardverhalten
  }
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
