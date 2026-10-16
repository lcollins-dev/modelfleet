import { type Page } from '@playwright/test';

export const confirmDialog = async (page: Page): Promise<void> => {
  await page.getByTestId('dialog').getByTestId('dialog-confirm').click();
};
