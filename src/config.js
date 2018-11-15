// ESLint configs
const xo = require('eslint-config-xo');
const standard = require('eslint-config-standard');
const prettier = require('eslint-config-prettier');
const prettierStandard = require('eslint-config-prettier/standard');

// ESLint plugins
const node = require('eslint-plugin-node').configs.recommended;

/**
 * @param {{[key: string]: any}} rules the rules to process
 */
const prefix = rules =>
  Object.entries(rules).reduce((output, [key, val]) => {
    if (key.includes('/')) key = '@cloudfour/' + key;
    output[key] = val;
    return output;
  }, {});

const removeUnused = rules =>
  Object.entries(rules).reduce((output, [key, val]) => {
    if (val === 'off' || val === 0 || val[0] === 'off' || val[0] === 0) {
      return output;
    }
    output[key] = val;
    return output;
  }, {});

module.exports.configs = {
  recommended: {
    parserOptions: {
      ecmaVersion: 2018,
      sourceType: 'module',
      ecmaFeatures: { jsx: true }
    },
    env: {
      node: true,
      es6: true
    },
    globals: {
      document: false,
      navigator: false,
      window: false
    },
    plugins: ['@cloudfour'],
    rules: removeUnused(
      prefix({
        // Plugins' recommended configs
        ...node.rules,

        // "standards"
        ...xo.rules,
        ...standard.rules,

        ...prettier.rules, // Undoes core stylistic rules
        ...prettierStandard.rules, // Undoes stylistic rules in standard plugin

        // Overrides
        'valid-jsdoc': 'off',
        'no-return-assign': ['error'],
        'func-names': 'off',
        'prefer-const': 'error',
        'no-var': 'error',
        'object-shorthand': 'error',
        'prefer-object-spread': 'error',
        'prefer-spread': 'error',
        'prefer-destructuring': ['error', { array: false }],
        'prefer-rest-params': 'error',
        'node/no-unsupported-features/es-syntax': 'off', // Does not account for transpilation
        'node/shebang': 'off' // Tons of false positives
      })
    )
  }
};
