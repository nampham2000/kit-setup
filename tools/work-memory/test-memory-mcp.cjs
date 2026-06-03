'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'tools', 'work-memory.cjs');
const mcpPath = path.join(repoRoot, 'tools', 'work-memory-mcp.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'work-memory-mcp-test-'));
const tempRepoRoot = path.join(tempRoot, 'repo');
const repoDb = path.join(tempRoot, 'repo-memory.db');
const globalDb = path.join(tempRoot, 'global-memory.db');
const cacheFile = path.join(tempRoot, 'hot-cache.json');
const sharedCaptureFile = path.join(tempRoot, 'shared-capture.md');

fs.mkdirSync(tempRepoRoot, { recursive: true });
fs.writeFileSync(sharedCaptureFile, '', 'utf8');

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

function getTextContent(result) {
  const item = Array.isArray(result.content) ? result.content.find((entry) => entry.type === 'text') : null;
  if (!item) throw new Error('Expected text content from MCP tool result.');
  return JSON.parse(item.text);
}

async function main() {
  run(['init', '--repo-root', tempRepoRoot, '--repo-db', repoDb, '--global-db', globalDb, '--cache-file', cacheFile, '--shared-capture-file', sharedCaptureFile, '--json']);
  run([
    'remember',
    '--repo-root', tempRepoRoot,
    '--repo-db', repoDb,
    '--global-db', globalDb,
    '--cache-file', cacheFile,
    '--shared-capture-file', sharedCaptureFile,
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

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    cwd: repoRoot,
    stderr: 'pipe',
    env: {
      ...process.env,
      WORK_MEMORY_REPO_ROOT: tempRepoRoot,
      WORK_MEMORY_REPO_DB: repoDb,
      WORK_MEMORY_GLOBAL_DB: globalDb,
      WORK_MEMORY_CACHE_FILE: cacheFile,
      WORK_MEMORY_SHARED_CAPTURE_FILE: sharedCaptureFile,
    },
  });
  if (transport.stderr) {
    transport.stderr.on('data', () => {});
  }

  const client = new Client({ name: 'work-memory-mcp-test', version: '1.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === 'queryWorkMemory'), 'expected queryWorkMemory tool');
  assert.ok(tools.tools.some((tool) => tool.name === 'rememberWorkMemory'), 'expected rememberWorkMemory tool');
  assert.ok(tools.tools.some((tool) => tool.name === 'workMemoryStats'), 'expected workMemoryStats tool');

  const queryResult = await client.callTool({
    name: 'queryWorkMemory',
    arguments: { text: 'sprite preview', scope: 'repo', semantic: 'off' },
  });
  const queryPayload = getTextContent(queryResult);
  assert.ok(queryPayload.count >= 1, 'expected MCP query to return results');
  assert.strictEqual(queryPayload.items[0].title, 'Sprite preview trap');

  const rememberResult = await client.callTool({
    name: 'rememberWorkMemory',
    arguments: {
      memory: {
        title: 'Particle remap note',
        content: 'Porting Unity particles into the Cocos ViewModel should happen in one remap pass.',
        path: 'assets/scripts/ParticleConverter.ts',
      },
    },
  });
  const rememberPayload = getTextContent(rememberResult);
  assert.strictEqual(rememberPayload.importedCount, 1, 'expected MCP remember tool to save one memory');
  assert.strictEqual(rememberPayload.items[0].scope, 'repo', 'expected MCP remember tool to infer repo scope');
  assert.strictEqual(rememberPayload.items[0].category, 'porting-note', 'expected MCP remember tool to infer porting-note category');
  assert.ok(rememberPayload.items[0].tags.includes('unity'), 'expected MCP remember tool to infer unity tag');
  assert.ok(rememberPayload.items[0].tags.includes('cocos'), 'expected MCP remember tool to infer cocos tag');

  const statsResult = await client.callTool({ name: 'workMemoryStats', arguments: {} });
  const statsPayload = getTextContent(statsResult);
  assert.ok(statsPayload.repo.itemCount >= 2, 'expected MCP stats to include remembered repo memories');

  await transport.close();
  console.log(JSON.stringify({ ok: true, tempRoot }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});