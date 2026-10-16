import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Popover from './Popover.vue';

describe('Popover', () => {
  it('heads its content with the title and subtitle, handing the title id to its slot', () => {
    const wrapper = mount(Popover, {
      props: { title: 'Ann Lee', subtitle: 'ann@example.com' },
      slots: { default: '<p :data-labelledby="params.titleId">Body</p>' },
    });
    const body = wrapper.get('p');

    expect(wrapper.get(`[id="${body.attributes('data-labelledby')}"]`).text()).toBe('Ann Lee');
    expect(wrapper.text()).toBe('Ann Leeann@example.comBody');
  });

  it('leaves the head out without a title', () => {
    const wrapper = mount(Popover, { slots: { default: '<p :data-labelledby="params.titleId">Body</p>' } });

    expect(wrapper.text()).toBe('Body');
    expect(wrapper.get('p').attributes('data-labelledby')).toBeUndefined();
  });
});
