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
