import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The API lives in its own process in development and is proxied here, so the
// browser sees one origin and the session cookie stays same-site.
const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Brigue',
        short_name: 'Brigue',
        description: 'Un jeu lent de politique municipale dans une ville médiévale.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f4ef',
        theme_color: '#f6f4ef',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell is the offline experience: the API is never cached, so a
        // stale town can never be shown as if it were current.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: { '/api': API },
  },
  preview: {
    proxy: { '/api': API },
  },
});
