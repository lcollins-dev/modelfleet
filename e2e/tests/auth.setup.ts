import { test as setup } from '../fixtures/test';
import { STORAGE_STATE_PATH } from '../utils/paths';

setup('authenticate as test user', async ({ signInPage, page }) => {
  await signInPage.signIn();

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
