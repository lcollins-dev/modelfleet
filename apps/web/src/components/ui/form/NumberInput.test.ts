import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import NumberInput from './NumberInput.vue';

const mountInput = (props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) =>
  mount(NumberInput, { props: { value: null, ...props }, attrs });

type NumberInputWrapper = ReturnType<typeof mountInput>;

const field = (wrapper: NumberInputWrapper) => wrapper.get('input');

const shown = (wrapper: NumberInputWrapper) => field(wrapper).element.value;

const emitted = (wrapper: NumberInputWrapper) => wrapper.emitted('update:value');

describe('NumberInput', () => {
  it('shows its value, formatted to its precision', () => {
    const wrapper = mountInput({ value: 2, precision: 1 });

    expect(shown(wrapper)).toBe('2.0');
    expect(field(wrapper).attributes('role')).toBe('spinbutton');
    expect(field(wrapper).attributes('inputmode')).toBe('decimal');
  });

  it('emits a typed number at once and null for empty text', async () => {
    const wrapper = mountInput();

    await field(wrapper).setValue('12');
    await field(wrapper).setValue('');

    expect(emitted(wrapper)).toEqual([[12], [null]]);
  });

  it('keeps half-typed text without emitting until it reads as a number', async () => {
    const wrapper = mountInput({ value: 1 });

    await field(wrapper).setValue('1.');

    expect(shown(wrapper)).toBe('1.');
    expect(emitted(wrapper)).toBeUndefined();

    await field(wrapper).setValue('1.5');

    expect(emitted(wrapper)).toEqual([[1.5]]);
  });

  it('clamps and rounds what was typed when it settles on blur', async () => {
    const wrapper = mountInput({ min: 1, max: 8, precision: 0 });

    await field(wrapper).setValue('12');

    expect(emitted(wrapper)).toBeUndefined();

    await field(wrapper).trigger('blur');

    expect(emitted(wrapper)).toEqual([[8]]);
    expect(shown(wrapper)).toBe('8');
  });

  it('restores the value over text that is not a number on blur', async () => {
    const wrapper = mountInput({ value: 3 });

    await field(wrapper).setValue('abc');
    await field(wrapper).trigger('blur');

    expect(shown(wrapper)).toBe('3');
    expect(emitted(wrapper)).toBeUndefined();
  });

  it('steps by its step with the arrow keys and buttons, starting from min when empty', async () => {
    const wrapper = mountInput({ min: 0.5, step: 0.5 });

    await field(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await wrapper.setProps({ value: 0.5 });
    await wrapper.get('button[aria-label="Increase"]').trigger('click');
    await wrapper.setProps({ value: 1 });
    await field(wrapper).trigger('keydown', { key: 'ArrowDown' });

    expect(emitted(wrapper)).toEqual([[0.5], [1], [0.5]]);
  });

  it('disables a step past its bounds', () => {
    const wrapper = mountInput({ value: 1, min: 1, max: 1 });

    expect(wrapper.get('button[aria-label="Decrease"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[aria-label="Increase"]').attributes('disabled')).toBeDefined();
  });

  it('clears back to null when clearable', async () => {
    const wrapper = mountInput({ value: 4, clearable: true });

    await wrapper.get('button[aria-label="Clear"]').trigger('click');

    expect(emitted(wrapper)).toEqual([[null]]);
    expect(shown(wrapper)).toBe('');
  });

  it('takes a new value from outside', async () => {
    const wrapper = mountInput({ value: 4 });

    await wrapper.setProps({ value: 9 });

    expect(shown(wrapper)).toBe('9');
  });

  it('offers no buttons while disabled', () => {
    const wrapper = mountInput({ value: 4, clearable: true, disabled: true });

    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('puts its attributes on the input and its class on the box', () => {
    const wrapper = mountInput({}, { id: 'replicas-input', class: 'max-w-xs' });

    expect(field(wrapper).attributes('id')).toBe('replicas-input');
    expect(wrapper.classes()).toContain('max-w-xs');
  });
});
