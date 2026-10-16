import { Inject, Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { pipeline, Readable } from 'node:stream';

import { INSTANCE_LABEL } from '@libs/backends/runtime';

import { ConfigService } from '../config/config.service';
import { describeDockerError } from './api/errors';
import { LogFrameReader, LogFrameStream } from './api/log-frames';
import { containerInspectSchema, ContainerInspect, pullProgressSchema } from './api/responses';
import { DOCKER_CLIENT } from './docker.client';

export interface IInstanceContainer {
  id: string;
  labels: Record<string, string>;
  running: boolean;

  /** Null while the container has never run, which is the window between create and start. */
  startedAt: Date | null;

  /** Set once the container has stopped, whether it was stopped or exited on its own. */
  exitCode: number | null;

  /** Empty until the container runs. */
  addresses: Readonly<Record<string, string>>;
}

/** Agents may share a Docker daemon, so each touches only the containers carrying its own node key. */
export const NODE_LABEL = 'modelfleet.node';

const NOT_FOUND = 404;

/** Docker writes this rather than an absent value for a container that has never run. */
const NEVER_RUN_DATE = '0001-01-01';

@Injectable()
export class ContainerService {
  private readonly logger = new Logger(ContainerService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker
  ) {}

  async listInstances(): Promise<IInstanceContainer[]> {
    const listed = await this.docker.listContainers({
      all: true,
      filters: { label: [INSTANCE_LABEL, `${NODE_LABEL}=${this.configService.nodeKey}`] },
    });
    const containers: IInstanceContainer[] = [];

    for (const info of listed) {
      const container = await this.inspect(info.Id);

      if (container !== null) {
        containers.push(container);
      }
    }

    return containers;
  }

  /** A relaunch can overlap its predecessor, so several may match; the most recently created is the instance's. */
  async findInstanceContainer(instanceKey: string): Promise<string | null> {
    const listed = await this.docker.listContainers({
      all: true,
      filters: { label: [`${INSTANCE_LABEL}=${instanceKey}`, `${NODE_LABEL}=${this.configService.nodeKey}`] },
    });

    let newest: Docker.ContainerInfo | null = null;

    for (const info of listed) {
      if (newest === null || info.Created > newest.Created) {
        newest = info;
      }
    }

    return newest?.Id ?? null;
  }

  async create(body: Docker.ContainerCreateOptions): Promise<string> {
    const created = await this.docker.createContainer({
      ...body,
      Labels: { ...body.Labels, [NODE_LABEL]: this.configService.nodeKey },
    });

    return created.id;
  }

  async start(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }

  /** Kills the backend if it has not exited within `graceSeconds`, and removes the container either way. */
  async stopAndRemove(containerId: string, graceSeconds: number): Promise<void> {
    const container = this.docker.getContainer(containerId);

    try {
      await container.stop({ t: graceSeconds });
    } catch (error: unknown) {
      this.logger.debug({ error, containerId }, 'stopAndRemove(): The container was already stopped');
    }

    await container.remove({ force: true });
  }

  async tailLogs(containerId: string, lines: number): Promise<string | null> {
    try {
      const logs = await this.docker.getContainer(containerId).logs({ stdout: true, stderr: true, tail: lines });

      return new LogFrameReader().read(Buffer.from(logs)).toString('utf8').trim();
    } catch (error: unknown) {
      this.logger.debug({ error, containerId }, 'tailLogs(): Reading a container log failed');

      return null;
    }
  }

  /** Counts entries as Docker's `tail` does, so a line it split past 16 KiB counts once per part. */
  async countLogEntries(containerId: string, limit: number): Promise<number> {
    const logs = await this.docker.getContainer(containerId).logs({ stdout: true, stderr: true, tail: limit });
    const reader = new LogFrameReader();
    const text = reader.read(Buffer.from(logs)).toString('utf8');

    return reader.frames ?? (text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length);
  }

  /**
   * The last `tail` lines, each prefixed with the daemon's RFC3339Nano timestamp, then every line after until the
   * container stops or is removed. Destroying the stream returned ends the daemon's follow.
   */
  async followStampedLog(containerId: string, tail: number): Promise<Readable> {
    const followed = await this.docker
      .getContainer(containerId)
      .logs({ follow: true, stdout: true, stderr: true, timestamps: true, tail });

    // An error reaches the caller through the stream returned.
    return pipeline(followed, new LogFrameStream(), () => {});
  }

  async ensureNetwork(name: string): Promise<void> {
    const existing = await this.docker.listNetworks({ filters: { name: [name] } });

    if (existing.some(network => network.Name === name)) {
      return;
    }

    try {
      await this.docker.createNetwork({ Name: name, Driver: 'bridge' });

      this.logger.log({ network: name }, 'ensureNetwork(): Created the network backends are reached on');
    } catch (error: unknown) {
      this.logger.debug({ error, network: name }, 'ensureNetwork(): The network was created alongside this one');
    }
  }

  async hasImage(reference: string): Promise<boolean> {
    try {
      await this.docker.getImage(reference).inspect();

      return true;
    } catch {
      return false;
    }
  }

  /** The daemon reports a failed layer in the progress stream rather than in the status. */
  async pullImage(reference: string): Promise<void> {
    const stream = await this.docker.pull(reference);
    const progress = await this.drain(stream);
    const failure = this.readPullFailure(progress);

    if (failure !== null) {
      throw new Error(failure);
    }
  }

  private drain(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];

      stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve(chunks.join('')));
      stream.on('error', reject);
    });
  }

  private readPullFailure(progress: string): string | null {
    for (const line of progress.split('\n').reverse()) {
      const parsed = pullProgressSchema.safeParse(this.readJson(line));

      if (parsed.success && parsed.data.error !== undefined) {
        return parsed.data.error;
      }
    }

    return null;
  }

  private readJson(line: string): unknown {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  /**
   * Null only where the container is gone, which is ordinary between listing and inspecting. A shape this agent
   * cannot read raises instead, since dropping it would have the caller create a second container for the instance.
   */
  private async inspect(containerId: string): Promise<IInstanceContainer | null> {
    let response: unknown;

    try {
      response = await this.docker.getContainer(containerId).inspect();
    } catch (error: unknown) {
      if (describeDockerError(error).status === NOT_FOUND) {
        return null;
      }

      throw error;
    }

    const parsed = containerInspectSchema.safeParse(response);

    if (!parsed.success) {
      throw new Error(`Docker described container ${containerId} in a shape this agent cannot read`);
    }

    return this.describe(parsed.data);
  }

  private describe(inspected: ContainerInspect): IInstanceContainer {
    const startedAt = this.readDate(inspected.State.StartedAt);

    return {
      id: inspected.Id,
      labels: inspected.Config.Labels ?? {},
      running: inspected.State.Running,
      startedAt,
      exitCode: inspected.State.Running ? null : inspected.State.ExitCode,
      addresses: this.readAddresses(inspected),
    };
  }

  private readDate(value: string): Date | null {
    if (value.length === 0 || value.startsWith(NEVER_RUN_DATE)) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private readAddresses(inspected: ContainerInspect): Record<string, string> {
    const addresses: Record<string, string> = {};

    for (const [network, settings] of Object.entries(inspected.NetworkSettings.Networks)) {
      const address = settings.IPAddress ?? '';

      if (address.length > 0) {
        addresses[network] = address;
      }
    }

    return addresses;
  }
}
