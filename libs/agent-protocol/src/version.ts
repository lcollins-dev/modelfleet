import { z } from 'zod';

export const PROTOCOL_VERSION = 3;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

export const protocolVersionSchema = z.number().int().positive();

export function isSupportedProtocolVersion(version: number): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

export function negotiateProtocolVersion(offered: readonly number[]): number | null {
  const shared = SUPPORTED_PROTOCOL_VERSIONS.filter(version => offered.includes(version));

  return shared.length > 0 ? Math.max(...shared) : null;
}
