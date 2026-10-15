import { webPlatform, type Platform } from './platform';

// P2 에서 Tauri API 로 채운다.
export async function createDesktopPlatform(): Promise<Platform> {
  return { ...webPlatform, kind: 'desktop' };
}
