import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { EventDto } from '@libs/dto';
import { EventPartyType, EventSeverity, EventType, NodeState } from '@libs/dto';

import { useNotificationStore } from '@/stores/notification';

import Register from './Register.vue';

const registerNode = vi.fn();
const getNode = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ registerNode, getNode }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const close = vi.fn();

const REGISTERED = { id: 7, name: 'gpu-c-03', nodeKey: '9a23f28d-f575-4f39-b4a1-697da34ffcf4', secret: 'mfn_s3cret' };

const mountRegister = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/nodes/register');

  const wrapper = mount(Register, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

const register = async (wrapper: Awaited<ReturnType<typeof mountRegister>>['wrapper']) => {
  const [nameInput, descriptionInput] = wrapper.findAll('input');

  await nameInput.setValue(' gpu-c-03 ');
  await descriptionInput.setValue('Rack 4');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
};

const buttonNamed = (wrapper: Awaited<ReturnType<typeof mountRegister>>['wrapper'], label: string) => {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === label);

  if (button === undefined) {
    throw new Error(`No button named ${label}`);
  }

  return button;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });

  registerNode.mockResolvedValue(REGISTERED);
  streamEvents.mockImplementation(() => ({ connected: ref(true), lastActivityDate: ref(null), close }));
});

describe('Register node page', () => {
  it('registers the node under its form and shows the credentials once, ready for the agent', async () => {
    const { wrapper } = await mountRegister();

    await register(wrapper);

    expect(registerNode).toHaveBeenCalledWith({ name: 'gpu-c-03', description: 'Rack 4' }, 'register-node');

    const dialog = wrapper.get('dialog');

    expect(dialog.text()).toContain('The secret is shown once.');
    expect(dialog.get('[data-testid="node-key"]').text()).toBe(REGISTERED.nodeKey);
    expect(dialog.get('[data-testid="node-secret"]').text()).toBe('mfn_s3cret');
    expect(dialog.get('pre').text()).toBe(`NODE_KEY=${REGISTERED.nodeKey}\nNODE_SECRET=mfn_s3cret`);
    expect(dialog.get('[data-testid="agent-state"]').text()).toBe('Waiting for the agent to check in...');

    wrapper.unmount();
  });

  it('notices the agent checking in while the credentials are open', async () => {
    const { wrapper } = await mountRegister();

    await register(wrapper);

    getNode.mockResolvedValue({ id: 7, state: NodeState.ONLINE });

    const onEvent = streamEvents.mock.calls[0][0] as (event: EventDto) => void;

    onEvent({
      id: 1,
      type: EventType.NODE_CONNECTED,
      severity: EventSeverity.INFO,
      subjectType: EventPartyType.NODE,
      subjectId: '7',
      message: 'Node gpu-c-03 connected',
      detail: {},
      createdDate: new Date(),
    });
    await flushPromises();

    expect(getNode).toHaveBeenCalledWith(7);
    expect(wrapper.get('[data-testid="agent-state"]').text()).toBe('The agent has checked in.');

    wrapper.unmount();
  });

  it('returns to the list with a toast once done, and stops watching for the agent', async () => {
    const { wrapper, router } = await mountRegister();

    await register(wrapper);

    await buttonNamed(wrapper, 'Done').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/nodes');
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Node registered');

    wrapper.unmount();

    expect(close).toHaveBeenCalled();
  });

  it('opens the node instead when asked', async () => {
    const { wrapper, router } = await mountRegister();

    await register(wrapper);

    await buttonNamed(wrapper, 'Open Node').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/nodes/7');

    wrapper.unmount();
  });
});
