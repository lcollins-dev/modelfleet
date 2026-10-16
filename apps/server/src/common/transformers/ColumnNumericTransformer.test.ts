import { describe, expect, it } from 'vitest';

import { ColumnNumericTransformer } from './ColumnNumericTransformer';

describe('ColumnNumericTransformer', () => {
  const transformer = new ColumnNumericTransformer();

  describe('to', () => {
    it('passes numbers through unchanged', () => {
      expect(transformer.to(42)).toBe(42);
    });

    it('passes null through unchanged', () => {
      expect(transformer.to(null)).toBeNull();
    });
  });

  describe('from', () => {
    it('parses a numeric string to a number', () => {
      expect(transformer.from('3.14')).toBe(3.14);
    });

    it('returns null when the value is null', () => {
      expect(transformer.from(null)).toBeNull();
    });
  });
});
