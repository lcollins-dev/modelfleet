import {
  BatchJobListResponseDto,
  BatchJobRunListResponseDto,
  BatchJobRunDto,
  BatchJobDto,
  type UpdateBatchJobStateRequestDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useBatchJobAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getBatchJobList(): Promise<BatchJobListResponseDto> {
    const batchJobList = await apiService
      .makeRequest(`admin/batch-job/list`, RequestType.GET, {
        response: BatchJobListResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return batchJobList;
  }

  async function getBatchJob(batchJobId: number, form: string | null = null): Promise<BatchJobDto> {
    const user = await apiService
      .makeRequest(`admin/batch-job/${batchJobId}`, RequestType.GET, {
        response: BatchJobDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return user;
  }

  async function getBatchJobRunList(batchJobId: number, page: number): Promise<BatchJobRunListResponseDto> {
    const batchJobRunList = await apiService
      .makeRequest(`admin/batch-job/${batchJobId}/runs?page=${page}`, RequestType.GET, {
        response: BatchJobRunListResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return batchJobRunList;
  }

  async function updateBatchJobState(
    updateBatchJobStateRequest: UpdateBatchJobStateRequestDto,
    batchJobId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/batch-job/${batchJobId}/state`, RequestType.PATCH, {
        token: userStore.token,
        body: updateBatchJobStateRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function runBatchJob(batchJobId: number): Promise<BatchJobRunDto> {
    const batchJobRun = await apiService
      .makeRequest(`admin/batch-job/${batchJobId}/run`, RequestType.POST, {
        response: BatchJobRunDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return batchJobRun;
  }

  return {
    getBatchJobList,
    getBatchJob,
    getBatchJobRunList,
    updateBatchJobState,
    runBatchJob,
  };
};
