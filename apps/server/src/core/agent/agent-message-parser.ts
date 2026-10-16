import { AgentMessage, decodeAgentMessage } from '@libs/agent-protocol';
import { FrameData, readFrame } from '@libs/runtime';

/** The adapter drops any frame it cannot route, so an unreadable one is routed here. */
export const MALFORMED_MESSAGE_EVENT = 'agent.__malformed';

export interface IRoutedMessage {
  event: string;
  data: AgentMessage | string;
}

/** The adapter routes on `event` and hands the handler `data`. */
export function parseAgentMessage(data: FrameData): IRoutedMessage {
  const decoded = decodeAgentMessage(readFrame(data));

  if (!decoded.ok) {
    return { event: MALFORMED_MESSAGE_EVENT, data: decoded.reason };
  }

  return { event: decoded.message.type, data: decoded.message };
}
