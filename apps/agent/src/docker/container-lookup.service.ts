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

  private needsRead(pids: readonly number[]): boolean {
    if (Date.now() - this.readAt > this.maxAgeMs) {
      return true;
    }

    return pids.some(pid => !this.index.has(pid));
  }

  private async read(): Promise<void> {
    let listed: IContainerProcesses[];

    try {
      listed = await this.listContainerProcesses();
    } catch {
      return;
    }

    const index = new Map<number, IContainerRef>();

    for (const container of listed) {
      for (const pid of container.pids) {
        index.set(pid, { id: container.id, name: container.name, instanceKey: container.instanceKey });
      }
    }

    this.index = index;
    this.readAt = Date.now();
  }

  /** A container that exits mid-read is skipped. */
  private async listContainerProcesses(): Promise<IContainerProcesses[]> {
    const containers = await this.docker.listContainers();
    const listed: IContainerProcesses[] = [];

    for (const info of containers) {
      const name = this.containerName(info.Names);

      try {
        const response: unknown = await this.docker.getContainer(info.Id).top();
        const top = containerTopSchema.safeParse(response);

        if (top.success) {
          listed.push({
            id: info.Id,
            name,
            instanceKey: this.instanceKeyOf(info.Labels),
            pids: this.pidsFrom(top.data.Titles, top.data.Processes),
          });
        }
      } catch (error: unknown) {
        this.logger.debug(
          { error, container: info.Id },
          'listContainerProcesses(): Reading the processes of one container failed'
        );
      }
    }

    return listed;
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
