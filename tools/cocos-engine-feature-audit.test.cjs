'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EngineFeatureError,
  createEvidence,
  scanTextEvidence,
  decidePhysicsBackend,
  inferRequiredModules,
  auditCocosEngineFeatures,
  patchEngineProfile,
  sha256,
} = require('./cocos-engine-feature-audit.cjs');

function evidenceFor(text) {
  const evidence = createEvidence({ sourceEngine: 'unity-physx' });
  evidence.filesScanned = 1;
  return scanTextEvidence(text, 'assets/Test.prefab', evidence);
}

function engineDocument(backend = 'physics-builtin', graphics = false) {
  const backends = ['physics-builtin', 'physics-cannon', 'physics-ammo', 'physics-physx'];
  const cache = {
    base: { _value: true },
    graphics: { _value: graphics },
    physics: { _value: true, _option: backend },
  };
  for (const name of backends) cache[name] = { _value: name === backend };
  return {
    __version__: '1.0.12',
    modules: {
      configs: {
        defaultConfig: {
          name: 'Playable',
          cache,
          includeModules: ['base', backend, ...(graphics ? ['graphics'] : [])],
        },
      },
      globalConfigKey: 'defaultConfig',
    },
  };
}

function makeProject(sourceText, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-feature-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'Test.prefab'), sourceText);
  const settings = path.join(root, 'settings', 'v2', 'packages');
  fs.mkdirSync(settings, { recursive: true });
  fs.writeFileSync(path.join(settings, 'engine.json'), `${JSON.stringify(
    engineDocument(options.backend || 'physics-builtin', options.graphics || false), null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'settings', 'mcp-server.json'), '{"port":3000}\n');
  if (options.appliedFeatures) {
    const preview = path.join(root, 'temp', 'programming', 'packer-driver', 'targets', 'preview');
    fs.mkdirSync(preview, { recursive: true });
    const scope = {};
    options.appliedFeatures.forEach((name, index) => { scope[`__unresolved_${index}`] = `cce:/internal/x/cc-fu/${name}`; });
    fs.writeFileSync(path.join(preview, 'import-map.json'), `${JSON.stringify({ scopes: { cc: scope } }, null, 2)}\n`);
  }
  return root;
}

test('simple box/sphere query stays on Builtin even though Unity source uses PhysX', () => {
  const decision = decidePhysicsBackend(evidenceFor('[{"__type__":"cc.BoxCollider"},{"__type__":"cc.SphereCollider"}]'));
  assert.equal(decision.backend, 'physics-builtin');
  assert.equal(decision.complexity, 'simple-query-or-trigger');
  assert.ok(decision.reasons.includes('UNITY_PHYSX_SOURCE_ALONE_DOES_NOT_REQUIRE_HEAVY_BACKEND'));
});

test('MeshCollider selects Cannon instead of the unsupported Builtin backend', () => {
  const evidence = evidenceFor('[{"__type__":"cc.MeshCollider"}]');
  const decision = decidePhysicsBackend(evidence);
  assert.equal(decision.backend, 'physics-cannon');
  assert.equal(decision.complexity, 'query-with-complex-shapes');
  assert.deepEqual(inferRequiredModules(evidence, decision), ['physics-cannon']);
});

test('simple rigid-body simulation selects Cannon', () => {
  const decision = decidePhysicsBackend(evidenceFor('[{"__type__":"cc.RigidBody"},{"__type__":"cc.BoxCollider"}]'));
  assert.equal(decision.backend, 'physics-cannon');
  assert.equal(decision.complexity, 'simple-simulation');
});

test('CCD, sweep, character controller, and advanced constraints select Bullet', () => {
  const evidence = evidenceFor(`[
    {"__type__":"cc.RigidBody","_useCCD":true},
    {"__type__":"cc.CapsuleCharacterController"},
    {"__type__":"cc.ConfigurableConstraint"}
  ]\nPhysicsSystem.instance.sweepCapsule(ray, 1, 2, quat);`);
  const decision = decidePhysicsBackend(evidence);
  assert.equal(decision.backend, 'physics-ammo');
  assert.equal(decision.label, 'Bullet');
  assert.match(decision.rejected.find((item) => item.backend === 'physics-cannon').reason, /Cannon 3\.8\.8 lacks/);
});

test('namespaced animation controllers and imported model skeletons require animation, marionette, and skeletal modules', () => {
  const evidence = evidenceFor(`[
    {"__type__":"cc.animation.AnimationController"},
    {"importer":"gltf-skeleton"}
  ]`);
  assert.deepEqual(inferRequiredModules(evidence), ['animation', 'marionette', 'skeletal-animation']);
});

test('Cannon override fails closed when Capsule/CCD behavior would be lost', () => {
  const evidence = evidenceFor('[{"__type__":"cc.RigidBody","_useCCD":true},{"__type__":"cc.CapsuleCollider"}]');
  assert.throws(
    () => decidePhysicsBackend(evidence, { physicsBackend: 'physics-cannon' }),
    (error) => error instanceof EngineFeatureError && error.code === 'ENGINE_FEATURE_BACKEND_INCOMPATIBLE',
  );
});

test('Graphics and MeshCollider are audited against both profile and applied preview map', (t) => {
  const root = makeProject('[{"__type__":"cc.Graphics"},{"__type__":"cc.MeshCollider"}]', {
    backend: 'physics-cannon',
    graphics: true,
    appliedFeatures: ['base', 'graphics', 'physics-cannon', 'physics-framework'],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditCocosEngineFeatures(root);
  assert.equal(audit.complete, true);
  assert.deepEqual(audit.requiredModules, ['graphics', 'physics-cannon']);
  assert.equal(audit.physicsDecision.backend, 'physics-cannon');
});

test('stale preview import map is reported as pending Editor apply', (t) => {
  const root = makeProject('[{"__type__":"cc.Graphics"},{"__type__":"cc.MeshCollider"}]', {
    backend: 'physics-cannon', graphics: true, appliedFeatures: ['base', 'physics-builtin'],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditCocosEngineFeatures(root);
  assert.equal(audit.profile.complete, true);
  assert.equal(audit.complete, false);
  assert.equal(audit.pendingEditorApply, true);
  assert.deepEqual(audit.appliedPreview.missing, ['graphics', 'physics-cannon']);
});

test('import-map-silent marionette requires a preview regenerated after its profile write', (t) => {
  const root = makeProject('[{"__type__":"cc.animation.AnimationController"}]', {
    appliedFeatures: ['base', 'animation'],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engineFile = path.join(root, 'settings', 'v2', 'packages', 'engine.json');
  const previewFile = path.join(root, 'temp', 'programming', 'packer-driver', 'targets', 'preview', 'import-map.json');
  const document = JSON.parse(fs.readFileSync(engineFile, 'utf8'));
  const config = document.modules.configs.defaultConfig;
  config.cache.animation = { _value: true };
  config.cache.marionette = { _value: true };
  config.includeModules.push('animation', 'marionette');
  fs.writeFileSync(engineFile, `${JSON.stringify(document, null, 2)}\n`);
  fs.utimesSync(previewFile, new Date(1_000), new Date(1_000));
  fs.utimesSync(engineFile, new Date(2_000), new Date(2_000));

  const stale = auditCocosEngineFeatures(root);
  assert.equal(stale.complete, false);
  assert.deepEqual(stale.appliedPreview.missing, ['marionette']);

  fs.utimesSync(previewFile, new Date(3_000), new Date(3_000));
  const applied = auditCocosEngineFeatures(root);
  assert.equal(applied.complete, true);
  assert.deepEqual(applied.appliedPreview.inferredProfileFeatures, ['marionette']);
});

test('direct fallback patch writes exact backup, CAS receipt, and pending apply state', (t) => {
  const root = makeProject('[{"__type__":"cc.Graphics"},{"__type__":"cc.MeshCollider"}]');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engineFile = path.join(root, 'settings', 'v2', 'packages', 'engine.json');
  const before = fs.readFileSync(engineFile);
  const audit = auditCocosEngineFeatures(root);
  const receipt = patchEngineProfile(root, {
    requiredModules: audit.requiredModules,
    physicsBackend: audit.physicsDecision.backend,
  }, { now: 12345 });
  assert.equal(receipt.changed, true);
  assert.equal(receipt.fallbackUsed, true);
  assert.equal(receipt.pendingEditorApply, true);
  assert.equal(receipt.beforeHash, sha256(before));
  assert.deepEqual(fs.readFileSync(path.join(root, receipt.backupFile)), before);
  const after = JSON.parse(fs.readFileSync(engineFile, 'utf8'));
  const config = after.modules.configs.defaultConfig;
  assert.equal(config.cache.graphics._value, true);
  assert.equal(config.cache.physics._option, 'physics-cannon');
  assert.equal(config.cache['physics-builtin']._value, false);
  assert.equal(config.cache['physics-cannon']._value, true);
  assert.ok(config.includeModules.includes('graphics'));
  assert.ok(config.includeModules.includes('physics-cannon'));
  assert.ok(!config.includeModules.includes('physics-builtin'));
  assert.ok(fs.existsSync(path.join(root, receipt.receiptFile)));
});

test('direct fallback CAS refuses a concurrent engine.json edit', (t) => {
  const root = makeProject('[{"__type__":"cc.Graphics"}]');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditCocosEngineFeatures(root);
  const engineFile = path.join(root, 'settings', 'v2', 'packages', 'engine.json');
  assert.throws(
    () => patchEngineProfile(root, { requiredModules: audit.requiredModules }, {
      now: 23456,
      beforeReplace() { fs.appendFileSync(engineFile, ' '); },
    }),
    (error) => error instanceof EngineFeatureError && error.code === 'ENGINE_FEATURE_CAS_CONFLICT',
  );
});
