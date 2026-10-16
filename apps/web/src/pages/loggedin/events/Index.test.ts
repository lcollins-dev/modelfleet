import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import type { EventDto } from '@libs/dto';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const getEventList = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ getEventList, streamEvents }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const event = (id: number, overrides: Partial<EventDto> = {}): EventDto => ({
  id,
  type: EventType.USER_SIGNED_IN,
  severity: EventSeverity.INFO,
  actorType: EventPartyType.USER,
  actorId: '1',
  actorName: 'Ada',
  subjectType: EventPartyType.USER,
  subjectId: '1',
  subjectName: 'Ada',
  message: `Signed in ${id}`,
  detail: { email: 'ada@modelfleet.test' },
  createdDate: new Date('2026-10-14T09:00:00.000Z'),
  ...overrides,
});

const mountIndex = async () => {
  const wrapper = mount(Index, { global: { stubs: { teleport: true } } });
  await flushPromises();

  return wrapper;
};

type IndexWrapper = Awaited<ReturnType<typeof mountIndex>>;

const settle = async () => {
  await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
  await flushPromises();
};

/** A multi-select opens on mousedown and stays open, so it is closed again once picked. */
const pick = async (wrapper: IndexWrapper, select: string, label: string, multiple = false) => {
  const combobox = wrapper.get(`[role="combobox"][aria-label="${select}"]`);

  await combobox.trigger(multiple ? 'mousedown' : 'click');

  const option = wrapper.findAll('[role="option"]').find(candidate => candidate.text() === label);

  if (option === undefined) {
    throw new Error(`No option reads ${label}`);
  }

  await option.trigger('click');

  if (multiple) {
    await combobox.trigger('keydown', { key: 'Escape' });
  }
};

const liveHandlers = () => {
  const [onEvent, onReconnect] = streamEvents.mock.calls[0] as [(event: EventDto) => void, () => void];

  return { onEvent, onReconnect };
};

const rowTexts = (wrapper: IndexWrapper) => wrapper.findAll('[data-testid="event-row"]').map(row => row.text());

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getEventList.mockResolvedValue({ eventList: [event(2), event(1)], pages: 1 });
  streamEvents.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Event log page', () => {
  it('lists the newest events with their summary, subject and actor, and counts them', async () => {
    const wrapper = await mountIndex();

    expect(getEventList).toHaveBeenCalledWith({}, 1);

    const rows = rowTexts(wrapper);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('User signed in');
    expect(rows[0]).toContain('Signed in 2');
    expect(rows[0]).toContain('Ada');

    expect(wrapper.get('[data-testid="event-count"]').text()).toBe('Showing 2 events');
  });

  it('narrows by type and severity in the request', async () => {
    const wrapper = await mountIndex();

    await pick(wrapper, 'Type', 'User sign in failed', true);
    await pick(wrapper, 'Severity', 'warning', true);
    await settle();

    expect(getEventList).toHaveBeenLastCalledWith(
      { type: [EventType.USER_SIGN_IN_FAILED], severity: [EventSeverity.WARNING] },
      1
    );
  });

  it('narrows by subject, actor and date range from the extra filters, and clears them', async () => {
    const wrapper = await mountIndex();

    expect(wrapper.find('[data-testid="event-more-filters"]').exists()).toBe(false);

    await wrapper.get('button[aria-expanded="false"]').trigger('click');

    await pick(wrapper, 'Subject kind', 'node');
    await wrapper.get('input[aria-label="Subject id"]').setValue('7');
    await pick(wrapper, 'Actor kind', 'user');
    await wrapper.get('input[aria-label="Actor id"]').setValue('3');
    await wrapper.get('input[aria-label="From"]').setValue('2026-10-01T08:00');
    await wrapper.get('input[aria-label="To"]').setValue('2026-10-02T08:00');
    await settle();

    expect(getEventList).toHaveBeenLastCalledWith(
      {
        subjectType: EventPartyType.NODE,
        subjectId: '7',
        actorType: EventPartyType.USER,
        actorId: '3',
        fromDate: new Date('2026-10-01T08:00').toISOString(),
        toDate: new Date('2026-10-02T08:00').toISOString(),
      },
      1
    );
    expect(wrapper.get('button[aria-expanded="true"]').text()).toContain('6');

    const clear = wrapper.findAll('button').find(button => button.text() === 'Clear');
    await clear?.trigger('click');
    await settle();

    expect(getEventList).toHaveBeenLastCalledWith({}, 1);
  });

  it('explains an empty log, then a filter that matches nothing', async () => {
    getEventList.mockResolvedValue({ eventList: [], pages: 1 });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No events recorded yet.');

    await pick(wrapper, 'Severity', 'error', true);
    await settle();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No events match your filters.');
  });

  it('pages through the log', async () => {
    getEventList.mockResolvedValue({ eventList: [event(1)], pages: 3 });

    const wrapper = await mountIndex();

    await wrapper.get('[data-testid="table-footer"] button[aria-label="Page 2"]').trigger('click');
    await flushPromises();

    expect(getEventList).toHaveBeenLastCalledWith({}, 2);
  });

  it('prepends a live event on the first page only when it matches the filters', async () => {
    const wrapper = await mountIndex();
    const { onEvent } = liveHandlers();

    onEvent(event(3));
    onEvent(event(3));
    await flushPromises();

    expect(rowTexts(wrapper)).toHaveLength(3);
    expect(rowTexts(wrapper)[0]).toContain('Signed in 3');

    await pick(wrapper, 'Severity', 'warning', true);
    await settle();

    onEvent(event(4));
    await flushPromises();

    expect(rowTexts(wrapper).some(text => text.includes('Signed in 4'))).toBe(false);
  });

  it('holds later pages still, and rereads the first page on reconnect', async () => {
    getEventList.mockResolvedValue({ eventList: [event(1)], pages: 3 });

    const wrapper = await mountIndex();
    const { onEvent, onReconnect } = liveHandlers();

    onReconnect();
    await flushPromises();

    expect(getEventList).toHaveBeenCalledTimes(2);

    await wrapper.get('[data-testid="table-footer"] button[aria-label="Page 2"]').trigger('click');
    await flushPromises();

    onEvent(event(5));
    onReconnect();
    await flushPromises();

    expect(rowTexts(wrapper).some(text => text.includes('Signed in 5'))).toBe(false);
    expect(getEventList).toHaveBeenCalledTimes(3);
  });

  it('closes the stream when it leaves', async () => {
    const wrapper = await mountIndex();

    const stream = streamEvents.mock.results[0].value as ReturnType<typeof subscription>;

    wrapper.unmount();

    expect(stream.close).toHaveBeenCalled();
  });
});
