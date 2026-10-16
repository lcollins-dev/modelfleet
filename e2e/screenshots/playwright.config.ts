import { defineConfig } from '@playwright/test';

import { BASE_URL } from '../utils/urls';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.screenshots\.ts$/,
  workers: 1,
  reporter: [['list']],
  use: {
    actionTimeout: 15_000,
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
});
