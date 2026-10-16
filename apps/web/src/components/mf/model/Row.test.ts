import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ListModelDto, ModelLicenceDto } from '@libs/dto';
import { LicenceTerms, ModelFormat, ModelState, ModelTask, ModelType, NodeState } from '@libs/dto';

import { UiTag } from '@/components/ui';

import Row from './Row.vue';

const listModel = (overrides: Partial<ListModelDto> = {}): ListModelDto => ({
  id: 11,
  fingerprint: 'a'.repeat(64),
  name: 'Llama 3 8B',
  displayName: null,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  tasks: [],
  licence: null,
  quantisation: null,
  quantisationMixed: false,
  sizeBytes: 4_920_000_000,
  shardCount: 1,
  state: ModelState.AVAILABLE,
  availability: [],
  ...overrides,
});

const render = (overrides: Partial<ListModelDto> = {}) => mount(Row, { props: { model: listModel(overrides) } });

const licence = (id: string, terms: LicenceTerms | null): ModelLicenceDto => ({ id, name: null, link: null, terms });

const toneOf = (row: ReturnType<typeof render>, label: string): unknown =>
  row
    .findAllComponents(UiTag)
    .find(tag => tag.text() === label)
    ?.props('type');

describe('MfModelRow', () => {
  it('reads as the display name where one is set', () => {
    expect(render({ displayName: 'Llama chat' }).text()).toContain('Llama chat');
  });

  it('opens the description with what a companion is, rather than a task', () => {
    const row = render({ type: ModelType.PROJECTOR });

    expect(row.text()).toContain('Projector · GGUF');
    expect(row.text()).not.toContain('Unknown task');
  });

  it('opens the description with every task a model holds, in task order', () => {
    const row = render({ tasks: [ModelTask.SPEECH, ModelTask.CHAT, ModelTask.TRANSCRIPTION] });

    expect(row.text()).toContain('Chat, Transcription, Speech · GGUF');
  });

  it('reads a model whose tasks are unknown as an unknown task', () => {
    expect(render().text()).toContain('Unknown task · GGUF');
  });

  it('reads a mixed quantisation as mostly that type', () => {
    expect(render({ quantisation: 'Q8_0', quantisationMixed: true }).text()).toContain('GGUF mostly Q8_0');
  });

  it('marks non-commercial weights with a warning tag', () => {
    const row = render({ licence: licence('cc-by-nc-4.0', LicenceTerms.NON_COMMERCIAL) });

    expect(toneOf(row, 'Non-commercial')).toBe('warning');
  });

  it('marks a custom licence with a plain tag', () => {
    const row = render({ licence: licence('other', LicenceTerms.CUSTOM) });

    expect(toneOf(row, 'Custom licence')).toBe('default');
  });

  it('marks nothing for a permissive licence', () => {
    const row = render({ licence: licence('mit', null) });

    expect(row.findAllComponents(UiTag).map(tag => tag.text())).toEqual(['Available']);
  });

  it('tags the availability in its tone', () => {
    expect(toneOf(render(), 'Available')).toBe('success');
    expect(toneOf(render({ state: ModelState.UNAVAILABLE }), 'Unavailable')).toBe('error');
  });

  it('counts the nodes holding the model, naming them on hover, and reads its size', () => {
    const entry = (nodeId: number, nodeName: string) => ({
      nodeId,
      nodeName,
      nodeState: NodeState.ONLINE,
      path: '/srv/weights/llama.gguf',
      lastConfirmedDate: new Date(),
    });

    const row = render({ availability: [entry(1, 'node-a'), entry(2, 'node-b')] });

    expect(row.find('[title="node-a, node-b"]').text()).toBe('2');
    expect(row.text()).toContain('4.6 GiB');
  });
});
