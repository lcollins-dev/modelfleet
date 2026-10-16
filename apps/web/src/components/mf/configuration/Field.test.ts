import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendField, BackendFieldType, ModelType } from '@libs/backends';

import { ConfigurationFormValue, readFieldValues, writeFieldValues } from '@/utils/configuration/fields';

import { UiInput, UiNumberInput } from '@/components/ui';

import Field from './Field.vue';
import ModelReference from './ModelReference.vue';

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList: vi.fn().mockResolvedValue({ modelList: [], pages: 1 }) }),
}));

const FINGERPRINT = 'a'.repeat(64);

const field = (overrides: Partial<BackendField>): BackendField =>
  ({
    name: 'mmproj',
    label: 'Projector',
    description: 'The projector this model reads images with.',
    group: 'multimodal',
    type: BackendFieldType.MODEL_REFERENCE,
    modelType: ModelType.PROJECTOR,
    ...overrides,
  }) as BackendField;

const render = (given: BackendField, modelValue: string | number | boolean | null = null) =>
  mount(Field, {
    props: { field: given, modelValue },
  });

describe('MfConfigurationField', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders a model reference as the catalogue picker, not a text box', () => {
    const wrapper = render(field({}), FINGERPRINT);

    expect(wrapper.findComponent(ModelReference).exists()).toBe(true);
    expect(wrapper.findComponent(UiInput).exists()).toBe(false);
  });

  it('hands the picker the type the field declares', () => {
    const wrapper = render(field({}));

    expect(wrapper.findComponent(ModelReference).props('modelType')).toBe(ModelType.PROJECTOR);
  });

  it('shows the default text it is given in place of the declared default', () => {
    const wrapper = mount(Field, {
      props: {
        field: field({ name: 'image', type: BackendFieldType.TEXT }),
        modelValue: null,
        defaultText: 'engine:cuda on NVIDIA GPUs, engine:cpu on CPU only',
      },
    });

    expect(wrapper.findComponent(UiInput).props('placeholder')).toBe(
      'Default: engine:cuda on NVIDIA GPUs, engine:cpu on CPU only'
    );
  });

  it('leaves the other field types on the controls they already used', () => {
    const text = render(field({ name: 'chatTemplate', type: BackendFieldType.TEXT }));
    const integer = render(field({ name: 'threads', type: BackendFieldType.INTEGER }));
    const choice = render(field({ name: 'splitMode', type: BackendFieldType.CHOICE, choices: ['none', 'layer'] }));

    expect(text.findComponent(ModelReference).exists()).toBe(false);
    expect(text.findComponent(UiInput).exists()).toBe(true);
    expect(integer.findComponent(UiNumberInput).exists()).toBe(true);
    expect(choice.findComponent({ name: 'Select' }).exists()).toBe(true);
  });

  describe('a list field', () => {
    const tensorSplit = field({ name: 'tensorSplit', type: BackendFieldType.NUMBER_LIST });
    const tensorOverrides = field({ name: 'tensorOverrides', type: BackendFieldType.TEXT_LIST });

    /** Hands the update back the way the editor does, through the document, so it returns parsed. */
    const typeInto = async (wrapper: ReturnType<typeof render>, given: BackendField, text: string) => {
      const before = wrapper.emitted('update:modelValue')?.length ?? 0;

      await wrapper.find(given.type === BackendFieldType.TEXT_LIST ? 'textarea' : 'input').setValue(text);

      const emitted = wrapper.emitted<[ConfigurationFormValue]>('update:modelValue') ?? [];

      if (emitted.length === before) {
        return;
      }

      const next = emitted[emitted.length - 1][0];
      const saved = writeFieldValues([given], { [given.name]: next })[given.name];
      const document = saved === undefined ? {} : { [given.name]: saved };

      await wrapper.setProps({ modelValue: readFieldValues([given], document)[given.name] });
    };

    const control = (wrapper: ReturnType<typeof render>, selector: string): HTMLInputElement =>
      wrapper.find(selector).element as HTMLInputElement;

    it('reads as typed at every keystroke, saving the parsed list', async () => {
      const wrapper = render(tensorSplit);
      const typed = '0.9, 1, 1, 1';

      for (let i = 1; i <= typed.length; i++) {
        await typeInto(wrapper, tensorSplit, typed.slice(0, i));

        expect(control(wrapper, 'input').value).toBe(typed.slice(0, i));
      }

      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['0.9, 1, 1, 1']);
    });

    it('keeps a new line typed into a text list', async () => {
      const wrapper = render(tensorOverrides);

      await typeInto(wrapper, tensorOverrides, 'token_embd.weight=CPU\n');

      expect(control(wrapper, 'textarea').value).toBe('token_embd.weight=CPU\n');
    });

    it('rewrites the text as the parsed list on blur', async () => {
      const wrapper = render(tensorSplit);

      await typeInto(wrapper, tensorSplit, '0.9,1 ,1,');
      await wrapper.find('input').trigger('blur');

      expect(control(wrapper, 'input').value).toBe('0.9, 1, 1');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['0.9, 1, 1']);
    });

    it('drops blank lines from a text list on blur', async () => {
      const wrapper = render(tensorOverrides);

      await typeInto(wrapper, tensorOverrides, '  token_embd.weight=CPU\n\n');
      await wrapper.find('textarea').trigger('blur');

      expect(control(wrapper, 'textarea').value).toBe('token_embd.weight=CPU');
    });

    it('refuses a character a number list cannot hold', async () => {
      const wrapper = render(tensorSplit, '0.9');

      await typeInto(wrapper, tensorSplit, '0.9, a');

      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      expect(control(wrapper, 'input').value).toBe('0.9');
    });

    it('takes a negative entry', async () => {
      const wrapper = render(tensorSplit);

      await typeInto(wrapper, tensorSplit, '-1, 2');

      expect(control(wrapper, 'input').value).toBe('-1, 2');
    });

    it('lets a non-number the YAML set be edited away, but not added to', async () => {
      const wrapper = render(tensorSplit, '0.5, auto');

      await typeInto(wrapper, tensorSplit, '0.5, autox');

      expect(control(wrapper, 'input').value).toBe('0.5, auto');

      await typeInto(wrapper, tensorSplit, '0.5, aut');

      expect(control(wrapper, 'input').value).toBe('0.5, aut');
    });

    it('keeps the typed text when the same list arrives from outside', async () => {
      const wrapper = render(tensorSplit);

      await typeInto(wrapper, tensorSplit, '1,');
      await wrapper.setProps({ modelValue: '1' });

      expect(control(wrapper, 'input').value).toBe('1,');
    });

    it('shows a value set from outside, such as a preset or a reset', async () => {
      const wrapper = render(tensorSplit);

      await typeInto(wrapper, tensorSplit, '1,');
      await wrapper.setProps({ modelValue: '0.5, 0.5' });

      expect(control(wrapper, 'input').value).toBe('0.5, 0.5');

      await wrapper.setProps({ modelValue: null });

      expect(control(wrapper, 'input').value).toBe('');
    });
  });
});
