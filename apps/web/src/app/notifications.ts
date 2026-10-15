// 알림 관련: 웹 푸시 구독, 알림 버튼(완료/1시간 뒤) 처리, 기기 사용 중 표시
import type { Services } from './services';

export function deviceName(kind: 'web' | 'desktop') {
  if (kind === 'desktop') return 'PC';
  return /Android|iPhone|Mobile/i.test(navigator.userAgent) ? '폰' : '브라우저';
}

export async function enablePush(services: Services): Promise<string> {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!services.cloud) return '서버(Supabase)를 연결해야 폰 푸시를 쓸 수 있어';
  if (!key) return 'VITE_VAPID_PUBLIC_KEY 가 설정되지 않았어(docs/SETUP.md)';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return '이 브라우저는 푸시를 지원하지 않아';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return '알림 권한이 거부됐어';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) }));
  await services.cloud.savePush(services.deviceId, deviceName('web'), sub.toJSON());
  return '폰 알림 켰어';
}

function urlB64(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 알림의 [완료] [1시간 뒤] 버튼 */
export async function handleNotifyAction(services: Services, action: string, itemId: string | null) {
  if (!itemId) return;
  if (action === 'done') await services.store.updateItem(itemId, { done_at: new Date().toISOString() });
  if (action === 'snooze1h') await services.store.updateItem(itemId, { snoozed_until: new Date(Date.now() + 3600_000).toISOString() });
}

/** 서비스 워커 메시지 + 주소(?notify=)로 들어온 알림 버튼 처리, 기기 사용 중 표시 */
export function startNotificationBridge(services: Services) {
  const q = new URLSearchParams(location.search);
  const action = q.get('notify');
  if (action) {
    void handleNotifyAction(services, action, q.get('item'));
    history.replaceState(null, '', '/');
  }
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'notify-action') void handleNotifyAction(services, e.data.action, e.data.itemId);
  });

  const cloud = services.cloud;
  if (!cloud) return;
  const kind = services.platform.kind;
  let lastInput = Date.now();
  const mark = () => { lastInput = Date.now(); };
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'focus']) window.addEventListener(ev, mark, { passive: true });
  const beat = () => {
    // 최근 5분 안에 이 창을 만졌을 때만 "사용 중"
    if (Date.now() - lastInput < 5 * 60_000 && document.visibilityState === 'visible') {
      void cloud.heartbeat(services.deviceId, deviceName(kind), kind).catch(() => undefined);
    }
  };
  beat();
  setInterval(beat, 60_000);
}
