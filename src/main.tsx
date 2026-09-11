import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles/global.css';

// PWA (GitHub Pages / ekran początkowy telefonu): apka trzymana lokalnie, aktualizuje się sama.
// W natywnym Capacitorze (APK/IPA) i na desktopie service worker nie jest potrzebny.
const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
if (!isNative && import.meta.env.PROD && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
