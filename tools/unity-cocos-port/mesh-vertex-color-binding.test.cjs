'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bindMeshVertexColor, DEFINE } = require('./mesh-vertex-color-binding.cjs');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-vertex-color-'));
  const put = (rel, text, uuid) => {
    const file = path.join(root, 'assets', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (uuid) fs.writeFileSync(`${file}.meta`, JSON.stringify({ uuid }));
    return file;
  };
  put('effects/Tornado.effect', `CCProgram vs %{ in vec4 a_color;\n #pragma define-meta ${DEFINE}\n}%`, 'effect-color');
  put('effects/Plain.effect', 'CCProgram vs %{ }%', 'effect-plain');
  const mtl = (name, effect) => put(`materials/${name}.mtl`,
    JSON.stringify({ __type__: 'cc.Material', _effectAsset: { __uuid__: effect }, _defines: [{}] }, null, 2).replace(/\n/g, '\r\n') + '\r\n', `mtl-${name}`);
  const files = {
    tornado: mtl('Tornado', 'effect-color'),
    shared: mtl('Shared', 'effect-color'),
    particle: mtl('Particle', 'effect-color'),
    plain: mtl('Plain', 'effect-plain'),
  };
  put('models/NoColor.fbx', Buffer.from('Kaydara FBX Binary\0Geometry\0LayerElementNormal\0'), 'fbx-plain');
  put('models/Colored.fbx', Buffer.from('Kaydara FBX Binary\0Geometry\0LayerElementColor\0'), 'fbx-color');
  const mesh = (fbx, material) => ({ __type__: 'cc.MeshRenderer', _mesh: { __uuid__: `${fbx}@a1b2c` }, _materials: [{ __uuid__: material }] });
  const prefab = put('prefabs/Effect.prefab', JSON.stringify([
    mesh('fbx-plain', 'mtl-Tornado'),
    mesh('fbx-plain', 'mtl-Shared'),
    mesh('fbx-color', 'mtl-Shared'),
    mesh('fbx-plain', 'mtl-Plain'),
    { __type__: 'cc.ParticleSystem', _materials: [{ __uuid__: 'mtl-Particle' }] },
    mesh('fbx-plain', 'mtl-Particle'),
  ]));
  return { root, files, prefab };
}

test('sets the no-colour define only where every user lacks a colour stream', () => {
  const { root, files, prefab } = project();
  const result = bindMeshVertexColor({ cocosRoot: root, prefabFiles: [prefab] });
  assert.deepEqual(result.set, ['assets/materials/Tornado.mtl']);
  assert.deepEqual(result.mixed.sort(), ['assets/materials/Particle.mtl', 'assets/materials/Shared.mtl']);
  const tornado = fs.readFileSync(files.tornado, 'utf8');
  assert.equal(JSON.parse(tornado)._defines[0][DEFINE], true);
  assert.ok(tornado.includes('\r\n') && !/[^\r]\n/.test(tornado), 'CRLF material keeps its line endings');
  for (const key of ['shared', 'particle', 'plain']) assert.equal(JSON.parse(fs.readFileSync(files[key], 'utf8'))._defines[0][DEFINE], undefined, key);

  const before = fs.statSync(files.tornado).mtimeMs;
  const again = bindMeshVertexColor({ cocosRoot: root, prefabFiles: [prefab] });
  assert.deepEqual(again.set, []);
  assert.equal(fs.statSync(files.tornado).mtimeMs, before, 'idempotent');
});
