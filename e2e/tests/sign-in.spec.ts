import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { webRoute } from '../utils/urls';
import { TEST_USER } from '../utils/users';

test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('sign in', () => {
  test('redirects a protected route to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(webRoute('/dashboard'));

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('opens the console at sign-in and lands on the dashboard after signing in', async ({
    signInPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await page.goto(webRoute('/'));

    await expect(page).toHaveURL(webRoute('/sign-in'));

    await signInPage.enterCredentials(user);

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('signs in with email then password and lands off the sign-in page', async ({ signInPage, page, request }) => {
    // Its own user: signing in rotates that user's session, which would invalidate the
    // storage state the authenticated specs are using.
    const user = await createTestUser(request);

    await signInPage.goto();
    await signInPage.enterEmail(user.email);

    await expect(signInPage.identity).toHaveText(user.email);

    await signInPage.passwordInput.fill(user.password);
    await signInPage.submitButton.click();

    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test('returns the user to the protected page they opened before signing in', async ({
    signInPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await page.goto(webRoute('/edit-profile'));

    await expect(page).toHaveURL(/\/sign-in\?redirect=\/edit-profile$/);

    await signInPage.enterCredentials(user);

    await expect(page).toHaveURL(/\/edit-profile$/);
  });

  test('keeps the user on sign-in with the refusal under the password when it is wrong', async ({
    signInPage,
    page,
    allowHttpError,
  }) => {
    allowHttpError({ url: /\/api\/v1\/user\/login$/, status: 400 });

    await signInPage.goto();
    await signInPage.enterCredentials({ email: TEST_USER.email, password: 'not-the-password' });

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(signInPage.passwordError).toHaveText('The email address or password is incorrect');
  });
});
