import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Input from './Input.vue';

const mountInput = (props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) =>
  mount(Input, { props: { value: '', ...props }, attrs });

describe('Input', () => {
  it('emits each change of its value', async () => {
    const wrapper = mountInput();

    await wrapper.get('input').setValue('ann@example.com');

    expect(wrapper.emitted('update:value')).toEqual([['ann@example.com']]);
  });

  it('puts its attributes on the native input and its class on the wrapper', () => {
    const wrapper = mountInput({}, { id: 'email-input', name: 'email', 'aria-invalid': true, class: 'max-w-xs' });
    const input = wrapper.get('input');

    expect(input.attributes('id')).toBe('email-input');
    expect(input.attributes('name')).toBe('email');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.classes()).not.toContain('max-w-xs');
    expect(wrapper.classes()).toContain('max-w-xs');
  });

  it('hides a password until its toggle is pressed', async () => {
    const wrapper = mountInput({ type: 'password', value: 'secret' });
    const toggle = wrapper.get('button[aria-label="Show password"]');

    expect(wrapper.get('input').attributes('type')).toBe('password');

    await toggle.trigger('click');

    expect(wrapper.get('input').attributes('type')).toBe('text');
    expect(wrapper.get('button[aria-pressed="true"]').attributes('aria-label')).toBe('Hide password');
  });

  it('offers to clear a clearable input only while it holds a value', async () => {
    const wrapper = mountInput({ clearable: true });

    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);

    await wrapper.setProps({ value: 'Ann' });
    await wrapper.get('button[aria-label="Clear"]').trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([['']]);
  });

  it('offers no clear button while read-only', () => {
    const wrapper = mountInput({ clearable: true, readonly: true, value: 'ann@example.com' });

    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);
  });

  it('refuses an edit its allowInput rejects, keeping the text as it was', async () => {
    const wrapper = mountInput({ value: '12', allowInput: (text: string) => /^\d*$/.test(text) });

    await wrapper.get('input').setValue('12a');

    expect(wrapper.get('input').element.value).toBe('12');
    expect(wrapper.emitted('update:value')).toBeUndefined();

    await wrapper.get('input').setValue('123');

    expect(wrapper.emitted('update:value')).toEqual([['123']]);
  });

  it('shows a prefix before the input', () => {
    const wrapper = mount(Input, { props: { value: '' }, slots: { prefix: 'From' } });

    expect(wrapper.text()).toBe('From');
  });

  it('mutes an empty date and time until one is picked', async () => {
    const wrapper = mountInput({ type: 'datetime-local' });

    expect(wrapper.get('input').attributes('type')).toBe('datetime-local');
    expect(wrapper.get('input').classes()).toContain('text-muted');

    await wrapper.setProps({ value: '2026-10-14T09:00' });

    expect(wrapper.get('input').classes()).not.toContain('text-muted');
  });
});
