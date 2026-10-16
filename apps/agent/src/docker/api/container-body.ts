import Docker from 'dockerode';

import { DevicePresentation, ContainerSettings } from '@libs/backends';
import { IContainerSpecification } from '@libs/backends/runtime';

const CONTAINER_NAME_PREFIX = 'modelfleet-';

const VISIBLE_DEVICES_VARIABLE = 'NVIDIA_VISIBLE_DEVICES';

/** CUDA otherwise numbers the devices a request exposes fastest first, then by bus. */
const CUDA_ORDER_VARIABLE = 'CUDA_VISIBLE_DEVICES';

const GPU_CAPABILITY = 'gpu';

/** The container toolkit's own driver name, which is what selects a device by UUID rather than by ordinal. */
const DEVICE_DRIVER = 'nvidia';

export interface IContainerBodyInput {
  instanceKey: string;
  specification: IContainerSpecification;
  container: ContainerSettings;

  /** Carried alongside the specification's own, and how a restarted agent recognises the container. */
  labels: Readonly<Record<string, string>>;

  /** The only route to a backend, since nothing is published on the host. */
  network: string;
}

export function containerCreateBody(input: IContainerBodyInput): Docker.ContainerCreateOptions {
  const { specification } = input;
  const port = `${specification.port}/tcp`;

  return {
    name: `${CONTAINER_NAME_PREFIX}${input.instanceKey}`,
    Image: specification.image,
    ...(specification.entrypoint === undefined ? {} : { Entrypoint: [...specification.entrypoint] }),
    Cmd: [...specification.command],
    Env: environment(input),
    Labels: { ...specification.labels, ...input.labels },
    ExposedPorts: { [port]: {} },

    // Nothing is published on the host: a backend is reachable only from the agent's own network.
    NetworkingConfig: { EndpointsConfig: { [input.network]: {} } },

    HostConfig: {
      Binds: specification.mounts.map(
        mount => `${mount.hostPath}:${mount.containerPath}:${mount.readOnly ? 'ro' : 'rw'}`
      ),

      NetworkMode: input.network,

      DeviceRequests: deviceRequests(input),

      // A tmpfs, so only the pages a backend writes are ever backed by host memory.
      ShmSize: input.container.sharedMemoryBytes,

      // A backend serves inference and never needs to forge a frame; keeping it would let one spoof its neighbours.
      CapDrop: ['NET_RAW'],

      // A backend that exits stays exited, so the server decides what to do about it rather than Docker.
      RestartPolicy: { Name: 'no' },

      // Off, so a container that died can still be asked why.
      AutoRemove: false,
    },
  };
}

function environment(input: IContainerBodyInput): string[] {
  const declared = Object.entries(input.specification.environment).map(([name, value]) => `${name}=${value}`);
  const devices = input.specification.devices.map(device => device.deviceKey).join(',');

  if (input.container.devicePresentation === DevicePresentation.ENVIRONMENT) {
    return [...declared, `${VISIBLE_DEVICES_VARIABLE}=${devices}`];
  }

  return input.container.pinOrderedDevices === true && devices.length > 0
    ? [...declared, `${CUDA_ORDER_VARIABLE}=${devices}`]
    : declared;
}

function deviceRequests(input: IContainerBodyInput): Docker.DeviceRequest[] | undefined {
  if (input.container.devicePresentation !== DevicePresentation.DEVICE_REQUEST) {
    return undefined;
  }

  const deviceIds = input.specification.devices.map(device => device.deviceKey);

  return deviceIds.length === 0
    ? undefined
    : [{ Driver: DEVICE_DRIVER, DeviceIDs: deviceIds, Capabilities: [[GPU_CAPABILITY]] }];
}
