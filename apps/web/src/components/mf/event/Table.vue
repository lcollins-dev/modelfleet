<template>
  <ui-table :columns="gridColumns" :min-width="minWidth">
    <ui-table-head>
      <span v-for="column of props.columns" :key="column">{{ COLUMN_LABELS[column] }}</span>
      <span></span>
    </ui-table-head>

    <ui-table-row v-for="event of props.events" :key="event.id" data-testid="event-row">
      <template v-for="column of props.columns" :key="column">
        <span v-if="column === 'when'" class="font-mono text-xs">{{ formatDateTime(event.createdDate) }}</span>

        <div v-else-if="column === 'event'" class="min-w-0">
          <ui-tag :type="SEVERITY_TAG_TYPES[event.severity]">{{ formatEventType(event.type) }}</ui-tag>
        </div>

        <div v-else-if="column === 'summary'" class="min-w-0 text-xs leading-5 text-highlight wrap-break-word">
          <event-message v-if="event.message" :message="event.message" />
          <span v-else class="text-muted">-</span>
        </div>

        <div v-else class="min-w-0">
          <template v-if="partyOf(event, column).name">
            <div class="truncate">
              <ui-link
                v-if="partyOf(event, column).to"
                :to="partyOf(event, column).to"
                class="max-w-full"
                data-testid="event-party-link"
                @click.stop
              >
                <span class="truncate">{{ partyOf(event, column).name }}</span>
              </ui-link>

              <template v-else>{{ partyOf(event, column).name }}</template>
            </div>

            <div class="mt-0.5 truncate font-mono text-xs text-muted">{{ partyOf(event, column).reference }}</div>
          </template>

          <span v-else class="truncate font-mono text-xs">{{ partyOf(event, column).reference || '-' }}</span>
        </div>
      </template>

      <span v-if="!hasDetail(event)"></span>

      <template v-if="hasDetail(event)" #expand>
        <mf-event-detail :detail="event.detail" />
      </template>
    </ui-table-row>

    <template v-if="!props.loading && props.events.length === 0" #empty>{{ props.emptyDescription }}</template>

    <template v-if="$slots.toolbar" #toolbar>
      <slot name="toolbar" />
    </template>

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </ui-table>
</template>

<script setup lang="ts">
import { FunctionalComponent, PropType, computed } from 'vue';

import type { EventDto } from '@libs/dto';
import { EventPartyType, EventSeverity, UserRoleId } from '@libs/dto';

import { eventPartyPath, formatEventType } from '@/utils/event';
import { formatDateTime } from '@/utils/format/date';
import { renderInlineMarkdown } from '@/utils/format/markdown';

import { useUserStore } from '@/stores/user';

import { TagType, UiLink, UiTable, UiTableHead, UiTableRow, UiTag } from '@/components/ui';

import MfEventDetail from './Detail.vue';

export type EventTableColumn = 'when' | 'event' | 'summary' | 'subject' | 'actor';

interface IParty {
  name: string | undefined;
  reference: string;
  to: string | undefined;
}

const COLUMN_LABELS: Record<EventTableColumn, string> = {
  when: 'When',
  event: 'Event',
  summary: 'Summary',
  subject: 'Subject',
  actor: 'Actor',
};

const COLUMN_TRACKS: Record<EventTableColumn, string> = {
  when: '8.5rem',
  event: '10rem',
  summary: 'minmax(0, 1fr)',
  subject: '9rem',
  actor: '9rem',
};

const SEVERITY_TAG_TYPES: Record<EventSeverity, TagType> = {
  [EventSeverity.INFO]: 'default',
  [EventSeverity.WARNING]: 'warning',
  [EventSeverity.ERROR]: 'error',
};

const props = defineProps({
  events: {
    type: Array as PropType<EventDto[]>,
    required: true,
  },

  /** The expand chevron trails regardless of what this lists. */
  columns: {
    type: Array as PropType<EventTableColumn[]>,
    required: true,
  },
  emptyDescription: {
    type: String,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const userStore = useUserStore();

const eventMessage: FunctionalComponent<{ message: string }> = messageProps =>
  renderInlineMarkdown(messageProps.message);

const gridColumns = computed(() => [...props.columns.map(column => COLUMN_TRACKS[column]), '1rem'].join(' '));

const minWidth = computed(() => (props.columns.length > 3 ? 900 : 560));

const hasDetail = (event: EventDto): boolean => Object.keys(event.detail).length > 0;

/** A party without a name was deleted, so it has no page left to open. */
const partyTo = (type: EventPartyType, id: string | undefined, name: string | undefined): string | undefined => {
  if (name === undefined || (type === EventPartyType.USER && !userStore.hasRole(UserRoleId.USER_ADMIN))) {
    return undefined;
  }

  return eventPartyPath(type, id);
};

const party = (type: EventPartyType | undefined, id: string | undefined, name: string | undefined): IParty => {
  if (type === undefined) {
    return { name, reference: '', to: undefined };
  }

  return { name, reference: id === undefined ? type : `${type} ${id}`, to: partyTo(type, id, name) };
};

const partyOf = (event: EventDto, column: 'subject' | 'actor'): IParty =>
  column === 'subject'
    ? party(event.subjectType, event.subjectId, event.subjectName)
    : party(event.actorType, event.actorId, event.actorName);
</script>
