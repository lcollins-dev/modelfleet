import { describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';

import { CreateDeploymentRequestDto, UpdateDeploymentRequestDto } from './admin';
import { ActivationPolicy } from './deployment';

const create = { name: 'chat', modelId: 1, activationPolicy: ActivationPolicy.ALWAYS, document: '' };

describe('CreateDeploymentRequestDto', () => {
  it('takes a preset by id', () => {
    expect(CreateDeploymentRequestDto.parse({ ...create, presetId: 3 }).presetId).toBe(3);
  });

  it('keeps a null preset and backend as sent, for the server to read as none', () => {
    expect(CreateDeploymentRequestDto.parse({ ...create, presetId: null, backend: null })).toMatchObject({
      presetId: null,
      backend: null,
    });
  });

  it('leaves an absent preset absent', () => {
    expect(CreateDeploymentRequestDto.parse({ ...create, backend: BackendId.LLAMA_CPP })).not.toHaveProperty(
      'presetId'
    );
  });

  it('refuses a preset id that is not a row', () => {
    expect(CreateDeploymentRequestDto.safeParse({ ...create, presetId: 0 }).success).toBe(false);
  });
});

describe('UpdateDeploymentRequestDto', () => {
  it('requires a description, which may be empty', () => {
    expect(UpdateDeploymentRequestDto.safeParse({ ...create, presetId: null, backend: null }).success).toBe(false);
    expect(
      UpdateDeploymentRequestDto.safeParse({ ...create, presetId: null, backend: null, description: '' }).success
    ).toBe(true);
  });
});
