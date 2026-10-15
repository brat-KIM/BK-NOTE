/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Tauri 데스크톱 앱이 같은 빌드를 쓴다(상대 경로 필요 없음: Tauri 는 자체 프로토콜로 루트를 서빙)
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Tauri 빌드에서는 서비스 워커가 필요 없다
      disable: process.env.BKNOTE_TARGET === 'desktop',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'BK-NOTE',
        short_name: 'BK-NOTE',
        description: '적고 → 미루고 → 하고 → 지우는 스티커 노트',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#1f2430',
        theme_color: '#1f2430',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        // 폰 「공유 → BK-NOTE」: 카톡·문자 내용을 그대로 항목으로
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        navigateFallback: '/index.html',
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
