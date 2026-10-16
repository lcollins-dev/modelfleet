import { z } from 'zod';

export const InstanceKeyParamDto = z.uuid({ error: 'Enter a valid instance key.' });
export type InstanceKeyParamDto = z.infer<typeof InstanceKeyParamDto>;

export const InstanceOutputLineDto = z.object({
  /** ISO, to the millisecond. Null where the line carried no timestamp that parsed. */
  date: z.string().nullable(),

  text: z.string(),

  /** `text` holds the start of a longer line. */
  cut: z.boolean(),
});
export type InstanceOutputLineDto = z.infer<typeof InstanceOutputLineDto>;

export const InstanceOutputOpenedFrameDto = z.object({
  kind: z.literal('opened'),

  tailLines: z.number(),

  /** The tail reaches back to the container's start. */
  complete: z.boolean(),
});
export type InstanceOutputOpenedFrameDto = z.infer<typeof InstanceOutputOpenedFrameDto>;

export const InstanceOutputLinesFrameDto = z.object({
  kind: z.literal('lines'),

  lines: z.array(InstanceOutputLineDto),
});
export type InstanceOutputLinesFrameDto = z.infer<typeof InstanceOutputLinesFrameDto>;

export enum InstanceOutputEndReason {
  EXITED = 'exited',

  /** The connection to the node failed mid-stream. */
  LOST = 'lost',
}

/** The stream completes after it, so the client stops rather than reconnecting. */
export const InstanceOutputEndedFrameDto = z.object({
  kind: z.literal('ended'),

  reason: z.enum(InstanceOutputEndReason),
});
export type InstanceOutputEndedFrameDto = z.infer<typeof InstanceOutputEndedFrameDto>;

export const InstanceOutputFrameDto = z.discriminatedUnion('kind', [
  InstanceOutputOpenedFrameDto,
  InstanceOutputLinesFrameDto,
  InstanceOutputEndedFrameDto,
]);
export type InstanceOutputFrameDto = z.infer<typeof InstanceOutputFrameDto>;
