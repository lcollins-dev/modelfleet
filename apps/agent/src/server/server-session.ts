import { Logger } from '@nestjs/common';

import {
  AgentCloseCode,
  AgentCloseReason,
  AgentMessageType,
  AgentPayloadMap,
  AgentRelay,
  SUPPORTED_PROTOCOL_VERSIONS,
  RejectReason,
  ServerReject,
  ServerWelcome,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import { Deadline, ISocketPort } from '@libs/runtime';

const MALFORMED_MESSAGE_PREFIX = 'The server sent a frame this agent cannot read';

enum SessionState {
  AWAITING_WELCOME = 'awaiting-welcome',
  READY = 'ready',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

export interface IServerSessionOptions {
  nodeKey: string;
  secret: string;
  agentVersion: string;
  relay: AgentRelay;
  gpuHeadroomBytes: number;
  handshakeTimeoutMs: number;
  onOpened: (session: ServerSession) => void;
  onClosed: (session: ServerSession) => void;
}

export class ServerSession {
  private readonly logger = new Logger(ServerSession.name);

  private state = SessionState.AWAITING_WELCOME;

  private protocolVersion: number | null = null;

  private readonly deadline = new Deadline();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly socket: ISocketPort,
    private readonly options: IServerSessionOptions
  ) {}

  get isReady(): boolean {
    return this.state === SessionState.READY;
  }

  /** A version is recorded against a session only by a successful handshake, and stays. */
  get wasWelcomed(): boolean {
    return this.protocolVersion !== null;
  }

  start(): void {
    this.socket.send(
      encodeAgentMessage(AgentMessageType.HELLO, {
        nodeKey: this.options.nodeKey,
        secret: this.options.secret,
        agentVersion: this.options.agentVersion,
        protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        relay: this.options.relay,
        gpuHeadroomBytes: this.options.gpuHeadroomBytes,
      })
    );

    this.expectWelcome();
  }

  handleWelcome(welcome: ServerWelcome): void {
    if (this.isSettled()) {
      return;
    }

    if (this.state !== SessionState.AWAITING_WELCOME) {
      this.logger.error('handleWelcome(): The server welcomed this connection twice');
      this.close(AgentCloseCode.REJECTED, RejectReason.UNEXPECTED_MESSAGE);

      return;
    }

    this.protocolVersion = welcome.protocolVersion;
    this.state = SessionState.READY;
    this.deadline.stop();

    this.logger.log(
      { protocolVersion: welcome.protocolVersion, heartbeatIntervalMs: welcome.heartbeatIntervalMs },
      'handleWelcome(): The server welcomed this node'
    );

    this.startHeartbeat(welcome.heartbeatIntervalMs);

    this.options.onOpened(this);
  }

  handleReject(reject: ServerReject): void {
    if (this.isSettled()) {
      return;
    }

    this.logger.error({ reason: reject.reason }, `handleReject(): The server refused this node: ${reject.message}`);

    this.close(AgentCloseCode.REJECTED, reject.reason);
  }

  handleMalformed(reason: string): void {
    if (this.isSettled()) {
      return;
    }

    this.logger.error(`handleMalformed(): ${MALFORMED_MESSAGE_PREFIX}: ${reason}`);

    this.close(AgentCloseCode.REJECTED, RejectReason.MALFORMED_MESSAGE);
  }

  send<TType extends AgentMessageType>(type: TType, payload: AgentPayloadMap[TType]): void {
    if (this.isSettled() || this.protocolVersion === null) {
      return;
    }

    this.socket.send(encodeAgentMessage(type, payload, { protocolVersion: this.protocolVersion }));
  }

  handleClose(): void {
    if (this.state === SessionState.CLOSED) {
      return;
    }

    const wasWelcomed = this.wasWelcomed;

    this.state = SessionState.CLOSED;
    this.deadline.stop();
    this.stopHeartbeat();

    if (wasWelcomed) {
      this.options.onClosed(this);
    }
  }

  close(code: AgentCloseCode, reason: string): void {
    this.state = SessionState.CLOSING;
    this.deadline.stop();
    this.stopHeartbeat();

    this.socket.close(code, reason);
  }

  private isSettled(): boolean {
    return this.state === SessionState.CLOSING || this.state === SessionState.CLOSED;
  }

  private expectWelcome(): void {
    this.deadline.expect(this.options.handshakeTimeoutMs, () => {
      this.logger.warn('expectWelcome(): The server sent no welcome within the handshake window');
      this.close(AgentCloseCode.HEARTBEAT_TIMEOUT, AgentCloseReason.HANDSHAKE_TIMEOUT);
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.heartbeat = setInterval(() => {
      this.send(AgentMessageType.HEARTBEAT, {});
    }, intervalMs);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
