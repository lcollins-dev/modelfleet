import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { DeploymentInstancesResponseDto, InstanceOutputFrameDto, ListInstanceDto } from '@libs/dto';
import { InstanceOutputEndReason, InstanceState, NodeState, ResidencyRule } from '@libs/dto';

import { ISseRefusal, ISseSubscription } from '@/services/api/SseService';

import Instance from './Instance.vue';
import { OUTPUT_RETRY_MS } from '@/composables/useInstanceOutput';

const KEY = '0199a3f2-6c1e-7b4a-9f00-3d2e1c0b9a87';

const streamDeploymentInstances = vi.fn();
const streamInstanceOutput = vi.fn();

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ streamDeploymentInstances, streamInstanceOutput }),
}));

const subscription = (): ISseSubscription => ({
  connected: ref(true),
  lastActivityDate: ref(new Date()),
  close: vi.fn(),
});

const instance = (state: InstanceState, extra: Partial<ListInstanceDto> = {}): ListInstanceDto => ({
  instanceKey: KEY,
  deploymentId: 4,
  deploymentName: 'llama-70b-chat',
  nodeId: 3,
  nodeName: 'gpu-a-01',
  nodeState: NodeState.ONLINE,
  devices: [],
  state,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date(),
  ...extra,
});

const instancesResponse = (instances: ListInstanceDto[]): DeploymentInstancesResponseDto => ({
  instances,
  placement: { nodes: [], problem: null },
  residency: {
    rule: ResidencyRule.ALWAYS,
    idleTimeoutMs: null,
    lastUsedDate: null,
    idleSince: null,
    inFlight: 0,
    launchFailures: 0,
    retryDate: null,
    givenUp: false,
    lastLaunchFailure: null,
  },
});

const sendInstances = async (instances: ListInstanceDto[]) => {
  const onInstances = streamDeploymentInstances.mock.calls[0][1] as (response: DeploymentInstancesResponseDto) => void;

  onInstances(instancesResponse(instances));
  await flushPromises();
};

const outputStream = (index: number) => ({
  send: streamInstanceOutput.mock.calls[index][2] as (frame: InstanceOutputFrameDto) => void,
  refuse: streamInstanceOutput.mock.calls[index][3] as (refusal: ISseRefusal) => void,
});

const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployments/:deploymentId(\\d+)/instance/:instanceKey', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push(`/deployments/4/instance/${KEY}`);

  const wrapper = mount(Instance, { global: { plugins: [router] } });
  await flushPromises();

  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();

  streamDeploymentInstances.mockImplementation(subscription);
  streamInstanceOutput.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Instance page', () => {
  it('opens the output under its deployment, heading it with the short key and its state', async () => {
    const wrapper = await mountPage();

    expect(streamDeploymentInstances.mock.calls[0][0]).toBe(4);
    expect(streamInstanceOutput.mock.calls[0].slice(0, 2)).toEqual([4, KEY]);

    await sendInstances([instance(InstanceState.READY)]);

    expect(wrapper.get('h1').text()).toBe('Instance 1c0b9a87');
    expect(wrapper.get('[data-testid="instance-state"]').text()).toBe('Ready');
  });

  it('details the instance, linking its deployment and node', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="instance-details"]').exists()).toBe(false);

    await sendInstances([
      instance(InstanceState.READY, {
        devices: [{ deviceKey: 'GPU-1', name: 'NVIDIA A100-SXM4-80GB' }],
        startedDate: new Date(Date.now() - 90 * 60 * 1000),
        reportedDate: new Date(),
      }),
    ]);

    const details = wrapper.get('[data-testid="instance-details"]');

    expect(details.get('[data-testid="instance-deployment-link"]').attributes('href')).toBe('/deployments/4');
    expect(details.get('[data-testid="instance-deployment-link"]').text()).toBe('llama-70b-chat');
    expect(details.get('[data-testid="instance-node-link"]').attributes('href')).toBe('/nodes/3');
    expect(details.get('[data-testid="instance-node-link"]').text()).toBe('gpu-a-01');
    expect(details.text()).toContain('NVIDIA A100-SXM4-80GB');
    expect(details.get('[data-testid="instance-uptime"]').text()).toContain('1h 30m');
    expect(details.get('[data-testid="instance-reported"]').text()).toContain('a few seconds ago');
    expect(details.find('[data-testid="instance-exit-code"]').exists()).toBe(false);
  });

  it('shows the exit code only once the instance has failed', async () => {
    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.FAILED, { exitCode: 137 })]);

    expect(wrapper.get('[data-testid="instance-exit-code"]').text()).toContain('137');
  });

  it('reads as removed once the instance leaves the deployment', async () => {
    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.READY)]);
    await sendInstances([]);

    expect(wrapper.get('[data-testid="instance-state"]').text()).toBe('Removed');
  });

  it('shows a refusal in place of the output, and tries again on request', async () => {
    const wrapper = await mountPage();

    outputStream(0).refuse({ status: 404, message: 'This deployment has no such instance' });
    await flushPromises();

    expect(wrapper.get('[data-testid="output-refusal"]').text()).toContain('This deployment has no such instance.');
    expect(wrapper.find('[data-testid="instance-output"]').exists()).toBe(false);

    await wrapper.get('[data-testid="output-refusal"] button').trigger('click');

    expect(streamInstanceOutput).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="output-refusal"]').exists()).toBe(false);
  });

  it('falls back to the output the node kept when a failed instance has no container to stream', async () => {
    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.FAILED, { exitCode: 1, message: 'error: unknown argument --flash' })]);
    outputStream(0).refuse({ status: 404, message: 'The node holds no container for this instance' });
    await flushPromises();

    const failure = wrapper.get('[data-testid="output-failure"]');

    expect(failure.text()).toContain('The backend exited 1');
    expect(failure.text()).toContain('not its full log');
    expect(failure.get('pre').text()).toBe('error: unknown argument --flash');
    expect(wrapper.find('[data-testid="output-refusal"]').exists()).toBe(false);
  });

  it('shows the colours of the output the node kept, without their escape sequences', async () => {
    const wrapper = await mountPage();

    await sendInstances([
      instance(InstanceState.FAILED, { exitCode: 1, message: '\u001b[31mERROR\u001b[0m CUDA out of memory' }),
    ]);
    outputStream(0).refuse({ status: 404, message: 'The node holds no container for this instance' });
    await flushPromises();

    const output = wrapper.get('[data-testid="output-failure"] pre');

    expect(output.text()).toBe('ERROR CUDA out of memory');
    expect(output.get('span.text-error').text()).toBe('ERROR');
  });

  it('says so when the output a failed instance kept shows nothing', async () => {
    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.FAILED, { exitCode: 1, message: '\u001b[0m\u001b[K\r\n' })]);
    outputStream(0).refuse({ status: 404, message: 'The node holds no container for this instance' });
    await flushPromises();

    expect(wrapper.get('[data-testid="output-failure"] pre').text()).toBe(
      'The node reported no output from this backend.'
    );
  });

  it('says so when a failed instance kept no output', async () => {
    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.FAILED)]);
    outputStream(0).refuse({ status: 404, message: 'The node holds no container for this instance' });
    await flushPromises();

    expect(wrapper.get('[data-testid="output-failure"]').text()).toContain('The launch failed');
    expect(wrapper.get('[data-testid="output-failure"] pre').text()).toBe(
      'The node reported no output from this backend.'
    );
  });

  it("streams a failed instance's container while it has one", async () => {
    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.FAILED, { exitCode: 1, message: 'error: out of memory' })]);

    expect(wrapper.find('[data-testid="output-failure"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="instance-output"]').exists()).toBe(true);
  });

  it('waits, rather than refusing, while a starting instance has no container yet', async () => {
    vi.useFakeTimers();

    const wrapper = await mountPage();

    await sendInstances([instance(InstanceState.STARTING)]);
    outputStream(0).refuse({ status: 404, message: 'The node holds no container for this instance' });
    await flushPromises();

    expect(wrapper.find('[data-testid="output-refusal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="output-waiting"]').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(OUTPUT_RETRY_MS);

    expect(streamInstanceOutput).toHaveBeenCalledTimes(2);
  });

  it('offers to reconnect once the node connection is lost', async () => {
    const wrapper = await mountPage();

    outputStream(0).send({ kind: 'opened', tailLines: 1000, complete: false });
    outputStream(0).send({ kind: 'ended', reason: InstanceOutputEndReason.LOST });
    await flushPromises();

    await wrapper.get('[data-testid="output-lost"] button').trigger('click');

    expect(streamInstanceOutput).toHaveBeenCalledTimes(2);
  });

  it('closes both streams when the page goes', async () => {
    const wrapper = await mountPage();
    const instances = streamDeploymentInstances.mock.results[0].value as ISseSubscription;
    const output = streamInstanceOutput.mock.results[0].value as ISseSubscription;

    wrapper.unmount();

    expect(instances.close).toHaveBeenCalledOnce();
    expect(output.close).toHaveBeenCalledOnce();
  });
});
