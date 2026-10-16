import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListModelDto, ModelFormat, ModelState, ModelType, NodeState } from '@libs/dto';

import ModelReference from './ModelReference.vue';

const getModelList = vi.fn();
const findModelByFingerprint = vi.fn();

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList, getModel: vi.fn(), findModelByFingerprint }),
}));

const FINGERPRINT = 'a'.repeat(64);

const PROJECTOR: ListModelDto = {
  id: 1,
  fingerprint: FINGERPRINT,
  name: 'Gemma 3 4B',
  displayName: null,
  format: ModelFormat.GGUF,
  type: ModelType.PROJECTOR,
  tasks: [],
  licence: null,
  quantisation: 'F16',
  quantisationMixed: false,
  sizeBytes: 530_000_000,
  shardCount: 1,
  state: ModelState.AVAILABLE,
  availability: [
    {
      nodeId: 1,
      nodeName: 'rig-1',
      nodeState: NodeState.ONLINE,
      path: '/srv/models/gemma-3-4b/mmproj-F16.gguf',
      lastConfirmedDate: new Date('2026-09-20T09:00:00.000Z'),
    },
  ],
};

const render = (modelValue: string | null, inherited: string | null = null) =>
  mount(ModelReference, {
    props: { modelValue, modelType: ModelType.PROJECTOR, placeholder: 'Default: none', inherited },
  });

describe('MfConfigurationModelReference', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getModelList.mockReset();
    getModelList.mockResolvedValue({ modelList: [], pages: 1 });
    findModelByFingerprint.mockReset();
    findModelByFingerprint.mockImplementation((fingerprint: string) =>
      Promise.resolve(fingerprint === FINGERPRINT ? PROJECTOR : undefined)
    );
  });

  it('asks the catalogue for the type the field declares, so nothing else is offered', () => {
    render(null);

    expect(getModelList).toHaveBeenCalledWith(expect.objectContaining({ type: [ModelType.PROJECTOR] }), 1);
  });

  it('names the inherited projector in the placeholder rather than showing its fingerprint', async () => {
    const wrapper = render(null, FINGERPRINT);
    await flushPromises();

    expect(findModelByFingerprint).toHaveBeenCalledWith(FINGERPRINT, ModelType.PROJECTOR);
    expect(wrapper.findComponent({ name: 'Select' }).props('placeholder')).toBe('Inherited: Gemma 3 4B');
  });

  it('names the inherited projector by its display name where it has one', async () => {
    findModelByFingerprint.mockResolvedValue({ ...PROJECTOR, displayName: 'Vision' });

    const wrapper = render(null, FINGERPRINT);
    await flushPromises();

    expect(wrapper.findComponent({ name: 'Select' }).props('placeholder')).toBe('Inherited: Vision');
  });

  it('follows the inherited projector as the preset changes while the field stays mounted', async () => {
    const wrapper = render(null);
    await flushPromises();

    await wrapper.setProps({ inherited: FINGERPRINT });
    await flushPromises();

    expect(wrapper.findComponent({ name: 'Select' }).props('placeholder')).toBe('Inherited: Gemma 3 4B');

    await wrapper.setProps({ inherited: null });

    expect(wrapper.findComponent({ name: 'Select' }).props('placeholder')).toBe('Default: none');
  });

  it('clears the field where the picker is emptied', async () => {
    const wrapper = render(FINGERPRINT);
    await flushPromises();

    const select: VueWrapper = wrapper.findComponent({ name: 'Select' });

    select.vm.$emit('update:value', null);
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });
});
