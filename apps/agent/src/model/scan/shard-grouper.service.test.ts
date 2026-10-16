import { describe, expect, it } from 'vitest';

import { ShardGrouperService } from '@/model/scan/shard-grouper.service';

describe('ShardGrouperService', () => {
  const shardGrouperService = new ShardGrouperService();

  describe('parseName', () => {
    it('reads the base, the index and the total off a numbered name', () => {
      expect(shardGrouperService.parseName('qwen-Q4_K_M-00002-of-00003.gguf', '.gguf')).toEqual({
        base: 'qwen-Q4_K_M',
        index: 2,
        total: 3,
      });
    });

    it('matches the suffix in any case', () => {
      expect(shardGrouperService.parseName('qwen-00001-of-00002.GGUF', '.gguf')).toEqual({
        base: 'qwen',
        index: 1,
        total: 2,
      });
    });

    it('reads nothing off a name without numbering, another suffix, or numbering no set could have', () => {
      expect(shardGrouperService.parseName('qwen-Q4_K_M.gguf', '.gguf')).toBeNull();
      expect(shardGrouperService.parseName('qwen-00001-of-00002.safetensors', '.gguf')).toBeNull();
      expect(shardGrouperService.parseName('qwen-00004-of-00003.gguf', '.gguf')).toBeNull();
      expect(shardGrouperService.parseName('qwen-00000-of-00003.gguf', '.gguf')).toBeNull();
    });
  });

  describe('siblingName', () => {
    it('renumbers a name, keeping its own case', () => {
      expect(shardGrouperService.siblingName('Qwen-00001-OF-00003.GGUF', '.gguf', 3)).toBe('Qwen-00003-OF-00003.GGUF');
    });

    it('leaves a name without numbering as it is', () => {
      expect(shardGrouperService.siblingName('qwen.gguf', '.gguf', 2)).toBe('qwen.gguf');
    });
  });

  describe('memberName', () => {
    it('writes each member of a set with the numbering zero-padded to five digits, as llama.cpp does', () => {
      const shardName = { base: 'qwen-Q4_K_M', index: 1, total: 12 };

      expect(shardGrouperService.memberName({ ...shardName, index: 11 }, '.gguf')).toBe(
        'qwen-Q4_K_M-00011-of-00012.gguf'
      );
    });

    it('writes the numbering and the suffix in lower case whatever the base', () => {
      expect(shardGrouperService.memberName({ base: 'QWEN', index: 2, total: 3 }, '.gguf')).toBe(
        'QWEN-00002-of-00003.gguf'
      );
    });

    it('reads back what it writes', () => {
      const shardName = { base: 'qwen', index: 3, total: 3 };

      expect(shardGrouperService.parseName(shardGrouperService.memberName(shardName, '.gguf'), '.gguf')).toEqual(
        shardName
      );
    });
  });
});
