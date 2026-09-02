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
  restartCocosProject,
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
    spine: { _value: false, _option: 'spine-3.8' },
    'spine-3.8': { _value: true },
    'spine-4.2': { _value: false },
    'physics-2d': { _value: false, _option: 'physics-2d-builtin' },
    'physics-2d-box2d': { _value: false },
    'physics-2d-box2d-wasm': { _value: false },
    'physics-2d-builtin': { _value: true },
    'physics-2d-box2d-jsb': { _value: false },
    primitive: { _value: false },
    'occlusion-query': { _value: false },
    'geometry-renderer': { _value: false },
    'debug-renderer': { _value: false },
    terrain: { _value: false },
    'light-probe': { _value: false },
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
  const previewBeforeProfile = new Date(Date.UTC(2024, 0, 1, 0, 0, 10));
  const profileWrite = new Date(Date.UTC(2024, 0, 1, 0, 0, 20));
  const previewAfterProfile = new Date(Date.UTC(2024, 0, 1, 0, 0, 30));
  fs.utimesSync(previewFile, previewBeforeProfile, previewBeforeProfile);
  fs.utimesSync(engineFile, profileWrite, profileWrite);

  const stale = auditCocosEngineFeatures(root);
  assert.equal(stale.complete, false);
  assert.deepEqual(stale.appliedPreview.missing, ['marionette']);

  fs.utimesSync(previewFile, previewAfterProfile, previewAfterProfile);
  const applied = auditCocosEngineFeatures(root);
  assert.equal(applied.complete, true);
  assert.deepEqual(applied.appliedPreview.inferredProfileFeatures, ['marionette']);
});

test('Cocos-normalized option parents and preview aliases satisfy exact Spine and Physics2D closure', (t) => {
  const root = makeProject('[]', {
    appliedFeatures: [
      'base', 'animation', 'skeletal-animation', 'spine',
      'physics-2d-framework', 'physics-2d-box2d',
    ],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engineFile = path.join(root, 'settings', 'v2', 'packages', 'engine.json');
  const previewFile = path.join(root, 'temp', 'programming', 'packer-driver', 'targets', 'preview', 'import-map.json');
  const document = JSON.parse(fs.readFileSync(engineFile, 'utf8'));
  const config = document.modules.configs.defaultConfig;
  config.cache.animation = { _value: true };
  config.cache['skeletal-animation'] = { _value: true };
  config.cache.marionette = { _value: true };
  config.cache.spine = { _value: true, _option: 'spine-4.2' };
  config.cache['spine-3.8']._value = false;
  config.cache['spine-4.2']._value = true;
  config.cache['physics-2d'] = { _value: true, _option: 'physics-2d-box2d' };
  config.cache['physics-2d-builtin']._value = false;
  config.cache['physics-2d-box2d']._value = true;
  config.includeModules.push(
    'animation', 'skeletal-animation', 'marionette',
    'spine-4.2', 'physics-2d-box2d',
  );
  fs.writeFileSync(engineFile, `${JSON.stringify(document, null, 2)}\n`);
  const profileTime = new Date(Date.UTC(2024, 0, 1, 0, 0, 10));
  const previewTime = new Date(Date.UTC(2024, 0, 1, 0, 0, 20));
  fs.utimesSync(engineFile, profileTime, profileTime);
  fs.utimesSync(previewFile, previewTime, previewTime);

  const audit = auditCocosEngineFeatures(root, {
    requiredModules: [
      'animation', 'skeletal-animation', 'marionette',
      'spine', 'spine-4.2', 'physics-2d', 'physics-2d-box2d',
    ],
    spineBackend: 'spine-4.2',
    physics2dBackend: 'physics-2d-box2d',
  });
  assert.equal(audit.complete, true);
  assert.deepEqual(audit.profile.missing, []);
  assert.deepEqual(audit.appliedPreview.missing, []);
  assert.deepEqual(audit.appliedPreview.inferredProfileFeatures, ['marionette']);
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

test('direct fallback selects the exact versioned Spine backend and disables the alternative', (t) => {
  const root = makeProject('[]');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receipt = patchEngineProfile(root, {
    requiredModules: ['spine', 'spine-4.2'],
    spineBackend: 'spine-4.2',
  }, { now: 22334 });
  assert.equal(receipt.spineBackend, 'spine-4.2');
  const document = JSON.parse(fs.readFileSync(path.join(root, 'settings', 'v2', 'packages', 'engine.json'), 'utf8'));
  const config = document.modules.configs.defaultConfig;
  assert.equal(config.cache.spine._value, true);
  assert.equal(config.cache.spine._option, 'spine-4.2');
  assert.equal(config.cache['spine-3.8']._value, false);
  assert.equal(config.cache['spine-4.2']._value, true);
  assert.ok(!config.includeModules.includes('spine'));
  assert.ok(config.includeModules.includes('spine-4.2'));
  assert.ok(!config.includeModules.includes('spine-3.8'));
});

test('direct fallback selects an exclusive Physics2D Box2D backend', (t) => {
  const root = makeProject('[]');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receipt = patchEngineProfile(root, {
    requiredModules: ['physics-2d', 'physics-2d-box2d'],
    physics2dBackend: 'physics-2d-box2d',
  }, { now: 22335 });
  assert.equal(receipt.physics2dBackend, 'physics-2d-box2d');
  const document = JSON.parse(fs.readFileSync(path.join(root, 'settings', 'v2', 'packages', 'engine.json'), 'utf8'));
  const config = document.modules.configs.defaultConfig;
  assert.equal(config.cache['physics-2d']._value, true);
  assert.equal(config.cache['physics-2d']._option, 'physics-2d-box2d');
  assert.equal(config.cache['physics-2d-box2d']._value, true);
  for (const backend of ['physics-2d-box2d-wasm', 'physics-2d-builtin', 'physics-2d-box2d-jsb']) {
    assert.equal(config.cache[backend]._value, false);
    assert.ok(!config.includeModules.includes(backend));
  }
  assert.ok(!config.includeModules.includes('physics-2d'));
  assert.ok(config.includeModules.includes('physics-2d-box2d'));
});

test('exact source closure removes stale optional 3D false positives from cache and include', (t) => {
  const root = makeProject('[]');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engineFile = path.join(root, 'settings', 'v2', 'packages', 'engine.json');
  const document = JSON.parse(fs.readFileSync(engineFile, 'utf8'));
  const config = document.modules.configs.defaultConfig;
  for (const moduleName of ['primitive', 'debug-renderer']) {
    config.cache[moduleName]._value = true;
    config.includeModules.push(moduleName);
  }
  fs.writeFileSync(engineFile, `${JSON.stringify(document, null, 2)}\n`);

  const disabledModules = [
    'primitive', 'occlusion-query', 'geometry-renderer',
    'debug-renderer', 'terrain', 'light-probe',
  ];
  const before = auditCocosEngineFeatures(root, { requiredModules: [], disabledModules });
  assert.deepEqual(before.profile.unexpected, ['debug-renderer', 'primitive']);
  const receipt = patchEngineProfile(root, { requiredModules: [], disabledModules }, { now: 22336 });
  assert.deepEqual(receipt.disabledModules, disabledModules);
  const after = JSON.parse(fs.readFileSync(engineFile, 'utf8')).modules.configs.defaultConfig;
  for (const moduleName of disabledModules) {
    assert.equal(after.cache[moduleName]._value, false);
    assert.ok(!after.includeModules.includes(moduleName));
  }
});

test('Windows restart uses a quote-safe environment call and records non-zero exit as failure', async t => {
  const root = makeProject('[]');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '1_open-project.bat'), '@exit /b 0\r\n');
  let invocation;
  let waited = false;
  const receipt = await restartCocosProject(root, {
    platform: 'win32',
    restartScript: path.join(root, '1_open-project.bat'),
    portOwner: () => 123,
    waitForPort: async () => { waited = true; return true; },
    spawnSync(executable, args, options) {
      invocation = { executable, args, options };
      return { status: 1, signal: null, stdout: '', stderr: '\"D:\\Project\\1_open-project.bat\" is not recognized' };
    },
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(-2), ['-Command', '& $env:PLAYABLE_OPEN_PROJECT_BAT']);
  assert.equal(invocation.options.env.PLAYABLE_OPEN_PROJECT_BAT, path.join(root, '1_open-project.bat'));
  assert.equal(invocation.options.env.PLAYABLE_AUTOMATION_MODE, '1');
  assert.equal(waited, false);
  assert.equal(receipt.complete, false);
  assert.equal(receipt.processSucceeded, false);
  assert.match(receipt.error, /status 1/);
  assert.equal(receipt.processStatus, 1);
});

test('canonical Windows launcher exits cleanly before interactive console self-termination in automation mode', () => {
  const launcher = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', '1_open-project.bat'), 'utf8');
  const automationBranch = launcher.indexOf("$env:PLAYABLE_AUTOMATION_MODE -eq '1'");
  const cleanExit = launcher.indexOf('[Environment]::Exit(0)', automationBranch);
  const interactiveStop = launcher.indexOf('Stop-Process -Id $PID -Force', cleanExit);
  assert.ok(automationBranch >= 0, 'automation mode branch must exist');
  assert.ok(cleanExit > automationBranch, 'automation mode must return process status 0');
  assert.ok(interactiveStop > cleanExit, 'interactive self-termination must be unreachable in automation mode');
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
