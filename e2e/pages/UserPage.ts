import { type Locator, type Page } from '@playwright/test';

import { confirmDialog } from '../utils/dialog';
import { webRoute } from '../utils/urls';

export class UserPage {
  constructor(private readonly page: Page) {}

  get nameInput(): Locator {
    return this.page.getByLabel('Name', { exact: true });
  }

  get emailInput(): Locator {
    return this.page.getByLabel('Email', { exact: true });
  }

  get stateTag(): Locator {
    return this.page.getByTestId('user-state');
  }

  get saveButton(): Locator {
    return this.page.getByRole('button', { name: 'Save', exact: true });
  }

  get disableButton(): Locator {
    return this.page.getByRole('button', { name: 'Disable account', exact: true });
  }

  get signOutButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign out everywhere', exact: true });
  }

  async goto(userId: number): Promise<void> {
    await this.page.goto(webRoute(`/users/${userId}`));
  }

  async disable(): Promise<void> {
    await this.disableButton.click();
    await confirmDialog(this.page);
  }

  async signOutEverywhere(): Promise<void> {
    await this.signOutButton.click();
    await confirmDialog(this.page);
  }
}
