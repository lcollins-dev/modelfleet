import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { EventDto, ListApiKeyDto } from '@libs/dto';
import { ApiKeyListStatus, EventPartyType, EventSeverity, EventType, UserRoleId } from '@libs/dto';

import { Config } from '@/Config';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import Index from './Index.vue';

const getApiKeyList = vi.fn();
const getApiKeyStats = vi.fn();
const revokeApiKey = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/ApiKeyAdminService', () => ({
  useApiKeyAdminService: () => ({ getApiKeyList, getApiKeyStats, revokeApiKey }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const listApiKey = (id: number, name: string, overrides: Partial<ListApiKeyDto> = {}): ListApiKeyDto => ({
  id,
  keyId: `0123456789abcdef0123456${id}`,
  name,
  ownerId: 1,
  ownerName: 'Ada Whitfield',
  lastUsedDate: null,
  revokedDate: null,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
  ...overrides,
});

const mountIndex = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/api-keys');

  const wrapper = mount(Index, { global: { plugins: [router] } });
  await flushPromises();

  return wrapper;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getApiKeyList.mockResolvedValue({
    apiKeyList: [
      listApiKey(1, 'support-chat', { lastUsedDate: new Date() }),
      listApiKey(2, 'old-laptop', { ownerName: undefined, revokedDate: new Date('2026-10-01T12:00:00.000Z') }),
    ],
    pages: 1,
  });
  getApiKeyStats.mockResolvedValue({ total: 5, active: 3, revoked: 2 });
  revokeApiKey.mockResolvedValue(undefined);
  streamEvents.mockImplementation(() => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('API keys page', () => {
  it('lists each key with its identifier, state, owner and last use, out of the fleet total', async () => {
    const wrapper = await mountIndex();

    const rows = wrapper.findAll('[data-testid="api-key-row"]');

    expect(rows[0].text()).toContain('support-chat');
    expect(rows[0].text()).toContain('mfk_0123456789abcdef01234561');
    expect(rows[0].text()).toContain('Active');
    expect(rows[0].text()).toContain('Ada Whitfield');
    expect(rows[0].text()).toContain('Revoke');

    expect(rows[1].text()).toContain('Revoked');
    expect(rows[1].text()).toContain('Deleted user');
    expect(rows[1].text()).toContain('Never');
    expect(rows[1].find('button').exists()).toBe(false);

    expect(wrapper.get('[data-testid="active-keys"]').text()).toContain('of 5');
    expect(wrapper.get('[data-testid="active-keys"]').text()).toContain('2 revoked');
    expect(wrapper.get('[data-testid="api-key-count"]').text()).toBe('Showing 2 of 5 keys');
  });

  it('links an owner to their page for a user admin, leaving a deleted owner plain', async () => {
    useUserStore().setProfile({
      name: 'Ann Lee',
      email: 'ann@example.com',
      userRoleIds: [UserRoleId.SYSTEM_ADMIN, UserRoleId.USER_ADMIN],
      mustChangePassword: false,
    });

    const wrapper = await mountIndex();

    const rows = wrapper.findAll('[data-testid="api-key-row"]');

    expect(rows[0].get('[data-testid="api-key-owner-link"]').attributes('href')).toBe('/users/1');
    expect(rows[1].find('[data-testid="api-key-owner-link"]').exists()).toBe(false);
  });

  it('names an owner without a link for a viewer who cannot open users', async () => {
    const wrapper = await mountIndex();

    expect(wrapper.text()).toContain('Ada Whitfield');
    expect(wrapper.find('[data-testid="api-key-owner-link"]').exists()).toBe(false);
  });

  it('narrows to revoked keys', async () => {
    const wrapper = await mountIndex();

    await wrapper.get('[role="radio"]:nth-child(3)').trigger('click');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(getApiKeyList).toHaveBeenLastCalledWith({ status: ApiKeyListStatus.REVOKED }, 1);
  });

  it('says there are no keys yet, leaving creation to the heading, and says when a search matches none', async () => {
    getApiKeyList.mockResolvedValue({ apiKeyList: [], pages: 1 });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toContain('No API keys yet.');
    expect(wrapper.find('[data-testid="table-empty"]').findAll('a, button')).toHaveLength(0);
    expect(wrapper.find('a[href="/api-keys/create"]').exists()).toBe(true);

    await wrapper.get('input').setValue('chat');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No keys match your search.');
  });

  it('revokes a key once confirmed, then refreshes the list and the totals', async () => {
    const wrapper = await mountIndex();

    await wrapper.get('[data-testid="api-key-row"] button').trigger('click');

    const dialog = useDialogStore().top;

    expect(dialog?.options.title).toBe('Revoke support-chat?');
    expect(revokeApiKey).not.toHaveBeenCalled();

    await dialog?.options.action?.();
    await flushPromises();

    expect(revokeApiKey).toHaveBeenCalledWith(1);
    expect(getApiKeyList).toHaveBeenCalledTimes(2);
    expect(getApiKeyStats).toHaveBeenCalledTimes(2);
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Key revoked');
  });

  it('refreshes the list and the totals on a key event', async () => {
    await mountIndex();

    const onEvent = streamEvents.mock.calls[0][0] as (event: EventDto) => void;

    onEvent({
      id: 1,
      type: EventType.API_KEY_CREATED,
      severity: EventSeverity.INFO,
      subjectType: EventPartyType.API_KEY,
      subjectId: '3',
      message: 'Created API key nightly-eval',
      detail: {},
      createdDate: new Date(),
    });
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(getApiKeyList).toHaveBeenCalledTimes(2);
    expect(getApiKeyStats).toHaveBeenCalledTimes(2);
  });
});
