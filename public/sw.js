/* FinFlow service worker — F68.
 *
 * DESIGN (deliberately conservative for an accounting app):
 *   • /api/* and every non-GET request → NETWORK-ONLY. Money data and mutations are never
 *     served from cache; there is no path by which a stale figure can be shown. This is the
 *     most important rule here and must not be relaxed.
 *   • HTML navigations + the code assets (app-main.js, finflow-bundle.js) → NETWORK-FIRST,
 *     with the cached copy used ONLY when the network fails. When online (the normal case) the
 *     user always runs the freshest code — so the SW can never pin an old money-computing build
 *     — while a flaky network or offline cold-launch still paints the shell (this is the F50
 *     boot-race window, now closed structurally rather than by re-fire).
 *   • Static, rarely-changing assets (icons, manifest) → CACHE-FIRST for instant paint.
 *
 * To force every client onto a new shell after a deploy, bump SW_VERSION; activate() drops all
 * prior caches. (index.html / *.js are served no-store, so this Cache API store is the only
 * persistence layer and a version bump fully invalidates it.)
 */
'use strict';

const SW_VERSION = 'finflow-v6-2026-08-24';
const SHELL_CACHE = 'shell-' + SW_VERSION;

// Precached on install so the very first offline launch has a shell to paint.
const PRECACHE = [
  '/app',
  '/app-main.js',
  '/finflow-bundle.js',
  '/manifest.json',
  '/favicon-192.png',
  '/favicon-512.png',
  '/apple-touch-icon.png',
];

// Cache-first: static assets that are safe to serve stale (never code, never API).
const STATIC_RE = /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {})) // tolerate a missing asset; don't fail install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever touch same-origin GETs. Everything else (POST/PUT/DELETE, cross-origin) → straight
  // to network, untouched.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Money & mutations: NEVER cached. Bypass the SW entirely.
  if (url.pathname.startsWith('/api/')) return;

  // Cache-first for static media (icons/fonts): fast, and version-bump clears them.
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Navigations + code assets: network-first, cache only as offline fallback.
  const isNav = req.mode === 'navigate';
  const isCode = url.pathname === '/app-main.js' || url.pathname === '/finflow-bundle.js';
  if (isNav || isCode) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(isNav ? '/app' : req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(isNav ? '/app' : req).then((hit) => hit || caches.match('/app')))
    );
  }
});
