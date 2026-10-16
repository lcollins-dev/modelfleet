import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class DashboardPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Overview', exact: true });
  }

  get nodesPanel(): Locator {
    return this.page.getByTestId('nodes-card');
  }

  get deploymentsPanel(): Locator {
    return this.page.getByTestId('deployments-card');
  }

  nodeRowByName(name: string): Locator {
    return this.nodesPanel.getByRole('link', { name });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/dashboard'));
  }
}
