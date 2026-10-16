import { defineConfig } from 'eslint/config';

import rootEslintConfig, { namingConventionOptions } from '../../eslint.root.mjs';

export default defineConfig([
  {
    extends: [rootEslintConfig],

    // The build tsconfig leaves the tests out, so lint against one that takes them in.
    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
      },
    },

    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        ...namingConventionOptions,
        { selector: 'variable', filter: { regex: 'Dto$', match: true }, format: ['PascalCase'] },
      ],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apps/*', '**/apps/**'],
              message:
                'The dto lib is the contract both sides compile against, so it must depend on neither. A dependency here puts backend code in the browser bundle.',
            },
          ],
        },
      ],
    },
  },
]);
