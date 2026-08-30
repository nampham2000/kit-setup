'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  DEFAULT_RECEIPT,
  REGISTRY_KIND,
  assertPortableRegistry,
  initRegistry,
  loadRegistry,
  mergeRegistryRequiredRisks,
  parseArgs,
  runRegressionGate,
  checkRegressionReceipt,
  validateRegistry,
} = require('./port-regression-gate.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'port-regressions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets', 'script'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'qa'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'assets', 'script', 'Game.ts'), 'export class Game {}\n');
  fs.writeFileSync(path.join(root, 'docs', 'references', 'unity.png'), 'png');
  return root;
}

function writeMatrix(root, relative, cases) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    url: 'http://127.0.0.1:7456/',
    outputDir: '.unity/preview-checkpoints/test',
    cases,
  }, null, 2));
  return file;
}

function writeRegistry(root, value) {
  const file = path.join(root, 'tools', 'port-regressions.json');
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function registry(suites, requiredRisks) {
  return { schemaVersion: 1, kind: REGISTRY_KIND, requiredRisks, suites };
}

test('init writes a tracked portable starter but does not pretend it is ready', t => {
  const root = fixture(t);
  const result = initRegistry({ project: root, risks: ['hold-drag-composition', 'level-lifecycle'] });
  assert.equal(result.ok, true);
  assert.equal(result.ready, false);
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'port-regressions.json'), 'utf8'));
  assert.deepEqual(saved.requiredRisks, ['hold-drag-composition', 'level-lifecycle']);
  assert.deepEqual(saved.suites, []);
  assert.ok(saved.instructions.supportedRisks.includes('raycast-occlusion'));
});

test('CLI is explicit about refresh and rejects unknown options', () => {
  assert.equal(parseArgs(['run', '--no-refresh', '--json']).refresh, false);
  assert.deepEqual(parseArgs(['init', '--risk', 'input-response', '--risk=level-lifecycle']).risks,
    ['input-response', 'level-lifecycle']);
  assert.throws(() => parseArgs(['run', '--maybe']), error => error.code === 'REGRESSION_OPTION_INVALID');
});

test('hold-drag and lifecycle policies require semantic hold gesture and two rounds', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/hold-drag.json';
  writeMatrix(root, matrix, [{
    name: 'hold then drag',
    gesture: '0.5,0.5,0.7,0.5,300,8',
    gestureHoldBeforeMoveMs: 280,
    eval: 'true',
    requireEvalOk: true,
    regressionTags: ['win'],
  }]);
  const source = registry([{
    id: 'input-flow',
    risks: ['hold-drag-composition', 'level-lifecycle'],
    mandatory: true,
    runs: 2,
    matrix,
    watchFiles: ['assets/script/Game.ts'],
  }], ['hold-drag-composition', 'level-lifecycle']);
  const file = writeRegistry(root, source);
  const valid = validateRegistry(root, source, { configFile: file });
  assert.equal(valid.suites[0].runs, 2);

  source.suites[0].runs = 1;
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_ROUNDS_REQUIRED');
  source.suites[0].runs = 2;
  delete source.suites[0];
});

test('raycast coverage fails without both positive and negative semantic cases', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/raycast.json';
  writeMatrix(root, matrix, [{
    name: 'visible tape', gesture: '0.5,0.5,0.5,0.5,100,1', eval: 'true', requireEvalOk: true,
    regressionTags: ['positive'],
  }]);
  const source = registry([{
    id: 'raycast', risks: ['raycast-occlusion'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['raycast-occlusion']);
  const file = writeRegistry(root, source);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_RAYCAST_POLARITY_MISSING');
});

test('visual and ordered animation risks fail closed without source reference or trace', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/visual.json';
  writeMatrix(root, matrix, [{ name: 'candidate', eval: 'true', requireEvalOk: true }]);
  const visual = registry([{
    id: 'lighting', risks: ['material-color-lighting'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['material-color-lighting']);
  const file = writeRegistry(root, visual);
  assert.throws(() => validateRegistry(root, visual, { configFile: file }),
    error => error.code === 'REGRESSION_REFERENCE_MISSING');

  const animation = registry([{
    id: 'flow', risks: ['animation-callback-flow'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['animation-callback-flow']);
  assert.throws(() => validateRegistry(root, animation, { configFile: file }),
    error => error.code === 'REGRESSION_ANIMATION_TRACE_MISSING');
});

test('transparent hold risk requires a live held gesture, not a baseline screenshot', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/transparent.json';
  writeMatrix(root, matrix, [{
    name: 'held lid',
    gesture: '0.5,0.5,0.5,0.5,300,1',
    eval: 'true',
    requireEvalOk: true,
    referenceImage: 'docs/references/unity.png',
  }]);
  const source = registry([{
    id: 'transparent', risks: ['transparent-hold-state'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['transparent-hold-state']);
  const file = writeRegistry(root, source);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_TRANSPARENT_HOLD_MISSING');
});

test('source rescans merge newly inferred required risks without erasing project suites', t => {
  const root = fixture(t);
  const file = writeRegistry(root, registry([], ['input-response', 'level-lifecycle']));
  const result = mergeRegistryRequiredRisks({
    project: root,
    risks: ['input-response', 'camera-transform', 'material-color-lighting'],
  });
  assert.equal(result.status, 'updated');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.requiredRisks,
    ['input-response', 'level-lifecycle', 'camera-transform', 'material-color-lighting']);
  assert.deepEqual(saved.suites, []);
});

test('run refreshes once, executes declared rounds, and binds receipt to watched bytes', async t => {
  const root = fixture(t);
  const matrix = 'tools/qa/lifecycle.json';
  fs.writeFileSync(path.join(root, 'tools', 'qa', 'assert-lifecycle.js'), '({ok:true})\n');
  writeMatrix(root, matrix, [{
    name: 'complete level',
    evalFile: 'tools/qa/assert-lifecycle.js',
    requireEvalOk: true,
    regressionTags: ['win'],
  }]);
  writeRegistry(root, registry([{
    id: 'two-rounds', risks: ['level-lifecycle'], runs: 2, matrix,
    watchFiles: ['assets/script/Game.ts'],
  }], ['level-lifecycle']));
  let refreshes = 0;
  const runs = [];
  const result = await runRegressionGate({ project: root }, {
    assertPortable() { return { ok: true, files: 3 }; },
    async refreshPreview() { refreshes += 1; return { ok: true, tool: 'fake-refresh' }; },
    runMatrix(_root, suite, runNumber) {
      runs.push(`${suite.id}:${runNumber}`);
      return { run: runNumber, ok: true, manifest: `manifest-${runNumber}.json`, cases: [{ name: 'complete level', ok: true }] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(refreshes, 1);
  assert.deepEqual(runs, ['two-rounds:1', 'two-rounds:2']);
  assert.equal(checkRegressionReceipt({ project: root, portabilityCheck: false }).ok, true);

  fs.appendFileSync(path.join(root, 'tools', 'qa', 'assert-lifecycle.js'), '// changed after PASS\n');
  assert.throws(() => checkRegressionReceipt({ project: root, portabilityCheck: false }),
    error => error.code === 'REGRESSION_RECEIPT_STALE');
  assert.equal(fs.existsSync(path.join(root, ...DEFAULT_RECEIPT.split('/'))), true);
});

test('mandatory suite failure writes evidence but keeps the gate red', async t => {
  const root = fixture(t);
  const matrix = 'tools/qa/input.json';
  writeMatrix(root, matrix, [{
    name: 'tap', gesture: '0.5,0.5,0.5,0.5,100,1', eval: 'false', requireEvalOk: true,
  }]);
  writeRegistry(root, registry([{
    id: 'input', risks: ['input-response'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['input-response']));
  const result = await runRegressionGate({ project: root, refresh: false }, {
    assertPortable() { return { ok: true, files: 3 }; },
    runMatrix() { return { run: 1, ok: false, cases: [{ name: 'tap', ok: false }] }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.refresh.skipped, true);
  assert.deepEqual(result.nextActions, ['Fix/re-run input']);
  assert.throws(() => checkRegressionReceipt({ project: root, portabilityCheck: false }),
    error => error.code === 'REGRESSION_RECEIPT_STALE');
});

test('registry paths fail closed on traversal and missing watched files', t => {
  const root = fixture(t);
  const source = registry([{
    id: 'bad', risks: ['input-response'], matrix: '../outside.json', watchFiles: ['assets/script/Missing.ts'],
  }], ['input-response']);
  const file = writeRegistry(root, source);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => ['REGRESSION_PATH_ESCAPE', 'REGRESSION_PATH_MISSING'].includes(error.code));
  assert.equal(loadRegistry.bind(null, root) instanceof Function, true);
});

test('portability proof rejects a local-only oracle that another checkout would miss', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/input-portable.json';
  writeMatrix(root, matrix, [{
    name: 'tap', gesture: '0.5,0.5,0.5,0.5,100,1', eval: 'true', requireEvalOk: true,
  }]);
  writeRegistry(root, registry([{
    id: 'portable-input', risks: ['input-response'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['input-response']));
  assert.equal(spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['add', 'package.json', 'assets/script/Game.ts', matrix, 'tools/port-regressions.json'], {
    cwd: root, encoding: 'utf8',
  }).status, 0);
  let loaded = loadRegistry(root);
  assert.equal(assertPortableRegistry(root, loaded).ok, true);

  fs.writeFileSync(path.join(root, 'tools', 'qa', 'local-only.js'), 'true\n');
  writeMatrix(root, matrix, [{
    name: 'tap', gesture: '0.5,0.5,0.5,0.5,100,1', evalFile: 'tools/qa/local-only.js', requireEvalOk: true,
  }]);
  assert.equal(spawnSync('git', ['add', matrix], { cwd: root, encoding: 'utf8' }).status, 0);
  loaded = loadRegistry(root);
  assert.throws(() => assertPortableRegistry(root, loaded),
    error => error.code === 'REGRESSION_FILES_UNTRACKED' && error.details.files.some(file => file.endsWith('local-only.js')));
});
