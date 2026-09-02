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
  fs.mkdirSync(path.join(root, 'assets', 'effects'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'prefabs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'qa'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'assets', 'script', 'Game.ts'), 'export class Game {}\n');
  fs.writeFileSync(path.join(root, 'assets', 'effects', 'Tape.effect'), 'CCEffect %{}\n');
  fs.writeFileSync(path.join(root, 'assets', 'prefabs', 'Roll.prefab'), '[]\n');
  fs.writeFileSync(path.join(root, 'docs', 'references', 'unity.png'), 'png');
  fs.writeFileSync(path.join(root, 'docs', 'references', 'animation-oracle.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'unity-animation-curve-oracle',
    completeness: 'complete',
    clipCount: 1,
    clips: [{
      source: 'Assets/Animations/Holder.anim',
      sha256: 'a'.repeat(64),
      duration: 0.5,
      loop: false,
      completeness: 'complete',
      tracks: [{ path: 'Holder', property: 'scale', animatedChannels: ['y'], channels: {} }],
    }],
  }, null, 2));
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
  assert.deepEqual(parseArgs(['run', '--suite', 'lifecycle', '--suite=visual']).suites,
    ['lifecycle', 'visual']);
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

test('raycast coverage accepts a positive gesture resolved from evalBefore runtime evidence', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/raycast-runtime-target.json';
  writeMatrix(root, matrix, [{
    name: 'visible runtime target',
    evalBefore: '({ target: { x: 0.2, y: 0.3 } })',
    gestureFromEvalBefore: {
      x1: 'target.x', y1: 'target.y', x2: 'target.x', y2: 'target.y', durationMs: 80, steps: 1,
    },
    eval: 'true', requireEvalOk: true, regressionTags: ['positive'],
  }, {
    name: 'covered target', gesture: '0.5,0.5,0.5,0.5,100,1', eval: 'true', requireEvalOk: true,
    regressionTags: ['negative'],
  }]);
  const source = registry([{
    id: 'raycast-runtime-target', risks: ['raycast-occlusion'], matrix,
    watchFiles: ['assets/script/Game.ts'],
  }], ['raycast-occlusion']);
  const file = writeRegistry(root, source);
  assert.doesNotThrow(() => validateRegistry(root, source, { configFile: file }));
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

test('responsive layout accepts a source reference plus a metric-bound short viewport', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/responsive-layout.json';
  const metrics = {
    layoutOverlapMax: { max: 0.01 },
    slicedBorderInsetError: { max: 0.001 },
  };
  const cases = [{
    name: 'source portrait',
    windowSize: '744x1061',
    eval: 'true',
    requireEvalOk: true,
    requiredEvalMetrics: metrics,
    referenceImage: 'docs/references/unity.png',
    requiredReferenceMetrics: { foregroundIou: { min: 0.8 } },
    regressionTags: ['source-viewport'],
  }, {
    name: 'short wide',
    windowSize: '762x756',
    eval: 'true',
    requireEvalOk: true,
    requiredEvalMetrics: metrics,
    regressionTags: ['short-wide-viewport'],
  }];
  writeMatrix(root, matrix, cases);
  const source = registry([{
    id: 'responsive', risks: ['responsive-layout'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['responsive-layout']);
  const file = writeRegistry(root, source);
  assert.equal(validateRegistry(root, source, { configFile: file }).suites[0].risks[0], 'responsive-layout');

  cases[1].requiredEvalMetrics = { layoutOverlapMax: { max: 0.01 } };
  writeMatrix(root, matrix, cases);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_RESPONSIVE_LAYOUT_ORACLE_MISSING');
});

test('animation curve fidelity requires a portable source oracle and bounded runtime curve metrics', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/animation-curves.json';
  const curveCase = {
    name: 'holder curve',
    eval: 'true',
    requireEvalOk: true,
    requiredTrace: ['snap-start', 'snap-complete'],
    referenceImage: 'docs/references/unity.png',
    animationOracle: 'docs/references/animation-oracle.json',
    requiredEvalMetrics: {
      crossAxisMaxError: { max: 0.001 },
      curveExtremaMaxError: { max: 0.02 },
      singleShotPhaseCountError: { max: 0 },
      timingMaxErrorMs: { max: 80 },
      oracleClipCount: { min: 1 },
    },
  };
  writeMatrix(root, matrix, [curveCase]);
  const source = registry([{
    id: 'holder-curves',
    risks: ['animation-curve-fidelity'],
    matrix,
    watchFiles: ['assets/script/Game.ts'],
  }], ['animation-curve-fidelity']);
  const file = writeRegistry(root, source);
  const valid = validateRegistry(root, source, { configFile: file });
  assert.equal(valid.suites[0].matrixEvidence.dependencies.some(item =>
    item.relative === 'docs/references/animation-oracle.json'), true);

  delete curveCase.requiredEvalMetrics.curveExtremaMaxError;
  writeMatrix(root, matrix, [curveCase]);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_ANIMATION_CURVE_ORACLE_MISSING');

  curveCase.requiredEvalMetrics.curveExtremaMaxError = { max: 0.02 };
  curveCase.animationOracle = 'docs/references/unity.png';
  writeMatrix(root, matrix, [curveCase]);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_ANIMATION_ORACLE_INVALID');

  curveCase.animationOracle = 'docs/references/animation-oracle.json';
  const partial = JSON.parse(fs.readFileSync(path.join(root, curveCase.animationOracle), 'utf8'));
  partial.completeness = 'partial';
  partial.clips[0].completeness = 'partial';
  partial.diagnostics = [{ severity: 'high', code: 'ANIMATION_EVENT_SKIPPED' }];
  fs.writeFileSync(path.join(root, curveCase.animationOracle), JSON.stringify(partial));
  writeMatrix(root, matrix, [curveCase]);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_ANIMATION_ORACLE_INVALID');
});

test('runtime mesh animation requires linear and curved metric oracles plus watched render assets', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/runtime-mesh.json';
  const requiredEvalMetrics = {
    actionStarted: { min: 1 },
    longitudinalUvSpan: { min: 0.9 },
    longitudinalUvMaxError: { max: 0.0001 },
    positionError: { max: 0.02 },
    directionDot: { min: 0.97 },
    rootScaleError: { max: 0.001 },
    thicknessError: { max: 0.001 },
  };
  const meshCase = (name, tag) => ({
    name,
    gesture: '0.5,0.5,0.5,0.5,100,1',
    evalBefore: 'true',
    requireEvalBeforeOk: true,
    requiredEvalBeforeMetrics: { actionStarted: { min: 0, max: 0 } },
    eval: 'true',
    requireEvalOk: true,
    requiredTrace: ['roll-start', 'roll-volume-ready'],
    requiredEvalMetrics,
    referenceImage: 'docs/references/unity.png',
    regressionTags: [tag],
  });
  writeMatrix(root, matrix, [meshCase('linear ribbon', 'linear-path'), meshCase('curved ribbon', 'curved-path')]);
  const source = registry([{
    id: 'mesh-peel',
    risks: ['runtime-mesh-animation'],
    matrix,
    watchFiles: ['assets/script/Game.ts', 'assets/effects/Tape.effect', 'assets/prefabs/Roll.prefab'],
  }], ['runtime-mesh-animation']);
  const file = writeRegistry(root, source);
  assert.equal(validateRegistry(root, source, { configFile: file }).suites[0].risks[0], 'runtime-mesh-animation');

  const invalidMatrix = JSON.parse(fs.readFileSync(path.join(root, ...matrix.split('/')), 'utf8'));
  delete invalidMatrix.cases[1].requiredEvalMetrics.directionDot;
  writeMatrix(root, matrix, invalidMatrix.cases);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_RUNTIME_MESH_ORACLE_MISSING');

  const directActionMatrix = [meshCase('linear ribbon', 'linear-path'), meshCase('curved ribbon', 'curved-path')];
  delete directActionMatrix[0].requiredEvalBeforeMetrics;
  writeMatrix(root, matrix, directActionMatrix);
  assert.throws(() => validateRegistry(root, source, { configFile: file }),
    error => error.code === 'REGRESSION_RUNTIME_MESH_ORACLE_MISSING');
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

test('selective suite rerun merges only into a current complete receipt', async t => {
  const root = fixture(t);
  const firstMatrix = 'tools/qa/first.json';
  const secondMatrix = 'tools/qa/second.json';
  writeMatrix(root, firstMatrix, [{
    name: 'first tap', gesture: '0.5,0.5,0.5,0.5,100,1', eval: 'true', requireEvalOk: true,
  }]);
  writeMatrix(root, secondMatrix, [{
    name: 'second tap', gesture: '0.5,0.5,0.5,0.5,100,1', eval: 'true', requireEvalOk: true,
  }]);
  writeRegistry(root, registry([
    { id: 'first', risks: ['input-response'], matrix: firstMatrix, watchFiles: ['assets/script/Game.ts'] },
    { id: 'second', risks: ['input-response'], matrix: secondMatrix, watchFiles: ['assets/script/Game.ts'] },
  ], ['input-response']));
  let phase = 'initial';
  const executed = [];
  const dependencies = {
    assertPortable() { return { ok: true, files: 4 }; },
    async refreshPreview() { return { ok: true, tool: 'fake-refresh' }; },
    runMatrix(_root, suite, runNumber) {
      executed.push(`${phase}:${suite.id}`);
      return { run: runNumber, ok: phase === 'rerun' || suite.id === 'second', cases: [] };
    },
  };
  const initial = await runRegressionGate({ project: root }, dependencies);
  assert.equal(initial.ok, false);
  phase = 'rerun';
  const rerun = await runRegressionGate({ project: root, suites: ['first'] }, dependencies);
  assert.equal(rerun.ok, true);
  assert.deepEqual(rerun.selectiveRerun, ['first']);
  assert.deepEqual(executed, ['initial:first', 'initial:second', 'rerun:first']);
  assert.deepEqual(rerun.suites.map(item => [item.id, item.ok]), [['first', true], ['second', true]]);
  assert.equal(checkRegressionReceipt({ project: root, portabilityCheck: false }).ok, true);
});

test('input concurrency requires distinct real gestures, overlap ordering and collision-free reservations', t => {
  const root = fixture(t);
  const matrix = 'tools/qa/input-concurrency.json';
  writeMatrix(root, matrix, [{
    name: 'two rapid taps',
    gesturesFromEvalBefore: [
      { x1: 'targets.0.x', y1: 'targets.0.y', x2: 'targets.0.x', y2: 'targets.0.y',
        durationMs: 30, steps: 1 },
      { x1: 'targets.1.x', y1: 'targets.1.y', x2: 'targets.1.x', y2: 'targets.1.y',
        durationMs: 30, steps: 1 },
    ],
    gestureGapMs: 50,
    evalBefore: '({ok:true,actionStarted:0,targets:[{x:0.2,y:0.5},{x:0.8,y:0.5}]})',
    requireEvalBeforeOk: true,
    requiredEvalBeforeMetrics: { actionStarted: { min: 0, max: 0 } },
    eval: '({ok:true})',
    requireEvalOk: true,
    requiredEvalMetrics: {
      actionStarted: { min: 2 },
      concurrentActions: { min: 2 },
      secondStartsBeforeFirstCompletes: { min: 1 },
      uniqueReservedDestinationCount: { min: 2 },
      reservationCollisionCount: { max: 0 },
    },
  }]);
  const source = registry([{
    id: 'rapid-input', risks: ['input-concurrency'], matrix, watchFiles: ['assets/script/Game.ts'],
  }], ['input-concurrency']);
  const file = writeRegistry(root, source);
  assert.doesNotThrow(() => validateRegistry(root, source, { configFile: file }));

  const broken = JSON.parse(JSON.stringify(source));
  const brokenMatrix = 'tools/qa/input-concurrency-broken.json';
  broken.suites[0].matrix = brokenMatrix;
  writeMatrix(root, brokenMatrix, [{
    name: 'serialized taps',
    gestures: ['0.2,0.5,0.2,0.5,30,1', '0.8,0.5,0.8,0.5,30,1'],
    evalBefore: '({ok:true})', requireEvalBeforeOk: true,
    requiredEvalBeforeMetrics: { actionStarted: { min: 0, max: 0 } },
    eval: '({ok:true})', requireEvalOk: true,
    requiredEvalMetrics: { actionStarted: { min: 2 } },
  }]);
  assert.throws(() => validateRegistry(root, broken, { configFile: file }),
    error => error.code === 'REGRESSION_INPUT_CONCURRENCY_ORACLE_MISSING');
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
