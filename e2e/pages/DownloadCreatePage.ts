import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class DownloadCreatePage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'New download', exact: true });
  }

  get repositoryInput(): Locator {
    return this.page.getByLabel('Repository or URL', { exact: true });
  }

  file(path: string): Locator {
    return this.page.getByTestId('download-files').getByTestId('picker-row').filter({ hasText: path });
  }

  fileCheckbox(path: string): Locator {
    return this.page.getByTestId('download-files').getByRole('checkbox', { name: path, exact: true });
  }

  nodeCheckbox(nodeName: string): Locator {
    return this.page.getByTestId('download-nodes').getByRole('checkbox', { name: nodeName, exact: true });
  }

  get startButton(): Locator {
    return this.page.getByRole('button', { name: 'Start Download', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/downloads/create'));
  }

  async list(repository: string): Promise<void> {
    await this.repositoryInput.fill(repository);
  }
}
