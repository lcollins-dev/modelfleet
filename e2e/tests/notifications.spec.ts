import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';

test.describe('notifications', () => {
  test('lists the notifications of the signed-in user', async ({ dashboardPage, notificationsPanel }) => {
    await dashboardPage.goto();
    await notificationsPanel.open();

    await expect(notificationsPanel.panel).toBeVisible();
    await expect(notificationsPanel.panel).toContainText('Notifications');
  });

  test.describe('a user with nothing waiting', () => {
    test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

    test('sees the empty state', async ({ signInPage, notificationsPanel, request }) => {
      const user = await createTestUser(request);

      await signInPage.signIn(user);
      await notificationsPanel.open();

      await expect(notificationsPanel.emptyState).toBeVisible();
    });
  });
});
