'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createUnityFixture } = require('../unity-intel/test-fixture.cjs');
const { buildGuidIndex, guidCacheContext } = require('./prefab-shader-chain.cjs');

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

test('shader GUID cache rejects a junction redirecting its cache directory into the Unity project', t => {
  const fixture = createUnityFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-guid-cache-junction-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const redirect = path.join(external, 'redirect');
  try {
    fs.symlinkSync(fixture.root, redirect, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Host does not allow directory symlinks/junctions.');
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
