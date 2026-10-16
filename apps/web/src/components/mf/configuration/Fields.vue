<template>
  <div class="grid grid-cols-1" :class="railed ? 'md:grid-cols-[minmax(0,224px)_minmax(0,1fr)]' : ''">
    <nav
      v-if="railed"
      class="flex flex-col border-b border-divider px-2.5 py-3 md:border-b-0 md:border-r"
      aria-label="Settings sections"
    >
      <ui-nav-item
        v-for="section of sections"
        :key="section.group"
        :label="section.label"
        :icon="section.icon"
        :active="section.group === active.group"
        @click="activeGroup = section.group"
      >
        <template v-if="section.errors > 0 || section.set > 0" #count>
          <span class="inline-flex gap-2">
            <span v-if="section.errors > 0" class="text-error" :title="errorSummary(section.errors)">
              {{ section.errors }}
            </span>

            <span v-if="section.set > 0" :title="setLabel(section.set)">{{ section.set }}</span>
          </span>
        </template>
      </ui-nav-item>
    </nav>

    <div class="flex min-w-0 flex-col px-6 py-5">
      <div v-if="railed" class="mb-4">
        <div class="text-base font-semibold text-header">{{ active.label }}</div>

        <div v-if="active.description" class="mt-0.5 text-pretty text-xs leading-snug text-muted">
          {{ active.description }}
        </div>
      </div>

      <ui-form v-show="active.group === LEAD_GROUP" :name="formName" @submit="emit('submit')">
        <slot :fields="leadFields" :values="values" :set-field="setField" :inherited="inheritedValue" />

        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
      </ui-form>

      <ui-form
        v-for="section of declaredSections"
        v-show="section.group === active.group"
        :key="section.group"
        :name="formName"
        @submit="emit('submit')"
      >
        <mf-configuration-field
          v-for="field of section.fields"
          :key="field.name"
          :field="field"
          :inherited="inheritedValue(field.name)"
          :model-value="values[field.name] ?? null"
          @update:model-value="setField(field.name, $event)"
        />

        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
      </ui-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Component, computed, inject, ref } from 'vue';

import { BackendField, BackendDeclaration } from '@libs/backends';
import type { ConfigurationDocument, ConfigurationValue } from '@libs/dto';

import { ConfigurationFormValue, ConfigurationFormValues, holdsKey } from '@/utils/configuration/fields';
import { configurationGroupDescription, configurationGroupIcon } from '@/utils/configuration/groups';
import { formatCount } from '@/utils/format/number';

import { useErrorStore } from '@/stores/error';

import { UiForm, UiNavItem } from '@/components/ui';
import { FORM_CONTEXT_KEY } from '@/components/ui/form/formContext';

import MfConfigurationField from './Field.vue';

export interface IConfigurationLead {
  label: string;
  icon: Component;
  description?: string;

  /** Document keys the slot renders, so the rail can mark the section when one fails validation. */
  keys?: string[];

  /** Declared fields the slot places with `field`. Naming one here is what keeps the sections below from repeating it. */
  fields?: string[];
}

interface ISection {
  group: string;
  label: string;
  description: string;
  icon: Component;
  fields: BackendField[];
  set: number;
  errors: number;
}

/** A backend group may not take this name, which the lead section holds. */
const LEAD_GROUP = '__lead';

const props = withDefaults(
  defineProps<{
    /** Null before a backend is chosen, which leaves the lead section standing alone. */
    declaration: BackendDeclaration | null;

    inherited?: ConfigurationDocument;

    inheriting?: boolean;

    /** Adds a first section rendering the default slot, for the keys the declaration does not model. */
    lead?: IConfigurationLead | null;
  }>(),
  { inherited: () => ({}), inheriting: false, lead: null }
);

const emit = defineEmits<{ submit: [] }>();

const values = defineModel<ConfigurationFormValues>({ required: true });

const errorStore = useErrorStore();

const formName = inject(FORM_CONTEXT_KEY, null)?.name ?? null;

const errorCount = (keys: string[]): number =>
  keys.filter(key => errorStore.getFieldError(formName, key) !== undefined).length;

const declaredSections = computed<ISection[]>(() => {
  const declaration = props.declaration;

  if (declaration === null) {
    return [];
  }

  const claimed = new Set(props.lead?.fields ?? []);

  return declaration.groups
    .map(group => {
      const fields = declaration.fields.filter(field => field.group === group.group && !claimed.has(field.name));

      return {
        group: group.group,
        label: group.label,
        description: configurationGroupDescription(group.group),
        icon: configurationGroupIcon(group.group),
        fields,
        set: fields.filter(field => (values.value[field.name] ?? null) !== null).length,
        errors: errorCount(fields.map(field => field.name)),
      };
    })
    .filter(group => group.fields.length > 0);
});

const sections = computed<ISection[]>(() => {
  const lead = props.lead;

  if (lead === null) {
    return declaredSections.value;
  }

  return [
    {
      group: LEAD_GROUP,
      label: lead.label,
      description: lead.description ?? '',
      icon: lead.icon,
      fields: [],
      set: leadSet.value,
      errors: errorCount(lead.keys ?? []),
    },
    ...declaredSections.value,
  ];
});

const railed = computed(() => sections.value.length > 1);

const errorSummary = (errors: number): string => formatCount(errors, 'invalid field');

const activeGroup = ref<string | null>(null);

const active = computed<ISection>(
  () => sections.value.find(section => section.group === activeGroup.value) ?? sections.value[0]
);

const setLabel = (set: number): string => `${set} ${props.inheriting ? 'overridden' : 'set'}`;

const leadSet = computed(() => (props.lead?.fields ?? []).filter(name => (values.value[name] ?? null) !== null).length);

const leadFields = computed<Record<string, BackendField>>(() =>
  Object.fromEntries(
    (props.lead?.fields ?? []).flatMap(name => {
      const field = props.declaration?.fields.find(candidate => candidate.name === name);

      return field === undefined ? [] : [[name, field]];
    })
  )
);

const inheritedValue = (key: string): ConfigurationValue | undefined =>
  holdsKey(props.inherited, key) ? props.inherited[key] : undefined;

const setField = (name: string, next: ConfigurationFormValue) => {
  values.value = { ...values.value, [name]: next };
};
</script>
