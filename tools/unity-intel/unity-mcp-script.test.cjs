'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, renderScript, runUnityScript } = require('./unity-mcp-script.cjs');

function fakeFetch(resultText, calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const payload = body.method === 'tools/call'
      ? { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: resultText }] } }
      : { jsonrpc: '2.0', id: body.id, result: {} };
    return {
      ok: true,
      status: 200,
      headers: { get: name => (name === 'mcp-session-id' ? 'session-1' : null) },
      text: async () => `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
    };
  };
}

test('placeholders are substituted and OUTPUT_FILE becomes the absolute --out path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-script-'));
  const script = path.join(dir, 'capture.cs');
  fs.writeFileSync(script, 'write("OUTPUT_FILE"); var t = SAMPLE_TIME;');
  const code = renderScript(parseArgs(['--project', dir, '--script', script, '--out', 'o/x.json', '--set', 'SAMPLE_TIME=1.5f']));
  assert.match(code, /write\(".*o\/x\.json"\)/);
  assert.match(code, /var t = 1\.5f;/);
  assert.doesNotMatch(code, /\\/);
});

test('script-execute is called on the configured loopback endpoint with the session and token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-script-'));
  const script = path.join(dir, 'capture.cs');
  fs.writeFileSync(script, 'public class Script { public static string Main() { return "ok"; } }');
  const calls = [];
  const result = await runUnityScript(parseArgs(['--project', dir, '--script', script]), {
    readConnection: () => ({ url: 'http://127.0.0.1:25609', token: 'secret' }),
    fetch: fakeFetch('{"result":{"value":"ok"}}', calls),
  });
  assert.equal(result.ok, true);
  const toolCall = calls.find(call => call.body.method === 'tools/call');
  assert.equal(toolCall.body.params.name, 'script-execute');
  assert.equal(toolCall.body.params.arguments.className, 'Script');
  assert.equal(toolCall.headers.Authorization, 'Bearer secret');
  assert.equal(toolCall.headers['mcp-session-id'], 'session-1');
});

test('compile errors are reported as failure and a missing endpoint is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-script-'));
  const script = path.join(dir, 'capture.cs');
  fs.writeFileSync(script, 'broken');
  const failed = await runUnityScript(parseArgs(['--project', dir, '--script', script]), {
    readConnection: () => ({ url: 'http://127.0.0.1:25609', token: null }),
    fetch: fakeFetch('[Error] (1,1): error CS1002: ; expected', []),
  });
  assert.equal(failed.ok, false);
  await assert.rejects(runUnityScript(parseArgs(['--project', dir, '--script', script]), { readConnection: () => null }),
    error => error.code === 'UNITY_MCP_NOT_CONFIGURED');
});
