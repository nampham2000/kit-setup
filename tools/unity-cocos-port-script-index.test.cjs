'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CocosAssetDatabase } = require('./unity-cocos-port.cjs');

test('Cocos script index reads @property fields on the same or following line', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-script-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scriptDir = path.join(root, 'assets', 'script');
  fs.mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, 'TapeObject.ts');
  fs.writeFileSync(script, `
import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('TapeObject')
export class TapeObject extends Component {
  @property public drawGizmos = false;
  @property public depthOrder = 0;
  @property([Node]) public tapeBlocks: Node[] = [];
  @property([Vec3])
  public pathPoints: Vec3[] = [];
}
`, 'utf8');
  fs.writeFileSync(`${script}.meta`, JSON.stringify({
    ver: '4.0.24', importer: 'typescript', imported: true,
    uuid: '00000000-0000-4000-8000-000000000001', files: [], subMetas: {}, userData: {},
  }), 'utf8');

  const db = new CocosAssetDatabase(root);
  db.scan({ readOnly: true });
  const indexed = db.findScriptClass('TapeObject');

  assert.ok(indexed);
  assert.deepEqual(
    ['drawGizmos', 'depthOrder', 'tapeBlocks', 'pathPoints'].filter(name => !indexed.memberNames.has(name)),
    [],
  );
  assert.ok(indexed.booleanFields.has('drawGizmos'));
  assert.equal(indexed.vectorFields.size, 0, 'Vec3[] is not a scalar Vec3 field');
});
