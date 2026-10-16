import { z } from 'zod';

/** A `statusCode` means the daemon answered and said no; an errno means nothing answered it. */
export enum DockerFault {
  UNREACHABLE = 'unreachable',
  REFUSED = 'refused',
}

export interface IDockerFault {
  fault: DockerFault;
  message: string;

  /** Absent where nothing answered. */
  status?: number;
}

/** Nothing answered, so what the node holds is unknown and no instance may be acted on. */
export class DockerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerUnavailableError';
  }
}

const UNREACHABLE_CODES = ['ENOENT', 'EACCES', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'ETIMEDOUT'];

const UNREACHABLE_MESSAGE = 'The Docker daemon could not be reached';
const UNKNOWN_MESSAGE = 'The Docker daemon refused the request';

const dockerErrorSchema = z.object({
  statusCode: z.number().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  reason: z.string().optional(),
});

export function describeDockerError(error: unknown): IDockerFault {
  const parsed = dockerErrorSchema.safeParse(error);
  const detail = parsed.success ? parsed.data : {};

  if (detail.statusCode !== undefined) {
    return {
      fault: DockerFault.REFUSED,
      message: detail.message ?? detail.reason ?? UNKNOWN_MESSAGE,
      status: detail.statusCode,
    };
  }

  if (detail.code !== undefined && UNREACHABLE_CODES.includes(detail.code)) {
    return { fault: DockerFault.UNREACHABLE, message: `${UNREACHABLE_MESSAGE} (${detail.code})` };
  }

  return { fault: DockerFault.REFUSED, message: detail.message ?? UNKNOWN_MESSAGE };
}
