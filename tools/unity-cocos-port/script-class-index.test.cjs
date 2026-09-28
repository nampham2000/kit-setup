'use strict';

// A Unity MonoBehaviour binds to a Cocos class by name. Only @ccclass-decorated classes are registered
// Cocos classes: Blast Shooter's plain `export class ConveyorBall` helper (in BlastConveyor.ts) was bound
// as the ConveyorBall component and the preview failed with "Can not find class".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CocosAssetDatabase } = require('../unity-cocos-port.cjs');

test('only @ccclass-decorated exported classes are indexed as Cocos script classes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-class-index-'));
  const file = path.join(dir, 'Conveyor.ts');
  fs.writeFileSync(file, [
    "import { _decorator, Component } from 'cc';",
    'const { ccclass, executionOrder, property } = _decorator;',
    '/** A pooled ball. */',
    'export class ConveyorBall { constructor(readonly node: unknown) {} }',
    "@ccclass('ConveyorView')",
    '@executionOrder(-10)',
    'export class ConveyorView extends Component { @property speed = 1; }',
    '@executionOrder(-1)',
    "@ccclass('Other')",
    'export abstract class OtherBase extends Component {}',
    'export class Plain {}',
  ].join('\n'));
  const db = new CocosAssetDatabase(dir);
  db.indexScript({ path: file, uuid: 'e0bf6542-3c09-4e30-9ddc-cc12591fcd3c', relativePath: 'Conveyor.ts' });
  assert.equal(db.findScriptClass('ConveyorBall'), null);
  assert.equal(db.findScriptClass('Plain'), null);
  assert.ok(db.findScriptClass('ConveyorView'));
  assert.ok(db.findScriptClass('OtherBase'));
  assert.ok(db.findScriptClass('Other'));
  fs.rmSync(dir, { recursive: true, force: true });
});
