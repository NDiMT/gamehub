// Cache-first service worker. Ανέβασε το CACHE_VERSION σε κάθε deploy.
const CACHE_VERSION = "cryptbound-v4";

const CORE_ASSETS = [
  ".", "index.html", "css/style.css",
  "js/main.js", "js/config.js", "js/state.js", "js/board.js", "js/ai.js",
  "js/net.js", "js/assets.js", "js/render3d.js", "js/ui.js",
  "data/quest01.json",
  "lib/three.module.min.js", "lib/peerjs.min.js",
  "lib/addons/loaders/GLTFLoader.js", "lib/addons/utils/BufferGeometryUtils.js",
  "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
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
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // PeerJS signaling κλπ: μην αγγίζεις
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
