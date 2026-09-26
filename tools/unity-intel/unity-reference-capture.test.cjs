'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, captureScript } = require('./unity-reference-capture.cjs');

const base = ['--project', 'U', '--scene', 'Assets/Demo.unity', '--out', 'o', '--frames', '0,30'];
function spawnsFile(t, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-spawns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'spawns.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test('spawns map to the ReferenceCapture Spawn shape and keep prefab rotation by default', t => {
  const options = parseArgs([...base, '--spawns', spawnsFile(t, [
    { prefab: 'Assets/FX/Marker 1.prefab', frame: 1, position: [1, 0.01, -2] },
    { prefab: 'Assets/FX/Beam.prefab', frame: 5, position: [0, 1, 0], eulerAngles: [0, 90, 0] },
  ])]);
  assert.deepEqual(options.spawns, [
    { prefab: 'Assets/FX/Marker 1.prefab', frame: 1, position: { x: 1, y: 0.01, z: -2 }, useRotation: false, eulerAngles: { x: 0, y: 0, z: 0 } },
    { prefab: 'Assets/FX/Beam.prefab', frame: 5, position: { x: 0, y: 1, z: 0 }, useRotation: true, eulerAngles: { x: 0, y: 90, z: 0 } },
  ]);
  // The request travels as an escaped C# string literal into script-execute.
  assert.match(captureScript({ spawns: options.spawns }), /Marker 1\.prefab/);
});

test('malformed spawns fail before Unity is contacted', t => {
  assert.throws(() => parseArgs([...base, '--spawns', spawnsFile(t, [{ prefab: 'Packages/x.prefab', frame: 1, position: [0, 0, 0] }])]), /prefab/);
  assert.throws(() => parseArgs([...base, '--spawns', spawnsFile(t, [{ prefab: 'Assets/x.prefab', frame: -1, position: [0, 0, 0] }])]), /frame/);
  assert.throws(() => parseArgs([...base, '--spawns', spawnsFile(t, [{ prefab: 'Assets/x.prefab', frame: 1, position: [0, 0] }])]), /position/);
});

test('--field overrides reach the request and reject malformed input', () => {
  const options = parseArgs([...base, '--field', 'CameraHolder.Prefab=3', '--field', 'Demo.speed=0.5']);
  assert.deepEqual(options.fields, [{ component: 'CameraHolder', field: 'Prefab', value: '3' }, { component: 'Demo', field: 'speed', value: '0.5' }]);
  assert.throws(() => parseArgs([...base, '--field', 'CameraHolder=3']), /Component\.field=value/);
});
