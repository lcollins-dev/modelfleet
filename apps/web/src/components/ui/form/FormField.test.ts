import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { h, nextTick } from 'vue';

import { ValidationError } from '@/types/error';

import { useErrorStore } from '@/stores/error';

import Form from './Form.vue';
import FormField from './FormField.vue';
import { IFieldInputProps } from './fieldInput';

type Layout = 'stacked' | 'row';

const LAYOUTS: Layout[] = ['stacked', 'row'];

const mountWithInput = (layout: Layout, props: Record<string, string>) =>
  mount(FormField, {
    props: { label: 'Email', layout, ...props },
    slots: { default: ({ input }: { input: IFieldInputProps }) => h('input', input) },
  });

const NAME_TOO_SHORT = { name: { message: 'name must be longer than or equal to 2 characters' } };

const inForm = (layout: Layout, formName: string | null, props: Record<string, string>) =>
  mount({
    render: () =>
      h(Form, { name: formName }, () =>
        h(
          FormField,
          { label: 'Display name', layout, ...props },
          {
            default: ({ input }: { input: IFieldInputProps }) => h('input', input),
          }
        )
      ),
  });

beforeEach(() => {
  setActivePinia(createPinia());
});

describe.each(LAYOUTS)('FormField, %s', layout => {
  it('labels its input by id', () => {
    const wrapper = mountWithInput(layout, {});
    const input = wrapper.get('input');

    expect(input.attributes('id')).toBeTruthy();
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
  });

  it('describes the input by its help and leaves it valid without an error', () => {
    const wrapper = mountWithInput(layout, { help: 'Used to sign in.' });
    const input = wrapper.get('input');
    const helpId = input.attributes('aria-describedby');

    expect(helpId).toBeTruthy();
    expect(wrapper.get(`#${helpId}`).text()).toBe('Used to sign in.');
    expect(input.attributes('aria-invalid')).toBeUndefined();
  });

  it('marks the input invalid and describes it by its help and error', () => {
    const wrapper = mountWithInput(layout, { help: 'Used to sign in.', error: 'Enter a valid email address.' });
    const input = wrapper.get('input');
    const describedBy = (input.attributes('aria-describedby') ?? '').split(' ');

    expect(input.attributes('aria-invalid')).toBe('true');
    expect(describedBy).toHaveLength(2);
    expect(wrapper.get(`#${describedBy[0]}`).text()).toBe('Used to sign in.');
    expect(wrapper.get(`#${describedBy[1]}`).text()).toBe('Enter a valid email address.');
  });

  it('gives each instance in a page its own ids', () => {
    const field = () =>
      h(
        FormField,
        { label: 'Email', layout },
        { default: ({ input }: { input: IFieldInputProps }) => h('input', input) }
      );
    const wrapper = mount({ render: () => h('form', [field(), field()]) });
    const [first, second] = wrapper.findAll('input');

    expect(first.attributes('id')).not.toBe(second.attributes('id'));
  });

  it("shows the server's error for its path in its form", async () => {
    const wrapper = inForm(layout, 'profile', { path: 'name' });

    useErrorStore().setValidationError(new ValidationError('profile', NAME_TOO_SHORT));
    await nextTick();

    expect(wrapper.text()).toContain('name must be longer than or equal to 2 characters');
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
  });

  it('ignores an error sent by another form', async () => {
    const wrapper = inForm(layout, 'password', { path: 'name' });

    useErrorStore().setValidationError(new ValidationError('profile', NAME_TOO_SHORT));
    await nextTick();

    expect(wrapper.text()).not.toContain('name must be longer');
  });

  it("matches a form with no name to an error sent without one, and prefers the page's own error", async () => {
    const wrapper = inForm(layout, null, { path: 'name', error: 'Pick another name.' });

    useErrorStore().setValidationError(new ValidationError(null, NAME_TOO_SHORT));
    await nextTick();

    expect(wrapper.text()).toContain('Pick another name.');
    expect(wrapper.text()).not.toContain('name must be longer');
  });

  it('names its path for the validation toast while mounted', () => {
    const wrapper = inForm(layout, 'profile', { path: 'name' });

    expect(useErrorStore().getFormLabel('profile', 'name')).toBe('Display name');

    wrapper.unmount();

    expect(useErrorStore().getFormLabel('profile', 'name')).toBeUndefined();
  });
});

describe('FormField layout', () => {
  const field = (props: Record<string, string>) =>
    h(
      FormField,
      { label: 'Email', ...props },
      { default: ({ input }: { input: IFieldInputProps }) => h('input', input) }
    );

  const rootOf = (fieldProps: Record<string, string>, formProps: Record<string, string> | null = null) =>
    mount({
      render: () => (formProps === null ? field(fieldProps) : h(Form, formProps, () => field(fieldProps))),
    }).get('[data-testid="form-field"]');

  it('falls back to stacked outside a form, and to start in a row', () => {
    expect(rootOf({}).attributes('data-layout')).toBe('stacked');
    expect(rootOf({ layout: 'row' }).attributes('data-align')).toBe('start');
  });

  it("takes its form's layout and align", () => {
    const root = rootOf({}, { layout: 'row', align: 'end' });

    expect(root.attributes('data-layout')).toBe('row');
    expect(root.attributes('data-align')).toBe('end');
  });

  it("prefers its own props over its form's", () => {
    const root = rootOf({ layout: 'row', align: 'start' }, { layout: 'stacked', align: 'end' });

    expect(root.attributes('data-layout')).toBe('row');
    expect(root.attributes('data-align')).toBe('start');
  });

  it('keeps the error under the control when aligned to the end', () => {
    const root = rootOf({ layout: 'row', align: 'end', error: 'Try again.' });
    const control = root.get('input').element.parentElement;

    expect(control?.contains(root.get('[data-testid="field-error"]').element)).toBe(true);
  });
});

describe('FormField, rich content', () => {
  it('renders a rich label and help in place of the plain ones, still describing the input by the help', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Context size' },
      slots: {
        default: ({ input }: { input: IFieldInputProps }) => h('input', input),
        label: () => h('span', { 'data-testid': 'label' }, ['Context size', h('em', 'Overridden')]),
        help: () => h('code', { 'data-testid': 'help' }, 'ctx_size'),
      },
    });

    const helpId = wrapper.get('input').attributes('aria-describedby');

    expect(wrapper.get('label [data-testid="label"]').text()).toBe('Context sizeOverridden');
    expect(wrapper.get(`#${helpId} [data-testid="help"]`).text()).toBe('ctx_size');
  });
});

describe('FormField, stacked spacing', () => {
  it('leaves more room under a description than under a bare label', () => {
    const labelWith = (props: Record<string, string>) =>
      mountWithInput('stacked', props).get('label').element.parentElement?.className ?? '';

    expect(labelWith({ help: 'Used to sign in.' })).toContain('mb-2');
    expect(labelWith({})).toContain('mb-1');
  });
});
