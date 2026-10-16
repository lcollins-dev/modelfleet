import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class BatchJobPage {
  constructor(private readonly page: Page) {}

  get state(): Locator {
    return this.page.getByTestId('job-state');
  }

  get toggle(): Locator {
    return this.page.getByRole('switch');
  }

  get runNow(): Locator {
    return this.page.getByRole('button', { name: 'Run Now' });
  }

  get confirmRunNow(): Locator {
    return this.page.getByTestId('dialog').getByTestId('dialog-confirm');
  }

  get runs(): Locator {
    return this.page.getByTestId('job-run');
  }

  get runCount(): Locator {
    return this.page.getByTestId('run-count');
  }

  get noRuns(): Locator {
    return this.page.getByText("This job hasn't run yet.");
  }

  runError(run: Locator): Locator {
    return run.getByTestId('job-run-error');
  }

  async goto(batchJobId: number): Promise<void> {
    await this.page.goto(webRoute(`/batch-jobs/${batchJobId}`));
  }
}
