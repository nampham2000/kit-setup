'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SUMMARY_MAX_BYTES,
  PAGE_MAX_BYTES,
  DEFAULT_PAGE_SIZE,
  jsonBytes,
  createCompactPage,
  createCompactSummary,
  decodeCursor,
  sanitizeForProjection,
} = require('./compact-projection.cjs');

function largeSnapshot() {
  const records = Array.from({ length: 260 }, (_, index) => ({
    guid: index.toString(16).padStart(32, '0'),
    assetPath: `Assets/Game/Prefab_${String(index).padStart(3, '0')}.prefab`,
    type: 'prefab',
    sourceText: `public class Secret${index} {}`,
    accessToken: `token-${index}`,
    physicalPath: `C:\\Users\\Admin\\Unity\\Prefab_${index}.prefab`,
    details: 'x'.repeat(500),
  }));
  return {
    schemaVersion: 1,
    provider: 'hybrid',
    fingerprint: 'f'.repeat(64),
    live: { scanId: 'scan-page-1' },
    project: {
      name: 'LargeGame', unityVersion: '6000.0.66f2',
      packages: {
        ...Object.fromEntries(Array.from({ length: 99 }, (_, index) => [`com.example.package${index}`, `1.0.${index}`])),
        'com.example.local': 'file:D:/private/local-package',
      },
    },
    inventory: { prefabs: records.length, scenes: 1, scripts: 20 },
    buildScenes: Array.from({ length: 50 }, (_, index) => ({
      enabled: true, path: `Assets/Scenes/Scene_${index}.unity`, guid: index.toString(16).padStart(32, 'a'),
    })),
    assets: { records },
    dependencies: { edgeCount: 0, edges: [], unresolvedCount: 0, unresolved: [], classificationCounts: {} },
    features: { sketch: Array.from({ length: 40 }, (_, index) => ({
      id: `feature-${index}`, label: 'Feature '.repeat(30), evidence: records.slice(index, index + 5),
    })) },
    diagnostics: Array.from({ length: 80 }, (_, index) => ({
      code: `UNITY_${index}`, severity: index % 3 === 0 ? 'high' : 'medium',
      message: `Broken at C:\\Users\\Admin\\Unity\\file${index}.cs ${'m'.repeat(300)}`,
      action: 'Inspect', evidence: [`Assets/Game/Prefab_${index}.prefab`],
    })),
    scriptIndex: { scripts: [] },
  };
}

test('summary is deterministic, safe and always within 24 KiB', () => {
  const snapshot = largeSnapshot();
  const summary = createCompactSummary(snapshot);
  assert.deepEqual(summary, createCompactSummary(snapshot));
  assert.ok(jsonBytes(summary) <= SUMMARY_MAX_BYTES);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /C:\\\\Users|D:\/private|token-\d+|public class Secret/);
  assert.ok(summary.truncated.packages > 0);
  assert.ok(summary.truncated.diagnostics > 0);
});

test('projection keeps safe loopback URLs while redacting Windows paths', () => {
  assert.deepEqual(sanitizeForProjection({
    endpoint: 'http://127.0.0.1:23456',
    source: 'Open C:\\Users\\Porter\\UnityProject before scanning',
  }), {
    endpoint: 'http://127.0.0.1:23456',
    source: 'Open [redacted:absolute-path]',
  });
});

test('paged projection defaults to 50, caps at 48 KiB and validates opaque cursor identity', () => {
  const snapshot = largeSnapshot();
  const first = createCompactPage(snapshot, { section: 'assets', query: { scope: 'runtime' } });
  assert.equal(first.count, DEFAULT_PAGE_SIZE);
  assert.equal(first.total, 260);
  assert.ok(first.nextCursor);
  assert.ok(jsonBytes(first) <= PAGE_MAX_BYTES);
  assert.doesNotMatch(JSON.stringify(first), /sourceText|accessToken|C:\\\\Users|token-\d+/);

  const decoded = decodeCursor(first.nextCursor, {
    scanId: 'scan-page-1', section: 'assets', query: { scope: 'runtime' },
  });
  assert.equal(decoded.scanId, 'scan-page-1');
  const second = createCompactPage(snapshot, {
    section: 'assets', query: { scope: 'runtime' }, cursor: first.nextCursor,
  });
  assert.notEqual(first.items[0].guid, second.items[0].guid);
  assert.throws(() => createCompactPage(snapshot, {
    section: 'assets', query: { scope: 'vendor' }, cursor: first.nextCursor,
  }), error => error && error.code === 'UNITY_CURSOR_QUERY_MISMATCH');
  assert.throws(() => decodeCursor(first.nextCursor, {
    scanId: 'other-scan', section: 'assets', query: { scope: 'runtime' },
  }), error => error && error.code === 'UNITY_CURSOR_STALE');
  assert.throws(() => createCompactPage(snapshot, { section: 'assets', pageSize: 201 }),
    error => error && error.code === 'UNITY_PAGE_SIZE_INVALID');
});

test('oversized items become advancing placeholders without exceeding requested byte bound', () => {
  const snapshot = largeSnapshot();
  const page = createCompactPage(snapshot, {
    section: 'assets',
    items: [{
      id: 'huge',
      details: Array.from({ length: 100 }, (_, index) => `${index}-${'z'.repeat(1000)}`),
      sourceText: 'never emit',
    }],
    maxBytes: 1200,
  });
  assert.ok(jsonBytes(page) <= 1200);
  assert.equal(page.items[0].truncated, true);
  assert.doesNotMatch(JSON.stringify(page), /never emit|z{100}/);
});

test('identical duplicate items still advance with stable distinct cursor positions', () => {
  const snapshot = largeSnapshot();
  const duplicate = { id: 'same', type: 'prefab' };
  const first = createCompactPage(snapshot, {
    section: 'assets', items: [duplicate, duplicate, duplicate], pageSize: 1,
  });
  const second = createCompactPage(snapshot, {
    section: 'assets', items: [duplicate, duplicate, duplicate], pageSize: 1, cursor: first.nextCursor,
  });
  const third = createCompactPage(snapshot, {
    section: 'assets', items: [duplicate, duplicate, duplicate], pageSize: 1, cursor: second.nextCursor,
  });
  assert.equal(first.count, 1);
  assert.equal(second.count, 1);
  assert.equal(third.count, 1);
  assert.equal(third.nextCursor, null);
});
