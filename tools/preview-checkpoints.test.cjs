'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  slugify, normalizeWindowSize, resolveInsideProject, validateConfig, parseArgs, evaluateEvalAssertion,
  evaluateTraceAssertion, evaluateMetricAssertion,
} = require('./preview-checkpoints.cjs');

test('normalizes names and window size deterministically', () => {
  assert.equal(slugify('Box Axis: Source'), 'box-axis-source');
  assert.equal(normalizeWindowSize('720x1280'), '720,1280');
  assert.equal(normalizeWindowSize('430,932'), '430,932');
});

test('validates isolated URL checkpoint cases and gestures', () => {
  const value = validateConfig({
    url: 'http://127.0.0.1:7456/',
    outputDir: '.unity/preview-checkpoints/test',
    postActionSeconds: 2,
    cases: [
      { name: 'baseline' },
      { name: 'vertical drag', previewDevice: 'WebpageFullScreen', gesture: '0.5,0.7,0.5,0.3,400,12', postActionSeconds: 3 },
      { name: 'hold block', gesture: '0.5,0.5,0.7,0.5,300,8', gestureHoldBeforeMoveMs: 280,
        gestureKeepPressed: true },
    ],
  });
  assert.equal(value.cases.length, 3);
  assert.equal(value.cases[1].parsedGesture.steps, 12);
  assert.equal(value.cases[1].previewDevice, 'WebpageFullScreen');
  assert.equal(value.cases[1].postActionSeconds, 3);
  assert.equal(value.postActionSeconds, 2);
  assert.equal(value.cases[2].gestureKeepPressed, true);
  assert.equal(value.cases[2].gestureHoldBeforeMoveMs, 280);
  assert.equal(value.windowSize, '720,1280');
});

test('fails closed on build/file targets, duplicate names and unknown options', () => {
  assert.throws(() => validateConfig({ url: 'build/common/index.html', cases: [{ name: 'a' }] }), /URL http/);
  assert.throws(() => validateConfig({ url: 'http://localhost:7456', cases: [{ name: 'A B' }, { name: 'a-b' }] }), /trùng tên/);
  assert.throws(() => parseArgs(['--build']), /không hỗ trợ/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', requireEvalOk: 'yes' }],
  }), /requireEvalOk/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', gestureKeepPressed: true }],
  }), /cần gesture/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', gestureHoldBeforeMoveMs: 300 }],
  }), /cần gesture/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', gesture: '0.5,0.5,0.7,0.5,300,8', gestureHoldBeforeMoveMs: 5001 }],
  }), /0-5000/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', previewDevice: 42, cases: [{ name: 'a' }],
  }), /previewDevice/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', previewDevice: '' }],
  }), /previewDevice/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', postActionSeconds: 61 }],
  }), /postActionSeconds/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', postActionSeconds: -1, cases: [{ name: 'a' }],
  }), /postActionSeconds/);
});

test('optional semantic eval assertion fails closed on a bad oracle', () => {
  assert.deepEqual(evaluateEvalAssertion(false, undefined), { required: false, ok: true });
  assert.equal(evaluateEvalAssertion(true, '{"ok":true}').ok, true);
  assert.equal(evaluateEvalAssertion(true, true).ok, true);
  assert.equal(evaluateEvalAssertion(true, '{"ok":false,"reason":"wrong direction"}').ok, false);
  assert.match(evaluateEvalAssertion(true, 'not-json').reason, /not JSON/);
});

test('ordered phase trace fails closed on missing, malformed or reordered animation phases', () => {
  const required = ['roll', 'pre-attach', 'snap', 'feedback', 'close'];
  const trace = required.map((phase, index) => ({ phase, atMs: index * 20 }));
  assert.equal(evaluateTraceAssertion(required, { ok: true, animationTrace: trace }).ok, true);
  assert.equal(evaluateTraceAssertion(required, { ok: true, trace: [trace[0], trace[2], trace[1], ...trace.slice(3)] }).ok, false);
  assert.match(evaluateTraceAssertion(required, { ok: true, trace: trace.slice(0, -1) }).reason, /close/);
  assert.match(evaluateTraceAssertion(required, { ok: true, trace: [{ phase: 'roll' }] }).reason, /atMs/);
  assert.deepEqual(evaluateTraceAssertion([], undefined), { required: false, ok: true });
});

test('required eval metrics enforce finite bounded semantic evidence', () => {
  const contract = {
    longitudinalUvSpan: { min: 0.9 },
    directionDot: { min: 0.97 },
    positionError: { max: 0.02 },
  };
  const valid = validateConfig({
    url: 'http://localhost:7456',
    cases: [{
      name: 'mesh peel',
      evalBefore: 'true',
      requireEvalBeforeOk: true,
      requiredEvalBeforeMetrics: { actionStarted: { min: 0, max: 0 } },
      eval: 'true',
      requireEvalOk: true,
      requiredEvalMetrics: contract,
    }],
  });
  assert.deepEqual(valid.cases[0].requiredEvalMetrics, contract);
  assert.deepEqual(valid.cases[0].requiredEvalBeforeMetrics, { actionStarted: { min: 0, max: 0 } });
  assert.equal(evaluateMetricAssertion(contract,
    '{"ok":true,"longitudinalUvSpan":1,"directionDot":0.999,"positionError":0}').ok, true);
  assert.match(evaluateMetricAssertion(contract,
    '{"ok":true,"longitudinalUvSpan":0.1,"directionDot":1,"positionError":0}').reason, /below min/);
  assert.match(evaluateMetricAssertion(contract,
    '{"ok":true,"longitudinalUvSpan":1,"directionDot":1}').reason, /positionError/);
  assert.match(evaluateMetricAssertion(contract,
    '{"ok":true,"longitudinalUvSpan":1,"directionDot":1,"positionError":null}').reason, /non-finite/);
  assert.match(evaluateMetricAssertion(contract,
    '{"ok":true,"longitudinalUvSpan":1,"directionDot":1,"positionError":"0"}').reason, /non-finite/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'bad metric', eval: 'true', requireEvalOk: true,
      requiredEvalMetrics: { positionError: { min: 1, max: 0 } } }],
  }), /range/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'missing precondition', requireEvalBeforeOk: true,
      requiredEvalBeforeMetrics: { actionStarted: { max: 0 } } }],
  }), /evalBefore/);
});

test('output/reference paths reject an intermediate symlink or junction', t => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const qaRoot = path.join(projectRoot, '.unity');
  fs.mkdirSync(qaRoot, { recursive: true });
  const link = fs.mkdtempSync(path.join(qaRoot, 'preview-checkpoints-link-'));
  t.after(() => {
    fs.rmSync(link, { recursive: true, force: true });
  });
  const originalLstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (candidate, ...args) => {
    if (path.resolve(String(candidate)) === link) return { isSymbolicLink: () => true };
    return originalLstat(candidate, ...args);
  });
  const relative = path.relative(projectRoot, path.join(link, 'manifest.json'));
  assert.throws(() => resolveInsideProject(relative, 'outputDir'), /symlink|junction/);
});
