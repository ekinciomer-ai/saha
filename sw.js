/* SHAMS-1 Saha Takip · service worker */
const CACHE = 'shams1-v38';
const SHELL = ['./', './index.html', './manifest.webmanifest'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(()=>{})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* Firebase/canlı veri → her zaman ağdan (cache'leme) */
  if (/firebaseio|firebasedatabase|googleapis|gstatic/.test(url.host)) return;
  /* uygulama kabuğu → ağ-önce, çevrimdışıysa cache */
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && url.origin === location.origin) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
