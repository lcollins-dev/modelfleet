import { type Locator, type Page } from '@playwright/test';

export class NotificationsPanel {
  constructor(private readonly page: Page) {}

  get trigger(): Locator {
    return this.page.getByRole('button', { name: 'Notifications', exact: true });
  }

  get panel(): Locator {
    return this.page.getByTestId('notifications-panel');
  }

  get emptyState(): Locator {
    return this.panel.getByText('No notifications.', { exact: true });
  }

  async open(): Promise<void> {
    await this.trigger.click();
  }
}
