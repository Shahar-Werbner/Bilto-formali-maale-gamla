// Hand-written on purpose: a service worker is sticky — a bad one keeps
// serving stale code long after it is deployed — so this stays small enough
// to read in full, with no build step and no dependency.
//
// What it does: keeps the last version of each page and static asset so the
// app opens in a dead spot. It deliberately does NOT cache API responses;
// attendance data must be current, and writes are handled by the queue in
// src/lib/offline-queue.ts, not here.

const VERSION = "v1";
const CACHE = `maale-gamla-${VERSION}`;

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/icon-192.png"])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs are cacheable, and only from this origin.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve a stale session or stale attendance.
  if (url.pathname.startsWith("/api/")) return;

  // Network first, falling back to the last copy we saw. The app is
  // server-rendered, so a cached page is a real page, just older.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // A page we have never opened, with no network: say so in Hebrew
        // rather than showing the browser's default error.
        if (request.mode === "navigate") {
          return new Response(
            `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
             <meta name="viewport" content="width=device-width,initial-scale=1">
             <title>אין חיבור</title>
             <body style="font-family:system-ui;padding:2rem;text-align:center;color:#334155">
               <h1 style="font-size:1.25rem">אין חיבור לאינטרנט</h1>
               <p>הדף הזה עוד לא נטען במכשיר. סימוני נוכחות שכבר עשיתם נשמרו
                  ויישלחו כשהחיבור יחזור.</p>
             </body></html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
        return Response.error();
      }),
  );
});
