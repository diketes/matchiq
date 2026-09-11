import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const YEAR = 60 * 60 * 24 * 365;

// base './' – ta sama paczka działa z serwera Express, z Capacitora (file://) i z GitHub Pages (podkatalog)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    // Service worker tylko w paczce mobilnej (GitHub Pages / PWA). Desktop (Express, Electron) bez SW.
    VitePWA({
      disable: mode !== 'mobile',
      registerType: 'autoUpdate',
      injectRegister: false, // rejestracja ręcznie w main.tsx (pomijana w natywnym Capacitorze)
      manifest: false, // własny public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,json,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css', expiration: { maxEntries: 10, maxAgeSeconds: YEAR } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: YEAR },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // ratingi / skuteczność z gałęzi `data` – najpierw sieć, offline z pamięci
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/diketes\/matchiq\/data\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'matchiq-data',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4400',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
}));
