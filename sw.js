// Offline field view: cache the app shell, then serve API GETs network-first with cache fallback.
const SHELL = "nwis-shell-v1";
const DATA = "nwis-data-v1";
const SCOPE = new URL(self.registration.scope).pathname;
const CACHED_API = ["/api/wells", "/api/lookahead", "/api/risk", "/api/telemetry", "/api/wells/", "/api/offsets"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith(SCOPE + "data/")) {
    if (url.pathname.startsWith(SCOPE + "data/")) { e.respondWith(caches.open(DATA).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })))); return; }
    if (!CACHED_API.some((p) => url.pathname.startsWith(p))) return;
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copy = r.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request).then((r) => r || new Response(JSON.stringify({ offline: true }), { status: 503 })))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); } return r; });
      return hit || net.catch(() => caches.match("./index.html"));
    })
  );
});
