<template>
  <ui-page-container>
    <ui-page-heading />

    <ui-form :name="FORM_NAME" @submit="doCreateDownload">
      <ui-card>
        <ui-form-section title="Source" subtitle="Where the weights come from.">
          <ui-form-field
            v-slot="{ input }"
            label="Repository or URL"
            help="A Hugging Face repo ID, or the repo's address."
            path="repository"
            :error="addressInvalid ? ADDRESS_INVALID : ''"
          >
            <ui-input
              v-model:value="repository"
              v-bind="input"
              name="download-repository"
              autocomplete="off"
              placeholder="unsloth/Qwen3-0.6B-GGUF"
              class="font-mono"
              @keydown.enter.prevent="doListFiles"
            />
          </ui-form-field>

          <ui-form-field
            v-slot="{ input }"
            label="Revision"
            help="A branch, tag or commit. Leave empty to use main."
            path="revision"
          >
            <ui-input
              :value="revision"
              v-bind="input"
              name="download-revision"
              autocomplete="off"
              placeholder="main"
              class="font-mono"
              @update:value="editRevision"
              @keydown.enter.prevent="doListFiles"
            />
          </ui-form-field>
        </ui-form-section>

        <ui-form-section title="Files" subtitle="Pick the weights and config files to copy.">
          <div
            v-if="listing !== null && (listing.truncated || overFileLimit || filesError)"
            class="mb-3 flex flex-col gap-3"
          >
            <ui-notice v-if="listing.truncated" type="warning">
              Showing the first {{ listing.files.length }} files in this repository.
            </ui-notice>

            <ui-notice v-if="overFileLimit" type="warning">
              Select up to {{ listing.maxFilesPerDownload }} files per download.
            </ui-notice>

            <ui-field-error v-if="filesError" data-testid="field-error">{{ filesError }}</ui-field-error>
          </div>

          <ui-checklist
            v-model:selected="selectedPaths"
            class="mb-6.5"
            label="Files"
            :items="fileItems"
            :loading="loadingListing"
            :empty="filesEmpty"
            select-all
            mono
            data-testid="download-files"
          >
            <template v-if="listingError !== null" #status>
              <ui-result
                class="px-4 py-6"
                :icon="IconError"
                type="error"
                title="Could not load files"
                data-testid="download-listing-error"
              >
                {{ listingError }}
              </ui-result>
            </template>

            <template #summary>
              <span data-testid="download-selected">
                {{ fileSummary }}
                <span class="font-mono">· {{ listing?.revision.slice(0, 7) }}</span>
              </span>
            </template>
          </ui-checklist>
        </ui-form-section>

        <ui-form-section title="Destination" subtitle="Which nodes get a copy, and where it goes.">
          <ui-form-field
            label="Nodes"
            help="Each node downloads its own copy. Choose a model directory for nodes with multiple directories."
            path="nodeIds"
          >
            <ui-checklist
              v-model:selected="selectedNodes"
              label="Nodes"
              :items="nodeItems"
              :loading="loadingNodes"
              :empty="nodes.length === 0 ? 'No nodes are registered yet.' : ''"
              select-all
              mono
              data-testid="download-nodes"
            >
              <template #summary>{{ nodeSummary }}</template>

              <template #aside="{ item }">
                <span
                  v-if="!choosesDirectory(item.value)"
                  class="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs"
                  :class="spaceOf(item.value).warns ? 'text-warning' : 'text-muted'"
                >
                  <icon-warning v-if="spaceOf(item.value).warns" class="size-4" />
                  {{ spaceOf(item.value).text }}
                </span>
              </template>

              <template #nested="{ item }">
                <div
                  v-if="choosesDirectory(item.value)"
                  role="radiogroup"
                  :aria-label="`Model directory on ${item.label}`"
                  class="[&>*+*]:border-t [&>*+*]:border-divider"
                  data-testid="download-model-directories"
                >
                  <div
                    v-for="modelDirectory of directoriesOf(item.value)"
                    :key="modelDirectory.path"
                    class="flex items-center gap-3 py-1.5 pl-10 pr-4"
                    data-testid="download-model-directory"
                  >
                    <ui-radio
                      :selected="chosenDirectoryOf(item.value)?.path ?? null"
                      :name="`model-directory-${item.value}`"
                      :value="modelDirectory.path"
                      class="min-w-0 flex-1"
                      @update:selected="path => chooseDirectory(item.value, path)"
                    >
                      <mf-download-file-path :path="modelDirectory.path" />
                    </ui-radio>

                    <span
                      class="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs"
                      :class="directorySpaceOf(modelDirectory).warns ? 'text-warning' : 'text-muted'"
                    >
                      <icon-warning v-if="directorySpaceOf(modelDirectory).warns" class="size-4" />
                      {{ directorySpaceOf(modelDirectory).text }}
                    </span>
                  </div>
                </div>
              </template>
            </ui-checklist>
          </ui-form-field>

          <ui-form-field
            v-slot="{ input }"
            label="Folder"
            help="Folder within the model directory on each node."
            path="directory"
          >
            <ui-input
              :value="directory"
              v-bind="input"
              name="download-directory"
              autocomplete="off"
              placeholder="huggingface/owner/name"
              class="font-mono"
              @update:value="editDirectory"
            />
          </ui-form-field>
        </ui-form-section>

        <template #footer>
          <div class="flex gap-2">
            <ui-button :disabled="loadingCreate" @click="goBack()">Cancel</ui-button>

            <ui-button type="primary" native-type="submit" :loading="loadingCreate">Start Download</ui-button>
          </div>
        </template>
      </ui-card>
    </ui-form>
  </ui-page-container>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import IconError from '~icons/material-symbols/error-outline-rounded';
import IconWarning from '~icons/material-symbols/warning-outline-rounded';

import type {
  DownloadModelDirectoryRequestDto,
  FleetTelemetryResponseDto,
  ListNodeDto,
  ModelDirectorySpaceDto,
  NodeHostTelemetryDto,
  RepositoryListingResponseDto,
} from '@libs/dto';
import { NodeState } from '@libs/dto';

import { ValidationError } from '@/types/error';

import { Config } from '@/Config';

import {
  IDownloadSpace,
  defaultDownloadDirectory,
  describeDownloadSpace,
  downloadModelDirectory,
  parseRepositoryAddress,
  selectedBytes,
} from '@/utils/download';
import { formatBytes } from '@/utils/format/number';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useDownloadAdminService } from '@/services/api/admin/DownloadAdminService';
import { useNodeAdminService } from '@/services/api/admin/NodeAdminService';
import { useTelemetryAdminService } from '@/services/api/admin/TelemetryAdminService';
import { useErrorStore } from '@/stores/error';
import { useToastStore } from '@/stores/toast';

import { MfDownloadFilePath } from '@/components/mf';
import {
  IChecklistItem,
  UiButton,
  UiCard,
  UiChecklist,
  UiFieldError,
  UiForm,
  UiFormField,
  UiFormSection,
  UiInput,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiRadio,
  UiResult,
} from '@/components/ui';

import { useGoBack } from '@/composables/useGoBack';
import { usePage } from '@/composables/usePage';

usePage({
  title: 'New download',
  subtitle: 'Pull files onto one or more nodes. Each node downloads its own copy.',
  back: '/downloads',
  transient: true,
});

const FORM_NAME = 'create-download';

const ADDRESS_INVALID = "Enter owner/name, or a model repository's address on huggingface.co.";

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/downloads/Create');

const router = useRouter();
const { goBack } = useGoBack();

const downloadAdminService = useDownloadAdminService();
const nodeAdminService = useNodeAdminService();
const telemetryAdminService = useTelemetryAdminService();
const errorStore = useErrorStore();
const toastStore = useToastStore();

const repository = ref('');
const revision = ref('');
const revisionFromAddress = ref(false);
const addressInvalid = ref(false);

const listing = ref<RepositoryListingResponseDto | null>(null);
const listingError = ref<string | null>(null);
const listingKey = ref<string | null>(null);
const selectedPaths = ref<string[]>([]);

const directory = ref('');
const directoryEdited = ref(false);
const selectedNodes = ref<string[]>([]);

/** By node id. A node with none chosen, or whose choice it no longer reports, takes its first. */
const chosenDirectories = ref(new Map<number, string>());

const nodes = ref<ListNodeDto[]>([]);
const hosts = ref(new Map<number, NodeHostTelemetryDto | null>());
const telemetrySubscription = shallowRef<ISseSubscription | null>(null);

const loadingNodes = ref(true);
const loadingListing = ref(false);
const loadingCreate = ref(false);

const totalBytes = computed(() =>
  listing.value === null ? 0 : selectedBytes(listing.value.files, selectedPaths.value)
);

const overFileLimit = computed(
  () => listing.value !== null && selectedPaths.value.length > listing.value.maxFilesPerDownload
);

const filesError = computed(() => errorStore.getFieldError(FORM_NAME, 'files'));

const fileItems = computed<IChecklistItem[]>(() =>
  (listing.value?.files ?? []).map(file => ({ value: file.path, label: file.path, meta: formatBytes(file.sizeBytes) }))
);

const nodeItems = computed<IChecklistItem[]>(() =>
  nodes.value.map(node => ({ value: `${node.id}`, label: node.name }))
);

const filesEmpty = computed(() => {
  if (listing.value === null) {
    return 'Enter a repository to see its files.';
  }

  return listing.value.files.length === 0 ? 'This repo holds no files.' : '';
});

const fileSummary = computed(() => {
  if (listing.value === null || selectedPaths.value.length === 0) {
    return 'None selected';
  }

  return `${selectedPaths.value.length} of ${listing.value.files.length} selected · ${formatBytes(totalBytes.value)}`;
});

const nodeSummary = computed(() =>
  selectedNodes.value.length === 0 ? 'None selected' : `${selectedNodes.value.length} of ${nodes.value.length} selected`
);

const nodeOf = (nodeValue: string): ListNodeDto | undefined =>
  nodes.value.find(candidate => `${candidate.id}` === nodeValue);

const chosenDirectoryOf = (nodeValue: string): ModelDirectorySpaceDto | undefined => {
  const node = nodeOf(nodeValue);

  return node === undefined
    ? undefined
    : downloadModelDirectory(hosts.value.get(node.id) ?? null, chosenDirectories.value.get(node.id));
};

/** Only an online node's, since an offline node's last report may no longer hold. */
const directoriesOf = (nodeValue: string): ModelDirectorySpaceDto[] => {
  const node = nodeOf(nodeValue);

  return node?.state === NodeState.ONLINE ? (hosts.value.get(node.id)?.modelDirectories ?? []) : [];
};

const choosesDirectory = (nodeValue: string): boolean =>
  selectedNodes.value.includes(nodeValue) && directoriesOf(nodeValue).length > 1;

/** The radios offer no clear, so they never send null. */
const chooseDirectory = (nodeValue: string, path: string | null) => {
  if (path !== null) {
    chosenDirectories.value = new Map(chosenDirectories.value).set(parseInt(nodeValue, 10), path);
  }
};

const directorySpaceOf = (directory: ModelDirectorySpaceDto): IDownloadSpace =>
  describeDownloadSpace(directory, totalBytes.value);

const spaceOf = (nodeValue: string): IDownloadSpace =>
  nodeOf(nodeValue)?.state === NodeState.ONLINE
    ? describeDownloadSpace(chosenDirectoryOf(nodeValue), totalBytes.value)
    : { warns: false, text: 'Offline' };

/** Every ticked node the console knows a directory for, so the download's page can name it. */
const modelDirectoryChoices = (): DownloadModelDirectoryRequestDto[] =>
  selectedNodes.value.flatMap(nodeValue => {
    const directory = nodeOf(nodeValue)?.state === NodeState.ONLINE ? chosenDirectoryOf(nodeValue) : undefined;

    return directory === undefined ? [] : [{ nodeId: parseInt(nodeValue, 10), path: directory.path }];
  });

/** A reply is kept only while its key is current, and a request already sent for the current key is not sent again. */
const keyOf = (requestedRepository: string, requestedRevision: string): string =>
  `${requestedRepository}\n${requestedRevision}`;

/** Follows the revision a pasted address names, until the operator types one of their own. */
watch(repository, value => {
  const address = parseRepositoryAddress(value);

  addressInvalid.value = false;

  if (address?.revision !== null && address?.revision !== undefined) {
    revision.value = address.revision;
    revisionFromAddress.value = true;
  } else if (revisionFromAddress.value) {
    revision.value = '';
    revisionFromAddress.value = false;
  }
});

const editRevision = (value: string) => {
  revision.value = value;
  revisionFromAddress.value = false;
};

/** Follows the listed repository until the operator types a destination of their own. */
const editDirectory = (value: string) => {
  directory.value = value;
  directoryEdited.value = true;
};

const doGetNodes = async () => {
  const listed: ListNodeDto[] = [];
  let page = 1;
  let pages = 1;

  while (page <= pages) {
    const response = await nodeAdminService.getNodeList({}, page);

    listed.push(...response.nodeList);
    pages = response.pages;
    page += 1;
  }

  nodes.value = listed;
};

const onFleet = (fleet: FleetTelemetryResponseDto) => {
  hosts.value = new Map(fleet.nodes.map(node => [node.nodeId, node.status.host]));
};

const doListFiles = () => {
  const key = keyOf(repository.value, revision.value);

  if (listingKey.value === key) {
    return;
  }

  const address = parseRepositoryAddress(repository.value);

  if (address === null) {
    addressInvalid.value = repository.value.trim().length > 0;

    return;
  }

  listingKey.value = key;
  loadingListing.value = true;
  downloadAdminService
    .getRepositoryListing({
      repository: address.repository,
      revision: revision.value.trim().length > 0 ? revision.value.trim() : undefined,
    })
    .then(response => {
      if (listingKey.value !== key) {
        return;
      }

      listing.value = response;

      if (!directoryEdited.value) {
        directory.value = defaultDownloadDirectory(response.repository);
      }
    })
    .finally(() => {
      if (listingKey.value === key) {
        loadingListing.value = false;
      }
    })
    .catch((error: unknown) => {
      // Forgets the key, so submitting the same source again retries it.
      if (listingKey.value === key) {
        listingError.value = listingErrorOf(error);
        listingKey.value = null;
      }

      logger.error({ error }, 'doListFiles(): Failed to list the repository');
    });
};

/** The listing is sent outside the form, so a refusal keyed to a field reads here, in place of the files. */
const listingErrorOf = (error: unknown): string => {
  if (error instanceof ValidationError) {
    return Object.values(error.fields)
      .flatMap(field => (field === undefined ? [] : [field.message]))
      .join(' ');
  }

  return error instanceof Error ? error.message : 'The repo could not be listed.';
};

const debouncedListFiles = useDebounceFn(doListFiles, Config.LIST_DEBOUNCE_MS);

/** A listing stands only for the repository and revision it was read at, so what starts is what was shown. */
watch([repository, revision], () => {
  listing.value = null;
  listingError.value = null;
  listingKey.value = null;
  loadingListing.value = false;
  selectedPaths.value = [];

  debouncedListFiles().catch((error: unknown) => {
    logger.error({ error }, 'watch(): Failed to list the repository');
  });
});

const doCreateDownload = () => {
  if (listing.value === null || loadingCreate.value) {
    return;
  }

  const listed = listing.value;

  loadingCreate.value = true;
  downloadAdminService
    .createDownload(
      {
        repository: listed.repository,
        revision: listed.revision,
        directory: directory.value.trim(),
        files: listed.files.filter(file => selectedPaths.value.includes(file.path)).map(file => file.path),
        nodeIds: selectedNodes.value.map(nodeValue => parseInt(nodeValue, 10)),
        modelDirectories: modelDirectoryChoices(),
      },
      FORM_NAME
    )
    .then(() => {
      toastStore.addToast('Download started');

      return router.push('/downloads');
    })
    .finally(() => {
      loadingCreate.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCreateDownload(): Failed to create download');
    });
};

onMounted(() => {
  doGetNodes()
    .finally(() => {
      loadingNodes.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'onMounted(): Failed to get node list');
    });

  telemetrySubscription.value = telemetryAdminService.streamFleetTelemetry(onFleet);
});

onBeforeUnmount(() => {
  telemetrySubscription.value?.close();
});
</script>
