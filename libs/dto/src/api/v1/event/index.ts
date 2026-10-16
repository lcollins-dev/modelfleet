import { z } from 'zod';

import { dateText, enumValue, requestBody, selection, text, timestamp } from '../../../fields';
import { ExpectedUsageSource, InstanceChangeReason } from '../instance';

export enum EventType {
  USER_SIGNED_IN = 'user.signed-in',
  USER_SIGN_IN_FAILED = 'user.sign-in-failed',
  NODE_REGISTERED = 'node.registered',
  NODE_RENAMED = 'node.renamed',
  NODE_ENABLED = 'node.enabled',
  NODE_DISABLED = 'node.disabled',
  NODE_DELETED = 'node.deleted',
  NODE_CONNECTED = 'node.connected',
  NODE_DISCONNECTED = 'node.disconnected',
  NODE_CONNECTION_REFUSED = 'node.connection-refused',
  MODEL_DISCOVERED = 'model.discovered',
  MODEL_AVAILABILITY_REMOVED = 'model.availability-removed',
  MODEL_RENAMED = 'model.renamed',
  MODEL_TASKS_CHANGED = 'model.tasks-changed',
  MODEL_DELETED = 'model.deleted',
  PRESET_CREATED = 'preset.created',
  PRESET_UPDATED = 'preset.updated',
  PRESET_DELETED = 'preset.deleted',
  DEPLOYMENT_CREATED = 'deployment.created',
  DEPLOYMENT_UPDATED = 'deployment.updated',
  DEPLOYMENT_APPLIED = 'deployment.applied',
  DEPLOYMENT_ENABLED = 'deployment.enabled',
  DEPLOYMENT_DISABLED = 'deployment.disabled',
  DEPLOYMENT_DELETED = 'deployment.deleted',
  DEPLOYMENT_GIVEN_UP = 'deployment.given-up',
  INSTANCE_STARTED = 'instance.started',
  INSTANCE_STOPPED = 'instance.stopped',
  INSTANCE_START_REFUSED = 'instance.start-refused',
  INSTANCE_OUTPUT_READ = 'instance.output-read',
  API_KEY_CREATED = 'api-key.created',
  API_KEY_REVOKED = 'api-key.revoked',
  DOWNLOAD_REQUESTED = 'download.requested',
  DOWNLOAD_SUCCEEDED = 'download.succeeded',
  DOWNLOAD_FAILED = 'download.failed',
  DOWNLOAD_STOPPED = 'download.stopped',
  DOWNLOAD_RETRIED = 'download.retried',
  DOWNLOAD_DISMISSED = 'download.dismissed',
}

export enum EventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
}

export enum EventPartyType {
  USER = 'user',
  NODE = 'node',
  MODEL = 'model',
  PRESET = 'preset',
  DEPLOYMENT = 'deployment',
  API_KEY = 'api-key',
  DOWNLOAD = 'download',
}

export const eventDetail = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type EventDetail = z.infer<typeof eventDetail>;

/** A type recording nothing beyond its subject maps to an empty shape, and its producer passes `{}`. */
export type EventDetailMap = {
  [EventType.USER_SIGNED_IN]: { email: string };
  [EventType.USER_SIGN_IN_FAILED]: { email: string };
  [EventType.NODE_REGISTERED]: { name: string };
  [EventType.NODE_RENAMED]: { name: string; previousName: string };
  [EventType.NODE_ENABLED]: { name: string };
  [EventType.NODE_DISABLED]: { name: string };
  [EventType.NODE_DELETED]: { name: string };
  [EventType.NODE_CONNECTED]: { name: string; agentVersion: string; protocolVersion: number; remoteAddress: string };
  [EventType.NODE_DISCONNECTED]: { name: string; closeCode: number };
  [EventType.NODE_CONNECTION_REFUSED]: { reason: string; nodeKey: string; remoteAddress: string };
  [EventType.MODEL_DISCOVERED]: {
    name: string;
    fingerprint: string;
    format: string;
    type: string;
    sizeBytes: number;
    path: string;
  };
  [EventType.MODEL_AVAILABILITY_REMOVED]: { name: string; fingerprint: string; path: string };
  [EventType.MODEL_RENAMED]: { name: string; previousName: string; fingerprint: string };

  /** Each a comma-separated list of task values, empty where the tasks are unknown. */
  [EventType.MODEL_TASKS_CHANGED]: {
    name: string;
    fingerprint: string;
    tasks: string;
    previousTasks: string;
    assigned: boolean;
  };
  [EventType.MODEL_DELETED]: { name: string; fingerprint: string };
  [EventType.PRESET_CREATED]: { name: string; backend: string };
  [EventType.PRESET_UPDATED]: { name: string; previousName: string };
  [EventType.PRESET_DELETED]: { name: string; backend: string };
  [EventType.DEPLOYMENT_CREATED]: { name: string; backend: string; modelName: string; presetName: string };
  [EventType.DEPLOYMENT_UPDATED]: { name: string; previousName: string };
  [EventType.DEPLOYMENT_APPLIED]: { name: string; revision: string };
  [EventType.DEPLOYMENT_ENABLED]: { name: string };
  [EventType.DEPLOYMENT_DISABLED]: { name: string };
  [EventType.DEPLOYMENT_DELETED]: { name: string; modelName: string };
  [EventType.DEPLOYMENT_GIVEN_UP]: { name: string; launchFailures: number; output?: string };
  [EventType.INSTANCE_STARTED]: {
    name: string;
    instanceKey: string;
    nodeName: string;
    devices: string;
    reason: InstanceChangeReason;
    expectedBytes?: number;
    sizedBy?: ExpectedUsageSource;
  };
  [EventType.INSTANCE_STOPPED]: {
    name: string;
    instanceKey: string;
    nodeName: string;
    reason: InstanceChangeReason;
    output?: string;
  };
  [EventType.INSTANCE_START_REFUSED]: {
    name: string;
    problem: string;

    /** Present only where the ledger refused a node. */
    nodeName?: string;
    expectedBytes?: number;
    availableBytes?: number;
    cards?: string;
  };
  [EventType.INSTANCE_OUTPUT_READ]: { name: string; instanceKey: string; nodeId: number; nodeName: string };
  [EventType.API_KEY_CREATED]: { name: string; keyId: string; ownerName: string };
  [EventType.API_KEY_REVOKED]: { name: string; keyId: string; ownerName: string };
  [EventType.DOWNLOAD_REQUESTED]: { repository: string; revision: string; files: number; nodes: string };
  [EventType.DOWNLOAD_SUCCEEDED]: { repository: string; nodeName: string };
  [EventType.DOWNLOAD_FAILED]: { repository: string; nodeName: string; problem: string };
  [EventType.DOWNLOAD_STOPPED]: { repository: string; nodes: string };
  [EventType.DOWNLOAD_RETRIED]: { repository: string; nodes: string };
  [EventType.DOWNLOAD_DISMISSED]: { repository: string };
};

export const EventDto = z.object({
  id: z.number(),
  type: z.enum(EventType),
  severity: z.enum(EventSeverity),
  /** Absent where the system acted on its own. */
  actorType: z.enum(EventPartyType).optional(),
  actorId: z.string().optional(),
  /** Resolved when the event is read, so it is absent once that party is gone. */
  actorName: z.string().optional(),
  subjectType: z.enum(EventPartyType).optional(),
  /** Held as text, so a key of any shape fits. */
  subjectId: z.string().optional(),
  /** Resolved when the event is read, so it is absent once that party is gone. */
  subjectName: z.string().optional(),
  /** One line saying what happened, carrying `**bold**`, `*italic*` and `` `code` `` and no other markup. */
  message: z.string().optional(),
  detail: eventDetail,
  createdDate: timestamp(),
});
export type EventDto = z.infer<typeof EventDto>;

export const EventFilterRequestDto = requestBody({
  type: selection(enumValue(EventType), 0, 32).optional(),
  severity: selection(enumValue(EventSeverity), 0, 8).optional(),
  actorType: enumValue(EventPartyType).optional(),
  actorId: text(1, 128).optional(),
  subjectType: enumValue(EventPartyType).optional(),
  subjectId: text(1, 128).optional(),
  /** Inclusive. */
  fromDate: dateText().optional(),
  /** Inclusive. */
  toDate: dateText().optional(),
});
export type EventFilterRequestDto = z.infer<typeof EventFilterRequestDto>;

export const EventListResponseDto = z.object({
  eventList: z.array(EventDto),
  pages: z.number(),
});
export type EventListResponseDto = z.infer<typeof EventListResponseDto>;
