import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import { IResourceOptions, useResource } from './useResource';

interface IJob {
  id: number;
  name: string;
}

const JOB: IJob = { id: 1, name: 'cleanup' };

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const mountResource = (options: IResourceOptions<number, IJob>) => {
  let resource: ReturnType<typeof useResource<number, IJob>> | undefined;

  mount(
    defineComponent({
      setup() {
        resource = useResource(options);

        return () => null;
      },
    })
  );

  return resource!;
};

const fetchJob = (jobId: number): Promise<IJob> => Promise.resolve({ id: jobId, name: `job ${jobId}` });

describe('useResource', () => {
  it('loads the entity at once', async () => {
    const fetchMock = vi.fn(fetchJob);
    const resource = mountResource({ request: 1, fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(1);
    expect(resource.data.value).toBeNull();
    expect(resource.loading.value).toBe(true);

    await flushPromises();

    expect(resource.data.value).toEqual({ id: 1, name: 'job 1' });
    expect(resource.loading.value).toBe(false);
  });

  it('fetches nothing while the request is null, then loads once it is set', async () => {
    const fetchMock = vi.fn(fetchJob);
    const request = ref<number | null>(null);
    const resource = mountResource({ request, fetch: fetchMock });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(resource.loading.value).toBe(false);

    request.value = 2;
    await nextTick();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(2);
    expect(resource.data.value).toEqual({ id: 2, name: 'job 2' });
  });

  it('refetches when the request changes', async () => {
    const fetchMock = vi.fn(fetchJob);
    const request = ref(1);
    const resource = mountResource({ request, fetch: fetchMock });
    await flushPromises();

    request.value = 2;
    await nextTick();
    await flushPromises();

    expect(fetchMock).toHaveBeenLastCalledWith(2);
    expect(resource.data.value).toEqual({ id: 2, name: 'job 2' });
  });

  it('keeps the latest entity when an earlier request answers last', async () => {
    let answerFirst: (job: IJob) => void = () => undefined;
    const fetchMock = vi
      .fn<(jobId: number) => Promise<IJob>>()
      .mockReturnValueOnce(new Promise(resolve => (answerFirst = resolve)))
      .mockImplementation(fetchJob);
    const request = ref(1);
    const resource = mountResource({ request, fetch: fetchMock });

    request.value = 2;
    await nextTick();
    await flushPromises();

    answerFirst(JOB);
    await flushPromises();

    expect(resource.data.value).toEqual({ id: 2, name: 'job 2' });
    expect(resource.loading.value).toBe(false);
  });

  it('settles reload once the entity lands', async () => {
    const fetchMock = vi.fn(fetchJob);
    const resource = mountResource({ request: 1, fetch: fetchMock });
    await flushPromises();
    fetchMock.mockResolvedValueOnce({ id: 1, name: 'renamed' });

    await resource.reload();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resource.data.value).toEqual({ id: 1, name: 'renamed' });
  });

  it('keeps the last entity and clears loading when a fetch fails, without rejecting reload', async () => {
    const fetchMock = vi.fn(fetchJob);
    const resource = mountResource({ request: 1, fetch: fetchMock });
    await flushPromises();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(resource.reload()).resolves.toBeUndefined();

    expect(resource.data.value).toEqual({ id: 1, name: 'job 1' });
    expect(resource.loading.value).toBe(false);
  });
});
