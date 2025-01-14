'use strict';

/**
 * Main entry point for handling filesystem-based configuration,
 * whether that's a config file or `package.json` or whatever.
 * @module
 */

const fs = require('node:fs');

const ansi = require('ansi-colors');
const debug = require('debug')('mocha:cli:options');
const findUp = require('find-up');
const yargsParser = require('yargs-parser');

const mocharc = require('../mocharc.json');

const { loadConfig, findConfig } = require('./config');
const { isNodeFlag } = require('./node-flags');
const { ONE_AND_DONE_ARGS } = require('./one-and-dones');
const { list } = require('./run-helpers');
const { types, aliases } = require('./run-option-metadata');

/**
 * The `yargs-parser` namespace
 * @external yargsParser
 * @see {@link https://npm.im/yargs-parser}
 */

/**
 * An object returned by a configured `yargs-parser` representing arguments
 * @memberof external:yargsParser
 * @interface Arguments
 */

/**
 * Base yargs parser configuration
 * @private
 */
const YARGS_PARSER_CONFIG = {
  'combine-arrays': true,
  'short-option-groups': false,
  'dot-notation': false,
};

/**
 * This is the config pulled from the `yargs` property of Mocha's
 * `package.json`, but it also disables camel case expansion as to
 * avoid outputting non-canonical keynames, as we need to do some
 * lookups.
 * @private
 * @ignore
 */
const configuration = { ...YARGS_PARSER_CONFIG, 'camel-case-expansion': false };

/**
 * This is a really fancy way to:
 * - ensure unique values for `array`-type options
 * - use its array's last element for `boolean`/`number`/`string`- options given multiple times
 * This is passed as the `coerce` option to `yargs-parser`
 * @private
 * @ignore
 */
const coerceOpts = Object.assign(
  Object.fromEntries(
    types.array.map((arg) => [arg, (v) => [...new Set(list(v))]])
  ),
  Object.fromEntries(
    [...types.boolean, ...types.string, ...types.number].map((arg) => [
      arg,
      (v) => (Array.isArray(v) ? v.pop() : v),
    ])
  )
);

/**
 * We do not have a case when multiple arguments are ever allowed after a flag
 * (e.g., `--foo bar baz quux`), so we fix the number of arguments to 1 across
 * the board of non-boolean options.
 * This is passed as the `narg` option to `yargs-parser`
 * @private
 * @ignore
 */
const nargOpts = Object.fromEntries(
  [...types.array, ...types.string, ...types.number].map((arg) => [arg, 1])
);

/**
 * Wrapper around `yargs-parser` which applies our settings
 * @param {string|string[]} args - Arguments to parse
 * @param {object} defaultValues - Default values of mocharc.json
 * @param  {...object} configObjects - `configObjects` for yargs-parser
 * @private
 * @ignore
 */
const parse = (args = [], defaultValues = {}, ...configObjects) => {
  // Save node-specific args for special handling.
  // 1. when these args have a "=" they should be considered to have values
  // 2. if they don't, they just boolean flags
  // 3. to avoid explicitly defining the set of them, we tell yargs-parser they
  //    are ALL boolean flags.
  // 4. we can then reapply the values after yargs-parser is done.
  const nodeArgs = (Array.isArray(args) ? args : args.split(' ')).reduce(
    (acc, arg) => {
      const pair = arg.split('=');
      let flag = pair[0];
      if (isNodeFlag(flag, false)) {
        flag = flag.replace(/^--?/, '');
        return arg.includes('=')
          ? [...acc, [flag, pair[1]]]
          : [...acc, [flag, true]];
      }

      return acc;
    },
    []
  );

  const result = yargsParser.detailed(args, {
    configuration,
    configObjects,
    default: defaultValues,
    coerce: coerceOpts,
    narg: nargOpts,
    alias: aliases,
    string: types.string,
    array: types.array,
    number: types.number,
    boolean: [...types.boolean, ...nodeArgs.map((pair) => pair[0])],
  });
  if (result.error) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    // eslint-disable-next-line @cloudfour/n/no-process-exit, @cloudfour/unicorn/no-process-exit
    process.exit(1);
  }

  // Reapply "=" arg values from above
  for (const [key, value] of nodeArgs) {
    result.argv[key] = value;
  }

  return result.argv;
};

/**
 * Given path to config file in `args.config`, attempt to load & parse config file.
 * @param {object} [args] - Arguments object
 * @param {string|boolean} [args.config] - Path to config file or `false` to skip
 * @public
 * @memberof module:lib/cli/options
 * @returns {external:yargsParser.Arguments|void} Parsed config, or nothing if `args.config` is `false`
 */
const loadRc = (args = {}) => {
  if (args.config !== false) {
    const config = args.config || findConfig();
    return config ? loadConfig(config) : {};
  }
};

module.exports.loadRc = loadRc;

/**
 * Given path to `package.json` in `args.package`, attempt to load config from `mocha` prop.
 * @param {object} [args] - Arguments object
 * @param {string|boolean} [args.config] - Path to `package.json` or `false` to skip
 * @public
 * @memberof module:lib/cli/options
 * @returns {external:yargsParser.Arguments|void} Parsed config, or nothing if `args.package` is `false`
 */
const loadPkgRc = (args = {}) => {
  let result;
  if (args.package === false) {
    return result;
  }

  result = {};
  const filepath = args.package || findUp.sync(mocharc.package);
  if (filepath) {
    try {
      const pkg = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      if (pkg.mocha) {
        debug(`'mocha' prop of package.json parsed:`, pkg.mocha);
        result = pkg.mocha;
      } else {
        debug(`no config found in ${filepath}`);
      }
    } catch (error) {
      if (args.package) {
        throw new Error(`Unable to read/parse ${filepath}: ${error}`);
      }

      debug(`failed to read default package.json at ${filepath}; ignoring`);
    }
  }

  return result;
};

module.exports.loadPkgRc = loadPkgRc;

/**
 * Priority list:
 *
 * 1. Command-line args
 * 2. RC file (`.mocharc.c?js`, `.mocharc.ya?ml`, `mocharc.json`)
 * 3. `mocha` prop of `package.json`
 * 4. default configuration (`lib/mocharc.json`)
 *
 * If a {@link module:lib/cli/one-and-dones.ONE_AND_DONE_ARGS "one-and-done" option} is present in the `argv` array, no external config files will be read.
 * @summary Parses options read from `.mocharc.*` and `package.json`.
 * @param {string|string[]} [argv] - Arguments to parse
 * @public
 * @memberof module:lib/cli/options
 * @returns {external:yargsParser.Arguments} Parsed args from everything
 */
const loadOptions = (argv = []) => {
  let args = parse(argv);
  // Short-circuit: look for a flag that would abort loading of options
  if ([...ONE_AND_DONE_ARGS].reduce((acc, arg) => acc || arg in args, false)) {
    return args;
  }

  const rcConfig = loadRc(args);
  const pkgConfig = loadPkgRc(args);

  if (rcConfig) {
    args.config = false;
    args._ = [...args._, ...(rcConfig._ || [])];
  }

  if (pkgConfig) {
    args.package = false;
    args._ = [...args._, ...(pkgConfig._ || [])];
  }

  args = parse(args._, mocharc, args, rcConfig || {}, pkgConfig || {});

  // Recombine positional arguments and "spec"
  if (args.spec) {
    args._ = [args._, ...args.spec];
    delete args.spec;
  }

  // Make unique
  args._ = [...new Set(args._)];

  return args;
};

module.exports.loadOptions = loadOptions;
module.exports.YARGS_PARSER_CONFIG = YARGS_PARSER_CONFIG;
