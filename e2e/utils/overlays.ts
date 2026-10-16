import { expect, type Page } from '@playwright/test';

// A closing Naive drawer's mask lingers through its animation and intercepts clicks meant for the page behind it.
export const expectDrawerClosed = (page: Page): Promise<void> => expect(page.locator('.n-drawer-mask')).toHaveCount(0);
