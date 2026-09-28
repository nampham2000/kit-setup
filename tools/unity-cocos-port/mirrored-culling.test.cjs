'use strict';
// Unity flips triangle winding for a renderer whose world determinant is negative
// (Candy Pop Sort WallPiece_Corner-Up-Left, root scale (-1.5, 1.5, 1), rendered as
// a black square in Cocos while (-1.5, -1.5, 1) was fine). Cocos 3.8.8 takes the
// front-face winding only from the pass rasterizer state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const {
  scaleDeterminant, prefabChainDeterminantSign, findMirroredRendererNodes, unityModelMayHaveRenderers,
} = require('./mirrored-culling-detect.cjs');
const createRuntimePorter = require('./runtime-component-porter');
const { lintFile } = require('../zero-gc-linter.cjs');

const TEMPLATE = path.join(__dirname, 'runtime', 'UnityMirroredCulling.ts');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrored-culling-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

const v3 = (x, y, z) => ({ __type__: 'cc.Vec3', x, y, z });
const reports = () => {
  const entries = [];
  return { entries, ...Object.fromEntries(['high', 'medium', 'low'].map((level) => [level, (...args) => entries.push({ level, args })])) };
};

// objects: 0 prefab, 1 root, 2 child with renderer, 3 renderer component.
function wallBuilder(rootScale, childScale = v3(0.4, 0.4, 0.4), rendererType = 'cc.MeshRenderer') {
  const objects = [
    { __type__: 'cc.Prefab' },
    { __type__: 'cc.Node', _name: 'Wall', _parent: null, _lscale: rootScale, _components: [] },
    { __type__: 'cc.Node', _name: 'Wall_Corner', _parent: { __id__: 1 }, _lscale: childScale, _components: [{ __id__: 3 }] },
    { __type__: rendererType, node: { __id__: 2 } },
  ];
  return {
    objects,
    nestedPrefabInstanceByNode: new Map(),
    nestedPrefabRendererHint: new Map(),
    cocosDb: { findScriptClass: (name) => (name === 'UnityMirroredCulling' ? { classId: 'mirrored-class' } : null) },
    addComponent(nodeId, type, body) {
      objects[nodeId]._components.push({ __id__: objects.length });
      objects.push({ __type__: type, node: { __id__: nodeId }, ...body });
      return objects.length - 1;
    },
  };
}

test('scale determinant sign follows the count of negative axes', () => {
  assert.ok(scaleDeterminant(v3(-1.5, 1.5, 1)) < 0);
  assert.ok(scaleDeterminant(v3(-1.5, -1.5, 1)) > 0);
  assert.ok(scaleDeterminant(v3(-1, -1, -1)) < 0);
  assert.equal(scaleDeterminant(null), 1);
});

test('WallPiece_Corner-Up-Left (-1.5, 1.5, 1) is mirrored; Corner-Down-Left (-1.5, -1.5, 1) is not', () => {
  const upLeft = wallBuilder(v3(-1.5, 1.5, 1));
  assert.equal(prefabChainDeterminantSign(upLeft, 2), -1);
  assert.deepEqual(findMirroredRendererNodes(upLeft), [{ nodeId: 2, includeDescendants: false, rendererTypes: ['cc.MeshRenderer'] }]);
  const downLeft = wallBuilder(v3(-1.5, -1.5, 1));
  assert.equal(prefabChainDeterminantSign(downLeft, 2), 1);
  assert.deepEqual(findMirroredRendererNodes(downLeft), []);
  // A mirrored child under a mirrored root cancels out.
  assert.deepEqual(findMirroredRendererNodes(wallBuilder(v3(-1, 1, 1), v3(1, 1, -1))), []);
  // Degenerate (zero) scale draws nothing in either engine.
  assert.deepEqual(findMirroredRendererNodes(wallBuilder(v3(0, 1, 1))), []);
});

test('SkinnedMeshRenderer nodes are detected too', () => {
  const builder = wallBuilder(v3(1, 1, -1), v3(1, 1, 1), 'cc.SkinnedMeshRenderer');
  assert.deepEqual(findMirroredRendererNodes(builder).map((t) => t.rendererTypes), [['cc.SkinnedMeshRenderer']]);
});

test('nested prefab instance root uses its _lscale override and the renderer hint', () => {
  const objects = [
    { __type__: 'cc.Prefab' },
    { __type__: 'cc.Node', _name: 'Board', _parent: null, _lscale: v3(1, 1, 1), _components: [] },
    { __type__: 'cc.Node', _parent: { __id__: 1 } },
    { __type__: 'cc.TargetInfo', localID: ['root-local'] },
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 3 }, propertyPath: ['_lscale'], value: v3(-1, 1, 1) },
    { __type__: 'cc.PrefabInstance', propertyOverrides: [{ __id__: 4 }] },
  ];
  const builder = { objects, nestedPrefabInstanceByNode: new Map([[2, { instanceId: 5, rootLocalId: 'root-local' }]]), nestedPrefabRendererHint: new Map() };
  assert.deepEqual(findMirroredRendererNodes(builder), [{ nodeId: 2, includeDescendants: true, rendererTypes: [] }]);
  builder.nestedPrefabRendererHint.set(2, false);
  assert.deepEqual(findMirroredRendererNodes(builder), [], 'UI-only nested prefabs do not get the adapter');
  objects[4].value = v3(-1, -1, 1);
  builder.nestedPrefabRendererHint.clear();
  assert.deepEqual(findMirroredRendererNodes(builder), []);
});

test('Unity model renderer hint sees renderers, nested prefabs and model instances', () => {
  const model = (docs, gos = []) => ({ componentDocs: new Map(docs.map((d, i) => [String(i), d])), byId: new Map(), gameObjects: new Map(gos.map((g, i) => [String(i), g])) });
  assert.equal(unityModelMayHaveRenderers(model([{ classId: 23 }])), true);
  assert.equal(unityModelMayHaveRenderers(model([{ classId: 137 }])), true);
  assert.equal(unityModelMayHaveRenderers(model([{ classId: 224 }, { classId: 114 }])), false);
  assert.equal(unityModelMayHaveRenderers(model([], [{ syntheticModelAsset: {} }])), true);
});

test('runtime porter attaches UnityMirroredCulling once and reports a low code', () => {
  const builder = wallBuilder(v3(-1.5, 1.5, 1));
  const reporter = reports();
  const porter = createRuntimePorter({ ensureDirectoryMetas: () => {} });
  assert.deepEqual(porter.attachMirroredCulling(builder, reporter), [2]);
  assert.deepEqual(porter.attachMirroredCulling(builder, reporter), [], 'idempotent');
  const components = builder.objects.filter((o) => o.__type__ === 'mirrored-class');
  assert.equal(components.length, 1);
  assert.equal(components[0].includeDescendants, false);
  assert.deepEqual(reporter.entries.map((e) => [e.level, e.args[0]]), [['low', 'MIRRORED_RENDERER_CULLING']]);
});

test('missing runtime script is reported instead of silently rendering inside out', () => {
  const builder = wallBuilder(v3(-1, 1, 1));
  builder.cocosDb = { findScriptClass: () => null, root: path.join(temp, 'no-project') };
  const reporter = reports();
  createRuntimePorter({}).attachMirroredCulling(builder, reporter);
  assert.deepEqual(reporter.entries.map((e) => e.args[0]), ['MIRRORED_CULLING_SCRIPT_MISSING']);
});

test('portPrefab attaches the adapter only to the negative-determinant renderer', () => {
  const { portPrefab, parseArgs } = require('../unity-cocos-port.cjs');
  const root = path.join(temp, 'port'), unity = path.join(root, 'unity'), cocos = path.join(root, 'cocos');
  fs.mkdirSync(path.join(unity, 'Assets'), { recursive: true });
  fs.mkdirSync(path.join(cocos, 'assets'), { recursive: true });
  const piece = (name, sx, sy) => `%YAML 1.1
--- !u!1 &1
GameObject:
  m_Name: ${name}
  m_IsActive: 1
  m_Component:
  - component: {fileID: 2}
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: ${sx}, y: ${sy}, z: 1}
  m_Children:
  - {fileID: 4}
  m_Father: {fileID: 0}
--- !u!1 &3
GameObject:
  m_Name: Wall_Corner
  m_IsActive: 1
  m_Component:
  - component: {fileID: 4}
  - component: {fileID: 5}
  - component: {fileID: 6}
--- !u!4 &4
Transform:
  m_GameObject: {fileID: 3}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 0.4, y: 0.4, z: 0.4}
  m_Children: []
  m_Father: {fileID: 2}
--- !u!33 &5
MeshFilter:
  m_GameObject: {fileID: 3}
  m_Mesh: {fileID: 0}
--- !u!23 &6
MeshRenderer:
  m_GameObject: {fileID: 3}
  m_Enabled: 1
  m_Materials: []
`;
  const run = (name, sx, sy) => {
    const source = path.join(unity, 'Assets', `${name}.prefab`);
    const out = path.join(cocos, 'assets', `${name}.prefab`);
    fs.writeFileSync(source, piece(name, sx, sy));
    const report = path.join(root, `${name}.csv`);
    portPrefab(parseArgs(['port', '--src', source, '--out', out, '--unity-root', unity, '--cocos-root', cocos, '--overwrite', '--no-cache', '--no-import-wait', '--no-engine-feature-repair', '--report', report]));
    const objects = JSON.parse(fs.readFileSync(out, 'utf8'));
    return { objects, report: fs.readFileSync(report, 'utf8') };
  };
  const upLeft = run('WallPiece_Corner-Up-Left', -1.5, 1.5);
  const meta = JSON.parse(fs.readFileSync(path.join(cocos, 'assets/script/UnityMirroredCulling.ts.meta'), 'utf8'));
  const { compressUuid } = require('./core-utils');
  const classId = compressUuid(meta.uuid);
  assert.ok(fs.readFileSync(path.join(cocos, 'assets/script/UnityMirroredCulling.ts'), 'utf8').includes("@ccclass('UnityMirroredCulling')"));
  const renderer = upLeft.objects.find((o) => o.__type__ === 'cc.MeshRenderer');
  assert.ok(renderer, 'fixture must emit a MeshRenderer');
  const adapters = upLeft.objects.filter((o) => o.__type__ === classId);
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0].node.__id__, renderer.node.__id__);
  assert.equal(adapters[0].includeDescendants, false);
  assert.match(upLeft.report, /MIRRORED_RENDERER_CULLING/);

  const downLeft = run('WallPiece_Corner-Down-Left', -1.5, -1.5);
  assert.equal(downLeft.objects.filter((o) => o.__type__ === classId).length, 0);
  assert.doesNotMatch(downLeft.report, /MIRRORED_RENDERER_CULLING/);
});

// ---- runtime template ----

function loadRuntime() {
  class Component { get isValid() { return true; } }
  class MeshRenderer {}
  class Material {
    constructor() { this.passes = []; this.name = ''; this.isValid = true; }
    copy(source, overrides) {
      this.source = source;
      this.passes = source.passes.map((pass, i) => ({ rasterizerState: { ...pass.rasterizerState, ...overrides.states[i].rasterizerState } }));
    }
    destroy() { this.isValid = false; }
    overridePipelineStates(overrides, passIdx) {
      this.passes[passIdx].rasterizerState = { ...this.passes[passIdx].rasterizerState, ...overrides.rasterizerState };
    }
  }
  const Node = { EventType: { TRANSFORM_CHANGED: 'transform-changed' } };
  const decorator = () => (target) => target;
  const cc = {
    _decorator: { ccclass: decorator, disallowMultiple: (target) => target, property: (...args) => (args.length >= 2 ? undefined : () => undefined) },
    Component, Material, MeshRenderer, Node,
  };
  const js = ts.transpileModule(fs.readFileSync(TEMPLATE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'module', 'require', js)(loaded.exports, loaded, (name) => {
    if (name === 'cc') return cc;
    throw new Error(`unexpected import ${name}`);
  });
  return { ...loaded.exports, cc };
}

function scaleMatrix(x, y, z) {
  return { m00: x, m01: 0, m02: 0, m04: 0, m05: y, m06: 0, m08: 0, m09: 0, m10: z };
}

test('runtime determinant sign matches Unity (rotation does not change it)', () => {
  const { unityMatrixDeterminantSign } = loadRuntime();
  assert.equal(unityMatrixDeterminantSign(scaleMatrix(-1.5, 1.5, 1)), -1);
  assert.equal(unityMatrixDeterminantSign(scaleMatrix(-1.5, -1.5, 1)), 1);
  // 90 deg about Z with X mirrored: columns (0,-1,0), (-1,0,0), (0,0,1).
  assert.equal(unityMatrixDeterminantSign({ m00: 0, m01: -1, m02: 0, m04: -1, m05: 0, m06: 0, m08: 0, m09: 0, m10: 1 }), -1);
});

function fakeRenderer(runtime, materials, node) {
  const renderer = new runtime.cc.MeshRenderer();
  renderer.isValid = true;
  renderer.node = node;
  renderer.sharedMaterials = materials.slice();
  renderer.instances = [];
  renderer.setSharedMaterial = (material, slot) => { renderer.sharedMaterials[slot] = material; renderer.instances[slot] = null; };
  renderer.getRenderMaterial = (slot) => renderer.instances[slot] || renderer.sharedMaterials[slot];
  return renderer;
}

function material(runtime, name, cullModes) {
  const mat = new runtime.cc.Material();
  mat.name = name;
  mat.passes = cullModes.map((cullMode) => ({ rasterizerState: { cullMode, isFrontFaceCCW: true, depthBias: 0 } }));
  return mat;
}

function component(runtime, renderer) {
  const listeners = [];
  const node = renderer.node;
  node.on = (type, fn, target) => listeners.push({ type, fn, target });
  node.off = (type, fn) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); };
  node.getComponents = () => [renderer];
  node.getComponentsInChildren = () => [renderer];
  const culling = new runtime.UnityMirroredCulling();
  node.getComponent = () => culling;
  Object.defineProperty(culling, 'node', { value: node });
  return { culling, listeners };
}

test('negative determinant swaps every pass to a shared mirrored copy and restores the original', () => {
  const runtime = loadRuntime();
  const node = { worldMatrix: scaleMatrix(-1.5, 1.5, 1) };
  // Two-pass effect (outline shell cull FRONT + body cull BACK) plus a second slot.
  const toon = material(runtime, 'toon', [1, 2]);
  const other = material(runtime, 'other', [2]);
  const renderer = fakeRenderer(runtime, [toon, other], node);
  const { culling, listeners } = component(runtime, renderer);
  culling.onEnable();
  assert.equal(listeners.length, 1);
  assert.equal(culling.mirroredRendererCount, 1);
  const mirroredToon = renderer.sharedMaterials[0];
  assert.notEqual(mirroredToon, toon);
  assert.deepEqual(mirroredToon.passes.map((p) => [p.rasterizerState.cullMode, p.rasterizerState.isFrontFaceCCW]), [[1, false], [2, false]]);
  assert.deepEqual(toon.passes.map((p) => p.rasterizerState.isFrontFaceCCW), [true, true], 'source material untouched');
  assert.equal(runtime.isUnityMirroredMaterial(renderer.sharedMaterials[1]), true);

  // A second mirrored renderer with the same source shares the mirrored copy (batching).
  const second = fakeRenderer(runtime, [toon], { worldMatrix: scaleMatrix(1, 1, -1) });
  component(runtime, second).culling.onEnable();
  assert.equal(second.sharedMaterials[0], mirroredToon);

  // Game code swaps slot 1 while mirrored: lateUpdate re-mirrors it.
  const replacement = material(runtime, 'replacement', [2]);
  renderer.sharedMaterials[1] = replacement;
  culling.lateUpdate();
  assert.equal(runtime.isUnityMirroredMaterial(renderer.sharedMaterials[1]), true);

  // Parent flips back to positive: originals restored, no copies.
  node.worldMatrix = scaleMatrix(-1.5, -1.5, 1);
  culling.lateUpdate();
  assert.deepEqual(renderer.sharedMaterials, [toon, replacement]);
  assert.equal(culling.mirroredRendererCount, 0);

  culling.onDisable();
  assert.equal(listeners.length, 0);
});

test('positive determinant never clones or touches materials', () => {
  const runtime = loadRuntime();
  const toon = material(runtime, 'toon', [2]);
  const renderer = fakeRenderer(runtime, [toon], { worldMatrix: scaleMatrix(-1.5, -1.5, 1) });
  const { culling } = component(runtime, renderer);
  culling.onEnable();
  culling.lateUpdate();
  assert.equal(renderer.sharedMaterials[0], toon);
  assert.equal(culling.mirroredRendererCount, 0);
});

test('game-owned material instances are flipped in place and flipped back', () => {
  const runtime = loadRuntime();
  const toon = material(runtime, 'toon', [2, 1]);
  const node = { worldMatrix: scaleMatrix(-1, 1, 1) };
  const renderer = fakeRenderer(runtime, [toon], node);
  const instance = material(runtime, 'toon (Instance)', [2, 1]);
  renderer.instances[0] = instance;
  const { culling } = component(runtime, renderer);
  culling.onEnable();
  assert.equal(renderer.sharedMaterials[0], toon, 'shared slot kept so the game instance survives');
  assert.deepEqual(instance.passes.map((p) => p.rasterizerState.isFrontFaceCCW), [false, false]);
  assert.deepEqual(instance.passes.map((p) => p.rasterizerState.cullMode), [2, 1]);
  node.worldMatrix = scaleMatrix(1, 1, 1);
  culling.lateUpdate();
  assert.deepEqual(instance.passes.map((p) => p.rasterizerState.isFrontFaceCCW), [true, true]);
});

test('runtime template: one Component per module and no zero-GC violations in update paths', () => {
  const source = fs.readFileSync(TEMPLATE, 'utf8');
  assert.equal((source.match(/@ccclass\(/g) || []).length, 1);
  assert.ok(!/LabelOutline|LabelShadow/.test(source));
  const violations = lintFile(TEMPLATE).filter((v) => /^ZERO_GC/.test(v.rule));
  assert.deepEqual(violations, []);
  // Per-frame path: lateUpdate -> evaluate -> verifyMirrored must not allocate.
  for (const method of ['lateUpdate', 'evaluate', 'verifyMirrored']) {
    const start = source.indexOf(`private ${method}(`) >= 0 ? source.indexOf(`private ${method}(`) : source.indexOf(`protected ${method}(`);
    assert.ok(start >= 0, method);
    const body = source.slice(start, source.indexOf('\n  }\n', start));
    assert.doesNotMatch(body, /\bnew\s|\[\s*\]|\{\s*\}|=>|\.map\(|\.filter\(|\.slice\(/, `${method} allocates`);
  }
});
