import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig from '../../eslint.root.mjs';

export default defineConfig([
  globalIgnores(['vitest.config.ts']),
  {
    extends: [rootEslintConfig],

    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apps/*', '**/apps/**'],
              message:
                'The runtime library is plumbing every process may take, so it must depend on none of them. An import here would make one application a dependency of all the others.',
            },
            {
              group: ['@libs/*', '**/libs/**'],
              message:
                'The runtime library sits under the other libraries rather than beside them. Depending on one would let a contract reach this plumbing through the back door.',
            },
          ],
        },
      ],
    },
  },
]);
