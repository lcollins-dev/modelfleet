import eslintPluginVue from 'eslint-plugin-vue';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

import rootEslintConfig from '../../eslint.root.mjs';

const CROSS_APP_IMPORT_PATTERNS = [
  {
    group: ['@apps/*', '**/apps/server/**', '**/apps/agent/**'],
    message:
      'The web app talks to the server over HTTP. Importing another app would ship entities, secrets and Node built-ins to the browser - share the contract through @libs/dto instead.',
  },
  {
    group: ['@libs/backends/runtime', '@libs/backends/openai'],
    message:
      'Those halves launch containers and map inference traffic, which the browser never does. A form renders from a declaration, so take @libs/backends.',
  },
];

export default defineConfig([
  globalIgnores(['vite.config.ts', 'vitest.config.ts', 'icons.config.ts', 'public']),
  {
    extends: [rootEslintConfig],

    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },

    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: CROSS_APP_IMPORT_PATTERNS,
        },
      ],
    },
  },
  {
    extends: [...eslintPluginVue.configs['flat/recommended']],

    files: ['*.vue', '**/*.vue'],

    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',

      // `PropType` carries the type of a runtime prop declaration, and it is an assertion.
      '@typescript-eslint/consistent-type-assertions': 'off',

      // Vue ESLint does not handle types well so these are turned off for now
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
]);
