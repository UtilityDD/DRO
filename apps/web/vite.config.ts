import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.GITHUB_SHA?.slice(0, 7) ||
  `local-${new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  define: {
    __DRO_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: [
        'favicon.png',
        'favicon-32.png',
        'favicon-48.png',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-192-maskable.png',
        'icons/icon-512-maskable.png',
      ],
      manifest: {
        name: 'DRO Insights',
        short_name: 'DRO Insights',
        description: 'WBSEDCL Darjeeling Region insights and ops monitoring',
        theme_color: '#1565c0',
        background_color: '#f4f7fb',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache' },
          },
          {
            // Boundary geometry is large but rarely changes. Serve the cached copy
            // instantly and refresh in the background so the map opens without a
            // network round-trip on repeat visits, with no loss of resolution.
            urlPattern: ({ url }) => url.pathname.startsWith('/geo/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'geo-boundaries',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@/lib/supabase',
        replacement: path.resolve(__dirname, 'src/powermap/supabase.ts'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, '../../vendor/PowerMapV2/src'),
      },
    ],
  },
  optimizeDeps: {
    include: ['leaflet', '@geoman-io/leaflet-geoman-free'],
  },
  build: {
    // Keep the big, independent libraries in their own long-lived chunks so a
    // change to app code does not force browsers to re-download them, and so the
    // initial page never pays for libraries only used by one route.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('leaflet') || id.includes('geoman')) return 'map-vendor';
          if (id.includes('xlsx')) return 'xlsx-vendor';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory'))
            return 'charts-vendor';
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/'))
            return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        timeout: 180000,
      },
    },
  },
});
