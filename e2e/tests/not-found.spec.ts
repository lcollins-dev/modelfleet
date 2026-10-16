import { expect, test } from '../fixtures/test';
import { webRoute } from '../utils/urls';

test.describe('page not found', () => {
  test('shows the not-found page for a route that does not exist', async ({ page }) => {
    await page.goto(webRoute('/a-route-that-does-not-exist'));

    await expect(page.getByText('Page not found')).toBeVisible();
  });

  test('offers a way back to the site', async ({ page }) => {
    await page.goto(webRoute('/a-route-that-does-not-exist'));

    await page.getByRole('link', { name: 'Go to Overview', exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('offers the way back to the keyboard', async ({ page }) => {
    await page.goto(webRoute('/a-route-that-does-not-exist'));

    await page.getByRole('link', { name: 'Go to Overview', exact: true }).focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
