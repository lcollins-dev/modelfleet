import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import ms from 'ms';
import { IncomingMessage } from 'node:http';
import { text } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

import { RelayErrorCode } from '@libs/agent-protocol';
import { BackendOperation } from '@libs/backends';
import { BackendError, BackendErrorType, backendError } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';
import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { JSON_TYPE } from './inference-request.service';
import { ConfigService } from '@/config/config.service';
import {
  IRelayAnswer,
  IRelayRefusal,
  RelayClientService,
  RelayUnreachableError,
} from '@/core/agent/relay-client.service';
import { IResolvedDeployment } from '@/core/inference/deployment-resolver.service';
import { InferenceMetricsService } from '@/core/inference/inference-metrics.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';
import { FirstByteMeter } from './first-byte-meter';
import { SseChunkMapper } from './sse-chunk-mapper';
import { AcquireRefusal, IAcquireResult } from '@/core/supervisor/supervisor.types';

const CLIENT_CLOSED_REQUEST = 499;

const EVENT_STREAM_TYPE = 'text/event-stream';
const ANY_TYPE = '*/*';

const RETURNED_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-disposition'];

const KEEPALIVE_COMMENT = ': keepalive\n\n';

/** Well inside the sixty seconds a reverse proxy or client library commonly allows an idle connection. */
const KEEPALIVE_INTERVAL_MS = 15_000;

const READ_TIMEOUT_MS = 5_000;

const LOGGED_BODY_CHARACTERS = 500;

export interface IProxiedCall {
  resolved: IResolvedDeployment;
  apiKey: ApiKey;
  response: Response;
  operation: BackendOperation;

  upstreamBody: Buffer;
  contentType: string;

  streaming: boolean;

  mapBody?: (body: unknown) => unknown;

  mapChunk?: (chunk: unknown) => unknown;
}

export interface IReadyAnswer {
  configurationRevision: string;

  body: unknown;
}

/**
 * Relays a request to the instance it leases. A failure is thrown rather than written, so the gateway's error filter
 * answers it the same way whether or not a wait on a cold load has already sent the caller its head.
 */
@Injectable()
export class RelayProxyService {
  private readonly logger = new Logger(RelayProxyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deploymentSupervisorService: DeploymentSupervisorService,
    private readonly inferenceMetricsService: InferenceMetricsService,
    private readonly relayClientService: RelayClientService
  ) {}

  async proxy(call: IProxiedCall): Promise<void> {
    const startedAt = performance.now();
    const controller = new AbortController();

    // A caller that goes away takes the generation with it, so an abandoned request stops consuming the instance.
    call.response.on('close', () => {
      if (!call.response.writableEnded) {
        controller.abort();
      }
    });

    // The caller may have gone while its body was parsed and its model resolved, before the listener above existed.
    if (call.response.closed) {
      controller.abort();
    }

    const acquired = await this.acquire(call, controller.signal);

    if (acquired.refusal !== null) {
      this.logger.warn(
        { deploymentId: call.resolved.deployment.id, refusal: acquired.refusal, problem: acquired.problem },
        'proxy(): A request was refused an instance'
      );

      this.record(call, null, HttpStatus.SERVICE_UNAVAILABLE, null, acquired.waitedMs, startedAt);

      throw new OpenAiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        this.refusalError(call.resolved.deployment.name, acquired)
      );
    }

    if (acquired.lease === null) {
      this.record(call, null, CLIENT_CLOSED_REQUEST, null, acquired.waitedMs, startedAt);

      return;
    }

    const lease = acquired.lease;
    const meter = call.mapChunk === undefined ? new FirstByteMeter() : new SseChunkMapper(call.mapChunk);
    let failure: OpenAiHttpException | null = null;

    try {
      if (controller.signal.aborted) {
        return;
      }

      const upstream = await this.relayClientService.send({
        relay: lease.relay,
        instanceKey: lease.instanceKey,
        path: call.resolved.capability.path,
        body: call.upstreamBody,
        contentType: call.contentType,
        accept: this.acceptFor(call),
        signal: controller.signal,
      });

      if (upstream.refusal !== null) {
        failure = this.relayFailure(call, lease.instanceKey, upstream);
      } else if (!this.succeeded(upstream.status)) {
        failure = await this.backendFailure(call, upstream.status, upstream.stream);
      } else if (call.streaming) {
        await this.answerStream(call, meter, upstream);
      } else if (call.mapBody === undefined) {
        await this.answerBytes(call, upstream);
      } else {
        await this.answerBody(call, call.mapBody, upstream.stream);
      }
    } catch (error: unknown) {
      failure = this.upstreamFailure(call, lease.instanceKey, controller.signal.aborted, error);
    } finally {
      lease.release();

      const firstPayloadAt = meter.firstPayloadAt;
      const timeToFirstTokenMs = firstPayloadAt === null ? null : firstPayloadAt - startedAt - (acquired.waitedMs ?? 0);

      const status = controller.signal.aborted
        ? CLIENT_CLOSED_REQUEST
        : (failure?.getStatus() ?? call.response.statusCode);

      this.record(call, lease.instanceKey, status, timeToFirstTokenMs, acquired.waitedMs, startedAt);
    }

    if (failure !== null) {
      throw failure;
    }
  }

  /**
   * Starts, leases and counts nothing, so a client polling a listing keeps nothing loaded. Undefined where no instance
   * is ready or the read fails.
   */
  async queryIfReady(deployment: Deployment, path: string): Promise<IReadyAnswer | undefined> {
    const ready = await this.deploymentSupervisorService.findReady(deployment.id);

    if (ready === null) {
      return undefined;
    }

    try {
      const upstream = await this.relayClientService.get({
        relay: ready.relay,
        instanceKey: ready.instanceKey,
        path,
        accept: JSON_TYPE,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });

      if (upstream.refusal !== null) {
        this.logger.warn(
          { deploymentId: deployment.id, path, status: upstream.status, refusal: upstream.refusal },
          'queryIfReady(): The node relay refused a query'
        );

        return undefined;
      }

      const raw = await text(upstream.stream);

      if (!this.succeeded(upstream.status)) {
        this.logger.warn(
          { deploymentId: deployment.id, path, status: upstream.status, body: raw.slice(0, LOGGED_BODY_CHARACTERS) },
          'queryIfReady(): A ready instance refused a query'
        );

        return undefined;
      }

      return { configurationRevision: ready.configurationRevision, body: JSON.parse(raw) };
    } catch (error: unknown) {
      this.logger.warn(
        { error, deploymentId: deployment.id, path },
        'queryIfReady(): Querying a ready instance failed'
      );

      return undefined;
    }
  }

  /** Keeps a streaming caller alive while it waits on a cold load, from the moment it starts waiting. */
  private async acquire(call: IProxiedCall, signal: AbortSignal): Promise<IAcquireResult> {
    let ticker: NodeJS.Timeout | undefined;

    try {
      return await this.deploymentSupervisorService.acquire(call.resolved.deployment.id, {
        signal,
        maxWaitMs: this.maxWaitMs(),
        onWait: () => {
          if (call.streaming) {
            this.keepAlive(call.response);
            ticker = setInterval(() => this.keepAlive(call.response), KEEPALIVE_INTERVAL_MS);
          }
        },
      });
    } finally {
      clearInterval(ticker);
    }
  }

  /** Says what an operator would change where the refusal knows it, since it is the whole of what the caller is told. */
  private refusalError(name: string, acquired: IAcquireResult): BackendError {
    const problem = this.sentence(acquired.problem);

    switch (acquired.refusal) {
      case AcquireRefusal.DOES_NOT_FIT:
        return this.refused(
          `The model '${name}' cannot start on the GPUs it is pinned to right now.${problem}`,
          'model_does_not_fit'
        );

      case AcquireRefusal.CANNOT_START:
        return this.refused(`The model '${name}' cannot be started.${problem}`, 'model_cannot_start');

      case AcquireRefusal.FAILED:
        return this.refused(`The model '${name}' failed to start.${problem}`, 'model_failed_to_start');

      case AcquireRefusal.BACKING_OFF:
        return this.refused(
          `The model '${name}' failed to start and is not tried again for ${this.longDuration(acquired.retryInMs ?? 0)}.${problem}`,
          'model_failed_to_start'
        );

      case AcquireRefusal.GIVEN_UP:
        return this.refused(
          `The model '${name}' failed to start too many times in a row and is not tried again until an operator starts it or changes its configuration.${problem}`,
          'model_failed_to_start'
        );

      case AcquireRefusal.TIMED_OUT:
        return this.refused(
          `The model '${name}' did not become ready within ${this.longDuration(this.maxWaitMs())}. Try again later.`,
          'model_load_timeout'
        );

      case AcquireRefusal.NOT_AVAILABLE:
      case null:
        return this.refused(`The model '${name}' is not available right now. Try again later.`, 'model_not_available');
    }
  }

  private refused(message: string, code: string): BackendError {
    return backendError(BackendErrorType.SERVER, message, { code });
  }

  /** Leads with a space, so an absent problem leaves the message it follows as it was. */
  private sentence(problem: string | null): string {
    const trimmed = problem?.trim() ?? '';

    if (trimmed.length === 0) {
      return '';
    }

    return /[.!?]$/.test(trimmed) ? ` ${trimmed}` : ` ${trimmed}.`;
  }

  private longDuration(milliseconds: number): string {
    return ms(Math.max(Math.round(milliseconds / 1000), 1) * 1000, { long: true });
  }

  private maxWaitMs(): number {
    return this.configService.gatewayLoadWaitTimeoutMs;
  }

  /** The head goes out with the first keepalive, so from then on a failure can only be told as an event. */
  private keepAlive(response: Response): void {
    if (!response.headersSent) {
      this.openEventStream(response);
    }

    response.write(KEEPALIVE_COMMENT);
  }

  private openEventStream(response: Response, contentType = EVENT_STREAM_TYPE): void {
    response.status(HttpStatus.OK);
    response.setHeader('content-type', contentType);
    response.setHeader('cache-control', 'no-cache');
    response.setHeader('connection', 'keep-alive');

    // Names the reverse proxies that would otherwise hold a streamed response back until it ended.
    response.setHeader('x-accel-buffering', 'no');

    // Puts the head on the wire ahead of the first chunk, which is what time to first token is measured to.
    response.flushHeaders();
  }

  private succeeded(status: number): boolean {
    return status >= HttpStatus.OK && status < HttpStatus.AMBIGUOUS;
  }

  private acceptFor(call: IProxiedCall): string {
    if (call.streaming) {
      return EVENT_STREAM_TYPE;
    }

    return call.mapBody === undefined ? ANY_TYPE : JSON_TYPE;
  }

  private async answerStream(
    call: IProxiedCall,
    meter: SseChunkMapper | FirstByteMeter,
    upstream: IRelayAnswer
  ): Promise<void> {
    if (!call.response.headersSent) {
      const contentType = call.mapChunk === undefined ? upstream.headers['content-type'] : undefined;

      this.openEventStream(call.response, contentType);
    }

    await pipeline(upstream.stream, meter, call.response);
  }

  private async answerBody(
    call: IProxiedCall,
    mapBody: (body: unknown) => unknown,
    upstream: IncomingMessage
  ): Promise<void> {
    const body: unknown = JSON.parse(await text(upstream));

    call.response.status(HttpStatus.OK).json(mapBody(body));
  }

  private async answerBytes(call: IProxiedCall, upstream: IRelayAnswer): Promise<void> {
    call.response.status(upstream.status);

    for (const name of RETURNED_HEADERS) {
      const value = upstream.headers[name];

      if (value !== undefined) {
        call.response.setHeader(name, value);
      }
    }

    await pipeline(upstream.stream, call.response);
  }

  /** Under the backend's own status, through the mapping's `error`, so its account of what went wrong survives. */
  private async backendFailure(
    call: IProxiedCall,
    status: number,
    upstream: IncomingMessage
  ): Promise<OpenAiHttpException> {
    const raw = await text(upstream);

    return new OpenAiHttpException(status, call.resolved.mapping.error(status, this.jsonOrText(raw)));
  }

  /**
   * The relay's refusal is the server's to explain, never the backend's, so it answers in the gateway's own words
   * rather than through the mapping.
   */
  private relayFailure(call: IProxiedCall, instanceKey: string, upstream: IRelayRefusal): OpenAiHttpException {
    const name = call.resolved.deployment.name;
    const { code } = upstream.refusal;

    if (code === RelayErrorCode.INSTANCE_NOT_FOUND || code === RelayErrorCode.INSTANCE_NOT_READY) {
      this.logger.warn(
        { instanceKey, deploymentId: call.resolved.deployment.id, refusal: upstream.refusal },
        'relayFailure(): The node relay had no ready instance for a leased request'
      );

      return new OpenAiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        this.refused(`The model '${name}' is not available right now. Try again later.`, 'model_not_available')
      );
    }

    this.logger.error(
      { instanceKey, deploymentId: call.resolved.deployment.id, status: upstream.status, refusal: upstream.refusal },
      'relayFailure(): The node relay refused an inference request'
    );

    return new OpenAiHttpException(HttpStatus.BAD_GATEWAY, this.unreachable(name));
  }

  private unreachable(name: string): BackendError {
    return backendError(BackendErrorType.SERVER, `The model '${name}' could not be reached. Try again later.`, {
      code: 'model_unreachable',
    });
  }

  /** Null where nothing is answered, since the caller has gone or the response already ended. */
  private upstreamFailure(
    call: IProxiedCall,
    instanceKey: string,
    aborted: boolean,
    error: unknown
  ): OpenAiHttpException | null {
    if (call.response.writableEnded || call.response.destroyed) {
      return null;
    }

    if (aborted) {
      call.response.destroy();

      return null;
    }

    const unreachable = error instanceof RelayUnreachableError;
    const name = call.resolved.deployment.name;

    this.logger.error(
      { error, instanceKey, deploymentId: call.resolved.deployment.id },
      'upstreamFailure(): Relaying an inference request to a node failed'
    );

    return new OpenAiHttpException(
      HttpStatus.BAD_GATEWAY,
      unreachable
        ? this.unreachable(name)
        : backendError(
            BackendErrorType.SERVER,
            `The model '${name}' answered with a response that could not be read.`,
            {
              code: 'invalid_model_response',
            }
          )
    );
  }

  private jsonOrText(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private record(
    call: IProxiedCall,
    instanceKey: string | null,
    status: number,
    timeToFirstTokenMs: number | null,
    loadWaitMs: number | null,
    startedAt: number
  ): void {
    this.inferenceMetricsService.record({
      deploymentId: call.resolved.deployment.id,
      deploymentName: call.resolved.deployment.name,
      apiKeyId: call.apiKey.id,
      operation: call.operation,
      streaming: call.streaming,
      instanceKey,
      status,
      timeToFirstTokenMs,
      loadWaitMs,
      durationMs: performance.now() - startedAt,
    });
  }
}
