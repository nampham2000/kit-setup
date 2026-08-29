'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { findPendingImporterStates } = require('./unity-cocos-port.cjs');

test('port finalizer catches a pending nested texture importer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-import-finalize-'));
  try {
    const asset = path.join(root, 'vfx.png');
    fs.writeFileSync(asset, 'fixture');
    fs.writeFileSync(`${asset}.meta`, JSON.stringify({
      imported: true,
      subMetas: {
        texture: { imported: false, importer: 'texture', uuid: 'pending-texture', subMetas: {} },
      },
    }));
    const pending = findPendingImporterStates(root);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].asset, 'vfx.png');
    assert.equal(pending[0].subPath, 'texture');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('port finalizer accepts fully imported root and sub-assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-import-finalize-'));
  try {
    const asset = path.join(root, 'mesh.glb');
    fs.writeFileSync(asset, 'fixture');
    fs.writeFileSync(`${asset}.meta`, JSON.stringify({
      imported: true,
      subMetas: { mesh: { imported: true, importer: 'gltf-mesh', subMetas: {} } },
    }));
    assert.deepEqual(findPendingImporterStates(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
