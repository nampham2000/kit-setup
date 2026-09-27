#!/usr/bin/env node
'use strict';

// Runs an evidence-capture C# script through the shared kit's own Unity-MCP
// (`script-execute`). Only the loopback endpoint configured for this project
// by `unity:intel:setup` is used; third-party Unity MCP servers are never a
// fallback. Scripts follow the capture convention
//   public class Script { public static string Main() { ... } }
// and may contain placeholders substituted with --set KEY=VALUE; OUTPUT_FILE
// is replaced by the absolute --out path.

const fs = require('node:fs');
const path = require('node:path');
const { readUnityMcpConnection } = require('./unity-mcp-config.cjs');

const USAGE = `Usage: node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <UnityProjectRoot> --script <file.cs> [--out <file>] [--set KEY=VALUE ...] [--class Script] [--method Main] [--timeout-ms 600000]`;

function parseArgs(argv) {
  const options = { sets: [], className: 'Script', methodName: 'Main', timeoutMs: 600000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${arg} cần một giá trị.`); return v; };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--project') options.project = next();
    else if (arg === '--script') options.script = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--set') options.sets.push(next());
    else if (arg === '--class') options.className = next();
    else if (arg === '--method') options.methodName = next();
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next());
    else throw new Error(`Option không hỗ trợ: ${arg}`);
  }
  if (!options.help && (!options.project || !options.script)) throw new Error('Thiếu --project hoặc --script.');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) throw new Error('--timeout-ms phải >= 1000.');
  return options;
}

function renderScript(options) {
  let code = fs.readFileSync(options.script, 'utf8');
  if (options.out) code = code.replace(/OUTPUT_FILE/g, path.resolve(options.out).replace(/\\/g, '/'));
  for (const entry of options.sets) {
    const index = entry.indexOf('=');
    if (index <= 0) throw new Error(`--set cần KEY=VALUE: ${entry}`);
    code = code.split(entry.slice(0, index)).join(entry.slice(index + 1));
  }
  return code;
}

function parseStreamable(text) {
  const data = text.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('');
  return JSON.parse(data || text);
}

async function mcpCall(connection, toolName, args, timeoutMs, fetchImpl = globalThis.fetch) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (connection.token) headers.Authorization = `Bearer ${connection.token}`;
  const post = async (body, signal) => {
    const response = await fetchImpl(connection.url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) throw Object.assign(new Error(`Unity-MCP HTTP ${response.status}`), { code: 'UNITY_MCP_HTTP_ERROR' });
    return response;
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cc-playable-unity-script', version: '1' } } }, controller.signal);
    const session = init.headers.get('mcp-session-id');
    await init.text();
    if (session) headers['mcp-session-id'] = session;
    await (await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, controller.signal)).text();
    const message = parseStreamable(await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: toolName, arguments: args } }, controller.signal)).text());
    if (message.error) throw Object.assign(new Error(JSON.stringify(message.error)), { code: 'UNITY_MCP_TOOL_ERROR' });
    return message.result;
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error('Unity-MCP script-execute timed out.'), { code: 'UNITY_MCP_TIMEOUT' });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function resultText(result) {
  return (result?.content || []).map(item => item.text || '').join('\n');
}

async function runUnityScript(options, dependencies = {}) {
  const projectRoot = path.resolve(options.project);
  const connection = (dependencies.readConnection || readUnityMcpConnection)(projectRoot, {});
  if (!connection?.url) {
    throw Object.assign(new Error('Unity-MCP của shared kit chưa được cấu hình; chạy npm run unity:intel:setup.'), { code: 'UNITY_MCP_NOT_CONFIGURED' });
  }
  if (options.out) fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  const result = await mcpCall(connection, 'script-execute', {
    csharpCode: renderScript(options), className: options.className, methodName: options.methodName,
  }, options.timeoutMs, dependencies.fetch);
  const text = resultText(result);
  const failed = result?.isError === true || /\[Error\]|error CS\d{4}|Exception:/.test(text);
  return { ok: !failed, text };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    const { ok, text } = await runUnityScript(options);
    (ok ? console.log : console.error)(text.length > 4000 ? `${text.slice(0, 4000)}…` : text);
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[unity-script] ${error.code || 'UNITY_SCRIPT_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, renderScript, runUnityScript, mcpCall };
