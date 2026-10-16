import { Logger } from '@nestjs/common';

import {
  AgentCloseCode,
  AgentCloseReason,
  AgentHello,
  AgentMessageType,
  AgentObservedState,
  AgentRelay,
  RejectReason,
  ServerPayloadMap,
  ServerMessageType,
  encodeServerMessage,
} from '@libs/agent-protocol';
import { Deadline, ISocketPort } from '@libs/runtime';

import { Node } from '../node/entities/node.entity';

import { NODE_DISABLED_MESSAGE, NodeAgentService } from '../node/node-agent.service';
import { NodeStateService } from '../node/node-state.service';

const HANDSHAKE_TIMEOUT_MESSAGE = 'The agent did not identify itself before the connection timed out';
const SECOND_HELLO_MESSAGE = 'This connection has already completed its handshake';
const NODE_DELETED_MESSAGE = 'This node no longer exists';

enum SessionState {
  AWAITING_HELLO = 'awaiting-hello',
  AUTHENTICATING = 'authenticating',
  READY = 'ready',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

export interface IAgentSessionOptions {
  remoteAddress: string;
  heartbeatIntervalMs: number;
  handshakeTimeoutMs: number;
  /** Silence for this long ends the connection, matching the span that turns a node offline. */
  silenceTimeoutMs: number;
  onOpened: (session: AgentSession) => void;
  onClosed: (session: AgentSession) => void;
}

export class AgentSession {
  private readonly logger = new Logger(AgentSession.name);

  private state = SessionState.AWAITING_HELLO;
  private node: Node | null = null;
  private relayTarget: AgentRelay | null = null;
  private reportedGpuHeadroomBytes: number | null = null;

  private protocolVersion: number | null = null;

  private readonly deadline = new Deadline();

  /** The handshake's write in flight, which a close waits on so a connection is never recorded after its end. */
  private handshakeWrite: Promise<unknown> = Promise.resolve();

  /** The code this side closed with, which the disconnection records over whatever the socket reports later. */
  private closeCode: number | null = null;

  constructor(
    private readonly socket: ISocketPort,
    private readonly nodeAgentService: NodeAgentService,
    private readonly nodeStateService: NodeStateService,
    private readonly options: IAgentSessionOptions
  ) {
    this.expectHello();
  }

  get nodeId(): number | null {
    return this.node?.id ?? null;
  }

  get isReady(): boolean {
    return this.state === SessionState.READY;
  }

  get relay(): AgentRelay | null {
    return this.relayTarget;
  }

  get gpuHeadroomBytes(): number | null {
    return this.reportedGpuHeadroomBytes;
  }

  /** A node is recorded against a session only by a successful handshake, and stays. */
  get wasWelcomed(): boolean {
    return this.node !== null;
  }

  async handleHello(hello: AgentHello, correlationId: string): Promise<void> {
    if (this.isSettled()) {
      return;
    }

    if (this.state !== SessionState.AWAITING_HELLO) {
      this.refuse(RejectReason.UNEXPECTED_MESSAGE, SECOND_HELLO_MESSAGE, correlationId);

      return;
    }

    this.state = SessionState.AUTHENTICATING;
    this.deadline.stop();

    const authenticating = this.nodeAgentService.authenticate(hello, this.options.remoteAddress);
    this.handshakeWrite = authenticating;

    const result = await authenticating;

    if (this.isSettled()) {
      return;
    }

    if (!result.ok) {
      this.refuse(result.reason, result.message, correlationId);

      return;
    }

    this.node = result.node;
    this.protocolVersion = result.protocolVersion;
    this.relayTarget = hello.relay;
    this.reportedGpuHeadroomBytes = hello.gpuHeadroomBytes ?? null;
    this.state = SessionState.READY;

    this.options.onOpened(this);

    this.socket.send(
      encodeServerMessage(
        ServerMessageType.WELCOME,
        {
          nodeKey: result.node.nodeKey,
          protocolVersion: result.protocolVersion,
          heartbeatIntervalMs: this.options.heartbeatIntervalMs,
        },
        { protocolVersion: result.protocolVersion, correlationId }
      )
    );

    const connecting = this.nodeAgentService.recordConnected(
      result.node,
      hello,
      result.protocolVersion,
      this.options.remoteAddress
    );
    this.handshakeWrite = connecting;

    await connecting;

    if (this.isSettled()) {
      return;
    }

    this.send(ServerMessageType.DESIRED_STATE, this.nodeStateService.getDesiredState(result.node.id));

    this.expectHeartbeat();
  }

  async handleHeartbeat(): Promise<void> {
    const nodeId = this.readyNodeId(AgentMessageType.HEARTBEAT);

    if (nodeId === null) {
      return;
    }

    const live = await this.nodeAgentService.findLiveNode(nodeId);

    if (live === null) {
      this.refuse(RejectReason.UNKNOWN_NODE, NODE_DELETED_MESSAGE);

      return;
    }

    if (!live.enabled) {
      this.refuse(RejectReason.NODE_DISABLED, NODE_DISABLED_MESSAGE);

      return;
    }

    this.expectHeartbeat();

    await this.nodeAgentService.markSeen(nodeId);
  }

  handleObservedState(report: AgentObservedState): void {
    const nodeId = this.readyNodeId(AgentMessageType.OBSERVED_STATE);

    if (nodeId === null) {
      return;
    }

    this.nodeStateService.replaceObserved(nodeId, report);
  }

  send<TType extends ServerMessageType>(type: TType, payload: ServerPayloadMap[TType]): void {
    if (this.isSettled() || this.protocolVersion === null) {
      return;
    }

    this.socket.send(encodeServerMessage(type, payload, { protocolVersion: this.protocolVersion }));
  }

  handleMalformed(reason: string): void {
    if (this.isSettled()) {
      return;
    }

    this.refuse(RejectReason.MALFORMED_MESSAGE, reason);
  }

  async handleClose(code: number): Promise<void> {
    if (this.state === SessionState.CLOSED) {
      return;
    }

    const node = this.node;

    this.state = SessionState.CLOSED;
    this.relayTarget = null;
    this.reportedGpuHeadroomBytes = null;
    this.deadline.stop();

    this.options.onClosed(this);

    // A failed handshake write has already reached the hello's caller.
    await this.handshakeWrite.catch(() => undefined);

    if (node !== null) {
      await this.nodeAgentService.recordDisconnected(node, this.closeCode ?? code);
    }
  }

  close(code: AgentCloseCode, reason: string): void {
    this.closeCode ??= code;
    this.state = SessionState.CLOSING;
    this.deadline.stop();

    this.socket.close(code, reason);
  }

  readyNodeId(type: AgentMessageType): number | null {
    if (this.isSettled()) {
      return null;
    }

    if (this.state !== SessionState.READY || this.node === null) {
      this.refuse(RejectReason.UNEXPECTED_MESSAGE, `A ${type} message arrived before the handshake`);

      return null;
    }

    return this.node.id;
  }

  private isSettled(): boolean {
    return this.state === SessionState.CLOSING || this.state === SessionState.CLOSED;
  }

  private expectHello(): void {
    this.deadline.expect(this.options.handshakeTimeoutMs, () => {
      this.refuse(RejectReason.UNEXPECTED_MESSAGE, HANDSHAKE_TIMEOUT_MESSAGE);
    });
  }

  private expectHeartbeat(): void {
    this.deadline.expect(this.options.silenceTimeoutMs, () => {
      this.close(AgentCloseCode.HEARTBEAT_TIMEOUT, AgentCloseReason.HEARTBEAT_TIMEOUT);
    });
  }

  private refuse(reason: RejectReason, message: string, correlationId?: string): void {
    this.logger.warn(
      { reason, nodeId: this.node?.id, remoteAddress: this.options.remoteAddress },
      `refuse(): Refusing an agent connection: ${message}`
    );

    this.socket.send(encodeServerMessage(ServerMessageType.REJECT, { reason, message }, { correlationId }));
    this.close(AgentCloseCode.REJECTED, reason);
  }
}
