import { beforeEach, describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

import { ConfigurationRevisionService } from '@/core/configuration/configuration-revision.service';
import { ConfigurationValueService } from '@/core/configuration/configuration-value.service';

const MODEL_ID = 11;

describe('ConfigurationRevisionService', () => {
  let configurationRevisionService: ConfigurationRevisionService;

  const revisionOf = (configuration: ConfigurationDocument, modelId: number = MODEL_ID): string =>
    configurationRevisionService.revisionOf({ backend: BackendId.LLAMA_CPP, modelId, configuration });

  beforeEach(() => {
    configurationRevisionService = new ConfigurationRevisionService(new ConfigurationValueService());
  });

  it('digests the same configuration to the same revision', () => {
    expect(revisionOf({ image: 'llama:latest', threads: 8 })).toBe(revisionOf({ image: 'llama:latest', threads: 8 }));
  });

  it('moves when a backend field changes', () => {
    expect(revisionOf({ image: 'llama:latest', threads: 8 })).not.toBe(
      revisionOf({ image: 'llama:latest', threads: 16 })
    );
  });

  it('moves when the image changes', () => {
    expect(revisionOf({ image: 'llama:latest' })).not.toBe(revisionOf({ image: 'llama:v1' }));
  });

  it('stands where it is when a hot field changes', () => {
    expect(revisionOf({ image: 'llama:latest', replicas: 1 })).toBe(revisionOf({ image: 'llama:latest', replicas: 4 }));
  });

  it('stands where it is when a declared VRAM figure changes, so the measured figure stays its own', () => {
    expect(revisionOf({ image: 'llama:latest', vramGib: 6 })).toBe(revisionOf({ image: 'llama:latest', vramGib: 12 }));
  });

  it('stands where it is when a hot field is added', () => {
    expect(revisionOf({ image: 'llama:latest' })).toBe(revisionOf({ image: 'llama:latest', replicas: 2 }));
  });

  it('moves when a pinned placement changes', () => {
    expect(revisionOf({ image: 'llama:latest', placement: { nodeIds: [1] } })).not.toBe(
      revisionOf({ image: 'llama:latest', placement: { nodeIds: [2] } })
    );
  });

  it('moves when the model changes, since a different model is a different container', () => {
    expect(revisionOf({ image: 'llama:latest' })).not.toBe(revisionOf({ image: 'llama:latest' }, MODEL_ID + 1));
  });

  it('ignores the order the keys were authored in', () => {
    expect(revisionOf({ image: 'llama:latest', threads: 8 })).toBe(revisionOf({ threads: 8, image: 'llama:latest' }));
  });

  it('ignores the order the keys of a nested value were authored in', () => {
    expect(revisionOf({ image: 'a', placement: { nodeIds: [1], spreadAcrossNodes: true } })).toBe(
      revisionOf({ image: 'a', placement: { spreadAcrossNodes: true, nodeIds: [1] } })
    );
  });

  it('keeps the order of a list, since a list is one value', () => {
    expect(revisionOf({ image: 'a', tensorSplit: [1, 2] })).not.toBe(revisionOf({ image: 'a', tensorSplit: [2, 1] }));
  });

  it('moves when a key no field models changes, since every key but a hot one counts', () => {
    expect(revisionOf({ image: 'a', draftModel: 'small' })).not.toBe(revisionOf({ image: 'a', draftModel: 'large' }));
  });
});
