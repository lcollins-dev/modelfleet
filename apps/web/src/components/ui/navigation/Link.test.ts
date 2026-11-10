import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import Link from './Link.vue';

const mountLink = (props: Record<string, unknown>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  return mount(Link, {
    props: { to: '/models/9', ...props },
    slots: { default: 'llama-70b' },
    global: { plugins: [router] },
  });
};

describe('UiLink', () => {
  it('reads in the heading colour with its underline and arrow', () => {
    const link = mountLink({});

    expect(link.classes()).toEqual(expect.arrayContaining(['text-header', 'border-b']));
    expect(link.find('svg').exists()).toBe(true);
  });

  it('keeps its underline and arrow in the muted colour when muted', () => {
    const link = mountLink({ muted: true });

    expect(link.classes()).toEqual(expect.arrayContaining(['text-muted', 'border-b']));
    expect(link.classes()).not.toContain('text-header');
    expect(link.find('svg').exists()).toBe(true);
  });
});
