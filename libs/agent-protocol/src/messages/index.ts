import { z } from 'zod';

import { envelopeSchema } from '../envelope';
import { AgentMessageType, ServerMessageType } from '../message-type';
import { agentHeartbeatSchema, agentHelloSchema, serverRejectSchema, serverWelcomeSchema } from './connection';
import { agentDownloadProgressSchema, serverDesiredDownloadsSchema } from './download';
import { agentModelInventorySchema, serverScanModelsSchema } from './model';
import { agentObservedStateSchema, serverDesiredStateSchema } from './state';
import { agentGpuInventorySchema, agentTelemetrySchema } from './telemetry';

export * from './connection';
export * from './download';
export * from './limits';
export * from './model';
export * from './state';
export * from './telemetry';

export const agentMessageSchema = z.discriminatedUnion('type', [
  envelopeSchema(AgentMessageType.HELLO, agentHelloSchema),
  envelopeSchema(AgentMessageType.HEARTBEAT, agentHeartbeatSchema),
  envelopeSchema(AgentMessageType.OBSERVED_STATE, agentObservedStateSchema),
  envelopeSchema(AgentMessageType.GPU_INVENTORY, agentGpuInventorySchema),
  envelopeSchema(AgentMessageType.TELEMETRY, agentTelemetrySchema),
  envelopeSchema(AgentMessageType.MODEL_INVENTORY, agentModelInventorySchema),
  envelopeSchema(AgentMessageType.DOWNLOAD_PROGRESS, agentDownloadProgressSchema),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  envelopeSchema(ServerMessageType.WELCOME, serverWelcomeSchema),
  envelopeSchema(ServerMessageType.REJECT, serverRejectSchema),
  envelopeSchema(ServerMessageType.DESIRED_STATE, serverDesiredStateSchema),
  envelopeSchema(ServerMessageType.SCAN_MODELS, serverScanModelsSchema),
  envelopeSchema(ServerMessageType.DESIRED_DOWNLOADS, serverDesiredDownloadsSchema),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

type PayloadMap<TMessage extends { type: string; payload: unknown }> = {
  [TBranch in TMessage as TBranch['type']]: TBranch['payload'];
};

export type AgentPayloadMap = PayloadMap<AgentMessage>;
export type ServerPayloadMap = PayloadMap<ServerMessage>;

/** The one branch of a direction's union that carries `TType`, for a handler bound to it. */
export type AgentMessageOf<TType extends AgentMessageType> = Extract<AgentMessage, { type: TType }>;
export type ServerMessageOf<TType extends ServerMessageType> = Extract<ServerMessage, { type: TType }>;
