// Ridgevalley SMS service worker: shows push notifications sent by the
// send-push Edge Function, even when no tab of the site is open.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
