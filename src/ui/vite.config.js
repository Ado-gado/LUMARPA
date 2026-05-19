import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite сидит в src/ui/. Сборка идёт в src/ui/dist (читается api.js).
// В dev-режиме Vite на :3000 проксирует /api → http://127.0.0.1:3001 (Express).
export default defineConfig({
  plugins: [react()],
  base: './', // относительные пути — нужно для file:// при упаковке в Electron
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
