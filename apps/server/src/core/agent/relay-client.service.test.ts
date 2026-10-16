import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRelay, RELAY_REFUSAL_HEADER, RELAY_TAIL_COMPLETE_HEADER, RelayErrorCode } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import {
  IRelayAnswer,
  RelayClientService,
  RelayResponse,
  RelayUnreachableError,
} from '@/core/agent/relay-client.service';

const INSTANCE_KEY = '01999999-1111-7111-8111-111111111111';

const TOKEN = 'a-relay-token-long-enough-for-the-schema';

const HEADERS_TIMEOUT_MS = 100;

interface ISeenRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('RelayClientService', () => {
  let server: Server;
  let relay: AgentRelay;
  let seen: ISeenRequest[];
  let answer: (response: ServerResponse) => void;
  let relayClientService: RelayClientService;

  beforeEach(async () => {
    // The headers deadline fires only when a test advances the clock, never because the runner is slow.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    seen = [];
    answer = response => response.writeHead(200).end();

    server = createServer((request, response) => {
      void text(request).then(body => {
        seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body });
        answer(response);
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    relay = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, token: TOKEN };
    relayClientService = new RelayClientService({
      gatewayUpstreamHeadersTimeoutMs: HEADERS_TIMEOUT_MS,
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    vi.useRealTimers();

    relayClientService.onApplicationShutdown();
    server.closeAllConnections();

    await new Promise(resolve => server.close(resolve));
  });

  const logs = () =>
    relayClientService.logs({ relay, instanceKey: INSTANCE_KEY, tail: 1000, signal: new AbortController().signal });

  describe('logs', () => {
    it('asks for the tail as plain text, bearing the session token', async () => {
      const response = await logs();

      response.stream.resume();

      expect(seen[0]).toMatchObject({
        method: 'GET',
        url: `/logs/${INSTANCE_KEY}?tail=1000`,
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/plain' },
      });
    });

    it.each([
      ['true', true],
      ['false', false],
      [undefined, false],
    ])('reads a tail-complete header of %j as %j', async (header, complete) => {
      answer = response =>
        response.writeHead(200, header === undefined ? {} : { [RELAY_TAIL_COMPLETE_HEADER]: header }).end();

      const response = await logs();

      response.stream.resume();

      expect(response).toMatchObject({ status: 200, tailComplete: complete });
    });

    it('gives up on a relay that sends no head before the deadline', async () => {
      const { promise: arrived, resolve: arrive } = Promise.withResolvers<ServerResponse>();

      answer = arrive;

      const refused = expect(logs()).rejects.toBeInstanceOf(RelayUnreachableError);
      await arrived;

      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS);

      await refused;
    });

    it('waits for the body however long it runs once the head has arrived', async () => {
      const { promise: headed, resolve: head } = Promise.withResolvers<ServerResponse>();

      answer = response => {
        response.writeHead(200);
        response.flushHeaders();
        head(response);
      };

      const response = await logs();

      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS * 3);
      (await headed).end('ready\n');

      expect(await text(response.stream)).toBe('ready\n');
    });
  });

  describe('backend requests', () => {
    const target = (accept: string) => ({
      relay,
      instanceKey: INSTANCE_KEY,
      path: '/v1/chat/completions',
      accept,
      signal: new AbortController().signal,
    });

    const answered = (response: RelayResponse): IRelayAnswer => {
      if (response.refusal !== null) {
        throw new Error(`The relay refused: ${response.refusal.message}`);
      }

      return response;
    };

    it('posts the body to the instance path with its type and length', async () => {
      const body = Buffer.from('{"stream":false}');

      const response = await relayClientService.send({
        ...target('application/json'),
        body,
        contentType: 'application/json',
      });

      answered(response).stream.resume();

      expect(seen[0]).toMatchObject({
        method: 'POST',
        url: `/instances/${INSTANCE_KEY}/v1/chat/completions`,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': `${body.length}`,
        },
        body: '{"stream":false}',
      });
    });

    it("holds a stream's request to the headers deadline", async () => {
      const { promise: arrived, resolve: arrive } = Promise.withResolvers<ServerResponse>();

      answer = arrive;

      const refused = expect(relayClientService.get(target('text/event-stream'))).rejects.toBeInstanceOf(
        RelayUnreachableError
      );
      await arrived;

      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS);

      await refused;
    });

    it("waits past the deadline for a whole answer's head", async () => {
      const { promise: arrived, resolve: arrive } = Promise.withResolvers<ServerResponse>();

      answer = arrive;

      const pending = relayClientService.get(target('application/json'));
      const held = await arrived;

      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS * 3);
      held.writeHead(200).end('{}');

      expect(await text(answered(await pending).stream)).toBe('{}');
    });

    it("hands a backend's own refusal on as its answer, status and body untouched", async () => {
      answer = response => response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"no route"}');

      const response = answered(await relayClientService.get(target('application/json')));

      expect(response.status).toBe(404);
      expect(await text(response.stream)).toBe('{"error":"no route"}');
    });

    it('tells a refusal the relay answered itself apart from the backend', async () => {
      answer = response =>
        response
          .writeHead(503, { 'content-type': 'application/json', [RELAY_REFUSAL_HEADER]: 'instance_not_ready' })
          .end('{"error":{"code":"instance_not_ready","message":"The instance is starting"}}');

      expect(await relayClientService.get(target('application/json'))).toEqual({
        refusal: { code: RelayErrorCode.INSTANCE_NOT_READY, message: 'The instance is starting' },
        status: 503,
      });
    });

    it('keeps a refusal whose body it cannot read, naming no code', async () => {
      answer = response => response.writeHead(502, { [RELAY_REFUSAL_HEADER]: 'something_new' }).end('gone');

      expect(await relayClientService.get(target('application/json'))).toEqual({
        refusal: { code: null, message: 'gone' },
        status: 502,
      });
    });

    it('lets a caller who goes away mid-refusal abort, rather than reading a refusal it never received', async () => {
      const controller = new AbortController();

      answer = response => {
        response.writeHead(503, { [RELAY_REFUSAL_HEADER]: 'instance_not_ready' }).write('{"error":');
        setImmediate(() => controller.abort());
      };

      await expect(
        relayClientService.get({ ...target('application/json'), signal: controller.signal })
      ).rejects.toThrow();
    });
  });
});
