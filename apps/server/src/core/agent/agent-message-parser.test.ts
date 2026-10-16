import { describe, expect, it } from 'vitest';

import { AgentMessageType, PROTOCOL_VERSION, encodeAgentMessage } from '@libs/agent-protocol';

import { MALFORMED_MESSAGE_EVENT, parseAgentMessage } from '@/core/agent/agent-message-parser';

const NODE_KEY = '11111111-1111-4111-8111-111111111111';

const RELAY = { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const helloFrame = () =>
  encodeAgentMessage(AgentMessageType.HELLO, {
    nodeKey: NODE_KEY,
    secret: 'mfn_secret',
    agentVersion: '1.2.3',
    protocolVersions: [PROTOCOL_VERSION],
    relay: RELAY,
  });

describe('parseAgentMessage', () => {
  it('routes a message on the type its envelope names', () => {
    const routed = parseAgentMessage(helloFrame());

    expect(routed.event).toBe(AgentMessageType.HELLO);
  });

  it('hands the handler the whole message, so a reply can name what it answers', () => {
    const routed = parseAgentMessage(helloFrame());

    expect(routed.data).toMatchObject({ type: AgentMessageType.HELLO, payload: { nodeKey: NODE_KEY } });
    expect(routed.data).toHaveProperty('messageId');
  });

  it('reads a frame buffered as bytes', () => {
    expect(parseAgentMessage(Buffer.from(helloFrame(), 'utf8')).event).toBe(AgentMessageType.HELLO);
  });

  it('routes a frame that is not JSON, rather than dropping it', () => {
    const routed = parseAgentMessage('{ not json');

    expect(routed.event).toBe(MALFORMED_MESSAGE_EVENT);
    expect(routed.data).toBe('The frame is not valid JSON');
  });

  it('routes a message type this build does not know, which is what a newer agent sends', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: NODE_KEY,
      type: 'agent.from-a-later-release',
      sentAt: new Date().toISOString(),
      payload: {},
    });

    const routed = parseAgentMessage(frame);

    expect(routed.event).toBe(MALFORMED_MESSAGE_EVENT);
    expect(routed.data).toContain('Invalid discriminator value');
  });

  it('routes a message whose payload does not match its type', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: NODE_KEY,
      type: AgentMessageType.HELLO,
      sentAt: new Date().toISOString(),
      payload: { nodeKey: 'not-a-uuid' },
    });

    expect(parseAgentMessage(frame).event).toBe(MALFORMED_MESSAGE_EVENT);
  });
});
