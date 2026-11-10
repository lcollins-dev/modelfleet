import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { resolve } from 'node:path';

import { SignInPage } from '../pages/SignInPage';
import { SERVER_URL, webRoute } from '../utils/urls';
import { TEST_USER } from '../utils/users';
import { FAKE_GPU, FakeAgent } from './fake-agent';

const OUT_DIR = resolve(__dirname, '../../resources/screenshots');

// Outlasts the 150 ms colour transitions on the selected tab and hovered rows.
const SETTLE_MS = 500;

// A new deployment waits for the residency batch job, which runs every 30 seconds by default.
const INSTANCE_READY_MS = 90_000;
const NODE_REPORT_MS = 30_000;

// Half a second past the reading, so it reads 0s old and an uptime reported in whole seconds lands mid-second.
const CLOCK_LEAD_MS = 500;

interface IFleetTelemetry {
  nodes: {
    nodeId: number;
    status: { receivedAt: string | null; devices: { deviceKey: string }[] };
  }[];
}

interface IModelList {
  modelList: { id: number }[];
}

interface IDeploymentInstances {
  instances: { state: string }[];
}

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

const fleetTelemetry = async (
  request: APIRequestContext,
  headers: Record<string, string>
): Promise<IFleetTelemetry['nodes']> => {
  const response = await request.get('/api/v1/admin/telemetry', { headers });

  return ((await response.json()) as IFleetTelemetry).nodes;
};

const fakeNodeId = async (request: APIRequestContext, headers: Record<string, string>): Promise<number> => {
  let nodeId: number | undefined;

  await expect
    .poll(
      async () => {
        const nodes = await fleetTelemetry(request, headers);

        nodeId = nodes.find(
          node =>
            node.status.receivedAt !== null &&
            node.status.devices.some(device => device.deviceKey === FAKE_GPU.deviceKey)
        )?.nodeId;

        return nodeId;
      },
      { message: 'the fake agent reporting its GPU', timeout: NODE_REPORT_MS }
    )
    .toBeDefined();

  if (nodeId === undefined) {
    throw new Error('The fake agent reports no GPU');
  }

  return nodeId;
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

const gpuPlacement = (nodeId: number): string =>
  `contextSize: 8192\nplacement:\n  gpus:\n    - nodeId: ${nodeId}\n      deviceKey: ${FAKE_GPU.deviceKey}\n`;

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

const waitForReady = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  deploymentId: number
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const states = await instanceStates(request, headers, deploymentId);

        return states.length > 0 && states.every(state => state === 'ready');
      },
      { message: 'the deployment ready', timeout: INSTANCE_READY_MS }
    )
    .toBe(true);
};

const deleteDeployment = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  deploymentId: number
): Promise<void> => {
  const response = await request.delete(`/api/v1/admin/deployment/${deploymentId}`, { headers });

  expect(response.status()).toBe(200);
};

/**
 * Has the fake report afresh and fixes the browser's clock just after the server received it, so the last heartbeat,
 * the reading's age and the instance's uptime come out the same on every run.
 */
const fixClock = async (
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  agent: FakeAgent,
  nodeId: number
): Promise<void> => {
  const sinceMs = Date.now();
  let receivedMs: number | undefined;

  agent.report();

  await expect
    .poll(
      async () => {
        const node = (await fleetTelemetry(request, headers)).find(entry => entry.nodeId === nodeId);
        const receivedAt = node?.status.receivedAt;

        receivedMs = receivedAt === null || receivedAt === undefined ? undefined : new Date(receivedAt).getTime();

        return receivedMs !== undefined && receivedMs >= sinceMs;
      },
      { message: 'a fresh reading from the fake agent', timeout: NODE_REPORT_MS, intervals: [100] }
    )
    .toBe(true);

  await page.clock.setFixedTime((receivedMs ?? sinceMs) + CLOCK_LEAD_MS);
};

const shoot = async (page: Page, name: string): Promise<void> => {
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
  test.setTimeout(INSTANCE_READY_MS + 6 * NODE_REPORT_MS + 60_000);

  await page.addInitScript(() => localStorage.setItem('isDarkMode', 'true'));
  await new SignInPage(page).signIn({ email: 'alex@example.com', password: TEST_USER.password });

  const headers = await authorization(page);
  const agent = new FakeAgent();
  let deploymentId: number | undefined;

  try {
    await agent.start(SERVER_URL);

    const nodeId = await fakeNodeId(request, headers);
    const modelId = await gemmaModelId(request, headers);
    await deleteStaleDeployment(request, headers);
    deploymentId = await createDeployment(request, headers, modelId, gpuPlacement(nodeId));
    await waitForReady(request, headers, deploymentId);

    await fixClock(page, request, headers, agent, nodeId);
    await open(page, '/dashboard', page.getByTestId('fleet-deployment-row'));
    await shoot(page, 'dashboard');

    await fixClock(page, request, headers, agent, nodeId);
    await open(page, `/nodes/${nodeId}`, page.getByTestId('instance-row'));
    await expect(page.getByTestId('host-kpis')).toContainText(DEPLOYMENT.name);
    await page.getByRole('heading', { level: 1 }).evaluate(title => {
      window.scrollTo(0, title.getBoundingClientRect().top + window.scrollY - 72);
    });
    await shoot(page, 'node');

    await fixClock(page, request, headers, agent, nodeId);
    await open(page, `/deployments/${deploymentId}`, page.getByTestId('instance-row'));
    // Placement shows the expected use and what is free until it holds the node's readings of the instance.
    await expect(page.getByTestId('placement-row')).not.toContainText('free');
    await shoot(page, 'deployment');

    await fixClock(page, request, headers, agent, nodeId);
    await open(page, '/models', page.getByTestId('model-row'));
    await shoot(page, 'models');
  } finally {
    if (deploymentId !== undefined) {
      await deleteDeployment(request, headers, deploymentId);
    }

    await agent.stop();
  }
});
