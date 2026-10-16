import { describe, expect, it } from 'vitest';

import { VllmOmniMemoryGib1792014138968 } from './1792014138968-VllmOmniMemoryGib';

const migration = new VllmOmniMemoryGib1792014138968();

describe('VllmOmniMemoryGib1792014138968', () => {
  describe('withoutShare', () => {
    it('drops the share with its comment and keeps the rest in order', () => {
      const document = [
        '# speech',
        'replicas: 1',
        '',
        '# half the card',
        'gpuMemoryUtilization: 0.5',
        'enforceEager: true',
        '',
      ].join('\n');

      expect(migration.withoutShare(document)).toBe(['# speech', 'replicas: 1', 'enforceEager: true', ''].join('\n'));
    });

    it('leaves a document without the share untouched, byte for byte', () => {
      const document = ['replicas: 2', '', 'placement:', '  nodeIds:', '    - 1', ''].join('\n');

      expect(migration.withoutShare(document)).toBe(document);
    });

    it('leaves an empty document where the share was all it held', () => {
      expect(migration.withoutShare('gpuMemoryUtilization: 0.6\n')).toBe('');
    });
  });
});
