import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { Observable, Subject } from 'rxjs';
import { WebSocket } from 'ws';

import { AgentCloseCode, AgentCloseReason, AgentMessageType, AgentRelay } from '@libs/agent-protocol';
import { toSocketPort } from '@libs/runtime';

import { NodeAgentService } from '../node/node-agent.service';
import { NodeStateService } from '../node/node-state.service';
import { ConfigService } from '@/config/config.service';

import { AgentSession, IAgentSessionOptions } from './agent-session';

const UNKNOWN_ADDRESS = 'unknown';

/** Inside the default ten seconds Docker allows a stopping container before it kills it. */
const SHUTDOWN_RECORD_TIMEOUT_MS = 5000;

/** A socket holds one session, and a node holds at most one live socket. */
@Injectable()
export class AgentSessionService {
  private readonly logger = new Logger(AgentSessionService.name);

  private readonly byClient = new Map<WebSocket, AgentSession>();
  private readonly byNode = new Map<number, AgentSession>();

  private readonly opened = new Subject<number>();
  private readonly closed = new Subject<number>();

  private readonly closing = new Set<Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly nodeAgentService: NodeAgentService,
    private readonly nodeStateService: NodeStateService
  ) {}

  sessionOpened(): Observable<number> {
    return this.opened.asObservable();
  }

  sessionClosed(): Observable<number> {
    return this.closed.asObservable();
  }

  get size(): number {
    return this.byNode.size;
  }

  open(client: WebSocket, request: IncomingMessage): AgentSession {
    const remoteAddress = request.socket.remoteAddress ?? UNKNOWN_ADDRESS;

    const session = new AgentSession(
      toSocketPort(client),
      this.nodeAgentService,
      this.nodeStateService,
      this.getSessionOptions(remoteAddress)
    );

    this.byClient.set(client, session);

    // A recorded disconnection needs the close code, which this listener carries.
    client.on('close', (code: number) => {
      this.byClient.delete(client);
      this.settle(session, code);
    });

    return session;
  }

  /** The handshake registers a session before any handler binds, and dispatch stops as it closes. */
  forClient(client: WebSocket): AgentSession {
    const session = this.byClient.get(client);

    if (session === undefined) {
      this.logger.error('forClient(): A frame arrived for a socket holding no session');

      throw new InternalServerErrorException();
    }

    return session;
  }

  readyNodeId(client: WebSocket, type: AgentMessageType): number | null {
    return this.forClient(client).readyNodeId(type);
  }

  get(nodeId: number): AgentSession | undefined {
    return this.byNode.get(nodeId);
  }

  relayFor(nodeId: number): AgentRelay | null {
    return this.byNode.get(nodeId)?.relay ?? null;
  }

  gpuHeadroomFor(nodeId: number): number | null {
    return this.byNode.get(nodeId)?.gpuHeadroomBytes ?? null;
  }

  /** Await it before the data source closes: it resolves once every disconnection is recorded, or at the timeout. */
  async closeAll(): Promise<void> {
    for (const session of this.byNode.values()) {
      session.close(AgentCloseCode.SHUTDOWN, AgentCloseReason.SHUTDOWN);
    }

    for (const client of this.byClient.keys()) {
      client.close(AgentCloseCode.SHUTDOWN, AgentCloseReason.SHUTDOWN);
    }

    // A socket's own close event can arrive after the data source has gone, so each session records its end here.
    for (const session of this.byClient.values()) {
      this.settle(session, AgentCloseCode.SHUTDOWN);
    }

    this.byNode.clear();
    this.byClient.clear();

    let timeout: NodeJS.Timeout | undefined;

    const timedOut = new Promise<false>(resolve => {
      timeout = setTimeout(() => resolve(false), SHUTDOWN_RECORD_TIMEOUT_MS);
    });

    const recorded = await Promise.race([Promise.all(this.closing).then(() => true), timedOut]);

    clearTimeout(timeout);

    if (!recorded) {
      this.logger.warn({ pending: this.closing.size }, 'closeAll(): Shut down before every disconnection was recorded');
    }
  }

  private settle(session: AgentSession, code: number): void {
    const closing = session
      .handleClose(code)
      .finally(() => this.closing.delete(closing))
      .catch((error: unknown) => {
        this.logger.error({ error, nodeId: session.nodeId }, 'settle(): Closing an agent session failed');
      });

    this.closing.add(closing);
  }

  private register(session: AgentSession): void {
    const nodeId = session.nodeId;

    if (nodeId === null) {
      return;
    }

    const existing = this.byNode.get(nodeId);

    if (existing !== undefined && existing !== session) {
      existing.close(AgentCloseCode.SUPERSEDED, AgentCloseReason.SUPERSEDED);
    }

    this.byNode.set(nodeId, session);
    this.opened.next(nodeId);
  }

  private unregister(session: AgentSession): void {
    const nodeId = session.nodeId;

    if (nodeId === null) {
      return;
    }

    // A superseded session closes after its replacement registered.
    if (this.byNode.get(nodeId) === session) {
      this.byNode.delete(nodeId);
      this.nodeStateService.clearObserved(nodeId);
      this.closed.next(nodeId);
    }
  }

  private getSessionOptions(remoteAddress: string): IAgentSessionOptions {
    return {
      remoteAddress,
      heartbeatIntervalMs: this.configService.nodeHeartbeatIntervalMs,
      handshakeTimeoutMs: this.configService.nodeHandshakeTimeoutMs,
      silenceTimeoutMs: this.configService.nodeOfflineThresholdMs,
      onOpened: session => {
        this.register(session);
      },
      onClosed: session => {
        this.unregister(session);
      },
    };
  }
}
