'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { attachMeshFrameRuntime, stageMeshFrameRuntime } = require('./particle-mesh-frame-binding');
const { particleRendererContract } = require('./particle-renderer-contract');

function run(renderer, imported = true) {
  const objects = [{ __type__: 'cc.Node', _name: 'Arrows' }, { __type__: 'cc.ParticleSystem', node: { __id__: 0 } }], issues = [];
  Object.defineProperty(objects[1], 'unityRendererContract', { value: particleRendererContract({}, renderer) });
  const builder = { objects, cocosDb: { findScriptClass: () => imported ? { classId: 'assetdb-mesh-frame-id' } : null }, addComponent(node, type, props) { objects.push({ node, type, ...props }); } };
  attachMeshFrameRuntime(builder, { high: (code, a, b, message) => issues.push({ code, message }), low() {} }, { dryRun: true, cocosRoot: path.join(__dirname, 'fixtures/not-a-cocos-project') });
  return { objects, issues };
}

test('ClickMoveArrows (Velocity + pivot) and ChestLvOpen (Local + pivot) bind the mesh frame adapter', () => {
  const arrows = run({ m_RenderMode: 4, m_RenderAlignment: 4, m_Pivot: { x: 0, y: 0.1, z: -2 } });
  assert.deepEqual(arrows.issues, []); assert.equal(arrows.objects[2].type, 'assetdb-mesh-frame-id');
  assert.deepEqual(arrows.objects[2].source, { __id__: 1 }); assert.deepEqual(JSON.parse(arrows.objects[2].sourceContract), { pivot: true, velocity: true });
  const chest = run({ m_RenderMode: 4, m_RenderAlignment: 2, m_Pivot: { x: 0, y: 0.5, z: 0 } });
  assert.deepEqual(JSON.parse(chest.objects[2].sourceContract), { pivot: true, velocity: false });
  const cli = fs.readFileSync(path.join(__dirname, '../unity-cocos-port.cjs'), 'utf8');
  assert.match(cli, /attachMeshFrameRuntime\(builder, reporter, options\)/);
});
test('shader-only cases (Mesh World alignment, View billboard pivot, plain Mesh) need no runtime', () => {
  for (const renderer of [{ m_RenderMode: 4, m_RenderAlignment: 1 }, { m_RenderMode: 0, m_Pivot: { x: 0.15 } }, { m_RenderMode: 4, m_RenderAlignment: 2 }]) {
    const result = run(renderer);
    assert.equal(result.objects.length, 2, JSON.stringify(renderer)); assert.deepEqual(result.issues, []);
  }
});
test('unimported script blocks binding instead of inventing a meta UUID', () => {
  const result = run({ m_RenderMode: 4, m_RenderAlignment: 4 }, false);
  assert.equal(result.objects.length, 2); assert.equal(result.issues[0].code, 'PARTICLE_MESH_FRAME_ADAPTER_REQUIRED'); assert.match(result.issues[0].message, /AssetDB/);
});
test('staging is idempotent and leaves metadata to AssetDB', () => {
  const base = path.resolve(__dirname, '../../../.ai/mesh-frame-binding-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'project-'));
  try {
    stageMeshFrameRuntime({ cocosRoot: root });
    const target = path.join(root, 'assets/script/UnityParticleMeshFrameAdapter.ts'), before = fs.statSync(target).mtimeMs;
    stageMeshFrameRuntime({ cocosRoot: root });
    assert.equal(fs.statSync(target).mtimeMs, before); assert.equal(fs.existsSync(target + '.meta'), false);
    for (const name of ['UnityParticleMeshFrame', 'UnityParticleMeshFrameAdapter']) assert.equal(fs.readFileSync(path.join(root, 'assets/script', name + '.ts'), 'utf8'), fs.readFileSync(path.join(__dirname, 'runtime', name + '.ts'), 'utf8'));
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(base)); fs.rmSync(root, { recursive: true });
  }
});
