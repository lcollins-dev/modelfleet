import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendId, ModelType } from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

import { Model } from './entities/model.entity';

import { IReferencingConfiguration, ModelReferenceService } from './model-reference.service';
import { ModelService } from './model.service';

import { buildModel } from '@/test/model.factory';

const DRAFT_FINGERPRINT = 'c'.repeat(64);

const DFLASH_METADATA = {
  architecture: 'dflash',
  quantisation: 'Q8_0',
  quantisationMixed: false,
  layerCount: 8,
  embeddingLength: 2048,
  headCount: 16,
  headCountKv: 1,
  contextLength: null,
  tensors: null,
};

const buildDraft = (overrides: Partial<Model> = {}): Model =>
  buildModel({
    id: 7,
    fingerprint: DRAFT_FINGERPRINT,
    type: ModelType.DRAFT,
    name: 'DSpark Q8',
    ggufMetadata: DFLASH_METADATA,
    ...overrides,
  });

const configured = (configuration: ConfigurationDocument): IReferencingConfiguration => ({
  backend: BackendId.LLAMA_CPP,
  configuration,
});

const EMPTY = configured({});

const withDraft = (speculativeType?: string): IReferencingConfiguration =>
  configured({ draftModel: DRAFT_FINGERPRINT, ...(speculativeType === undefined ? {} : { speculativeType }) });

describe('ModelReferenceService', () => {
  let held: Map<string, Model>;
  let service: ModelReferenceService;

  const refusalsOf = async (previous: IReferencingConfiguration, next: IReferencingConfiguration) => {
    const error: unknown = await service.checkIntroduced(previous, next).then(
      () => null,
      (caught: unknown) => caught
    );

    if (!(error instanceof BadRequestException)) {
      throw new Error('Expected the write to be refused');
    }

    return (error.getResponse() as { message: unknown[] }).message;
  };

  beforeEach(() => {
    held = new Map([[DRAFT_FINGERPRINT, buildDraft()]]);
    service = new ModelReferenceService({
      findByFingerprints: vi.fn(() => Promise.resolve(held)),
    } as unknown as ModelService);
  });

  describe('a split draft', () => {
    it('is refused under its field, naming the file', async () => {
      held.set(DRAFT_FINGERPRINT, buildDraft({ shardCount: 3 }));

      await expect(refusalsOf(EMPTY, withDraft())).resolves.toEqual([
        {
          path: 'draftModel',
          name: 'Draft model',
          message: 'DSpark Q8 is split across 3 files, and Draft model takes a single file',
        },
      ]);
    });

    it('stays where a later scan split a file already named', async () => {
      held.set(DRAFT_FINGERPRINT, buildDraft({ shardCount: 3 }));

      await expect(service.checkIntroduced(withDraft(), withDraft())).resolves.toBeUndefined();
    });
  });

  describe('a draft paired with a speculative type', () => {
    const eagle = () => buildDraft({ ggufMetadata: { ...DFLASH_METADATA, architecture: 'eagle3' } });

    it.each(['draft-dflash', 'draft-dspark'])('refuses %s on a file that is not dflash, naming both', async type => {
      held.set(DRAFT_FINGERPRINT, eagle());

      await expect(refusalsOf(EMPTY, withDraft(type))).resolves.toEqual([
        {
          path: 'speculativeType',
          name: 'Speculative type',
          message: `${type} needs a dflash file, and DSpark Q8 is eagle3`,
        },
      ]);
    });

    it('refuses a pairing where the file states no architecture', async () => {
      held.set(DRAFT_FINGERPRINT, buildDraft({ ggufMetadata: null }));

      await expect(refusalsOf(EMPTY, withDraft('draft-dspark'))).resolves.toEqual([
        expect.objectContaining({
          path: 'speculativeType',
          message: 'draft-dspark needs a dflash file, and DSpark Q8 is of an unknown architecture',
        }),
      ]);
    });

    it('refuses a pairing a write makes by changing only the type', async () => {
      held.set(DRAFT_FINGERPRINT, eagle());

      await expect(refusalsOf(withDraft('draft-eagle3'), withDraft('draft-dspark'))).resolves.toHaveLength(1);
    });

    it('accepts a dflash file for either type', async () => {
      await expect(service.checkIntroduced(EMPTY, withDraft('draft-dspark'))).resolves.toBeUndefined();
      await expect(service.checkIntroduced(EMPTY, withDraft('draft-dflash'))).resolves.toBeUndefined();
    });

    it('accepts a type that takes another architecture', async () => {
      held.set(DRAFT_FINGERPRINT, eagle());

      await expect(service.checkIntroduced(EMPTY, withDraft('draft-eagle3'))).resolves.toBeUndefined();
    });

    it('accepts a dflash type with no draft named, which llama.cpp ignores', async () => {
      await expect(
        service.checkIntroduced(EMPTY, configured({ speculativeType: 'draft-dspark' }))
      ).resolves.toBeUndefined();
    });

    it('leaves a pairing already saved alone', async () => {
      held.set(DRAFT_FINGERPRINT, eagle());

      await expect(
        service.checkIntroduced(withDraft('draft-dspark'), withDraft('draft-dspark'))
      ).resolves.toBeUndefined();
    });
  });
});
