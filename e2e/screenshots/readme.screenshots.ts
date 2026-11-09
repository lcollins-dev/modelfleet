import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { resolve } from 'node:path';

import { SignInPage } from '../pages/SignInPage';
import { webRoute } from '../utils/urls';
import { TEST_USER } from '../utils/users';

const OUT_DIR = resolve(__dirname, '../../resources/screenshots');

// Outlasts the 150 ms colour transitions on the selected tab and hovered rows.
const SETTLE_MS = 500;

// A 4B GGUF loads in well under a minute; the rest covers a cold disk.
const INSTANCE_READY_MS = 5 * 60_000;
// A GPU launch Docker refuses never fails outright: the scheduler backs off, so the fallback waits only this long.
const GPU_ATTEMPT_MS = 60_000;

// What a 4B GGUF takes on a 32 GiB card, shown where the instance ran on the CPU.
const FAKE_HOST = {
  cpu: 'AMD EPYC 9124 16-Core Processor',
  owner: 'gemma-3-4b',
  modelDirectory: '/var/lib/modelfleet/models',
};
const FAKE_PLACEMENT = { vram: '3.4 GiB / 28.4 GiB free', ram: '8.2 GiB / 9.9 GiB free' };

interface IFleetTelemetry {
  nodes: {
    nodeId: number;
    status: { telemetryState: string | null; devices: { deviceKey: string; name: string | null }[] };
  }[];
}

interface IPinnedGpu {
  nodeId: number;
  deviceKey: string;
  name: string;
}

interface IModelList {
  modelList: { id: number }[];
}

interface IDeploymentInstances {
  instances: { state: string }[];
}

type SettledState = 'ready' | 'failed';

const DEPLOYMENT = {
  name: 'gemma-3-4b',
  presetId: null,
  backend: 'llama.cpp',
  activationPolicy: 'always',
  description: 'Chat and vision for the support assistant',
};

const authorization = async (page: Page): Promise<Record<string, string>> => {
  const token = await page.evaluate(() => localStorage.getItem('token'));

  return { Authorization: `Bearer ${token ?? ''}` };
};

// A node reconnecting after the database was cleaned reports its GPU and models a few seconds in.
const NODE_REPORT_MS = 60_000;

const firstGpu = async (request: APIRequestContext, headers: Record<string, string>): Promise<IPinnedGpu> => {
  let gpu: IPinnedGpu | undefined;

  await expect
    .poll(
      async () => {
        const response = await request.get('/api/v1/admin/telemetry', { headers });
        const { nodes } = (await response.json()) as IFleetTelemetry;
        // An offline node still lists the GPUs it last reported.
        const node = nodes.find(entry => entry.status.telemetryState !== null && entry.status.devices.length > 0);
        const device = node?.status.devices[0];

        gpu =
          node === undefined || device === undefined
            ? undefined
            : { nodeId: node.nodeId, deviceKey: device.deviceKey, name: device.name ?? device.deviceKey };

        return gpu;
      },
      { message: 'a node reporting a GPU', timeout: NODE_REPORT_MS }
    )
    .toBeDefined();

  if (gpu === undefined) {
    throw new Error('No node reports a GPU');
  }

  return gpu;
};

const gemmaModelId = async (request: APIRequestContext, headers: Record<string, string>): Promise<number> => {
  let modelId: number | undefined;

  await expect
    .poll(
      async () => {
        const response = await request.patch('/api/v1/admin/model/list?page=1', {
          headers,
          data: { search: 'gemma', type: ['model'] },
        });
        const { modelList } = (await response.json()) as IModelList;

        modelId = modelList.at(0)?.id;

        return modelId;
      },
      { message: 'the gemma model in the catalogue', timeout: NODE_REPORT_MS }
    )
    .toBeDefined();

  if (modelId === undefined) {
    throw new Error('The gemma model is not in the catalogue');
  }

  return modelId;
};

const deleteStaleDeployment = async (request: APIRequestContext, headers: Record<string, string>): Promise<void> => {
  const response = await request.patch('/api/v1/admin/deployment/list?page=1', { headers, data: {} });
  const { deploymentList } = (await response.json()) as { deploymentList: { id: number; name: string }[] };

  for (const deployment of deploymentList.filter(entry => entry.name === DEPLOYMENT.name)) {
    await deleteDeployment(request, headers, deployment.id);
  }
};

const gpuPlacement = (gpu: IPinnedGpu): string =>
  `contextSize: 8192\nplacement:\n  gpus:\n    - nodeId: ${gpu.nodeId}\n      deviceKey: ${gpu.deviceKey}\n`;

const cpuPlacement = (nodeId: number): string => `contextSize: 8192\nplacement:\n  nodeIds:\n    - ${nodeId}\n`;

const createDeployment = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  modelId: number,
  document: string
): Promise<number> => {
  const created = await request.post('/api/v1/admin/deployment', {
    headers,
    data: { ...DEPLOYMENT, modelId, document },
  });

  expect(created.status(), await created.text()).toBe(201);

  return ((await created.json()) as { id: number }).id;
};

const instanceStates = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  deploymentId: number
): Promise<string[]> => {
  const response = await request.get(`/api/v1/admin/deployment/${deploymentId}/instance`, { headers });
  const { instances } = (await response.json()) as IDeploymentInstances;

  return instances.map(instance => instance.state);
};

/** Undefined where the deployment neither readied nor failed in time. */
const settledState = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  deploymentId: number,
  waitMs: number
): Promise<SettledState | undefined> => {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const states = await instanceStates(request, headers, deploymentId);

    if (states.includes('failed')) {
      return 'failed';
    }

    if (states.length > 0 && states.every(state => state === 'ready')) {
      return 'ready';
    }

    await new Promise(resolve => setTimeout(resolve, 2_000));
  }

  return undefined;
};

const deleteDeployment = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  deploymentId: number
): Promise<void> => {
  const response = await request.delete(`/api/v1/admin/deployment/${deploymentId}`, { headers });

  expect(response.status()).toBe(200);
};

// Docker on a dev host may have no GPU, so a CPU run is rewritten to read as the GPU run a real install shows.
const disguiseCpuAsGpu = async (page: Page, gpu: IPinnedGpu): Promise<void> => {
  await page.evaluate(
    ({ name, placement, host }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        textNodes.push(node as Text);
      }

      for (const node of textNodes) {
        const text = node.textContent;

        if (text.includes('(CPU)')) {
          node.textContent = text.replace('(CPU)', `(${name})`);
        } else if (text.trim() === 'CPU' && node.parentElement?.closest('[data-testid="instance-row"]') !== null) {
          node.textContent = name;
        }
      }

      for (const kpi of document.querySelectorAll('[data-testid="host-kpis"] span')) {
        if (kpi.children.length === 0 && kpi.textContent.includes('Processor')) {
          kpi.textContent = host.cpu;
        } else if (kpi.children.length === 0 && kpi.textContent.endsWith('/models')) {
          kpi.textContent = host.modelDirectory;
        }
      }

      for (const legend of document.querySelectorAll('[data-testid="gpus-card"] [data-testid="meter-legend"]')) {
        const bar = legend.previousElementSibling;
        const items = [...legend.children];
        const segments = [...(bar?.querySelectorAll<HTMLElement>(':scope > *') ?? [])];
        let ownerIndex = -1;
        let ownedPercent = 0;

        items.forEach((item, index) => {
          const label = item.querySelector('.truncate');

          if (label === null || label.textContent === 'Headroom') {
            return;
          }

          ownedPercent += Number.parseFloat(segments.at(index)?.style.width ?? '0');

          if (ownerIndex === -1) {
            ownerIndex = index;
            label.textContent = host.owner;
          } else {
            item.remove();
            segments.at(index)?.remove();
          }
        });

        if (ownerIndex === -1) {
          continue;
        }

        const ownerSegment = segments.at(ownerIndex);
        const ownerValue = items.at(ownerIndex)?.querySelector('.font-mono');
        const used = bar?.previousElementSibling?.firstElementChild?.textContent.split(' of ').at(0);

        if (ownerSegment !== undefined) {
          ownerSegment.style.width = `${ownedPercent}%`;
        }

        if (ownerValue !== null && ownerValue !== undefined && used !== undefined) {
          ownerValue.textContent = used;
        }
      }

      for (const row of document.querySelectorAll('[data-testid="placement-row"]')) {
        const status = row.querySelector('[data-testid="placement-status"]');

        if (status === null || status.textContent.trim() !== 'CPU only') {
          continue;
        }

        const vram = row.querySelector('[data-testid="placement-vram"]');
        const ram = row.querySelector('[data-testid="placement-ram"]');

        if (vram !== null) {
          vram.textContent = placement.vram;
        }

        if (ram !== null) {
          ram.textContent = placement.ram;
        }

        status.textContent = 'Fits';
        status.classList.replace('bg-emphasis', 'bg-success-soft');
        status.classList.replace('text-highlight', 'text-success');
      }
    },
    {
      name: gpu.name,
      placement: FAKE_PLACEMENT,
      host: FAKE_HOST,
    }
  );
};

const shoot = async (page: Page, name: string, gpu: IPinnedGpu): Promise<void> => {
  await disguiseCpuAsGpu(page, gpu);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
};

// A page holds its live streams open, so the network never idles; a page is ready once its rows are in.
const open = async (page: Page, path: string, rows: Locator): Promise<void> => {
  await page.goto(webRoute(path));
  await expect(rows.first()).toBeVisible();
};

test('README screenshots', async ({ page, request }) => {
  test.setTimeout(GPU_ATTEMPT_MS + INSTANCE_READY_MS + 3 * NODE_REPORT_MS + 60_000);

  await page.addInitScript(() => localStorage.setItem('isDarkMode', 'true'));
  await new SignInPage(page).signIn({ email: 'alex@example.com', password: TEST_USER.password });

  const headers = await authorization(page);
  const gpu = await firstGpu(request, headers);
  const modelId = await gemmaModelId(request, headers);
  await deleteStaleDeployment(request, headers);
  let deploymentId = await createDeployment(request, headers, modelId, gpuPlacement(gpu));

  try {
    let state = await settledState(request, headers, deploymentId, GPU_ATTEMPT_MS);

    if (state !== 'ready') {
      await deleteDeployment(request, headers, deploymentId);
      deploymentId = await createDeployment(request, headers, modelId, cpuPlacement(gpu.nodeId));
      state = await settledState(request, headers, deploymentId, INSTANCE_READY_MS);
    }

    expect(state).toBe('ready');

    await open(page, '/dashboard', page.getByTestId('fleet-deployment-row'));
    await shoot(page, 'dashboard', gpu);

    await open(page, `/nodes/${gpu.nodeId}`, page.getByTestId('instance-row'));
    // The node reports a new instance's memory a few seconds after it becomes ready.
    await expect(page.getByTestId('host-kpis')).toContainText(DEPLOYMENT.name, { timeout: NODE_REPORT_MS });
    await page.getByRole('heading', { level: 1 }).evaluate(title => {
      window.scrollTo(0, title.getBoundingClientRect().top + window.scrollY - 72);
    });
    await shoot(page, 'node', gpu);

    await open(page, `/deployments/${deploymentId}`, page.getByTestId('instance-row'));
    await shoot(page, 'deployment', gpu);

    await open(page, '/models', page.getByTestId('model-row'));
    await shoot(page, 'models', gpu);
  } finally {
    await deleteDeployment(request, headers, deploymentId);
  }
});
