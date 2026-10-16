import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class NodePage {
  constructor(private readonly page: Page) {}

  heading(name: string): Locator {
    return this.page.getByRole('heading', { name, exact: true });
  }

  get awaitingFirstContactNotice(): Locator {
    return this.page.getByText('Awaiting first contact', { exact: true });
  }

  get eventLogCard(): Locator {
    return this.page.getByTestId('event-log-card');
  }

  get eventRows(): Locator {
    return this.page.getByTestId('event-row');
  }

  get gpusCard(): Locator {
    return this.page.getByTestId('gpus-card');
  }

  get gpusAwaitingState(): Locator {
    return this.page.getByText('This node has not reported its devices yet.', { exact: true });
  }

  get cpuOnlyNotice(): Locator {
    return this.page.getByText('This node has no GPUs. It will run CPU-only workloads.', {
      exact: true,
    });
  }

  async goto(nodeId: number): Promise<void> {
    await this.page.goto(webRoute(`/nodes/${nodeId}`));
  }
}
