import { describe, expect, it } from 'vitest';

import { BackendId, declarationFor } from '@libs/backends';

import { configurationGroupDescription, configurationGroupIcon } from './groups';

describe('configurationGroupIcon and configurationGroupDescription', () => {
  it('presents every group the backend declares, so no section renders bare', () => {
    for (const group of declarationFor(BackendId.LLAMA_CPP).groups) {
      expect(configurationGroupDescription(group.group).length).toBeGreaterThan(0);
    }
  });

  it('falls back rather than failing on a group it has no presentation for', () => {
    expect(configurationGroupIcon('sampling')).toBeDefined();
    expect(configurationGroupDescription('sampling')).toBe('');
  });
});
