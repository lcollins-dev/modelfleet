import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const namingConventionOptions = [
  {
    selector: 'default',
    format: ['camelCase'],
  },
  {
    selector: 'variable',
    format: ['camelCase', 'UPPER_CASE'],
  },
  {
    selector: 'parameter',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'property',
    format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
  },
  {
    selector: ['objectLiteralProperty', 'typeProperty'],
    modifiers: ['requiresQuotes'],
    format: null,
  },
  {
    selector: 'method',
    format: ['camelCase', 'UPPER_CASE'],
  },
  {
    selector: 'import',
    format: ['camelCase', 'PascalCase'],
  },
  {
    selector: 'typeLike',
    format: ['PascalCase'],
  },
  {
    selector: 'enumMember',
    format: ['UPPER_CASE'],
  },
  {
    selector: 'interface',
    format: ['PascalCase'],
    custom: {
      regex: '^I[A-Z]',
      match: true,
    },
  },
];

export default defineConfig([
  globalIgnores(['node_modules', 'dist', 'eslint.config.mjs', 'prettier.config.mjs']),
  {
    extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, eslintConfigPrettier],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      'no-useless-constructor': 'off',
      'import/order': 'off',
      'lines-between-class-members': 'off',
      'no-console': 'error',
      curly: 'error',
      eqeqeq: ['error', 'always'],
      'id-length': ['error', { min: 2, properties: 'never', exceptions: ['i', 'j', 'k', '_'] }],

      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',

      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: true,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: false, number: false, boolean: false, bigint: false } },
      ],
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      '@typescript-eslint/no-extraneous-class': [
        'warn',
        {
          allowStaticOnly: true,
        },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        {
          ignoreArrowShorthand: true,
        },
      ],
      '@typescript-eslint/naming-convention': ['error', ...namingConventionOptions],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'integration/**/*.ts', 'tests/**/*.ts', 'fixtures/**/*.ts'],

    rules: {
      'id-length': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
]);
