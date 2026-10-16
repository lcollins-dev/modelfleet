import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UserAvatar from './UserAvatar.vue';

describe('UserAvatar', () => {
  it('shows the first letter of the name in capitals', () => {
    const wrapper = mount(UserAvatar, {
      props: { user: { name: ' casey lee', email: 'jo@example.com', enabled: true } },
    });

    expect(wrapper.text()).toBe('C');
  });

  it('falls back to the email when the name is blank', () => {
    const wrapper = mount(UserAvatar, { props: { user: { name: '  ', email: 'jo@example.com', enabled: true } } });

    expect(wrapper.text()).toBe('J');
  });

  it('greys out a disabled user', () => {
    const enabled = mount(UserAvatar, { props: { user: { name: 'Jo', email: 'jo@example.com', enabled: true } } });
    const disabled = mount(UserAvatar, { props: { user: { name: 'Jo', email: 'jo@example.com', enabled: false } } });

    expect(enabled.classes()).toContain('bg-primary-soft');
    expect(disabled.classes()).toContain('bg-emphasis');
  });
});
