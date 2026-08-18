/*
 * Service worker for Don't Forget.
 *
 * Two rules shape everything here:
 *
 * 1. A new deploy must reach installed users without them reinstalling.
 *    Navigations are network-first and the worker takes over immediately
 *    (skipWaiting + clients.claim), so a refresh is enough.
 *
 * 2. User data must never be touched. Destinations, lists, history and settings
 *    live in localStorage (via AsyncStorage), which this file never reads or
 *    writes. Cleanup below deletes only caches this worker created, matched by
 *    the CACHE_PREFIX — never caches.keys() wholesale, never storage APIs.
 */

const CACHE_PREFIX = 'dont-forget-';
const CACHE = `${CACHE_PREFIX}v1`;
const APP_SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Warm the shell so the app opens offline, but never fail the install
      // over it — a missing shell must not block an update.
      try {
        const cache = await caches.open(CACHE);
        await cache.add(new Request(APP_SHELL, { cache: 'reload' }));
      } catch {
        /* offline or shell unavailable: fetch handlers still work */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Lets the page ask an updated worker to activate right away. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: go to the network first so new code is picked up as soon as it
  // is deployed; fall back to the cached shell only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(APP_SHELL, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(APP_SHELL);
          if (cached) return cached;
          return new Response('אין חיבור לאינטרנט', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // Everything else: serve from cache for speed, refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;
      return new Response('', { status: 504 });
    })(),
  );
});

/*
 * Tapping a departure reminder focuses the app (or opens it) at the destination
 * it belongs to, so the user lands straight on its list of things to take.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              /* some browsers refuse navigate(); the app is at least focused */
            }
          }
          return;
        }
      }

      await self.clients.openWindow(url);
    })(),
  );
});
