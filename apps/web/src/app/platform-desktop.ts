// Tauri 데스크톱 기능(항상 위, 오른쪽 도킹, 윈도우 알림, 로컬 백업, 자동 실행)
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { Platform } from './platform';

export async function createDesktopPlatform(): Promise<Platform> {
  const win = getCurrentWindow();
  return {
    kind: 'desktop',
    setAlwaysOnTop: (on) => win.setAlwaysOnTop(on),
    isAlwaysOnTop: () => win.isAlwaysOnTop(),
    dockRight: () => invoke('dock_right'),
    hide: () => win.hide(),
    async notify(title, body) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (ok) sendNotification({ title, body });
    },
    saveBackup: (fileName, contents) => invoke<string>('save_backup', { fileName, contents }),
    autostart: {
      isEnabled: () => isEnabled(),
      set: (on) => (on ? enable() : disable()),
    },
  };
}
