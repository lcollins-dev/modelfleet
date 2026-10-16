<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Event log"
      subtitle="Sign-ins, key changes, and node and deployment activity, newest first."
    />

    <ui-card flush>
      <mf-filter-toolbar>
        <template #start>
          <div class="max-w-96 shrink grow basis-64">
            <ui-multi-select
              v-model:value="filters.type"
              :options="TYPE_OPTIONS"
              placeholder="Any type"
              aria-label="Type"
            />
          </div>

          <div class="w-56 shrink-0">
            <ui-multi-select
              v-model:value="filters.severity"
              :options="SEVERITY_OPTIONS"
              :searchable="false"
              placeholder="Any severity"
              aria-label="Severity"
            />
          </div>
        </template>

        <ui-button
          :aria-expanded="showMoreFilters"
          :aria-controls="showMoreFilters ? 'event-more-filters' : undefined"
          @click="showMoreFilters = !showMoreFilters"
        >
          <template #icon>
            <icon-tune class="size-4" />
          </template>

          More filters

          <ui-count-badge :count="moreFilterCount" class="ml-1.5" />
        </ui-button>
      </mf-filter-toolbar>

      <div
        v-if="showMoreFilters"
        id="event-more-filters"
        class="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-divider px-6 py-3"
        data-testid="event-more-filters"
      >
        <div class="flex shrink-0 gap-2">
          <div class="w-36">
            <ui-select
              v-model:value="filters.subjectType"
              :options="PARTY_OPTIONS"
              clearable
              placeholder="Any subject"
              aria-label="Subject kind"
            />
          </div>

          <div class="w-32">
            <ui-input v-model:value="filters.subjectId" clearable placeholder="Subject id" aria-label="Subject id" />
          </div>
        </div>

        <div class="flex shrink-0 gap-2">
          <div class="w-36">
            <ui-select
              v-model:value="filters.actorType"
              :options="PARTY_OPTIONS"
              clearable
              placeholder="Any actor"
              aria-label="Actor kind"
            />
          </div>

          <div class="w-32">
            <ui-input v-model:value="filters.actorId" clearable placeholder="Actor id" aria-label="Actor id" />
          </div>
        </div>

        <div class="flex shrink-0 gap-2">
          <div class="w-56">
            <ui-input v-model:value="filters.fromDate" type="datetime-local" aria-label="From">
              <template #prefix>From</template>
            </ui-input>
          </div>

          <div class="w-56">
            <ui-input v-model:value="filters.toDate" type="datetime-local" aria-label="To">
              <template #prefix>To</template>
            </ui-input>
          </div>
        </div>

        <div class="flex-1" />

        <ui-button type="text" :disabled="moreFilterCount === 0" @click="clearMoreFilters">Clear</ui-button>
      </div>

      <mf-event-table
        :events="eventList"
        :columns="EVENT_COLUMNS"
        :empty-description="emptyDescription"
        :loading="loading"
      >
        <template #footer>
          <span data-testid="event-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </mf-event-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import IconTune from '~icons/material-symbols/tune-rounded';

import type { EventDto, EventFilterRequestDto } from '@libs/dto';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Config } from '@/Config';

import { formatEventType, matchesEventFilter } from '@/utils/event';
import { formatCount } from '@/utils/format/number';

import { ISseSubscription } from '@/services/api/SseService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';

import { EventTableColumn, MfEventTable, MfFilterToolbar } from '@/components/mf';
import {
  ISelectOption,
  UiButton,
  UiCard,
  UiCountBadge,
  UiInput,
  UiMultiSelect,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiSelect,
} from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

interface IFilters {
  type: EventType[];
  severity: EventSeverity[];
  actorType: EventPartyType | null;
  actorId: string;
  subjectType: EventPartyType | null;
  subjectId: string;
  fromDate: string;
  toDate: string;
}

const EVENT_COLUMNS: EventTableColumn[] = ['when', 'event', 'summary', 'subject', 'actor'];

const TYPE_OPTIONS: ISelectOption<EventType>[] = Object.values(EventType).map(type => ({
  value: type,
  label: formatEventType(type),
}));

const SEVERITY_OPTIONS: ISelectOption<EventSeverity>[] = Object.values(EventSeverity).map(severity => ({
  value: severity,
  label: severity,
}));

const PARTY_OPTIONS: ISelectOption<EventPartyType>[] = Object.values(EventPartyType).map(partyType => ({
  value: partyType,
  label: partyType,
}));

const eventAdminService = useEventAdminService();

const filters = ref<IFilters>({
  type: [],
  severity: [],
  actorType: null,
  actorId: '',
  subjectType: null,
  subjectId: '',
  fromDate: '',
  toDate: '',
});
const showMoreFilters = ref(false);

const subscription = shallowRef<ISseSubscription | null>(null);

const optionalText = (value: string): string | undefined => (value.length > 0 ? value : undefined);

const optionalDate = (value: string): string | undefined =>
  value.length > 0 ? new Date(value).toISOString() : undefined;

const listRequest = computed<EventFilterRequestDto>(() => ({
  type: filters.value.type.length > 0 ? filters.value.type : undefined,
  severity: filters.value.severity.length > 0 ? filters.value.severity : undefined,
  actorType: filters.value.actorType ?? undefined,
  actorId: optionalText(filters.value.actorId),
  subjectType: filters.value.subjectType ?? undefined,
  subjectId: optionalText(filters.value.subjectId),
  fromDate: optionalDate(filters.value.fromDate),
  toDate: optionalDate(filters.value.toDate),
}));

const moreFilterCount = computed(() => {
  const { actorType, actorId, subjectType, subjectId, fromDate, toDate } = filters.value;

  return [
    actorType !== null,
    actorId !== '',
    subjectType !== null,
    subjectId !== '',
    fromDate !== '',
    toDate !== '',
  ].filter(isSet => isSet).length;
});

const emptyDescription = computed(() =>
  filters.value.type.length > 0 || filters.value.severity.length > 0 || moreFilterCount.value > 0
    ? 'No events match your filters.'
    : 'No events recorded yet.'
);

const clearMoreFilters = () => {
  filters.value = {
    ...filters.value,
    actorType: null,
    actorId: '',
    subjectType: null,
    subjectId: '',
    fromDate: '',
    toDate: '',
  };
};

const {
  list: eventList,
  page,
  pages,
  loading,
  load,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    eventAdminService
      .getEventList(request, listPage)
      .then(response => ({ list: response.eventList, pages: response.pages })),
});

const countLabel = computed(() => `Showing ${formatCount(eventList.value.length, 'event')}`);

// The log grows at the head, so only the first page can take an arriving event without shifting.
const onLiveEvent = (event: EventDto) => {
  if (page.value !== 1 || !matchesEventFilter(event, listRequest.value)) {
    return;
  }

  if (eventList.value.some(listedEvent => listedEvent.id === event.id)) {
    return;
  }

  eventList.value = [event, ...eventList.value].slice(0, Config.EVENT_LIVE_MAX);
};

const onReconnect = () => {
  if (page.value !== 1) {
    return;
  }

  void load();
};

onMounted(() => {
  subscription.value = eventAdminService.streamEvents(onLiveEvent, onReconnect);
});

onBeforeUnmount(() => {
  subscription.value?.close();
});
</script>
