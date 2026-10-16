import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayErrorCode } from '@libs/agent-protocol';
import { BackendId, BackendOperation } from '@libs/backends';
import { BackendError } from '@libs/backends/openai';
import { backendFor } from '@libs/backends/runtime';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';
import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { IProxiedCall, RelayProxyService } from './relay-proxy.service';
import { ConfigService } from '@/config/config.service';
import { RelayClientService, RelayUnreachableError } from '@/core/agent/relay-client.service';
import { IResolvedDeployment } from '@/core/inference/deployment-resolver.service';
import { IInferenceMetric, InferenceMetricsService } from '@/core/inference/inference-metrics.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';
import { AcquireRefusal, IAcquireResult } from '@/core/supervisor/supervisor.types';

const resultOf = (fields: Partial<IAcquireResult>): IAcquireResult => ({
  lease: null,
  refusal: null,
  problem: null,
  retryInMs: null,
  waitedMs: null,
  ...fields,
});

const leased = (release = vi.fn(), waitedMs: number | null = null): IAcquireResult =>
  resultOf({
    lease: { instanceKey: 'key', nodeId: 1, relay: { url: 'http://node', token: 'token' }, release },
    waitedMs,
  });

const refusalFrom = async (run: () => Promise<unknown>): Promise<OpenAiHttpException> => {
  try {
    await run();
  } catch (error: unknown) {
    return error as OpenAiHttpException;
  }

  throw new Error('The call was expected to be refused');
};

const callerStream = () => {
  const stream = new PassThrough();
  const response = Object.assign(stream, {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
  });

  return { stream, response: response as unknown as Response & typeof response };
};

describe('RelayProxyService', () => {
  let inferenceMetricsService: { record: ReturnType<typeof vi.fn> };
  let relayClientService: { send: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let deploymentSupervisorService: {
    acquire: Mock<DeploymentSupervisorService['acquire']>;
    findReady: Mock<DeploymentSupervisorService['findReady']>;
  };
  let relayProxyService: RelayProxyService;
  let call: IProxiedCall;

  const responseOf = (overrides: Record<string, unknown> = {}) =>
    ({
      statusCode: 200,
      closed: false,
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      on: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      ...overrides,
    }) as unknown as Response;

  beforeEach(() => {
    inferenceMetricsService = { record: vi.fn() };
    relayClientService = {
      send: vi.fn().mockResolvedValue({ refusal: null, status: 200, stream: Readable.from(['{}']) }),
      get: vi.fn().mockResolvedValue({ refusal: null, status: 200, stream: Readable.from(['{"voices":["vivian"]}']) }),
    };
    deploymentSupervisorService = {
      acquire: vi.fn<DeploymentSupervisorService['acquire']>().mockResolvedValue(leased()),
      findReady: vi.fn<DeploymentSupervisorService['findReady']>().mockResolvedValue({
        instanceKey: 'ready',
        relay: { url: 'http://node', token: 'token' },
        configurationRevision: 'rev-1',
      }),
    };

    relayProxyService = new RelayProxyService(
      { gatewayLoadWaitTimeoutMs: 900_000 } as unknown as ConfigService,
      deploymentSupervisorService as unknown as DeploymentSupervisorService,
      inferenceMetricsService as unknown as InferenceMetricsService,
      relayClientService as unknown as RelayClientService
    );

    call = {
      resolved: {
        deployment: { id: 3, name: 'chat-8b' } as Deployment,
        capability: { path: '/v1/chat/completions' },
        mapping: { error: (status: number, body: unknown) => ({ error: { status, body } }) },
      } as unknown as IResolvedDeployment,
      apiKey: { id: 42 } as ApiKey,
      response: responseOf(),
      operation: BackendOperation.CHAT_COMPLETIONS,
      upstreamBody: Buffer.from('{}'),
      contentType: 'application/json',
      streaming: false,
      mapBody: body => body,
      mapChunk: chunk => chunk,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('relays to the instance the supervisor leased, and releases it', async () => {
    const release = vi.fn();

    deploymentSupervisorService.acquire.mockResolvedValue(leased(release));

    await relayProxyService.proxy(call);

    const [deploymentId, options] = deploymentSupervisorService.acquire.mock.calls[0];

    expect(deploymentId).toBe(3);
    expect(options.maxWaitMs).toBe(900_000);
    expect(relayClientService.send).toHaveBeenCalledWith(expect.objectContaining({ instanceKey: 'key' }));
    expect(release).toHaveBeenCalled();
  });

  it("pipes a 2xx answer with no body mapping to the caller byte for byte, under the backend's own type", async () => {
    const audio = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x0d, 0x0a, 0x7b]);
    const caller = callerStream();

    relayClientService.send.mockResolvedValue({
      refusal: null,
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(audio.length) },
      stream: Readable.from([audio.subarray(0, 3), audio.subarray(3)]),
    });
    call.operation = BackendOperation.SPEECH;
    call.mapBody = undefined;
    call.mapChunk = undefined;
    call.response = caller.response;

    const received = buffer(caller.stream);

    await relayProxyService.proxy(call);

    expect((await received).equals(audio)).toBe(true);
    expect(caller.response.status).toHaveBeenCalledWith(200);
    expect(caller.response.setHeader).toHaveBeenCalledWith('content-type', 'audio/mpeg');
    expect(relayClientService.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: call.upstreamBody, contentType: 'application/json', accept: '*/*' })
    );
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(expect.objectContaining({ operation: 'speech' }));
  });

  it('measures time to first token to the first byte of a stream no chunk mapping reads', async () => {
    const caller = callerStream();

    relayClientService.send.mockResolvedValue({
      refusal: null,
      status: 200,
      headers: {},
      stream: Readable.from(['data: {"type":"transcript.text.delta","delta":"hi"}\n\n']),
    });
    call.streaming = true;
    call.mapChunk = undefined;
    call.response = caller.response;

    const received = buffer(caller.stream);

    await relayProxyService.proxy(call);

    expect((await received).toString()).toBe('data: {"type":"transcript.text.delta","delta":"hi"}\n\n');
    const [metric] = inferenceMetricsService.record.mock.calls[0] as [IInferenceMetric];

    expect(metric.timeToFirstTokenMs).not.toBeNull();
  });

  it("throws a backend's plain-text failure in OpenAI's shape under the backend's status", async () => {
    relayClientService.send.mockResolvedValue({
      refusal: null,
      status: 400,
      stream: Readable.from(['Audio could not be decoded']),
    });
    call.resolved = { ...call.resolved, mapping: backendFor(BackendId.LLAMA_CPP).mapping };
    call.mapBody = undefined;

    const thrown = await refusalFrom(() => relayProxyService.proxy(call));

    expect(thrown.getStatus()).toBe(400);
    expect((thrown.getResponse() as BackendError).error).toMatchObject({
      type: 'invalid_request_error',
      message: 'Audio could not be decoded',
    });
  });

  it('cuts the connection rather than writing an error after bytes already went out', async () => {
    const caller = callerStream();
    const upstream = new Readable({ read: () => undefined });

    relayClientService.send.mockResolvedValue({ refusal: null, status: 200, headers: {}, stream: upstream });
    call.mapBody = undefined;
    call.response = caller.response;
    caller.stream.resume();

    const proxying = relayProxyService.proxy(call);

    upstream.push(Buffer.from([0xff, 0xfb]));
    setImmediate(() => upstream.destroy(new Error('The backend went away')));

    await expect(proxying).resolves.toBeUndefined();
    expect(caller.stream.destroyed).toBe(true);
  });

  it("streams an unmapped answer under the backend's own type, set before the head goes out", async () => {
    const caller = callerStream();

    relayClientService.send.mockResolvedValue({
      refusal: null,
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      stream: Readable.from([Buffer.from([0xff, 0xfb])]),
    });
    call.streaming = true;
    call.mapChunk = undefined;
    call.response = caller.response;
    caller.stream.resume();

    await relayProxyService.proxy(call);

    const typeCall = caller.response.setHeader.mock.calls.findIndex(([name]) => name === 'content-type');

    expect(caller.response.setHeader.mock.calls[typeCall]).toEqual(['content-type', 'audio/mpeg']);
    expect(caller.response.setHeader.mock.invocationCallOrder[typeCall]).toBeLessThan(
      caller.response.flushHeaders.mock.invocationCallOrder[0]
    );
  });

  it('refuses a request the supervisor refused, recording how long it waited', async () => {
    deploymentSupervisorService.acquire.mockResolvedValue(
      resultOf({ refusal: AcquireRefusal.DOES_NOT_FIT, waitedMs: 3 })
    );

    const thrown = await refusalFrom(() => relayProxyService.proxy(call));

    expect(thrown.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 3, apiKeyId: 42, status: 503, loadWaitMs: 3 })
    );
  });

  it('dials nothing for a caller that left while waiting, and records it as closed', async () => {
    deploymentSupervisorService.acquire.mockResolvedValue(resultOf({ waitedMs: 5000 }));

    await relayProxyService.proxy(call);

    expect(relayClientService.send).not.toHaveBeenCalled();
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 499, loadWaitMs: 5000 })
    );
  });

  it('dials nothing for a caller that left before the request was routed, and records it as closed', async () => {
    const release = vi.fn();

    deploymentSupervisorService.acquire.mockResolvedValue(leased(release));
    call.response = responseOf({ closed: true });

    await relayProxyService.proxy(call);

    expect(relayClientService.send).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(expect.objectContaining({ status: 499 }));
  });

  it('keeps a streaming caller alive from the moment it waits, every fifteen seconds, until it is answered', async () => {
    vi.useFakeTimers();

    const response = {
      headersSent: false,
      closed: false,
      on: vi.fn(),
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      write: vi.fn(),
      flushHeaders: vi.fn(() => {
        response.headersSent = true;
      }),
    };
    const { promise, resolve } = Promise.withResolvers<IAcquireResult>();

    call.streaming = true;
    call.response = response as unknown as Response;
    deploymentSupervisorService.acquire.mockImplementation((_id, options) => {
      options.onWait();

      return promise;
    });

    const proxying = refusalFrom(() => relayProxyService.proxy(call));

    await vi.advanceTimersByTimeAsync(45_000);
    resolve(resultOf({ refusal: AcquireRefusal.FAILED }));
    await proxying;
    await vi.advanceTimersByTimeAsync(45_000);

    expect(response.flushHeaders).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('content-type', 'text/event-stream');
    expect(response.setHeader).toHaveBeenCalledWith('x-accel-buffering', 'no');
    expect(response.write).toHaveBeenCalledTimes(4);
    expect(response.write).toHaveBeenCalledWith(': keepalive\n\n');
  });

  it('keeps nothing alive for a caller that is not streaming', async () => {
    deploymentSupervisorService.acquire.mockImplementation((_id, options) => {
      options.onWait();

      return Promise.resolve(leased());
    });

    await relayProxyService.proxy(call);

    expect(call.response.headersSent).toBe(false);
  });

  it.each([
    [
      {
        refusal: AcquireRefusal.DOES_NOT_FIT,
        problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
      },
      'model_does_not_fit',
      "The model 'chat-8b' cannot start on the GPUs it is pinned to right now. This deployment needs 20.0 GiB, more " +
        'than the pinned GPUs have free.',
    ],
    [
      {
        refusal: AcquireRefusal.CANNOT_START,
        problem: 'This deployment is disabled. Enable it before starting an instance',
      },
      'model_cannot_start',
      "The model 'chat-8b' cannot be started. This deployment is disabled. Enable it before starting an instance.",
    ],
    [
      { refusal: AcquireRefusal.FAILED, problem: 'error: CUDA out of memory.' },
      'model_failed_to_start',
      "The model 'chat-8b' failed to start. error: CUDA out of memory.",
    ],
    [
      { refusal: AcquireRefusal.BACKING_OFF, problem: 'error: CUDA out of memory', retryInMs: 29_600 },
      'model_failed_to_start',
      "The model 'chat-8b' failed to start and is not tried again for 30 seconds. error: CUDA out of memory.",
    ],
    [
      { refusal: AcquireRefusal.GIVEN_UP, problem: 'error: weights are corrupt' },
      'model_failed_to_start',
      "The model 'chat-8b' failed to start too many times in a row and is not tried again until an operator starts it or changes its configuration. error: weights are corrupt.",
    ],
    [
      { refusal: AcquireRefusal.TIMED_OUT },
      'model_load_timeout',
      "The model 'chat-8b' did not become ready within 15 minutes. Try again later.",
    ],
    [
      { refusal: AcquireRefusal.NOT_AVAILABLE },
      'model_not_available',
      "The model 'chat-8b' is not available right now. Try again later.",
    ],
  ])('answers a request refused as %o with %s', async (refused, code, message) => {
    deploymentSupervisorService.acquire.mockResolvedValue(resultOf(refused));

    const thrown = await refusalFrom(() => relayProxyService.proxy(call));

    expect((thrown.getResponse() as BackendError).error).toMatchObject({ type: 'server_error', code, message });
  });

  it("throws a backend's own failure under its own status, through the mapping", async () => {
    relayClientService.send.mockResolvedValue({
      refusal: null,
      status: 400,
      stream: Readable.from(['{"message":"full"}']),
    });

    const thrown = await refusalFrom(() => relayProxyService.proxy(call));

    expect(thrown.getStatus()).toBe(400);
    expect(thrown.getResponse()).toEqual({ error: { status: 400, body: { message: 'full' } } });
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ instanceKey: 'key', status: 400 })
    );
  });

  it.each([
    [RelayErrorCode.INSTANCE_NOT_FOUND, HttpStatus.SERVICE_UNAVAILABLE, 'model_not_available'],
    [RelayErrorCode.INSTANCE_NOT_READY, HttpStatus.SERVICE_UNAVAILABLE, 'model_not_available'],
    [RelayErrorCode.INSTANCE_UNREACHABLE, HttpStatus.BAD_GATEWAY, 'model_unreachable'],
    [RelayErrorCode.UNAUTHORIZED, HttpStatus.BAD_GATEWAY, 'model_unreachable'],
    [RelayErrorCode.NOT_FOUND, HttpStatus.BAD_GATEWAY, 'model_unreachable'],
    [RelayErrorCode.BAD_REQUEST, HttpStatus.BAD_GATEWAY, 'model_unreachable'],
    [null, HttpStatus.BAD_GATEWAY, 'model_unreachable'],
  ])('answers a relay refusal coded %s in its own words, never through the mapping', async (code, status, answered) => {
    const mappingError = vi.spyOn(call.resolved.mapping, 'error');

    relayClientService.send.mockResolvedValue({ refusal: { code, message: 'From the relay' }, status: 503 });

    const thrown = await refusalFrom(() => relayProxyService.proxy(call));

    expect(thrown.getStatus()).toBe(status);
    expect((thrown.getResponse() as BackendError).error).toMatchObject({ type: 'server_error', code: answered });
    expect(JSON.stringify(thrown.getResponse())).not.toContain('From the relay');
    expect(mappingError).not.toHaveBeenCalled();
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ instanceKey: 'key', status })
    );
  });

  it('throws a relay that cannot be reached as a 502 naming it', async () => {
    relayClientService.send.mockRejectedValue(
      new RelayUnreachableError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    );

    const thrown = await refusalFrom(() => relayProxyService.proxy(call));

    expect(thrown.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect((thrown.getResponse() as BackendError).error.code).toBe('model_unreachable');
    expect(inferenceMetricsService.record).toHaveBeenCalledWith(expect.objectContaining({ status: 502 }));
  });

  it('answers nothing for a response already ended when the relay fails', async () => {
    relayClientService.send.mockRejectedValue(new Error('pipe broke'));
    call.response = responseOf({ writableEnded: true });

    await expect(relayProxyService.proxy(call)).resolves.toBeUndefined();
  });

  describe('queryIfReady', () => {
    const deployment = { id: 5, name: 'qwen-tts' } as Deployment;

    it("reads a ready instance with a GET, leasing nothing, and answers with the instance's revision", async () => {
      await expect(relayProxyService.queryIfReady(deployment, '/v1/audio/voices')).resolves.toEqual({
        configurationRevision: 'rev-1',
        body: { voices: ['vivian'] },
      });

      expect(deploymentSupervisorService.findReady).toHaveBeenCalledWith(5);
      expect(relayClientService.get).toHaveBeenCalledWith(
        expect.objectContaining({ instanceKey: 'ready', path: '/v1/audio/voices' })
      );
      expect(deploymentSupervisorService.acquire).not.toHaveBeenCalled();
      expect(inferenceMetricsService.record).not.toHaveBeenCalled();
    });

    it('reads nothing where no instance is ready', async () => {
      deploymentSupervisorService.findReady.mockResolvedValue(null);

      await expect(relayProxyService.queryIfReady(deployment, '/v1/audio/voices')).resolves.toBeUndefined();
      expect(relayClientService.get).not.toHaveBeenCalled();
    });

    it.each([
      [
        "the backend's refusal",
        () => relayClientService.get.mockResolvedValue({ refusal: null, status: 500, stream: Readable.from(['{}']) }),
      ],
      [
        "the relay's refusal",
        () =>
          relayClientService.get.mockResolvedValue({
            refusal: { code: RelayErrorCode.INSTANCE_NOT_READY, message: 'Starting' },
            status: 503,
          }),
      ],
      [
        'a body that is not JSON',
        () =>
          relayClientService.get.mockResolvedValue({ refusal: null, status: 200, stream: Readable.from(['<html>']) }),
      ],
      ['a relay that cannot be reached', () => relayClientService.get.mockRejectedValue(new Error('socket hang up'))],
    ])('answers nothing for %s', async (_case, arrange) => {
      arrange();

      await expect(relayProxyService.queryIfReady(deployment, '/v1/audio/voices')).resolves.toBeUndefined();
    });
  });
});
