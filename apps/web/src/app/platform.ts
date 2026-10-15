// 실행 환경(웹/PWA vs Tauri 데스크톱)별 기능. 데스크톱 기능은 Tauri API 를 동적으로 불러온다.

export interface Platform {
  kind: 'web' | 'desktop';
  /** 항상 위 */
  setAlwaysOnTop?(on: boolean): Promise<void>;
  isAlwaysOnTop?(): Promise<boolean>;
  /** 가장 오른쪽 모니터의 오른쪽 끝에 세로로 꽉 차게 붙인다 */
  dockRight?(): Promise<void>;
  setOpacity?(value: number): Promise<void>;
  hide?(): Promise<void>;
  /** 시스템 알림(윈도우 토스트 / 브라우저 알림) */
  notify(title: string, body: string): Promise<void>;
  /** 매일 밤 로컬 백업 파일 저장(데스크톱만) */
  saveBackup?(fileName: string, contents: string): Promise<string>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function detectPlatform(): Promise<Platform> {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    const { createDesktopPlatform } = await import('./platform-desktop');
    return createDesktopPlatform();
  }
  return webPlatform;
}

export const webPlatform: Platform = {
  kind: 'web',
  async notify(title, body) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png' });
    else new Notification(title, { body });
  },
};
