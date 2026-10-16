import { resolve } from 'node:path';

export const STORAGE_STATE_PATH = resolve(__dirname, '../playwright/.auth/user.json');

// Applied per-file with `test.use({ storageState: LOGGED_OUT_STORAGE_STATE })`.
export const LOGGED_OUT_STORAGE_STATE = { cookies: [], origins: [] };
