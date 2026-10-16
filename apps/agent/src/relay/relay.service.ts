import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

import { readRelayLogsRoute, readRelayRoute, RelayErrorCode } from '@libs/agent-protocol';

import { ConfigService } from '../config/config.service';
import { InferenceRelayService } from './inference/inference-relay.service';
import { LogsRelayService } from './logs/logs-relay.service';
import { refuse } from './relay-error';
import { RelayTokenService } from './relay-token.service';

const BEARER_PREFIX = 'Bearer ';

const UNAUTHORIZED_MESSAGE = 'This relay accepts the token minted at the agent handshake, presented as a bearer token';

const NOT_FOUND_MESSAGE =
  'A relayed request is addressed to /instances/<instance key>/<backend path>, and a log to GET /logs/<instance key>';

@Injectable()
export class RelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RelayService.name);

  private server: Server | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly relayTokenService: RelayTokenService,
    private readonly inferenceRelayService: InferenceRelayService,
    private readonly logsRelayService: LogsRelayService
  ) {}

  /** The port the listener bound, which is null until it has. */
  get port(): number | null {
    const address = this.server?.address() ?? null;

    return address === null || typeof address === 'string' ? null : address.port;
  }

  onApplicationBootstrap(): Promise<void> {
    return this.listen();
  }

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }

  private listen(): Promise<void> {
    const server = createServer((request, response) => {
      // A caller vanishing mid-request errors whichever stream no pipeline has taken over yet.
      request.on('error', error => this.logCallerError(error, request));
      response.on('error', error => this.logCallerError(error, request));

      this.relay(request, response);
    });

    this.server = server;

    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);

      server.listen(this.configService.relayPort, () => {
        server.off('error', reject);
        server.on('error', (error: unknown) => {
          this.logger.error({ error }, 'listen(): The relay listener failed');
        });

        this.logger.log({ port: this.port }, 'listen(): The relay is listening');
        resolve();
      });
    });
  }

  /** Closes the listener without waiting on requests in flight, which a shutdown has already cut off upstream. */
  private close(): Promise<void> {
    const server = this.server;

    this.server = null;

    if (server === null) {
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      server.closeAllConnections();
      server.close(() => {
        this.inferenceRelayService.closeUpstream();
        resolve();
      });
    });
  }

  private relay(request: IncomingMessage, response: ServerResponse): void {
    if (!this.isAuthorised(request)) {
      refuse(response, 401, RelayErrorCode.UNAUTHORIZED, UNAUTHORIZED_MESSAGE);

      return;
    }

    const logsRoute = request.method === 'GET' ? readRelayLogsRoute(request.url ?? '') : null;

    if (logsRoute !== null) {
      this.logsRelayService.serve(response, logsRoute.instanceKey, logsRoute.tail);

      return;
    }

    const route = readRelayRoute(request.url ?? '');

    if (route === null) {
      refuse(response, 404, RelayErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE);

      return;
    }

    this.inferenceRelayService.serve(request, response, route);
  }

  private logCallerError(error: unknown, request: IncomingMessage): void {
    this.logger.debug({ error, target: request.url }, 'relay(): A caller connection ended on an error');
  }

  private isAuthorised(request: IncomingMessage): boolean {
    const presented = request.headers.authorization ?? '';

    if (!presented.startsWith(BEARER_PREFIX)) {
      return false;
    }

    return this.relayTokenService.accepts(presented.slice(BEARER_PREFIX.length));
  }
}
