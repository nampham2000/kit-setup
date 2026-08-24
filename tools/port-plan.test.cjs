'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { CAPABILITIES } = require('../ai/capabilities.def.cjs');
const { createUnityFixture } = require('./unity-intel/test-fixture.cjs');
const { analyze, buildPlan, parseArgs } = require('./port-plan.cjs');

function invocation(id) {
  const capability = CAPABILITIES.find(item => item.id === id);
  return capability.npm || [capability.cmd, ...(capability.args || [])].join(' ');
}

test('legacy port-plan fields remain while recommendations use build-scene graph and capabilities', t => {
  const fixture = createUnityFixture(t);
  const analysis = analyze(fixture.assets, { top: 5, cache: false });
  const plan = buildPlan(fixture.assets, analysis);

  for (const key of ['_meta', 'inventory', 'estimate', 'suggestedOrder', 'blockers', 'heaviestPrefabs', 'scenes', 'skippedVendorDirs']) {
    assert.ok(Object.hasOwn(plan, key), `missing legacy key ${key}`);
  }
  assert.equal(plan.scenes[0].path, 'Game/Scenes/Main.unity');
  assert.deepEqual(plan.suggestedOrder[0].items, ['Game/Prefabs/Main.prefab', 'Game/Prefabs/Child.prefab']);
  assert.equal(plan.suggestedOrder[1].command, invocation('port.report'));
  assert.equal(plan.suggestedOrder[2].command, invocation('shader.batch'));
  assert.equal(plan.suggestedOrder[3].command, invocation('verify.prefab'));
  assert.equal(plan.suggestedOrder[4].command, invocation('build.playable'));
  assert.doesNotMatch(JSON.stringify(plan.suggestedOrder), /npm run port:report|unity-hlsl-to-cocos-effect/);
  assert.equal(plan._meta.snapshotSchemaVersion, 1);
  assert.equal(plan.project.unityVersion, '6000.0.66f2');
  assert.deepEqual(analysis.rootPrefabs.map(item => item.path), []);
  assert.deepEqual(analysis.entryPrefabs.map(item => item.path), ['Game/Prefabs/Main.prefab', 'Game/Prefabs/Child.prefab']);
});

test('buildPlan remains callable with the pre-snapshot analysis contract', () => {
  const legacy = {
    counts: { prefabs: 1, scenes: 1, scripts: 0, shaders: 0, shaderGraphs: 0 },
    totalMb: 1,
    scenes: [{ path: 'Scenes/Main.unity', kb: 1, gameObjects: 1, inlineMaterials: 0 }],
    rootPrefabs: [{ path: 'Prefabs/Game.prefab', kb: 1, gameObjects: 1, inlineMaterials: 0 }],
    heaviestPrefabs: [],
    skippedVendorDirs: [],
    blockers: [],
  };
  const plan = buildPlan('Assets', legacy);
  assert.equal(plan._meta.provider, 'legacy');
  assert.deepEqual(plan.suggestedOrder[0].items, ['Prefabs/Game.prefab']);
});

test('--project CLI emits one valid compact JSON document', t => {
  const fixture = createUnityFixture(t);
  const tool = path.resolve(__dirname, 'port-plan.cjs');
  const stdout = execFileSync(process.execPath, [tool, '--project', fixture.root, '--json', '--no-cache'], {
    encoding: 'utf8',
  });
  const plan = JSON.parse(stdout);
  assert.equal(plan.project.root.replace(/\\/g, '/'), fixture.root.replace(/\\/g, '/'));
  assert.equal(plan.cache.mode, 'disabled');
});

test('legacy --src CLI discovers the Unity project and emits compact JSON', t => {
  const fixture = createUnityFixture(t);
  const tool = path.resolve(__dirname, 'port-plan.cjs');
  const stdout = execFileSync(process.execPath, [tool, '--src', fixture.assets, '--json', '--no-cache'], {
    encoding: 'utf8',
  });
  const plan = JSON.parse(stdout);
  assert.equal(plan.project.root.replace(/\\/g, '/'), fixture.root.replace(/\\/g, '/'));
  assert.equal(plan.project.unityVersion, '6000.0.66f2');
});

test('argument parser supports legacy and project-root entry points and rejects invalid top', () => {
  assert.equal(parseArgs(['--src=Assets', '--top=3']).src, 'Assets');
  const project = parseArgs(['--project', 'UnityGame', '--no-cache']);
  assert.equal(project.src, path.join('UnityGame', 'Assets'));
  assert.equal(project.cache, false);
  assert.equal(parseArgs(['--src=Assets', '--refresh-cache']).refreshCache, true);
  assert.equal(parseArgs(['--src=Assets', '--include-vendor']).includeVendor, true);
  assert.throws(() => parseArgs(['--top=0']), /số nguyên/);
  assert.throws(() => parseArgs(['--unknown']), /không hỗ trợ/);
});
