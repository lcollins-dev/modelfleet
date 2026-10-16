import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { webRoute } from '../utils/urls';

const ROLE_GATED_ROUTES = ['/users', '/batch-jobs', '/events', '/presets', '/deployments'];

test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('access control', () => {
  test('shows a user without roles the not-found page at every role-gated route', async ({
    signInPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await signInPage.signIn(user);

    for (const route of ROLE_GATED_ROUTES) {
      await page.goto(webRoute(route));

      await expect(page).toHaveURL(webRoute(route));
      await expect(page.getByText('Page not found')).toBeVisible();
    }
  });

  test('sends a signed-out visitor to sign-in from a role-gated route', async ({ page }) => {
    await page.goto(webRoute('/users'));

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('keeps a signed-in user off the sign-in page', async ({ signInPage, page, request }) => {
    const user = await createTestUser(request);

    await signInPage.signIn(user);

    await page.goto(webRoute('/sign-in'));

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
