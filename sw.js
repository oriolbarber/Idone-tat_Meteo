// CEM · Idoneïtat: desa l'app per obrir-la sense connexió. Previsió, mapes i radar van sempre a la xarxa
// (la descàrrega per zona, per fer-la servir sense cobertura, arriba en un pas posterior).
const CACHE = "cem-idoneitat-v10";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./app.css?v=10", "./app.js?v=10", "./zones.js?v=1", "./zones-osm.js?v=1", "./cloud.js?v=2", "./restr.js?v=1", "./heat.js?v=1",
  "./vendor/maplibre-gl.js?v=5.24.0", "./vendor/maplibre-gl.css?v=5.24.0",
  "./icons/logo.svg?v=1", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png?v=1"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache:"reload"})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  // només esborra les seves memòries cau (pot compartir domini amb altres apps d'oriolbarber.github.io)
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("cem-idoneitat-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if(e.request.method !== "GET" || u.origin !== location.origin) return;
  // Xarxa primer (les actualitzacions arriben senceres); sense connexió, la còpia desada
  e.respondWith(
    fetch(e.request.url, {cache:"no-cache", credentials:"same-origin"})
      .then(r => { if(r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match(e.request, {ignoreSearch:true})).then(r => r || caches.match("./index.html")))
  );
});
