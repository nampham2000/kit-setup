'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'tools', 'work-memory.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'work-memory-test-'));
const tempRepoRoot = path.join(tempRoot, 'repo');
const repoDb = path.join(tempRoot, 'repo-memory.db');
const globalDb = path.join(tempRoot, 'global-memory.db');
const cacheFile = path.join(tempRoot, 'hot-cache.json');

fs.mkdirSync(path.join(tempRepoRoot, 'tools'), { recursive: true });
fs.mkdirSync(path.join(tempRepoRoot, 'docs'), { recursive: true });
fs.mkdirSync(path.join(tempRepoRoot, 'notes'), { recursive: true });
fs.writeFileSync(
  path.join(tempRepoRoot, 'tools', 'sample.TODO.md'),
  [
    'Fix sprite preview disappearing when effect semantics drift from builtin-sprite.effect.',
    '',
    'Port particle rotation alignment from Unity to Cocos.',
  ].join('\n'),
  'utf8'
);
fs.writeFileSync(
  path.join(tempRepoRoot, 'docs', 'CHANGELOG.md'),
  [
    '# Changelog',
    '',
    '- Added better particle system conversion logs.',
  ].join('\n'),
  'utf8'
);
fs.writeFileSync(
  path.join(tempRepoRoot, 'notes', 'bugfix-summary.md'),
  [
    'Bugfix summary',
    '',
    'Sprites disappear in preview when shader semantics skip a_color preservation.',
  ].join('\n'),
  'utf8'
);

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI failed: ${args.join(' ')}`);
  }
  return JSON.parse(result.stdout);
}

run(['init', '--repo-root', tempRepoRoot, '--repo-db', repoDb, '--global-db', globalDb, '--cache-file', cacheFile, '--json']);

run([
  'remember',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--scope', 'repo',
  '--category', 'bug-fix',
  '--title', 'Sprite preview trap',
  '--content', 'builtin-sprite.effect semantics prevent missing preview sprites',
  '--tags', 'cocos,sprite,effect,preview',
  '--source-path', 'assets/effects/TestSpriteNodeShine.effect',
  '--importance', '0.95',
  '--pinned', 'true',
  '--json',
]);

run([
  'remember',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--scope', 'global',
  '--category', 'tip',
  '--title', 'Always record root cause',
  '--content', 'Distill the bug into one stable note after each fix.',
  '--tags', 'process,debugging',
  '--importance', '0.8',
  '--json',
]);

const importSourcesResult = run([
  'import-sources',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--scope', 'repo',
  '--json',
]);
assert.ok(importSourcesResult.fileCount >= 3, 'expected discovered markdown sources to be imported');
assert.ok(importSourcesResult.importedCount >= 4, 'expected imported memories from discovered sources');

const queryResult = run([
  'query',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--text', 'sprite preview',
  '--scope', 'hybrid',
  '--semantic', 'off',
  '--json',
]);
assert.ok(queryResult.count >= 1, 'expected at least one query result');
assert.strictEqual(queryResult.items[0].title, 'Sprite preview trap');
assert.ok(queryResult.items.every((item) => item.matchSource !== 'repo-semantic' && item.matchSource !== 'global-semantic'), 'expected lexical query before reindex to avoid semantic results');

const warmupResult = run([
  'warmup',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--repo-limit', '5',
  '--global-limit', '5',
  '--json',
]);
assert.ok(warmupResult.itemCount >= 2, 'expected warm cache items');
assert.ok(fs.existsSync(cacheFile), 'expected cache file to exist');
assert.strictEqual(warmupResult.repoRoot, '<repo-root>', 'expected warm cache repo root to be portable');
assert.strictEqual(warmupResult.cacheVersion, 2, 'expected portable warm cache version');

const cacheSnapshot = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
const cacheJson = JSON.stringify(cacheSnapshot);
assert.ok(!cacheJson.includes(tempRepoRoot.replace(/\\/g, '/')), 'expected cache to omit absolute repo root');
assert.ok(!cacheJson.includes(tempRepoRoot), 'expected cache to omit platform-specific absolute repo root');
assert.ok(
  cacheSnapshot.items.some((item) => String(item.sourcePath || '').startsWith('<repo-root>/')),
  'expected repo-local source paths to use <repo-root>'
);

const semanticOnlyQuery = run([
  'query',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--text', 'preview sprites shader semantics',
  '--scope', 'repo',
  '--semantic', 'only',
  '--prefer-cache', 'false',
  '--json',
]);
assert.ok(semanticOnlyQuery.count >= 1, 'expected semantic-only query to return at least one memory');
assert.ok(semanticOnlyQuery.items.every((item) => item.matchSource === 'repo-semantic'), 'expected semantic-only query results to come from semantic search');

const sessionStartResult = run([
  'session-start',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--hot-limit', '5',
  '--json',
]);
assert.ok(sessionStartResult.cache.itemCount >= 2, 'expected session-start to build warm cache');
assert.ok(Array.isArray(sessionStartResult.topItems) && sessionStartResult.topItems.length >= 1, 'expected session-start hot items');
assert.ok(sessionStartResult.semantic.repo.available, 'expected semantic layer to be available');
assert.ok(sessionStartResult.semantic.repo.indexedCount >= sessionStartResult.repo.itemCount, 'semantic index should exist after session-start');

const statsResult = run([
  'stats',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--json',
]);
assert.ok(statsResult.repo.itemCount >= 5, 'expected repo item count to include imported sources');
assert.strictEqual(statsResult.global.itemCount, 1);
assert.ok(statsResult.semantic.repo.available, 'expected repo semantic status to be available');
assert.ok(statsResult.semantic.repo.indexedCount >= statsResult.repo.itemCount, 'expected all repo memories to be semantically indexed');

console.log(JSON.stringify({ ok: true, tempRoot }, null, 2));
