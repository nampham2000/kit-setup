'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repeatingBurstSystems, attachBurstEmissionRuntime } = require('./particle-burst-emission-binding');

function builderWith(bursts) {
  const objects = [{ __type__: 'cc.Node', _name: 'Particles' }];
  const systems = bursts.map(list => {
    const refs = list.map(repeat => ({ __id__: objects.push({ __type__: 'cc.Burst', _time: 0, _repeatCount: repeat, repeatInterval: 0.01 }) - 1 }));
    return objects.push({ __type__: 'cc.ParticleSystem', node: { __id__: 0 }, bursts: refs }) - 1;
  });
  const added = [];
  return { systems, builder: { objects, cocosDb: { findScriptClass: () => ({ classId: 'burst-class' }) },
    addComponent: (nodeId, type, body) => added.push({ type, body }) }, added };
}

test('only systems with a repeating burst get the catch-up adapter', () => {
  // Hovl Magic circle 6 "Particles": 3 particles x 400 repeats every 0.01 s.
  const { systems, builder, added } = builderWith([[400], [1], [], [1, 2]]);
  assert.deepEqual(repeatingBurstSystems(builder).map(s => s.id), [systems[0], systems[3]]);
  const codes = [];
  attachBurstEmissionRuntime(builder, Object.fromEntries(['high', 'medium', 'low'].map(l => [l, c => codes.push(c)])),
    { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'burst-')) });
  assert.deepEqual(added.map(a => a.body.source.__id__), [systems[0], systems[3]]);
  assert.deepEqual(codes, ['PARTICLE_BURST_EMISSION_ADAPTER_BOUND']);
});

test('the adapter is required, not silently skipped, before AssetDB imports it', () => {
  const { builder } = builderWith([[400]]);
  builder.cocosDb.findScriptClass = () => null;
  const codes = [];
  attachBurstEmissionRuntime(builder, Object.fromEntries(['high', 'medium', 'low'].map(l => [l, c => codes.push(c)])),
    { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'burst-')) });
  assert.deepEqual(codes, ['PARTICLE_BURST_EMISSION_ADAPTER_REQUIRED', 'PARTICLE_BURST_EMISSION_ADAPTER_BOUND']);
});
