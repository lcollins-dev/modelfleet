import { BackendId } from '../backend-id';
import { BackendConfiguration } from '../configuration';
import { IInstancePins } from '../launch';
import { IModelMetadata } from './estimate';

/** The label the agent re-adopts a running container by, rather than reading the database. */
export const INSTANCE_LABEL = 'modelfleet.instance';

/** Tells one backend's orphaned container from another's during a sweep. */
export const BACKEND_LABEL = 'modelfleet.backend';

/** An ordinal has no field here, so nothing downstream can translate one. */
export interface IContainerDevice {
  /** The vendor UUID, the same identity a GPU row and telemetry both carry. */
  deviceKey: string;
}

export interface IContainerMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

/** Everything the renderer is given to specify a container. It reads nothing beyond this and the definition. */
export interface IContainerInput {
  /** Labels the container, so the agent re-adopts it by label after a restart. */
  instanceKey: string;

  /** The name the backend reports as `model`: the deployment the gateway routes on, not the weights. */
  servedModel: string;

  model: IModelMetadata;
  weights: IModelWeights;

  /** The rest of a split set after the weights' first shard, in order. Empty where the weights are one file. */
  shards: readonly IModelWeights[];

  /** Already resolved to this node's paths, one per model reference field the document applies. */
  companions: readonly IModelCompanion[];

  configuration: BackendConfiguration;

  /** The hardware the placement pinned. Its cards become the container's device requests. */
  pins: IInstancePins;

  /** By device key. A card the node has not read is absent. */
  gpuTotalBytes: ReadonlyMap<string, number>;

  /** Resolved by the server: the document's, else the definition's for the placement's variant. Tag included. */
  image: string;
}

export interface IContainerSpecification {
  /** Pulled and run as written, so it carries its tag. */
  image: string;

  /** Absent keeps the image's own. */
  entrypoint?: readonly string[];

  command: readonly string[];
  environment: Readonly<Record<string, string>>;
  devices: readonly IContainerDevice[];
  mounts: readonly IContainerMount[];
  labels: Readonly<Record<string, string>>;

  /** The port the backend listens on inside the container. */
  port: number;
}

export function instanceLabels(backend: BackendId, instanceKey: string): Record<string, string> {
  return { [INSTANCE_LABEL]: instanceKey, [BACKEND_LABEL]: backend };
}

export interface IModelWeights {
  /** The node's own path: the first shard, or the directory where the format is one. */
  hostPath: string;

  containerPath: string;
}

export interface IModelCompanion extends IModelWeights {
  /** The model reference field's document key, which ties the path to the flag that writes it. */
  field: string;
}
