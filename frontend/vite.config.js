import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies API + uploaded files to the Express backend so the
// browser only ever talks to one origin (works behind tunnels/preview hosts).
//
// Dev-server exposure: by default this config now follows Vite's own
// host/CORS protections. The permissive settings that embedded preview
// panes need (any Host, module CORS for `Origin: null`, framing allowed)
// are opt-in ONLY, via SMARTODL_PREVIEW_DEV=1 — never run `vite dev` as a
// production server, and never enable that flag on an exposed host.
const previewDev = process.env.SMARTODL_PREVIEW_DEV === '1';
const localDevOrigins = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  // Allow Vite's same-origin module requests when the dev UI is opened from
  // another device on a private LAN. VITE_HOST must still be opted into.
  /^https?:\/\/(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?$/,
];

export default defineConfig({
  plugins: [react()],
  server: {
    // Default to loopback so a laptop in a cafe/dorm never exposes the dev
    // server (and its /api proxy straight to the backend) on the LAN.
    // Classroom use where students reach the machine by IP: set VITE_HOST=0.0.0.0.
    // The embedded-preview mode explicitly opts into external access, so it
    // must keep binding all interfaces.
    host: previewDev ? '0.0.0.0' : (process.env.VITE_HOST || '127.0.0.1'),
    port: 5173,
    strictPort: true,
    ...(previewDev
      ? {
        allowedHosts: true,
        cors: { origin: '*', credentials: false },
        headers: { 'X-Frame-Options': 'ALLOWALL' },
      }
      : {
        // Same-origin app + direct localhost/LAN-IP development keep working;
        // Cross-origin module loading is limited to loopback + private LAN origins.
        cors: { origin: localDevOrigins, credentials: false },
      }),
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
