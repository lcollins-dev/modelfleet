import { z } from 'zod';

export const PID_TITLE = 'PID';

/** dockerode types the `top` response as `any`. */
export const containerTopSchema = z.object({
  Titles: z.array(z.string()).catch([]),
  Processes: z.array(z.array(z.string())).catch([]),
});

/**
 * One line of a pull's progress stream. A pull that fails part way answers 200 and reports it here. `id` names the
 * layer a line is about, and is absent from the lines about the image as a whole. The progress fields fall back to
 * absent, so a line the agent half reads still carries its error.
 */
export const pullProgressSchema = z.object({
  id: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  progressDetail: z.object({ current: z.number().optional() }).optional().catch(undefined),
  error: z.string().optional(),
});

export type PullProgress = z.infer<typeof pullProgressSchema>;

export const containerInspectSchema = z.object({
  Id: z.string(),
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullable().catch(null) }),
  State: z.object({
    Running: z.boolean(),
    ExitCode: z.number(),
    StartedAt: z.string(),
  }),
  NetworkSettings: z.object({
    Networks: z.record(z.string(), z.object({ IPAddress: z.string().nullish() })).catch({}),
  }),
});
export type ContainerInspect = z.infer<typeof containerInspectSchema>;
