export enum GgufValueType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

/** A string and an array are absent: both carry their own length. */
export const FIXED_WIDTHS = new Map<GgufValueType, number>([
  [GgufValueType.UINT8, 1],
  [GgufValueType.INT8, 1],
  [GgufValueType.BOOL, 1],
  [GgufValueType.UINT16, 2],
  [GgufValueType.INT16, 2],
  [GgufValueType.UINT32, 4],
  [GgufValueType.INT32, 4],
  [GgufValueType.FLOAT32, 4],
  [GgufValueType.UINT64, 8],
  [GgufValueType.INT64, 8],
  [GgufValueType.FLOAT64, 8],
]);
