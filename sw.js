// Cache-first service worker. Ανέβασε το CACHE_VERSION σε κάθε deploy.
const CACHE_VERSION = "cryptbound-v16";

const CORE_ASSETS = [
  ".", "index.html", "css/style.css",
  "js/main.js", "js/config.js", "js/state.js", "js/board.js", "js/ai.js",
  "js/net.js", "js/assets.js", "js/render3d.js", "js/ui.js",
  "data/quest01.json", "data/quest02.json", "data/quest03.json", "data/campaign.json",
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
      .then((keys) => {
        const hadOld = keys.some((k) => k !== CACHE_VERSION);
        return Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
          .then(() => self.clients.claim())
          .then(() => {
            // Νέα έκδοση: ξαναφόρτωσε ανοιχτά tabs ώστε να πάρουν φρέσκο κώδικα
            // με ΕΝΑ άνοιγμα — τέλος το «διπλό refresh».
            if (hadOld) {
              return self.clients.matchAll({ type: "window" }).then((clients) =>
                clients.forEach((c) => c.navigate(c.url))
              );
            }
          });
      })
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // PeerJS signaling κλπ: μην αγγίζεις

  // Βαριά, σταθερά assets (μοντέλα/art/libs): cache-first.
  // Κώδικας/HTML/data: network-first ώστε τα updates να έρχονται με ένα refresh,
  // με fallback στο cache όταν είσαι offline.
  const heavyAsset = /\/(assets|lib)\//.test(url.pathname);

  if (heavyAsset) {
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
  } else {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
