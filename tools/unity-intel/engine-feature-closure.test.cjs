'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OPTIONAL_3D_FEATURE_MODULES,
  detectUnityEngineFeatureEvidence,
  buildUnityEngineFeatureClosure,
} = require('./engine-feature-closure.cjs');

function record(assetPath, text, options = {}) {
  const extension = options.extension || assetPath.slice(assetPath.lastIndexOf('.')).toLowerCase();
  const type = options.type || (extension === '.controller' ? 'controller' : extension === '.cs' ? 'script' : 'asset');
  return {
    assetPath,
    engineFeatureEvidence: detectUnityEngineFeatureEvidence({ assetPath, extension, type, text }),
  };
}

function closure(records, included, adapters = []) {
  return buildUnityEngineFeatureClosure({ assets: { records } }, {
    profile: 'playable-core',
    pathSet: new Set(included),
    adapterPathSet: new Set(adapters),
  });
}

test('AnimatorController and reachable Spine 4.2 skeleton evidence produce exact Cocos selectors', () => {
  const controller = record('Assets/Game/Tile.controller', '%YAML 1.1\n', { type: 'controller' });
  const spinePrefab = record('Assets/Game/Win.prefab', 'skeletonDataAsset: {fileID: 11400000, guid: abc}\n');
  const spineJson = record('Assets/Spine/Win/skeleton.json', '{"skeleton":{"spine":"4.2.43"}}');
  const result = closure(
    [controller, spinePrefab, spineJson],
    [controller.assetPath, spinePrefab.assetPath],
    [spineJson.assetPath],
  );
  assert.equal(result.status, 'required');
  assert.deepEqual(result.selectors, { physicsBackend: null, physics2dBackend: null, spineBackend: 'spine-4.2' });
  assert.deepEqual(result.requiredModules, [
    'animation', 'skeletal-animation', 'marionette', 'spine', 'spine-4.2',
  ]);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.disabledModules, [...OPTIONAL_3D_FEATURE_MODULES]);
});

test('reachable Spine usage without an exact skeleton JSON version blocks implementation', () => {
  const spinePrefab = record('Assets/Game/Win.prefab', 'skeletonDataAsset: {fileID: 11400000, guid: abc}\n');
  const result = closure([spinePrefab], [spinePrefab.assetPath]);
  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers[0].code, 'UNITY_SPINE_VERSION_UNRESOLVED');
  assert.equal(result.requiredModules.includes('spine'), false);
});

test('billboard ParticleSystemRenderer does not require primitive despite a dormant serialized mesh', () => {
  const billboard = record('Assets/Game/Merge.prefab', `--- !u!199 &1
ParticleSystemRenderer:
  m_RenderMode: 0
  m_Mesh: {fileID: 10202, guid: 00000000000000000000000000000000, type: 0}
`);
  const mesh = record('Assets/Game/MeshParticle.prefab', `--- !u!199 &1
ParticleSystemRenderer:
  m_RenderMode: 4
  m_Mesh: {fileID: 10202, guid: 00000000000000000000000000000000, type: 0}
`);
  assert.equal(closure([billboard], [billboard.assetPath]).requiredModules.includes('primitive'), false);
  assert.equal(closure([billboard], [billboard.assetPath]).disabledModules.includes('primitive'), true);
  assert.equal(closure([mesh], [mesh.assetPath]).requiredModules.includes('primitive'), true);
  assert.equal(closure([mesh], [mesh.assetPath]).disabledModules.includes('primitive'), false);
});

test('an uncalled private Debug.DrawLine helper is not runtime feature evidence', () => {
  const dead = record('Assets/Game/Input.cs', `
public sealed class InputController {
  private void DrawPlusAtZ0() { Debug.DrawLine(Vector3.zero, Vector3.one); }
  private void Update() { PollInput(); }
  private void PollInput() { }
}
`);
  const live = record('Assets/Game/LiveDebug.cs', `
public sealed class LiveDebug {
  private void DrawNow() { Debug.DrawLine(Vector3.zero, Vector3.one); }
  private void Update() { DrawNow(); }
}
`);
  assert.equal(closure([dead], [dead.assetPath]).requiredModules.includes('debug-renderer'), false);
  assert.equal(closure([dead], [dead.assetPath]).disabledModules.includes('debug-renderer'), true);
  assert.equal(closure([live], [live.assetPath]).requiredModules.includes('debug-renderer'), true);
  assert.equal(closure([live], [live.assetPath]).disabledModules.includes('debug-renderer'), false);
});

test('engine feature evidence outside the playable-core closure cannot enable a Cocos module', () => {
  const core = record('Assets/Game/Core.controller', '%YAML 1.1\n', { type: 'controller' });
  const excluded = record('Assets/Meta/Decor.prefab', `--- !u!33 &1
MeshFilter:
  m_Mesh: {fileID: 10202, guid: 00000000000000000000000000000000, type: 0}
`);
  const result = closure([core, excluded], [core.assetPath]);
  assert.equal(result.requiredModules.includes('primitive'), false);
  assert.equal(result.requiredModules.includes('marionette'), true);
});

test('serialized simple 3D collider selects the evidence-backed Builtin backend', () => {
  const physics = record('Assets/Game/Board.prefab', `--- !u!65 &1
BoxCollider:
  m_IsTrigger: 1
`);
  const result = closure([physics], [physics.assetPath]);
  assert.equal(result.selectors.physicsBackend, 'physics-builtin');
  assert.deepEqual(result.requiredModules, ['3d', 'physics-builtin']);
});

test('reachable Unity Physics2D collider/query selects the Box2D parent option and backend', () => {
  const collider = record('Assets/Game/Tile.prefab', `--- !u!61 &1
BoxCollider2D:
  m_IsTrigger: 0
`);
  const query = record('Assets/Game/Input.cs', `
public sealed class InputController {
  private void Update() { Physics2D.RaycastAll(Vector2.zero, Vector2.right); }
}
`);
  const result = closure([collider, query], [collider.assetPath, query.assetPath]);
  assert.equal(result.selectors.physics2dBackend, 'physics-2d-box2d');
  assert.deepEqual(result.requiredModules, ['physics-2d', 'physics-2d-box2d']);
});
