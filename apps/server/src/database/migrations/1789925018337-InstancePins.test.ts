import { describe, expect, it } from 'vitest';

import { InstancePins1789925018337 } from './1789925018337-InstancePins';

const migration = new InstancePins1789925018337();

describe('InstancePins1789925018337', () => {
  describe('withoutGpuLayers', () => {
    it('drops the key with the comment written above it, and keeps the rest in order', () => {
      const document = [
        '# The chat deployment',
        'contextSize: 8192',
        '',
        '# offload as much as the card takes',
        'gpuLayers: 33',
        'splitMode: layer',
        '',
      ].join('\n');

      expect(migration.withoutGpuLayers(document)).toBe(
        ['# The chat deployment', 'contextSize: 8192', 'splitMode: layer', ''].join('\n')
      );
    });

    it('keeps a comment written above a key it is not removing', () => {
      const document = ['gpuLayers: 33', '', '# one slot per caller', 'parallel: 4', ''].join('\n');

      expect(migration.withoutGpuLayers(document)).toContain('# one slot per caller');
    });

    it('leaves a document that never held the key untouched, byte for byte', () => {
      const document = ['replicas: 2', '', 'placement:', '  gpus:', '    - nodeId: 1', ''].join('\n');

      expect(migration.withoutGpuLayers(document)).toBe(document);
    });

    it('keeps a nested block and the keys under it', () => {
      const document = [
        'gpuLayers: 33',
        'placement:',
        '  nodeIds:',
        '    - 1',
        '  gpus:',
        '    - nodeId: 1',
        '      deviceKey: GPU-1',
        '',
      ].join('\n');

      const rewritten = migration.withoutGpuLayers(document);

      expect(rewritten).not.toContain('gpuLayers');
      expect(rewritten).toContain('deviceKey: GPU-1');
      expect(rewritten).toContain('nodeIds:');
    });

    it('drops the key wherever it is indented, since YAML allows a leading run of spaces', () => {
      expect(migration.withoutGpuLayers('  gpuLayers: 33\n  contextSize: 8192\n')).not.toContain('gpuLayers');
    });

    it('leaves a key that only reads like it alone', () => {
      const document = 'cpuMoeLayers: 4\nextraFlags:\n  - --gpu-layers 33\n';

      expect(migration.withoutGpuLayers(document)).toBe(document);
    });

    it('empties a document the key was the whole of, rather than leaving a flow map behind', () => {
      expect(migration.withoutGpuLayers('gpuLayers: 33\n')).toBe('');
    });

    it('leaves a document that is not a mapping alone', () => {
      expect(migration.withoutGpuLayers('')).toBe('');
      expect(migration.withoutGpuLayers('- one\n- two\n')).toBe('- one\n- two\n');
    });
  });
});
