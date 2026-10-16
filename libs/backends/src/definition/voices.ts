import { z } from 'zod';

import { readJsonPath } from './json-path';

export const VoiceListing = z.strictObject({
  /** Answered to a GET. */
  path: z.string().regex(/^\//, { error: 'must start with /' }),

  /** A dot path into the decoded JSON answer, such as `voices`. */
  list: z.string().min(1),
});

export type VoiceListing = z.infer<typeof VoiceListing>;

export interface IVoice {
  id: string;
  name: string;
}

export function readVoices(listing: VoiceListing, body: unknown): IVoice[] {
  const list = readJsonPath(body, listing.list);

  if (!Array.isArray(list)) {
    return [];
  }

  return list.flatMap((entry: unknown) => {
    const voice = voiceOf(entry);

    return voice === null ? [] : [voice];
  });
}

function voiceOf(entry: unknown): IVoice | null {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { id: entry, name: entry } : null;
  }

  if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
    return null;
  }

  const id = entry.id;
  const name = 'name' in entry ? entry.name : undefined;

  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }

  return { id, name: typeof name === 'string' && name.length > 0 ? name : id };
}
