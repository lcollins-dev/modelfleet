import { describe, expect, it } from 'vitest';

import { LlamaCppRowSplit1793713187976 } from './1793713187976-LlamaCppRowSplit';

const migration = new LlamaCppRowSplit1793713187976();

describe('LlamaCppRowSplit1793713187976', () => {
  describe('withLayerSplit', () => {
    it('replaces a row split with a layer split and keeps the comments and order around it', () => {
      const document = [
        '# two cards',
        'contextSize: 8192',
        '',
        '# split by rows',
        'splitMode: row # faster on our cards',
        'tensorSplit:',
        '  - 1',
        '  - 1',
        '',
      ].join('\n');

      expect(migration.withLayerSplit(document)).toBe(
        [
          '# two cards',
          'contextSize: 8192',
          '',
          '# split by rows',
          'splitMode: layer # faster on our cards',
          'tensorSplit:',
          '  - 1',
          '  - 1',
          '',
        ].join('\n')
      );
    });

    it('leaves a document with any other split untouched, byte for byte', () => {
      const document = ['splitMode:   tensor', 'contextSize: 4096', ''].join('\n');

      expect(migration.withLayerSplit(document)).toBe(document);
    });

    it('leaves a document without a split untouched', () => {
      expect(migration.withLayerSplit('replicas: 2\n')).toBe('replicas: 2\n');
      expect(migration.withLayerSplit('')).toBe('');
    });
  });
});
