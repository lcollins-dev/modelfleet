import { type APIRequestContext } from '@playwright/test';

import { expect, test } from '../fixtures/test';
import { BASE_URL, webRoute } from '../utils/urls';

const refuseSignIn = async (request: APIRequestContext, email: string): Promise<void> => {
  const response = await request.post(`${BASE_URL}/api/v1/user/login`, {
    data: { email, password: 'wrong-password' },
  });

  expect(response.status()).toBe(400);
};

// The log is append-only and shared, so each spec provokes an event only it can name.
const uniqueEmail = (label: string): string => `${label}-${Date.now()}-${Math.random().toString().slice(2, 6)}@x.test`;

test.describe('events', () => {
  test('lists what the system has recorded', async ({ eventsPage }) => {
    await eventsPage.goto();

    await expect(eventsPage.heading).toBeVisible();
    await expect(eventsPage.listItemByText('User signed in').first()).toBeVisible();
  });

  test('is reachable from the sidebar', async ({ eventsPage, page }) => {
    await page.goto(webRoute('/dashboard'));

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Event log', exact: true }).click();

    await expect(page).toHaveURL(/\/events$/);
    await expect(eventsPage.heading).toBeVisible();
  });

  test('shows an event recorded while it is open', async ({ eventsPage, request }) => {
    const email = uniqueEmail('live');

    await eventsPage.goto();
    await expect(eventsPage.listItems.first()).toBeVisible();

    await refuseSignIn(request, email);

    await expect(eventsPage.listItemByText('User sign in failed').first()).toBeVisible();

    await expect(eventsPage.listItemByText(`Sign-in refused for ${email}`)).toBeVisible();
  });

  test('keeps the structured detail on the row expansion', async ({ eventsPage, request }) => {
    const email = uniqueEmail('detail');

    await refuseSignIn(request, email);

    await eventsPage.goto();

    const row = eventsPage.listItemByText(`Sign-in refused for ${email}`);
    await expect(row).toBeVisible();

    await eventsPage.expandAll();

    await expect(eventsPage.detailByText(email)).toBeVisible();
  });

  test('narrows the list to a severity', async ({ eventsPage, request }) => {
    const email = uniqueEmail('filtered');

    await refuseSignIn(request, email);

    await eventsPage.goto();
    await expect(eventsPage.listItemByText('User signed in').first()).toBeVisible();

    await eventsPage.filterBySeverity('warning');

    await expect(eventsPage.listItemByText('User signed in')).toHaveCount(0);

    await expect(eventsPage.listItemByText(`Sign-in refused for ${email}`)).toBeVisible();
  });
});
