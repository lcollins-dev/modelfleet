import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { AgentMessageType, ServerMessageType } from './message-type';
import {
  AgentMessage,
  AgentPayloadMap,
  ServerMessage,
  MAX_MESSAGE_LENGTH,
  ServerPayloadMap,
  agentMessageSchema,
  serverMessageSchema,
} from './messages';
import { PROTOCOL_VERSION } from './version';

export interface IDecodeSuccess<TMessage> {
  ok: true;
  message: TMessage;
}

export interface IDecodeFailure {
  ok: false;
  reason: string;
}

export type DecodeResult<TMessage> = IDecodeSuccess<TMessage> | IDecodeFailure;

export interface IEncodeOptions {
  protocolVersion?: number;
  /** Names the message this one answers. */
  correlationId?: string;
  messageId?: string;
  sentAt?: Date;
}

export class ProtocolEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolEncodeError';
  }
}

/** Surfaces `issue.message` and `issue.path` alone, so a value from the frame stays out of the reason. */
function formatIssues(error: z.ZodError): string {
  const reason = error.issues
    .map(issue => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');

  // Held inside what `serverRejectSchema` accepts, so one can be answered with the other.
  if (reason.length > MAX_MESSAGE_LENGTH) {
    return `${reason.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
  }

  return reason;
}

function encode(schema: z.ZodType, type: string, payload: unknown, options: IEncodeOptions): string {
  const sentAt = options.sentAt ?? new Date();

  if (Number.isNaN(sentAt.getTime())) {
    throw new ProtocolEncodeError(`Cannot encode ${type}: sentAt is not a date`);
  }

  const envelope = {
    protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
    messageId: options.messageId ?? randomUUID(),
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    type,
    sentAt: sentAt.toISOString(),
    payload,
  };

  const result = schema.safeParse(envelope);

  if (!result.success) {
    throw new ProtocolEncodeError(`Cannot encode ${type}: ${formatIssues(result.error)}`);
  }

  return JSON.stringify(result.data);
}

function decode<TMessage>(schema: z.ZodType<TMessage>, frame: string): DecodeResult<TMessage> {
  if (frame.trim().length === 0) {
    return { ok: false, reason: 'The frame is empty' };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(frame);
  } catch {
    return { ok: false, reason: 'The frame is not valid JSON' };
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    return { ok: false, reason: formatIssues(result.error) };
  }

  return { ok: true, message: result.data };
}

export function encodeAgentMessage<TType extends AgentMessageType>(
  type: TType,
  payload: AgentPayloadMap[TType],
  options: IEncodeOptions = {}
): string {
  return encode(agentMessageSchema, type, payload, options);
}

export function encodeServerMessage<TType extends ServerMessageType>(
  type: TType,
  payload: ServerPayloadMap[TType],
  options: IEncodeOptions = {}
): string {
  return encode(serverMessageSchema, type, payload, options);
}

/** Reads a frame an agent sent. */
export function decodeAgentMessage(frame: string): DecodeResult<AgentMessage> {
  return decode(agentMessageSchema, frame);
}

/** Reads a frame the server sent. */
export function decodeServerMessage(frame: string): DecodeResult<ServerMessage> {
  return decode(serverMessageSchema, frame);
}
