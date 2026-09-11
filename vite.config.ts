import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' – ta sama paczka działa z serwera Express, z Capacitora (file://) i z GitHub Pages (podkatalog)
export default defineConfig({
  base: './',
  plugins: [react()],
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
});
