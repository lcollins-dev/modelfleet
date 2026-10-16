import { describe, expect, it } from 'vitest';

import { formatBytes, formatCount, formatNumber, orderCounts } from './number';

describe('formatNumber', () => {
  it('renders an integer with locale grouping', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('rounds decimals to nearest integer', () => {
    expect(formatNumber(1234.6)).toBe('1,235');
  });
});

describe('formatBytes', () => {
  it('leaves a figure under a kibibyte in bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('climbs to the largest unit the figure fills', () => {
    expect(formatBytes(25_757_220_864)).toBe('24 GiB');
  });

  it('keeps one decimal place where the figure is small enough to need it', () => {
    expect(formatBytes(1_610_612_736)).toBe('1.5 GiB');
  });

  it('drops a trailing zero rather than showing it', () => {
    expect(formatBytes(2_147_483_648)).toBe('2 GiB');
  });

  it('reads zero as zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('floors a negative figure at zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('stops at pebibytes', () => {
    expect(formatBytes(1024 ** 6)).toBe('1024 PiB');
  });
});

describe('orderCounts', () => {
  const counts = new Map([
    ['online', 2],
    ['offline', 0],
    ['disabled', 1],
  ]);

  it('lists each count in the order given, leaving out a zero', () => {
    expect(orderCounts(['disabled', 'offline', 'online'], counts)).toEqual([
      { key: 'disabled', count: 1 },
      { key: 'online', count: 2 },
    ]);
  });

  it('leaves out a key it has no count for', () => {
    expect(orderCounts(['registered'], counts)).toEqual([]);
  });
});

describe('formatCount', () => {
  it('names one in the singular and any other count in the plural', () => {
    expect(formatCount(1, 'GPU')).toBe('1 GPU');
    expect(formatCount(0, 'GPU')).toBe('0 GPUs');
    expect(formatCount(3, 'invalid field')).toBe('3 invalid fields');
  });

  it('takes an irregular plural', () => {
    expect(formatCount(2, 'query', 'queries')).toBe('2 queries');
  });
});
