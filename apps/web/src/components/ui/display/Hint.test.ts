import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Hint from './Hint.vue';

describe('Hint', () => {
  it('gives its text as the title, with the underline and help cursor', () => {
    const hint = mount(Hint, { props: { text: 'node-a, node-b' }, slots: { default: '2' } });

    expect(hint.text()).toBe('2');
    expect(hint.attributes('title')).toBe('node-a, node-b');
    expect(hint.classes()).toEqual(expect.arrayContaining(['cursor-help', 'relative', 'z-2', 'decoration-dotted']));
  });

  it('renders the value plain without text', () => {
    const hint = mount(Hint, { slots: { default: '2' } });

    expect(hint.text()).toBe('2');
    expect(hint.attributes('title')).toBeUndefined();
    expect(hint.classes()).toEqual([]);
  });
});
