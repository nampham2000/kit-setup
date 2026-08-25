'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createUnityFixture } = require('./test-fixture.cjs');
const { runUnityPortPreflight } = require('./preflight.cjs');

const COMPILER = path.resolve(__dirname, '..', 'compiler', 'unity-cs-compiler.cjs');
const SCENE_PORT = path.resolve(__dirname, '..', 'unity-scene-port.cjs');
const PREFAB_PORT = path.resolve(__dirname, '..', 'unity-cocos-port.cjs');
const PORT_CLOSURE = path.resolve(__dirname, '..', 'port-closure.cjs');
const SHADER_PORT = path.resolve(__dirname, '..', 'shader-compiler', 'unity-shader-compiler.cjs');
const LEGACY_SHADER_PORT = path.resolve(__dirname, '..', 'unity-hlsl-to-cocos-effect.cjs');
const UNITY_INTEL_CLI = path.resolve(__dirname, '..', 'unity-intel-cli.cjs');

function invoke(args, cacheDir, tool = COMPILER, extraEnv = {}) {
  return spawnSync(process.execPath, [tool, ...args], {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, CC_PLAYABLE_UNITY_INTEL_CACHE: cacheDir, ...extraEnv },
  });
}

test('compiler CLI is read-only in dry-run and blocks every real write without a fresh preflight', async t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-gate-cli-'));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-gate-output-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));
  const source = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  const dryOut = path.join(outRoot, 'dry');
  const dryReport = path.join(outRoot, 'dry-report.json');
  const dryChunks = path.join(outRoot, 'dry-chunks.json');
  const drySkeleton = path.join(outRoot, 'dry-skeleton.ts');
  const dryDiagnostics = path.join(outRoot, 'dry-diagnostics.json');
  const dry = invoke([
    '--src', source, '--out', dryOut, '--dry-run', '--no-typecheck',
    '--report', dryReport, '--chunks', dryChunks, '--emit-skeleton', drySkeleton,
    '--diagnostics', dryDiagnostics,
  ], cacheDir);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(dryOut), false);
  assert.equal(fs.existsSync(dryReport), false);
  assert.equal(fs.existsSync(dryChunks), false);
  assert.equal(fs.existsSync(drySkeleton), false);
  assert.equal(fs.existsSync(dryDiagnostics), false);

  const blockedOut = path.join(outRoot, 'blocked');
  const blocked = invoke(['--src', source, '--out', blockedOut, '--no-typecheck'], cacheDir);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /UNITY_PREFLIGHT_REQUIRED/);
  assert.equal(fs.existsSync(blockedOut), false);

  await runUnityPortPreflight({
    project: fixture.root, provider: 'static', cache: false, cacheDir,
  });
  const allowedOut = path.join(outRoot, 'allowed');
  const allowed = invoke(['--src', source, '--out', allowedOut, '--no-typecheck'], cacheDir);
  assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`);
  assert.equal(fs.existsSync(path.join(allowedOut, 'Gameplay.ts')), true);

  fs.appendFileSync(source, '// stale receipt\n', 'utf8');
  const staleOut = path.join(outRoot, 'stale');
  const stale = invoke(['--src', source, '--out', staleOut, '--no-typecheck'], cacheDir);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /UNITY_PREFLIGHT_STALE/);
  assert.equal(fs.existsSync(staleOut), false);
});

test('port.closure emits exact staging provenance and compiler consumes it only with the matching Unity project', async t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-staging-gate-cache-'));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-staging-gate-output-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));

  const arbitrary = path.join(outRoot, 'arbitrary');
  fs.mkdirSync(arbitrary, { recursive: true });
  fs.writeFileSync(path.join(arbitrary, 'Only.cs'), 'class Only {}\n', 'utf8');
  const noProject = invoke([
    '--src', arbitrary, '--out', path.join(outRoot, 'no-project'), '--no-typecheck',
  ], cacheDir);
  assert.equal(noProject.status, 1);
  assert.match(noProject.stderr, /UNITY_PREFLIGHT_PROJECT_REQUIRED/);

  await runUnityPortPreflight({ project: fixture.root, provider: 'static', cache: false, cacheDir });
  const noProvenance = invoke([
    '--src', arbitrary, '--out', path.join(outRoot, 'no-provenance'), '--no-typecheck',
    '--unity-project', fixture.root,
  ], cacheDir);
  assert.equal(noProvenance.status, 1);
  assert.match(noProvenance.stderr, /UNITY_PORT_PROVENANCE_REQUIRED/);

  const staging = path.join(outRoot, 'closure');
  const prefab = path.join(fixture.root, 'Assets', 'Game', 'Prefabs', 'Main.prefab');
  const closure = invoke([
    '--prefab', prefab, '--unity-root', fixture.assets, '--copy-to', staging, '--json',
  ], cacheDir, PORT_CLOSURE);
  assert.equal(closure.status, 0, `${closure.stdout}\n${closure.stderr}`);
  const provenance = path.join(staging, '.unity-port-provenance.json');
  assert.equal(fs.existsSync(provenance), true);
  assert.equal(fs.readFileSync(provenance, 'utf8').includes(fixture.root), false);

  const compiled = path.join(outRoot, 'compiled');
  const allowed = invoke([
    '--src', staging, '--out', compiled, '--no-typecheck', '--unity-project', fixture.root,
  ], cacheDir);
  assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`);
  assert.equal(fs.existsSync(path.join(compiled, 'Game', 'Scripts', 'Gameplay.ts')), true);

  const stagedScript = path.join(staging, 'Game', 'Scripts', 'Gameplay.cs');
  fs.appendFileSync(stagedScript, '// tampered\n', 'utf8');
  const tamperedOut = path.join(outRoot, 'tampered');
  const tampered = invoke([
    '--src', staging, '--out', tamperedOut, '--no-typecheck', '--unity-project', fixture.root,
  ], cacheDir);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /UNITY_PORT_PROVENANCE_CHANGED/);
  assert.equal(fs.existsSync(tamperedOut), false);
});

test('preflight --cache-dir relocates only the index while every port gate reads the fixed receipt store', t => {
  const fixture = createUnityFixture(t);
  const receiptCache = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-fixed-receipt-cache-'));
  const indexCache = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-custom-index-cache-'));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-custom-cache-output-'));
  t.after(() => fs.rmSync(receiptCache, { recursive: true, force: true }));
  t.after(() => fs.rmSync(indexCache, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));

  const preflight = invoke([
    'preflight', '--project', fixture.root, '--provider', 'static', '--cache-dir', indexCache, '--json',
  ], receiptCache, UNITY_INTEL_CLI);
  assert.equal(preflight.status, 0, `${preflight.stdout}\n${preflight.stderr}`);
  assert.equal(JSON.parse(preflight.stdout).decision.implementationAllowed, true);
  assert.equal(fs.existsSync(path.join(receiptCache, 'receipts')), true);
  assert.equal(fs.existsSync(path.join(indexCache, 'receipts')), false);

  const source = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  const output = path.join(outRoot, 'compiled');
  const compile = invoke(['--src', source, '--out', output, '--no-typecheck'], receiptCache);
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
  assert.equal(fs.existsSync(path.join(output, 'Gameplay.ts')), true);
});

test('scene, prefab, closure copy and shader CLIs all block before their first output write', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-gate-boundaries-'));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-boundary-output-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));
  const scene = path.join(fixture.root, 'Assets', 'Game', 'Scenes', 'Main.unity');
  const prefab = path.join(fixture.root, 'Assets', 'Game', 'Prefabs', 'Main.prefab');
  const shader = fixture.write('Assets/Game/Shaders/Test.shader', 'Shader "Test/Unlit" { SubShader { Pass {} } }\n');
  fixture.write('Assets/Game/Shaders/Test.shader.meta', `fileFormatVersion: 2\nguid: ${'8'.repeat(32)}\n`);
  const cases = [
    {
      tool: SCENE_PORT,
      args: ['--scene', scene, '--unity-root', fixture.assets, '--out', path.join(outRoot, 'Main.scene')],
      output: path.join(outRoot, 'Main.scene'),
    },
    {
      tool: PREFAB_PORT,
      args: ['port', '--src', prefab, '--unity-root', fixture.assets, '--out', path.join(outRoot, 'Main.prefab')],
      output: path.join(outRoot, 'Main.prefab'),
    },
    {
      tool: PORT_CLOSURE,
      args: ['--prefab', prefab, '--unity-root', fixture.assets, '--copy-to', path.join(outRoot, 'closure')],
      output: path.join(outRoot, 'closure'),
    },
    {
      tool: PORT_CLOSURE,
      args: ['--prefab', prefab, '--unity-root', fixture.assets, '--out', path.join(outRoot, 'closure.json')],
      output: path.join(outRoot, 'closure.json'),
    },
    {
      tool: SHADER_PORT,
      args: ['convert', '--src', shader, '--out', path.join(outRoot, 'Test.effect')],
      output: path.join(outRoot, 'Test.effect'),
    },
    {
      tool: SHADER_PORT,
      args: ['batch', '--dir', path.dirname(shader), '--out-dir', path.join(outRoot, 'canonical-shaders')],
      output: path.join(outRoot, 'canonical-shaders'),
    },
    {
      tool: LEGACY_SHADER_PORT,
      args: ['batch', '--dir', path.dirname(shader), '--out-dir', path.join(outRoot, 'legacy-shaders')],
      output: path.join(outRoot, 'legacy-shaders'),
    },
  ];
  for (const item of cases) {
    const result = invoke(item.args, cacheDir, item.tool);
    assert.equal(result.status, 1, `${path.basename(item.tool)}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /UNITY_PREFLIGHT_REQUIRED/, path.basename(item.tool));
    assert.equal(fs.existsSync(item.output), false, item.output);
  }
});

test('canonical and legacy shader batch require an explicit source directory before any output', t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-shader-batch-dir-'));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-shader-batch-output-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));
  for (const tool of [SHADER_PORT, LEGACY_SHADER_PORT]) {
    const output = path.join(outRoot, path.basename(tool));
    const result = invoke(['batch', '--out-dir', output, '--dry-run'], cacheDir, tool);
    assert.equal(result.status, 1, `${path.basename(tool)}\n${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /requires --dir/);
    assert.equal(fs.existsSync(output), false);
  }
});

test('shader chain binds the prefab source and Unity root to the same receipt project', async t => {
  const first = createUnityFixture(t);
  const second = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-shader-cross-project-cache-'));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-shader-cross-project-out-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));
  await runUnityPortPreflight({ project: first.root, provider: 'static', cache: false, cacheDir });
  const result = invoke([
    'chain', '--src', path.join(second.root, 'Assets', 'Game', 'Prefabs', 'Main.prefab'),
    '--unity-root', first.assets, '--out-dir', outRoot,
  ], cacheDir, SHADER_PORT);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNITY_PREFLIGHT_PROJECT_MISMATCH/);
  assert.equal(fs.readdirSync(outRoot).length, 0);
});

test('prefab and doctor dry-runs do not repair Cocos metadata or write reports', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-readonly-cache-'));
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-readonly-cocos-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(cocosRoot, { recursive: true, force: true }));

  const model = path.join(cocosRoot, 'assets', 'models', 'Existing.fbx');
  fs.mkdirSync(path.dirname(model), { recursive: true });
  fs.writeFileSync(model, 'model-placeholder', 'utf8');
  const modelMeta = `${model}.meta`;
  const originalMeta = `${JSON.stringify({
    uuid: 'cocos-model',
    imported: true,
    subMetas: {
      imported: { importer: 'gltf-mesh', uuid: 'cocos-model@imported', userData: {} },
      pending: {
        importer: 'gltf-mesh',
        uuid: 'cocos-model@pending',
        userData: { unityCocosPortPendingImport: true },
      },
    },
  }, null, 2)}\n`;
  fs.writeFileSync(modelMeta, originalMeta, 'utf8');

  const prefab = fixture.write('Assets/Game/Prefabs/DryRun.prefab', [
    '%YAML 1.1',
    '--- !u!1 &1001',
    'GameObject:',
    '  m_Component:',
    '  - component: {fileID: 1002}',
    '  m_Layer: 0',
    '  m_Name: DryRun',
    '  m_IsActive: 1',
    '--- !u!4 &1002',
    'Transform:',
    '  m_GameObject: {fileID: 1001}',
    '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
    '  m_LocalPosition: {x: 0, y: 0, z: 0}',
    '  m_LocalScale: {x: 1, y: 1, z: 1}',
    '  m_Children: []',
    '  m_Father: {fileID: 0}',
    '',
  ].join('\n'));
  const prefabOut = path.join(cocosRoot, 'assets', 'prefabs', 'DryRun.prefab');
  const prefabReport = path.join(cocosRoot, 'temp', 'prefab-report.csv');
  const prefabResult = invoke([
    'port', '--src', prefab, '--unity-root', fixture.assets,
    '--cocos-root', cocosRoot, '--out', prefabOut, '--report', prefabReport,
    '--dry-run', '--no-cache',
  ], cacheDir, PREFAB_PORT);
  assert.equal(prefabResult.status, 0, `${prefabResult.stdout}\n${prefabResult.stderr}`);
  assert.equal(fs.readFileSync(modelMeta, 'utf8'), originalMeta);
  assert.equal(fs.existsSync(prefabOut), false);
  assert.equal(fs.existsSync(prefabReport), false);

  const doctorReport = path.join(cocosRoot, 'temp', 'doctor-report.csv');
  const doctorResult = invoke([
    'doctor', '--unity-root', fixture.assets, '--cocos-root', cocosRoot,
    '--report', doctorReport, '--dry-run',
  ], cacheDir, PREFAB_PORT);
  assert.equal(doctorResult.status, 0, `${doctorResult.stdout}\n${doctorResult.stderr}`);
  assert.equal(fs.readFileSync(modelMeta, 'utf8'), originalMeta);
  assert.equal(fs.existsSync(doctorReport), false);

  const blockedDoctorReport = path.join(cocosRoot, 'temp', 'doctor-write.csv');
  const blockedDoctor = invoke([
    'doctor', '--unity-root', fixture.assets, '--cocos-root', cocosRoot,
    '--report', blockedDoctorReport,
  ], cacheDir, PREFAB_PORT);
  assert.equal(blockedDoctor.status, 1);
  assert.match(blockedDoctor.stderr, /UNITY_PREFLIGHT_REQUIRED/);
  assert.equal(fs.existsSync(blockedDoctorReport), false);

  const inferredDoctorReport = path.join(cocosRoot, 'temp', 'doctor-inferred.csv');
  const inferredDoctor = spawnSync(process.execPath, [
    PREFAB_PORT, 'doctor', '--cocos-root', cocosRoot, '--report', inferredDoctorReport,
  ], {
    cwd: fixture.assets,
    encoding: 'utf8',
    env: { ...process.env, CC_PLAYABLE_UNITY_INTEL_CACHE: cacheDir },
  });
  assert.equal(inferredDoctor.status, 1);
  assert.match(inferredDoctor.stderr, /UNITY_PREFLIGHT_REQUIRED/);
  assert.equal(fs.existsSync(inferredDoctorReport), false);
});

test('Spine prefab dry-run computes wiring without writing prepared data or atlas metadata', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-spine-dry-cache-'));
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-spine-dry-cocos-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(cocosRoot, { recursive: true, force: true }));

  const scriptGuid = '1'.repeat(32);
  const skeletonDataGuid = '2'.repeat(32);
  const jsonGuid = '3'.repeat(32);
  const atlasGuid = '4'.repeat(32);
  fixture.write('Assets/Game/Scripts/SkeletonGraphic.cs', 'public class SkeletonGraphic {}\n');
  fixture.write('Assets/Game/Scripts/SkeletonGraphic.cs.meta', `fileFormatVersion: 2\nguid: ${scriptGuid}\n`);
  fixture.write('Assets/Game/Spine/HeroSkeleton.asset', [
    '%YAML 1.1',
    '--- !u!114 &1',
    'MonoBehaviour:',
    `  skeletonJSON: {fileID: 4900000, guid: ${jsonGuid}, type: 3}`,
    '  atlasAssets:',
    `  - {fileID: 4900000, guid: ${atlasGuid}, type: 3}`,
    '',
  ].join('\n'));
  fixture.write('Assets/Game/Spine/HeroSkeleton.asset.meta', `fileFormatVersion: 2\nguid: ${skeletonDataGuid}\n`);
  fixture.write('Assets/Game/Spine/Hero.json', '{}\n');
  fixture.write('Assets/Game/Spine/Hero.json.meta', `fileFormatVersion: 2\nguid: ${jsonGuid}\n`);
  fixture.write('Assets/Game/Spine/Hero.atlas.txt', 'hero.png\n');
  fixture.write('Assets/Game/Spine/Hero.atlas.txt.meta', `fileFormatVersion: 2\nguid: ${atlasGuid}\n`);
  const prefab = fixture.write('Assets/Game/Prefabs/SpineDry.prefab', [
    '%YAML 1.1',
    '--- !u!1 &1001',
    'GameObject:',
    '  m_Component:',
    '  - component: {fileID: 1002}',
    '  - component: {fileID: 1003}',
    '  m_Layer: 0',
    '  m_Name: SpineDry',
    '  m_IsActive: 1',
    '--- !u!4 &1002',
    'Transform:',
    '  m_GameObject: {fileID: 1001}',
    '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
    '  m_LocalPosition: {x: 0, y: 0, z: 0}',
    '  m_LocalScale: {x: 1, y: 1, z: 1}',
    '  m_Children: []',
    '  m_Father: {fileID: 0}',
    '--- !u!114 &1003',
    'MonoBehaviour:',
    '  m_GameObject: {fileID: 1001}',
    `  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}`,
    `  skeletonDataAsset: {fileID: 11400000, guid: ${skeletonDataGuid}, type: 2}`,
    '',
  ].join('\n'));

  const preparedDir = path.join(cocosRoot, 'assets', 'unity_imported', 'Game', 'Spine');
  fs.mkdirSync(preparedDir, { recursive: true });
  const prefabOut = path.join(cocosRoot, 'assets', 'prefabs', 'SpineDry.prefab');
  const result = invoke([
    'port', '--src', prefab, '--unity-root', fixture.assets,
    '--cocos-root', cocosRoot, '--out', prefabOut,
    '--dry-run', '--no-cache',
  ], cacheDir, PREFAB_PORT);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(fs.readdirSync(preparedDir), []);
  assert.equal(fs.existsSync(path.join(preparedDir, 'Hero.atlas.meta')), false);
  assert.equal(fs.existsSync(path.join(preparedDir, 'Hero.json.meta')), false);
  assert.equal(fs.existsSync(prefabOut), false);
});

test('FBX fallback dry-run does not create metadata, launch a converter, or emit GLB', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-fbx-dry-cache-'));
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-fbx-dry-cocos-'));
  const converterBin = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-fbx-dry-bin-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(cocosRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(converterBin, { recursive: true, force: true }));

  const converterMarker = path.join(converterBin, 'converter-spawned.txt');
  const extraEnv = { UNITY_FBX_DRY_RUN_MARKER: converterMarker };
  if (process.platform === 'win32') {
    const fakeConverter = path.join(converterBin, 'FBX2glTF.exe');
    const preload = path.join(converterBin, 'converter-probe.cjs');
    fs.copyFileSync(process.execPath, fakeConverter);
    fs.writeFileSync(preload, [
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "if (path.basename(process.execPath).toLowerCase() === 'fbx2gltf.exe') {",
      "  fs.writeFileSync(process.env.UNITY_FBX_DRY_RUN_MARKER, 'spawned\\n', 'utf8');",
      '}',
      '',
    ].join('\n'), 'utf8');
    const preloadOptionPath = preload.replace(/\\/g, '/');
    extraEnv.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require "${preloadOptionPath}"`].filter(Boolean).join(' ');
  } else {
    const fakeConverter = path.join(converterBin, 'FBX2glTF');
    fs.writeFileSync(fakeConverter, [
      '#!/usr/bin/env node',
      "require('node:fs').writeFileSync(process.env.UNITY_FBX_DRY_RUN_MARKER, 'spawned\\n', 'utf8');",
      'process.exit(1);',
      '',
    ].join('\n'), 'utf8');
    fs.chmodSync(fakeConverter, 0o755);
  }
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
  extraEnv[pathKey] = `${converterBin}${path.delimiter}${process.env[pathKey] || ''}`;

  const fbxGuid = '5'.repeat(32);
  fixture.write('Assets/Game/Models/Hero.fbx', 'fbx-placeholder\n');
  fixture.write('Assets/Game/Models/Hero.fbx.meta', `fileFormatVersion: 2\nguid: ${fbxGuid}\n`);
  const prefab = fixture.write('Assets/Game/Prefabs/FbxDry.prefab', [
    '%YAML 1.1',
    '--- !u!1 &1001',
    'GameObject:',
    '  m_Component:',
    '  - component: {fileID: 1002}',
    '  - component: {fileID: 1003}',
    '  - component: {fileID: 1004}',
    '  m_Layer: 0',
    '  m_Name: FbxDry',
    '  m_IsActive: 1',
    '--- !u!4 &1002',
    'Transform:',
    '  m_GameObject: {fileID: 1001}',
    '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
    '  m_LocalPosition: {x: 0, y: 0, z: 0}',
    '  m_LocalScale: {x: 1, y: 1, z: 1}',
    '  m_Children: []',
    '  m_Father: {fileID: 0}',
    '--- !u!33 &1003',
    'MeshFilter:',
    '  m_GameObject: {fileID: 1001}',
    `  m_Mesh: {fileID: 4300000, guid: ${fbxGuid}, type: 3}`,
    '--- !u!23 &1004',
    'MeshRenderer:',
    '  m_GameObject: {fileID: 1001}',
    '  m_Materials: []',
    '',
  ].join('\n'));

  const assetsDir = path.join(cocosRoot, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const prefabOut = path.join(assetsDir, 'prefabs', 'FbxDry.prefab');
  const glbOut = path.join(assetsDir, 'unity_imported', 'Game', 'Models', 'Hero.glb');
  const result = invoke([
    'port', '--src', prefab, '--unity-root', fixture.assets,
    '--cocos-root', cocosRoot, '--out', prefabOut,
    '--dry-run', '--no-cache', '--convert-fbx-fallback', '--no-import-wait',
  ], cacheDir, PREFAB_PORT, extraEnv);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(assetsDir, 'unity_imported')), false);
  assert.equal(fs.existsSync(`${path.join(assetsDir, 'unity_imported')}.meta`), false);
  assert.equal(fs.existsSync(converterMarker), false);
  assert.equal(fs.existsSync(glbOut), false);
  assert.equal(fs.existsSync(`${glbOut}.meta`), false);
  assert.equal(fs.existsSync(prefabOut), false);
});

test('sharded prefab dry-run preserves stale shard reports and never writes a merged report', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-sharded-dry-cache-'));
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-sharded-dry-cocos-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(cocosRoot, { recursive: true, force: true }));
  const report = path.join(cocosRoot, 'temp', 'batch-report.csv');
  const shard0 = report.replace(/\.csv$/i, '.shard0.csv');
  const shard1 = report.replace(/\.csv$/i, '.shard1.csv');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(shard0, 'stale-zero\n', 'utf8');
  fs.writeFileSync(shard1, 'stale-one\n', 'utf8');

  const result = invoke([
    'port', '--src', path.join(fixture.root, 'Assets', 'Game', 'Prefabs'),
    '--unity-root', fixture.assets, '--cocos-root', cocosRoot,
    '--out', path.join(cocosRoot, 'assets', 'prefabs'),
    '--jobs', '2', '--dry-run', '--no-cache', '--report', report,
  ], cacheDir, PREFAB_PORT);
  assert.notEqual(result.status, null, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(shard0, 'utf8'), 'stale-zero\n');
  assert.equal(fs.readFileSync(shard1, 'utf8'), 'stale-one\n');
  assert.equal(fs.existsSync(report), false);
});
