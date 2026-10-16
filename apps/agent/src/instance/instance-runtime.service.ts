import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { basename, dirname, join, posix } from 'node:path';
import { Observable } from 'rxjs';

import {
  DesiredInstance,
  InstanceState,
  MAX_INSTANCES_PER_NODE,
  MAX_MESSAGE_LENGTH,
  ObservedInstance,
} from '@libs/agent-protocol';
import { BackendDefinition, imageVariantOf, Readiness, resolveImage } from '@libs/backends';
import {
  backendFor,
  IContainerSpecification,
  IModelCompanion,
  IModelWeights,
  renderContainer,
} from '@libs/backends/runtime';

import { ContainedPaths } from '../common/contained-paths';
import { ConfigService } from '../config/config.service';
import { containerCreateBody } from '../docker/api/container-body';
import { describeDockerError, DockerFault, DockerUnavailableError } from '../docker/api/errors';
import { ContainerService, IInstanceContainer } from '../docker/container.service';
import { GGUF_SUFFIX } from '../model/scan/gguf/gguf-reader.service';
import { ShardGrouperService } from '../model/scan/shard-grouper.service';
import { IInstanceAddress, IInstanceReach, InstanceEndpointService } from './instance-endpoint.service';
import {
  adoptionLabels,
  IContainerAdoption,
  IContainerSupervision,
  readAdoption,
  readBackend,
  readInstanceKey,
  readRevision,
} from './instance-labels';
import { launchTimeoutMs } from './launch-timeout';
import { ReadinessService } from './readiness.service';

const PULLING_MESSAGE = 'Pulling the backend image';

/** What the agent knows about a launch it has begun and no container answers for yet. */
interface ILaunchAttempt {
  revision: number;
  instanceState: InstanceState;
  message: string | null;
}

@Injectable()
export class InstanceRuntimeService implements OnModuleInit {
  private readonly logger = new Logger(InstanceRuntimeService.name);

  private readonly launches = new Map<string, ILaunchAttempt>();

  /** When this agent first saw each container, so an adopted one is given its own launch window. */
  private readonly firstSeen = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly containerService: ContainerService,
    private readonly readinessService: ReadinessService,
    private readonly instanceEndpointService: InstanceEndpointService,
    private readonly shardGrouperService: ShardGrouperService
  ) {}

  /** A daemon still starting is not a reason to refuse to boot, so the next launch makes the network instead. */
  async onModuleInit(): Promise<void> {
    await this.makeNetwork().catch((error: unknown) => {
      this.logger.warn({ error }, 'onModuleInit(): The network backends are reached on could not be made yet');
    });
  }

  /** The key of every instance whose probe has just passed. */
  changes(): Observable<string> {
    return this.readinessService.changes();
  }

  /**
   * Throws rather than answering with nothing, which would have the caller remove every container on the node.
   * Replaces what the relay resolves an instance key against, so that view is refreshed by each sweep.
   */
  async list(): Promise<ObservedInstance[]> {
    const containers = await this.readContainers();
    const observed: ObservedInstance[] = [];
    const reach = new Map<string, IInstanceReach>();
    const held = new Set<string>();
    const seen = new Set<string>();

    for (const container of containers) {
      const instanceKey = readInstanceKey(container.labels);

      if (instanceKey === null) {
        continue;
      }

      held.add(instanceKey);
      seen.add(container.id);

      if (!this.firstSeen.has(container.id)) {
        this.firstSeen.set(container.id, Date.now());
      }

      const instance = await this.observe(instanceKey, container);

      observed.push(instance);
      reach.set(instanceKey, {
        instanceState: instance.instanceState,
        address: this.addressOf(container, readAdoption(container.labels)),
      });
    }

    for (const containerId of this.firstSeen.keys()) {
      if (!seen.has(containerId)) {
        this.firstSeen.delete(containerId);
      }
    }

    for (const [instanceKey, attempt] of this.launches) {
      if (held.has(instanceKey)) {
        this.launches.delete(instanceKey);
        continue;
      }

      observed.push({
        instanceKey,
        revision: attempt.revision,
        instanceState: attempt.instanceState,
        message: attempt.message,
        uptimeMs: null,
        exitCode: null,
      });
      reach.set(instanceKey, { instanceState: attempt.instanceState, address: null });
    }

    this.instanceEndpointService.replace(reach);

    return observed.slice(0, MAX_INSTANCES_PER_NODE);
  }

  /** Returns once the container is started. Readiness is proven by the probe afterwards, not waited for here. */
  async start(desired: DesiredInstance, gpuTotalBytes: ReadonlyMap<string, number>): Promise<void> {
    this.launches.set(desired.instanceKey, {
      revision: desired.revision,
      instanceState: InstanceState.STARTING,
      message: null,
    });

    try {
      await this.launch(desired, gpuTotalBytes);
    } catch (error: unknown) {
      const fault = describeDockerError(error);

      if (fault.fault === DockerFault.UNREACHABLE) {
        this.launches.delete(desired.instanceKey);

        throw new DockerUnavailableError(fault.message);
      }

      this.logger.error({ error, instanceKey: desired.instanceKey }, 'start(): The daemon refused a launch');

      this.launches.set(desired.instanceKey, {
        revision: desired.revision,
        instanceState: InstanceState.FAILED,
        message: this.trim(fault.message),
      });
    }
  }

  /** Removes the instance's container whether or not it was running, with the backend's declared grace period. */
  async stop(instanceKey: string): Promise<void> {
    this.launches.delete(instanceKey);
    this.readinessService.forget(instanceKey);
    this.instanceEndpointService.forget(instanceKey);

    for (const container of await this.readContainers()) {
      if (readInstanceKey(container.labels) !== instanceKey) {
        continue;
      }

      await this.containerService.stopAndRemove(container.id, this.graceSecondsOf(container));
    }
  }

  private async launch(desired: DesiredInstance, gpuTotalBytes: ReadonlyMap<string, number>): Promise<void> {
    const definition = backendFor(desired.backend).definition;
    const image = this.imageOf(desired, definition);
    const [weights, ...shards] = await this.resolveWeights(desired.weightsPath, definition);
    const specification = renderContainer(definition, {
      instanceKey: desired.instanceKey,
      servedModel: desired.servedModel,
      model: desired.model,
      weights,
      shards,
      companions: await this.resolveCompanions(desired, definition.modelMount),
      configuration: desired.configuration,
      pins: desired.pins,
      gpuTotalBytes,
      image,
    });

    if (!(await this.ensureImage(desired, specification))) {
      return;
    }

    // Nothing reaches a backend except over this network, so it has to exist before the container is created.
    await this.makeNetwork();

    const body = containerCreateBody({
      instanceKey: desired.instanceKey,
      specification,
      container: definition.container,
      labels: adoptionLabels(this.adoptionOf(desired, definition, specification.port)),
      network: this.configService.instanceNetwork,
    });

    const containerId = await this.containerService.create(body);

    try {
      await this.containerService.start(containerId);
    } catch (error: unknown) {
      // The daemon's own reason is what gets reported, so a failure to remove must not replace it.
      await this.containerService.stopAndRemove(containerId, 0).catch((removal: unknown) => {
        this.logger.error(
          { error: removal, containerId },
          'launch(): Removing a container that failed to start failed'
        );
      });

      throw error;
    }

    this.launches.delete(desired.instanceKey);
  }

  /** False where the image is still being pulled, which leaves the instance starting until the next reconcile. */
  private async ensureImage(desired: DesiredInstance, specification: IContainerSpecification): Promise<boolean> {
    const reference = specification.image;

    if (await this.containerService.hasImage(reference)) {
      return true;
    }

    this.launches.set(desired.instanceKey, {
      revision: desired.revision,
      instanceState: InstanceState.STARTING,
      message: `${PULLING_MESSAGE} ${reference}`,
    });

    this.pull(desired, reference);

    return false;
  }

  /**
   * Runs beside reconciliation, since an image can take minutes and nothing else on the node should wait for it.
   * Every instance pulls for itself: the daemon coalesces concurrent pulls, and sharing one would leave every
   * instance but the first waiting on a completion it never hears about.
   */
  private pull(desired: DesiredInstance, reference: string): void {
    this.containerService
      .pullImage(reference)
      .then(() => {
        this.logger.log({ reference }, 'pull(): A backend image was pulled');

        // Dropping the attempt makes the instance missing again, which is what has the next reconcile create it.
        this.launches.delete(desired.instanceKey);
      })
      .catch((error: unknown) => {
        this.logger.error({ error, reference }, 'pull(): Pulling a backend image failed');

        this.launches.set(desired.instanceKey, {
          revision: desired.revision,
          instanceState: InstanceState.FAILED,
          message: this.trim(describeDockerError(error).message),
        });
      });
  }

  private async observe(instanceKey: string, container: IInstanceContainer): Promise<ObservedInstance> {
    const revision = readRevision(container.labels);

    if (!container.running) {
      this.readinessService.forget(instanceKey);

      return this.failed(instanceKey, revision, container, container.startedAt === null ? null : container.exitCode);
    }

    const adoption = readAdoption(container.labels);
    const endpoint = this.endpointOf(container, adoption);
    const uptimeMs = container.startedAt === null ? 0 : Math.max(Date.now() - container.startedAt.getTime(), 0);

    if (this.readinessService.isReady(instanceKey, container.id)) {
      return this.observed(instanceKey, revision, InstanceState.READY, uptimeMs);
    }

    if (adoption !== null && this.hasOverrunLaunch(container, adoption)) {
      this.readinessService.forget(instanceKey);

      return this.failed(instanceKey, revision, container, null, true);
    }

    if (adoption !== null && endpoint !== null) {
      this.readinessService.watch(instanceKey, container.id, endpoint, adoption.probe);
    }

    return this.observed(instanceKey, revision, InstanceState.STARTING, uptimeMs);
  }

  /**
   * Measured from whichever is later, the container starting or this agent first seeing it. A restarted agent has
   * proven nothing about a container that has been running for hours, so condemning it on its age would fail every
   * healthy instance the moment the agent came back.
   */
  private hasOverrunLaunch(container: IInstanceContainer, adoption: IContainerSupervision): boolean {
    const startedAt = container.startedAt?.getTime() ?? Date.now();
    const seenAt = this.firstSeen.get(container.id) ?? Date.now();

    return Date.now() - Math.max(startedAt, seenAt) > adoption.startTimeoutMs;
  }

  private async failed(
    instanceKey: string,
    revision: number,
    container: IInstanceContainer,
    exitCode: number | null,
    overran = false
  ): Promise<ObservedInstance> {
    const output = await this.containerService.tailLogs(container.id, this.configService.instanceLogTailLines);

    return {
      instanceKey,
      revision,
      instanceState: InstanceState.FAILED,
      message: this.trim(output),
      uptimeMs: null,
      exitCode,
      overran,
    };
  }

  private observed(
    instanceKey: string,
    revision: number,
    instanceState: InstanceState,
    uptimeMs: number
  ): ObservedInstance {
    return { instanceKey, revision, instanceState, message: null, uptimeMs, exitCode: null };
  }

  private makeNetwork(): Promise<void> {
    return this.containerService.ensureNetwork(this.configService.instanceNetwork);
  }

  private async readContainers(): Promise<IInstanceContainer[]> {
    try {
      return await this.containerService.listInstances();
    } catch (error: unknown) {
      const fault = describeDockerError(error);

      if (fault.fault === DockerFault.UNREACHABLE) {
        throw new DockerUnavailableError(fault.message);
      }

      throw error;
    }
  }

  private adoptionOf(desired: DesiredInstance, definition: BackendDefinition, port: number): IContainerAdoption {
    return {
      revision: desired.revision,
      probe: definition.readiness.probe,
      port,
      startTimeoutMs: this.startTimeoutMs(desired, definition.readiness),
    };
  }

  private startTimeoutMs(desired: DesiredInstance, readiness: Readiness): number {
    if (readiness.startTimeoutSeconds !== undefined) {
      return readiness.startTimeoutSeconds * 1000;
    }

    return launchTimeoutMs(
      desired.model.sizeBytes,
      this.configService.instanceStartTimeoutBaseMs,
      this.configService.instanceStartTimeoutPerGibMs
    );
  }

  /** A server that predates resolving the image sends null where a document clears it. */
  private imageOf(desired: DesiredInstance, definition: BackendDefinition): string {
    const image = desired.image ?? resolveImage(definition, desired.configuration, desired.pins);

    if (image === null) {
      throw new Error(
        `The ${definition.id} backend has no ${imageVariantOf(desired.pins)} image, and the server named none`
      );
    }

    return image;
  }

  private graceSecondsOf(container: IInstanceContainer): number {
    const backend = readBackend(container.labels);

    return backend === null ? 0 : backendFor(backend).definition.container.stopGraceSeconds;
  }

  /** Where the agent probes the backend. Nothing outside this node's agent can reach it. */
  private endpointOf(container: IInstanceContainer, adoption: IContainerSupervision | null): string | null {
    const address = this.addressOf(container, adoption);

    return address === null ? null : `http://${address.host}:${address.port}`;
  }

  private addressOf(container: IInstanceContainer, adoption: IContainerSupervision | null): IInstanceAddress | null {
    const host = container.addresses[this.configService.instanceNetwork] ?? '';

    if (adoption === null || host.length === 0) {
      return null;
    }

    return { host, port: adoption.port };
  }

  /**
   * Every file of the weights, the one the server named first. Inside the container a split set takes the names
   * llama.cpp derives shards 2 to N by, whatever case it was scanned in and wherever its links resolve.
   */
  private async resolveWeights(weightsPath: string, definition: BackendDefinition): Promise<IModelWeights[]> {
    const modelMount = definition.modelMount;
    const firstName = basename(weightsPath);
    const shardName = this.shardGrouperService.parseName(firstName, GGUF_SUFFIX);

    if (shardName === null || shardName.total === 1) {
      const hostPath = await this.resolveScanned(weightsPath);

      return [{ hostPath, containerPath: posix.join(modelMount, definition.weightsName ?? basename(hostPath)) }];
    }

    if (shardName.index !== 1) {
      throw new Error(
        `The model file at ${weightsPath} is shard ${String(shardName.index)} of ${String(shardName.total)}, not the first`
      );
    }

    const files: IModelWeights[] = [];

    // In order, so a set missing several shards names the first of them.
    for (let index = 1; index <= shardName.total; index += 1) {
      const hostPath = await this.resolveScanned(
        join(dirname(weightsPath), this.shardGrouperService.siblingName(firstName, GGUF_SUFFIX, index))
      );
      const containerName = this.shardGrouperService.memberName({ ...shardName, index }, GGUF_SUFFIX);

      files.push({ hostPath, containerPath: posix.join(modelMount, containerName) });
    }

    return files;
  }

  /** Each runs through the same scan-root check as the weights, so a fingerprint from the wire widens nothing. */
  private async resolveCompanions(desired: DesiredInstance, modelMount: string): Promise<IModelCompanion[]> {
    const companions: IModelCompanion[] = [];

    for (const companion of desired.companionPaths ?? []) {
      const hostPath = await this.resolveScanned(companion.path);

      companions.push({
        field: companion.field,
        hostPath,
        containerPath: this.companionPathOf(modelMount, companion.field, hostPath),
      });
    }

    return companions;
  }

  /**
   * The real path of a model file, and only where it sits inside a directory this node was configured to scan. The
   * agent binds this into a container, so a path from the wire - or a symlink swapped in after the scan - would
   * otherwise mount anything on the host.
   */
  private async resolveScanned(modelPath: string): Promise<string> {
    const scanned = new ContainedPaths(this.configService.modelDirs);
    const resolved = await scanned.realpathOf(modelPath);

    if (resolved === null) {
      throw new Error(`The model file at ${modelPath} is not on this node`);
    }

    if (!(await scanned.contains(resolved))) {
      throw new Error(`The model file at ${modelPath} sits outside every directory this node scans`);
    }

    return resolved;
  }

  /** A directory per field, so a companion sharing the weights' basename still lands somewhere of its own. */
  private companionPathOf(modelMount: string, field: string, hostPath: string): string {
    return posix.join(modelMount, field, basename(hostPath));
  }

  private trim(message: string | null): string | null {
    if (message === null || message.length === 0) {
      return null;
    }

    return message.length > MAX_MESSAGE_LENGTH ? message.slice(-MAX_MESSAGE_LENGTH) : message;
  }
}
