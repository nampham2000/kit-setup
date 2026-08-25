'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { createUnityLiveSnapshotPatch } = require('./live-schema.cjs');
const {
  BATCH_CANDIDATE_FILE,
  BATCH_METHOD,
  MAX_BATCH_CANDIDATE_BYTES,
  MAX_BATCH_RESULT_BYTES,
  buildUnityBatchInvocation,
  parseBatchResult,
  runUnityBatchScan,
  waitForChild,
  writeBatchCandidateRequest,
} = require('./unity-batch-provider.cjs');

test('batch invocation is non-interactive, externalizes logs, and passes scan identity through env', () => {
  const invocation = buildUnityBatchInvocation({
    editorExe: 'D:/Unity/Editor/Unity.exe',
    projectRoot: 'D:/Games/Test',
    outputFile: 'D:/Temp/result.json',
    logFile: 'D:/Temp/unity.log',
    upmLogFile: 'D:/Temp/upm.log',
    projectFingerprint: 'a'.repeat(64),
    unresolvedGuids: ['b'.repeat(32)],
    serializedAssetPaths: ['Assets/Game/Binary.asset'],
  });
  assert.ok(invocation.args.includes('-batchmode'));
  assert.ok(invocation.args.includes('-nographics'));
  assert.ok(invocation.args.includes('-quit'));
  assert.equal(invocation.args[invocation.args.indexOf('-executeMethod') + 1], BATCH_METHOD);
  assert.equal(invocation.env.CC_PLAYABLE_UNITY_PROJECT_FINGERPRINT, 'a'.repeat(64));
  assert.equal(invocation.env.CC_PLAYABLE_UNITY_UNRESOLVED_GUIDS, undefined);
  assert.equal(invocation.env.CC_PLAYABLE_UNITY_SERIALIZED_ASSETS, undefined);
  assert.match(invocation.env.CC_PLAYABLE_UNITY_SCAN_OUTPUT, /result\.json$/i);
  const addedEnvironmentBytes = Object.entries(invocation.env)
    .filter(([key]) => key.startsWith('CC_PLAYABLE_UNITY_'))
    .reduce((total, [key, value]) => total + key.length + String(value).length + 2, 0);
  assert.ok(addedEnvironmentBytes < 1024);
});

test('maximum UTF-8 candidate lists round-trip through a bounded file instead of the Windows environment block', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-batch-candidates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unresolvedGuids = Array.from({ length: 512 }, (_, index) => index.toString(16).padStart(32, '0'));
  const serializedAssetPaths = Array.from({ length: 96 }, (_, index) =>
    `Assets/${String(index).padStart(2, '0')}-${'界'.repeat(300)}.asset`);
  const written = writeBatchCandidateRequest(path.join(root, BATCH_CANDIDATE_FILE), {
    unresolvedGuids,
    serializedAssetPaths,
  });
  assert.ok(written.bytes <= MAX_BATCH_CANDIDATE_BYTES);
  assert.ok(written.bytes > 64 * 1024, 'regression must exceed the previous ASCII-only file cap');
  assert.equal(written.request.unresolvedGuids.length, 512);
  assert.equal(written.request.serializedAssetPaths.length, 96);
  assert.deepEqual(JSON.parse(fs.readFileSync(written.file, 'utf8')), written.request);
});

test('batch result requires a valid live patch for the same static project fingerprint', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-batch-result-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resultPath = path.join(root, 'result.json');
  const fingerprint = 'b'.repeat(64);
  const patch = createUnityLiveSnapshotPatch({
    provider: 'unity-batch',
    projectFingerprint: fingerprint,
    scanId: 'test-scan',
    project: {},
  });
  fs.writeFileSync(resultPath, JSON.stringify(patch));
  assert.equal(parseBatchResult(resultPath, fingerprint).scanId, 'test-scan');
  assert.throws(() => parseBatchResult(resultPath, 'c'.repeat(64)), /projectFingerprint/);
});

test('missing marker is failure even when Unity itself might return exit code zero', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-batch-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => parseBatchResult(path.join(root, 'missing.json'), 'd'.repeat(64)), {
    code: 'UNITY_BATCH_RESULT_MISSING',
  });
});

test('oversized batch marker is rejected before unbounded JSON read', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-batch-oversized-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'result.json');
  fs.writeFileSync(file, Buffer.alloc(MAX_BATCH_RESULT_BYTES + 1, 0x20));
  assert.throws(() => parseBatchResult(file, 'e'.repeat(64)), { code: 'UNITY_BATCH_RESULT_TOO_LARGE' });
});

test('invalid marker keeps bounded failure artifacts for diagnosis', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-batch-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  let artifacts;
  const spawn = (_exe, _args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      fs.writeFileSync(options.env.CC_PLAYABLE_UNITY_SCAN_OUTPUT, '{invalid');
      child.emit('close', 0, null);
    });
    return child;
  };
  await assert.rejects(
    runUnityBatchScan({
      editorExe: path.join(project, 'Unity.exe'),
      projectRoot: project,
      projectFingerprint: 'f'.repeat(64),
      timeoutMs: 1000,
    }, { spawn }),
    error => {
      artifacts = error.artifacts;
      assert.equal(error.code, 'UNITY_BATCH_RESULT_INVALID');
      return true;
    },
  );
  assert.equal(fs.existsSync(artifacts), true);
  fs.rmSync(artifacts, { recursive: true, force: true });
});

test('timeout waits for owned child close and marks an unconfirmed process when close never arrives', async () => {
  const closing = new EventEmitter();
  closing.stdout = new PassThrough();
  closing.stderr = new PassThrough();
  closing.kill = () => { process.nextTick(() => closing.emit('close', null, 'SIGTERM')); return true; };
  await assert.rejects(waitForChild(closing, 5, { terminationGraceMs: 5 }), error => {
    assert.equal(error.code, 'UNITY_BATCH_TIMEOUT');
    assert.notEqual(error.processStillRunning, true);
    return true;
  });

  const stuck = new EventEmitter();
  stuck.stdout = new PassThrough();
  stuck.stderr = new PassThrough();
  stuck.kill = () => true;
  await assert.rejects(waitForChild(stuck, 5, { terminationGraceMs: 5 }), error => {
    assert.equal(error.processStillRunning, true);
    return true;
  });
});
