import { type Locator, type Page } from '@playwright/test';

export class HeaderMenu {
  constructor(private readonly page: Page) {}

  get userMenu(): Locator {
    return this.page.getByTestId('user-menu');
  }

  option(label: string): Locator {
    return this.page.getByRole('menuitem', { name: label, exact: true });
  }

  async select(label: string): Promise<void> {
    await this.userMenu.click();
    await this.option(label).click();
  }
}
