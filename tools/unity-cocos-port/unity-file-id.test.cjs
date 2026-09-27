'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { xxHash64, unitySubAssetFileId, matchUnitySubAssetName } = require('./unity-file-id.js');

test('xxHash64 matches the reference vectors', () => {
  // Reference values from the xxHash specification (seed 0).
  assert.equal(xxHash64(Buffer.from('')).toString(16), 'ef46db3751d8e999');
  assert.equal(xxHash64(Buffer.from('a')).toString(16), 'd24ec4f1a98c6e5b');
  assert.equal(xxHash64(Buffer.from('abc')).toString(16), '44bc2cf5ad770999');
  const long = Buffer.from('Nobody inspects the spammish repetition');
  assert.equal(xxHash64(long).toString(16), 'fbcea83c8a378bf1');
});

test('Unity model sub-asset fileIDs follow Type:<Class>-><name><index> (captured from Unity 6000.3)', () => {
  // AssetDatabase.TryGetGUIDAndLocalFileIdentifier on ScrewOutFactory FBX files.
  assert.equal(unitySubAssetFileId('Mesh', 'Candy.001'), '812695599402130866');
  assert.equal(unitySubAssetFileId('Mesh', 'Candy.002'), '3866930481526856542');
  assert.equal(unitySubAssetFileId('Mesh', 'Candy.003'), '-9026653672969465343');
  assert.equal(unitySubAssetFileId('Mesh', 'Candy.004'), '8379768688737805818');
  assert.equal(unitySubAssetFileId('Mesh', 'Candy.005'), '-6410256056669079156');
  assert.equal(unitySubAssetFileId('Mesh', 'obj_screw_new'), '-1351841031486281740');
});

test('matchUnitySubAssetName picks the imported mesh whose deterministic id matches', () => {
  const names = ['Candy.001', 'Candy.002', 'Candy.003', 'Candy.004', 'Candy.005'];
  assert.deepEqual(matchUnitySubAssetName('Mesh', names, '-9026653672969465343'), { name: 'Candy.003', index: 0, unityName: 'Candy.003' });
  assert.equal(matchUnitySubAssetName('Mesh', names, '123'), null);
});

test('matchUnitySubAssetName also matches Unity node-named meshes whose file geometry keeps a .NNN suffix', () => {
  // pack_tray_lid_new (1).fbx: Unity 6000.3 reports Mesh 'obj_tray_color' -6158127508233790551 while the
  // Cocos import names the geometry 'obj_tray_color.001'.
  const names = ['obj_lid_color', 'obj_lid_unblock', 'obj_tray_color.001'];
  assert.deepEqual(matchUnitySubAssetName('Mesh', names, '-6158127508233790551'),
    { name: 'obj_tray_color.001', index: 0, unityName: 'obj_tray_color' });
  assert.deepEqual(matchUnitySubAssetName('Mesh', names, '-2693560359648129942'),
    { name: 'obj_lid_color', index: 0, unityName: 'obj_lid_color' });
});
