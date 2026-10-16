import rootPrettierConfig from '../../prettier.config.mjs';

/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  ...rootPrettierConfig,
  importOrder: [
    '<THIRD_PARTY_MODULES>',
    '^@libs/',
    '/types/',
    '/Config$',
    '/utils/',
    '(/stores/|/services/)',
    '/components/',
    '/pages/',
    '^([./]|@/)',
  ],
};

export default config;
