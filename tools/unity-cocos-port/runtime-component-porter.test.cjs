'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const createRuntimeComponentPorter = require('./runtime-component-porter');
const { compressUuid } = require('./core-utils');

const EXPECTED_ADAPTER_UUID = 'da442ca6-9109-44ca-9d06-c8e0f53e149d';
const EXPECTED_ADAPTER_CLASS_ID = 'da442ymkQlEyp0GyOD1PhSd';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-component-porter-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  return root;
}

function makePorter() {
  return createRuntimeComponentPorter({
    ensureDirectoryMetas() {},
    syncImportedMaterialLibraryCache() {},
  });
}

function makeReporter() {
  const events = [];
  return {
    events,
    high(code) { events.push({ severity: 'high', code }); },
    medium(code) { events.push({ severity: 'medium', code }); },
    low(code) { events.push({ severity: 'low', code }); },
  };
}

test('writes generated runtime adapters to canonical assets/script with stable UUID', () => {
  const root = makeProject();
  try {
    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    const target = path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts');
    const meta = JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8'));
    assert.equal(fs.existsSync(target), true);
    assert.equal(meta.uuid, EXPECTED_ADAPTER_UUID);
    assert.equal(compressUuid(meta.uuid), EXPECTED_ADAPTER_CLASS_ID);
    assert.equal(fs.existsSync(path.join(root, 'assets', 'scripts')), false);
    assert.deepEqual(reporter.events, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrates an exact legacy adapter and preserves the UUID used by existing prefabs', () => {
  const root = makeProject();
  try {
    const template = path.join(__dirname, 'runtime', 'UnitySpriteRendererColorAdapter.ts');
    const legacy = path.join(root, 'assets', 'scripts', 'UnitySpriteRendererColorAdapter.ts');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.copyFileSync(template, legacy);
    fs.writeFileSync(`${legacy}.meta`, `${JSON.stringify({
      ver: '4.0.24', importer: 'typescript', imported: true, uuid: EXPECTED_ADAPTER_UUID, files: [], subMetas: {}, userData: {},
    }, null, 2)}\n`);

    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    const target = path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts');
    const meta = JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8'));
    assert.equal(meta.uuid, EXPECTED_ADAPTER_UUID);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.existsSync(`${legacy}.meta`), false);
    assert.equal(reporter.events.some((event) => event.code === 'RUNTIME_SCRIPT_CANONICAL_PATH_MIGRATED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to overwrite a customized legacy adapter', () => {
  const root = makeProject();
  try {
    const legacy = path.join(root, 'assets', 'scripts', 'UnitySpriteRendererColorAdapter.ts');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '// project-specific adapter\n');

    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    assert.equal(fs.existsSync(path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts')), false);
    assert.equal(fs.readFileSync(legacy, 'utf8'), '// project-specific adapter\n');
    assert.equal(reporter.events.some((event) => event.code === 'RUNTIME_SCRIPT_LEGACY_CUSTOMIZED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to delete a legacy adapter when canonical and legacy UUIDs conflict', () => {
  const root = makeProject();
  try {
    const template = path.join(__dirname, 'runtime', 'UnitySpriteRendererColorAdapter.ts');
    const legacy = path.join(root, 'assets', 'scripts', 'UnitySpriteRendererColorAdapter.ts');
    const target = path.join(root, 'assets', 'script', 'UnitySpriteRendererColorAdapter.ts');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(template, legacy);
    fs.copyFileSync(template, target);
    fs.writeFileSync(`${legacy}.meta`, JSON.stringify({ uuid: EXPECTED_ADAPTER_UUID }));
    fs.writeFileSync(`${target}.meta`, JSON.stringify({ uuid: '11111111-2222-4333-8444-555555555555' }));

    const reporter = makeReporter();
    makePorter().ensureSpriteRendererColorAdapterScript({ cocosRoot: root, dryRun: false }, reporter);

    assert.equal(fs.existsSync(legacy), true);
    assert.equal(fs.existsSync(`${legacy}.meta`), true);
    assert.equal(reporter.events.some((event) => event.code === 'RUNTIME_SCRIPT_UUID_CONFLICT'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('attaches the module-space adapter only to systems whose velocity/force module runs in the other space', () => {
  const root = makeProject();
  try {
    const reporter = makeReporter();
    const porter = makePorter();
    porter.ensureParticleModuleSpaceScript({ cocosRoot: root, dryRun: false }, reporter);
    const classId = compressUuid(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'script', 'UnityParticleModuleSpace.ts.meta'), 'utf8')).uuid);
    // 0 root node, 1 world system (local velocity: needs it), 2 its velocity module, 3 node, 4 world system (world velocity: does not).
    const objects = [
      { __type__: 'cc.Node', _name: 'Dust', _components: [{ __id__: 1 }] },
      { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _simulationSpace: 0, _velocityOvertimeModule: { __id__: 2 } },
      { __type__: 'cc.VelocityOvertimeModule', _enable: true, space: 1 },
      { __type__: 'cc.Node', _name: 'Smoke', _components: [{ __id__: 4 }] },
      { __type__: 'cc.ParticleSystem', node: { __id__: 3 }, _simulationSpace: 0, _velocityOvertimeModule: { __id__: 5 } },
      { __type__: 'cc.VelocityOvertimeModule', _enable: true, space: 0 },
    ];
    const added = [];
    const builder = { objects, cocosDb: { root }, addComponent(nodeId, type, props) { added.push({ nodeId, type, props }); } };
    porter.attachParticleModuleSpace(builder, reporter);
    assert.deepEqual(added, [{ nodeId: 0, type: classId, props: { particleSystem: { __id__: 1 } } }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('birth sub-emitter entries carry the Unity sub-emitter timeline instead of a fixed rate', () => {
  const root = makeProject();
  try {
    const reporter = makeReporter();
    const porter = makePorter();
    porter.ensureParticleSubEmitterFollowerScript({ cocosRoot: root, dryRun: false }, reporter);
    // Tanks! shell explosion: root smoke spawns "Trails" per particle (rate 100/s, 0.3 s, not looping, one burst).
    const objects = [
      { __type__: 'cc.Node', _name: 'Explosion', _components: [{ __id__: 1 }] },
      { __type__: 'cc.ParticleSystem', node: { __id__: 0 } },
      { __type__: 'cc.Node', _name: 'Trails', _components: [{ __id__: 3 }] },
      { __type__: 'cc.ParticleSystem', node: { __id__: 2 }, rateOverTime: { __id__: 4 }, bursts: [{ __id__: 5 }] },
      { __type__: 'cc.CurveRange', mode: 0, constant: 100 },
      { __type__: 'cc.Burst' },
    ];
    const components = [];
    const builder = {
      objects, cocosDb: { root }, componentMap: new Map([['11', 1], ['22', 3]]),
      addComponent(nodeId, type, props) { objects.push({ __type__: type, node: { __id__: nodeId }, ...props }); objects[nodeId]._components.push({ __id__: objects.length - 1 }); components.push(objects.length - 1); return objects.length - 1; },
    };
    const model = { file: 'Explosion.prefab', componentDocs: new Map([
      ['11', { classId: 198, SubModule: { enabled: 1, subEmitters: [{ emitter: { fileID: 22 }, type: 0, properties: 0, emitProbability: 1 }] } }],
      ['22', { classId: 198, lengthInSec: 0.3, looping: 0, EmissionModule: { rateOverTime: { minMaxState: 0, scalar: 100 },
        m_Bursts: [{ time: 0.1, countCurve: { minMaxState: 0, scalar: 4 }, cycleCount: 1, probability: 1 }] } }],
    ]) };
    porter.attachParticleSubEmitterFollowers(model, builder, reporter);
    const entry = objects[components[0]].entries[0];
    assert.deepEqual({ rate: entry.emitRatePerParticle, duration: entry.emitterDuration, looping: entry.emitterLooping, times: entry.burstTimes, counts: entry.burstCounts },
      { rate: 100, duration: 0.3, looping: false, times: [0.1], counts: [4] });
    assert.deepEqual(objects[3].bursts, []);
    assert.equal(objects[4].constant, 0);
    assert.deepEqual(reporter.events.filter((e) => e.severity !== 'low'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('procedural particle envelope reproduces Unity renderer bounds centres (Tanks! Unity 6 measurements)', () => {
  const { unityProceduralEnvelope } = require('./runtime-component-porter');
  const curve = (scalar) => ({ minMaxState: 0, scalar });
  const system = (shape, speed, life, gravity) => ({ moveWithTransform: 0, EmissionModule: { enabled: 1 },
    InitialModule: { startSpeed: curve(speed), startLifetime: curve(life), gravityModifier: curve(gravity) }, ShapeModule: { enabled: 1, ...shape } });
  // Centre in the system's local space for a world rotation Rx(degrees) (Unity), gravity = world -Y.
  const centre = (envelope, degrees = 0) => {
    const t = -degrees * Math.PI / 180; // inverse rotation about X
    const g = [0, -envelope.gravityDrop * Math.cos(t), -envelope.gravityDrop * Math.sin(t)];
    return [0, 1, 2].map((axis) => (Math.min(envelope.min[axis], envelope.min[axis] + g[axis]) + Math.max(envelope.max[axis], envelope.max[axis] + g[axis])) / 2);
  };
  const cone = { type: 4, radius: { value: 0.3954363 }, angle: 0 };
  const close = (got, want) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 2e-3, JSON.stringify({ got, want })));
  close(centre(unityProceduralEnvelope(system(cone, 0.7898, 0.2, 0))), [0, 0, 0.079]); // CompleteShellExplosion/Burst
  close(centre(unityProceduralEnvelope(system(cone, 0.7898, 0.3, 0))), [0, 0, 0.118]); // PowerUpEffect
  close(centre(unityProceduralEnvelope(system({ type: 2, radius: { value: 0.55 } }, 10, 0.3, 1)), 279.22), [0, -0.035, 1.557]); // PowerUpEffect/Trails
  assert.equal(unityProceduralEnvelope({ ...system(cone, 1, 1, 0), moveWithTransform: 1 }), null); // world space: live bounds
  assert.equal(unityProceduralEnvelope({ ...system(cone, 1, 1, 0), SubModule: { enabled: 1 } }), null); // sub-emitter parent
});
