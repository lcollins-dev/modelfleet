import { configuredNumber } from '../configuration';
import { GIB, BackendDefinition, VramSource, stageSharesOf, unlistedStagesMessage } from '../definition';
import { IContainerInput } from './specification';

const SHARE_DECIMALS = 4;

/** Throws for an unlisted architecture even where the document states no size. Placement refuses a card short of it. */
export function stageSharesArguments(definition: BackendDefinition, input: IContainerInput): string[] {
  const { estimate, launch } = definition.vram;

  if (launch === undefined || estimate.source !== VramSource.SIZE) {
    return [];
  }

  const shares = stageSharesOf(launch, input.model.architecture);

  if (shares === undefined) {
    throw new Error(`The model ${unlistedStagesMessage(definition.id, input.model.architecture)}`);
  }

  const gib = configuredNumber(definition.declaration, input.configuration, estimate.gibField);

  if (gib === undefined) {
    return [];
  }

  const fraction = (gib * GIB) / cardTotalBytes(input);
  const sum = shares.reduce((total, share) => total + share, 0);
  // Rounded down, so the stages together never take more than the size.
  const fractions = shares.map(share => roundDown((fraction * share) / sum));

  if (fractions.some(stageFraction => stageFraction <= 0)) {
    throw new Error(`${gib} GiB leaves a stage of the pipeline no share of the card`);
  }

  const entries = fractions.map((stageFraction, stage) => [stage, { [launch.shareKey]: stageFraction }]);

  return [launch.flag, JSON.stringify(Object.fromEntries(entries))];
}

function cardTotalBytes(input: IContainerInput): number {
  const card = input.pins.gpus.at(0);

  if (card === undefined) {
    throw new Error('A pipeline split between stages needs a pinned GPU');
  }

  const total = input.gpuTotalBytes.get(card);

  if (total === undefined || total <= 0) {
    throw new Error(`GPU ${card} has not reported its total memory`);
  }

  return total;
}

function roundDown(value: number): number {
  const scale = 10 ** SHARE_DECIMALS;

  return Math.floor(Number((value * scale).toFixed(SHARE_DECIMALS))) / scale;
}
