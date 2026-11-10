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
    // Dates render in the browser's own zone and locale, which would otherwise follow the host's.
    locale: 'en-GB',
    timezoneId: 'UTC',
  },
});
