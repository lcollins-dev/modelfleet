import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import type { EventDto } from '@libs/dto';
import { EventPartyType } from '@libs/dto';

import { Config } from '@/Config';

import { useEventAdminService } from '@/services/api/admin/EventAdminService';

import { IListPage, IPagedListOptions, usePagedList } from './usePagedList';

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: vi.fn(),
}));

interface IRequest {
  search?: string;
}

const PAGE: IListPage<string> = { list: ['first', 'second'], pages: 3 };

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('usePagedList', () => {
  let fetchMock: ReturnType<typeof vi.fn<(request: IRequest, page: number) => Promise<IListPage<string>>>>;
  let streamEventsMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;
  let onEvent: (event: EventDto) => void;
  let onReconnect: () => void;

  const mountList = (options: Partial<IPagedListOptions<IRequest, string>> = {}) => {
    let pagedList: ReturnType<typeof usePagedList<IRequest, string>> | undefined;

    const wrapper = mount(
      defineComponent({
        setup() {
          pagedList = usePagedList<IRequest, string>({ request: {}, fetch: fetchMock, ...options });

          return () => null;
        },
      })
    );

    return { wrapper, pagedList: pagedList! };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    fetchMock = vi.fn<(request: IRequest, page: number) => Promise<IListPage<string>>>().mockResolvedValue(PAGE);
    closeMock = vi.fn();
    streamEventsMock = vi.fn((eventHandler: (event: EventDto) => void, reconnectHandler: () => void) => {
      onEvent = eventHandler;
      onReconnect = reconnectHandler;

      return { close: closeMock };
    });

    vi.mocked(useEventAdminService).mockReturnValue({
      streamEvents: streamEventsMock,
    } as unknown as ReturnType<typeof useEventAdminService>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = async () => {
    const pending = flushPromises();

    await vi.advanceTimersByTimeAsync(0);
    await pending;
  };

  it('loads the first page on mount', async () => {
    const { pagedList } = mountList({ request: { search: 'llama' } });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ search: 'llama' }, 1);
    expect(pagedList.loading.value).toBe(true);

    await settle();

    expect(pagedList.list.value).toEqual(PAGE.list);
    expect(pagedList.pages.value).toBe(3);
    expect(pagedList.loading.value).toBe(false);
  });

  it('fetches a page change at once', async () => {
    const { pagedList } = mountList();
    await settle();
    fetchMock.mockClear();

    pagedList.page.value = 2;
    await nextTick();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({}, 2);
  });

  it('returns to the first page on a request change and fetches it once, after the debounce', async () => {
    const request = ref<IRequest>({});
    const { pagedList } = mountList({ request });
    await settle();

    pagedList.page.value = 3;
    await nextTick();
    fetchMock.mockClear();

    request.value = { search: 'l' };
    await nextTick();
    request.value = { search: 'll' };
    await nextTick();

    expect(pagedList.page.value).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ search: 'll' }, 1);
  });

  it('fetches a page change after a request change made on the first page', async () => {
    const request = ref<IRequest>({});
    const { pagedList } = mountList({ request });
    await settle();

    request.value = { search: 'llama' };
    await nextTick();
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    fetchMock.mockClear();

    pagedList.page.value = 2;
    await nextTick();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ search: 'llama' }, 2);
  });

  it('fetches nothing while the request is null', async () => {
    const request = ref<IRequest | null>(null);
    mountList({ request });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();

    request.value = { search: 'llama' };
    await nextTick();
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ search: 'llama' }, 1);
  });

  it('clears loading when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { pagedList } = mountList();

    await settle();

    expect(pagedList.loading.value).toBe(false);
    expect(pagedList.list.value).toEqual([]);
  });

  it('opens no event stream without live subjects', () => {
    mountList();

    expect(streamEventsMock).not.toHaveBeenCalled();
  });

  it('refetches, after the debounce, for an event about a live subject', async () => {
    const onLive = vi.fn();
    mountList({ liveSubjects: [EventPartyType.NODE], onLive });
    await settle();
    fetchMock.mockClear();

    onEvent({ subjectType: EventPartyType.NODE } as EventDto);

    expect(onLive).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({}, 1);
  });

  it('ignores an event about any other subject', async () => {
    const onLive = vi.fn();
    mountList({ liveSubjects: [EventPartyType.NODE], onLive });
    await settle();
    fetchMock.mockClear();

    onEvent({ subjectType: EventPartyType.MODEL } as EventDto);
    onEvent({} as EventDto);
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(onLive).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches at once when the event stream reconnects', async () => {
    const onLive = vi.fn();
    mountList({ liveSubjects: [EventPartyType.NODE], onLive });
    await settle();
    fetchMock.mockClear();

    onReconnect();

    expect(onLive).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({}, 1);
  });

  it('keeps the rows on screen, without the loader, while a live event refetches them', async () => {
    const { pagedList } = mountList({ liveSubjects: [EventPartyType.NODE] });
    await settle();
    fetchMock.mockReturnValue(new Promise(() => undefined));

    onEvent({ subjectType: EventPartyType.NODE } as EventDto);
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pagedList.loading.value).toBe(false);
    expect(pagedList.list.value).toEqual(PAGE.list);
  });

  it('keeps the rows on screen, without the loader, while a reconnect or a direct load refetches them', async () => {
    const { pagedList } = mountList({ liveSubjects: [EventPartyType.NODE] });
    await settle();
    fetchMock.mockReturnValue(new Promise(() => undefined));

    onReconnect();

    expect(pagedList.loading.value).toBe(false);

    void pagedList.load();

    expect(pagedList.loading.value).toBe(false);
    expect(pagedList.list.value).toEqual(PAGE.list);
  });

  it('shows the loader while a page change fetches', async () => {
    const { pagedList } = mountList();
    await settle();
    fetchMock.mockReturnValue(new Promise(() => undefined));

    pagedList.page.value = 2;
    await nextTick();

    expect(pagedList.loading.value).toBe(true);
  });

  it('shows the loader while a request change fetches', async () => {
    const request = ref<IRequest>({});
    const { pagedList } = mountList({ request });
    await settle();
    fetchMock.mockReturnValue(new Promise(() => undefined));

    request.value = { search: 'llama' };
    await nextTick();
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(pagedList.loading.value).toBe(true);
  });

  it('shows the loader for a request change made while an earlier fetch is still in flight', async () => {
    const request = ref<IRequest>({});
    let answerFirst: (page: IListPage<string>) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise(resolve => (answerFirst = resolve)));
    const { pagedList } = mountList({ request });

    request.value = { search: 'llama' };
    await nextTick();
    answerFirst(PAGE);
    await settle();

    fetchMock.mockReturnValue(new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenLastCalledWith({ search: 'llama' }, 1);
    expect(pagedList.loading.value).toBe(true);
  });

  it('shows the loader on a refetch after a failed page change, since the rows are still the old page', async () => {
    const { pagedList } = mountList({ liveSubjects: [EventPartyType.NODE] });
    await settle();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    pagedList.page.value = 2;
    await settle();

    expect(pagedList.loading.value).toBe(false);

    fetchMock.mockReturnValue(new Promise(() => undefined));
    onReconnect();

    expect(pagedList.loading.value).toBe(true);
  });

  it('closes the event stream on unmount', () => {
    const { wrapper } = mountList({ liveSubjects: [EventPartyType.NODE] });

    wrapper.unmount();

    expect(closeMock).toHaveBeenCalledOnce();
  });

  it('drops a refetch still pending at unmount', async () => {
    const { wrapper } = mountList({ liveSubjects: [EventPartyType.NODE] });
    await settle();
    fetchMock.mockClear();

    onEvent({ subjectType: EventPartyType.NODE } as EventDto);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the latest page when an earlier one answers last', async () => {
    const { pagedList } = mountList();
    await settle();

    let answerPageTwo: (page: IListPage<string>) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise(resolve => (answerPageTwo = resolve)));
    fetchMock.mockResolvedValueOnce({ list: ['page three'], pages: 3 });

    pagedList.page.value = 2;
    await nextTick();
    pagedList.page.value = 3;
    await nextTick();
    await settle();

    answerPageTwo({ list: ['page two'], pages: 3 });
    await settle();

    expect(pagedList.list.value).toEqual(['page three']);
    expect(pagedList.loading.value).toBe(false);
  });

  it('fetches a page clicked during a pending request change once, with the new request', async () => {
    const request = ref<IRequest>({});
    const { pagedList } = mountList({ request });
    await settle();
    fetchMock.mockClear();

    request.value = { search: 'llama' };
    await nextTick();
    pagedList.page.value = 2;
    await nextTick();
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ search: 'llama' }, 2);
  });

  it('fetches a request change at once, from the first page, when told not to debounce it', async () => {
    const request = ref<IRequest>({ search: 'node 1' });
    const { pagedList } = mountList({ request, debounceRequest: false });
    await settle();

    pagedList.page.value = 3;
    await nextTick();
    fetchMock.mockClear();

    request.value = { search: 'node 2' };
    await nextTick();
    await nextTick();

    expect(pagedList.page.value).toBe(1);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ search: 'node 2' }, 1);
  });
});
