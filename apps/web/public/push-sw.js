// 웹 푸시 수신(서비스 워커). supabase/functions/push 가 보낸 알림을 띄운다.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'BK-NOTE';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.itemId || 'bk-note',
    data,
    icon: '/icon-192.png',
    actions: [
      { action: 'done', title: '완료' },
      { action: 'snooze1h', title: '1시간 뒤' },
    ],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const q = event.action ? `?notify=${event.action}&item=${encodeURIComponent(d.itemId || '')}` : '';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      c.postMessage({ type: 'notify-action', action: event.action || 'open', itemId: d.itemId });
      if ('focus' in c) return c.focus();
    }
    return self.clients.openWindow('/' + q);
  })());
});
