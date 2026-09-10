'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const sync = require('./sync-shared-kit.cjs');

test('extension reconciliation removes stale artifacts and preserves node_modules', () => {
  const source = fs.mkdtempSync(path.join(sync.SHARED_EXTENSIONS_DIR, '.sync-test-source-'));
  const destination = fs.mkdtempSync(path.join(sync.TARGET_EXTENSIONS_DIR, '.sync-test-destination-'));
  try {
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(source, 'dist', 'current.js'), 'current');
    fs.mkdirSync(path.join(destination, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'dist', 'current.js'), 'old');
    fs.writeFileSync(path.join(destination, 'dist', 'stale.js'), 'stale');
    fs.mkdirSync(path.join(destination, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'node_modules', 'keep.txt'), 'keep');

    const result = sync.reconcileDestinationWithSource(source, destination);

    assert.deepEqual(result.removed, ['dist/stale.js']);
    assert.equal(fs.existsSync(path.join(destination, 'dist', 'stale.js')), false);
    assert.equal(fs.readFileSync(path.join(destination, 'node_modules', 'keep.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('node gates can resolve dependencies installed in the synced extension', () => {
  const existing = fs.mkdtempSync(path.join(sync.SHARED_KIT_ROOT, '.external-node-modules-'));
  const targetModules = path.join(sync.TARGET_EXTENSIONS_DIR, 'cocos-mcp', 'node_modules');
  const hadTargetModules = fs.existsSync(targetModules);
  fs.mkdirSync(targetModules, { recursive: true });
  try {
    const entries = sync.resolveNodeModuleSearchPath(existing).split(path.delimiter);

    assert.ok(entries.includes(path.join(sync.TARGET_EXTENSIONS_DIR, 'cocos-mcp', 'node_modules')));
    assert.ok(entries.includes(existing));
    assert.equal(entries.length, new Set(entries).size);
  } finally {
    fs.rmSync(existing, { recursive: true, force: true });
    if (!hadTargetModules) fs.rmdirSync(targetModules);
  }
});

test('failed offline schema gate preserves targets before ordinary and clean sync', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sync-gate-'));
  try {
    const shared = path.join(fixture, 'playable-shared-kit');
    const toolDir = path.join(shared, 'tools');
    const scripts = path.join(shared, 'packages/extensions/cocos-mcp/scripts');
    const target = path.join(fixture, 'assets/script/shared');
    fs.mkdirSync(toolDir, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(fixture, 'package.json'), '{}');
    fs.writeFileSync(path.join(target, 'keep.ts'), 'user content');
    fs.writeFileSync(`${target}.meta`, 'original metadata');
    fs.copyFileSync(require.resolve('./sync-shared-kit.cjs'), path.join(toolDir, 'sync-shared-kit.cjs'));
    fs.writeFileSync(path.join(scripts, 'source-dist-manifest.cjs'), 'process.exit(0);');
    fs.writeFileSync(path.join(toolDir, 'cocos-mcp-schema-refresh.cjs'), 'throw new Error("Cannot find module uuid");');
    for (const args of [[], ['--clean']]) {
      const result = spawnSync(process.execPath, [path.join(toolDir, 'sync-shared-kit.cjs'), ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /npm ci --omit=dev --ignore-scripts --prefix/);
      assert.equal(fs.readFileSync(path.join(target, 'keep.ts'), 'utf8'), 'user content');
      assert.equal(fs.readFileSync(`${target}.meta`, 'utf8'), 'original metadata');
      assert.deepEqual(fs.readdirSync(target), ['keep.ts']);
      assert.equal(fs.existsSync(path.join(fixture, 'extensions')), false);
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
