import { Logger } from '@nestjs/common';
import { ClientProxy, ReadPacket } from '@nestjs/microservices';

import { ServerMessageType, ServerPayloadMap } from '@libs/agent-protocol';

import { AgentSessionService } from './agent-session.service';

const NO_REQUEST_RESPONSE_MESSAGE =
  "The agent protocol carries events alone. A request that needs an answer goes over the node's relay.";

const NO_SERVER_MESSAGE = 'AgentClient wraps no server';

type ServerPayload = ServerPayloadMap[ServerMessageType];

function unknownPatternMessage(pattern: unknown): string {
  return `AgentClient was asked to emit '${String(pattern)}', which the server protocol does not name`;
}

/** `pattern` reaches this untyped, since the framework knows nothing of the protocol. */
function isServerMessageType(pattern: unknown): pattern is ServerMessageType {
  return typeof pattern === 'string' && Object.values<string>(ServerMessageType).includes(pattern);
}

export class AgentClient extends ClientProxy {
  private readonly logger = new Logger(AgentClient.name);

  constructor(
    private readonly agentSessionService: AgentSessionService,
    private readonly nodeId: number
  ) {
    super();
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    // The session service owns the socket.
  }

  unwrap(): never {
    throw new Error(NO_SERVER_MESSAGE);
  }

  protected dispatchEvent<TResult>(packet: ReadPacket<ServerPayload>): Promise<TResult>;
  protected dispatchEvent(packet: ReadPacket<ServerPayload>): Promise<void> {
    if (!isServerMessageType(packet.pattern)) {
      throw new Error(unknownPatternMessage(packet.pattern));
    }

    const session = this.agentSessionService.get(this.nodeId);

    if (session === undefined) {
      this.logger.debug(
        { nodeId: this.nodeId, type: packet.pattern },
        'dispatchEvent(): Dropping a message for a node out of contact'
      );

      return Promise.resolve();
    }

    session.send(packet.pattern, packet.data);

    return Promise.resolve();
  }

  protected publish(): never {
    throw new Error(NO_REQUEST_RESPONSE_MESSAGE);
  }
}
