import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendId } from '@libs/backends';
import type { DeploymentConfigurationDto } from '@libs/dto';
import { ActivationPolicy, ConfigurationSource } from '@libs/dto';

import Editor from './Editor.vue';

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNodeList: vi.fn().mockResolvedValue({ nodeList: [], pages: 1 }) }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getNodeTelemetryStatus: vi.fn() }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ previewPlacement: vi.fn() }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList: vi.fn().mockResolvedValue({ modelList: [], pages: 1 }) }),
}));

const EFFECTIVE: DeploymentConfigurationDto = {
  backend: BackendId.LLAMA_CPP,
  entries: [{ key: 'replicas', value: 2, source: ConfigurationSource.DEPLOYMENT, modelled: true }],
  configuration: { replicas: 2 },
  presetId: null,
  presetName: null,
};

const render = (props: Record<string, unknown> = {}) =>
  mount(Editor, {
    props: {
      modelValue: 'replicas: 2\n',
      activationPolicy: ActivationPolicy.ALWAYS,
      backend: BackendId.LLAMA_CPP,
      hasPreset: false,
      modelId: null,
      presetId: null,
      ...props,
    },
    attachTo: document.body,
  });

type EditorWrapper = ReturnType<typeof render>;

const views = (wrapper: EditorWrapper) => wrapper.findAll('[role="radiogroup"]')[0].findAll('[role="radio"]');

const pickView = async (wrapper: EditorWrapper, label: string) => {
  await views(wrapper)
    .find(view => view.text() === label)
    ?.trigger('click');
};

describe('MfConfigurationEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('offers the applied view only once the deployment has an effective configuration', async () => {
    const wrapper = render();

    expect(views(wrapper).map(view => view.text())).toEqual(['Form', 'YAML']);

    await wrapper.setProps({ effective: EFFECTIVE });

    expect(views(wrapper).map(view => view.text())).toEqual(['Form', 'YAML', 'Applied']);
  });

  it('reads the replicas out of the document and writes an edit back into it', async () => {
    const wrapper = render();
    await flushPromises();

    const replicas = wrapper.get('input[role="spinbutton"]');

    expect(replicas.element).toHaveProperty('value', '2');

    await replicas.setValue('3');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['replicas: 3\n']);
  });

  it('edits the document as YAML', async () => {
    const wrapper = render();

    await pickView(wrapper, 'YAML');
    await wrapper.get('textarea').setValue('replicas: 4\n');

    expect(wrapper.emitted('update:modelValue')).toEqual([['replicas: 4\n']]);
  });

  it('stands the form aside for a document that is not a mapping', () => {
    const wrapper = render({ modelValue: '- not\n- a mapping\n' });

    expect(wrapper.text()).toContain('This document contains invalid YAML');
    expect(wrapper.find('input[role="spinbutton"]').exists()).toBe(false);
  });

  it('leaves the backend to the details card', () => {
    const wrapper = render();

    const labels = wrapper.findAll('[data-testid="form-field"]').map(field => field.text());

    expect(labels.some(label => label.startsWith('Backend'))).toBe(false);
  });

  it('shows the idle timeout only for an on-demand deployment', async () => {
    const wrapper = render();

    expect(wrapper.text()).not.toContain('Idle timeout');

    await wrapper.setProps({ activationPolicy: ActivationPolicy.ON_DEMAND });

    expect(wrapper.text()).toContain('Idle timeout');
  });

  it('shows the applied configuration in its own view', async () => {
    const wrapper = render({ effective: EFFECTIVE });

    await pickView(wrapper, 'Applied');

    expect(wrapper.get('[data-testid="effective-entry"]').text()).toContain('Replicas');
  });

  it('closes the card with the footer it is given', () => {
    const wrapper = mount(Editor, {
      props: {
        modelValue: '',
        activationPolicy: ActivationPolicy.ALWAYS,
        backend: BackendId.LLAMA_CPP,
        hasPreset: false,
        modelId: null,
        presetId: null,
      },
      slots: { footer: '<button>Save Changes</button>' },
    });

    expect(wrapper.text()).toContain('Save Changes');
  });
});
