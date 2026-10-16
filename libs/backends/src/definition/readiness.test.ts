import { describe, expect, it } from 'vitest';

import { ReadinessProbe, ProbeMethod, readinessPasses } from './readiness';

const statusOnly: ReadinessProbe = {
  method: ProbeMethod.GET,
  path: '/health',
  passStatuses: [200],
};

const withBody: ReadinessProbe = {
  ...statusOnly,
  body: { path: 'state.phase', equals: 'ready' },
};

describe('readinessPasses', () => {
  it('passes on a status the probe accepts', () => {
    expect(readinessPasses(statusOnly, { status: 200, body: undefined })).toBe(true);
  });

  it('fails on any other status', () => {
    expect(readinessPasses(statusOnly, { status: 503, body: { status: 'loading' } })).toBe(false);
  });

  it('reads the expected value down a dotted path', () => {
    expect(readinessPasses(withBody, { status: 200, body: { state: { phase: 'ready' } } })).toBe(true);
  });

  it('fails where the body carries another value', () => {
    expect(readinessPasses(withBody, { status: 200, body: { state: { phase: 'loading' } } })).toBe(false);
  });

  it('fails where the path is missing rather than reading through it', () => {
    expect(readinessPasses(withBody, { status: 200, body: { state: null } })).toBe(false);
  });

  it('fails on a body that is not an object', () => {
    expect(readinessPasses(withBody, { status: 200, body: 'ready' })).toBe(false);
  });

  it('ignores the body where the probe expects none', () => {
    expect(readinessPasses(statusOnly, { status: 200, body: { state: { phase: 'loading' } } })).toBe(true);
  });
});
