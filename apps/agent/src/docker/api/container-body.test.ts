import { describe, expect, it } from 'vitest';

import { BackendId, DevicePresentation, ContainerSettings } from '@libs/backends';
import { BACKEND_LABEL, IContainerSpecification, INSTANCE_LABEL } from '@libs/backends/runtime';

import { containerCreateBody, IContainerBodyInput } from '@/docker/api/container-body';
import { TEST_DEVICE_KEY, TEST_INSTANCE_KEY } from '@/test/instance.factory';

const PORT_KEY = '8080/tcp';
const NETWORK = 'modelfleet-instances';
const SUPERVISION_LABEL = 'modelfleet.test';

const container = (overrides: Partial<ContainerSettings> = {}): ContainerSettings => ({
  multiDevice: true,
  cpuOffload: true,
  devicePresentation: DevicePresentation.DEVICE_REQUEST,
  stopGraceSeconds: 30,
  sharedMemoryBytes: 1024 * 1024 * 1024,
  ...overrides,
});

const specification = (overrides: Partial<IContainerSpecification> = {}): IContainerSpecification => ({
  image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
  command: ['--model', '/models/model.gguf'],
  environment: { LLAMA_LOG: 'debug' },
  devices: [{ deviceKey: TEST_DEVICE_KEY }],
  mounts: [{ hostPath: '/srv/models/model.gguf', containerPath: '/models/model.gguf', readOnly: true }],
  labels: { [INSTANCE_LABEL]: TEST_INSTANCE_KEY, [BACKEND_LABEL]: BackendId.LLAMA_CPP },
  port: 8080,
  ...overrides,
});

const input = (overrides: Partial<IContainerBodyInput> = {}): IContainerBodyInput => ({
  instanceKey: TEST_INSTANCE_KEY,
  specification: specification(),
  container: container(),
  labels: { [SUPERVISION_LABEL]: 'agent' },
  network: NETWORK,
  ...overrides,
});

describe('containerCreateBody', () => {
  it('names the container after the instance, so a leftover one is found by name as well as by label', () => {
    expect(containerCreateBody(input()).name).toBe(`modelfleet-${TEST_INSTANCE_KEY}`);
  });

  it('carries the specification through unchanged', () => {
    const body = containerCreateBody(input());

    expect(body.Image).toBe('ghcr.io/ggml-org/llama.cpp:server-cuda');
    expect(body.Cmd).toEqual(['--model', '/models/model.gguf']);
    expect(body.Env).toEqual(['LLAMA_LOG=debug']);
  });

  it("keeps the image's entrypoint unless the specification replaces it", () => {
    expect(containerCreateBody(input())).not.toHaveProperty('Entrypoint');
    expect(containerCreateBody(input({ specification: specification({ entrypoint: ['/serve'] }) })).Entrypoint).toEqual(
      ['/serve']
    );
  });

  it('mounts the weights read only', () => {
    expect(containerCreateBody(input()).HostConfig?.Binds).toEqual(['/srv/models/model.gguf:/models/model.gguf:ro']);
  });

  it('requests the pinned devices by UUID, so no ordinal is translated anywhere', () => {
    expect(containerCreateBody(input()).HostConfig?.DeviceRequests).toEqual([
      { Driver: 'nvidia', DeviceIDs: [TEST_DEVICE_KEY], Capabilities: [['gpu']] },
    ]);
  });

  it('orders the requested devices as pinned for a backend that asks, so it reads a per-device argument in pin order', () => {
    const devices = [{ deviceKey: 'GPU-cccc' }, { deviceKey: 'GPU-aaaa' }, { deviceKey: 'GPU-bbbb' }];
    const body = containerCreateBody(
      input({ specification: specification({ devices }), container: container({ pinOrderedDevices: true }) })
    );

    expect(body.Env).toEqual(['LLAMA_LOG=debug', 'CUDA_VISIBLE_DEVICES=GPU-cccc,GPU-aaaa,GPU-bbbb']);
  });

  it('leaves the device order to CUDA for a backend that does not ask, which may read the variable as ordinals', () => {
    expect(containerCreateBody(input()).Env).toEqual(['LLAMA_LOG=debug']);
  });

  it('orders nothing where the instance holds no device', () => {
    const body = containerCreateBody(
      input({ specification: specification({ devices: [] }), container: container({ pinOrderedDevices: true }) })
    );

    expect(body.Env).toEqual(['LLAMA_LOG=debug']);
  });

  it('presents devices in the environment for a backend that reads them there', () => {
    const body = containerCreateBody(
      input({ container: container({ devicePresentation: DevicePresentation.ENVIRONMENT }) })
    );

    expect(body.Env).toContain(`NVIDIA_VISIBLE_DEVICES=${TEST_DEVICE_KEY}`);
    expect(body.HostConfig?.DeviceRequests).toBeUndefined();
  });

  it('publishes nothing on the host, so a backend is reachable only from the agent network', () => {
    const body = containerCreateBody(input());

    expect(body.ExposedPorts).toEqual({ [PORT_KEY]: {} });
    expect(body.HostConfig?.PortBindings).toBeUndefined();
    expect(body.HostConfig?.NetworkMode).toBe(NETWORK);
    expect(body.NetworkingConfig?.EndpointsConfig).toEqual({ [NETWORK]: {} });
  });

  it("carries the adapter's own labels and the agent's alongside them", () => {
    const labels = containerCreateBody(input()).Labels ?? {};

    expect(labels[INSTANCE_LABEL]).toBe(TEST_INSTANCE_KEY);
    expect(labels[BACKEND_LABEL]).toBe(BackendId.LLAMA_CPP);
    expect(labels[SUPERVISION_LABEL]).toBe('agent');
  });

  it("sizes shared memory to what the backend declares, over Docker's default", () => {
    const body = containerCreateBody(input({ container: container({ sharedMemoryBytes: 2048 }) }));

    expect(body.HostConfig?.ShmSize).toBe(2048);
  });

  it('carries no restart policy and does not remove itself, so a backend that died can be asked why', () => {
    const body = containerCreateBody(input());

    expect(body.HostConfig?.RestartPolicy).toEqual({ Name: 'no' });
    expect(body.HostConfig?.AutoRemove).toBe(false);
  });
});
