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

test('skybox requires the Cocos runtime cube module even without primitive scene meshes', () => {
  const sky = record('Assets/Demo.unity', 'RenderSettings:\n  m_SkyboxMaterial: {fileID: 10304, guid: 0000000000000000f000000000000000, type: 0}\n');
  const result = closure([sky], [sky.assetPath]);
  assert.ok(result.requiredModules.includes('primitive'));
  assert.ok(!result.disabledModules.includes('primitive'));
  const empty = record('Assets/Empty.unity', 'RenderSettings:\n  m_SkyboxMaterial: {fileID: 0}\n');
  assert.ok(!closure([empty], [empty.assetPath]).requiredModules.includes('primitive'));
});

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

test('Rigidbody2D AddForce/MovePosition scripts stay 2D and never force the Cocos 3D physics backend', () => {
  // Lost Crypt CharacterController2D: impulse jump + kinematic tail body, both Rigidbody2D.
  const controller = record('Assets/Scripts/CharacterController2D.cs', `
public class CharacterController2D : MonoBehaviour {
  [SerializeField] Rigidbody2D tailRigidbody = null;
  private Rigidbody2D controllerRigidbody;
  void FixedUpdate() {
    controllerRigidbody.AddForce(new Vector2(0, 5f), ForceMode2D.Impulse);
    tailRigidbody.MovePosition(Vector2.zero);
  }
}
`);
  const result = closure([controller], [controller.assetPath]);
  assert.equal(result.selectors.physicsBackend, null);
  assert.equal(result.selectors.physics2dBackend, 'physics-2d-box2d');
  assert.deepEqual(result.requiredModules, ['physics-2d', 'physics-2d-box2d']);

  // A 3D script with the same calls still selects a 3D simulation backend and no 2D module.
  const tank = record('Assets/Scripts/TankMovement.cs', `
public class TankMovement : MonoBehaviour {
  private Rigidbody body;
  void FixedUpdate() { body.MovePosition(body.position); body.AddForce(Vector3.up, ForceMode.Impulse); }
}
`);
  const tankResult = closure([tank], [tank.assetPath]);
  assert.equal(tankResult.selectors.physicsBackend, 'physics-cannon');
  assert.equal(tankResult.selectors.physics2dBackend, null);

  // Receiver type unknown in the file (declared elsewhere): keep the conservative 3D reading.
  const unknown = record('Assets/Scripts/Pusher.cs', `
public class Pusher : MonoBehaviour { public Body target; void FixedUpdate() { target.body.AddForce(Vector3.up); } }
`);
  assert.equal(closure([unknown], [unknown.assetPath]).selectors.physicsBackend, 'physics-cannon');
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

test('a gameplay field named TerrainData is not Unity terrain evidence (Happy Harvest SaveSystem)', () => {
  const save = record('Assets/Game/SaveSystem.cs', `
public class SaveSystem {
  [System.Serializable] public struct SceneData { public string SceneName; public TerrainDataSave TerrainData; }
  public static void SaveSceneData() {
    var data = new TerrainDataSave();
    GameManager.Instance.Terrain.Save(ref data);
    s_Lookup[name] = new SceneData() { SceneName = name, TerrainData = data };
  }
  public static void LoadSceneData() { GameManager.Instance.Terrain.Load(data.TerrainData); }
}
`);
  const shadowed = record('Assets/Game/Shadowed.cs', `
public class TerrainData { public int Size; }
public class Farm { private TerrainData m_Data; void Update() { m_Data = new TerrainData(); } }
`);
  for (const source of [save, shadowed]) {
    const result = closure([source], [source.assetPath]);
    assert.equal(result.requiredModules.includes('terrain'), false, source.assetPath);
    assert.equal(result.disabledModules.includes('terrain'), true, source.assetPath);
  }
});

test('real UnityEngine terrain type usage still requires the Cocos terrain module', () => {
  const cases = [
    'public class A { void Update() { TerrainData data = GetComponent<Terrain>().terrainData; data.size = Vector3.one; } }',
    'public class B { void Update() { var c = GetComponent<TerrainCollider>(); c.enabled = true; } }',
    'public class C { void Update() { var d = new TerrainData(); } }',
    'public class D { void Update() { var t = typeof(UnityEngine.TerrainData); } }',
  ];
  cases.forEach((text, index) => {
    const source = record(`Assets/Game/Terrain${index}.cs`, text);
    const result = closure([source], [source.assetPath]);
    assert.equal(result.requiredModules.includes('terrain'), true, text);
  });
  const scene = record('Assets/Game/World.unity', '--- !u!218 &1\nTerrain:\n  m_TerrainData: {fileID: 1}\n');
  assert.equal(closure([scene], [scene.assetPath]).requiredModules.includes('terrain'), true);
});
