import { MaybeRefOrGetter, computed, onBeforeUnmount, shallowRef, toValue, watch } from 'vue';

import type { InstanceOutputFrameDto } from '@libs/dto';

import { RequestStatus } from '@/types/api';

import { IInstanceOutput, applyOutputFrame, describeOutputRefusal, emptyInstanceOutput } from '@/utils/instanceOutput';

import { ISseRefusal, ISseSubscription } from '@/services/api/SseService';

export const OUTPUT_RETRY_MS = 3000;

export interface IInstanceOutputTarget {
  deploymentId: number;
  instanceKey: string;
}

export interface IInstanceOutputOptions {
  /** A change reopens the stream. Null opens nothing. */
  instance: MaybeRefOrGetter<IInstanceOutputTarget | null>;
  /** While true, a 404 is retried rather than shown, since the node may still be pulling the image. */
  starting: MaybeRefOrGetter<boolean>;
  stream: (
    deploymentId: number,
    instanceKey: string,
    onFrame: (frame: InstanceOutputFrameDto) => void,
    onRefusal: (refusal: ISseRefusal) => void
  ) => ISseSubscription;
}

export const useInstanceOutput = (options: IInstanceOutputOptions) => {
  const output = shallowRef<IInstanceOutput>(emptyInstanceOutput());
  const refused = shallowRef<ISseRefusal | null>(null);

  const subscription = shallowRef<ISseSubscription | null>(null);

  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connected = computed(() => subscription.value?.connected.value ?? false);

  const waiting = computed(() => refused.value?.status === RequestStatus.NOT_FOUND && toValue(options.starting));

  const refusal = computed(() =>
    refused.value === null || waiting.value ? null : describeOutputRefusal(refused.value.status, refused.value.message)
  );

  const close = () => {
    subscription.value?.close();
    subscription.value = null;
  };

  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const onFrame = (frame: InstanceOutputFrameDto) => {
    output.value = applyOutputFrame(output.value, frame);

    if (frame.kind === 'ended') {
      close();
    }
  };

  // SseService has already closed the subscription.
  const onRefusal = (refusal: ISseRefusal) => {
    subscription.value = null;
    refused.value = refusal;
  };

  const open = () => {
    clearRetry();
    close();

    output.value = emptyInstanceOutput(output.value.nextId);
    refused.value = null;

    const instance = toValue(options.instance);

    if (instance !== null) {
      subscription.value = options.stream(instance.deploymentId, instance.instanceKey, onFrame, onRefusal);
    }
  };

  // A retry records no read, since the server records one only once the node answers. Leaving starting tries once more.
  watch(waiting, (isWaiting, wasWaiting) => {
    clearRetry();

    if (isWaiting) {
      retryTimer = setTimeout(open, OUTPUT_RETRY_MS);
    } else if (wasWaiting && refused.value !== null) {
      open();
    }
  });

  watch(() => toValue(options.instance), open, { immediate: true });

  onBeforeUnmount(() => {
    clearRetry();
    close();
  });

  return { output, connected, refusal, waiting, open };
};
