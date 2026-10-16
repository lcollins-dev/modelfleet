import { test as base } from '@playwright/test';

import { BASE_URL } from '../utils/urls';

interface IHttpErrorMatch {
  url: RegExp;
  status: number;
}

export interface IErrorGuardFixtures {
  allowHttpError: (match: IHttpErrorMatch) => void;
  allowConsoleError: (pattern: RegExp) => void;
}

export const test = base.extend<IErrorGuardFixtures>({
  allowHttpError: [
    async ({ page }, use, testInfo) => {
      const allowed: IHttpErrorMatch[] = [];
      const violations: string[] = [];

      page.on('response', response => {
        const url = response.url();
        const status = response.status();
        const isAllowed = allowed.some(match => match.status === status && match.url.test(url));

        if (url.startsWith(`${BASE_URL}/api/`) && status >= 400 && !isAllowed) {
          violations.push(`${status} ${response.request().method()} ${url}`);
        }
      });

      await use(match => allowed.push(match));

      if (violations.length > 0) {
        throw new Error(`Unexpected API error response(s) during "${testInfo.title}":\n  ${violations.join('\n  ')}`);
      }
    },
    { auto: true },
  ],
  allowConsoleError: [
    async ({ page }, use, testInfo) => {
      const allowed: RegExp[] = [];
      const violations: string[] = [];

      const record = (source: string, text: string): void => {
        if (!allowed.some(pattern => pattern.test(text))) {
          violations.push(`${source}: ${text}`);
        }
      };

      const isAppOrigin = (): boolean => page.url().startsWith(BASE_URL);

      page.on('console', message => {
        // Resource-load failures belong to the http guard; skip to avoid double-reporting.
        if (isAppOrigin() && message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
          record('console.error', message.text());
        }
      });

      page.on('pageerror', error => {
        if (isAppOrigin()) {
          record('pageerror', error.message);
        }
      });

      await use(pattern => allowed.push(pattern));

      if (violations.length > 0) {
        throw new Error(`Unexpected console error(s) during "${testInfo.title}":\n  ${violations.join('\n  ')}`);
      }
    },
    { auto: true },
  ],
});
