import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventDto, EventListResponseDto } from '@libs/dto';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { ISseOptions, useSseService } from '../SseService';
import { useEventAdminService } from './EventAdminService';

vi.mock('../ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

vi.mock('../SseService', () => ({
  useSseService: vi.fn(),
}));

const TOKEN_OPTIONS = { token: 'signed-jwt' };

describe('useEventAdminService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn>;
  let clearTimedOutNotificationsMock: ReturnType<typeof vi.fn<() => void>>;
  let subscribeMock: ReturnType<
    typeof vi.fn<
      (endpoint: string, schema: unknown, onPayload: (payload: EventDto) => void, options?: ISseOptions) => unknown
    >
  >;

  const forwardPayload = (payload: EventDto): void => {
    subscribeMock.mock.calls[0][2](payload);
  };

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn().mockResolvedValue(undefined);
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });
    clearValidationErrorMock = vi.fn();
    clearTimedOutNotificationsMock = vi.fn<() => void>();
    subscribeMock = vi
      .fn<
        (endpoint: string, schema: unknown, onPayload: (payload: EventDto) => void, options?: ISseOptions) => unknown
      >()
      .mockReturnValue({ connected: { value: false }, close: vi.fn() });

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
      clearValidationError: clearValidationErrorMock,
    } as unknown as ReturnType<typeof useErrorService>);
    vi.mocked(useSseService).mockReturnValue({
      subscribe: subscribeMock,
    } as unknown as ReturnType<typeof useSseService>);

    useNotificationStore().clearTimedOutNotifications = clearTimedOutNotificationsMock;
    useUserStore().setToken('signed-jwt');
  });

  it('puts the page number in the query string and the filter in the body', async () => {
    makeRequestMock.mockResolvedValue({ eventList: [], pages: 0 });

    await useEventAdminService().getEventList({ severity: [EventSeverity.ERROR] }, 2, 'event-list');

    expect(makeRequestMock).toHaveBeenCalledWith('admin/event/list?page=2', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      response: EventListResponseDto,
      body: { severity: [EventSeverity.ERROR] },
      form: 'event-list',
    });
  });

  it('hands a failed list to the error service', async () => {
    makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNAUTHORIZED));

    await expect(useEventAdminService().getEventList({}, 1)).rejects.toThrow();

    expect(handleErrorMock).toHaveBeenCalled();
    expect(clearTimedOutNotificationsMock).not.toHaveBeenCalled();
  });

  it('opens the stream against the admin endpoint with the signed-in token', () => {
    useEventAdminService().streamEvents(vi.fn(), vi.fn());

    expect(subscribeMock).toHaveBeenCalledWith(
      'admin/event/stream',
      EventDto,
      expect.any(Function),
      expect.any(Object)
    );
    expect(subscribeMock.mock.calls[0][3]?.token).toBe('signed-jwt');
  });

  it('hands back the subscription so the caller can close it', () => {
    const subscription = { connected: { value: false }, close: vi.fn() };
    subscribeMock.mockReturnValue(subscription);

    expect(useEventAdminService().streamEvents(vi.fn(), vi.fn())).toBe(subscription);
  });

  it('passes a recorded event through to its caller', () => {
    const onEvent = vi.fn();
    const event: EventDto = {
      id: 7,
      type: EventType.USER_SIGNED_IN,
      severity: EventSeverity.INFO,
      actorType: EventPartyType.USER,
      actorId: '42',
      detail: { email: 'tester@example.com' },
      createdDate: new Date('2026-08-22T10:00:00.000Z'),
    };

    useEventAdminService().streamEvents(onEvent, vi.fn());
    forwardPayload(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });
});
