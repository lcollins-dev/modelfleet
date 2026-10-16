import { GIB } from '@libs/backends';

export function launchTimeoutMs(sizeBytes: number, baseMs: number, perGibMs: number): number {
  return Math.round(baseMs + (Math.max(sizeBytes, 0) / GIB) * perGibMs);
}
