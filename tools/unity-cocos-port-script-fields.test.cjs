'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getTopLevelSerializedFields } = require('./unity-cocos-port.cjs');

// Unity Tanks! (Tanks.Complete.TankShooting) serializes its own gameplay fields with the Unity "m_"
// naming convention. They must reach the Cocos component; only the MonoBehaviour header is dropped.
test('user script fields named m_* are kept, MonoBehaviour header fields are not', () => {
  const doc = {
    lines: [
      'MonoBehaviour:',
      '  m_ObjectHideFlags: 0',
      '  m_CorrespondingSourceObject: {fileID: 0}',
      '  m_PrefabInstance: {fileID: 0}',
      '  m_PrefabAsset: {fileID: 0}',
      '  m_GameObject: {fileID: 7713479727434542402}',
      '  m_Enabled: 1',
      '  m_EditorHideFlags: 0',
      '  m_Script: {fileID: 11500000, guid: 0a1b2c3d4e5f60718293a4b5c6d7e8f9, type: 3}',
      '  m_Name: ',
      '  m_EditorClassIdentifier: ',
      '  m_Shell: {fileID: 5433231426012350522, guid: 1234567890abcdef1234567890abcdef, type: 3}',
      '  m_MinLaunchForce: 15',
      '  m_MaxLaunchForce: 30',
      '  m_ShotCooldown: 0.25',
      '  m_TankMask:',
      '    serializedVersion: 2',
      '    m_Bits: 512',
      '  m_Targets: []',
      '  _privateSpeed: 3',
    ],
  };
  const fields = getTopLevelSerializedFields(doc, { stripPrivatePrefix: true });
  for (const header of ['m_ObjectHideFlags', 'm_GameObject', 'm_Enabled', 'm_Script', 'm_Name', 'm_EditorClassIdentifier', 'm_PrefabInstance']) {
    assert.equal(Object.prototype.hasOwnProperty.call(fields, header), false, header);
  }
  assert.equal(fields.m_MinLaunchForce, 15);
  assert.equal(fields.m_MaxLaunchForce, 30);
  assert.equal(fields.m_ShotCooldown, 0.25);
  assert.equal(fields.m_Shell.guid, '1234567890abcdef1234567890abcdef');
  assert.equal(fields.m_TankMask.m_Bits, 512);
  assert.equal(fields.privateSpeed, 3);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { synthesizeStrippedRootForPrefabVariant, buildNestedScriptFieldOverrides, parseUnityYaml } = require('./unity-cocos-port.cjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-script-fields-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a variant stored as a lone root PrefabInstance gets stripped root records from its source', (t) => {
  const dir = tempDir(t);
  const source = path.join(dir, 'TankExplosion.prefab');
  fs.writeFileSync(source, [
    '%YAML 1.1', '--- !u!1 &100', 'GameObject:', '  m_Name: TankExplosion', '  m_Component:', '  - component: {fileID: 200}',
    '--- !u!4 &200', 'Transform:', '  m_GameObject: {fileID: 100}', '  m_Father: {fileID: 0}', '  m_Children: []', '',
  ].join('\n'));
  const variant = path.join(dir, 'TankExplosion Variant.prefab');
  fs.writeFileSync(variant, [
    '%YAML 1.1', '--- !u!1001 &777', 'PrefabInstance:', '  m_Modification:', '    m_TransformParent: {fileID: 0}', '    m_Modifications: []',
    '  m_SourcePrefab: {fileID: 100100000, guid: aaaabbbbccccddddeeeeffff00001111, type: 3}', '',
  ].join('\n'));
  const unityDb = new Map([['aaaabbbbccccddddeeeeffff00001111', { path: source, ext: '.prefab', relativePath: 'TankExplosion.prefab' }]]);
  const docs = parseUnityYaml(variant);
  synthesizeStrippedRootForPrefabVariant(docs, unityDb, null, variant);
  const transform = docs.find((d) => d.classId === 4 && d.stripped);
  const gameObject = docs.find((d) => d.classId === 1 && d.stripped);
  assert.ok(transform, 'stripped root transform');
  assert.ok(gameObject, 'stripped root game object');
  assert.match(transform.lines.join('\n'), /m_CorrespondingSourceObject: \{fileID: 200, guid: aaaabbbbccccddddeeeeffff00001111/);
  assert.match(transform.lines.join('\n'), /m_PrefabInstance: \{fileID: 777\}/);
  // Idempotent: an anchored instance is left alone.
  const count = docs.length;
  synthesizeStrippedRootForPrefabVariant(docs, unityDb, null, variant);
  assert.equal(docs.length, count);
});

// Candy Pop Sort ArrowBoxObject: the variant adds a GameObject under an inner source Transform, so the
// file carries a stripped Transform for that inner parent. It must not count as the variant root:
// the root records are still synthesized, and they correspond to the SOURCE root Transform.
test('a variant with a stripped inner parent still gets the source-root stripped records', (t) => {
  const dir = tempDir(t);
  const source = path.join(dir, 'BoxObject.prefab');
  fs.writeFileSync(source, [
    '%YAML 1.1',
    '--- !u!1 &100', 'GameObject:', '  m_Name: BoxObject', '  m_Component:', '  - component: {fileID: 200}',
    '--- !u!4 &200', 'Transform:', '  m_GameObject: {fileID: 100}', '  m_Father: {fileID: 0}', '  m_Children:', '  - {fileID: 400}',
    '--- !u!1 &300', 'GameObject:', '  m_Name: TopBasket', '  m_Component:', '  - component: {fileID: 400}',
    '--- !u!4 &400', 'Transform:', '  m_GameObject: {fileID: 300}', '  m_Father: {fileID: 200}', '  m_Children: []', '',
  ].join('\n'));
  const variant = path.join(dir, 'ArrowBoxObject.prefab');
  fs.writeFileSync(variant, [
    '%YAML 1.1',
    '--- !u!1 &10', 'GameObject:', '  m_Name: Arrow', '  m_Component:', '  - component: {fileID: 11}',
    '--- !u!4 &11', 'Transform:', '  m_GameObject: {fileID: 10}', '  m_Father: {fileID: 12}', '  m_Children: []',
    '--- !u!1001 &777', 'PrefabInstance:', '  m_Modification:', '    m_TransformParent: {fileID: 0}', '    m_Modifications: []',
    '  m_SourcePrefab: {fileID: 100100000, guid: aaaabbbbccccddddeeeeffff00001111, type: 3}',
    '--- !u!4 &12 stripped', 'Transform:', '  m_CorrespondingSourceObject: {fileID: 400, guid: aaaabbbbccccddddeeeeffff00001111, type: 3}',
    '  m_PrefabInstance: {fileID: 777}', '  m_PrefabAsset: {fileID: 0}', '',
  ].join('\n'));
  const unityDb = new Map([['aaaabbbbccccddddeeeeffff00001111', { path: source, ext: '.prefab', relativePath: 'BoxObject.prefab' }]]);
  const docs = parseUnityYaml(variant);
  synthesizeStrippedRootForPrefabVariant(docs, unityDb, null, variant);
  const roots = docs.filter((d) => d.classId === 4 && d.stripped && /fileID: 200,/.test(d.lines.join('\n')));
  assert.equal(roots.length, 1, 'a stripped Transform for the source root is synthesized');
  assert.match(roots[0].lines.join('\n'), /m_PrefabInstance: \{fileID: 777\}/);
  assert.ok(docs.some((d) => d.fileId === '12' && d.stripped), 'the inner stripped parent is kept');
});

test('prefab variant MonoBehaviour overrides become typed script field overrides', () => {
  const sourceDoc = { classId: 114, lines: ['MonoBehaviour:', '  m_Script: {fileID: 11500000, guid: 11112222333344445555666677778888, type: 3}', '  m_FullHealthColor: {r: 0, g: 1, b: 0, a: 1}'] };
  const unityDb = new Map([['11112222333344445555666677778888', { path: '/x/TankHealth.cs', ext: '.cs', relativePath: 'TankHealth.cs' }]]);
  const cocosDb = { findScriptClass: () => ({
    memberNames: new Set(['m_StartingHealth', 'm_FullHealthColor', 'm_IsComputerControlled']),
    booleanFields: new Set(['m_IsComputerControlled']), colorFields: new Set(['m_FullHealthColor']),
  }) };
  const overrides = buildNestedScriptFieldOverrides(sourceDoc, '42', {
    m_StartingHealth: '150', 'm_FullHealthColor.g': '0.5', m_IsComputerControlled: '1', m_Unknown: '3', 'm_Nested.Array.size': '2',
  }, { unityDb, cocosDb, builder: null, reporter: null });
  const byPath = Object.fromEntries(overrides.map((o) => [o.propertyPath, o]));
  assert.equal(byPath.m_StartingHealth.value, 150);
  assert.equal(byPath.m_StartingHealth.localId, 'cmp-script-TankHealth-42');
  assert.equal(byPath.m_IsComputerControlled.value, true);
  assert.deepEqual(byPath.m_FullHealthColor.value, { __type__: 'cc.Color', r: 0, g: 128, b: 0, a: 255 });
  assert.equal(byPath.m_Unknown, undefined);
  assert.equal(Object.keys(byPath).some((k) => k.includes('.')), false);
});

test('Cocos script index records Color-typed fields for Unity colour coercion', (t) => {
  const { CocosAssetDatabase } = require('./unity-cocos-port.cjs');
  const root = tempDir(t);
  const dir = path.join(root, 'assets', 'script');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'TankHealth.ts');
  fs.writeFileSync(file, [
    "import { _decorator, Color, Component } from 'cc';",
    'const { ccclass, property } = _decorator;',
    "@ccclass('TankHealth')",
    'export class TankHealth extends Component {',
    '  @property(Color)',
    '  public m_FullHealthColor: Color = new Color(0, 255, 0, 255);',
    '  @property(Color) public m_ZeroHealthColor = Color.RED;',
    '  public tint: Color | null = null;',
    '  public health = 100;',
    '}',
  ].join('\n'));
  fs.writeFileSync(`${file}.meta`, JSON.stringify({ ver: '4.0.24', importer: 'typescript', imported: true, uuid: '00000000-0000-4000-8000-0000000000aa', files: [], subMetas: {}, userData: {} }));
  const db = new CocosAssetDatabase(root);
  db.scan({ readOnly: true });
  const script = db.findScriptClass('TankHealth');
  assert.ok(script.colorFields.has('m_FullHealthColor'));
  assert.ok(script.colorFields.has('m_ZeroHealthColor'));
  assert.ok(script.colorFields.has('tint'));
  assert.equal(script.colorFields.has('health'), false);
});

test('multi-renderer model material overrides are matched per renderer through the Unity object map', () => {
  const { matchModelMaterialOverrides } = require('./unity-cocos-port.cjs');
  const pink = { relativePath: 'Pink.mat' }; const drums = { relativePath: 'OilDrums.mat' };
  const slots = [
    { rendererLocalId: 'r-flag', rendererNodeName: 'Flag', slot: 0, materialName: 'Lit' },
    { rendererLocalId: 'r-pole', rendererNodeName: 'FlagPole', slot: 0, materialName: 'Lit' },
  ];
  const groups = [
    { sourceFileId: '-4002239815115787907', materialAssets: [pink] },
    { sourceFileId: '-3248155602949259588', materialAssets: [drums] },
    { sourceFileId: '2502432061147645856', materialAssets: [pink] },
  ];
  const objectMap = { fbxguid: { objects: {
    '-4002239815115787907': { type: 'MeshRenderer', name: 'Flag', path: 'Flag' },
    '-3248155602949259588': { type: 'MeshRenderer', name: 'FlagPole', path: 'FlagPole' },
  } } };
  const mapped = matchModelMaterialOverrides({ groups, slots, objectMap, modelGuid: 'fbxguid' });
  assert.equal(mapped.slotAssets.get(0), pink);
  assert.equal(mapped.slotAssets.get(1), drums);
  assert.deepEqual(mapped.orphaned, ['2502432061147645856']);
  assert.deepEqual(mapped.unmapped, []);
  // Without evidence a single override must not be broadcast to every renderer.
  const blind = matchModelMaterialOverrides({ groups: groups.slice(0, 1), slots });
  assert.equal(blind.slotAssets.size, 0);
  assert.deepEqual(blind.unmapped, ['-4002239815115787907']);
  // A single-renderer model keeps the historical behaviour.
  const single = matchModelMaterialOverrides({ groups: groups.slice(0, 1), slots: slots.slice(0, 1) });
  assert.equal(single.slotAssets.get(0), pink);
});

test('Unity-resolved renderer materials from the object map replace embedded FBX materials', () => {
  const { matchModelMaterialOverrides } = require('./unity-cocos-port.cjs');
  const grey = { relativePath: 'Tank/TankGrey.mat' }; const color = { relativePath: 'Tank/TankColor.mat' };
  const assets = { g1: grey, g2: color };
  const slots = [
    { rendererLocalId: 'r1', rendererNodeName: 'wheel1', slot: 0, materialName: 'TankGrey' },
    { rendererLocalId: 'r2', rendererNodeName: 'UTV', slot: 0, materialName: 'TankColor' },
  ];
  const objectMap = { utv: { objects: {
    '1': { type: 'MeshRenderer', name: 'wheel1', materials: [{ name: 'TankGrey', guid: 'g1' }] },
    '2': { type: 'MeshRenderer', name: 'UTV', materials: [{ name: 'TankColor', guid: 'g2' }] },
  } } };
  const result = matchModelMaterialOverrides({ slots, objectMap, modelGuid: 'utv', resolveGuid: (g) => assets[g] || null });
  assert.equal(result.slotAssets.get(0), grey);
  assert.equal(result.slotAssets.get(1), color);
});

// KriptoFX REP v4 RFX4_LightCurves (Unity 5 YAML): an AnimationCurve struct whose m_Curve list sits at the
// key's own indent. The flat parser turned it into ["serializedVersion: 2", ...], so every ported effect
// light kept intensity curve(0) = 0.
test('struct fields with nested lists of structs parse recursively (AnimationCurve, Gradient, lists of refs)', () => {
  const doc = {
    lines: [
      'MonoBehaviour:',
      '  m_Enabled: 1',
      '  LightCurve:',
      '    serializedVersion: 2',
      '    m_Curve:',
      '    - serializedVersion: 2',
      '      time: 0',
      '      value: 0',
      '      inSlope: -0.045686502',
      '      outSlope: -0.045686502',
      '      tangentMode: 0',
      '    - serializedVersion: 2',
      '      time: 1',
      '      value: 0',
      '      inSlope: -1.0416667',
      '      outSlope: -1.0416667',
      '      tangentMode: 34',
      '    m_PreInfinity: 2',
      '    m_PostInfinity: 2',
      '  GraphTimeMultiplier: 3',
      '  Prefabs:',
      '  - {fileID: 100, guid: 0a1b2c3d4e5f60718293a4b5c6d7e8f9, type: 3}',
      '  - {fileID: 0}',
      '  Offset:',
      '    x: 1',
      '    y: 2',
      '    z: 3',
      '  Points:',
      '  - position: {x: 0, y: 1, z: 0}',
      '    weights:',
      '    - 0.5',
      '    - 0.25',
      '  - position: {x: 2, y: 3, z: 4}',
      '    weights: []',
      '  Empty: []',
      '  IsLoop: 0',
    ],
  };
  const fields = getTopLevelSerializedFields(doc, {});
  assert.deepEqual(fields.LightCurve.m_Curve.map(k => [k.time, k.value, k.tangentMode]), [[0, 0, 0], [1, 0, 34]]);
  assert.equal(fields.LightCurve.m_Curve[0].inSlope, -0.045686502);
  assert.equal(fields.LightCurve.m_PostInfinity, 2);
  assert.equal(fields.GraphTimeMultiplier, 3);
  assert.equal(fields.Prefabs.length, 2);
  assert.equal(fields.Prefabs[0].guid, '0a1b2c3d4e5f60718293a4b5c6d7e8f9');
  assert.deepEqual(fields.Offset, { x: 1, y: 2, z: 3 });
  assert.deepEqual(fields.Points[0].weights, [0.5, 0.25]);
  assert.deepEqual(fields.Points[1].position, { x: 2, y: 3, z: 4 });
  assert.equal(fields.IsLoop, 0);
});
