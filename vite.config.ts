import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built folder works on any host or subpath (Netlify, Netlify Drop, etc.).
  base: './',
  server: { host: '0.0.0.0', port: 4317, strictPort: true },
  preview: { host: '0.0.0.0', port: 4318, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
});
