const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

export const formatNumber = (value: number): string => Math.round(value).toLocaleString();

export const formatBytes = (bytes: number): string => {
  const value = Math.max(0, bytes);

  let unit = 0;
  let scaled = value;

  while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }

  if (unit === 0) {
    return `${Math.round(scaled)} ${BYTE_UNITS[unit]}`;
  }

  return `${scaled.toFixed(scaled >= 100 ? 0 : 1).replace(/\.0$/, '')} ${BYTE_UNITS[unit]}`;
};

export interface ICount<Key> {
  key: Key;
  count: number;
}

/** Leaves out a zero count. */
export const orderCounts = <Key>(order: Key[], counts: Map<Key, number>): ICount<Key>[] =>
  order.map(key => ({ key, count: counts.get(key) ?? 0 })).filter(entry => entry.count > 0);

export const formatCount = (count: number, noun: string, plural = `${noun}s`): string =>
  `${count} ${count === 1 ? noun : plural}`;
