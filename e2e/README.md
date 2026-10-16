# End-to-end tests

Playwright browser tests for the web app.

## Setup

From the repository root, start the stack and install Chromium once:

```sh
npm run instance:start
npm run -w e2e install-browsers
```

## Commands

```sh
npm run test:e2e          # headless
npm run -w e2e e2e:ui     # UI mode
npm run -w e2e e2e:headed # visible browser
npm run -w e2e report     # open the HTML report
```

The base URL matches the current checkout's development instance. Override it for another environment:

```sh
E2E_BASE_URL=https://test.example.com npm run -w e2e e2e
```

Run a subset:

```sh
npm run -w e2e e2e -- --project=chromium
npm run -w e2e e2e -- -g "signs in"
npm run -w e2e e2e -- tests/navigation.spec.ts
```

## Downloads

The download specs use a fake Hub. Start the stack with the same port assigned to `HUGGINGFACE_ENDPOINT`:

```sh
HUGGINGFACE_ENDPOINT=http://127.0.0.1:3298 npm run instance:start
E2E_FAKE_HUB_PORT=3298 npm run -w e2e e2e -- tests/downloads.spec.ts
```

Without `E2E_FAKE_HUB_PORT`, download specs skip. In CI, omitting it fails the run.

## Test data

Specs use the seeded admin account. Test migrations remove its required password change. A spec that needs a separate
session creates a user with `factories/user.factory.ts`; signing in again as the admin would invalidate another spec's
session.

## Screenshots

`npm run -w e2e screenshots` retakes the README screenshots at 1280 by 800 in the dark theme. It needs the seeded
screenshot data and a connected development node:

```sh
npm run instance:stop -- agent
npm run instance:db:clean
npm run instance:db:sql -- -v ON_ERROR_STOP=1 < e2e/screenshots/seed.sql
npm run instance:start
npm run -w e2e screenshots
npm run instance:db:clean
```

The agent reconnects after the database clean so it can report its GPU and models. The screenshot test creates its
deployment, waits for it to become ready, takes the images and removes it.
