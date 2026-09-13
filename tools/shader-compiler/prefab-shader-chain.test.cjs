'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createUnityFixture, isLinkUnavailableError } = require('../unity-intel/test-fixture.cjs');
const { buildGuidIndex, guidCacheContext, resolveChain, referencedGuids } = require('./prefab-shader-chain.cjs');

const SHADER_CLI = path.resolve(__dirname, 'unity-shader-compiler.cjs');

test('shader GUID cache stays user-local, is reusable, and invalidates on meta changes', t => {
  const fixture = createUnityFixture(t);
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-guid-cache-'));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const previous = process.env.CC_PLAYABLE_UNITY_INTEL_CACHE;
  process.env.CC_PLAYABLE_UNITY_INTEL_CACHE = cacheRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.CC_PLAYABLE_UNITY_INTEL_CACHE;
    else process.env.CC_PLAYABLE_UNITY_INTEL_CACHE = previous;
  });

  const first = buildGuidIndex(fixture.assets);
  assert.equal(first.fromCache, false);
  const context = guidCacheContext(fixture.assets, {});
  assert.equal(fs.existsSync(context.cachePath), true);
  assert.equal(path.relative(fixture.root, context.cachePath).startsWith('..'), true);
  assert.equal(fs.existsSync(path.join(fixture.root, '.ucshader-guid-index.json')), false);
  assert.equal(buildGuidIndex(fixture.assets).fromCache, true);

  fixture.write('Assets/Game/New.asset', 'value: 1\n');
  fixture.write('Assets/Game/New.asset.meta', `fileFormatVersion: 2\nguid: ${'9'.repeat(32)}\n`);
  const changed = buildGuidIndex(fixture.assets);
  assert.equal(changed.fromCache, false);
  assert.equal(changed.guidToFile.has('9'.repeat(32)), true);
});

test('--no-cache neither reads nor writes a shader GUID cache', t => {
  const fixture = createUnityFixture(t);
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-guid-no-cache-'));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const cachePath = path.join(cacheRoot, 'never.json');
  const result = buildGuidIndex(fixture.assets, { noCache: true, cachePath });
  assert.equal(result.fromCache, false);
  assert.equal(fs.existsSync(cachePath), false);
});

test('shader chain discovers a ScriptableObject material set and all per-state textures', t => {
  const fixture = createUnityFixture(t);
  const materialGuids = ['1'.repeat(32), '2'.repeat(32)];
  const textureGuids = ['3'.repeat(32), '4'.repeat(32)];
  const config = fixture.write('Assets/Game/Configs/TapeColors.asset', [
    'MonoBehaviour:',
    '  ColorConfigs:',
    `  - ActiveMaterial: {fileID: 2100000, guid: ${materialGuids[0]}, type: 2}`,
    `    DisableMaterial: {fileID: 2100000, guid: ${materialGuids[1]}, type: 2}`,
    '',
  ].join('\n'));
  for (let i = 0; i < materialGuids.length; i += 1) {
    fixture.write(`Assets/Game/Materials/Tape${i}.mat`, [
      'Material:',
      '  m_Shader: {fileID: 10720, guid: 0000000000000000f000000000000000, type: 0}',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      `    - _BaseMap: {m_Texture: {fileID: 2800000, guid: ${textureGuids[i]}, type: 3}}`,
      '',
    ].join('\n'));
    fixture.write(`Assets/Game/Materials/Tape${i}.mat.meta`, `fileFormatVersion: 2\nguid: ${materialGuids[i]}\n`);
    fixture.write(`Assets/Game/Textures/Tape${i}.png`, `texture-${i}`);
    fixture.write(`Assets/Game/Textures/Tape${i}.png.meta`, `fileFormatVersion: 2\nguid: ${textureGuids[i]}\n`);
  }

  const chain = resolveChain(config, fixture.assets, { noCache: true });
  assert.equal(chain.sourceKind, 'scriptable-object');
  assert.equal(chain.materialSetDetected, true);
  assert.equal(chain.materials.length, 2);
  assert.equal(chain.textures.length, 2);
});

test('shader chain starts from a Unity scene and follows prefab material closure', t => {
  const fixture = createUnityFixture(t);
  const prefabGuid = '81'.repeat(16);
  const materialGuid = '82'.repeat(16);
  const shaderGuid = '83'.repeat(16);
  const scene = fixture.write('Assets/Game/Scenes/Gameplay.unity', [
    '%YAML 1.1',
    'PrefabInstance:',
    `  m_SourcePrefab: {fileID: 100100000, guid: ${prefabGuid}, type: 3}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Prefabs/Board.prefab', [
    '%YAML 1.1',
    'SpriteRenderer:',
    `  m_Materials: [{fileID: 2100000, guid: ${materialGuid}, type: 2}]`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Prefabs/Board.prefab.meta', `fileFormatVersion: 2\nguid: ${prefabGuid}\n`);
  fixture.write('Assets/Game/Materials/Board.mat', [
    'Material:',
    `  m_Shader: {fileID: 4800000, guid: ${shaderGuid}, type: 3}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/Board.mat.meta', `fileFormatVersion: 2\nguid: ${materialGuid}\n`);
  fixture.write('Assets/Game/Shaders/Board.shader', 'Shader "Test/Board" {}\n');
  fixture.write('Assets/Game/Shaders/Board.shader.meta', `fileFormatVersion: 2\nguid: ${shaderGuid}\n`);

  const chain = resolveChain(scene, fixture.assets, { noCache: true });
  assert.equal(chain.sourceKind, 'scene');
  assert.equal(chain.closure.complete, true);
  assert.equal(chain.closure.nestedPrefabCount, 1);
  assert.equal(chain.materials.length, 1);
  assert.equal(chain.materials[0].name, 'Board');
  assert.equal(chain.shaders.length, 1);
  assert.equal(chain.shaders[0].name, 'Board');
});

test('shader chain follows nested prefabs, model importer material remaps, and selected package shaders', t => {
  const fixture = createUnityFixture(t);
  const nestedGuid = '91'.repeat(16);
  const modelGuid = '92'.repeat(16);
  const materialGuid = '93'.repeat(16);
  const shaderGuid = '94'.repeat(16);
  const textureGuid = '95'.repeat(16);

  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const lockPath = path.join(fixture.root, 'Packages', 'packages-lock.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['com.unity.render-pipelines.universal'] = '17.0.4';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const lock = fs.existsSync(lockPath)
    ? JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    : { dependencies: {} };
  lock.dependencies['com.unity.render-pipelines.universal'] = {
    version: '17.0.4',
    depth: 0,
    source: 'registry',
    dependencies: {},
  };
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const source = fixture.write('Assets/Game/Prefabs/Holder.prefab', [
    '%YAML 1.1',
    'PrefabInstance:',
    `  m_SourcePrefab: {fileID: 100100000, guid: ${nestedGuid}, type: 3}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Prefabs/HolderVisual.prefab', [
    '%YAML 1.1',
    'PrefabInstance:',
    `  m_SourcePrefab: {fileID: 100100000, guid: ${modelGuid}, type: 3}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Prefabs/HolderVisual.prefab.meta', `fileFormatVersion: 2\nguid: ${nestedGuid}\n`);
  fixture.write('Assets/Game/Models/Holder.fbx', 'binary-placeholder');
  fixture.write('Assets/Game/Models/Holder.fbx.meta', [
    'fileFormatVersion: 2',
    `guid: ${modelGuid}`,
    'ModelImporter:',
    '  externalObjects:',
    `  - first: {type: UnityEngine:Material, assembly: UnityEngine.CoreModule, name: Holder}`,
    `    second: {fileID: 2100000, guid: ${materialGuid}, type: 2}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/Holder.mat', [
    'Material:',
    `  m_Shader: {fileID: 4800000, guid: ${shaderGuid}, type: 3}`,
    '  m_SavedProperties:',
    '    m_TexEnvs:',
    `    - _BaseMap: {m_Texture: {fileID: 2800000, guid: ${textureGuid}, type: 3}}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/Holder.mat.meta', `fileFormatVersion: 2\nguid: ${materialGuid}\n`);
  fixture.write('Assets/Game/Textures/Holder.png', 'texture');
  fixture.write('Assets/Game/Textures/Holder.png.meta', `fileFormatVersion: 2\nguid: ${textureGuid}\n`);

  const packageRoot = path.join(
    fixture.root,
    'Library',
    'PackageCache',
    'com.unity.render-pipelines.universal@17.0.4',
  );
  fs.mkdirSync(path.join(packageRoot, 'Shaders'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'com.unity.render-pipelines.universal',
    version: '17.0.4',
  }));
  fs.writeFileSync(path.join(packageRoot, 'Shaders', 'Lit.shader'), 'Shader "Universal Render Pipeline/Lit" {}\n');
  fs.writeFileSync(
    path.join(packageRoot, 'Shaders', 'Lit.shader.meta'),
    `fileFormatVersion: 2\nguid: ${shaderGuid}\n`,
  );

  const index = buildGuidIndex(fixture.assets, { noCache: true });
  assert.equal(index.guidToFile.has(nestedGuid), true, JSON.stringify([...index.guidToFile.keys()]));
  assert.deepEqual(referencedGuids(source), [nestedGuid]);
  const chain = resolveChain(source, fixture.assets, { noCache: true });
  assert.equal(chain.closure.complete, true);
  assert.equal(chain.closure.nestedPrefabCount, 1, JSON.stringify(chain, null, 2));
  assert.equal(chain.closure.modelImporterCount, 1);
  assert.equal(chain.materials.length, 1);
  assert.equal(chain.materials[0].name, 'Holder');
  assert.equal(chain.materials[0].discoveredVia, 'model-importer');
  assert.equal(chain.materials[0].shaderOrigin, 'package');
  assert.equal(chain.materials[0].shaderPackage, 'com.unity.render-pipelines.universal');
  assert.equal(chain.shaders.length, 1);
  assert.equal(chain.shaders[0].origin, 'package');
  assert.equal(chain.textures.length, 1);
  assert.equal(chain.unresolved.length, 0);
});

test('shader chain treats TCP2 generated .tcp2shader files as ShaderLab sources', t => {
  const fixture = createUnityFixture(t);
  const materialGuid = '96'.repeat(16);
  const shaderGuid = '97'.repeat(16);
  const source = fixture.write('Assets/Game/Prefabs/Tcp2.prefab', [
    '%YAML 1.1',
    'MeshRenderer:',
    `  m_Materials: [{fileID: 2100000, guid: ${materialGuid}, type: 2}]`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/Tcp2.mat', [
    'Material:',
    `  m_Shader: {fileID: 4800000, guid: ${shaderGuid}, type: 3}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/Tcp2.mat.meta', `fileFormatVersion: 2\nguid: ${materialGuid}\n`);
  fixture.write('Assets/Game/Shaders/TCP2 Hybrid.tcp2shader', 'Shader "TCP2/Hybrid" {}\n');
  fixture.write('Assets/Game/Shaders/TCP2 Hybrid.tcp2shader.meta', `fileFormatVersion: 2\nguid: ${shaderGuid}\n`);

  const chain = resolveChain(source, fixture.assets, { noCache: true });
  assert.equal(chain.materials.length, 1);
  assert.equal(chain.shaders.length, 1);
  assert.equal(chain.shaders[0].name, 'TCP2 Hybrid');
});

test('shader GUID cache rejects a junction redirecting its cache directory into the Unity project', t => {
  const fixture = createUnityFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-guid-cache-junction-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const redirect = path.join(external, 'redirect');
  try {
    fs.symlinkSync(fixture.root, redirect, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (isLinkUnavailableError(error)) {
      t.skip(`Host filesystem does not support directory symlinks/junctions: ${error.code}`);
      return;
    }
    throw error;
  }
  const cachePath = path.join(redirect, 'must-not-exist', 'shader.json');
  assert.throws(
    () => buildGuidIndex(fixture.assets, { cachePath }),
    /symlink\/junction must stay outside source\/project/i,
  );
  assert.equal(fs.existsSync(path.join(fixture.root, 'must-not-exist')), false);
});

test('shader chain dry-run validates generated effect in memory without writing stale or new output', t => {
  const fixture = createUnityFixture(t);
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-chain-dry-run-'));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));
  const materialGuid = '11111111111111111111111111111111';
  const shaderGuid = '22222222222222222222222222222222';
  const prefab = fixture.write('Assets/Game/Prefabs/ShaderDryRun.prefab', [
    '%YAML 1.1',
    '--- !u!23 &1',
    'MeshRenderer:',
    `  m_Materials: [{fileID: 2100000, guid: ${materialGuid}, type: 2}]`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/DryRun.mat', [
    'Material:',
    `  m_Shader: {fileID: 4800000, guid: ${shaderGuid}, type: 3}`,
    '  m_SavedProperties:',
    '    m_Floats: []',
    '    m_Colors: []',
    '    m_TexEnvs: []',
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Materials/DryRun.mat.meta', `fileFormatVersion: 2\nguid: ${materialGuid}\n`);
  fixture.write('Assets/Game/Shaders/DryRun.shader', [
    'Shader "Test/DryRun" {',
    '  SubShader { Pass {',
    '    HLSLPROGRAM',
    '    #pragma vertex vert',
    '    #pragma fragment frag',
    '    struct appdata { float4 vertex : POSITION; };',
    '    struct v2f { float4 pos : SV_POSITION; };',
    '    v2f vert(appdata v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); return o; }',
    '    float4 frag(v2f i) : SV_Target { return float4(1, 1, 1, 1); }',
    '    ENDHLSL',
    '  } }',
    '}',
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Shaders/DryRun.shader.meta', `fileFormatVersion: 2\nguid: ${shaderGuid}\n`);

  const result = spawnSync(process.execPath, [
    SHADER_CLI, 'chain', '--src', prefab, '--unity-root', fixture.assets,
    '--out-dir', outRoot, '--dry-run', '--no-cache', '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.blocking, []);
  assert.equal(payload.shaders.length, 1);
  assert.equal(fs.existsSync(path.join(outRoot, 'effects', 'DryRun.effect')), false);
  assert.equal(fs.existsSync(path.join(outRoot, 'materials', 'DryRun.mtl')), false);
});
