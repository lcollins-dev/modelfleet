import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { webRoute } from '../utils/urls';

// Its own user: signing out rotates that user's session, which would invalidate the
// storage state the authenticated specs are using.
test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('sign out', () => {
  test('returns the user to the sign-in page and keeps them out', async ({ signInPage, headerMenu, page, request }) => {
    const user = await createTestUser(request);

    await signInPage.signIn(user);

    await headerMenu.select('Sign out');

    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto(webRoute('/dashboard'));

    await expect(page).toHaveURL(/\/sign-in/);
  });
});
