import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig, { namingConventionOptions } from '../../eslint.root.mjs';

export default defineConfig([
  globalIgnores(['vitest.config.ts']),
  {
    extends: [rootEslintConfig],

    rules: {
      // A zod schema shares its inferred type's name, as libs/dto's do.
      '@typescript-eslint/naming-convention': [
        'error',
        ...namingConventionOptions,
        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
      ],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apps/*', '**/apps/**'],
              message:
                'A backend declaration is data the server and the browser both read, so it must depend on neither. A dependency here puts application code in the browser bundle.',
            },
            {
              group: ['@libs/agent-protocol', '**/libs/agent-protocol/**'],
              message:
                'The agent protocol takes the backend id from here, so an import back would make the two libraries a cycle. A declaration is neither a message nor an envelope.',
            },
            {
              group: ['@libs/dto', '**/libs/dto/**'],
              message:
                'The dto lib takes the backend id from here, so an import back would make the two libraries a cycle. A declaration is neither a request nor a response.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/openai/**/*.ts', 'src/backends/**/mapping*.ts'],

    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        ...namingConventionOptions,

        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },

        // The canonical schema carries OpenAI's own wire keys, which are snake_case.
        { selector: 'objectLiteralProperty', format: ['camelCase', 'snake_case'] },
      ],
    },
  },
]);
