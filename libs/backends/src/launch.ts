/** The hardware one instance takes on its node, as the placement pinned it. */
export interface IInstancePins {
  cpu: boolean;
  gpus: string[];
}

/** How a backend is launched. Each mode is admitted against a different pool. */
export enum LaunchMode {
  /** Every layer goes to the pinned cards, and the backend may not shrink an unset argument to make it fit. */
  GPU_ONLY = 'gpuOnly',

  /** The backend divides the model between the pinned cards and host memory as it sees fit. */
  CPU_OFFLOAD = 'cpuOffload',

  CPU_ONLY = 'cpuOnly',
}

export function launchModeOf(pins: IInstancePins): LaunchMode {
  if (pins.gpus.length === 0) {
    return LaunchMode.CPU_ONLY;
  }

  return pins.cpu ? LaunchMode.CPU_OFFLOAD : LaunchMode.GPU_ONLY;
}
