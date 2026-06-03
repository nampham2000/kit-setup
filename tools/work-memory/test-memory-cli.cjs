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
const sharedCaptureFile = path.join(tempRoot, 'shared-capture.md');
const transcriptFile = path.join(tempRoot, 'session-transcript.json');
const hookScript = path.join(repoRoot, 'tools', 'work-memory-agent-hook.cjs');

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
fs.writeFileSync(
  sharedCaptureFile,
  [
    '## Shared shader lesson',
    'Preserve sprite semantics when porting effect shaders across playable projects.',
  ].join('\n'),
  'utf8'
);
fs.writeFileSync(
  transcriptFile,
  JSON.stringify({
    turns: [
      {
        role: 'assistant',
        content: [
          'Done.',
          '<!-- WORK_MEMORY: {"scope":"global","category":"tip","title":"Keep sprite semantics","content":"Preserve builtin sprite semantics when porting sprite effects.","tags":["shader","cocos","porting"],"importance":0.88,"confidence":0.97} -->',
          '<!-- WORK_MEMORY: {"scope":"repo","category":"bug-fix","title":"Particle converter axis trap","content":"Do not add an extra cone-only -90 X offset after node transform remap.","tags":["particle","converter","unity","cocos"],"importance":0.9,"confidence":0.96} -->',
          '<!-- WORK_MEMORY: {"title":"Particle remap note","content":"Porting Unity particle transforms into Cocos should keep the node remap in one place.","path":"assets/scripts/ParticleConverter.ts"} -->'
        ].join('\n')
      }
    ]
  }, null, 2),
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

const rememberAutoResult = run([
  'remember-auto',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--shared-capture-file', sharedCaptureFile,
  '--memory', '{"scope":"global","category":"tip","title":"Save root causes","content":"Write down one reusable root cause after each resolved bug.","tags":["process","debugging"],"importance":0.81,"confidence":0.93}',
  '--json',
]);
assert.strictEqual(rememberAutoResult.importedCount, 1, 'expected remember-auto to save one memory');

const rememberAutoInferredResult = run([
  'remember-auto',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--shared-capture-file', sharedCaptureFile,
  '--memory', '{"title":"ViewModel remap note","content":"Porting Unity particle data into the Cocos ViewModel should happen in one remap pass.","path":"assets/scripts/ParticleConverter.ts"}',
  '--json',
]);
assert.strictEqual(rememberAutoInferredResult.importedCount, 1, 'expected inferred remember-auto payload to save one memory');
assert.strictEqual(rememberAutoInferredResult.items[0].scope, 'repo', 'expected source path to infer repo scope');
assert.strictEqual(rememberAutoInferredResult.items[0].category, 'porting-note', 'expected porting text to infer porting-note category');
assert.ok(rememberAutoInferredResult.items[0].tags.includes('unity'), 'expected inferred remember-auto tags to include unity');
assert.ok(rememberAutoInferredResult.items[0].tags.includes('cocos'), 'expected inferred remember-auto tags to include cocos');
assert.ok(rememberAutoInferredResult.items[0].tags.includes('particle'), 'expected inferred remember-auto tags to include particle');
assert.ok(rememberAutoInferredResult.items[0].tags.includes('mvvm'), 'expected inferred remember-auto tags to include mvvm');

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
if (semanticOnlyQuery.semantic.repo.available) {
  assert.ok(semanticOnlyQuery.count >= 1, 'expected semantic-only query to return at least one memory');
  assert.ok(semanticOnlyQuery.items.every((item) => item.matchSource === 'repo-semantic'), 'expected semantic-only query results to come from semantic search');
} else {
  assert.strictEqual(semanticOnlyQuery.count, 0, 'expected semantic-only query to be empty without sqlite-vec');
  assert.ok(/sqlite-vec/i.test(String(semanticOnlyQuery.semantic.repo.reason || '')), 'expected semantic unavailability reason to mention sqlite-vec');
}

const watchResult = run([
  'watch',
  '--once',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--shared-capture-file', sharedCaptureFile,
  '--json',
]);
assert.ok(watchResult.sharedCapture.importedCount >= 1, 'expected shared capture file to be imported');
assert.ok(watchResult.global.itemCount >= 2, 'expected shared capture import to increase shared DB count');

const importAgentMemoriesResult = run([
  'import-agent-memories',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--shared-capture-file', sharedCaptureFile,
  '--transcript', transcriptFile,
  '--session-id', 'session-123',
  '--json',
]);
assert.strictEqual(importAgentMemoriesResult.discoveredCount, 3, 'expected transcript markers to be discovered');
assert.strictEqual(importAgentMemoriesResult.importedCount, 3, 'expected transcript markers to be imported');
const inferredTranscriptMemory = importAgentMemoriesResult.items.find((item) => item.title === 'Particle remap note');
assert.ok(inferredTranscriptMemory, 'expected inferred transcript memory to be imported');
assert.strictEqual(inferredTranscriptMemory.scope, 'repo', 'expected transcript path alias to infer repo scope');
assert.strictEqual(inferredTranscriptMemory.category, 'porting-note', 'expected transcript memory to infer porting-note category');
assert.ok(inferredTranscriptMemory.tags.includes('porting'), 'expected transcript inference to add porting tag');
assert.ok(inferredTranscriptMemory.tags.includes('unity'), 'expected transcript inference to add unity tag');
assert.ok(inferredTranscriptMemory.tags.includes('cocos'), 'expected transcript inference to add cocos tag');

const hookPayload = JSON.stringify({
  cwd: tempRepoRoot,
  sessionId: 'session-123',
  hookEventName: 'Stop',
  transcript_path: transcriptFile,
  repo_db: repoDb,
  global_db: globalDb,
  cache_file: cacheFile,
  shared_capture_file: sharedCaptureFile,
});
const hookResult = spawnSync(process.execPath, [hookScript], {
  cwd: repoRoot,
  encoding: 'utf8',
  input: hookPayload,
});
assert.strictEqual(hookResult.status, 0, 'expected agent hook script to exit successfully');
assert.strictEqual(JSON.parse(hookResult.stdout).continue, true, 'expected hook script to continue agent processing');

const sessionStartResult = run([
  'session-start',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--shared-capture-file', sharedCaptureFile,
  '--hot-limit', '5',
  '--json',
]);
assert.ok(sessionStartResult.cache.itemCount >= 2, 'expected session-start to build warm cache');
assert.ok(Array.isArray(sessionStartResult.topItems) && sessionStartResult.topItems.length >= 1, 'expected session-start hot items');
if (sessionStartResult.semantic.repo.available) {
  assert.ok(sessionStartResult.semantic.repo.indexedCount >= sessionStartResult.repo.itemCount, 'semantic index should exist after session-start');
} else {
  assert.ok(/sqlite-vec/i.test(String(sessionStartResult.semantic.repo.reason || '')), 'expected missing sqlite-vec to explain semantic unavailability after session-start');
}

const statsResult = run([
  'stats',
  '--repo-root', tempRepoRoot,
  '--repo-db', repoDb,
  '--global-db', globalDb,
  '--cache-file', cacheFile,
  '--shared-capture-file', sharedCaptureFile,
  '--json',
]);
assert.ok(statsResult.repo.itemCount >= 5, 'expected repo item count to include imported sources');
assert.ok(statsResult.global.itemCount >= 4, 'expected shared DB to include remember-auto, shared capture, and transcript memories');
assert.ok(statsResult.repo.itemCount >= 6, 'expected repo DB to include transcript-derived repo memory');
if (statsResult.semantic.repo.available) {
  assert.ok(statsResult.semantic.repo.indexedCount >= statsResult.repo.itemCount, 'expected all repo memories to be semantically indexed');
} else {
  assert.ok(/sqlite-vec/i.test(String(statsResult.semantic.repo.reason || '')), 'expected missing sqlite-vec to explain semantic unavailability in stats');
}

console.log(JSON.stringify({ ok: true, tempRoot }, null, 2));
