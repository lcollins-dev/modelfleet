import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigurationValueService } from '@/core/configuration/configuration-value.service';

describe('ConfigurationValueService', () => {
  let configurationValueService: ConfigurationValueService;

  beforeEach(() => {
    configurationValueService = new ConfigurationValueService();
  });

  describe('isEqual', () => {
    it('reads a key set to null as different from one left absent', () => {
      expect(configurationValueService.isEqual(null, undefined)).toBe(false);
    });

    it('separates a null from the text that spells it', () => {
      expect(configurationValueService.isEqual(null, 'null')).toBe(false);
    });

    it('separates an absent key from the text the sentinel spells', () => {
      expect(configurationValueService.isEqual(undefined, 'absent')).toBe(false);
    });

    it('separates a number from the text that spells it', () => {
      expect(configurationValueService.isEqual(8, '8')).toBe(false);
    });

    it('separates an empty mapping from an empty list', () => {
      expect(configurationValueService.isEqual({}, [])).toBe(false);
    });

    it('matches a nested mapping written in another key order', () => {
      expect(
        configurationValueService.isEqual(
          { nodeIds: [1, 2], spreadAcrossNodes: true },
          { spreadAcrossNodes: true, nodeIds: [1, 2] }
        )
      ).toBe(true);
    });

    it('separates a nested mapping that gained a key', () => {
      expect(configurationValueService.isEqual({ nodeIds: [1] }, { nodeIds: [1], spreadAcrossNodes: true })).toBe(
        false
      );
    });

    it('keeps the order of a list, since a list is one value', () => {
      expect(configurationValueService.isEqual([0.5, 0.5], [0.5, 0.5])).toBe(true);
      expect(configurationValueService.isEqual([0.5, 0.5], [1, 0])).toBe(false);
    });
  });

  describe('canonical', () => {
    it('gives a mapping the same string whichever order its keys were written in', () => {
      expect(configurationValueService.canonical({ threads: 8, image: 'llama' })).toBe(
        configurationValueService.canonical({ image: 'llama', threads: 8 })
      );
    });
  });
});
