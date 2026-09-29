'use strict';

// A renderer ported while its FBX was still importing is repaired after the import. The repair used only
// the GameObject name, so a multi-mesh FBX fell back to its first mesh: Blast Shooter's "Center" tile
// (Unity mesh obj_base of Base_All.fbx) was bound to obj_base3_A. The Unity mesh name and fileID recorded
// with the repair must reach the resolver.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordPendingMeshRepair, repairPendingMeshRefs } = require('../unity-cocos-port.cjs');

test('pending mesh repair resolves with the recorded Unity mesh name and fileID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-mesh-repair-'));
  const prefab = path.join(dir, 'Cube Center.prefab');
  fs.writeFileSync(prefab, JSON.stringify([
    { __type__: 'cc.Prefab' },
    { __type__: 'cc.MeshRenderer', _mesh: null, __prefab: { __id__: 2 } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'cmp-mesh-renderer-1' },
  ]));
  const options = { cocosRoot: dir };
  recordPendingMeshRepair(options, prefab, 'cmp-mesh-renderer-1', 'Base_All', 'obj_base', '_Game/Base_All.fbx', '-5496087553488221442');
  const calls = [];
  const cocosDb = {
    resolveModelMeshByStem: (...args) => { calls.push(args); return { meshUuid: args[3] ? 'fbx@c2951' : 'fbx@56301', source: 'Base_All.fbx' }; },
  };
  const reporter = { low() {}, medium() {}, high() {} };
  assert.equal(repairPendingMeshRefs(prefab, cocosDb, reporter, options), 1);
  assert.deepEqual(calls, [['Base_All', 'obj_base', '', '-5496087553488221442', '_Game/Base_All.fbx']]);
  const objects = JSON.parse(fs.readFileSync(prefab, 'utf8'));
  assert.equal(objects[1]._mesh.__uuid__, 'fbx@c2951');
  fs.rmSync(dir, { recursive: true, force: true });
});
