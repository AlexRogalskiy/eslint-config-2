'use strict';

/* eslint no-unused-vars: off */
/* eslint-env commonjs */

/**
 * Shim process.stdout.
 */

process.stdout = require('browser-stdout')({ label: false });

const Mocha = require('./lib/mocha');

/**
 * Create a Mocha instance.
 *
 * @returns {undefined}
 */

const mocha = new Mocha({ reporter: 'html' });

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */

const Date = global.Date;
const setTimeout = global.setTimeout;
const setInterval = global.setInterval;
const clearTimeout = global.clearTimeout;
const clearInterval = global.clearInterval;

const uncaughtExceptionHandlers = [];

const originalOnerrorHandler = global.onerror;

/**
 * Remove uncaughtException listener.
 * Revert to original onerror handler if previously defined.
 */

process.removeListener = function (e, fn) {
  if (e !== 'uncaughtException') return;
  if (originalOnerrorHandler) {
    global.addEventListener('error', originalOnerrorHandler);
  } else {
    global.addEventListener('error', () => {});
  }

  const i = uncaughtExceptionHandlers.indexOf(fn);
  if (i !== -1) {
    uncaughtExceptionHandlers.splice(i, 1);
  }
};

/**
 * Implements uncaughtException listener.
 */

process.on = function (e, fn) {
  if (e === 'uncaughtException') {
    global.addEventListener('error', (err, url, line) => {
      fn(new Error(`${err} (${url}:${line})`));
      return !mocha.options.allowUncaught;
    });

    uncaughtExceptionHandlers.push(fn);
  }
};

// The BDD UI is registered by default, but no UI will be functional in the
// browser without an explicit call to the overridden `mocha.ui` (see below).
// Ensure that this default UI does not expose its methods to the global scope.
mocha.suite.removeAllListeners('pre-require');

const immediateQueue = [];
let immediateTimeout;

function timeslice() {
  const immediateStart = Date.now();
  while (immediateQueue.length > 0 && Date.now() - immediateStart < 100) {
    immediateQueue.shift()();
  }

  immediateTimeout =
    immediateQueue.length > 0 ? setTimeout(timeslice, 0) : null;
}

/**
 * High-performance override of Runner.immediately.
 */

Mocha.Runner.immediately = function (callback) {
  immediateQueue.push(callback);
  if (!immediateTimeout) {
    immediateTimeout = setTimeout(timeslice, 0);
  }
};

/**
 * Function to allow assertion libraries to throw errors directly into mocha.
 * This is useful when running tests in a browser because window.onerror will
 * only receive the 'message' attribute of the Error.
 *
 * @param {Error} err
 */
mocha.throwError = function (err) {
  for (const fn of uncaughtExceptionHandlers) {
    fn(err);
  }

  throw err;
};

/**
 * Override ui to ensure that the ui functions are initialized.
 * Normally this would happen in Mocha.prototype.loadFiles.
 */

mocha.ui = function (ui) {
  Mocha.prototype.ui.call(this, ui);
  this.suite.emit('pre-require', global, null, this);
  return this;
};

/**
 * Setup mocha with the given setting options.
 */

mocha.setup = function (opts) {
  if (typeof opts === 'string') {
    opts = { ui: opts };
  }

  for (const opt in opts) {
    if (Object.prototype.hasOwnProperty.call(opts, opt)) {
      this[opt](opts[opt]);
    }
  }

  return this;
};

/**
 * Run mocha, returning the Runner.
 */

mocha.run = function (fn) {
  const options = mocha.options;
  mocha.globals('location');

  const query = Mocha.utils.parseQuery(global.location.search || '');
  if (query.grep) {
    mocha.grep(query.grep);
  }

  if (query.fgrep) {
    mocha.fgrep(query.fgrep);
  }

  if (query.invert) {
    mocha.invert();
  }

  return Mocha.prototype.run.call(mocha, (err) => {
    // The DOM Document is not available in Web Workers.
    const document = global.document;
    if (
      document &&
      document.querySelector('#mocha') &&
      options.noHighlighting !== true
    ) {
      Mocha.utils.highlightTags('code');
    }

    if (fn) {
      fn(err);
    }
  });
};

/**
 * Expose the process shim.
 * https://github.com/mochajs/mocha/pull/916
 */

Mocha.process = process;

/**
 * Expose mocha.
 */

global.Mocha = Mocha;
global.mocha = mocha;

// This allows test/acceptance/required-tokens.js to pass; thus,
// you can now do `const describe = require('mocha').describe` in a
// browser context (assuming browserification).  should fix #880
module.exports = global;
