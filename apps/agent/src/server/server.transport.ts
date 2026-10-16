import { Injectable, Logger } from '@nestjs/common';
import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { Subscription } from 'rxjs';
import { RawData, WebSocket } from 'ws';

import { ServerMessage, decodeServerMessage } from '@libs/agent-protocol';
import { readFrame } from '@libs/runtime';

import { RestartSchedule } from '../common/restart-schedule';
import { ConfigService } from '../config/config.service';
import { ServerSessionService } from './server-session.service';
import { getServerSocketUrl } from './server-url';

const NO_SERVER_MESSAGE = 'ServerTransport wraps no server';

function noEventMessage(event: string): string {
  return `ServerTransport publishes no events, so '${event}' cannot be bound`;
}

@Injectable()
export class ServerTransport extends Server implements CustomTransportStrategy {
  protected readonly logger = new Logger(ServerTransport.name);

  private readonly restartSchedule: RestartSchedule;
  private readonly socketUrl: string;

  private opens: Subscription | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly serverSessionService: ServerSessionService
  ) {
    super();

    this.socketUrl = getServerSocketUrl(this.configService.serverUrl);

    this.restartSchedule = new RestartSchedule(this.configService.reconnectBackoff, () => {
      this.connect();
    });
  }

  /** Reports ready before it connects, since dialling is retried. */
  listen(callback: () => void): void {
    // A welcome resets the backoff, so a server refusing instantly is still dialled at the full delay.
    this.opens = this.serverSessionService.sessionOpened().subscribe(() => {
      this.restartSchedule.reset();
    });

    this.connect();

    callback();
  }

  on(event: string): never {
    throw new Error(noEventMessage(event));
  }

  unwrap(): never {
    throw new Error(NO_SERVER_MESSAGE);
  }

  close(): void {
    this.restartSchedule.stop();

    this.opens?.unsubscribe();
    this.opens = null;

    this.serverSessionService.close();
  }

  private connect(): void {
    this.logger.log(`connect(): Dialling ${this.socketUrl}`);

    const socket = new WebSocket(this.socketUrl, { handshakeTimeout: this.configService.connectTimeoutMs });

    const session = this.serverSessionService.open(socket);

    socket.on('open', () => {
      session.start();
    });

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        return;
      }

      try {
        this.handleFrame(readFrame(data));
      } catch (error: unknown) {
        this.logger.error({ error }, 'connect(): Reading a server frame failed');
      }
    });

    socket.on('error', (error: Error) => {
      this.logger.warn({ error }, 'connect(): The connection to the server errored');
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.scheduleReconnect(code, reason.toString());
    });
  }

  private handleFrame(frame: string): void {
    const decoded = decodeServerMessage(frame);

    if (!decoded.ok) {
      this.serverSessionService.active().handleMalformed(decoded.reason);

      return;
    }

    this.dispatch(decoded.message).catch((error: unknown) => {
      this.logger.error({ error }, 'handleFrame(): Handling a server message failed');
    });
  }

  /** A message type is the pattern an `@EventPattern` handler registers under. */
  private async dispatch(message: ServerMessage): Promise<void> {
    const handler = this.messageHandlers.get(message.type);

    if (handler === undefined) {
      this.logger.warn(`dispatch(): The server sent ${message.type}, which this agent has no handler for`);

      return;
    }

    await handler(message);
  }

  private scheduleReconnect(code: number, reason: string): void {
    const delayMs = this.restartSchedule.schedule();

    if (delayMs === null) {
      return;
    }

    this.logger.warn(
      { code, reason, attempt: this.restartSchedule.attempts },
      `scheduleReconnect(): The connection closed, dialling again in ${delayMs}ms`
    );
  }
}
