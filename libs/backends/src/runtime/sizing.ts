import { BackendDeclaration } from '../configuration';
import { VramEstimateDefinition, VramSource } from '../definition';
import {
  IVramEstimate,
  IVramEstimateInput,
  configuredShareEstimate,
  configuredSizeEstimate,
  unavailableEstimate,
  weightsOnDiskEstimate,
} from './estimate';

export interface IVramSizing {
  estimate: IVramEstimate;

  /** Each pinned card's share in pin order, read as proportions. Null where the backend balances the cards itself. */
  cardShares: number[] | null;
}

export type VramSizer = (input: IVramEstimateInput) => IVramSizing;

export type VramSizingHook = (input: IVramEstimateInput, declaration: BackendDeclaration) => IVramSizing;

export type BuiltInVramEstimate = Exclude<VramEstimateDefinition, { source: VramSource.HOOK }>;

export function builtInSizing(
  declaration: BackendDeclaration,
  estimate: BuiltInVramEstimate,
  input: IVramEstimateInput
): IVramSizing {
  switch (estimate.source) {
    case VramSource.CONFIGURATION:
      return {
        estimate: configuredShareEstimate(input, declaration, estimate),
        cardShares: configuredShares(input),
      };

    case VramSource.SIZE:
      return { estimate: configuredSizeEstimate(input, declaration, estimate), cardShares: evenShares(input) };

    case VramSource.WEIGHTS:
      return { estimate: weightsOnDiskEstimate(input, estimate), cardShares: null };

    case VramSource.NONE:
      return { estimate: unavailableEstimate([]), cardShares: null };
  }
}

export function configuredShares(input: IVramEstimateInput): number[] | null {
  const totals = input.devices.map(device => device.totalBytes);

  return totals.every(total => total !== null && total > 0) ? totals.map(total => total ?? 0) : null;
}

export function evenShares(input: IVramEstimateInput): number[] {
  return input.devices.map(() => 1);
}
