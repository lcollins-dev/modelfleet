import { describe, expect, it } from 'vitest';

import { paginationSlots } from './paginationSlots';

describe('paginationSlots', () => {
  it('lists every page when there are nine or fewer', () => {
    expect(paginationSlots(1, 1)).toEqual([1]);
    expect(paginationSlots(4, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('runs the first pages up to a gap before the last near the start', () => {
    expect(paginationSlots(5, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 20]);
  });

  it('runs from a gap after the first to the last pages near the end', () => {
    expect(paginationSlots(16, 20)).toEqual([1, null, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('opens a gap on each side once the current page is past the first five or last five', () => {
    expect(paginationSlots(6, 20)).toEqual([1, null, 4, 5, 6, 7, 8, null, 20]);
    expect(paginationSlots(15, 20)).toEqual([1, null, 13, 14, 15, 16, 17, null, 20]);
  });

  it('centres the current page between two gaps in the middle', () => {
    expect(paginationSlots(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
  });
});
