'use strict';

// port-materials: standalone Unity materials (a ScriptableObject colour palette assigned at runtime)
// are collected from a .mat, a folder, or the serialized material references of a .asset.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectMaterialPortSources, scannedUnityAssetDatabase } = require('./unity-cocos-port.cjs');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('collects palette materials from a ScriptableObject, a .mat and a folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'port-materials-'));
  try {
    const assets = path.join(root, 'Assets');
    const guids = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
    guids.forEach((guid, i) => {
      write(path.join(assets, 'Colors', `mtl_${i}.mat`), '%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: mtl\n');
      write(path.join(assets, 'Colors', `mtl_${i}.mat.meta`), `fileFormatVersion: 2\r\nguid: ${guid}\r\n`);
    });
    write(path.join(assets, 'Colors', 'tex.png.meta'), `fileFormatVersion: 2\nguid: ${'d'.repeat(32)}\n`);
    write(path.join(assets, 'Colors', 'tex.png'), 'png');
    const so = path.join(assets, 'Palette.asset');
    write(so, [
      '--- !u!114 &11400000', 'MonoBehaviour:',
      `  m_Script: {fileID: 11500000, guid: ${'e'.repeat(32)}, type: 3}`,
      `  - material: {fileID: 2100000, guid: ${guids[2]}, type: 2}`,
      `  - material: {fileID: 2100000, guid: ${guids[0]}, type: 2}`,
      `  icon: {fileID: 2800000, guid: ${'d'.repeat(32)}, type: 3}`,
      `  greyMat: {fileID: 2100000, guid: ${guids[0]}, type: 2}`,
    ].join('\n'));
    write(`${so}.meta`, `fileFormatVersion: 2\nguid: ${'f'.repeat(32)}\n`);
    const db = scannedUnityAssetDatabase(assets);
    const fromAsset = collectMaterialPortSources(so, db).map(m => m.stem);
    assert.deepEqual(fromAsset, ['mtl_0', 'mtl_2'], 'only type 2 material refs, deduplicated and sorted');
    assert.deepEqual(collectMaterialPortSources(path.join(assets, 'Colors', 'mtl_1.mat'), db).map(m => m.stem), ['mtl_1']);
    assert.deepEqual(collectMaterialPortSources(path.join(assets, 'Colors'), db).map(m => m.stem), ['mtl_0', 'mtl_1', 'mtl_2']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
