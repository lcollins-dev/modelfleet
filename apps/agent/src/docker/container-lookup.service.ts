import { Inject, Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';

import { ConfigService } from '../config/config.service';
import { readInstanceKey } from '../instance/instance-labels';
import { PID_TITLE, containerTopSchema } from './api/responses';
import { NODE_LABEL } from './container.service';
import { DOCKER_CLIENT } from './docker.client';

export interface IContainerRef {
  id: string;
  name: string;

  instanceKey: string | null;
}

interface IContainerProcesses extends IContainerRef {
  /** Host process identifiers, whatever namespace the container runs in. */
  pids: number[];
}

@Injectable()
export class ContainerLookupService {
  private readonly logger = new Logger(ContainerLookupService.name);

  private readonly maxAgeMs: number;

  private index = new Map<number, IContainerRef>();
  private instanceProcesses = new Map<string, number[]>();
  private readAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly configService: ConfigService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker
  ) {
    this.maxAgeMs = this.configService.telemetryAttributionMaxAgeMs;
  }

  /** A refresh that fails leaves the previous index answering. */
  async resolve(pids: readonly number[]): Promise<Map<number, IContainerRef>> {
    if (this.needsRead(pids)) {
      await this.read();
    }

    const resolved = new Map<number, IContainerRef>();

    for (const pid of pids) {
      const container = this.index.get(pid);

      if (container !== undefined) {
        resolved.set(pid, container);
      }
    }

    return resolved;
  }

  /** An instance whose processes could not be listed carries none. Null until Docker has answered once. */
  async processesByInstance(): Promise<ReadonlyMap<string, readonly number[]> | null> {
    if (this.isStale()) {
      await this.read();
    }

    return this.readAt === Number.NEGATIVE_INFINITY ? null : this.instanceProcesses;
  }

  private needsRead(pids: readonly number[]): boolean {
    return this.isStale() || pids.some(pid => !this.index.has(pid));
  }

  private isStale(): boolean {
    return Date.now() - this.readAt > this.maxAgeMs;
  }

  private async read(): Promise<void> {
    let listed: IContainerProcesses[];

    try {
      listed = await this.listContainerProcesses();
    } catch {
      return;
    }

    const index = new Map<number, IContainerRef>();
    const instanceProcesses = new Map<string, number[]>();

    for (const container of listed) {
      for (const pid of container.pids) {
        index.set(pid, { id: container.id, name: container.name, instanceKey: container.instanceKey });
      }

      if (container.instanceKey !== null) {
        instanceProcesses.set(container.instanceKey, [
          ...(instanceProcesses.get(container.instanceKey) ?? []),
          ...container.pids,
        ]);
      }
    }

    this.index = index;
    this.instanceProcesses = instanceProcesses;
    this.readAt = Date.now();
  }

  private async listContainerProcesses(): Promise<IContainerProcesses[]> {
    const containers = await this.docker.listContainers();
    const listed: IContainerProcesses[] = [];

    for (const info of containers) {
      listed.push({
        id: info.Id,
        name: this.containerName(info.Names),
        instanceKey: this.instanceKeyOf(info.Labels),
        pids: await this.pidsOf(info.Id),
      });
    }

    return listed;
  }

  /** Empty rather than throwing, so a running container whose processes cannot be listed still appears. */
  private async pidsOf(containerId: string): Promise<number[]> {
    try {
      const response: unknown = await this.docker.getContainer(containerId).top();
      const top = containerTopSchema.safeParse(response);

      return top.success ? this.pidsFrom(top.data.Titles, top.data.Processes) : [];
    } catch (error: unknown) {
      this.logger.debug({ error, container: containerId }, 'pidsOf(): Reading the processes of one container failed');

      return [];
    }
  }

  /** Another node's process still counts against the card, as usage no instance of this node holds. */
  private instanceKeyOf(labels: Record<string, string>): string | null {
    return labels[NODE_LABEL] === this.configService.nodeKey ? readInstanceKey(labels) : null;
  }

  private containerName(names: string[]): string {
    return names.length === 0 ? '' : names[0].replace(/^\//, '');
  }

  /** `docker top` prints one row per process, with the titles naming the columns. */
  private pidsFrom(titles: string[], processes: string[][]): number[] {
    const column = titles.indexOf(PID_TITLE);

    if (column < 0) {
      return [];
    }

    const pids: number[] = [];

    for (const row of processes) {
      if (column >= row.length) {
        continue;
      }

      const pid = Number.parseInt(row[column], 10);

      if (Number.isInteger(pid)) {
        pids.push(pid);
      }
    }

    return pids;
  }
}
