import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { EventDto } from '@libs/dto';
import { EventPartyType, EventSeverity, EventType, UserRoleId } from '@libs/dto';

import { useUserStore } from '@/stores/user';

import type { EventTableColumn } from './Table.vue';
import Table from './Table.vue';

const event = (overrides: Partial<EventDto> = {}): EventDto => ({
  id: 1,
  type: EventType.NODE_REGISTERED,
  severity: EventSeverity.INFO,
  message: 'Registered `gpu-a-01`',
  detail: {},
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
  ...overrides,
});

const signIn = (userRoleIds: UserRoleId[]) =>
  useUserStore().setProfile({ name: 'Ann Lee', email: 'ann@example.com', userRoleIds, mustChangePassword: false });

interface ITableProps {
  events: EventDto[];
  columns: EventTableColumn[];
  emptyDescription: string;
  loading?: boolean;
}

const mountTable = (props: ITableProps, slots: Record<string, string> = {}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  return { table: mount(Table, { props, slots, global: { plugins: [router] } }), router };
};

const partyEvent = (overrides: Partial<EventDto> = {}): EventDto =>
  event({
    subjectType: EventPartyType.NODE,
    subjectId: '7',
    subjectName: 'gpu-a-01',
    actorType: EventPartyType.USER,
    actorId: '3',
    actorName: 'Ann Lee',
    detail: { name: 'gpu-a-01' },
    ...overrides,
  });

const linkHrefs = (table: ReturnType<typeof mountTable>['table']) =>
  table.findAll('[data-testid="event-party-link"]').map(link => link.attributes('href'));

describe('MfEventTable', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    signIn([UserRoleId.SYSTEM_ADMIN]);
  });

  it('heads only the columns asked for, and renders the summary markup', () => {
    const { table } = mountTable({
      events: [event()],
      columns: ['when', 'event', 'summary'],
      emptyDescription: 'Nothing yet.',
    });

    expect(table.text()).toContain('When');
    expect(table.text()).not.toContain('Actor');
    expect(table.get('[data-testid="event-row"] code').text()).toBe('gpu-a-01');
  });

  it('names a party where it resolved and falls back to its type and id', () => {
    const { table } = mountTable({
      events: [
        event({
          subjectType: EventPartyType.NODE,
          subjectId: '7',
          subjectName: 'gpu-a-01',
          actorType: EventPartyType.USER,
          actorId: '3',
        }),
      ],
      columns: ['subject', 'actor'],
      emptyDescription: 'Nothing yet.',
    });

    const row = table.get('[data-testid="event-row"]').text();

    expect(row).toContain('gpu-a-01');
    expect(row).toContain('node 7');
    expect(row).toContain('user 3');
  });

  it('links a named party to its page, and a user only for a user admin', () => {
    expect(
      linkHrefs(mountTable({ events: [partyEvent()], columns: ['subject', 'actor'], emptyDescription: '-' }).table)
    ).toEqual(['/nodes/7']);

    signIn([UserRoleId.SYSTEM_ADMIN, UserRoleId.USER_ADMIN]);

    expect(
      linkHrefs(mountTable({ events: [partyEvent()], columns: ['subject', 'actor'], emptyDescription: '-' }).table)
    ).toEqual(['/nodes/7', '/users/3']);
  });

  it('leaves a deleted party and an API key plain', () => {
    const { table } = mountTable({
      events: [
        partyEvent({ subjectName: undefined, actorType: EventPartyType.API_KEY, actorId: '9', actorName: 'ci' }),
      ],
      columns: ['subject', 'actor'],
      emptyDescription: '-',
    });

    const row = table.get('[data-testid="event-row"]');

    expect(row.find('[data-testid="event-party-link"]').exists()).toBe(false);
    expect(row.text()).toContain('node 7');
    expect(row.text()).toContain('ci');
  });

  it('opens a party link without expanding its row', async () => {
    const { table, router } = mountTable({ events: [partyEvent()], columns: ['subject'], emptyDescription: '-' });

    await table.get('[data-testid="event-party-link"]').trigger('click');
    await flushPromises();

    expect(table.find('[data-testid="table-row-expand"]').exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe('/nodes/7');
  });

  it('expands only an event that carries detail', async () => {
    const { table } = mountTable({
      events: [event(), event({ id: 2, detail: { nodeKey: 'node-a-01' } })],
      columns: ['event'],
      emptyDescription: 'Nothing yet.',
    });

    const toggles = table.findAll('button[aria-expanded]');

    expect(toggles).toHaveLength(1);

    await toggles[0].trigger('click');

    expect(table.text()).toContain('node-a-01');
  });

  it('says it is empty once loaded with no events, and not while loading', async () => {
    const { table } = mountTable({ events: [], columns: ['when'], emptyDescription: 'Nothing yet.', loading: true });

    expect(table.text()).not.toContain('Nothing yet.');

    await table.setProps({ loading: false });

    expect(table.text()).toContain('Nothing yet.');
  });

  it('passes its toolbar and footer to the table', () => {
    const { table } = mountTable(
      { events: [event()], columns: ['when'], emptyDescription: 'Nothing yet.' },
      { toolbar: 'Filters', footer: 'Showing 1 event' }
    );

    expect(table.get('[data-testid="table-toolbar"]').text()).toBe('Filters');
    expect(table.get('[data-testid="table-footer"]').text()).toBe('Showing 1 event');
  });
});
