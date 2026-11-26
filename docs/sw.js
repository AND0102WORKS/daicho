// 業者ページの通知（発注が来たら携帯に出す）。通知を出すことと、押したら発注書を開くことだけをする。画面や通信の保存（キャッシュ）はしない
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '発注書が届きました', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || '' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '';
  // 開くのは、この業者ページと同じ場所のページだけ
  if (url && url.indexOf(self.registration.scope) === 0) e.waitUntil(self.clients.openWindow(url));
});
