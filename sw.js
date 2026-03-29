const V = 'hn-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.hostname.includes('algolia')) return;
  if (u.hostname.includes('gstatic') || u.hostname.includes('googleapis')) {
    e.respondWith(
      caches.open(V).then(c =>
        c.match(e.request).then(h => h || fetch(e.request).then(r => {
          c.put(e.request, r.clone());
          return r;
        }))
      )
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(h => h || fetch(e.request)));
});
