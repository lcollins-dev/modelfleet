import { z } from 'zod';

import { timestamp } from '../../../fields';
import { NodeState } from '../node';
import { NodeTelemetryStatusDto } from './telemetry';

export const FleetNodeTelemetryDto = z.object({
  nodeId: z.number(),
  nodeName: z.string(),
  nodeState: z.enum(NodeState),

  status: NodeTelemetryStatusDto,
});
export type FleetNodeTelemetryDto = z.infer<typeof FleetNodeTelemetryDto>;

/** Every node, ordered by name, including one that has never reported. */
export const FleetTelemetryResponseDto = z.object({
  nodes: z.array(FleetNodeTelemetryDto),

  /** When the server composed this response, so a client can age `receivedAt` without trusting its own clock. */
  readAt: timestamp(),
});
export type FleetTelemetryResponseDto = z.infer<typeof FleetTelemetryResponseDto>;
