import { configuredValues } from '../../configuration';
import { VramSizingHook } from '../../runtime/sizing';
import { LlamaCppField } from './declaration';
import { llamaCppVramEstimate } from './estimate';

export const llamaCppSizeVram: VramSizingHook = (input, declaration) => {
  const values = configuredValues(declaration, input.configuration);
  const estimate = llamaCppVramEstimate(input, values);
  const splitMode = values.text(LlamaCppField.SPLIT_MODE) ?? 'layer';
  const configured = values.numberList(LlamaCppField.TENSOR_SPLIT) ?? [];
  const split = input.devices.map((_, card) => configured[card] ?? 0);
  const splitTotal = split.reduce((sum, share) => sum + share, 0);

  if (splitMode === 'none') {
    return { estimate, cardShares: split.map((_, card) => (card === 0 ? 1 : 0)) };
  }

  // llama.cpp reads a split with nothing in it as no split.
  if (splitMode !== 'layer' || splitTotal <= 0) {
    return { estimate, cardShares: null };
  }

  if (!estimate.computed) {
    return { estimate, cardShares: split };
  }

  const perCard = estimate.overheadBytes / input.devices.length;
  const shared = estimate.totalBytes - estimate.overheadBytes;

  return { estimate, cardShares: split.map(share => Math.round(perCard + (shared * share) / splitTotal)) };
};
