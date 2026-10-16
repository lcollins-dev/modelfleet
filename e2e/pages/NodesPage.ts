import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class NodesPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Nodes', exact: true });
  }

  get searchInput(): Locator {
    return this.page.getByPlaceholder('Search nodes', { exact: true });
  }

  get addButton(): Locator {
    return this.page.getByRole('main').getByRole('link', { name: 'Register Node', exact: true });
  }

  get listItems(): Locator {
    return this.page.getByTestId('node-row');
  }

  stateFilter(label: string): Locator {
    return this.page.getByRole('radio', { name: label, exact: true });
  }

  listItemByName(name: string): Locator {
    return this.listItems.filter({ hasText: name });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/nodes'));
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }
}
