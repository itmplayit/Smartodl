import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css'; // includes the institutional layer (merged 2026-10-19)
// LeetCode skin for the Coding Arena — must load last so it wins the cascade
import './styles/leetcode-arena.css';
import { installPreviewCompat } from './utils/preview-compat';

// No-op in a normal tab; repairs form submission / dialogs / storage when the
// app is opened inside an embedded preview pane.
installPreviewCompat();

// Register the PWA service worker only in production builds — in dev it would
// cache through Vite's transforming layer and cause stale/reload weirdness.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
