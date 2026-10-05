/**
 * SAE INDIA — Ground Station Service Worker (Offline & Local Caching)
 * 
 * Provides local asset caching for ultra-fast, zero-server-load UI execution.
 * Rules:
 * - Caches static assets: HTML, CSS, JS, fonts, images
 * - NEVER intercepts or interferes with WebSocket connections (ws://, wss://)
 * - NEVER intercepts live MJPEG/video streams (http://*:8080/video)
 * - Falls back to network for fresh API requests
 */

const CACHE_NAME = 'sae-ground-station-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/vite.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache partial warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass WebSocket upgrades, live video streams, and telemetry
  if (
    url.pathname.includes('/ws') ||
    url.pathname.includes('/connector') ||
    url.pathname.endsWith('/video') ||
    url.pathname.includes('nominatim') ||
    event.request.headers.get('Upgrade') === 'websocket'
  ) {
    return; // Pass through to network
  }

  // 2. Cache-First for static assets (/assets/*, fonts, images)
  if (
    url.pathname.startsWith('/assets/') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|woff2?|ico)$/i)
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Stale-While-Revalidate for HTML / Navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => {
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // Default: Network with Cache Fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
