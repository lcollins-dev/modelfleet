import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig, { namingConventionOptions } from '../../eslint.root.mjs';

const restrictedPackagePatterns = [
  {
    group: ['@apps/web', '@apps/web/*', '**/apps/web/**'],
    message:
      'The server serves the web app over HTTP and knows nothing of its components - share the contract through @libs/dto instead.',
  },
  {
    group: ['@apps/agent', '@apps/agent/*', '**/apps/agent/**'],
    message:
      'The server reaches a node agent over the wire and knows nothing of its internals - share the contract through @libs/agent-protocol instead.',
  },
];

const entryPointPatterns = [
  {
    group: ['@/api', '@/api/**', '**/api', '**/api/**'],
    message:
      'core/ is what this application knows about nodes, users and instances, and api/ is one caller of it - an import here would make the agent connection and the gateway reach through the HTTP surface to get at their own domain.',
  },
  {
    group: ['@/gateway', '@/gateway/**', '**/gateway', '**/gateway/**'],
    message:
      'The inference gateway is a second caller of core/, beside api/. An import here would put an OpenAI-shaped response inside the domain it is built from.',
  },
];

const dtoShapePattern = {
  group: ['@libs/dto'],
  importNamePattern: 'Dto$',
  message:
    'core/ answers in entities and its own types. A @libs/dto request or response is what one route wants, so parse and shape it in api/ - core takes only the enums its columns are typed in.',
};

const unparsedRequestSelector = {
  selector:
    "Decorator > CallExpression[callee.name=/^(Body|Query|Param|Headers)$/]:not(:has(NewExpression[callee.name='ZodPipe']))",
  message: 'Parse every body, query, param and header through a ZodPipe with its @libs/dto schema.',
};

/** Each block replaces the rule wholesale, so each repeats the package patterns every file has. */
const restrictImports = (...layerPatterns) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns: [...restrictedPackagePatterns, ...layerPatterns] }],
});

export default defineConfig([
  globalIgnores(['vitest.config.ts', 'vitest.integration.config.ts']),
  {
    extends: [rootEslintConfig],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': ['error', unparsedRequestSelector],
      ...restrictImports(),
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: restrictImports(...entryPointPatterns, dtoShapePattern),
  },
  {
    files: ['src/gateway/**/*.ts', 'integration/tests/gateway/**/*.ts'],

    rules: {
      // Gateway services parse their own bodies to answer in OpenAI's error shape.
      'no-restricted-syntax': 'off',

      '@typescript-eslint/naming-convention': [
        'error',
        ...namingConventionOptions,

        // The gateway answers in OpenAI's own wire keys, which are snake_case.
        { selector: 'objectLiteralProperty', format: ['camelCase', 'snake_case'] },

        // Node's stream contract names the methods a Transform implements `_transform` and `_flush`.
        { selector: 'classMethod', format: ['camelCase'], leadingUnderscore: 'allow' },
      ],
    },
  },
  {
    // `queryRunner.query` returns `any`, so naming a row's shape is the only way to read one.
    files: ['src/database/migrations/**/*.ts'],

    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },
  {
    // `integration/` sits outside the build tsconfig's include, so it needs a project
    // that covers it for the type-aware rules to resolve. Must come after the block
    // above, which sets the project for everything else.
    files: ['integration/**/*.ts'],

    languageOptions: {
      parserOptions: {
        project: './tsconfig.integration.json',
      },
    },

    rules: {
      // supertest types a response body as `any`, so asserting against one trips the
      // unsafe-any family on almost every line. Production code stays strict.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
]);
