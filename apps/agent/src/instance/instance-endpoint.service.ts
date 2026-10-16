import { Injectable } from '@nestjs/common';

import { InstanceState } from '@libs/agent-protocol';

export interface IInstanceAddress {
  host: string;
  port: number;
}

export interface IInstanceReach {
  instanceState: InstanceState;

  /** Null until the container has an address on the network the agent shares with it. */
  address: IInstanceAddress | null;
}

/** Holds what the last reconciliation sweep observed, so a reading is only ever as fresh as that sweep. */
@Injectable()
export class InstanceEndpointService {
  private reach: ReadonlyMap<string, IInstanceReach> = new Map();

  /** Replaces the whole set, so an instance whose container is gone stops resolving. */
  replace(reach: ReadonlyMap<string, IInstanceReach>): void {
    this.reach = reach;
  }

  forget(instanceKey: string): void {
    const remaining = new Map(this.reach);

    remaining.delete(instanceKey);
    this.reach = remaining;
  }

  /** Null where this node holds no container for the key. */
  resolve(instanceKey: string): IInstanceReach | null {
    return this.reach.get(instanceKey) ?? null;
  }
}
