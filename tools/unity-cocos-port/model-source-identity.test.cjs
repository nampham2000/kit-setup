'use strict';

// Two Unity models can share a basename (Blast Shooter: Model/Pot.fbx is the shooter's round pot,
// Model/Ver2/Pot.fbx the Space's square pot). With the Unity source known, only its
// assets/unity_imported mirror may resolve; the other import must not be reused.
const assert = require('node:assert/strict');
const test = require('node:test');
const { CocosAssetDatabase } = require('../unity-cocos-port.cjs');

function db(records) {
  const database = new CocosAssetDatabase(__dirname);
  database.byStem.set('pot', records.map((relativePath, i) => ({ uuid: `u${i}`, relativePath, ext: '.fbx', stem: 'Pot', subMetas: {} })));
  return database;
}

test('a Unity model resolves only to its own unity_imported mirror', () => {
  const d = db(['assets/unity_imported/_Game/Model/Pot.fbx', 'assets/unity_imported/_Game/Model/Ver2/Pot.fbx']);
  assert.deepEqual(d.findModelRecordsByStem('Pot', '_Game/Model/Ver2/Pot.fbx').map(r => r.uuid), ['u1']);
  assert.deepEqual(d.findModelRecordsByStem('Pot', '_Game/Model/Pot.fbx').map(r => r.uuid), ['u0']);
});

test('a same-basename import of another Unity model is not reused, so the source gets copied', () => {
  const d = db(['assets/unity_imported/_Game/Model/Pot.fbx']);
  assert.deepEqual(d.findModelRecordsByStem('Pot', '_Game/Model/Ver2/Pot.fbx'), []);
  assert.equal(d.resolveModelMeshByStem('Pot', 'Pot', '.fbx', '', '_Game/Model/Ver2/Pot.fbx'), null);
});

test('a Mesh .asset matches its exported .fbx mirror; hand-placed models and stem-only lookups stay eligible', () => {
  const d = db(['assets/unity_imported/_Game/Mesh/Pot.fbx', 'assets/models/Pot.fbx']);
  assert.deepEqual(d.findModelRecordsByStem('Pot', '_Game/Mesh/Pot.asset').map(r => r.uuid), ['u0']);
  assert.deepEqual(d.findModelRecordsByStem('Pot', '_Game/Other/Pot.fbx').map(r => r.uuid), ['u1']);
  assert.equal(d.findModelRecordsByStem('Pot').length, 2);
});
