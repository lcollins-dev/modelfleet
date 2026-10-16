import { Injectable, Logger } from '@nestjs/common';
import { ClientProxy, ReadPacket } from '@nestjs/microservices';

import { AgentMessageType, AgentPayloadMap } from '@libs/agent-protocol';

import { ServerSessionService } from './server-session.service';

const NO_REQUEST_RESPONSE_MESSAGE =
  "The agent protocol carries events alone. A request that needs an answer comes over this node's relay.";

const NO_SERVER_MESSAGE = 'ServerClient wraps no server';

type AgentPayload = AgentPayloadMap[AgentMessageType];

function unknownPatternMessage(pattern: unknown): string {
  return `ServerClient was asked to emit '${String(pattern)}', which the agent protocol does not name`;
}

/** `pattern` reaches this untyped, since the framework knows nothing of the protocol. */
function isAgentMessageType(pattern: unknown): pattern is AgentMessageType {
  return typeof pattern === 'string' && Object.values<string>(AgentMessageType).includes(pattern);
}

@Injectable()
export class ServerClient extends ClientProxy {
  private readonly logger = new Logger(ServerClient.name);

  constructor(private readonly serverSessionService: ServerSessionService) {
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

  protected dispatchEvent<TResult>(packet: ReadPacket<AgentPayload>): Promise<TResult>;
  protected dispatchEvent(packet: ReadPacket<AgentPayload>): Promise<void> {
    if (!isAgentMessageType(packet.pattern)) {
      throw new Error(unknownPatternMessage(packet.pattern));
    }

    const session = this.serverSessionService.current;

    if (session === null) {
      this.logger.debug(
        { type: packet.pattern },
        'dispatchEvent(): Dropping a message sent while this agent has no connection'
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
