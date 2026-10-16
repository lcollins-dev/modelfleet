import { defineConfig, devices } from '@playwright/test';
import { cpus } from 'node:os';

import { LOGGED_OUT_STORAGE_STATE, STORAGE_STATE_PATH } from './utils/paths';
import { BASE_URL } from './utils/urls';

// The api and vite are each a single process; too many workers and specs stall.
const MAX_WORKERS = 3;

export default defineConfig({
  testDir: './tests',
  globalSetup: './utils/global-setup.ts',
  fullyParallel: true,
  workers: Math.min(Math.ceil(cpus().length / 2), MAX_WORKERS),
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    // Authenticated by default - specs that must run signed out opt out with
    // `test.use({ storageState: LOGGED_OUT_STORAGE_STATE })`
    storageState: STORAGE_STATE_PATH,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      // The setup signs in to create the auth file, so it must start with no session.
      use: { storageState: LOGGED_OUT_STORAGE_STATE },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /.*\.setup\.ts$/,
      dependencies: ['setup'],
    },
  ],
});
