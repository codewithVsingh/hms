/* Privacy-first PWA: no authenticated response or patient data is ever cached. */
const OFFLINE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HMS is offline</title><style>body{font:16px system-ui;background:#f5f8f7;color:#142e33;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:360px;padding:28px}h1{color:#096b66}a{display:inline-block;background:#096b66;color:white;padding:12px 18px;border-radius:10px;text-decoration:none}</style><main><h1>You're offline</h1><p>Reconnect to access the hospital workspace. For privacy, patient records and payment information are not stored offline.</p><p>Use your hospital's approved downtime procedure for urgent care.</p><a href="/login">Reconnect and sign in</a></main></html>`;
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('hms-')) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
// Only the sign-in page and signed-in workspaces are part of the PWA (keep in sync with lib/pwa.ts).
// Booking, cancellation, recovery and every other page are left to the browser untouched.
const PWA_PATH = /^\/(login|doctor|staff|admin)(\/|$)/;
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !PWA_PATH.test(url.pathname)) return;
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
