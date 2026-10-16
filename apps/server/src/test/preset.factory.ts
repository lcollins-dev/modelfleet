import { BackendId } from '@libs/backends';

import { Preset } from '@/core/preset/entities/preset.entity';

export const TEST_PRESET_ID = 5;

/** Builds a preset as a row read back from the database, generated columns included. */
export const buildPreset = (overrides: Partial<Preset> = {}): Preset => {
  const preset = new Preset({
    name: 'Single 4090',
    description: null,
    backend: BackendId.LLAMA_CPP,
    schemaVersion: 1,
    document: 'image: llama:latest\nthreads: 16\n',
    configuration: { image: 'llama:latest', threads: 16 },
  });

  preset.id = TEST_PRESET_ID;
  preset.createdDate = new Date('2026-08-20T09:00:00Z');
  preset.updatedDate = new Date('2026-08-20T09:00:00Z');

  Object.assign(preset, overrides);

  return preset;
};
