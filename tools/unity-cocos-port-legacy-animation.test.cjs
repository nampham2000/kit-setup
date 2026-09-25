'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CocosPrefabBuilder,
  emitLegacyAnimation,
  parseUnityAnimationClip,
  parseUnityYaml,
} = require('./unity-cocos-port.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-animation-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

const reports = () => {
  const entries = [];
  return { entries, ...Object.fromEntries(['high', 'medium', 'low'].map((level) => [level, (...args) => entries.push({ level, code: args[0] })])) };
};

function key(time, value) {
  return `      - serializedVersion: 3
        time: ${time}
        value: {x: ${value[0]}, y: ${value[1]}, z: ${value[2]}}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
        tangentMode: 0
        weightedMode: 0
        inWeight: {x: 0.33333334, y: 0.33333334, z: 0.33333334}
        outWeight: {x: 0.33333334, y: 0.33333334, z: 0.33333334}`;
}

// ARPG Effects Demo/Animation/ChestOpen.anim: a legacy (Animation component) lid
// hinge, Euler (0, 90, z(t)) in Unity ZXY order, looping every 4 s.
function writeClip(name, eulerKeys, { legacy = 1, wrap = 2, loopTime = 1, order = 4 } = {}) {
  const file = path.join(temp, `${name}.anim`);
  fs.writeFileSync(file, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_Name: ${name}
  serializedVersion: 7
  m_Legacy: ${legacy}
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
${eulerKeys.map(([t, v]) => key(t, v)).join('\n')}
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: ${order}
    path:
  m_PositionCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
${key(0, [0, 0.267, 0.2])}
${key(4, [0, 0.267, 0.2])}
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    path:
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves: []
  m_SampleRate: 60
  m_WrapMode: ${wrap}
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_StartTime: 0
    m_StopTime: 4
    m_LoopTime: ${loopTime}
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`);
  return file;
}

const LID = [[0, [0, 90.00001, -88.582]], [2.2, [0, 90.00001, 31.418001]], [4, [0, 90.00001, -88.582]]];

function channelValues(track, index) {
  return track._channels[index]._curve._values.map((value) => value.value);
}

test('Euler keys follow the Z reflection: X and Y angles negate, Z stays', () => {
  const reporter = reports();
  const clip = parseUnityAnimationClip(writeClip('ChestOpen', LID), reporter);
  const euler = clip._tracks.find((track) => track._binding.path._paths.at(-1) === 'eulerAngles');
  assert.deepEqual(channelValues(euler, 1), [-90.00001, -90.00001, -90.00001]);
  assert.deepEqual(channelValues(euler, 2), [-88.582, 31.418001, -88.582]);
  const position = clip._tracks.find((track) => track._binding.path._paths.at(-1) === 'position');
  assert.deepEqual(channelValues(position, 2), [-0.2, -0.2]);
  // The mapped pose equals the Z-reflected Unity rotation (0.4938, -0.5061, -0.4938, 0.5061).
  const rad = Math.PI / 360;
  const [x, y, z] = [0, -90.00001 * rad, -88.582 * rad];
  const q = { // Cocos Quat.fromEuler
    x: Math.sin(x) * Math.cos(y) * Math.cos(z) + Math.cos(x) * Math.sin(y) * Math.sin(z),
    y: Math.cos(x) * Math.sin(y) * Math.cos(z) + Math.sin(x) * Math.cos(y) * Math.sin(z),
    z: Math.cos(x) * Math.cos(y) * Math.sin(z) - Math.sin(x) * Math.sin(y) * Math.cos(z),
    w: Math.cos(x) * Math.cos(y) * Math.cos(z) - Math.sin(x) * Math.sin(y) * Math.sin(z),
  };
  for (const [actual, expected] of [[q.x, 0.4938], [q.y, -0.5061], [q.z, -0.4938], [q.w, 0.5061]]) {
    assert.ok(Math.abs(actual - expected) < 2e-4, `${actual} != ${expected}`);
  }
  assert.equal(reporter.entries.filter((entry) => entry.level === 'high').length, 0);
  assert.equal(clip.wrapMode, 2);
});

test('Euler tracks whose ZXY and YZX compositions differ are reported', () => {
  const reporter = reports();
  parseUnityAnimationClip(writeClip('Tumble', [[0, [10, 20, 0]], [1, [30, 20, 5]]], { legacy: 0 }), reporter);
  assert.deepEqual(reporter.entries.filter((entry) => entry.level === 'high').map((entry) => entry.code), ['ANIMATION_EULER_ORDER_UNSUPPORTED']);
  const pure = reports();
  parseUnityAnimationClip(writeClip('Spin', [[0, [0, 0, 0]], [1, [90, 0, 0]]], { legacy: 0 }), pure);
  assert.equal(pure.entries.filter((entry) => entry.level === 'high').length, 0);
});

test('legacy clip WrapMode maps when LoopTime is off', () => {
  const once = parseUnityAnimationClip(writeClip('Once', LID, { wrap: 1, loopTime: 0 }), reports());
  const loop = parseUnityAnimationClip(writeClip('Loop', LID, { wrap: 2, loopTime: 0 }), reports());
  const pingPong = parseUnityAnimationClip(writeClip('PingPong', LID, { wrap: 4, loopTime: 0 }), reports());
  const generic = parseUnityAnimationClip(writeClip('Generic', LID, { legacy: 0, wrap: 2, loopTime: 0 }), reports());
  assert.deepEqual([once.wrapMode, loop.wrapMode, pingPong.wrapMode, generic.wrapMode], [1, 2, 22, 1]);
});

test('legacy Animation component becomes cc.Animation that plays its default clip on load', () => {
  const clipFile = writeClip('ChestOpen', LID);
  const clipAsset = { guid: '199fecccda9a4bc458e770b4e6611592', path: clipFile, ext: '.anim', stem: 'ChestOpen', relativePath: 'Assets/Demo/Animation/ChestOpen.anim' };
  const scene = path.join(temp, 'Scene.unity');
  fs.writeFileSync(scene, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!111 &23018261
Animation:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: 23018258}
  m_Enabled: 1
  serializedVersion: 3
  m_Animation: {fileID: 7400000, guid: 199fecccda9a4bc458e770b4e6611592, type: 2}
  m_Animations:
  - {fileID: 7400000, guid: 199fecccda9a4bc458e770b4e6611592, type: 2}
  m_WrapMode: 0
  m_PlayAutomatically: 1
  m_AnimatePhysics: 0
  m_CullingType: 0
`);
  const doc = parseUnityYaml(scene).find((entry) => Number(entry.classId) === 111);
  const cocosRoot = path.join(temp, 'cocos');
  fs.mkdirSync(path.join(cocosRoot, 'assets'), { recursive: true });
  const builder = new CocosPrefabBuilder('Lid');
  const nodeId = builder.addNode('Lid', null, {
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 }, euler: { x: 0, y: 0, z: 0 },
  }, 1, true, 'node-lid');
  const reporter = reports();
  const unityDb = { get: (guid) => (guid === clipAsset.guid ? clipAsset : null) };
  const id = emitLegacyAnimation(nodeId, '23018261', doc, builder, reporter, { cocosRoot, dryRun: false }, unityDb, null, { name: 'Lid' }, null);
  const component = builder.objects[id];
  assert.equal(component.__type__, 'cc.Animation');
  assert.equal(component.playOnLoad, true);
  assert.equal(component._clips.length, 1);
  assert.deepEqual(component._defaultClip, component._clips[0]);
  assert.ok(fs.existsSync(path.join(cocosRoot, 'assets/animations/chestopen/ChestOpen.anim')));
  assert.deepEqual(reporter.entries.map((entry) => entry.code), ['ANIMATION_CLIP_CONVERTED', 'LEGACY_ANIMATION_PORTED']);
});
