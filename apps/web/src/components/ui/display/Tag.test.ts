import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Tag from './Tag.vue';

describe('Tag', () => {
  it('gives its hint as the title and marks it with an info icon after its label', () => {
    const tag = mount(Tag, { props: { hint: 'The backend exited 1' }, slots: { default: 'Failed' } });

    expect(tag.attributes('title')).toBe('The backend exited 1');
    expect(tag.classes()).toEqual(expect.arrayContaining(['cursor-help', 'relative', 'z-2']));
    expect(tag.text()).toBe('Failed');
    expect(tag.find('[data-testid="tag-hint-icon"]').exists()).toBe(true);
  });

  it('shows no cue without a hint', () => {
    const tag = mount(Tag, { slots: { default: 'Running' } });

    expect(tag.text()).toBe('Running');
    expect(tag.attributes('title')).toBeUndefined();
    expect(tag.classes()).not.toContain('cursor-help');
    expect(tag.find('[data-testid="tag-hint-icon"]').exists()).toBe(false);
  });
});
