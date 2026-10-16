import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class BatchJobsPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Batch jobs', exact: true });
  }

  rowByName(name: string): Locator {
    return this.page.getByTestId('job-row').filter({ hasText: name });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/batch-jobs'));
  }
}
