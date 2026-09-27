'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { particleCollisionContract, attachCollisionRuntime } = require('./particle-collision-binding');

// ARPG Effects Rain: World collision that kills on contact (lifetime loss 1) and fires
// Splash (burst 4-6) and Ripple (burst 1) with probability 0.5 each, inheriting color.
const rain = {
  CollisionModule: {
    enabled: 1, type: 1, collisionMode: 0, collisionMessages: 0, radiusScale: 0.15, minKillSpeed: 0, maxKillSpeed: 10000,
    m_Dampen: { minMaxState: 0, scalar: 1 }, m_Bounce: { minMaxState: 0, scalar: 0 }, m_EnergyLossOnCollision: { minMaxState: 0, scalar: 1 },
  },
  SubModule: { enabled: 1, subEmitters: [
    { emitter: { fileID: '11' }, type: 1, properties: 1, emitProbability: 0.5 },
    { emitter: { fileID: '12' }, type: 1, properties: 1, emitProbability: 0.5 },
    { emitter: { fileID: '13' }, type: 0, properties: 0, emitProbability: 1 },
  ] },
};

const reports = () => {
  const entries = [];
  return { entries, ...Object.fromEntries(['high', 'medium', 'low'].map(level => [level, (code) => entries.push({ level, code })])) };
};

function builderWith(contract) {
  const curve = (min, max) => ({ __type__: 'cc.CurveRange', mode: 3, multiplier: 1, constantMin: min, constantMax: max });
  const objects = [
    { __type__: 'cc.Node', _name: 'Rain', _components: [] },
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, bursts: [] },
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, playOnAwake: true, bursts: [{ __id__: 3 }] },
    { __type__: 'cc.Burst', count: { __id__: 4 } }, curve(4, 6),
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, playOnAwake: true, bursts: [] },
  ];
  Object.defineProperty(objects[1], 'unityCollisionContract', { value: contract });
  const added = [];
  return {
    objects, added, componentMap: new Map([['11', 2], ['12', 5]]),
    cocosDb: { findScriptClass: () => ({ classId: 'collision-class' }) },
    addComponent(nodeId, type, body) { added.push({ nodeId, type, body }); return objects.push({ __type__: type, ...body }) - 1; },
  };
}

test('World collision contract keeps kill/response values and collision sub-emitters only', () => {
  const spec = particleCollisionContract(rain);
  assert.equal(spec.enabled, true);
  assert.equal(spec.type, 1);
  assert.deepEqual([spec.dampen, spec.bounce, spec.lifetimeLoss, spec.radiusScale], [1, 0, 1, 0.15]);
  assert.deepEqual(spec.subEmitters.map(s => [s.fileId, s.probability, s.inheritColor]), [['11', 0.5, true], ['12', 0.5, true]]);
});

test('binding attaches the adapter with sub-emitter targets and their burst counts', () => {
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collision-'));
  const builder = builderWith(particleCollisionContract(rain));
  const reporter = reports();
  attachCollisionRuntime(builder, reporter, { cocosRoot });
  assert.equal(builder.added.length, 1);
  const body = builder.added[0].body;
  assert.deepEqual(body.targets, [{ __id__: 2 }, { __id__: 5 }]);
  const contract = JSON.parse(body.sourceContract);
  assert.deepEqual(contract.subEmitters.map(s => [s.countMin, s.countMax]), [[4, 6], [0, 0]]);
  assert.equal(builder.objects[2].playOnAwake, false, 'sub-emitters only emit on collision');
  assert.ok(fs.existsSync(path.join(cocosRoot, 'assets/script/UnityParticleCollision.ts')));
  assert.deepEqual(reporter.entries.map(e => e.code), ['PARTICLE_COLLISION_ADAPTER_BOUND']);
});

test('unmeasured collision modes are reported, never silently dropped', () => {
  const planes = particleCollisionContract({ CollisionModule: { ...rain.CollisionModule, type: 0 } });
  const reporter = reports();
  attachCollisionRuntime(builderWith(planes), reporter, { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'collision-')) });
  assert.deepEqual(reporter.entries.map(e => [e.level, e.code]), [['high', 'PARTICLE_COLLISION_UNSUPPORTED']]);
  const messages = particleCollisionContract({ CollisionModule: { ...rain.CollisionModule, collisionMessages: 1, m_Dampen: { minMaxState: 3, scalar: 1 } } });
  const report2 = reports();
  const messageBuilder = builderWith(messages);
  attachCollisionRuntime(messageBuilder, report2, { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'collision-')) });
  // OnParticleCollision reaches ported scripts as a node event, flagged in the contract.
  assert.deepEqual(report2.entries.map(e => [e.level, e.code]), [['low', 'PARTICLE_COLLISION_MESSAGES_EVENT'], ['medium', 'PARTICLE_COLLISION_CURVE_APPROXIMATED'], ['low', 'PARTICLE_COLLISION_ADAPTER_BOUND']]);
  assert.equal(JSON.parse(messageBuilder.added[0].body.sourceContract).messages, true);
});
