'use strict';

const path = require('node:path');

const babel = require('@babel/core');
const helpers = require('@babel/helpers');
const runtimeVersion = require('@babel/runtime/package.json').version;
const template = require('@babel/template');
const t = require('@babel/types');
const outputFile = require('output-file-sync');

const transformRuntime = require('..');
const corejs2Definitions =
  require('../lib/runtime-corejs2-definitions').default();
const corejs3Definitions =
  require('../lib/runtime-corejs3-definitions').default();

writeHelpers('@babel/runtime');
writeHelpers('@babel/runtime-corejs2', { corejs: 2 });
writeHelpers('@babel/runtime-corejs3', {
  corejs: { version: 3, proposals: true },
});

writeCoreJS({
  corejs: 2,
  proposals: true,
  definitions: corejs2Definitions,
  paths: [
    'is-iterable',
    'get-iterator',
    // This was previously in definitions, but was removed to work around
    // zloirock/core-js#262. We need to keep it in @babel/runtime-corejs2 to
    // avoid a breaking change there.
    'symbol/async-iterator',
  ],
  corejsRoot: 'core-js/library/fn',
});
writeCoreJS({
  corejs: 3,
  proposals: false,
  definitions: corejs3Definitions,
  paths: [],
  corejsRoot: 'core-js-pure/stable',
});
writeCoreJS({
  corejs: 3,
  proposals: true,
  definitions: corejs3Definitions,
  paths: ['is-iterable', 'get-iterator', 'get-iterator-method'],
  corejsRoot: 'core-js-pure/features',
});

function writeCoreJS({
  corejs,
  proposals,
  definitions: { BuiltIns, StaticProperties, InstanceProperties },
  paths,
  corejsRoot,
}) {
  const pkgDirname = getRuntimeRoot(`@babel/runtime-corejs${corejs}`);

  for (const name of Object.keys(BuiltIns)) {
    const { stable, path } = BuiltIns[name];
    if (stable || proposals) paths.push(path);
  }

  for (const builtin of Object.keys(StaticProperties)) {
    const props = StaticProperties[builtin];
    for (const name of Object.keys(props)) {
      const { stable, path } = props[name];
      if (stable || proposals) paths.push(path);
    }
  }

  if (InstanceProperties) {
    for (const name of Object.keys(InstanceProperties)) {
      const { stable, path } = InstanceProperties[name];
      if (stable || proposals) paths.push(`instance/${path}`);
    }
  }

  const runtimeRoot = proposals ? 'core-js' : 'core-js-stable';
  for (const corejsPath of paths) {
    outputFile(
      path.join(pkgDirname, runtimeRoot, `${corejsPath}.js`),
      `module.exports = require("${corejsRoot}/${corejsPath}");`
    );
  }
}

function writeHelpers(runtimeName, { corejs } = {}) {
  writeHelperFiles(runtimeName, { corejs, esm: false });
  writeHelperFiles(runtimeName, { corejs, esm: true });
}

function writeHelperFiles(runtimeName, { esm, corejs }) {
  const pkgDirname = getRuntimeRoot(runtimeName);

  for (const helperName of helpers.list) {
    const helperFilename = path.join(
      pkgDirname,
      'helpers',
      esm ? 'esm' : '',
      `${helperName}.js`
    );

    outputFile(
      helperFilename,
      buildHelper(runtimeName, pkgDirname, helperFilename, helperName, {
        esm,
        corejs,
      })
    );
  }
}

function getRuntimeRoot(runtimeName) {
  return path.resolve(
    __dirname,
    '..',
    '..',
    runtimeName.replace(/^@babel\//, 'babel-')
  );
}

// eslint-disable-next-line max-params
function buildHelper(
  runtimeName,
  pkgDirname,
  helperFilename,
  helperName,
  { esm, corejs }
) {
  const tree = t.program([], [], esm ? 'module' : 'script');
  const dependencies = {};
  let bindings = null;

  if (!esm) {
    bindings = [];
    helpers.ensure(helperName, babel.File);
    for (const dep of helpers.getDependencies(helperName)) {
      // eslint-disable-next-line no-multi-assign
      const id = (dependencies[dep] = t.identifier(t.toIdentifier(dep)));
      tree.body.push(template.statement.ast`
        var ${id} = require("${`./${dep}`}");
      `);
      bindings.push(id.name);
    }
  }

  const helper = helpers.get(
    helperName,
    (dep) => dependencies[dep],
    esm ? null : template.expression.ast`module.exports`,
    bindings
  );
  tree.body.push(...helper.nodes);

  return babel.transformFromAst(tree, null, {
    filename: helperFilename,
    presets: [
      [
        '@babel/preset-env',
        { modules: false, exclude: ['@babel/plugin-transform-typeof-symbol'] },
      ],
    ],
    plugins: [
      [
        transformRuntime,
        { corejs, useESModules: esm, version: runtimeVersion },
      ],
      buildRuntimeRewritePlugin(
        runtimeName,
        path.relative(path.dirname(helperFilename), pkgDirname),
        helperName
      ),
    ],
    overrides: [
      {
        exclude: /typeof/,
        plugins: ['@babel/plugin-transform-typeof-symbol'],
      },
    ],
  }).code;
}

function buildRuntimeRewritePlugin(runtimeName, relativePath, helperName) {
  function adjustImportPath(node, relativePath) {
    node.value = helpers.list.includes(node.value)
      ? `./${node.value}`
      : node.value.replace(`${runtimeName}/`, `${relativePath}/`);
  }

  return {
    pre(file) {
      const original = file.get('helperGenerator');
      file.set('helperGenerator', (name) => {
        // Make sure that helpers won't insert circular references to themselves
        if (name === helperName) return false;

        return original(name);
      });
    },
    visitor: {
      ImportDeclaration(path) {
        adjustImportPath(path.get('source').node, relativePath);
      },
      CallExpression(path) {
        if (
          !path.get('callee').isIdentifier({ name: 'require' }) ||
          path.get('arguments').length !== 1 ||
          !path.get('arguments')[0].isStringLiteral()
        ) {
          return;
        }

        // Replace any reference to @babel/runtime and other helpers
        // with a relative path
        adjustImportPath(path.get('arguments')[0].node, relativePath);
      },
    },
  };
}
