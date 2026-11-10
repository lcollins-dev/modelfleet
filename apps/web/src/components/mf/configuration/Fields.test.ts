import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import IconRocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded';

import { BackendFieldType, BackendDeclaration } from '@libs/backends';

import { ValidationError } from '@/types/error';

import { useErrorStore } from '@/stores/error';

import Fields, { IConfigurationLead } from './Fields.vue';

const DECLARATION = {
  schemaVersion: 1,
  formats: [],
  groups: [
    { group: 'container', label: 'Container' },
    { group: 'context', label: 'Context' },
  ],
  fields: [
    {
      name: 'image',
      label: 'Image',
      description: 'The image each instance runs.',
      group: 'container',
      type: BackendFieldType.TEXT,
    },
    {
      name: 'entrypoint',
      label: 'Entrypoint',
      description: 'Overrides the image entrypoint.',
      group: 'container',
      type: BackendFieldType.TEXT,
    },
    {
      name: 'contextSize',
      label: 'Context size',
      description: 'Tokens per request.',
      group: 'context',
      type: BackendFieldType.INTEGER,
      min: 1,
    },
    {
      name: 'flashAttention',
      label: 'Flash attention',
      description: 'Uses flash attention.',
      group: 'context',
      type: BackendFieldType.BOOLEAN,
    },
  ],
} as unknown as BackendDeclaration;

const LEAD: IConfigurationLead = {
  label: 'Deployment',
  icon: IconRocketLaunch,
  description: 'Choose the backend.',
  keys: ['replicas'],
  fields: ['image'],
};

const render = (props: Record<string, unknown> = {}) =>
  mount(Fields, {
    props: { modelValue: {}, declaration: DECLARATION, ...props },
    slots: { default: '<div data-testid="lead">lead</div>' },
  });

type FieldsWrapper = ReturnType<typeof render>;

const navItems = (wrapper: FieldsWrapper) => wrapper.get('nav').findAll('button');

const heading = (wrapper: FieldsWrapper) => wrapper.get('.text-base').text();

type NavItemWrapper = ReturnType<typeof navItems>[number];

const pillType = (classes: string[]) => {
  if (classes.includes('bg-primary-soft')) {
    return 'primary';
  }

  return classes.includes('bg-emphasis') ? 'default' : 'other';
};

const pills = (item: NavItemWrapper) =>
  item.findAll('.rounded-full > span').map(pill => ({
    count: pill.text(),
    type: pillType(pill.classes()),
  }));

describe('MfConfigurationFields', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('rails a section per declared group, after the lead, opening on the first', () => {
    const wrapper = render({ lead: LEAD });

    expect(navItems(wrapper).map(item => item.text())).toEqual(['Deployment', 'Container', 'Context']);
    expect(navItems(wrapper)[0].attributes('aria-current')).toBe('true');
    expect(heading(wrapper)).toBe('Deployment');
    expect(wrapper.get('[data-testid="lead"]').isVisible()).toBe(true);
  });

  it('drops a group whose fields the lead places itself', () => {
    const wrapper = render({ lead: { ...LEAD, fields: ['image', 'entrypoint'] } });

    expect(navItems(wrapper).map(item => item.text())).toEqual(['Deployment', 'Context']);
  });

  it('shows the picked section and its fields', async () => {
    const wrapper = render({ lead: LEAD });

    await navItems(wrapper)[2].trigger('click');

    expect(heading(wrapper)).toBe('Context');
    expect(navItems(wrapper)[2].attributes('aria-current')).toBe('true');
    expect(wrapper.findAll('[data-testid="configuration-field"]').filter(field => field.isVisible())).toHaveLength(2);
  });

  it('counts the fields set here in blue', () => {
    const wrapper = render({ lead: LEAD, modelValue: { image: 'engine:cpu', contextSize: 4096 }, inheriting: true });

    expect(pills(navItems(wrapper)[0])).toEqual([{ count: '1', type: 'primary' }]);
    expect(pills(navItems(wrapper)[2])).toEqual([{ count: '1', type: 'primary' }]);
  });

  it('counts what the preset sets in grey left of blue in one pill, an override once in blue', () => {
    const wrapper = render({
      lead: LEAD,
      modelValue: { contextSize: 4096 },
      inherited: { contextSize: 8192, flashAttention: true },
      inheriting: true,
    });

    const context = navItems(wrapper)[2];

    expect(pills(context)).toEqual([
      { count: '1', type: 'default' },
      { count: '1', type: 'primary' },
    ]);
  });

  it('shows a grey pill alone where only the preset sets the section', () => {
    const wrapper = render({ lead: LEAD, inherited: { flashAttention: true }, inheriting: true });

    const context = navItems(wrapper)[2];

    expect(pills(context)).toEqual([{ count: '1', type: 'default' }]);
  });

  it('counts the preset and the document across the lead keys while inheriting', () => {
    const wrapper = render({
      lead: { ...LEAD, keys: ['replicas', 'vramGib', 'image'] },
      inherited: { replicas: 2, image: 'engine:gpu' },
      own: { replicas: 3, vramGib: 12 },
      inheriting: true,
    });

    const deployment = navItems(wrapper)[0];

    expect(pills(deployment)).toEqual([
      { count: '1', type: 'default' },
      { count: '2', type: 'primary' },
    ]);
  });

  it('counts what the document sets where nothing is inherited', () => {
    const wrapper = render({
      lead: LEAD,
      modelValue: { image: 'engine:cpu', contextSize: 4096 },
      own: { replicas: 3 },
    });

    expect(pills(navItems(wrapper)[0])).toEqual([{ count: '1', type: 'primary' }]);
    expect(pills(navItems(wrapper)[2])).toEqual([{ count: '1', type: 'primary' }]);
  });

  it('shows no pill in a section nothing sets', () => {
    const wrapper = render({ lead: LEAD });

    expect(pills(navItems(wrapper)[2])).toEqual([]);
  });

  it('turns a section with invalid fields red in place of a count, keeping its pills', () => {
    useErrorStore().setValidationError(
      new ValidationError(null, { contextSize: { name: 'Context size', message: 'Too small.' } })
    );

    const wrapper = render({ lead: LEAD, modelValue: { contextSize: 0 } });

    const context = navItems(wrapper)[2];

    expect(context.text()).toBe('Context1');
    expect(context.get('.truncate').classes()).toContain('text-error');
    expect(pills(context)).toEqual([{ count: '1', type: 'primary' }]);
    expect(navItems(wrapper)[1].get('.truncate').classes()).not.toContain('text-error');
  });

  it('writes an edited field back into the values', async () => {
    const wrapper = render({ lead: LEAD, modelValue: { contextSize: 4096 } });

    await navItems(wrapper)[2].trigger('click');
    await wrapper.get('input[role="spinbutton"]').setValue('8192');

    expect(wrapper.emitted('update:modelValue')).toEqual([[{ contextSize: 8192 }]]);
  });

  it('stands its fields alone without a rail where there is one section', () => {
    const wrapper = render({
      declaration: { ...DECLARATION, groups: [DECLARATION.groups[0]], fields: DECLARATION.fields.slice(0, 2) },
    });

    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="configuration-field"]')).toHaveLength(2);
  });
});
