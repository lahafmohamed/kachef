/*
 * Service worker de Kachef : les notifications push, et rien d'autre. Il ne met rien
 * en cache et n'intercepte aucune requête — l'app se charge toujours depuis le réseau,
 * comme avant lui. Le serveur envoie { title, body, url, tag, lang, dir } (server/push.js).
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'Kachef', {
        body: data.body || '',
        icon: '/logo-mark-192.png',
        badge: '/badge-96.png',
        lang: data.lang || undefined,
        dir: data.dir || 'auto',
        // The same نشاط twice (created, then moved) replaces its notification instead of stacking
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: typeof data.url === 'string' ? data.url : '/' },
      });
      // An open app refreshes its bell right away instead of at its next poll
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) w.postMessage({ type: 'notification-push' });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  // Only pages of this app: a notification can never send anyone elsewhere
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === target.origin);
      if (open) {
        // The open tab keeps its session: it moves itself with its own router
        await open.focus().catch(() => {});
        open.postMessage({ type: 'notification-click', url: target.pathname + target.search + target.hash });
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

// The browser renewed the subscription by itself: subscribe again with the same key.
// The app tells the server on its next start (it compares and re-registers).
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {})
  );
});
