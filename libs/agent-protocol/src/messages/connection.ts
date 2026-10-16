import { z } from 'zod';

import { protocolVersionSchema } from '../version';
import { MAX_MESSAGE_LENGTH } from './limits';

export enum RejectReason {
  UNSUPPORTED_PROTOCOL_VERSION = 'unsupported-protocol-version',
  UNKNOWN_NODE = 'unknown-node',
  INVALID_CREDENTIALS = 'invalid-credentials',
  NODE_DISABLED = 'node-disabled',
  MALFORMED_MESSAGE = 'malformed-message',
  UNEXPECTED_MESSAGE = 'unexpected-message',
}

export const MIN_RELAY_TOKEN_LENGTH = 32;
export const MAX_RELAY_TOKEN_LENGTH = 256;
export const MAX_NODE_SECRET_LENGTH = 256;
export const MAX_AGENT_VERSION_LENGTH = 64;

export const agentRelaySchema = z.object({
  /** Bounded to the schemes the gateway dials, so a node cannot name one it should not follow. */
  url: z.url({ protocol: /^https?$/ }),
  /** Minted for this connection alone, and the only credential the relay accepts. */
  token: z.string().min(MIN_RELAY_TOKEN_LENGTH).max(MAX_RELAY_TOKEN_LENGTH),
});
export type AgentRelay = z.infer<typeof agentRelaySchema>;

export const agentHelloSchema = z.object({
  nodeKey: z.uuid(),
  secret: z.string().min(1).max(MAX_NODE_SECRET_LENGTH),
  agentVersion: z.string().min(1).max(MAX_AGENT_VERSION_LENGTH),
  /** Every version this agent speaks; the welcome names the one chosen. */
  protocolVersions: z.array(protocolVersionSchema).min(1).max(16),
  relay: agentRelaySchema,

  /** Left free on each of this node's cards by admission. Absent from an agent that predates it. */
  gpuHeadroomBytes: z.number().int().nonnegative().optional(),
});
export type AgentHello = z.infer<typeof agentHelloSchema>;

export const agentHeartbeatSchema = z.object({});
export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>;

export const serverWelcomeSchema = z.object({
  nodeKey: z.uuid(),
  /** The version both sides use from here on. */
  protocolVersion: protocolVersionSchema,
  heartbeatIntervalMs: z.number().int().positive(),
});
export type ServerWelcome = z.infer<typeof serverWelcomeSchema>;

export const serverRejectSchema = z.object({
  reason: z.enum(RejectReason),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});
export type ServerReject = z.infer<typeof serverRejectSchema>;
