import { z } from 'zod';

export const PID_TITLE = 'PID';

/** dockerode types the `top` response as `any`. */
export const containerTopSchema = z.object({
  Titles: z.array(z.string()).catch([]),
  Processes: z.array(z.array(z.string())).catch([]),
});

/** A pull that fails part way answers 200 and reports it in the progress stream. */
export const pullProgressSchema = z.object({ error: z.string().optional() });

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
