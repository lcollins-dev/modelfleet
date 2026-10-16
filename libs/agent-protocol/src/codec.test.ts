import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ProtocolEncodeError,
  decodeAgentMessage,
  decodeServerMessage,
  encodeAgentMessage,
  encodeServerMessage,
} from './codec';
import { AgentMessageType, ServerMessageType } from './message-type';
import { AgentHello, RejectReason } from './messages';
import { PROTOCOL_VERSION } from './version';

const nodeKey = randomUUID();

const RELAY = { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const hello: AgentHello = {
  nodeKey,
  secret: 'mfn_a-secret-an-operator-pasted',
  agentVersion: '1.2.3',
  protocolVersions: [PROTOCOL_VERSION],
  relay: RELAY,
};

describe('encoding', () => {
  it('stamps the envelope the receiver needs to read a message', () => {
    const frame = encodeAgentMessage(AgentMessageType.HELLO, hello);
    const result = decodeAgentMessage(frame);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.message.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.message.type).toBe(AgentMessageType.HELLO);
    expect(result.message.messageId).toHaveLength(36);
    expect(Date.parse(result.message.sentAt)).not.toBeNaN();
  });

  it('refuses a stamp that is not a date', () => {
    expect(() => encodeAgentMessage(AgentMessageType.HEARTBEAT, {}, { sentAt: new Date('nonsense') })).toThrow(
      ProtocolEncodeError
    );
  });

  it('carries the payload through unchanged', () => {
    const result = decodeAgentMessage(encodeAgentMessage(AgentMessageType.HELLO, hello));

    expect(result.ok && result.message.payload).toEqual(hello);
  });

  it('names the message a reply answers', () => {
    const correlationId = randomUUID();
    const frame = encodeServerMessage(
      ServerMessageType.WELCOME,
      { nodeKey, protocolVersion: PROTOCOL_VERSION, heartbeatIntervalMs: 10000 },
      { correlationId }
    );

    const result = decodeServerMessage(frame);

    expect(result.ok && result.message.correlationId).toBe(correlationId);
  });

  it('leaves the correlation out of a message that answers nothing', () => {
    const frame = encodeAgentMessage(AgentMessageType.HEARTBEAT, {});

    expect(JSON.parse(frame)).not.toHaveProperty('correlationId');
  });

  it('refuses a payload that does not match its schema', () => {
    const malformed = { ...hello, nodeKey: 'not-a-uuid' };

    expect(() => encodeAgentMessage(AgentMessageType.HELLO, malformed)).toThrow(ProtocolEncodeError);
  });

  it('names the field it refused', () => {
    const malformed = { ...hello, protocolVersions: [] };

    expect(() => encodeAgentMessage(AgentMessageType.HELLO, malformed)).toThrow(/protocolVersions/);
  });

  it('refuses a relay on a scheme the gateway would not dial', () => {
    const malformed = { ...hello, relay: { ...RELAY, url: 'file:///etc/passwd' } };

    expect(() => encodeAgentMessage(AgentMessageType.HELLO, malformed)).toThrow(/relay.url/);
  });

  it('refuses a relay token too short to be one this agent minted', () => {
    const malformed = { ...hello, relay: { ...RELAY, token: 'short' } };

    expect(() => encodeAgentMessage(AgentMessageType.HELLO, malformed)).toThrow(/relay.token/);
  });
});

describe('decoding', () => {
  it('refuses a frame that is not JSON', () => {
    const result = decodeAgentMessage('{');

    expect(result).toEqual({ ok: false, reason: 'The frame is not valid JSON' });
  });

  it('refuses an empty frame apart from a malformed one', () => {
    expect(decodeAgentMessage('   ')).toEqual({ ok: false, reason: 'The frame is empty' });
  });

  it('states a whole-frame fault without a path in front of it', () => {
    const result = decodeAgentMessage('5');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/^[A-Z]/);
  });

  it('holds a reason inside what a reject message accepts', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      type: AgentMessageType.HELLO,
      sentAt: new Date().toISOString(),
      payload: { nodeKey: 'x'.repeat(400), secret: 5, agentVersion: 7, protocolVersions: 'no' },
    });

    const result = decodeAgentMessage(frame);

    expect(!result.ok && result.reason.length).toBeLessThanOrEqual(512);
  });

  it('takes a stamp carrying an offset rather than a zulu suffix', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      type: AgentMessageType.HEARTBEAT,
      sentAt: '2026-08-22T12:00:00+01:00',
      payload: {},
    });

    expect(decodeAgentMessage(frame).ok).toBe(true);
  });

  it('refuses a message type it does not know', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      type: 'agent.invented',
      sentAt: new Date().toISOString(),
      payload: {},
    });

    expect(decodeAgentMessage(frame).ok).toBe(false);
  });

  it('refuses a message missing a field its type declares', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      type: AgentMessageType.HELLO,
      sentAt: new Date().toISOString(),
      payload: { nodeKey, agentVersion: '1.2.3', protocolVersions: [PROTOCOL_VERSION] },
    });

    const result = decodeAgentMessage(frame);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('secret');
  });

  it('refuses an envelope with no protocol version', () => {
    const frame = JSON.stringify({
      messageId: randomUUID(),
      type: AgentMessageType.HEARTBEAT,
      sentAt: new Date().toISOString(),
      payload: {},
    });

    expect(decodeAgentMessage(frame).ok).toBe(false);
  });

  it('drops a field the schema does not declare', () => {
    const frame = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      type: AgentMessageType.HELLO,
      sentAt: new Date().toISOString(),
      payload: { ...hello, smuggled: 'value' },
    });

    const result = decodeAgentMessage(frame);

    expect(result.ok && result.message.payload).toEqual(hello);
  });
});

describe('direction', () => {
  it('refuses an agent message read as one the server sent', () => {
    const frame = encodeAgentMessage(AgentMessageType.HELLO, hello);

    expect(decodeServerMessage(frame).ok).toBe(false);
  });

  it('refuses a server message read as one an agent sent', () => {
    const frame = encodeServerMessage(ServerMessageType.REJECT, {
      reason: RejectReason.UNKNOWN_NODE,
      message: 'No node holds that identifier',
    });

    expect(decodeAgentMessage(frame).ok).toBe(false);
  });
});
