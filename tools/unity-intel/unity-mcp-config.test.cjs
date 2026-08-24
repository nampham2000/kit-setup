'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONFIG_RELATIVE_PATH,
  deriveUnityMcpPort,
  ensureUnityMcpConfig,
  isLoopbackUrl,
  readUnityMcpConnection,
  writeAtomic,
} = require('./unity-mcp-config.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mcp-config-'));
  fs.mkdirSync(path.join(root, 'Assets'));
  fs.mkdirSync(path.join(root, 'Packages'));
  fs.mkdirSync(path.join(root, 'ProjectSettings'));
  fs.writeFileSync(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.3.1f1\n');
  return root;
}

test('deterministic port uses Unity-MCP 20000..29999 range and normalized path', () => {
  const a = deriveUnityMcpPort('C:\\Work\\MyGame\\');
  const b = deriveUnityMcpPort('c:/work/mygame');
  assert.equal(a, b);
  assert.ok(a >= 20000 && a <= 29999);
  assert.equal(deriveUnityMcpPort('/home/user/my-game'), 23940);
  assert.equal(deriveUnityMcpPort('/home/İstanbul/game'), 25303);
});

test('managed config preserves user fields, scopes tool, is idempotent, and never exposes token publicly', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ...CONFIG_RELATIVE_PATH.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ custom: 7, tools: [{ name: 'other-tool', enabled: false }] }, null, 2)}\n`);

  const first = ensureUnityMcpConfig(root, { randomBytes: () => Buffer.alloc(32, 7) });
  assert.equal(first.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'config'), false);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.custom, 7);
  assert.equal(written.connectionMode, 'Custom');
  assert.equal(written.authOption, 'token');
  assert.deepEqual(written.tools, [
    { name: 'other-tool', enabled: false },
    { name: 'playable-port-scan', enabled: true },
  ]);
  assert.equal(readUnityMcpConnection(root).token, first.token);

  const second = ensureUnityMcpConfig(root);
  assert.equal(second.changed, false);
  assert.equal(second.token, first.token);
});

test('rollback restores exact previous bytes and refuses to overwrite a concurrent edit', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ...CONFIG_RELATIVE_PATH.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = Buffer.from('{"keep":"exact"}\r\n', 'utf8');
  fs.writeFileSync(file, original);

  const transaction = ensureUnityMcpConfig(root, { randomBytes: () => Buffer.alloc(32, 9) });
  assert.deepEqual(transaction.rollback(), { restored: true });
  assert.deepEqual(fs.readFileSync(file), original);

  const conflicting = ensureUnityMcpConfig(root);
  fs.writeFileSync(file, '{"user":"edit"}\n');
  assert.throws(() => conflicting.rollback(), { code: 'UNITY_MCP_CONFIG_ROLLBACK_CONFLICT' });
});

test('only loopback HTTP endpoints are accepted', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(isLoopbackUrl('http://127.0.0.1:27123'), true);
  assert.equal(isLoopbackUrl('http://[::1]:27123'), true);
  assert.equal(isLoopbackUrl('https://127.0.0.1:27123'), false);
  assert.equal(isLoopbackUrl('http://example.com:27123'), false);
  assert.equal(isLoopbackUrl('http://user:password@127.0.0.1:27123'), false);
  assert.equal(isLoopbackUrl('http://127.0.0.1:27123/path?token=secret'), false);
  assert.throws(() => ensureUnityMcpConfig(root, { url: 'http://example.com:27123' }), {
    code: 'UNITY_MCP_NON_LOOPBACK_REJECTED',
  });
});

test('atomic writer enforces compare-and-swap before replacing token-bearing config', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mcp-cas-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'config.json');
  const before = Buffer.from('{"a":1}\n');
  fs.writeFileSync(file, before);
  writeAtomic(file, Buffer.from('{"a":2}\n'), fs, before);
  assert.throws(() => writeAtomic(file, Buffer.from('{"a":3}\n'), fs, before), {
    code: 'UNITY_MCP_CONFIG_WRITE_CONFLICT',
  });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":2}\n');
});

test('config write rejects a UserSettings junction escaping the Unity project', t => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mcp-outside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  try {
    fs.symlinkSync(outside, path.join(root, 'UserSettings'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink/junction unavailable: ${error.code}`);
    return;
  }
  assert.throws(() => ensureUnityMcpConfig(root), {
    code: 'UNITY_MCP_CONFIG_SYMLINK_UNSUPPORTED',
  });
  assert.throws(() => readUnityMcpConnection(root), {
    code: 'UNITY_MCP_CONFIG_SYMLINK_UNSUPPORTED',
  });
});
