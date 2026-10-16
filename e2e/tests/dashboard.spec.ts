import { deleteNode, registerNode } from '../clients/node.client';
import { expect, test } from '../fixtures/test';

// The fleet is shared, so each spec names a node only it can find.
const uniqueName = (label: string): string => `${label}-${Date.now()}-${Math.random().toString().slice(2, 6)}`;

const eventStream = (payload: object) => ({
  status: 200,
  contentType: 'text/event-stream',
  body: `data: ${JSON.stringify(payload)}\n\n`,
});

test.describe('fleet overview', () => {
  test('shows a node registered while it is open, and links through to it', async ({
    dashboardPage,
    page,
    request,
  }) => {
    await dashboardPage.goto();

    await expect(dashboardPage.heading).toBeVisible();

    const node = await registerNode(request, uniqueName('overview'));

    try {
      await expect(dashboardPage.nodeRowByName(node.name)).toHaveAccessibleName(/Awaiting first contact/);

      await dashboardPage.nodeRowByName(node.name).click();

      await expect(page).toHaveURL(new RegExp(`/nodes/${node.id}$`));
    } finally {
      await deleteNode(request, node.id);
    }
  });

  test('reads an empty fleet as empty states that say what to do next', async ({ dashboardPage, page }) => {
    await page.route('**/api/v1/admin/telemetry/stream', route =>
      route.fulfill(eventStream({ nodes: [], readAt: new Date().toJSON() }))
    );
    await page.route('**/api/v1/admin/instance/stream', route => route.fulfill(eventStream({ instances: [] })));
    await page.route('**/api/v1/admin/deployment/list?*', route =>
      route.fulfill({ json: { deploymentList: [], pages: 0, total: 0 } })
    );
    await page.route('**/api/v1/admin/model/list?*', route => route.fulfill({ json: { modelList: [], pages: 0 } }));

    await dashboardPage.goto();

    await expect(dashboardPage.nodesPanel.getByRole('link', { name: 'Register Node' })).toBeVisible();
    await expect(dashboardPage.deploymentsPanel).toContainText('No models yet');
    await expect(dashboardPage.deploymentsPanel.getByRole('link', { name: 'View Models' })).toBeVisible();
  });

  test('asks for a deployment once a model is there to deploy', async ({ dashboardPage, page }) => {
    await page.route('**/api/v1/admin/deployment/list?*', route =>
      route.fulfill({ json: { deploymentList: [], pages: 0, total: 0 } })
    );
    await page.route('**/api/v1/admin/model/list?*', route =>
      route.fulfill({
        json: {
          modelList: [
            {
              id: 1,
              fingerprint: 'a'.repeat(64),
              name: 'Llama 3 8B',
              displayName: null,
              format: 'gguf',
              type: 'model',
              tasks: [],
              licence: null,
              quantisation: null,
              quantisationMixed: false,
              sizeBytes: 1,
              shardCount: 1,
              state: 'available',
              availability: [],
            },
          ],
          pages: 1,
        },
      })
    );

    await dashboardPage.goto();

    await expect(dashboardPage.deploymentsPanel).toContainText('No deployments yet');
    await expect(dashboardPage.deploymentsPanel.getByRole('link', { name: 'Create Deployment' })).toBeVisible();
  });
});
