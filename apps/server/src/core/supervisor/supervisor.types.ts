import { AgentRelay } from '@libs/agent-protocol';

export enum AcquireRefusal {
  /** A ready instance on a node out of contact, a deployment that has gone, or a fault reconciling one. */
  NOT_AVAILABLE = 'not-available',

  /** The placement cannot be honoured, the deployment cannot be sized, or it is disabled. */
  CANNOT_START = 'cannot-start',

  DOES_NOT_FIT = 'does-not-fit',
  BACKING_OFF = 'backing-off',
  GIVEN_UP = 'given-up',
  FAILED = 'failed',
  TIMED_OUT = 'timed-out',
}

export interface ILease {
  instanceKey: string;
  nodeId: number;
  relay: AgentRelay;

  /** Calling it twice drops the request once. */
  release: () => void;
}

export interface IReadyInstance {
  instanceKey: string;
  relay: AgentRelay;

  configurationRevision: string;
}

export interface IAcquireResult {
  /** Null where the request is refused, or the caller left while it waited. */
  lease: ILease | null;

  refusal: AcquireRefusal | null;

  /** What an operator would change: the placement's problems, or the backend's own output. */
  problem: string | null;

  /** Set on `BACKING_OFF` alone. */
  retryInMs: number | null;

  /** Null where nothing was waited for. */
  waitedMs: number | null;
}

export interface IAcquireOptions {
  signal: AbortSignal;
  maxWaitMs: number;

  /** Called once the request is left waiting, or its first look takes longer than a second. */
  onWait: () => void;
}

/** Why a start the supervisor asked for wrote nothing. */
export interface IStartRefusal {
  refusal: AcquireRefusal;
  problem: string | null;
}
