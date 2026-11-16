const CACHE = 'katip-v1';
const FILES = ['./', './index.html', './core.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
importScripts('core.js');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Önce ağ, olmazsa önbellek: güncelleme gelirse alınır, internetsizken de açılır.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

function readState() {
  return new Promise(res => {
    const r = indexedDB.open('katip', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const q = r.result.transaction('kv').objectStore('kv').get('state');
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => res(null);
      } catch (e) { res(null); }
    };
  });
}

// Sunucu yalnız "uyan" der; içerik telefondaki işlerden burada hesaplanır.
// Böylece iş bilgileri hiçbir sunucuya gitmez.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const st = await readState();
    let title = 'Kâtip', body = 'İşlerinize göz atın.', badge = 0;
    if (st && Array.isArray(st.tasks)) {
      const d = self.Katip.digest(st.tasks, st.settings);
      title = d.title; body = d.body; badge = d.badge;
    }
    try { if (self.navigator.setAppBadge) badge ? await self.navigator.setAppBadge(badge) : await self.navigator.clearAppBadge(); } catch (err) {}
    await self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'katip-daily', renotify: true, data: { url: './' } });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  })());
});
