/*
 * Minimal service worker so the app qualifies as installable (PWA) in every
 * Chromium-based browser (Chrome, Edge, Samsung Internet, Brave).
 *
 * It deliberately caches nothing: every request goes to the network, so a new
 * deploy is picked up on the next load and users never see a stale build.
 * The only thing it adds is a small "you are offline" page for navigations
 * when the network is unreachable.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#1f2937;text-align:center;padding:24px}
button{margin-top:16px;padding:10px 20px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px}</style>
</head><body><div><h2>You are offline</h2><p>Connect to the internet and try again.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    )
  );
});
