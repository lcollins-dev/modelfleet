import {
  type CreateDownloadRequestDto,
  DownloadDto,
  type DownloadListRequestDto,
  DownloadListResponseDto,
  DownloadProgressResponseDto,
  type RepositoryListingRequestDto,
  RepositoryListingResponseDto,
  type StopDownloadRequestDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { ISseSubscription, useSseService } from '../SseService';

export const useDownloadAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();
  const sseService = useSseService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getDownloadList(
    downloadListRequest: DownloadListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<DownloadListResponseDto> {
    const downloadList = await apiService
      .makeRequest(`admin/download/list?page=${page}`, RequestType.PATCH, {
        response: DownloadListResponseDto,
        token: userStore.token,
        body: downloadListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return downloadList;
  }

  /** The stream opens with what every node is doing, then sends it again at most once a second while they report. */
  function streamDownloadProgress(
    onProgress: (progress: DownloadProgressResponseDto) => void,
    onReconnect?: () => void
  ): ISseSubscription {
    return sseService.subscribe('admin/download/progress/stream', DownloadProgressResponseDto, onProgress, {
      token: userStore.token,
      onReconnect,
    });
  }

  async function getDownload(downloadId: number, form: string | null = null): Promise<DownloadDto> {
    const download = await apiService
      .makeRequest(`admin/download/${downloadId}`, RequestType.GET, {
        response: DownloadDto,
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return download;
  }

  async function getRepositoryListing(
    repositoryListingRequest: RepositoryListingRequestDto,
    form: string | null = null
  ): Promise<RepositoryListingResponseDto> {
    const listing = await apiService
      .makeRequest('admin/download/listing', RequestType.PATCH, {
        response: RepositoryListingResponseDto,
        token: userStore.token,
        body: repositoryListingRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return listing;
  }

  async function createDownload(
    createDownloadRequest: CreateDownloadRequestDto,
    form: string | null = null
  ): Promise<DownloadDto> {
    const download = await apiService
      .makeRequest('admin/download', RequestType.POST, {
        response: DownloadDto,
        token: userStore.token,
        body: createDownloadRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return download;
  }

  async function stopDownload(
    downloadId: number,
    stopDownloadRequest: StopDownloadRequestDto,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/download/${downloadId}/stop`, RequestType.POST, {
        token: userStore.token,
        body: stopDownloadRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function retryDownload(downloadId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/download/${downloadId}/retry`, RequestType.POST, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function dismissDownload(downloadId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/download/${downloadId}`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getDownloadList,
    streamDownloadProgress,
    getDownload,
    getRepositoryListing,
    createDownload,
    stopDownload,
    retryDownload,
    dismissDownload,
  };
};
