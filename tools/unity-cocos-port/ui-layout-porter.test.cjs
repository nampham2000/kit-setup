'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { emitUnityLayout, finalizeUnityLayouts } = require('./ui-layout-porter');
const createScriptPorter = require('./script-porter');
const { CocosPrefabBuilder } = require('../unity-cocos-port.cjs');
const createRuntimePorter = require('./runtime-component-porter');
const os = require('node:os');
const field = (d, k, fallback) => d[k] ?? fallback;
const has = (d, k) => Object.hasOwn(d, k);

function fixture(extra = {}, guid = '30649d3a9faa99c48a7b1166b86bf2a0') {
  const entries = [], objects = [{ _children: [{ __id__: 1 }] }, {}];
  return { doc: { m_Script: { guid }, m_ChildControlWidth: 0, m_ChildControlHeight: 0,
    m_ChildForceExpandWidth: 0, m_ChildForceExpandHeight: 0, ...extra },
  getField: field, hasField: has, unityRefGuid: r => r?.guid || '', unityDb: new Map(),
  model: { file: 'fixture.prefab' }, options: {}, nodeId: 0, componentId: '42',
  ensureLayoutScript: () => 'adapter-id',
  reporter: { high: (...a) => entries.push(['high', ...a]), low: (...a) => entries.push(['low', ...a]) }, entries,
  builder: { objects, addComponent(n, type, props) { objects.push({ __type__: type, ...props }); return objects.length - 1; } } };
}

test('HeartBG maps centered spacing and late LayoutElement.ignoreLayout without package source', () => {
  const c = fixture({ m_ChildAlignment: 4, m_Spacing: -2.89 });
  assert.equal(emitUnityLayout(c), true);
  emitUnityLayout({ ...c, nodeId: 1, doc: { m_IgnoreLayout: 1 }, componentId: '43' });
  finalizeUnityLayouts(c.builder);
  assert.deepEqual(c.builder.objects[2].ignoredNodes, [{ __id__: 1 }]);
  assert.equal(c.builder.objects[2].alignment, 4);
  assert.equal(c.builder.objects[2].spacing, -2.89);
  assert.equal(c.entries.some(e => e[0] === 'high'), false);
});

test('disabled layout keeps authored positions and unsupported control sizing is high even in skip mode', () => {
  const disabled = fixture({ m_Enabled: 0 }); emitUnityLayout(disabled);
  assert.equal(disabled.builder.objects.length, 2);
  const controlled = fixture({ m_ChildControlWidth: 1 }); controlled.options.scriptMode = 'skip';
  emitUnityLayout(controlled);
  assert.equal(controlled.entries[0][1], 'UI_LAYOUT_UNSUPPORTED');
  assert.equal(controlled.entries[0][0], 'high');
});

test('sliced/tiled preserveAspect never shrinks the RectTransform; simple keeps existing behavior', () => {
  for (const type of [0, 1, 2, 3]) {
    const b = new CocosPrefabBuilder('frame', {}, {}, {});
    const n = b.addNode('frame', null, null, 0, true, 'node');
    b.addUiTransform(n, 'rect', 284, 144, { x: .5, y: 0 }, 'rect');
    let aspectCalls = 0; b.applyPreserveAspectSize = () => { aspectCalls++; };
    const p = createScriptPorter({ getField: field, hasField: has, unityRefGuid: () => '',
      isUnityTextEffect: () => false });
    p.emitMonoBehaviour(n, 'image', { m_Sprite: {}, m_Type: type, m_PreserveAspect: 1 },
      { file: 'fixture' }, b, { low() {}, medium() {} }, {}, new Map(), {}, {});
    assert.equal(aspectCalls, type === 0 || type === 3 ? 1 : 0);
    const sprite = b.objects.find(o => o.__type__ === 'cc.Sprite');
    assert.equal(sprite._type, type); assert.equal(sprite._sizeMode, 0);
    assert.equal(b.objects[b.uiTransformByNode.get(n)]._contentSize.width, 284);
  }
});

class UITransform {}
const moduleObject = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, 'runtime/UnityFixedLayoutGroup.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { experimentalDecorators: true,
  target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(compiled, { exports: moduleObject.exports, module: moduleObject,
  require: () => ({ Component: class {}, Node: class {}, UITransform, _decorator: {
    ccclass: () => c => c, executeInEditMode: c => c,
    property: (...args) => args.length >= 2 ? undefined : () => {},
  } }) });
const Adapter = moduleObject.exports.UnityFixedLayoutGroup;
function node(width, height, anchorX = .5, anchorY = .5) {
  return { active: true, children: [], scale: { x: 1, y: 1 }, position: { x: 0, y: 0, z: 7 },
    rect: { width, height, anchorX, anchorY }, getComponent() { return this.rect; },
    setPosition(x, y, z) { this.position = { x, y, z }; } };
}
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-7, `${value} != ${expected}`);

test('runtime HeartBG aligns all three top-left pivot slots, relayouts on activation and resizing', () => {
  const a = new Adapter(); a.node = node(200, 80); a.alignment = 4; a.spacing = -2.89;
  a.node.children = [node(61, 55, 0, 1), node(61, 55, 0, 1), node(61, 55, 0, 1)];
  a.layout();
  a.node.children.forEach((n, i) => { near(n.position.x, [-88.61, -30.5, 27.61][i]); near(n.position.y, 27.5); assert.equal(n.position.z, 7); });
  a.node.children[1].active = false; a.layout(); near(a.node.children[0].position.x, -59.555);
  a.node.rect.width = 400; a.layout(); near(a.node.children[0].position.x, -59.555);
  a.ignoredNodes = [a.node.children[2]]; a.layout(); near(a.node.children[0].position.x, -30.5);
});

test('vertical reverse, asymmetric padding, scale and noncentral pivots match UGUI axis equations', () => {
  const a = new Adapter(); a.node = node(200, 300, 0, 1); a.vertical = true;
  a.alignment = 8; a.reverse = true; a.paddingLeft = 10; a.paddingRight = 20;
  a.paddingTop = 30; a.paddingBottom = 40; a.spacing = 5; a.useScaleWidth = a.useScaleHeight = true;
  const first = node(40, 20, 0, 1), second = node(30, 50, 1, 0); second.scale = { x: 2, y: 2 };
  a.node.children = [first, second]; a.layout();
  near(second.position.x, 180); near(second.position.y, -235);
  near(first.position.x, 140); near(first.position.y, -240);
});

test('main-axis overflow starts at padding rather than recentering outside the parent', () => {
  const a = new Adapter(); a.node = node(50, 80); a.alignment = 4;
  a.node.children = [node(60, 20), node(60, 20)]; a.layout();
  near(a.node.children[0].position.x, 5); near(a.node.children[1].position.x, 65);
});

test('adapter output matches the tested template and dry-run creates no files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-layout-porter-'));
  try {
    const p = createRuntimePorter({ ensureDirectoryMetas() {} });
    const db = { root, findScriptClass() { return null; } };
    const reporter = { low() {}, medium() {}, high() {} };
    const dryId = p.ensureUiLayoutScript({ cocosRoot: root, dryRun: true }, reporter, db);
    assert.equal(fs.readdirSync(root).length, 0);
    const id = p.ensureUiLayoutScript({ cocosRoot: root }, reporter, db);
    assert.equal(id, dryId);
    const output = path.join(root, 'assets/script/UnityFixedLayoutGroup.ts');
    assert.equal(fs.readFileSync(output, 'utf8'), source);
    const meta = fs.readFileSync(output + '.meta', 'utf8');
    p.ensureUiLayoutScript({ cocosRoot: root }, reporter, db);
    assert.equal(fs.readFileSync(output + '.meta', 'utf8'), meta);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('ui-layout-porter-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
