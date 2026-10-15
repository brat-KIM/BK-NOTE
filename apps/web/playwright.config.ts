import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// 클라우드 작업 환경에는 크로미움이 미리 깔려 있다. CI 에서는 playwright install 로 받은 것을 쓴다.
const chromium = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: chromium ? { executablePath: chromium } : {},
    serviceWorkers: 'block',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 400, height: 900 } } },
    { name: 'phone', use: { ...devices['Galaxy S9+'], browserName: 'chromium' } },
  ],
  // AI 는 e2e 빌드 모드에서만 window.__bkAiMock 으로 흉내 낸다
  webServer: {
    command: 'pnpm exec vite build --mode e2e --outDir dist-e2e && pnpm exec vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
