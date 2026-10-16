import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class NodeRegisterPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Register node', exact: true });
  }

  get nameInput(): Locator {
    return this.page.getByLabel('Name', { exact: true });
  }

  get registerButton(): Locator {
    return this.page.getByRole('button', { name: 'Register Node', exact: true });
  }

  get credentialsDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Node registered' });
  }

  get shownOnceWarning(): Locator {
    return this.credentialsDialog.getByText('The secret is shown once.', { exact: true });
  }

  get copyButtons(): Locator {
    return this.credentialsDialog.getByRole('button', { name: 'Copy', exact: true });
  }

  get openNodeButton(): Locator {
    return this.credentialsDialog.getByRole('button', { name: 'Open Node', exact: true });
  }

  get doneButton(): Locator {
    return this.credentialsDialog.getByRole('button', { name: 'Done', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/nodes/register'));
  }

  async register(name: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.registerButton.click();
  }
}
