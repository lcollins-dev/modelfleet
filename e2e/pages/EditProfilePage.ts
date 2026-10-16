import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class EditProfilePage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Profile & security', exact: true });
  }

  get nameInput(): Locator {
    return this.page.getByLabel('Name', { exact: true });
  }

  get emailInput(): Locator {
    return this.page.getByLabel('Email', { exact: true });
  }

  get passwordInput(): Locator {
    return this.page.getByLabel('New password', { exact: true });
  }

  get confirmPasswordInput(): Locator {
    return this.page.getByLabel('Confirm password', { exact: true });
  }

  get saveButton(): Locator {
    return this.page.getByRole('button', { name: 'Save', exact: true });
  }

  get changePasswordButton(): Locator {
    return this.page.getByRole('button', { name: 'Change Password', exact: true });
  }

  get fieldError(): Locator {
    return this.page.getByTestId('field-error');
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/edit-profile'));
  }
}
