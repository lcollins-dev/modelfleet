import { describe, expect, it } from 'vitest';

import { BatchJobId, BatchJobDto } from '@libs/dto';

import { jobResult } from './jobResult';

const job = (lastSuccessDate: string | null, lastFailDate: string | null): BatchJobDto => ({
  id: BatchJobId.RESIDENCY,
  name: 'Residency',
  desc: '',
  cronExpression: '0 3 * * *',
  enabled: true,
  lastStartDate: null,
  lastSuccessDate: lastSuccessDate === null ? null : new Date(lastSuccessDate),
  lastFailDate: lastFailDate === null ? null : new Date(lastFailDate),
});

describe('jobResult', () => {
  it('has nothing to report for a job that never ran', () => {
    expect(jobResult(job(null, null))).toBe('never');
  });

  it('reports the later of the last success and the last failure', () => {
    expect(jobResult(job('2026-09-30T03:00:00Z', '2026-09-29T03:00:00Z'))).toBe('succeeded');
    expect(jobResult(job('2026-09-29T03:00:00Z', '2026-09-30T03:00:00Z'))).toBe('failed');
  });

  it('reports a failure when the job has never succeeded', () => {
    expect(jobResult(job(null, '2026-09-30T03:00:00Z'))).toBe('failed');
  });
});
