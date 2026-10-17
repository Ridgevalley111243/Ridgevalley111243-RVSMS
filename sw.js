// Ridgevalley SMS service worker: shows push notifications sent by the
// send-push Edge Function, even when no tab of the site is open.

self.addEventListener('install', () => self.skipWaiting());
// Fonts (the /fonts folder) never change under the same name, so after the
// first visit they are served straight from this cache: no network wait.
// Bump FONT_CACHE if a font file is ever replaced in place.
const FONT_CACHE = 'rv-fonts-v1';

self.addEventListener('activate', (event) => event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('rv-fonts-') && n !== FONT_CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !url.pathname.includes('/fonts/')) return;
    event.respondWith((async () => {
        const cache = await caches.open(FONT_CACHE);
        const hit = await cache.match(req, { ignoreVary: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
    })());
});

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (_) { data = { title: 'Ridgevalley SMS', body: event.data ? event.data.text() : '' }; }

    const title = data.title || 'Ridgevalley SMS';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || '',
        icon: '1.png',
        badge: '1.png',
        tag: data.tag || 'ridgevalley-sms',
        renotify: true,
        data: { url: data.url || './' }
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (client.url.startsWith(self.registration.scope)) {
                await client.focus();
                client.postMessage({ type: 'open-notifications' });
                return;
            }
        }
        await self.clients.openWindow(target);
    })());
});
