import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { WebSocket } from 'ws';

import { AgentCloseCode, AgentCloseReason } from '@libs/agent-protocol';
import { toSocketPort } from '@libs/runtime';

import { ConfigService } from '../config/config.service';
import { RelayTokenService } from '../relay/relay-token.service';
import { IServerSessionOptions, ServerSession } from './server-session';

@Injectable()
export class ServerSessionService {
  private readonly logger = new Logger(ServerSessionService.name);

  private session: ServerSession | null = null;

  private readonly opened = new Subject<void>();
  private readonly closed = new Subject<void>();

  constructor(
    private readonly configService: ConfigService,
    private readonly relayTokenService: RelayTokenService
  ) {}

  sessionOpened(): Observable<void> {
    return this.opened.asObservable();
  }

  sessionClosed(): Observable<void> {
    return this.closed.asObservable();
  }

  get current(): ServerSession | null {
    return this.session;
  }

  open(socket: WebSocket): ServerSession {
    const session = new ServerSession(toSocketPort(socket), this.getSessionOptions());

    this.session = session;

    socket.on('close', () => {
      // A token outlives only the session that minted it, and a replacement has already minted its own.
      if (this.session === session) {
        this.session = null;
        this.relayTokenService.clear();
      }

      session.handleClose();
    });

    return session;
  }

  /** The transport opens a session before any handler binds, and dispatch stops as it closes. */
  active(): ServerSession {
    if (this.session === null) {
      this.logger.error('active(): A frame arrived while this agent holds no session');

      throw new InternalServerErrorException();
    }

    return this.session;
  }

  close(): void {
    this.session?.close(AgentCloseCode.SHUTDOWN, AgentCloseReason.SHUTDOWN);
    this.session = null;
    this.relayTokenService.clear();
  }

  private getSessionOptions(): IServerSessionOptions {
    return {
      nodeKey: this.configService.nodeKey,
      secret: this.configService.nodeSecret,
      agentVersion: this.configService.version,
      relay: { url: this.configService.relayAdvertiseUrl, token: this.relayTokenService.mint() },
      gpuHeadroomBytes: this.configService.gpuHeadroomBytes,
      handshakeTimeoutMs: this.configService.connectTimeoutMs,
      onOpened: () => {
        this.opened.next();
      },
      onClosed: () => {
        this.closed.next();
      },
    };
  }
}
