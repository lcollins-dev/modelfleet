import { BatchJobRunResult, type BatchJobDto } from '@libs/dto';

import type { TagType } from '@/components/ui';

export type TJobResult = 'succeeded' | 'failed' | 'never';

export const jobResult = (batchJob: BatchJobDto): TJobResult => {
  const success = batchJob.lastSuccessDate?.getTime() ?? null;
  const failure = batchJob.lastFailDate?.getTime() ?? null;

  if (failure !== null && (success === null || failure > success)) {
    return 'failed';
  }

  return success === null ? 'never' : 'succeeded';
};

export const JOB_RESULT_LABELS: Record<TJobResult, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  never: 'Not run yet',
};

export const JOB_RESULT_TAG_TYPES: Record<TJobResult, TagType> = {
  succeeded: 'success',
  failed: 'error',
  never: 'default',
};

export const JOB_RUN_RESULT_LABELS: Record<BatchJobRunResult, string> = {
  [BatchJobRunResult.RUNNING]: 'Running',
  [BatchJobRunResult.SUCCEEDED]: 'Succeeded',
  [BatchJobRunResult.FAILED]: 'Failed',
};

export const JOB_RUN_RESULT_TAG_TYPES: Record<BatchJobRunResult, TagType> = {
  [BatchJobRunResult.RUNNING]: 'primary',
  [BatchJobRunResult.SUCCEEDED]: 'success',
  [BatchJobRunResult.FAILED]: 'error',
};
