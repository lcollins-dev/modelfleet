import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import IdentityPill from './IdentityPill.vue';

describe('IdentityPill', () => {
  it('shows the identity and emits change from its action', async () => {
    const wrapper = mount(IdentityPill, { slots: { default: 'sam@example.com' } });

    expect(wrapper.find('[data-testid="identity"]').text()).toBe('sam@example.com');

    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('change')).toHaveLength(1);
  });

  it('disables its action', () => {
    const wrapper = mount(IdentityPill, { props: { disabled: true }, slots: { default: 'sam@example.com' } });

    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });
});
