<template>
  <ui-tag v-if="mark" :type="mark.tone">{{ mark.label }}</ui-tag>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';

import type { ModelLicenceDto } from '@libs/dto';

import { licenceMark } from '@/utils/model';

import { UiTag } from '@/components/ui';

const props = defineProps({
  licence: {
    type: Object as PropType<ModelLicenceDto | null>,
    default: null,
  },
});

const mark = computed(() => licenceMark(props.licence));
</script>
