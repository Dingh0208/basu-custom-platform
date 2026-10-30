import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Electron loads the production build from file://, so every asset URL
  // must be relative to index.html instead of the filesystem root.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/.~*', '**/*.tmp'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
