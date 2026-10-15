import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' },
    serviceWorkers: 'block',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 400, height: 900 } } },
    { name: 'phone', use: { ...devices['Galaxy S9+'], browserName: 'chromium' } },
  ],
  webServer: { command: 'pnpm exec vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true },
});
