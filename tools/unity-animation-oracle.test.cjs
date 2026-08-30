'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const TOOL = path.resolve(__dirname, 'unity-animation-oracle.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-animation-oracle-'));
  const assets = path.join(root, 'Assets');
  const file = path.join(assets, 'Animations', 'AxisProbe.anim');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: AxisProbe
  serializedVersion: 7
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: {x: 0, y: 5, z: -1}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
        weightedMode: 0
        inWeight: {x: 0, y: 0, z: 0}
        outWeight: {x: 0, y: 0, z: 0}
      - serializedVersion: 3
        time: 0.25
        value: {x: 0, y: 0, z: 0}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
        weightedMode: 0
        inWeight: {x: 0, y: 0, z: 0}
        outWeight: {x: 0, y: 0, z: 0}
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    path: Lid
  m_ScaleCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: {x: 1, y: 1, z: 1}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
        weightedMode: 0
        inWeight: {x: 0, y: 0, z: 0}
        outWeight: {x: 0, y: 0, z: 0}
      - serializedVersion: 3
        time: 0.16666667
        value: {x: 1, y: 0.7, z: 1}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
        weightedMode: 0
        inWeight: {x: 0, y: 0, z: 0}
        outWeight: {x: 0, y: 0, z: 0}
      - serializedVersion: 3
        time: 0.25
        value: {x: 1, y: 1, z: 1}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
        weightedMode: 0
        inWeight: {x: 0, y: 0, z: 0}
        outWeight: {x: 0, y: 0, z: 0}
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    path: Body
  m_FloatCurves: []
  m_PPtrCurves: []
  m_SampleRate: 60
  m_AnimationClipSettings:
    serializedVersion: 2
    m_LoopTime: 0
    m_StopTime: 0.25
`, 'utf8');
  return { root, assets, file };
}

test('emits exact animated axis, Hermite tangents, loop state and Cocos handedness', () => {
  const data = fixture();
  const result = spawnSync(process.execPath, [TOOL, '--src', data.file, '--unity-root', data.root], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const oracle = JSON.parse(result.stdout);
  assert.equal(oracle.kind, 'unity-animation-curve-oracle');
  assert.equal(oracle.clipCount, 1);
  assert.equal(oracle.clips[0].source, 'Assets/Animations/AxisProbe.anim');
  assert.equal(oracle.clips[0].duration, 0.25);
  assert.equal(oracle.clips[0].loop, false);
  assert.equal(oracle.completeness, 'complete');
  assert.equal(oracle.clips[0].completeness, 'complete');
  const scale = oracle.clips[0].tracks.find(track => track.path === 'Body' && track.property === 'scale');
  assert.deepEqual(scale.animatedChannels, ['y']);
  assert.deepEqual(scale.channels.y.map(key => key.value), [1, 0.7, 1]);
  assert.deepEqual(scale.channels.x.map(key => key.value), [1, 1, 1]);
  assert.equal(scale.channels.y[1].inSlope, 0);
  assert.equal(scale.channels.y[1].outSlope, 0);
  const position = oracle.clips[0].tracks.find(track => track.path === 'Lid' && track.property === 'position');
  assert.equal(position.channels.z[0].value, 1);
  assert.deepEqual(position.animatedChannels, ['y', 'z']);
});

test('writes deterministic oracle output atomically and returns a compact receipt', () => {
  const data = fixture();
  const out = path.join(data.root, 'docs', 'oracle.json');
  const args = [TOOL, '--src', data.assets, '--unity-root', data.root, '--out', out, '--compact'];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const firstReceipt = JSON.parse(first.stdout);
  const firstBytes = fs.readFileSync(out, 'utf8');
  const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  const secondReceipt = JSON.parse(second.stdout);
  assert.equal(fs.readFileSync(out, 'utf8'), firstBytes);
  assert.equal(secondReceipt.sha256, firstReceipt.sha256);
  assert.equal(secondReceipt.clipCount, 1);
  assert.equal(fs.existsSync(`${out}.${process.pid}.tmp`), false);
});

test('fails closed for unknown arguments and clip-count overflow', () => {
  const data = fixture();
  let result = spawnSync(process.execPath, [TOOL, '--src', data.file, '--wat'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ANIMATION_ORACLE_ARGS/);
  result = spawnSync(process.execPath, [TOOL, '--src', data.file, '--max-clips', '0'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ANIMATION_ORACLE_ARGS/);
});

test('writes a partial oracle but exits non-zero when source curves are unsupported', () => {
  const data = fixture();
  const source = fs.readFileSync(data.file, 'utf8').replace(
    '  m_RotationCurves: []',
    '  m_RotationCurves:\n  - curve: {}\n    path: Body',
  );
  fs.writeFileSync(data.file, source, 'utf8');
  const result = spawnSync(process.execPath, [TOOL, '--src', data.file, '--unity-root', data.root], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  const oracle = JSON.parse(result.stdout);
  assert.equal(oracle.completeness, 'partial');
  assert.equal(oracle.clips[0].completeness, 'partial');
  assert.equal(oracle.diagnostics.some(item =>
    item.severity === 'high' && item.code === 'ANIMATION_ROTATION_CURVE_SKIPPED'), true);
});

test('fails closed when Unity animation events would otherwise disappear from the oracle', () => {
  const data = fixture();
  const source = fs.readFileSync(data.file, 'utf8').replace(
    '  m_AnimationClipSettings:',
    '  m_Events:\n  - time: 0.1\n    functionName: PlayCloudCircle\n  m_AnimationClipSettings:',
  );
  fs.writeFileSync(data.file, source, 'utf8');
  const result = spawnSync(process.execPath, [TOOL, '--src', data.file, '--unity-root', data.root], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  const oracle = JSON.parse(result.stdout);
  assert.equal(oracle.completeness, 'partial');
  assert.equal(oracle.diagnostics.some(item =>
    item.severity === 'high' && item.code === 'ANIMATION_EVENT_SKIPPED'), true);
});
