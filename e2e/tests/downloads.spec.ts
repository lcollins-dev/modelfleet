import { clearDownloadsFor } from '../clients/download.client';
import { deleteNode, registerNode } from '../clients/node.client';
import { expect, test } from '../fixtures/test';
import { FAKE_HUB_FILE, FAKE_HUB_OTHER_FILE, FAKE_HUB_PUBLIC } from '../utils/fake-hub';

const uniqueName = (label: string): string => `${label}-${Date.now()}-${Math.random().toString().slice(2, 6)}`;

test.describe('downloads', () => {
  test.skip(
    process.env.E2E_FAKE_HUB_PORT === undefined,
    'Needs the fake Hub: set E2E_FAKE_HUB_PORT, and HUGGINGFACE_ENDPOINT on the server, as the e2e README says'
  );

  test('picks a file and two nodes from a pasted address, follows the download to its page, then cancels and dismisses it', async ({
    downloadCreatePage,
    downloadPage,
    downloadsPage,
    page,
    request,
  }) => {
    const node = await registerNode(request, uniqueName('download'));
    const otherNode = await registerNode(request, uniqueName('download'));

    try {
      await downloadsPage.goto();
      await downloadsPage.newButton.click();

      await expect(downloadCreatePage.heading).toBeVisible();

      await downloadCreatePage.list(`https://huggingface.co/${FAKE_HUB_PUBLIC}`);

      await expect(downloadCreatePage.file(FAKE_HUB_FILE)).toContainText('1 MiB');
      await expect(downloadCreatePage.file(FAKE_HUB_OTHER_FILE)).toContainText('2 MiB');

      await downloadCreatePage.fileCheckbox(FAKE_HUB_FILE).check();
      await downloadCreatePage.nodeCheckbox(node.name).check();
      await downloadCreatePage.nodeCheckbox(otherNode.name).check();

      await downloadCreatePage.startButton.click();

      await expect(page).toHaveURL(/\/downloads$/);

      const download = downloadsPage.downloadForRepository(FAKE_HUB_PUBLIC);

      await expect(download).toContainText('Downloading to 2 nodes');

      await download.click();

      await expect(page).toHaveURL(/\/downloads\/\d+$/);
      await expect(downloadPage.targetForNode(node.name)).toContainText('Waiting for the node to report');
      await expect(downloadPage.targetForNode(otherNode.name)).toContainText('Waiting for the node to report');

      await downloadPage.confirmCancel();

      await expect(downloadPage.stateTag).toHaveText('Stopped');

      await downloadPage.dismissButton.click();

      await expect(page).toHaveURL(/\/downloads$/);
      await expect(download).toHaveCount(0);
    } finally {
      await clearDownloadsFor(request, node.id);
      await deleteNode(request, node.id);
      await deleteNode(request, otherNode.id);
    }
  });
});
