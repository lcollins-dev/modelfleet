import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Textarea from './Textarea.vue';

describe('Textarea', () => {
  it('binds its value both ways', async () => {
    const wrapper = mount(Textarea, { props: { value: 'one' } });

    expect(wrapper.get('textarea').element.value).toBe('one');

    await wrapper.get('textarea').setValue('one\ntwo');

    expect(wrapper.emitted('update:value')).toEqual([['one\ntwo']]);
  });

  it('starts at its rows', () => {
    const wrapper = mount(Textarea, { props: { rows: 5 } });

    expect(wrapper.get('textarea').attributes('rows')).toBe('5');
  });

  it('sets code in mono without spellcheck', () => {
    const wrapper = mount(Textarea, { props: { code: true } });

    expect(wrapper.get('textarea').classes()).toContain('font-mono');
    expect(wrapper.get('textarea').attributes('spellcheck')).toBe('false');
  });

  it('resizes to the grip drag and keeps that height as its text grows', async () => {
    const wrapper = mount(Textarea, { props: { value: '' }, attachTo: document.body });
    const element = wrapper.get('textarea').element;

    Object.defineProperty(element, 'offsetHeight', { configurable: true, get: () => 100 });

    wrapper
      .get('[data-testid="textarea-grip"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 260 }));
    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(element.style.height).toBe('160px');

    await wrapper.setProps({ value: 'grown' });

    expect(element.style.height).toBe('160px');

    wrapper.unmount();
  });

  it('stops the grip drag below its minimum height', () => {
    const wrapper = mount(Textarea, { attachTo: document.body });
    const element = wrapper.get('textarea').element;

    Object.defineProperty(element, 'offsetHeight', { configurable: true, get: () => 100 });

    wrapper
      .get('[data-testid="textarea-grip"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(element.style.height).toBe('52px');

    wrapper.unmount();
  });

  it('hides the grip while disabled', () => {
    const wrapper = mount(Textarea, { props: { disabled: true } });

    expect(wrapper.find('[data-testid="textarea-grip"]').exists()).toBe(false);
  });

  it('counts its characters against maxLength', async () => {
    const wrapper = mount(Textarea, { props: { value: 'hello', maxLength: 280 } });

    expect(wrapper.get('textarea').attributes('maxlength')).toBe('280');
    expect(wrapper.get('[data-testid="textarea-count"]').text()).toBe('5/280');

    await wrapper.setProps({ value: 'hello world' });

    expect(wrapper.get('[data-testid="textarea-count"]').text()).toBe('11/280');
  });

  it('shows no count without maxLength', () => {
    const wrapper = mount(Textarea);

    expect(wrapper.find('[data-testid="textarea-count"]').exists()).toBe(false);
  });

  it('passes its attributes to the textarea and its class to the frame', () => {
    const wrapper = mount(Textarea, { attrs: { id: 'flags-input', 'aria-invalid': true, class: 'sm:col-span-2' } });

    expect(wrapper.get('textarea').attributes('id')).toBe('flags-input');
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true');
    expect(wrapper.classes()).toContain('sm:col-span-2');
    expect(wrapper.get('textarea').classes()).not.toContain('sm:col-span-2');
  });
});
