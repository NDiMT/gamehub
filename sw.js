// Service worker: cache-first ώστε το παιχνίδι να παίζει και offline.
// Ανέβασε το CACHE_VERSION σε κάθε deploy για να σπάσει το παλιό cache.
const CACHE_VERSION = "dreamrun-v1";

const CORE_ASSETS = [
  ".",
  "index.html",
  "css/style.css",
  "js/main.js",
  "js/config.js",
  "js/player.js",
  "js/world.js",
  "js/input.js",
  "js/hud.js",
  "js/assets.js",
  "lib/three.module.min.js",
  "lib/addons/loaders/GLTFLoader.js",
  "lib/addons/utils/BufferGeometryUtils.js",
  "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        // Cache και τα runtime assets (μοντέλα, εικονίδια)
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
