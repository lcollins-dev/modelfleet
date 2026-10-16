import { NestExpressApplication } from '@nestjs/platform-express';

import { applyGlobalMiddleware, createApp } from '@/app';

let sharedApp: Promise<NestExpressApplication> | undefined;

/** One app per worker, shared by every spec in it. */
export const bootstrapApp = async (): Promise<NestExpressApplication> => {
  sharedApp ??= (async () => {
    const app = await createApp();

    applyGlobalMiddleware(app);

    await app.init();

    return app;
  })();

  return sharedApp;
};
