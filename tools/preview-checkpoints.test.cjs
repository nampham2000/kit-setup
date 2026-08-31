'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  slugify, normalizeWindowSize, resolveInsideProject, validateConfig, parseArgs, evaluateEvalAssertion,
  evaluateTraceAssertion, evaluateMetricAssertion, calculateScreenshotMetrics,
  calculateReferenceMetrics, findForegroundBounds,
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
      { name: 'rapid taps', gestures: ['0.2,0.4,0.2,0.4,30,1', '0.8,0.5,0.8,0.5,30,1'],
        gestureGapMs: 50 },
    ],
  });
  assert.equal(value.cases.length, 4);
  assert.equal(value.cases[1].parsedGesture.steps, 12);
  assert.equal(value.cases[1].previewDevice, 'WebpageFullScreen');
  assert.equal(value.cases[1].postActionSeconds, 3);
  assert.equal(value.postActionSeconds, 2);
  assert.equal(value.cases[2].gestureKeepPressed, true);
  assert.equal(value.cases[2].gestureHoldBeforeMoveMs, 280);
  assert.equal(value.cases[3].parsedGestures.length, 2);
  assert.equal(value.cases[3].gestureGapMs, 50);
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
    url: 'http://localhost:7456', cases: [{ name: 'a', gesture: '0.5,0.5,0.5,0.5,30,1',
      gestures: ['0.2,0.2,0.2,0.2,30,1', '0.8,0.8,0.8,0.8,30,1'] }],
  }), /đồng thời/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', gestures: ['0.2,0.2,0.2,0.2,30,1'],
      gestureGapMs: 50 }],
  }), /2-8/);
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

test('screenshot metrics require a bounded normalized ROI and measure visible pixels', () => {
  const valid = validateConfig({
    url: 'http://localhost:7456',
    cases: [{
      name: 'visible vfx',
      screenshotRegion: { x: 0.5, y: 0.2, width: 0.1, height: 0.05 },
      screenshotMetricOptions: { brightLuminanceThreshold: 210 },
      requiredScreenshotMetrics: { brightPixelRatio: { min: 0.16, max: 0.32 } },
    }],
  });
  assert.deepEqual(valid.cases[0].screenshotRegion,
    { x: 0.5, y: 0.2, width: 0.1, height: 0.05 });
  assert.deepEqual(valid.cases[0].requiredScreenshotMetrics.brightPixelRatio,
    { min: 0.16, max: 0.32 });
  const pixels = Buffer.from([
    255, 255, 255,
    0, 0, 0,
    220, 220, 220,
    100, 50, 0,
  ]);
  const measured = calculateScreenshotMetrics(pixels, 3, 210);
  assert.equal(measured.brightPixelRatio, 0.5);
  assert.ok(measured.meanLuminance > 100 && measured.meanLuminance < 180);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'missing roi', requiredScreenshotMetrics: { brightPixelRatio: { min: 0.2 } } }],
  }), /screenshotRegion/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'bad roi', screenshotRegion: { x: 0.95, y: 0, width: 0.1, height: 1 },
      requiredScreenshotMetrics: { meanLuminance: { min: 1 } } }],
  }), /bounds/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'unknown pixel metric', screenshotRegion: { x: 0, y: 0, width: 1, height: 1 },
      requiredScreenshotMetrics: { magicPixels: { min: 1 } } }],
  }), /không hỗ trợ metric/);
});

test('Unity reference metrics are explicit, bounded, and never inferred from a contact sheet', () => {
  const valid = validateConfig({
    url: 'http://localhost:7456',
    cases: [{
      name: 'holder material parity',
      referenceImage: 'docs/tape-jam/references/unity-yellow-holder-roll.png',
      screenshotRegion: { x: 0.05, y: 0.02, width: 0.3, height: 0.18 },
      requiredReferenceMetrics: {
        foregroundRgbSimilarity: { min: 0.9 },
        foregroundIou: { min: 0.8 },
      },
      referenceMetricOptions: { autoTrimForeground: true, backgroundDistanceThreshold: 20 },
    }],
  });
  assert.deepEqual(valid.cases[0].referenceRegion, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(valid.cases[0].requiredReferenceMetrics.foregroundRgbSimilarity, { min: 0.9 });
  assert.equal(valid.cases[0].referenceMetricOptions.autoTrimForeground, true);
  assert.equal(valid.cases[0].referenceMetricOptions.backgroundDistanceThreshold, 20);

  const reference = Buffer.from([10, 20, 30, 100, 120, 140]);
  const exact = calculateReferenceMetrics(Buffer.from(reference), reference);
  assert.equal(exact.rgbSimilarity, 1);
  assert.equal(exact.luminanceSimilarity, 1);
  assert.equal(exact.meanAbsoluteError, 0);
  assert.equal(exact.rmse, 0);
  assert.equal(exact.meanLuminanceDelta, 0);
  const shifted = calculateReferenceMetrics(Buffer.from([30, 40, 50, 120, 140, 160]), reference);
  assert.ok(shifted.rgbSimilarity < 1 && shifted.rgbSimilarity > 0.9);
  assert.ok(shifted.meanLuminanceDelta > 19 && shifted.meanLuminanceDelta < 21);

  const candidate = Buffer.from([10, 10, 10, 240, 180, 20]);
  const referenceWithDifferentBackground = Buffer.from([60, 70, 80, 238, 178, 18]);
  const foreground = calculateReferenceMetrics(candidate, referenceWithDifferentBackground, 3, {
    candidateBackground: [10, 10, 10],
    referenceBackground: [60, 70, 80],
    backgroundDistanceThreshold: 20,
  });
  assert.equal(foreground.foregroundIou, 1);
  assert.ok(foreground.foregroundRgbSimilarity > 0.99);
  const centerObject = Buffer.from([
    10,10,10, 10,10,10, 10,10,10,
    10,10,10, 240,180,20, 10,10,10,
    10,10,10, 10,10,10, 10,10,10,
  ]);
  assert.deepEqual(findForegroundBounds(centerObject, 3, 3, 3, 20), {
    left: 1, top: 1, width: 1, height: 1, background: [10, 10, 10],
  });

  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'missing reference', screenshotRegion: { x: 0, y: 0, width: 1, height: 1 },
      requiredReferenceMetrics: { rgbSimilarity: { min: 0.9 } } }],
  }), /referenceImage/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'unknown reference metric', referenceImage: 'docs/ref.png',
      screenshotRegion: { x: 0, y: 0, width: 1, height: 1 },
      requiredReferenceMetrics: { ssimMagic: { min: 0.9 } } }],
  }), /không hỗ trợ metric/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456',
    cases: [{ name: 'bad trim threshold', referenceImage: 'docs/ref.png',
      screenshotRegion: { x: 0, y: 0, width: 1, height: 1 },
      requiredReferenceMetrics: { foregroundIou: { min: 0.8 } },
      referenceMetricOptions: { autoTrimForeground: true, backgroundDistanceThreshold: 0 } }],
  }), /1-441/);
  assert.throws(() => calculateReferenceMetrics(Buffer.from([0, 0, 0]), Buffer.from([0, 0, 0, 0])),
    /identical/);
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
