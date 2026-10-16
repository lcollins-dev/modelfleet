import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import DangerCard from './DangerCard.vue';

const PROPS = {
  label: 'Disable node',
  help: 'The scheduler stops placing instances on node-a-01 until you enable it again.',
  actionLabel: 'Disable Node',
};

describe('MfDangerCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('names the action and its effect beside a danger button that reports a press', async () => {
    const card = mount(DangerCard, { props: PROPS });

    await card.get('button').trigger('click');

    expect(card.text()).toContain('Disable node');
    expect(card.text()).toContain('until you enable it again.');
    expect(card.get('button').text()).toBe('Disable Node');
    expect(card.classes()).toContain('border-error-line');
    expect(card.emitted('action')).toHaveLength(1);
  });

  it('reports no press while disabled', async () => {
    const card = mount(DangerCard, { props: { ...PROPS, disabled: true } });

    await card.get('button').trigger('click');

    expect(card.emitted('action')).toBeUndefined();
  });

  it('lists further rows below its own', () => {
    const card = mount(DangerCard, {
      props: PROPS,
      slots: { default: '<div data-testid="extra-row">Delete node</div>' },
    });

    expect(card.find('[data-testid="extra-row"]').exists()).toBe(true);
    expect(card.text().indexOf('Disable node')).toBeLessThan(card.text().indexOf('Delete node'));
  });
});
