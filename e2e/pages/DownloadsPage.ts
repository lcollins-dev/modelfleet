import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class DownloadsPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Downloads', exact: true });
  }

  get newButton(): Locator {
    return this.page.getByRole('main').getByRole('link', { name: 'New Download', exact: true });
  }

  downloadForRepository(repository: string): Locator {
    return this.page.getByTestId('download').filter({ hasText: repository });
  }

  get searchInput(): Locator {
    return this.page.getByPlaceholder('Search downloads', { exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/downloads'));
  }
}
