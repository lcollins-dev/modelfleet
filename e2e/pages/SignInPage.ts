import { expect, type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';
import { ISignInCredentials, TEST_USER } from '../utils/users';

export class SignInPage {
  constructor(private readonly page: Page) {}

  get emailInput(): Locator {
    return this.page.locator('input[name="email"]');
  }

  get continueButton(): Locator {
    return this.page.getByRole('button', { name: 'Continue', exact: true });
  }

  get identity(): Locator {
    return this.page.getByTestId('identity');
  }

  get passwordInput(): Locator {
    return this.page.locator('input[name="password"]');
  }

  get passwordError(): Locator {
    return this.page.getByTestId('form-field').filter({ has: this.passwordInput }).getByTestId('field-error');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign In', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/sign-in'));
  }

  async enterEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.continueButton.click();
  }

  async enterCredentials(credentials: ISignInCredentials): Promise<void> {
    await this.enterEmail(credentials.email);
    await this.passwordInput.fill(credentials.password);
    await this.submitButton.click();
  }

  async signIn(credentials: ISignInCredentials = TEST_USER): Promise<void> {
    await this.goto();
    await this.enterCredentials(credentials);
    await expect(this.page).not.toHaveURL(/\/sign-in/);
  }
}
