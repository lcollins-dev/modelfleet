import { VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { ModelDto } from '@libs/dto';
import { LicenceTerms, ModelFormat, ModelState, ModelTask, ModelType, NodeState, ProjectorModality } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { useDialogStore } from '@/stores/dialog';

import Model from './Model.vue';

const getModel = vi.fn();
const updateModel = vi.fn();
const deleteModel = vi.fn();

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModel, updateModel, deleteModel }),
}));

const model = (displayName: string | null, overrides: Partial<ModelDto> = {}): ModelDto => ({
  id: 11,
  fingerprint: 'a'.repeat(64),
  name: 'Llama 3 8B',
  displayName,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  tasks: [],
  licence: null,
  quantisation: 'Q4_K',
  quantisationMixed: false,
  sizeBytes: 1024,
  shardCount: 1,
  state: ModelState.UNAVAILABLE,
  availability: [],
  ggufMetadata: null,
  safetensorsMetadata: null,
  modalities: null,
  detectedTasks: [],
  tasksAssigned: false,
  createdDate: new Date('2026-09-26T12:00:00.000Z'),
  ...overrides,
});

describe('Model', () => {
  const render = async (): Promise<VueWrapper> => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/models/:modelId', component: { template: '<div />' } },
        { path: '/:path(.*)*', component: { template: '<div />' } },
      ],
    });
    await router.push('/models/11');

    const wrapper = mount(Model, {
      global: {
        plugins: [router],
        stubs: {
          Modal: { props: ['show'], template: '<div v-if="show"><slot /></div>' },
        },
      },
    });

    await flushPromises();

    return wrapper;
  };

  const click = async (wrapper: VueWrapper, text: string) => {
    const found = wrapper.findAll('button').find(candidate => candidate.text() === text);

    if (found === undefined) {
      throw new Error(`No button reads ${text}`);
    }

    await found.trigger('click');
    await flushPromises();
  };

  const save = async (wrapper: VueWrapper) => {
    await wrapper.get('form').trigger('submit');
    await flushPromises();
  };

  beforeEach(() => {
    setActivePinia(createPinia());

    getModel.mockResolvedValue(model('Llama chat'));
    updateModel.mockResolvedValue(undefined);
    deleteModel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('heads the page with the display name, keeping the scanned name in the meta line', async () => {
    const wrapper = await render();

    expect(wrapper.text()).toContain('Llama chat');
    expect(wrapper.text()).toContain('Llama 3 8B · GGUF Q4_K');
  });

  it('reads as the scanned name alone where the model has no display name', async () => {
    getModel.mockResolvedValue(model(null));

    const wrapper = await render();

    expect(wrapper.text()).toContain('Llama 3 8B');
    expect(wrapper.text()).not.toContain('Llama 3 8B · ');
  });

  it('opens the editor on the current display name and clears it when saved blank', async () => {
    const wrapper = await render();

    await click(wrapper, 'Edit');

    const input = wrapper.find('input');

    expect(input.element.value).toBe('Llama chat');

    await input.setValue('');
    getModel.mockResolvedValue(model(null));
    await save(wrapper);

    expect(updateModel).toHaveBeenCalledWith({ displayName: '', tasks: undefined }, 11, 'update-model');
    expect(getModel).toHaveBeenCalledTimes(2);
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it("leaves an admin's tasks unsent where untouched, and sends the detected ones once asked to use them", async () => {
    getModel.mockResolvedValue(
      model(null, {
        tasks: [ModelTask.SPEECH, ModelTask.CHAT],
        detectedTasks: [ModelTask.CHAT],
        tasksAssigned: true,
      })
    );

    const wrapper = await render();

    await click(wrapper, 'Edit');
    await save(wrapper);

    expect(updateModel).toHaveBeenLastCalledWith({ displayName: '', tasks: undefined }, 11, 'update-model');

    await click(wrapper, 'Edit');
    await click(wrapper, 'Use detected');
    await save(wrapper);

    expect(updateModel).toHaveBeenLastCalledWith({ displayName: '', tasks: [ModelTask.CHAT] }, 11, 'update-model');
  });

  it('offers no tasks to edit on a companion', async () => {
    getModel.mockResolvedValue(model(null, { type: ModelType.PROJECTOR }));

    const wrapper = await render();

    await click(wrapper, 'Edit');

    expect(wrapper.text()).not.toContain('Use detected');

    await save(wrapper);

    expect(updateModel).toHaveBeenCalledWith({ displayName: '', tasks: undefined }, 11, 'update-model');
  });

  it("reads a safetensors model's architecture, which picks its stage shares under vLLM-Omni", async () => {
    getModel.mockResolvedValue(
      model(null, {
        format: ModelFormat.SAFETENSORS,
        safetensorsMetadata: { dtype: 'BF16', tensorCount: 400, parameterCount: 600, architecture: 'qwen3_tts' },
      })
    );

    const wrapper = await render();

    expect(wrapper.text()).toContain('Architectureqwen3_tts');
  });

  it('lists each node holding the model with its path, linked to the node', async () => {
    getModel.mockResolvedValue(
      model(null, {
        state: ModelState.AVAILABLE,
        availability: [
          {
            nodeId: 3,
            nodeName: 'node-a-01',
            nodeState: NodeState.ONLINE,
            path: '/srv/weights/llama.gguf',
            lastConfirmedDate: new Date(),
          },
        ],
      })
    );

    const wrapper = await render();
    const row = wrapper.get('[data-testid="availability-row"]');

    expect(row.attributes('href')).toBe('/nodes/3');
    expect(row.text()).toContain('node-a-01');
    expect(row.text()).toContain('Online');
    expect(row.text()).toContain('/srv/weights/llama.gguf');
    expect(row.text()).toContain('Confirmed');
  });

  it('says where no node stores the model, and warns it cannot be deployed', async () => {
    const wrapper = await render();

    expect(wrapper.get('[data-testid="availability-card"]').text()).toContain('No nodes store this model.');
    expect(wrapper.text()).toContain('The model is no longer stored on any node');
  });

  describe('tasks and licence', () => {
    it('reads the tasks and a non-commercial licence, marking the heading', async () => {
      getModel.mockResolvedValue(
        model(null, {
          tasks: [ModelTask.SPEECH],
          detectedTasks: [ModelTask.SPEECH],
          licence: { id: 'cc-by-nc-4.0', name: null, link: null, terms: LicenceTerms.NON_COMMERCIAL },
        })
      );

      const wrapper = await render();

      expect(wrapper.text()).toContain('Speech');
      expect(wrapper.text()).toContain('Non-commercial');
      expect(wrapper.text()).toContain('cc-by-nc-4.0 (non-commercial)');
    });

    it('marks tasks an admin set, beside the ones the scans read', async () => {
      getModel.mockResolvedValue(
        model(null, { tasks: [ModelTask.CHAT, ModelTask.SPEECH], detectedTasks: [], tasksAssigned: true })
      );

      const wrapper = await render();

      expect(wrapper.text()).toContain('Chat, Speech (set by an admin)');
      expect(wrapper.text()).toContain('DetectedUnknown task');
    });

    it('reads a model whose tasks are unknown as an unknown task, and its licence as not reported', async () => {
      const wrapper = await render();

      expect(wrapper.text()).toContain('Unknown task');
      expect(wrapper.text()).toContain('not reported');
    });

    it('links a custom licence by its name where the card gives a URL', async () => {
      getModel.mockResolvedValue(
        model(null, {
          licence: {
            id: 'other',
            name: 'fish-audio-research',
            link: 'https://example.com/LICENSE',
            terms: LicenceTerms.CUSTOM,
          },
        })
      );

      const wrapper = await render();
      const link = wrapper.find('a[href="https://example.com/LICENSE"]');

      expect(link.text()).toBe('fish-audio-research (custom licence)');
    });

    it('leaves a link naming a file inside the repository as text', async () => {
      getModel.mockResolvedValue(
        model(null, { licence: { id: 'other', name: 'qwen-research', link: 'LICENSE', terms: LicenceTerms.CUSTOM } })
      );

      const wrapper = await render();

      expect(wrapper.find('a[href="LICENSE"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('qwen-research (custom licence)');
    });

    it("reads a projector's encoders in place of a task", async () => {
      getModel.mockResolvedValue(
        model(null, { type: ModelType.PROJECTOR, modalities: [ProjectorModality.VISION, ProjectorModality.AUDIO] })
      );

      const wrapper = await render();

      expect(wrapper.text()).toContain('vision and audio');
      expect(wrapper.text()).not.toContain('Unknown task');
    });

    it('reads neither a task nor encoders for a LoRA adapter', async () => {
      getModel.mockResolvedValue(model(null, { type: ModelType.LORA }));

      const wrapper = await render();

      expect(wrapper.text()).not.toContain('Encoders');
      expect(wrapper.text()).not.toContain('Unknown task');
    });
  });

  describe('deleting', () => {
    it('asks first, naming the model, and deletes only once confirmed', async () => {
      const wrapper = await render();

      await click(wrapper, 'Delete Model');

      const dialog = useDialogStore().top;

      expect(dialog?.options).toMatchObject({
        type: DialogType.DANGER,
        title: 'Delete Llama chat?',
        confirmLabel: 'Delete Model',
      });
      expect(deleteModel).not.toHaveBeenCalled();

      await dialog?.options.action?.();

      expect(deleteModel).toHaveBeenCalledWith(11);
    });

    it('hands the dialog a rejection, so it stays open when the delete fails', async () => {
      deleteModel.mockRejectedValue(new Error('refused'));

      const wrapper = await render();

      await click(wrapper, 'Delete Model');

      await expect(useDialogStore().top?.options.action?.()).rejects.toThrow('refused');
    });
  });
});
