import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { iconsPlugin } from './icons.config';

export default defineConfig({
  plugins: [vue(), iconsPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    setupFiles: ['test/setup.ts'],
  },
});
