/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          grid: ['@glideapps/glide-data-grid'],
          codemirror: ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/autocomplete', '@codemirror/lint', '@codemirror/commands', '@codemirror/search'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
