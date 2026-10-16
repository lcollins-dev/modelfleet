import { FakeHub } from './fake-hub';

/**
 * Starts the fake Hub the server reads repositories from, on the port its `HUGGINGFACE_ENDPOINT` names. CI must set
 * the port, since a spec that skipped silently there would hide the whole download journey.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const port = process.env.E2E_FAKE_HUB_PORT;

  if (port === undefined) {
    if (process.env.CI !== undefined) {
      throw new Error('E2E_FAKE_HUB_PORT is not set, so the download specs cannot run');
    }

    return undefined;
  }

  const fakeHub = new FakeHub();

  await fakeHub.start(Number(port));

  return () => fakeHub.stop();
}
