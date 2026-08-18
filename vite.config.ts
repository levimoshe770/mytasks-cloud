import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Deployed as a static site. On Cloudflare Pages / a custom domain the app is at
// the root, so base is '/'. GitHub Pages *project* sites live under
// /<repo>/, so set BASE_PATH=/mytasks-cloud/ in that workflow.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'mytasks',
        short_name: 'mytasks',
        description: 'Personal task list, backed by a private GitHub repo',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f2937',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Never cache GitHub API responses — the service worker must not serve a
        // stale tasks.json, and a cached 200 would hide auth failures.
        navigateFallbackDenylist: [/^https:\/\/api\.github\.com/],
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
