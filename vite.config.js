import { defineConfig } from 'vite';

// Plyr ships from src/ in dev, deploys to /plyr/ on the VPS.
// `base: './'` keeps URLs relative so the same build works at any subpath
// without baking /plyr/ into the asset references.
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: './',

  server: {
    port: 8080,
    open: true,
    strictPort: true,

    // The dev server can't run PHP, so it would otherwise serve proxy.php as
    // a static file — a 200 whose body is raw PHP source. That made every
    // Drive era show up empty locally while working fine in production.
    //
    // Forward those requests to the deployed backend instead, so Drive
    // listings, audio streaming and art extraction all work in dev without
    // needing PHP or a copy of DRIVE_API_KEY on this machine (the key stays
    // server-side, which is the point of the proxy).
    //
    // Set PLYR_PROXY_TARGET to point at a local PHP server instead.
    proxy: {
      '/proxy.php': {
        target: process.env.PLYR_PROXY_TARGET || 'https://crbntyp.com',
        changeOrigin: true,
        rewrite: (path) =>
          process.env.PLYR_PROXY_TARGET ? path : path.replace(/^\/proxy\.php/, '/plyr/proxy.php'),
      },
    },
  },

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Predictable output paths so the PWA service-worker asset list and any
    // external references (rsync, cache rules) stay valid build-to-build.
    rollupOptions: {
      output: {
        // Force a stable `main.js` / `main.css` rather than Vite's default
        // `index.js` / `index.css`. Stable names mean the service worker's
        // cache-add list can refer to them without templating.
        entryFileNames: 'scripts/main.js',
        chunkFileNames: 'scripts/[name].js',
        assetFileNames: (asset) => {
          const ext = (asset.name || '').split('.').pop();
          if (ext === 'css') return 'styles/main[extname]';
          if (['woff', 'woff2', 'ttf', 'eot'].includes(ext)) return 'fonts/[name][extname]';
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
