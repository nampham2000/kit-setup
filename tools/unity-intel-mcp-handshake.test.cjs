'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const { createUnityFixture } = require('./unity-intel/test-fixture.cjs');

test('stdio MCP handshake exposes four compact tools and performs a real static scan', async t => {
  const fixture = createUnityFixture(t);
  const serverPath = path.resolve(__dirname, 'unity-intel-mcp.cjs');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: path.resolve(__dirname, '..', '..'),
    stderr: 'pipe',
    env: { ...process.env },
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'unity-intel-handshake-test', version: '1.0.0' });
  t.after(async () => { try { await transport.close(); } catch (_) { /* best effort */ } });
  await client.connect(transport);

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), [
    'doctorUnityProject', 'scanUnityProject', 'getUnityProjectFeatures', 'getUnityProjectSlice',
  ]);
  const result = await client.callTool({
    name: 'scanUnityProject',
    arguments: { project: fixture.root, provider: 'static' },
  });
  const text = result.content.find(item => item.type === 'text').text;
  const payload = JSON.parse(text);
  assert.equal(payload.provider, 'static');
  assert.equal(payload.project.name, path.basename(fixture.root));
  assert.ok(Buffer.byteLength(text, 'utf8') <= 24 * 1024);
});
