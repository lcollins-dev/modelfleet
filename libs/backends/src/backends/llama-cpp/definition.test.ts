import { describe, expect, it } from 'vitest';

import { BackendOperation, readinessPasses } from '../../definition';
import { renderContainer } from '../../runtime';
import { buildContainerInput } from '../../test/container.factory';
import { llamaCppDefinition } from './definition';

describe('llamaCppDefinition', () => {
  it('renders the same container from a fixed input', () => {
    expect(renderContainer(llamaCppDefinition, buildContainerInput())).toMatchSnapshot();
  });

  it('serves chat completions, embeddings and transcription', () => {
    expect(Object.keys(llamaCppDefinition.operations)).toEqual([
      BackendOperation.CHAT_COMPLETIONS,
      BackendOperation.EMBEDDINGS,
      BackendOperation.TRANSCRIPTION,
    ]);
  });

  it('passes the probe once the backend is serving the model, and not while it loads', () => {
    const probe = llamaCppDefinition.readiness.probe;
    const loading = { code: 503, message: 'Loading model', type: 'unavailable_error' };

    expect(readinessPasses(probe, { status: 200, body: { status: 'ok' } })).toBe(true);
    expect(readinessPasses(probe, { status: 503, body: { error: loading } })).toBe(false);
    expect(readinessPasses(probe, { status: 200, body: 'OK' })).toBe(false);
  });

  it('has its devices listed in pin order, since it reads a tensor split in device order', () => {
    expect(llamaCppDefinition.container.pinOrderedDevices).toBe(true);
  });
});
