import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

// Serial specs own their app, so they get a process-isolated second pass.
const serial = process.env.INTEGRATION_SERIAL === '1';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },

      // swc does not pick emitDecoratorMetadata up from the tsconfig, and without it
      // TypeORM resolves every inferred column type to undefined.
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    // `integration/` is outside the tsconfig include, so the alias is repeated here.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',

    // Timestamp columns carry no time zone, so a non-UTC process reads lastAccess off by
    // the offset and every session looks expired.
    env: {
      NODE_ENV: 'test',
      TZ: 'UTC',
    },
    include: serial ? ['integration/tests/**/*.serial.int.test.ts'] : ['integration/tests/**/*.int.test.ts'],
    exclude: [...configDefaults.exclude, ...(serial ? [] : ['**/*.serial.int.test.ts'])],
    globalSetup: ['./integration/global-setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    pool: 'forks',
    isolate: serial,
  },
});
