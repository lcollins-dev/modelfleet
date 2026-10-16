import { expect, test } from '../fixtures/test';
import { webRoute } from '../utils/urls';

test.describe('navigation', () => {
  test('opens the app authenticated and does not bounce to sign-in', async ({ page }) => {
    await page.goto(webRoute('/dashboard'));

    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test('reaches the dashboard from an authenticated session', async ({ dashboardPage, page }) => {
    await dashboardPage.goto();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(dashboardPage.heading).toBeVisible();
  });
});
