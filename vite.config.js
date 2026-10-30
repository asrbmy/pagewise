import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Base path
 * ---------
 * GitHub project sites are served from https://<user>.github.io/<repo>/, so
 * absolute asset URLs ("/assets/x.js") would 404. We default to a *relative*
 * base ("./"), which works from any sub-path (and from a user/org site root).
 *
 * The deploy workflow also sets BASE_PATH=/<repo>/ explicitly so the PWA
 * manifest, service worker scope and asset URLs are all pinned to the
 * repository path. Override locally with e.g. `BASE_PATH=/docs/ npm run build`.
 */
const base = process.env.BASE_PATH || './';

// A strict Content-Security-Policy is injected for production builds only
// (the Vite dev server needs inline scripts for hot reloading). Documents never
// need network access, so connect-src is limited to the app's own origin.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const cspPlugin = {
  name: 'pagewise-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
  ],
};

export default defineConfig({
  base,
  plugins: [
    react(),
    cspPlugin,
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually in src/pwa/register.js
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Pagewise',
        short_name: 'Pagewise',
        description: 'A private document editor that keeps your documents in your own browser.',
        theme_color: '#0f766e',
        background_color: '#f1f3f4',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // The PDF text-selection font is large and rarely needed: cache it the first time it is used.
        runtimeCaching: [
          { urlPattern: /\/fonts\/.*\.ttf$/, handler: 'CacheFirst', options: { cacheName: 'pagewise-fonts', expiration: { maxEntries: 2 } } },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) return 'editor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    globals: true,
    include: ['tests/**/*.test.{js,jsx}'],
    testTimeout: 20000,
  },
});
