import { deleteNode, registerNode, renameNode } from '../clients/node.client';
import { expect, test } from '../fixtures/test';
import { webRoute } from '../utils/urls';

// The fleet is shared, so each spec names a node only it can find.
const uniqueName = (label: string): string => `${label}-${Date.now()}-${Math.random().toString().slice(2, 6)}`;

test.describe('nodes', () => {
  test('lists the fleet and reaches it from the sidebar', async ({ nodesPage, page, request }) => {
    const node = await registerNode(request, uniqueName('listed'));

    try {
      await page.goto(webRoute('/dashboard'));

      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Nodes', exact: true }).click();

      await expect(page).toHaveURL(/\/nodes$/);
      await expect(nodesPage.heading).toBeVisible();

      await nodesPage.search(node.name);

      await expect(nodesPage.listItemByName(node.name)).toContainText('Awaiting first contact');
      await expect(nodesPage.listItemByName(node.name)).toContainText('Never');

      await nodesPage.stateFilter('Inactive').click();
      await expect(nodesPage.listItemByName(node.name)).toBeVisible();

      await nodesPage.stateFilter('Online').click();
      await expect(nodesPage.listItemByName(node.name)).toBeHidden();
    } finally {
      await deleteNode(request, node.id);
    }
  });

  test('registers a node and shows its credentials once', async ({ nodeRegisterPage, nodesPage, page, request }) => {
    const name = uniqueName('registered');

    await nodesPage.goto();
    await nodesPage.addButton.click();

    await expect(page).toHaveURL(/\/nodes\/register$/);
    await expect(nodeRegisterPage.heading).toBeVisible();

    await nodeRegisterPage.register(name);

    await expect(nodeRegisterPage.shownOnceWarning).toBeVisible();
    await expect(nodeRegisterPage.copyButtons).toHaveCount(2);

    await nodeRegisterPage.openNodeButton.click();

    await expect(page).toHaveURL(/\/nodes\/\d+$/);

    const nodeId = Number(/nodes\/(\d+)$/.exec(page.url())?.[1]);
    await deleteNode(request, nodeId);
  });

  test('shows a node awaiting first contact with its event log', async ({ nodePage, request }) => {
    const node = await registerNode(request, uniqueName('detail'));

    try {
      await nodePage.goto(node.id);

      await expect(nodePage.heading(node.name)).toBeVisible();
      await expect(nodePage.awaitingFirstContactNotice.first()).toBeVisible();
      await expect(nodePage.eventLogCard).toBeVisible();
      await expect(nodePage.eventRows.filter({ hasText: 'Node registered' })).toBeVisible();
    } finally {
      await deleteNode(request, node.id);
    }
  });

  test('shows the GPUs section awaiting hardware from a node that has never connected', async ({
    nodePage,
    request,
  }) => {
    const node = await registerNode(request, uniqueName('gpus'));

    try {
      await nodePage.goto(node.id);

      await expect(nodePage.gpusCard).toBeVisible();
      await expect(nodePage.gpusAwaitingState).toBeVisible();
      await expect(nodePage.cpuOnlyNotice).toBeHidden();
    } finally {
      await deleteNode(request, node.id);
    }
  });

  // The search term outlives the rename, so the live stream is what replaces the row.
  test('picks up a node change made while the list is open', async ({ nodesPage, request }) => {
    const prefix = uniqueName('live');
    const node = await registerNode(request, prefix);

    try {
      await nodesPage.goto();
      await expect(nodesPage.listItems.first()).toBeVisible();

      await nodesPage.search(prefix);
      await expect(nodesPage.listItemByName(prefix)).toBeVisible();

      await renameNode(request, node.id, `${prefix}-renamed`);

      await expect(nodesPage.listItemByName(`${prefix}-renamed`)).toBeVisible();
    } finally {
      await deleteNode(request, node.id);
    }
  });
});
