import { describe, expect, it } from 'vitest';

import { isNonCommercialLicence } from '@/core/model/licence';

describe('isNonCommercialLicence', () => {
  it.each([
    'cc-by-nc-4.0',
    'cc-by-nc-sa-4.0',
    'cc-by-nc-nd-3.0',
    'CC-BY-NC-2.0',
    'fair-noncommercial-research-license',
  ])('marks %s', id => {
    expect(isNonCommercialLicence(id)).toBe(true);
  });

  it.each(['mit', 'apache-2.0', 'cc-by-4.0', 'cc-by-sa-4.0', 'llama3.1', 'other'])('leaves %s unmarked', id => {
    expect(isNonCommercialLicence(id)).toBe(false);
  });
});
