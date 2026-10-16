import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

const EXPAND_ATTEMPTS = 40;

export class EventsPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Event log', exact: true });
  }

  get severitySelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Severity', exact: true });
  }

  get listItems(): Locator {
    return this.page.getByTestId('event-row');
  }

  get detailRows(): Locator {
    return this.listItems.getByTestId('table-row-expand');
  }

  listItemByText(text: string): Locator {
    return this.listItems.filter({ hasText: text });
  }

  detailByText(text: string): Locator {
    return this.detailRows.filter({ hasText: text });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/events'));
  }

  /** Also opens rows that arrive over the live stream while it runs. */
  async expandAll(): Promise<void> {
    const collapsed = this.listItems.locator('button[aria-expanded="false"]');

    for (let attempt = 0; attempt < EXPAND_ATTEMPTS; attempt += 1) {
      if ((await collapsed.count()) === 0) {
        return;
      }

      await collapsed.first().click();
    }
  }

  async filterBySeverity(severity: string): Promise<void> {
    await this.severitySelect.click();

    await this.page.getByRole('option', { name: severity, exact: true }).click();
    await this.severitySelect.press('Escape');
  }
}
