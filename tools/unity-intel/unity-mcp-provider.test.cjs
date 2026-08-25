'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateUnityLiveSnapshotPatch } = require('./live-schema.cjs');
const {
  UnityMcpProviderError,
  invokeUnityMcpTool,
  resolveUnityMcpConnection,
  unwrapUnityMcpResponse,
} = require('./unity-mcp-provider.cjs');

function livePatch(fingerprint = 'a'.repeat(64)) {
  return {
    protocolVersion: 1,
    packageVersion: '0.3.0',
    kind: 'unity-live-patch',
    schemaVersion: 1,
    snapshotSchemaVersion: 1,
    provider: 'unity-mcp',
    generatedAt: '2026-08-24T00:00:00.000Z',
    projectFingerprint: fingerprint,
    scanId: 'unity-mcp-test-1',
    playModeCapture: false,
    project: { name: 'Fixture', unityVersion: '6000.0.66f2' },
    buildScenes: [],
    assets: { records: [], cursor: 0, nextCursor: null, totalCount: 0, truncated: false },
    dependencies: { edges: [], unresolved: [] },
    facts: { action: 'scan' },
    features: {},
    diagnostics: [],
    resolvesDiagnosticKeys: [],
    capabilities: { playModeCapture: false },
  };
}

function httpResponse(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(text)) : null },
    async text() { return text; },
  };
}

function assertProviderCode(code) {
  return error => {
    assert.ok(error instanceof UnityMcpProviderError);
    assert.equal(error.code, code);
    return true;
  };
}

test('resolves UserSettings connection, retries readiness, and unwraps structured MCP content', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mcp-provider-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'UserSettings'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'UserSettings', 'AI-Game-Developer-Config.json'),
    JSON.stringify({ host: 'http://127.0.0.1:8123', token: 'fixture-token' }),
  );

  const calls = [];
  const patch = livePatch();
  const responses = [
    httpResponse(503, { ignored: true }),
    httpResponse(200, { result: 'pong' }),
    httpResponse(200, { result: { content: [{ type: 'text', text: JSON.stringify(patch) }] } }),
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return responses.shift();
  };

  const result = await invokeUnityMcpTool({
    projectRoot: root,
    expectedFingerprint: 'a'.repeat(64),
    validator: validateUnityLiveSnapshotPatch,
    fetchImpl,
    sleepImpl: async () => {},
    retryDelayMs: 1,
    maxAttempts: 3,
    unresolvedGuids: ['B'.repeat(32), 'a'.repeat(32)],
    serializedAssetPaths: ['Assets/Game/Binary.asset'],
  });

  assert.deepEqual(result, patch);
  assert.deepEqual(calls.map(call => call.url), [
    'http://127.0.0.1:8123/api/system-tools/ping',
    'http://127.0.0.1:8123/api/system-tools/ping',
    'http://127.0.0.1:8123/api/tools/playable-port-scan',
  ]);
  assert.equal(calls.every(call => call.init.method === 'POST'), true);
  assert.equal(calls.every(call => call.init.headers.Authorization === 'Bearer fixture-token'), true);
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    action: 'scan',
    cursor: 0,
    pageSize: 128,
    maxPrefabs: 96,
    unresolvedGuids: ['a'.repeat(32), 'b'.repeat(32)],
    serializedAssetPaths: ['Assets/Game/Binary.asset'],
    expectedFingerprint: 'a'.repeat(64),
  });
});

test('enforces loopback hosts by default', () => {
  assert.throws(
    () => resolveUnityMcpConnection({ url: 'https://example.com', token: 'x' }),
    assertProviderCode('UNITY_MCP_REMOTE_REJECTED'),
  );
  assert.equal(
    resolveUnityMcpConnection({ url: 'https://example.com', token: 'x', allowRemote: true }).url,
    'https://example.com',
  );
});

test('direct MCP candidate limits match the scanner and batch contracts', async () => {
  await assert.rejects(
    invokeUnityMcpTool({
      url: 'http://127.0.0.1:9000',
      serializedAssetPaths: Array.from({ length: 97 }, (_, index) => `Assets/Binary/${index}.asset`),
    }),
    assertProviderCode('UNITY_MCP_OPTIONS_INVALID'),
  );
});

test('candidate fields are absent from a backward-compatible readiness request', async () => {
  const calls = [];
  const responses = [
    httpResponse(200, { result: 'pong' }),
    httpResponse(200, { structuredContent: livePatch() }),
  ];
  await invokeUnityMcpTool({
    url: 'http://127.0.0.1:9000',
    expectedFingerprint: 'a'.repeat(64),
    fetchImpl: async (_url, init) => {
      calls.push(init);
      return responses.shift();
    },
    maxAttempts: 1,
  });
  const body = JSON.parse(calls[1].body);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'unresolvedGuids'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'serializedAssetPaths'), false);
});

test('accepts Unity-MCP 0.89 direct HTTP structured envelope', () => {
  const patch = livePatch();
  assert.equal(unwrapUnityMcpResponse({ status: 'success', structured: { result: patch } }), patch);
});

test('reports a bounded request timeout', async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    const abort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (init.signal.aborted) abort();
    else init.signal.addEventListener('abort', abort, { once: true });
  });

  await assert.rejects(
    invokeUnityMcpTool({
      url: 'http://localhost:9001',
      fetchImpl,
      timeoutMs: 50,
      requestTimeoutMs: 5,
      maxAttempts: 1,
    }),
    assertProviderCode('UNITY_MCP_TIMEOUT'),
  );
});

test('rejects malformed tool response envelopes', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call++;
    return call === 1
      ? httpResponse(200, { result: 'pong' })
      : httpResponse(200, { result: { content: [{ type: 'text', text: 'not-json' }] } });
  };
  await assert.rejects(
    invokeUnityMcpTool({ url: 'http://[::1]:9002', fetchImpl, maxAttempts: 1 }),
    assertProviderCode('UNITY_MCP_MALFORMED_RESPONSE'),
  );
});

test('rejects a payload from another Unity project', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call++;
    return call === 1
      ? httpResponse(200, { result: 'pong' })
      : httpResponse(200, { structuredContent: livePatch('b'.repeat(64)) });
  };
  await assert.rejects(
    invokeUnityMcpTool({
      url: 'http://127.0.0.1:9003',
      expectedFingerprint: 'a'.repeat(64),
      fetchImpl,
      maxAttempts: 1,
    }),
    assertProviderCode('UNITY_MCP_FINGERPRINT_MISMATCH'),
  );
});

test('never includes the bearer token in provider errors', async () => {
  const token = 'top-secret-fixture-token';
  const fetchImpl = async () => {
    const error = new Error(`socket reset while using Bearer ${token}`);
    error.code = 'ECONNRESET';
    throw error;
  };
  let caught;
  try {
    await invokeUnityMcpTool({
      url: 'http://localhost:9004',
      token,
      fetchImpl,
      maxAttempts: 1,
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof UnityMcpProviderError);
  assert.equal(String(caught.message).includes(token), false);
  assert.equal(String(caught.stack).includes(token), false);
});
