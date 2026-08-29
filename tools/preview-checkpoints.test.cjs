'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  slugify, normalizeWindowSize, resolveInsideProject, validateConfig, parseArgs, evaluateEvalAssertion,
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
    cases: [
      { name: 'baseline' },
      { name: 'vertical drag', previewDevice: 'WebpageFullScreen', gesture: '0.5,0.7,0.5,0.3,400,12' },
      { name: 'hold block', gesture: '0.5,0.5,0.5,0.5,300,8', gestureKeepPressed: true },
    ],
  });
  assert.equal(value.cases.length, 3);
  assert.equal(value.cases[1].parsedGesture.steps, 12);
  assert.equal(value.cases[1].previewDevice, 'WebpageFullScreen');
  assert.equal(value.cases[2].gestureKeepPressed, true);
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
    url: 'http://localhost:7456', previewDevice: 42, cases: [{ name: 'a' }],
  }), /previewDevice/);
  assert.throws(() => validateConfig({
    url: 'http://localhost:7456', cases: [{ name: 'a', previewDevice: '' }],
  }), /previewDevice/);
});

test('optional semantic eval assertion fails closed on a bad oracle', () => {
  assert.deepEqual(evaluateEvalAssertion(false, undefined), { required: false, ok: true });
  assert.equal(evaluateEvalAssertion(true, '{"ok":true}').ok, true);
  assert.equal(evaluateEvalAssertion(true, true).ok, true);
  assert.equal(evaluateEvalAssertion(true, '{"ok":false,"reason":"wrong direction"}').ok, false);
  assert.match(evaluateEvalAssertion(true, 'not-json').reason, /not JSON/);
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
