/* Privacy-first PWA: no authenticated response or patient data is ever cached. */
const OFFLINE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HMS is offline</title><style>body{font:16px system-ui;background:#f5f8f7;color:#142e33;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:360px;padding:28px}h1{color:#096b66}a{display:inline-block;background:#096b66;color:white;padding:12px 18px;border-radius:10px;text-decoration:none}</style><main><h1>You're offline</h1><p>Reconnect to access the hospital workspace. For privacy, patient records and payment information are not stored offline.</p><p>Use your hospital's approved downtime procedure for urgent care.</p><a href="/login">Reconnect and sign in</a></main></html>`;
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      // The portal never caches responses; delete any cache on this origin, including legacy ones.
      for (const k of await caches.keys()) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate' || new URL(req.url).origin !== self.location.origin)
    return;
  event.respondWith(
    fetch(req, { cache: 'no-store' }).catch(
      () =>
        new Response(OFFLINE, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
    ),
  );
});
