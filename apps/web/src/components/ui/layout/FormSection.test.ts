import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FormSection from './FormSection.vue';

describe('UiFormSection', () => {
  it('heads its fields with its title and subtitle', () => {
    const wrapper = mount(FormSection, {
      props: { title: 'Source', subtitle: 'Where the weights come from.' },
      slots: { default: '<input data-testid="field" />' },
    });

    expect(wrapper.get('h3').text()).toBe('Source');
    expect(wrapper.get('p').text()).toBe('Where the weights come from.');
    expect(wrapper.find('[data-testid="field"]').exists()).toBe(true);
  });

  it('leaves out the heading it is not given', () => {
    const wrapper = mount(FormSection, { slots: { default: '<input />' } });

    expect(wrapper.find('h3').exists()).toBe(false);
    expect(wrapper.find('p').exists()).toBe(false);
  });
});
