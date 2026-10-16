export interface ITensorType {
  name: string;

  /** Match ggml's type traits, so a tensor sizes to the bytes llama.cpp loads. */
  blockSize: number;
  blockBytes: number;
}

/** `ggml_type`, whose value a tensor info entry holds. Its numbering has gaps: a retired number is never reused. */
export const TENSOR_TYPES = new Map<number, ITensorType>([
  [0, { name: 'F32', blockSize: 1, blockBytes: 4 }],
  [1, { name: 'F16', blockSize: 1, blockBytes: 2 }],
  [2, { name: 'Q4_0', blockSize: 32, blockBytes: 18 }],
  [3, { name: 'Q4_1', blockSize: 32, blockBytes: 20 }],
  [6, { name: 'Q5_0', blockSize: 32, blockBytes: 22 }],
  [7, { name: 'Q5_1', blockSize: 32, blockBytes: 24 }],
  [8, { name: 'Q8_0', blockSize: 32, blockBytes: 34 }],
  [9, { name: 'Q8_1', blockSize: 32, blockBytes: 36 }],
  [10, { name: 'Q2_K', blockSize: 256, blockBytes: 84 }],
  [11, { name: 'Q3_K', blockSize: 256, blockBytes: 110 }],
  [12, { name: 'Q4_K', blockSize: 256, blockBytes: 144 }],
  [13, { name: 'Q5_K', blockSize: 256, blockBytes: 176 }],
  [14, { name: 'Q6_K', blockSize: 256, blockBytes: 210 }],
  [15, { name: 'Q8_K', blockSize: 256, blockBytes: 292 }],
  [16, { name: 'IQ2_XXS', blockSize: 256, blockBytes: 66 }],
  [17, { name: 'IQ2_XS', blockSize: 256, blockBytes: 74 }],
  [18, { name: 'IQ3_XXS', blockSize: 256, blockBytes: 98 }],
  [19, { name: 'IQ1_S', blockSize: 256, blockBytes: 50 }],
  [20, { name: 'IQ4_NL', blockSize: 32, blockBytes: 18 }],
  [21, { name: 'IQ3_S', blockSize: 256, blockBytes: 110 }],
  [22, { name: 'IQ2_S', blockSize: 256, blockBytes: 82 }],
  [23, { name: 'IQ4_XS', blockSize: 256, blockBytes: 136 }],
  [24, { name: 'I8', blockSize: 1, blockBytes: 1 }],
  [25, { name: 'I16', blockSize: 1, blockBytes: 2 }],
  [26, { name: 'I32', blockSize: 1, blockBytes: 4 }],
  [27, { name: 'I64', blockSize: 1, blockBytes: 8 }],
  [28, { name: 'F64', blockSize: 1, blockBytes: 8 }],
  [29, { name: 'IQ1_M', blockSize: 256, blockBytes: 56 }],
  [30, { name: 'BF16', blockSize: 1, blockBytes: 2 }],
  [34, { name: 'TQ1_0', blockSize: 256, blockBytes: 54 }],
  [35, { name: 'TQ2_0', blockSize: 256, blockBytes: 66 }],
  [39, { name: 'MXFP4', blockSize: 32, blockBytes: 17 }],
]);
