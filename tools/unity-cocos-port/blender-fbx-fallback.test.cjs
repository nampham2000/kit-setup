'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');

const assetPorter = require('./asset-import-porter');

test('Blender FBX fallback uses the bundled headless converter with forwarded paths', () => {
  const source = path.join('D:', 'Unity', 'Tape Roll.fbx');
  const output = path.join('D:', 'Cocos', 'Tape Roll.glb');
  const invocation = assetPorter.buildFbxConverterInvocation(
    path.join('C:', 'Program Files', 'Blender Foundation', 'Blender 5.2', 'blender.exe'),
    source,
    output,
  );

  assert.equal(invocation.backend, 'blender');
  assert.deepEqual(invocation.args.slice(0, 3), ['--background', '--factory-startup', '--python']);
  assert.ok(fs.existsSync(invocation.args[3]), 'bundled Blender converter script should exist');
  assert.deepEqual(invocation.args.slice(-4), ['--input', source, '--output', output]);
});

test('existing FBX2glTF and assimp invocation contracts remain unchanged', () => {
  assert.deepEqual(
    assetPorter.buildFbxConverterInvocation('FBX2glTF.exe', 'source.fbx', 'target.glb'),
    { backend: 'fbx2gltf', args: ['-i', 'source.fbx', '-o', 'target.glb'] },
  );
  assert.deepEqual(
    assetPorter.buildFbxConverterInvocation('assimp.exe', 'source.fbx', 'target.glb'),
    { backend: 'assimp', args: ['export', 'source.fbx', 'target.glb'] },
  );
});

test('a requested fallback is not short-circuited by a generated pending FBX mesh id', () => {
  const pending = { pendingImport: true, meshUuid: 'pending@mesh' };
  const imported = { pendingImport: false, meshUuid: 'ready@mesh' };
  const fbx = { ext: '.fbx' };

  assert.equal(assetPorter.shouldContinueToFbxFallback(fbx, pending, { convertFbxFallback: true }), true);
  assert.equal(assetPorter.shouldContinueToFbxFallback(fbx, imported, { convertFbxFallback: true }), false);
  assert.equal(assetPorter.shouldContinueToFbxFallback(fbx, null, { convertFbxFallback: true }), true);
  assert.equal(assetPorter.shouldContinueToFbxFallback(fbx, pending, { convertFbxFallback: false }), false);
  assert.equal(assetPorter.shouldContinueToFbxFallback({ ext: '.glb' }, pending, { convertFbxFallback: true }), false);
});

test('porter releases only its own pending GLB meta before a real AssetDB import', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-cocos-glb-meta-'));
  try {
    const model = path.join(root, 'TapeRoll.glb');
    const metaFile = `${model}.meta`;
    fs.writeFileSync(model, Buffer.from([0x67, 0x6c, 0x54, 0x46]));
    fs.writeFileSync(metaFile, JSON.stringify({
      importer: 'gltf',
      imported: true,
      uuid: 'pending-root',
      subMetas: {
        pending: {
          importer: 'gltf-mesh',
          imported: false,
          userData: { unityCocosPortPendingImport: true },
        },
      },
    }));

    assert.equal(assetPorter.releaseOwnedPendingModelMeta(model), true);
    assert.equal(fs.existsSync(metaFile), false);

    fs.writeFileSync(metaFile, JSON.stringify({
      importer: 'gltf',
      imported: true,
      uuid: 'real-root',
      subMetas: {
        real: { importer: 'gltf-mesh', imported: true, userData: {} },
      },
    }));
    assert.equal(assetPorter.releaseOwnedPendingModelMeta(model), false);
    assert.equal(fs.existsSync(metaFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
