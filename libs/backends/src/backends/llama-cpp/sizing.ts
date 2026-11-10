import { configuredValues, IConfiguredValues } from '../../configuration';
import { MIB } from '../../definition';
import { IVramEstimate, IVramEstimateInput } from '../../runtime/estimate';
import { IVramSizing, VramSizingHook } from '../../runtime/sizing';
import { LlamaCppField } from './declaration';
import { llamaCppVramEstimate, mirroredBytes } from './estimate';
import { overridesTensors } from './override-tensor';

const TENSOR_REFUSAL_REASON = 'Tensor mode requires the whole model in VRAM';
const FIT_OFF_REASON = 'A tensor split or tensor override turns off automatic fitting, so layers cannot spill to RAM';

export const llamaCppSizeVram: VramSizingHook = (input, declaration) => {
  const values = configuredValues(declaration, input.configuration);
  const sizing = placedSizing(input, values);
  const headroomBytes = fitTargetBytes(input, values);

  return headroomBytes === undefined ? sizing : { ...sizing, headroomBytes };
};

function configuredSplit(input: IVramEstimateInput, values: IConfiguredValues): number[] {
  const configured = values.numberList(LlamaCppField.TENSOR_SPLIT) ?? [];

  return input.devices.map((_, card) => configured[card] ?? 0);
}

function totalOf(split: number[]): number {
  return split.reduce((sum, share) => sum + share, 0);
}

/** llama.cpp holds a `none` launch to one device, and applies a split only across several. */
function fitOff(input: IVramEstimateInput, values: IConfiguredValues): boolean {
  const splitMode = values.text(LlamaCppField.SPLIT_MODE) ?? 'layer';
  const splitApplies = splitMode !== 'none' && input.devices.length > 1 && totalOf(configuredSplit(input, values)) > 0;

  return splitMode === 'tensor' || splitApplies || overridesTensors(values);
}

function fitTargetBytes(input: IVramEstimateInput, values: IConfiguredValues): number | undefined {
  const target = values.number(LlamaCppField.FIT_TARGET);

  return target === undefined || fitOff(input, values) ? undefined : target * MIB;
}

function placedSizing(input: IVramEstimateInput, values: IConfiguredValues): IVramSizing {
  const estimate = llamaCppVramEstimate(input, values);
  const splitMode = values.text(LlamaCppField.SPLIT_MODE) ?? 'layer';
  const split = configuredSplit(input, values);
  const splitTotal = totalOf(split);
  const fitIsOff = fitOff(input, values);

  if (splitMode === 'none') {
    return {
      estimate,
      cardShares: split.map((_, card) => (card === 0 ? 1 : 0)),
      ...spillOf(input, fitIsOff),
    };
  }

  if (splitMode === 'tensor') {
    return tensorSizing(input, values, estimate, splitTotal > 0 ? split : input.devices.map(() => 1));
  }

  // llama.cpp reads a split with nothing in it as no split.
  if (splitMode !== 'layer' || splitTotal <= 0) {
    return { estimate, cardShares: null, ...spillOf(input, fitIsOff), balancedOnFreeMemory: true };
  }

  if (!estimate.computed) {
    return { estimate, cardShares: split, ...spillOf(input, fitIsOff) };
  }

  const perCard = estimate.overheadBytes / input.devices.length;
  const shared = estimate.totalBytes - estimate.overheadBytes;

  return {
    estimate,
    cardShares: split.map(share => Math.round(perCard + (shared * share) / splitTotal)),
    ...spillOf(input, fitIsOff),
  };
}

/** A CPU pin permits RAM offload only when llama.cpp's automatic fitting is enabled. */
function spillOf(
  input: IVramEstimateInput,
  fitOff: boolean
): Pick<IVramSizing, 'cardsOnlyReason' | 'balancedOnFreeMemory'> {
  if (input.cpuPinned !== true) {
    return {};
  }

  return fitOff ? { cardsOnlyReason: FIT_OFF_REASON } : { balancedOnFreeMemory: true };
}

function tensorSizing(
  input: IVramEstimateInput,
  values: IConfiguredValues,
  estimate: IVramEstimate,
  split: number[]
): IVramSizing {
  if (!estimate.computed) {
    return { estimate, cardShares: split, cardsOnlyReason: TENSOR_REFUSAL_REASON };
  }

  const mirrored = mirroredBytes(input, values);
  const splitTotal = totalOf(split);
  const perCard = (estimate.overheadBytes + mirrored) / input.devices.length;
  const shared = estimate.totalBytes - estimate.overheadBytes - mirrored;

  return {
    estimate,
    cardShares: split.map(share => Math.round(perCard + (shared * share) / splitTotal)),
    cardsOnlyReason: TENSOR_REFUSAL_REASON,
  };
}
