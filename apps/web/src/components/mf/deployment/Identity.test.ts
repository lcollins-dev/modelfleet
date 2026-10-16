import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendId } from '@libs/backends';
import { ModelFormat, ModelType } from '@libs/dto';

import Identity from './Identity.vue';

const getModelList = vi.fn().mockResolvedValue({ modelList: [], pages: 1 });

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList, getModel: vi.fn().mockRejectedValue(new Error('gone')) }),
}));

const getPresetList = vi.fn().mockResolvedValue({ presetList: [], pages: 1 });

vi.mock('@/services/api/admin/PresetAdminService', () => ({
  usePresetAdminService: () => ({ getPresetList }),
}));

const STANDARD = { id: 4, name: 'Standard', backend: BackendId.VLLM, description: null, deployments: 0 };

describe('MfDeploymentIdentity', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('leads with the serving name and preset, then the backend beside the model', () => {
    const wrapper = mount(Identity, {
      props: { name: '', description: '', modelId: null, presetId: null, backend: BackendId.LLAMA_CPP },
    });

    const labels = wrapper.findAll('[data-testid="form-field"] label').map(label => label.text());

    expect(labels).toEqual(['Serving name', 'Preset', 'Backend', 'Model', 'Description']);
  });

  it('takes the backend from a picked preset and holds it there, naming the preset', async () => {
    getPresetList.mockResolvedValueOnce({ presetList: [STANDARD], pages: 1 });

    const wrapper = mount(Identity, {
      props: { name: '', description: '', modelId: null, presetId: null, backend: BackendId.LLAMA_CPP },
    });
    await flushPromises();

    const presetSelect: VueWrapper | undefined = wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.props('placeholder') === 'No preset');

    presetSelect?.vm.$emit('update:value', '4');

    expect(wrapper.emitted('update:backend')).toEqual([[BackendId.VLLM]]);

    await wrapper.setProps({ presetId: 4, backend: BackendId.VLLM, presetName: 'Standard' });

    const backendField = wrapper
      .findAll('[data-testid="form-field"]')
      .find(field => field.text().startsWith('Backend'));

    expect(backendField?.get('input').attributes('disabled')).toBeDefined();
    expect(backendField?.get<HTMLInputElement>('input').element.value).toBe(BackendId.VLLM);
    expect(backendField?.text()).toContain('Set by Standard.');
    expect(getModelList).toHaveBeenLastCalledWith(expect.objectContaining({ format: [ModelFormat.SAFETENSORS] }), 1);
  });

  it("picks from models alone by id, naming the saved one with the deployment's model name", async () => {
    const wrapper = mount(Identity, {
      props: {
        name: '',
        description: '',
        modelId: 2,
        presetId: null,
        modelName: 'Qwen3.8-27B',
        backend: BackendId.LLAMA_CPP,
      },
    });
    await flushPromises();

    const modelSelect = wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.props('placeholder') === 'Search the catalogue');

    expect(getModelList).toHaveBeenCalledWith(
      expect.objectContaining({ type: [ModelType.MODEL], format: [ModelFormat.GGUF] }),
      1
    );
    expect(modelSelect?.props('options')).toEqual([{ label: 'Qwen3.8-27B', value: '2' }]);
  });

  it('offers every format while the backend is not yet known', async () => {
    getModelList.mockClear();

    mount(Identity, {
      props: { name: '', description: '', modelId: null, presetId: 4, backend: null },
    });
    await flushPromises();

    expect(getModelList).toHaveBeenCalledWith(expect.objectContaining({ format: undefined }), 1);
  });

  it('picks a preset by id, naming it with its backend beneath, and clears back to no preset keeping that backend', async () => {
    getPresetList.mockResolvedValueOnce({
      presetList: [{ id: 4, name: 'Standard', backend: BackendId.LLAMA_CPP, description: null, deployments: 0 }],
      pages: 1,
    });

    const wrapper = mount(Identity, {
      props: { name: '', description: '', modelId: null, presetId: null, backend: null },
    });
    await flushPromises();

    const presetSelect = wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.props('placeholder') === 'No preset');

    expect(presetSelect?.props('options')).toEqual([
      { label: 'Standard', description: BackendId.LLAMA_CPP, value: '4' },
    ]);

    const emitter: VueWrapper | undefined = presetSelect;

    emitter?.vm.$emit('update:value', '4');
    emitter?.vm.$emit('update:value', null);

    expect(wrapper.emitted('update:presetId')).toEqual([[4], [null]]);
    expect(wrapper.emitted('update:backend')).toEqual([[BackendId.LLAMA_CPP]]);
  });
});
