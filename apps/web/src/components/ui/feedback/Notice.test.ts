import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Notice from './Notice.vue';

describe('Notice', () => {
  it('announces its title and text as an alert', () => {
    const wrapper = mount(Notice, {
      props: { type: 'warning', title: 'Your settings start over' },
      slots: { default: 'Saved preferences on this device will be lost.' },
    });

    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.text()).toBe('Your settings start overSaved preferences on this device will be lost.');
  });

  it('leaves the title out when it has none', () => {
    const wrapper = mount(Notice, { props: { type: 'error' }, slots: { default: 'This account is disabled.' } });

    expect(wrapper.text()).toBe('This account is disabled.');
  });

  it('shows its action beneath the text', () => {
    const wrapper = mount(Notice, { slots: { default: 'Text', action: '<button>Retry</button>' } });

    expect(wrapper.get('button').text()).toBe('Retry');
  });
});
