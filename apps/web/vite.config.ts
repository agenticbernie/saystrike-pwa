import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['offline.html', 'images/saystrike-mark.png', 'icons/saystrike-192.png', 'icons/saystrike-512.png', 'audio/manifest.json'],
      manifest: {
        id: '/',
        name: 'SayStrike — English Speaking Arcade',
        short_name: 'SayStrike',
        description: 'Practice spoken English and bring your voice to the arcade.',
        theme_color: '#0a0814',
        background_color: '#0a0814',
        display: 'standalone',
        orientation: 'portrait-primary',
        categories: ['education', 'games'],
        icons: [
          { src: '/icons/saystrike-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/saystrike-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/audio\/[a-zA-Z0-9_-]+\.ogg$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'saystrike-audio-v1',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: false },
});
