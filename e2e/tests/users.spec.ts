import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { TEST_PASSWORD } from '../utils/users';

test.describe('users', () => {
  test('narrows the list to a searched user', async ({ usersPage, request }) => {
    const user = await createTestUser(request);
    const other = await createTestUser(request);

    await usersPage.goto();
    await expect(usersPage.heading).toBeVisible();

    await usersPage.search(user.email);

    await expect(usersPage.rowByEmail(user.email)).toBeVisible();
    await expect(usersPage.rowByEmail(other.email)).toHaveCount(0);
  });

  test('opens a user from the list', async ({ usersPage, userPage, page, request }) => {
    const user = await createTestUser(request);

    await usersPage.goto();
    await usersPage.search(user.email);
    await usersPage.rowByEmail(user.email).click();

    await expect(page).toHaveURL(new RegExp(`/users/${user.id}$`));
    await expect(userPage.emailInput).toHaveValue(user.email);
  });

  test('creates a user and lands on the new record', async ({ usersPage, userCreatePage, userPage, page }) => {
    const email = `e2e-created-${Date.now()}@modelfleet.test`;

    await usersPage.goto();
    await usersPage.addButton.click();

    await expect(page).toHaveURL(/\/users\/create$/);
    await expect(userCreatePage.heading).toBeVisible();

    await userCreatePage.fill({ name: 'Created In E2E', email, password: TEST_PASSWORD });
    await userCreatePage.submitButton.click();

    await expect(page).toHaveURL(/\/users\/\d+$/);
    await expect(userPage.nameInput).toHaveValue('Created In E2E');
    await expect(userPage.emailInput).toHaveValue(email);
  });

  test('renames a user from the detail page', async ({ userPage, page, request }) => {
    const user = await createTestUser(request);

    await userPage.goto(user.id);
    await userPage.nameInput.fill('Renamed By Admin');
    await userPage.saveButton.click();

    await expect(page.getByText('Profile updated', { exact: true })).toBeVisible();

    await page.reload();

    await expect(userPage.nameInput).toHaveValue('Renamed By Admin');
  });

  test('disables a user and shows it in the list filters', async ({ userPage, usersPage, page, request }) => {
    const user = await createTestUser(request);

    await userPage.goto(user.id);
    await expect(userPage.stateTag).toHaveText('Enabled');

    await userPage.disable();

    await expect(page.getByText('Account disabled', { exact: true })).toBeVisible();
    await expect(userPage.stateTag).toHaveText('Disabled');

    await usersPage.goto();
    await usersPage.search(user.email);
    await usersPage.filterButton('Enabled').click();

    await expect(usersPage.rowByEmail(user.email)).toHaveCount(0);

    await usersPage.filterButton('Disabled').click();

    await expect(usersPage.rowByEmail(user.email)).toBeVisible();
  });

  test('signs a user out of every session', async ({ userPage, page, request }) => {
    const user = await createTestUser(request);

    await userPage.goto(user.id);
    await userPage.signOutEverywhere();

    await expect(page.getByText('Signed out everywhere', { exact: true })).toBeVisible();
  });
});
