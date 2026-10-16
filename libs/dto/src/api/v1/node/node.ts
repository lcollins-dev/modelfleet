import { z } from 'zod';

import { text, timestamp } from '../../../fields';

const NODE_NAME_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

export enum NodeState {
  REGISTERED = 'registered',
  ONLINE = 'online',
  OFFLINE = 'offline',
  DISABLED = 'disabled',
}

export const ListNodeDto = z.object({
  id: z.number(),
  name: z.string(),
  state: z.enum(NodeState),
  enabled: z.boolean(),
  lastSeenDate: timestamp().nullable(),
  agentVersion: z.string().nullable(),
});
export type ListNodeDto = z.infer<typeof ListNodeDto>;

export const NodeDto = ListNodeDto.extend({
  nodeKey: z.string(),
  description: z.string().nullable(),
  createdDate: timestamp(),
});
export type NodeDto = z.infer<typeof NodeDto>;

export const nodeName = () =>
  text(2, 128, { trim: true }).regex(NODE_NAME_PATTERN, {
    error: 'Use only lowercase letters, numbers, hyphens and dots, with no spaces.',
  });
