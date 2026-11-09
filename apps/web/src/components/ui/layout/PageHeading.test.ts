import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import PageHeading from './PageHeading.vue';
import { IPageOptions, usePage } from '@/composables/usePage';

const PAGE = { template: '<div />' };

const mountPage = async (path: string, options: IPageOptions, slots: Record<string, () => string> = {}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/nodes', component: PAGE },
      { path: '/nodes/:nodeId', component: PAGE },
    ],
  });
  await router.push(path);

  return mount(
    defineComponent({
      setup() {
        usePage(options);

        return () => h(PageHeading, null, slots);
      },
    }),
    { global: { plugins: [router] } }
  );
};

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('UiPageHeading', () => {
  it('titles the page with the title and subtitle the page declares', async () => {
    const wrapper = await mountPage('/nodes', { title: 'Nodes', subtitle: 'Machines running the agent.' });

    expect(wrapper.get('h1').text()).toBe('Nodes');
    expect(wrapper.get('p').text()).toBe('Machines running the agent.');
  });

  it('leaves out the subtitle where the page declares none', async () => {
    const wrapper = await mountPage('/nodes', { title: 'Nodes' });

    expect(wrapper.find('p').exists()).toBe(false);
  });

  it('renders a rich title in place of the plain one', async () => {
    const wrapper = await mountPage(
      '/nodes/1',
      { title: 'node-a-01', back: '/nodes' },
      { title: () => '<span class="font-mono">node-a-01</span>' }
    );

    expect(wrapper.get('h1').html()).toContain('font-mono');
  });

  it('leads back from a page with a back route, and not from one without', async () => {
    const child = await mountPage('/nodes/1', { title: 'node-a-01', back: '/nodes' });
    const top = await mountPage('/nodes', { title: 'Nodes' });

    expect(child.get('a').attributes('href')).toBe('/nodes');
    expect(top.find('a').exists()).toBe(false);
  });
});
