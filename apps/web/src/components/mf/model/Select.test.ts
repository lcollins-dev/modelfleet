import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListModelDto, ModelFormat, ModelState, ModelTask, ModelType, NodeState } from '@libs/dto';

import { Config } from '@/Config';

import { ISelectOption } from '@/components/ui';

import Select from './Select.vue';

const getModelList = vi.fn();
const getModel = vi.fn();
const findModelByFingerprint = vi.fn();

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList, getModel, findModelByFingerprint }),
}));

/** Two quantisations of one model, so both carry its name and only the file tells them apart. */
const model = (id: number, path: string, quantisation: string): ListModelDto => ({
  id,
  fingerprint: `${id}`.repeat(64),
  name: 'Qwen3.8-27B',
  displayName: null,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  tasks: [],
  licence: null,
  quantisation,
  quantisationMixed: false,
  sizeBytes: 27_000_000_000,
  shardCount: 1,
  state: ModelState.AVAILABLE,
  availability: [
    {
      nodeId: 1,
      nodeName: 'rig-1',
      nodeState: NodeState.ONLINE,
      path,
      lastConfirmedDate: new Date('2026-09-20T09:00:00.000Z'),
    },
  ],
});

const BF16 = model(1, '/srv/models/Qwen3.8-27B-BF16.gguf', 'BF16');
const Q8 = model(2, '/srv/models/Qwen3.8-27B-UD-Q8_K_XL.gguf', 'Q8_K');

const page = (modelList: ListModelDto[]) => Promise.resolve({ modelList, pages: 1 });

const answerPages = (first: ListModelDto[], searched: ListModelDto[]) => {
  getModelList.mockImplementation(({ search }: { search?: string }) => page(search === undefined ? first : searched));
  findModelByFingerprint.mockImplementation((fingerprint: string) =>
    Promise.resolve(searched.find(model => model.fingerprint === fingerprint))
  );
};

const renderById = (modelValue: number | null, fallbackLabel?: string) =>
  mount(Select, {
    props: { modelValue, modelType: ModelType.MODEL, valueKey: 'id', placeholder: 'Search', fallbackLabel },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });

const renderByFingerprint = (modelValue: string | null) =>
  mount(Select, {
    props: { modelValue, modelType: ModelType.PROJECTOR, valueKey: 'fingerprint', placeholder: 'Search' },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });

type Wrapper = ReturnType<typeof renderById>;

const select = (wrapper: Wrapper) => wrapper.findComponent({ name: 'Select' });

const emitFromSelect = (wrapper: Wrapper, event: string, ...args: unknown[]) => {
  const component = select(wrapper) as VueWrapper;

  component.vm.$emit(event, ...args);
};

const optionValues = (wrapper: Wrapper) =>
  (select(wrapper).props('options') as ISelectOption<string>[]).map(option => option.value);

/** Opens the list and reads the option's whole row: label, file line and task tags. */
const renderedOption = async (wrapper: Wrapper, value: number | string): Promise<string> => {
  const index = optionValues(wrapper).indexOf(String(value));

  if (!wrapper.find('[role="listbox"]').exists()) {
    await wrapper.get('[role="combobox"]').trigger('click');
  }

  return wrapper.findAll('[role="option"]')[index].text();
};

const typeSearch = async (wrapper: Wrapper, term: string) => {
  emitFromSelect(wrapper, 'search', term);
  await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS + 1);
  await flushPromises();
};

describe('MfModelSelect', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getModelList.mockReset();
    getModel.mockReset();
    findModelByFingerprint.mockReset();
    answerPages([], []);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('asks the catalogue for the one type it was given', () => {
    renderByFingerprint(null);

    expect(getModelList).toHaveBeenCalledWith(expect.objectContaining({ type: [ModelType.PROJECTOR] }), 1);
  });

  it('tags a model with each of its tasks', async () => {
    answerPages([{ ...BF16, tasks: [ModelTask.TRANSCRIPTION, ModelTask.CHAT] }], []);

    const wrapper = renderById(null);
    await flushPromises();

    expect(await renderedOption(wrapper, 1)).toBe('Qwen3.8-27BQwen3.8-27B-BF16.gguf · GGUF BF16ChatTranscription');
  });

  it('tags a model whose tasks are unknown as such', async () => {
    answerPages([BF16], []);

    const wrapper = renderById(null);
    await flushPromises();

    expect(await renderedOption(wrapper, 1)).toContain('Unknown task');
  });

  it('tags a companion with no task', async () => {
    answerPages([{ ...BF16, type: ModelType.PROJECTOR }], []);

    const wrapper = renderByFingerprint(null);
    await flushPromises();

    expect(await renderedOption(wrapper, BF16.fingerprint)).not.toContain('task');
  });

  it('asks for the formats it was given, and lists again when they change', async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        modelType: ModelType.MODEL,
        formats: [ModelFormat.GGUF],
        valueKey: 'id',
        placeholder: 'Search',
      },
    });
    await flushPromises();

    expect(getModelList).toHaveBeenLastCalledWith(expect.objectContaining({ format: [ModelFormat.GGUF] }), 1);

    await wrapper.setProps({ formats: [ModelFormat.SAFETENSORS] });
    await flushPromises();

    expect(getModelList).toHaveBeenLastCalledWith(expect.objectContaining({ format: [ModelFormat.SAFETENSORS] }), 1);
  });

  it('drops a chosen model the new formats cannot load, and keeps one they still can', async () => {
    answerPages([BF16], []);

    const wrapper = mount(Select, {
      props: {
        modelValue: 1,
        modelType: ModelType.MODEL,
        formats: [ModelFormat.GGUF],
        valueKey: 'id',
        placeholder: 'Search',
      },
    });
    await flushPromises();

    await wrapper.setProps({ formats: [ModelFormat.GGUF, ModelFormat.SAFETENSORS] });

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await wrapper.setProps({ formats: [ModelFormat.SAFETENSORS] });

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });

  it('drops a saved model read only after the formats moved away from it', async () => {
    let answerSaved: (found: ListModelDto) => void = () => undefined;

    getModel.mockReturnValue(
      new Promise<ListModelDto>(resolve => {
        answerSaved = resolve;
      })
    );

    const wrapper = mount(Select, {
      props: {
        modelValue: 1,
        modelType: ModelType.MODEL,
        formats: [ModelFormat.GGUF],
        valueKey: 'id',
        placeholder: 'Search',
      },
    });
    await flushPromises();

    await wrapper.setProps({ formats: [ModelFormat.SAFETENSORS] });

    answerSaved(BF16);
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });

  it('lists the whole first page on opening, whether or not a value is already chosen', async () => {
    answerPages([BF16, Q8], [Q8]);

    const wrapper = renderByFingerprint(Q8.fingerprint);
    await flushPromises();

    expect(getModelList).toHaveBeenCalledWith(expect.objectContaining({ search: undefined }), 1);
    expect(optionValues(wrapper)).toEqual([BF16.fingerprint, Q8.fingerprint]);
  });

  it('asks for nothing more where the first page already holds the saved value', async () => {
    answerPages([BF16, Q8], []);

    renderByFingerprint(Q8.fingerprint);
    await flushPromises();

    expect(getModelList).toHaveBeenCalledTimes(1);
    expect(findModelByFingerprint).not.toHaveBeenCalled();
  });

  it('leaves the format and quantisation standing alone where no node holds the file any more', async () => {
    answerPages([{ ...BF16, availability: [] }], []);

    const wrapper = renderById(null);
    await flushPromises();

    expect(await renderedOption(wrapper, 1)).toBe('Qwen3.8-27BGGUF BF16Unknown task');
  });

  it("puts each file's name and quantisation under a name two files share", async () => {
    answerPages([BF16, Q8], []);

    const wrapper = renderById(null);
    await flushPromises();

    expect(await renderedOption(wrapper, 1)).toContain('Qwen3.8-27B');
    expect(await renderedOption(wrapper, 1)).toContain('Qwen3.8-27B-BF16.gguf · GGUF BF16');
    expect(await renderedOption(wrapper, 2)).toContain('Qwen3.8-27B-UD-Q8_K_XL.gguf · GGUF Q8_K');
  });

  it('leads with the display name where the model has one, keeping the file line under it', async () => {
    answerPages([{ ...BF16, displayName: 'Coder' }], []);

    const wrapper = renderById(null);
    await flushPromises();

    expect(await renderedOption(wrapper, 1)).toBe('CoderQwen3.8-27B-BF16.gguf · GGUF BF16Unknown task');
  });

  it('looks a saved fingerprint the first page leaves out up, without narrowing the list to it', async () => {
    answerPages([BF16], [Q8]);

    const wrapper = renderByFingerprint(Q8.fingerprint);
    await flushPromises();

    expect(findModelByFingerprint).toHaveBeenCalledWith(Q8.fingerprint, ModelType.PROJECTOR);
    expect(optionValues(wrapper)).toEqual([Q8.fingerprint, BF16.fingerprint]);
    expect(await renderedOption(wrapper, Q8.fingerprint)).toContain('Qwen3.8-27B-UD-Q8_K_XL.gguf');
  });

  it('reads a saved id the first page leaves out by id', async () => {
    answerPages([BF16], []);
    getModel.mockResolvedValue(Q8);

    const wrapper = renderById(2, 'Qwen3.8-27B');
    await flushPromises();

    expect(getModel).toHaveBeenCalledWith(2);
    expect(await renderedOption(wrapper, 2)).toContain('Qwen3.8-27B-UD-Q8_K_XL.gguf');
  });

  it('still names the saved value where the first page could not be listed', async () => {
    getModelList.mockRejectedValue(new Error('unavailable'));
    getModel.mockResolvedValue(Q8);

    const wrapper = renderById(2);
    await flushPromises();

    expect(await renderedOption(wrapper, 2)).toContain('Qwen3.8-27B-UD-Q8_K_XL.gguf');
  });

  it('falls back to the label it was given where the saved model cannot be read', async () => {
    getModel.mockRejectedValue(new Error('gone'));

    const wrapper = renderById(2, 'Qwen3.8-27B');
    await flushPromises();

    expect(select(wrapper).props('options')).toEqual([{ label: 'Qwen3.8-27B', value: '2' }]);
    expect(await renderedOption(wrapper, 2)).toBe('Qwen3.8-27B');
  });

  it('keeps the chosen model listed once a later search no longer carries it', async () => {
    vi.useFakeTimers();
    answerPages([BF16, Q8], []);

    const wrapper = renderById(null);
    await flushPromises();

    emitFromSelect(wrapper, 'update:value', '2');
    await typeSearch(wrapper, 'nothing matches this');

    expect(optionValues(wrapper)).toEqual(['2']);
    expect(await renderedOption(wrapper, 2)).toContain('Qwen3.8-27B-UD-Q8_K_XL.gguf');
  });

  it('keeps a pick made while the saved value is still being looked up', async () => {
    vi.useFakeTimers();
    let answer: (found: ListModelDto) => void = () => undefined;
    answerPages([BF16], []);
    getModel.mockReturnValue(new Promise<ListModelDto>(resolve => (answer = resolve)));

    const wrapper = renderById(2);
    await flushPromises();

    emitFromSelect(wrapper, 'update:value', '1');
    answer(Q8);
    await typeSearch(wrapper, 'nothing matches this');

    expect(optionValues(wrapper)).toEqual(['1']);
    expect(await renderedOption(wrapper, 1)).toContain('Qwen3.8-27B-BF16.gguf');
  });

  it('sends a typed term to the catalogue, which matches file names as well as model names', async () => {
    vi.useFakeTimers();

    const wrapper = renderById(null);
    await flushPromises();
    await typeSearch(wrapper, 'Q8_K_XL');

    expect(select(wrapper).props('remote')).toBe(true);
    expect(select(wrapper).props('searchable')).toBe(true);
    expect(getModelList).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Q8_K_XL' }), 1);
  });

  it('shows the latest answer where an earlier search answers after it', async () => {
    vi.useFakeTimers();
    let answerNarrowed: (response: { modelList: ListModelDto[]; pages: number }) => void = () => undefined;
    answerPages([BF16, Q8], []);

    const wrapper = renderById(null);
    await flushPromises();

    getModelList.mockImplementation(({ search }: { search?: string }) =>
      search === undefined ? page([BF16, Q8]) : new Promise(resolve => (answerNarrowed = resolve))
    );
    emitFromSelect(wrapper, 'search', 'Q8_K_XL');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS + 1);
    await typeSearch(wrapper, '');

    answerNarrowed({ modelList: [Q8], pages: 1 });
    await flushPromises();

    expect(optionValues(wrapper)).toEqual(['1', '2']);
  });

  it('lists the whole first page again once a search that narrowed it is cleared on closing', async () => {
    vi.useFakeTimers();

    const wrapper = renderById(null);
    await flushPromises();
    await typeSearch(wrapper, 'Q8_K_XL');
    getModelList.mockClear();

    await typeSearch(wrapper, '');

    expect(getModelList).toHaveBeenCalledWith(expect.objectContaining({ search: undefined }), 1);
  });

  it('asks nothing on closing where nothing narrowed the list', async () => {
    vi.useFakeTimers();

    const wrapper = renderById(null);
    await flushPromises();
    getModelList.mockClear();

    await typeSearch(wrapper, '');

    expect(getModelList).not.toHaveBeenCalled();
  });

  it('drops a search typed just before the menu closed', async () => {
    vi.useFakeTimers();
    answerPages([BF16, Q8], [Q8]);

    const wrapper = renderById(null);
    await flushPromises();

    emitFromSelect(wrapper, 'search', 'Q8_K_XL');
    await typeSearch(wrapper, '');

    expect(optionValues(wrapper)).toEqual(['1', '2']);
    expect(getModelList).toHaveBeenCalledTimes(1);
  });

  it('emits the model key for a picked option and null when cleared', async () => {
    answerPages([BF16, Q8], []);

    const wrapper = renderById(null);
    await flushPromises();

    emitFromSelect(wrapper, 'update:value', '2');
    emitFromSelect(wrapper, 'update:value', null);

    expect(wrapper.emitted('update:modelValue')).toEqual([[2], [null]]);
  });
});
