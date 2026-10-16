const SLOT_COUNT = 9;

/** Up to nine page numbers: the first, the last and those around `page`, with `null` for a gap. */
export const paginationSlots = (page: number, pageCount: number): (number | null)[] => {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

  if (pageCount <= SLOT_COUNT) {
    return range(1, pageCount);
  }

  if (page <= 5) {
    return [...range(1, 7), null, pageCount];
  }

  if (page >= pageCount - 4) {
    return [1, null, ...range(pageCount - 6, pageCount)];
  }

  return [1, null, ...range(page - 2, page + 2), null, pageCount];
};
