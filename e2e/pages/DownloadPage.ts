import { type Locator, type Page } from '@playwright/test';

import { confirmDialog } from '../utils/dialog';

export class DownloadPage {
  constructor(private readonly page: Page) {}

  get stateTag(): Locator {
    return this.page.getByTestId('download-state');
  }

  get cancelButton(): Locator {
    return this.page.getByTestId('download-cancel');
  }

  get dismissButton(): Locator {
    return this.page.getByRole('button', { name: 'Dismiss', exact: true });
  }

  targetForNode(nodeName: string): Locator {
    return this.page.getByTestId('download-target').filter({ hasText: nodeName });
  }

  async confirmCancel(): Promise<void> {
    await this.cancelButton.click();
    await confirmDialog(this.page);
  }
}
