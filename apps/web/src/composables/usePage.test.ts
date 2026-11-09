import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';

import { usePageStore } from '@/stores/page';

import { IPageOptions, usePage } from './usePage';

const PAGE = { template: '<div />' };

const mountPage = async (path: string, options: IPageOptions) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: PAGE }],
  });
  await router.push(path);

  const wrapper = mount(
    defineComponent({
      setup() {
        usePage(options);

        return () => null;
      },
    }),
    { global: { plugins: [router] } }
  );

  return { wrapper, router };
};

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('usePage', () => {
  it('registers the page against its path as it sets up', async () => {
    await mountPage('/nodes/register', { title: 'Register node', back: '/nodes', transient: true });

    expect(usePageStore().pageAt('/nodes/register')).toEqual({
      title: 'Register node',
      subtitle: undefined,
      back: '/nodes',
      transient: true,
    });
  });

  it('follows a title that arrives with the data', async () => {
    const name = ref('');

    await mountPage('/nodes/1', { title: () => name.value, back: '/nodes' });

    name.value = 'node-a-01';
    await flushPromises();

    expect(usePageStore().pageAt('/nodes/1')?.title).toBe('node-a-01');
  });

  it('stores a back getter as the path it gives', async () => {
    const deploymentId = ref(4);

    await mountPage('/deployments/4/instance/abc', {
      title: 'Instance abc',
      back: () => `/deployments/${deploymentId.value}`,
    });

    expect(usePageStore().pageAt('/deployments/4/instance/abc')?.back).toBe('/deployments/4');
  });

  it('keeps the entry once the page is gone, so a back link can still label it', async () => {
    const { wrapper } = await mountPage('/nodes/1', { title: 'node-a-01' });

    wrapper.unmount();

    expect(usePageStore().pageAt('/nodes/1')?.title).toBe('node-a-01');
  });

  it('registers again under the new path when only the params change', async () => {
    const name = ref('node-a-01');
    const { router } = await mountPage('/nodes/1', { title: () => name.value });

    await router.push('/nodes/2');
    name.value = 'node-b-02';
    await flushPromises();

    expect(usePageStore().pageAt('/nodes/1')?.title).toBe('node-a-01');
    expect(usePageStore().pageAt('/nodes/2')?.title).toBe('node-b-02');
  });

  it('never registers under the page it leaves for', async () => {
    const name = ref('node-a-01');

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/nodes/:nodeId',
          component: defineComponent({
            setup() {
              usePage({ title: () => name.value });

              return () => null;
            },
          }),
        },
        { path: '/models', component: PAGE },
      ],
    });
    await router.push('/nodes/1');

    mount(RouterView, { global: { plugins: [router] } });

    await router.push('/models');
    name.value = 'node-b-02';
    await flushPromises();

    expect(usePageStore().pageAt('/models')).toBeUndefined();
    expect(usePageStore().pageAt('/nodes/1')?.title).toBe('node-a-01');
  });
});
