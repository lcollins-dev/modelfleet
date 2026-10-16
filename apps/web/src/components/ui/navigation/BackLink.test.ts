import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createWebHistory, createRouter } from 'vue-router';

import BackLink from './BackLink.vue';

const mountAt = async ([firstPath, ...laterPaths]: string[], props: Record<string, unknown> = {}) => {
  window.history.replaceState(null, '', '/');

  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  await router.replace(firstPath);

  for (const path of laterPaths) {
    await router.push(path);
  }

  const wrapper = mount(BackLink, {
    props: { to: '/nodes', label: 'Nodes', ...props },
    global: { plugins: [router] },
  });

  return { wrapper, router };
};

describe('UiBackLink', () => {
  it('links to its parent', async () => {
    const { wrapper } = await mountAt(['/nodes/1']);

    expect(wrapper.get('a').attributes('href')).toBe('/nodes');
    expect(wrapper.text()).toBe('Nodes');
  });

  it('returns through history where there is any', async () => {
    const { wrapper, router } = await mountAt(['/models/3', '/nodes/1']);
    const back = vi.spyOn(router, 'back');

    await wrapper.get('a').trigger('click');

    expect(back).toHaveBeenCalled();
  });

  it('falls back to its parent on a deep link', async () => {
    const { wrapper, router } = await mountAt(['/nodes/1']);

    await wrapper.get('a').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/nodes');
  });

  it('hands the click to onBack in place of navigating', async () => {
    const onBack = vi.fn();
    const { wrapper, router } = await mountAt(['/nodes/1'], { onBack });

    await wrapper.get('a').trigger('click');
    await flushPromises();

    expect(onBack).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/nodes/1');
  });
});
