import { configuredValues, IConfiguredValues } from '../../configuration';
import { IVramEstimate, IVramEstimateInput } from '../../runtime/estimate';
import { IVramSizing, VramSizingHook } from '../../runtime/sizing';
import { LlamaCppField } from './declaration';
import { llamaCppVramEstimate, mirroredKvBytes } from './estimate';

const TENSOR_REFUSAL_REASON = 'Tensor mode requires the whole model in VRAM';

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

  if (splitMode === 'tensor') {
    return tensorSizing(input, values, estimate, splitTotal > 0 ? split : input.devices.map(() => 1));
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

function tensorSizing(
  input: IVramEstimateInput,
  values: IConfiguredValues,
  estimate: IVramEstimate,
  split: number[]
): IVramSizing {
  if (!estimate.computed) {
    return { estimate, cardShares: split, cardsOnlyReason: TENSOR_REFUSAL_REASON };
  }

  const mirrored = mirroredKvBytes(input, values);
  const splitTotal = split.reduce((sum, share) => sum + share, 0);
  const perCard = (estimate.overheadBytes + mirrored) / input.devices.length;
  const shared = estimate.totalBytes - estimate.overheadBytes - mirrored;

  return {
    estimate,
    cardShares: split.map(share => Math.round(perCard + (shared * share) / splitTotal)),
    cardsOnlyReason: TENSOR_REFUSAL_REASON,
  };
}
