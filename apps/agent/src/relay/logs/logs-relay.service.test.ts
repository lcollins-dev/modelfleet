import Docker from 'dockerode';
import { ClientRequest, IncomingMessage, request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { RELAY_TAIL_COMPLETE_HEADER, RelayError } from '@libs/agent-protocol';
import { INSTANCE_LABEL } from '@libs/backends/runtime';

import { ConfigService } from '@/config/config.service';
import { ContainerService, NODE_LABEL } from '@/docker/container.service';
import { InstanceEndpointService } from '@/instance/instance-endpoint.service';
import { InferenceRelayService } from '@/relay/inference/inference-relay.service';
import { LogsRelayService } from '@/relay/logs/logs-relay.service';
import { RelayTokenService } from '@/relay/relay-token.service';
import { RelayService } from '@/relay/relay.service';

const INSTANCE_KEY = '11111111-2222-4333-8444-555555555555';
const NODE_KEY = '01999999-0000-7000-8000-000000000001';
const OTHER_NODE_KEY = '01999999-0000-7000-8000-000000000002';

const STDOUT = 1;
const STDERR = 2;

const LINE_1 = '2026-10-15T14:02:11.000000001Z loading model\n';
const LINE_2 = '2026-10-15T14:02:11.000000002Z ready\n';
const LINE_3 = '2026-10-15T14:02:11.000000003Z served a request\n';

interface IContainerFixture {
  Id: string;
  Created: number;
  Labels: Record<string, string>;
}

interface ILogsOptions {
  follow?: boolean;
  tail: number;
}

interface IAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const framed = (stream: number, payload: string): Buffer => {
  const body = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);

  header[0] = stream;
  header.writeUInt32BE(body.length, 4);

  return Buffer.concat([header, body]);
};

const instanceContainer = (id: string, created: number, nodeKey = NODE_KEY): IContainerFixture => ({
  Id: id,
  Created: created,
  Labels: { [INSTANCE_LABEL]: INSTANCE_KEY, [NODE_LABEL]: nodeKey },
});

const responseOf = (clientRequest: ClientRequest): Promise<IncomingMessage> =>
  new Promise<IncomingMessage>((resolve, reject) => {
    clientRequest.on('error', reject);
    clientRequest.on('response', resolve);
  });

const read = async (clientRequest: ClientRequest): Promise<IAnswer> => {
  const response = await responseOf(clientRequest);
  const chunks: Buffer[] = [];

  for await (const chunk of response) {
    chunks.push(chunk as Buffer);
  }

  return { status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') };
};

describe('LogsRelayService', () => {
  let relayService: RelayService;
  let relayTokenService: RelayTokenService;
  let logsRelayService: LogsRelayService;
  let containers: IContainerFixture[];
  let entries: Buffer[];
  let followed: PassThrough;
  let listContainers: ReturnType<typeof vi.fn>;
  let logs: Mock<(id: string, options: ILogsOptions) => Promise<Buffer | PassThrough>>;
  let token: string;

  const send = (target: string, options: { method?: string; authorization?: string } = {}) => {
    const clientRequest = httpRequest({
      host: '127.0.0.1',
      port: relayService.port ?? 0,
      method: options.method ?? 'GET',
      path: target,
      headers: { authorization: options.authorization ?? `Bearer ${token}` },
    });

    clientRequest.end();

    return clientRequest;
  };

  beforeEach(async () => {
    containers = [instanceContainer('c-1', 100)];
    entries = [framed(STDOUT, LINE_1), framed(STDERR, LINE_2)];
    followed = new PassThrough();

    listContainers = vi.fn((options: { filters: { label: string[] } }) =>
      Promise.resolve(
        containers.filter(container =>
          options.filters.label.every(filter => {
            const [name, value] = filter.split('=');

            return container.Labels[name] === value;
          })
        )
      )
    );
    logs = vi.fn((_: string, options: ILogsOptions) =>
      Promise.resolve(options.follow === true ? followed : Buffer.concat(entries.slice(-options.tail)))
    );

    const docker = {
      listContainers,
      getContainer: (id: string) => ({ logs: (options: ILogsOptions) => logs(id, options) }),
    } as unknown as Docker;
    const configService = { relayPort: 0, relayHeadersTimeoutMs: 2000, nodeKey: NODE_KEY } as unknown as ConfigService;

    relayTokenService = new RelayTokenService();
    logsRelayService = new LogsRelayService(new ContainerService(configService, docker));
    relayService = new RelayService(
      configService,
      relayTokenService,
      new InferenceRelayService(configService, new InstanceEndpointService()),
      logsRelayService
    );

    token = relayTokenService.mint();

    await relayService.onApplicationBootstrap();
  });

  afterEach(async () => {
    await relayService.onApplicationShutdown();
  });

  describe('refusals', () => {
    it('refuses a request carrying no token the handshake minted', async () => {
      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`, { authorization: 'Bearer not-the-token' }));

      expect(answer.status).toBe(401);
      expect((JSON.parse(answer.body) as RelayError).error.code).toBe('unauthorized');
      expect(listContainers).not.toHaveBeenCalled();
    });

    it('refuses a tail it cannot read', async () => {
      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=all`));

      expect(answer.status).toBe(400);
      expect((JSON.parse(answer.body) as RelayError).error.code).toBe('bad_request');
      expect(listContainers).not.toHaveBeenCalled();
    });

    it('serves a log only on GET', async () => {
      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`, { method: 'POST' }));

      expect(answer.status).toBe(404);
      expect((JSON.parse(answer.body) as RelayError).error.code).toBe('not_found');
    });

    it('names an instance this node holds no container for', async () => {
      containers = [];

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`));
      const { error } = JSON.parse(answer.body) as RelayError;

      expect(answer.status).toBe(404);
      expect(error.code).toBe('instance_not_found');
      expect(error.message).toContain(INSTANCE_KEY);
    });

    it("never serves another node's container for the instance, though it shares the daemon", async () => {
      containers = [instanceContainer('c-other', 200, OTHER_NODE_KEY)];

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`));

      expect(answer.status).toBe(404);
      expect(listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: [`${INSTANCE_LABEL}=${INSTANCE_KEY}`, `${NODE_LABEL}=${NODE_KEY}`] },
      });
      expect(logs).not.toHaveBeenCalled();
    });

    it('names a daemon it could not reach', async () => {
      listContainers.mockRejectedValue(Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' }));

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`));
      const { error } = JSON.parse(answer.body) as RelayError;

      expect(answer.status).toBe(502);
      expect(error.code).toBe('instance_unreachable');
      expect(error.message).toContain('ENOENT');
    });
  });

  describe('streaming', () => {
    it('reads the most recently created container where a relaunch overlaps its predecessor', async () => {
      containers = [instanceContainer('c-old', 100), instanceContainer('c-new', 200), instanceContainer('c-mid', 150)];
      followed.end();

      await read(send(`/logs/${INSTANCE_KEY}?tail=10`));

      expect(logs).toHaveBeenCalledWith('c-new', { stdout: true, stderr: true, tail: 11 });
      expect(logs).toHaveBeenCalledWith('c-new', {
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: 10,
      });
    });

    it("says the tail is complete where it reaches the container's first line", async () => {
      followed.end();

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`));

      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(answer.headers[RELAY_TAIL_COMPLETE_HEADER]).toBe('true');
    });

    it('says a tail of exactly the whole log is complete', async () => {
      followed.end();

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=2`));

      expect(answer.headers[RELAY_TAIL_COMPLETE_HEADER]).toBe('true');
    });

    it('says the tail is incomplete where the log holds more than it', async () => {
      entries.push(framed(STDOUT, LINE_3));
      followed.end();

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=2`));

      expect(answer.headers[RELAY_TAIL_COMPLETE_HEADER]).toBe('false');
    });

    it('counts a line Docker split into two entries twice, as its tail does', async () => {
      entries = [framed(STDOUT, 'the first part of a long line, '), framed(STDOUT, 'and the rest\n')];
      followed.end();

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=1`));

      expect(answer.headers[RELAY_TAIL_COMPLETE_HEADER]).toBe('false');
    });

    it('says an empty log is complete', async () => {
      entries = [];
      followed.end();

      const answer = await read(send(`/logs/${INSTANCE_KEY}?tail=10`));

      expect(answer.headers[RELAY_TAIL_COMPLETE_HEADER]).toBe('true');
    });

    it('relays the tail and what follows it, demultiplexed, until the container stops', async () => {
      const clientRequest = send(`/logs/${INSTANCE_KEY}?tail=10`);

      followed.write(Buffer.concat([framed(STDOUT, LINE_1), framed(STDERR, LINE_2)]));
      followed.end(framed(STDOUT, LINE_3));

      expect((await read(clientRequest)).body).toBe(`${LINE_1}${LINE_2}${LINE_3}`);
    });

    it('sends the head before the container has written anything', async () => {
      const answer = await responseOf(send(`/logs/${INSTANCE_KEY}?tail=10`));

      expect(answer.statusCode).toBe(200);

      followed.end();
    });

    it("destroys the daemon's follow as soon as the caller goes", async () => {
      const clientRequest = send(`/logs/${INSTANCE_KEY}?tail=10`);

      clientRequest.on('error', () => {});
      followed.write(framed(STDOUT, LINE_1));

      const response = await responseOf(clientRequest);

      await new Promise<void>(resolve => {
        response.once('data', () => resolve());
      });

      const destroyed = new Promise<void>(resolve => {
        followed.once('close', () => resolve());
      });

      clientRequest.destroy();

      await destroyed;

      expect(followed.destroyed).toBe(true);
    });

    it("destroys the daemon's follow where the caller left while Docker was still answering", async () => {
      let answerFollow: (stream: PassThrough) => void = () => {};

      logs.mockImplementation((_: string, options: ILogsOptions) =>
        options.follow === true
          ? new Promise<PassThrough>(resolve => {
              answerFollow = resolve;
            })
          : Promise.resolve(Buffer.concat(entries))
      );

      const serve = vi.spyOn(logsRelayService, 'serve');
      const clientRequest = send(`/logs/${INSTANCE_KEY}?tail=10`);

      clientRequest.on('error', () => {});

      await vi.waitFor(() => expect(logs).toHaveBeenCalledTimes(2));

      const [response] = serve.mock.calls[0];
      const left = new Promise<void>(resolve => {
        response.once('close', () => resolve());
      });

      clientRequest.destroy();
      await left;

      answerFollow(followed);

      await vi.waitFor(() => expect(followed.destroyed).toBe(true));
    });
  });
});
