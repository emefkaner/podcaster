// Service Worker: macht die App installierbar (PWA) und hält sie offline nutzbar.
//
// Wichtig: Programmdateien werden IMMER zuerst aus dem Netz geholt. Ein reiner
// Cache-Vorrang würde nach einem Update weiter die alte Oberfläche ausliefern –
// der Nutzer säße dann trotz neuem Server auf einer veralteten Version fest.
// Der Zwischenspeicher dient nur noch als Rückfall ohne Verbindung.
const CACHE = 'podcast-shell-v3';
const SHELL = ['/', '/styles.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Nur eigene Dateien behandeln. Fremde Adressen (etwa die Mediendateien im
  // Speicher) gehen unangetastet ans Netz.
  if (url.origin !== self.location.origin) return;

  // Die ffmpeg-Bausteine ändern sich nie und sind groß (~31 MB): einmal aus dem
  // Netz holen, dann dauerhaft aus dem Zwischenspeicher bedienen.
  if (url.pathname.startsWith('/vendor/ffmpeg/')) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
        return res;
      }))
    );
    return;
  }

  // API, Feed und Medien immer direkt aus dem Netz.
  if (e.request.method !== 'GET' ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/media/') ||
      url.pathname === '/feed.xml') {
    return;
  }

  // Programmdateien: Netz zuerst, Zwischenspeicher nur als Rückfall.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
