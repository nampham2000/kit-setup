'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
test('rotated parent is applied once to a child emitter, including nonzero authored child rotation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'UnityParticleHierarchyTransformSync.ts'), 'utf8');
  const body = source.slice(source.indexOf('    this.node.getWorldRotation'), source.lastIndexOf('\n  }'));
  const run = new Function('Quat', body);
  for (const root of [-90, 37]) for (const local of [0, 18]) {
    let world;
    const target = { isValid: true, setWorldRotation(q) { world = q.angle; }, setRotation(q) { world = root + q.angle; } };
    run.call({ node: { getWorldRotation(q) { q.angle = root; } }, entries: [{ target, baseEuler: { x: local, y: 0, z: 0 } }],
      _rootRotation: {}, _baseRotation: {}, _targetRotation: {} }, {
      fromEuler(q, x) { q.angle = x; }, multiply(out, a, b) { out.angle = a.angle + b.angle; },
    });
    assert.equal(world, root + local);
  }
});
