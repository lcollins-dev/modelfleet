import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig, { namingConventionOptions } from '../../eslint.root.mjs';

export default defineConfig([
  globalIgnores(['vitest.config.ts']),
  {
    extends: [rootEslintConfig],

    rules: {
      // A schema and the type inferred from it share one PascalCase name, as in dto.
      '@typescript-eslint/naming-convention': [
        'error',
        ...namingConventionOptions,
        { selector: 'variable', modifiers: ['const', 'exported'], format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
      ],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apps/*', '**/apps/**'],
              message:
                'The agent protocol is the contract both halves compile against, so it must depend on neither. A dependency here couples the server to the agent the protocol exists to keep separate.',
            },
          ],
        },
      ],
    },
  },
]);
