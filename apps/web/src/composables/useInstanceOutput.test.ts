import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import type { InstanceOutputFrameDto } from '@libs/dto';
import { InstanceOutputEndReason } from '@libs/dto';

import { ISseRefusal, ISseSubscription } from '@/services/api/SseService';

import { IInstanceOutputTarget, OUTPUT_RETRY_MS, useInstanceOutput } from './useInstanceOutput';

interface IOpenedStream {
  deploymentId: number;
  instanceKey: string;
  subscription: ISseSubscription;
  send: (frame: InstanceOutputFrameDto) => void;
  refuse: (refusal: ISseRefusal) => void;
}

const KEY = '0199a3f2-6c1e-7b4a-9f00-3d2e1c0b9a87';

const NOT_FOUND: ISseRefusal = { status: 404, message: 'The node holds no container for this instance' };

const mountOutput = (
  instance = ref<IInstanceOutputTarget | null>({ deploymentId: 4, instanceKey: KEY }),
  starting = ref(false)
) => {
  const streams: IOpenedStream[] = [];

  const stream = vi.fn(
    (
      deploymentId: number,
      instanceKey: string,
      onFrame: (frame: InstanceOutputFrameDto) => void,
      onRefusal: (refusal: ISseRefusal) => void
    ): ISseSubscription => {
      const subscription: ISseSubscription = { connected: ref(true), lastActivityDate: ref(null), close: vi.fn() };

      streams.push({ deploymentId, instanceKey, subscription, send: onFrame, refuse: onRefusal });

      return subscription;
    }
  );

  let output: ReturnType<typeof useInstanceOutput> | undefined;

  const host = mount(
    defineComponent({
      setup() {
        output = useInstanceOutput({ instance, starting, stream });

        return () => null;
      },
    })
  );

  return { host, output: output!, stream, streams };
};

describe('useInstanceOutput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the stream for the instance under its deployment at once', () => {
    const { output, streams } = mountOutput();

    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ deploymentId: 4, instanceKey: KEY });
    expect(output.connected.value).toBe(true);
  });

  it('opens nothing without an instance', () => {
    const { stream } = mountOutput(ref(null));

    expect(stream).not.toHaveBeenCalled();
  });

  it('folds each frame into the output', () => {
    const { output, streams } = mountOutput();

    streams[0].send({ kind: 'opened', tailLines: 1000, complete: false });
    streams[0].send({ kind: 'lines', lines: [{ date: null, text: 'listening', cut: false }] });

    expect(output.output.value.tailLines).toBe(1000);
    expect(output.output.value.lines).toHaveLength(1);
  });

  it('closes the stream once the output ends, for either reason, so it never reconnects to re-read and re-record', () => {
    for (const reason of [InstanceOutputEndReason.EXITED, InstanceOutputEndReason.LOST]) {
      const { output, streams } = mountOutput();

      streams[0].send({ kind: 'opened', tailLines: 1000, complete: true });
      streams[0].send({ kind: 'ended', reason });

      expect(streams[0].subscription.close).toHaveBeenCalledTimes(1);
      expect(output.output.value.ended).toBe(reason);
      expect(output.connected.value).toBe(false);
    }
  });

  it('holds a refusal to show, and opens again on request', () => {
    const { output, streams } = mountOutput();

    streams[0].refuse({ status: 409, message: "This instance's node is not connected" });

    expect(output.refusal.value).not.toBeNull();
    expect(output.connected.value).toBe(false);

    output.open();

    expect(streams).toHaveLength(2);
    expect(output.refusal.value).toBeNull();
  });

  it('moves to another instance, closing the stream it held', async () => {
    const instance = ref<IInstanceOutputTarget | null>({ deploymentId: 4, instanceKey: KEY });
    const { output, streams } = mountOutput(instance);

    streams[0].send({ kind: 'opened', tailLines: 1000, complete: false });

    instance.value = { deploymentId: 4, instanceKey: 'another' };
    await nextTick();

    expect(streams[0].subscription.close).toHaveBeenCalledTimes(1);
    expect(streams[1].instanceKey).toBe('another');
    expect(output.output.value.tailLines).toBeNull();
  });

  it('closes the stream when the page goes', () => {
    const { host, streams } = mountOutput();

    host.unmount();

    expect(streams[0].subscription.close).toHaveBeenCalledTimes(1);
  });

  describe('while the instance starts', () => {
    it('waits out a missing container, asking again until the node has one', async () => {
      const { output, streams } = mountOutput(undefined, ref(true));

      streams[0].refuse(NOT_FOUND);
      await nextTick();

      expect(output.waiting.value).toBe(true);
      expect(output.refusal.value).toBeNull();

      await vi.advanceTimersByTimeAsync(OUTPUT_RETRY_MS);

      expect(streams).toHaveLength(2);
      expect(output.waiting.value).toBe(false);

      streams[1].refuse(NOT_FOUND);
      await nextTick();
      await vi.advanceTimersByTimeAsync(OUTPUT_RETRY_MS);

      expect(streams).toHaveLength(3);
    });

    it('shows any other refusal at once', async () => {
      const { output, streams } = mountOutput(undefined, ref(true));

      streams[0].refuse({ status: 409, message: "This instance's node is not connected" });
      await nextTick();
      await vi.advanceTimersByTimeAsync(OUTPUT_RETRY_MS);

      expect(output.waiting.value).toBe(false);
      expect(output.refusal.value).not.toBeNull();
      expect(streams).toHaveLength(1);
    });

    it('stops waiting once the instance leaves starting, asking one last time', async () => {
      const starting = ref(true);
      const { output, streams } = mountOutput(undefined, starting);

      streams[0].refuse(NOT_FOUND);
      await nextTick();

      starting.value = false;
      await nextTick();

      expect(streams).toHaveLength(2);

      streams[1].refuse(NOT_FOUND);
      await nextTick();
      await vi.advanceTimersByTimeAsync(OUTPUT_RETRY_MS);

      expect(streams).toHaveLength(2);
      expect(output.refusal.value).not.toBeNull();
    });

    it('stops waiting when the page goes', async () => {
      const { host, streams } = mountOutput(undefined, ref(true));

      streams[0].refuse(NOT_FOUND);
      await nextTick();

      host.unmount();
      await vi.advanceTimersByTimeAsync(OUTPUT_RETRY_MS);

      expect(streams).toHaveLength(1);
    });
  });
});
