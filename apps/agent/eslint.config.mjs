import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig from '../../eslint.root.mjs';

export default defineConfig([
  globalIgnores(['vitest.config.ts']),
  {
    extends: [rootEslintConfig],

    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apps/server', '@apps/server/*', '**/apps/server/**'],
              message:
                'The agent reaches the server over the wire and knows nothing of its internals - share the contract through @libs/agent-protocol instead.',
            },
            {
              group: ['@apps/web', '@apps/web/*', '**/apps/web/**'],
              message: 'The agent has no user interface. Nothing in the web app belongs on a node.',
            },
          ],
        },
      ],
    },
  },
]);
