import { EventDto, type EventFilterRequestDto, EventListResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { ISseSubscription, useSseService } from '../SseService';

export const useEventAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();
  const sseService = useSseService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getEventList(
    eventFilterRequest: EventFilterRequestDto,
    page: number,
    form: string | null = null
  ): Promise<EventListResponseDto> {
    const eventList = await apiService
      .makeRequest(`admin/event/list?page=${page}`, RequestType.PATCH, {
        response: EventListResponseDto,
        token: userStore.token,
        body: eventFilterRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return eventList;
  }

  function streamEvents(onEvent: (event: EventDto) => void, onReconnect: () => void): ISseSubscription {
    return sseService.subscribe('admin/event/stream', EventDto, onEvent, {
      token: userStore.token,
      onReconnect,
    });
  }

  return {
    getEventList,
    streamEvents,
  };
};
