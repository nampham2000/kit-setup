'use strict';

// Unity 5.x/2017.1 ParticleSystem YAML (KriptoFX RFX4 Effect1_Collision "Particles") stores bursts as
// minCount/maxCount without countCurve. Unity upgrades them on load; the porter used to emit count 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUnityParticleDoc } = require('./particle-system-converter.js');

const doc = (bursts) => ({ lines: [
  'ParticleSystem:',
  '  EmissionModule:',
  '    enabled: 1',
  '    m_BurstCount: 2',
  '    m_Bursts:',
  ...bursts,
] });

test('legacy minCount/maxCount bursts become Unity-upgraded countCurves', () => {
  const data = parseUnityParticleDoc(doc([
    '    - time: 0',
    '      minCount: 7000',
    '      maxCount: 10000',
    '      cycleCount: 1',
    '      repeatInterval: 0.01',
    '    - time: 0.5',
    '      minCount: 30',
    '      maxCount: 30',
    '      cycleCount: 1',
    '      repeatInterval: 0.01',
  ]));
  const [random, constant] = data.EmissionModule.m_Bursts;
  assert.deepEqual(random.countCurve, { minMaxState: 3, scalar: 10000, minScalar: 7000 });
  assert.equal(random.probability, 1);
  assert.deepEqual(constant.countCurve, { minMaxState: 0, scalar: 30, minScalar: 30 });
});

test('current-format bursts keep their countCurve', () => {
  const data = parseUnityParticleDoc(doc([
    '    - serializedVersion: 2',
    '      time: 0',
    '      countCurve:',
    '        serializedVersion: 2',
    '        minMaxState: 0',
    '        scalar: 12',
    '        minScalar: 12',
    '      cycleCount: 1',
    '      repeatInterval: 0.01',
    '      probability: 0.5',
  ]));
  const [burst] = data.EmissionModule.m_Bursts;
  assert.equal(Number(burst.countCurve.scalar), 12);
  assert.equal(Number(burst.probability), 0.5);
});
