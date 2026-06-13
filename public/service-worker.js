const SHELL_CACHE = 'bookprep-shell-v1';

// Static files that make up the app shell
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/main.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/favicon-32.png',
  '/favicon-192.png',
];

// ── Install: pre-cache the shell ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: drop stale caches ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache uploads / API mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App shell: cache-first, falling back to network (and caching the result)
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(res => {
        const clone = res.ok ? res.clone() : null;
        if (clone) caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        return res;
      }))
  );
});
