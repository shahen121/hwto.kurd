// ── hwto-kurd Progressive Web App Service Worker ────────────────────────────
const CACHE_NAME = "hwto-kurd-pwa-v1";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./logo.svg",
  "./hwto-logo.svg",
  "./apple-touch-icon.png",
  "./sized/192x192.png",
  "./sized/512x512.png",
  "./manifest.webmanifest",
];

// Install: cache minimal app shell and skip waiting immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

// Activate: clean up older caches and claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch: bypass streaming, video, and dynamic APIs; network-first for navigation
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip APIs, video proxies, Cloudflare workers, and external auth
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/vidcore/") ||
    url.pathname.startsWith("/vidlink/") ||
    url.pathname.startsWith("/hls/") ||
    url.pathname.startsWith("/stream-proxy/") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("tmdb.org") ||
    url.hostname.includes("graphql.anilist.co")
  ) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("./index.html").then((res) => res || caches.match("/")),
      ),
    );
    return;
  }

  // Static shell assets (images, fonts, scripts): Network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (url.origin === self.location.origin)
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(request)),
  );
});
