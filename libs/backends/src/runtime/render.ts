import { backendField } from '../configuration';
import {
  ArgumentGroup,
  COMPANION_PREFIX,
  BackendDefinition,
  PARAM_PREFIX,
  Placeholder,
  fillPlaceholders,
} from '../definition';
import { launchModeOf } from '../launch';
import { CompanionPaths, declaredArguments, fieldValueText } from './arguments';
import { IContainerInput, IContainerMount, IContainerSpecification, instanceLabels } from './specification';
import { stageSharesArguments } from './stages';

type PlaceholderValues = (name: string) => string | undefined;

/** Arguments come out as `argv`, the stage shares, the launch mode's groups, then the declared fields and `extraFlags`. */
export function renderContainer(definition: BackendDefinition, input: IContainerInput): IContainerSpecification {
  const companionPaths: CompanionPaths = new Map(
    input.companions.map(companion => [companion.field, companion.containerPath])
  );
  const valueOf = (name: string): string | undefined => placeholderValue(definition, input, companionPaths, name);
  const launchModeGroups = definition.launchModeArgv[launchModeOf(input.pins)] ?? [];

  return {
    image: input.image,
    ...(definition.entrypoint === undefined ? {} : { entrypoint: definition.entrypoint }),
    command: [
      ...renderGroups(definition.argv, valueOf),
      ...stageSharesArguments(definition, input),
      ...renderGroups(launchModeGroups, valueOf),
      ...declaredArguments(definition.declaration, input.configuration, companionPaths),
    ],
    environment: renderEnvironment(definition.environment, valueOf),
    devices: input.pins.gpus.map(deviceKey => ({ deviceKey })),
    mounts: mounts(input),
    labels: instanceLabels(definition.id, input.instanceKey),
    port: definition.port,
  };
}

function renderGroups(groups: readonly ArgumentGroup[], valueOf: PlaceholderValues): string[] {
  return groups.flatMap(group => {
    const filled = group.map(element => fillPlaceholders(element, valueOf));

    return filled.every(element => element !== undefined) ? filled : [];
  });
}

function renderEnvironment(
  environment: Readonly<Record<string, string>>,
  valueOf: PlaceholderValues
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).flatMap(([name, value]) => {
      const filled = fillPlaceholders(value, valueOf);

      return filled === undefined ? [] : [[name, filled]];
    })
  );
}

function placeholderValue(
  definition: BackendDefinition,
  input: IContainerInput,
  companionPaths: CompanionPaths,
  name: string
): string | undefined {
  const gpus = input.pins.gpus;

  switch (name) {
    case Placeholder.MODEL_PATH:
      return input.weights.containerPath;

    case Placeholder.SERVED_MODEL:
      return input.servedModel;

    case Placeholder.PORT:
      return String(definition.port);

    case Placeholder.GPU_COUNT:
      return gpus.length === 0 ? undefined : String(gpus.length);

    case Placeholder.GPU_IDS:
      return gpus.length === 0 ? undefined : gpus.join(',');
  }

  if (name.startsWith(PARAM_PREFIX)) {
    const field = backendField(definition.declaration, name.slice(PARAM_PREFIX.length));

    return field === undefined ? undefined : fieldValueText(field, input.configuration, companionPaths);
  }

  return name.startsWith(COMPANION_PREFIX) ? companionPaths.get(name.slice(COMPANION_PREFIX.length)) : undefined;
}

function mounts(input: IContainerInput): IContainerMount[] {
  return [input.weights, ...input.shards, ...input.companions].map(file => ({
    hostPath: file.hostPath,
    containerPath: file.containerPath,
    readOnly: true,
  }));
}
