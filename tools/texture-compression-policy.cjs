#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TOOL_NAME = 'assetAdvanced_enforce_texture_compression_policy';
const DEFAULT_PRESET_ID = '1fYG0h7MJDcp+zA2cMcUsR';

function usage() {
  return `Portable Cocos texture compression policy

Usage:
  node playable-shared-kit/tools/texture-compression-policy.cjs [options]

Options:
  --project <dir>       Cocos project root (default: current directory)
  --directory <db-url>  Asset DB root (default: db://assets)
  --preset-name <name>  Existing/fallback preset name (default: PlayableTransparent)
  --preset-id <id>      Stable ID used when creating the fallback preset
  --quality <1-100>     Fallback WebP quality (default: 50)
  --mcp-url <url>       Override Cocos MCP URL
  --timeout <ms>        MCP timeout (default: 300000)
  --dry-run             Report importer changes without saving
  --verify              Fail unless every eligible texture is already compliant
  --json                Print JSON
  --help                Show this help

The tool only changes PNG/JPG/JPEG metadata through Cocos Asset DB and the
builder preset through Editor.Profile. It never edits image .meta files directly.`;
}

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    directory: 'db://assets',
    presetName: 'PlayableTransparent',
    presetId: DEFAULT_PRESET_ID,
    quality: 50,
    timeoutMs: 300_000,
    dryRun: false,
    verify: false,
    json: false,
    help: false,
    mcpUrl: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) throw new Error(`Missing value for ${token}`);
      return argv[index];
    };
    if (token === '--project') options.project = next();
    else if (token === '--directory') options.directory = next();
    else if (token === '--preset-name') options.presetName = next();
    else if (token === '--preset-id') options.presetId = next();
    else if (token === '--quality') options.quality = Number(next());
    else if (token === '--timeout') options.timeoutMs = Number(next());
    else if (token === '--mcp-url') options.mcpUrl = next();
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--verify') options.verify = true;
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!Number.isFinite(options.quality) || options.quality < 1 || options.quality > 100) {
    throw new Error('--quality must be between 1 and 100');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 900_000) {
    throw new Error('--timeout must be between 1000 and 900000 milliseconds');
  }
  options.project = path.resolve(options.project);
  return options;
}

function parseMcpEnvelope(body, id) {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = JSON.parse(line.slice(5));
    if (payload.id === id) return payload;
  }
  throw new Error('Cocos MCP returned no matching JSON-RPC response');
}

function resolveMcpUrl(options) {
  if (options.mcpUrl) return options.mcpUrl;
  const settingsFile = path.join(options.project, 'settings', 'mcp-server.json');
  if (!fs.existsSync(settingsFile)) {
    throw new Error(`Cocos MCP settings are missing: ${settingsFile}. Run npm run sync and open the project in Cocos Creator.`);
  }
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''));
  return `http://127.0.0.1:${Number(settings.port) || 3000}/mcp`;
}

async function createClient(options) {
  const url = resolveMcpUrl(options);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let id = 0;
  const rpc = async (method, params) => {
    const requestId = ++id;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) headers['Mcp-Session-Id'] = session;
    const body = await response.text();
    if (!response.ok) throw new Error(`Cocos MCP HTTP ${response.status}: ${body.slice(0, 400)}`);
    const envelope = parseMcpEnvelope(body, requestId);
    if (envelope.error) throw new Error(`Cocos MCP RPC error: ${JSON.stringify(envelope.error)}`);
    return envelope.result;
  };
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'shared-kit-texture-compression-policy', version: '1.0.0' },
  });
  return {
    call: (name, args) => rpc('tools/call', { name, arguments: args || {} }),
    close: () => fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) }).catch(() => undefined),
  };
}

function unwrapToolResult(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (text) {
    try { return JSON.parse(text); } catch (_) { return { success: !result.isError, message: text }; }
  }
  return result;
}

function evaluateResult(payload, options) {
  if (!payload?.success || !payload?.data?.complete) {
    return { ok: false, code: 'TEXTURE_POLICY_APPLY_FAILED', payload };
  }
  const report = payload.data;
  if (options.verify && (report.updated !== 0 || report.preset?.changed)) {
    return { ok: false, code: 'TEXTURE_POLICY_DRIFT', payload };
  }
  return { ok: true, code: 'TEXTURE_POLICY_OK', payload };
}

async function run(options) {
  const client = await createClient(options);
  try {
    const raw = await client.call(TOOL_NAME, {
      directory: options.directory,
      presetName: options.presetName,
      presetId: options.presetId,
      quality: options.quality,
      dryRun: options.dryRun || options.verify,
    });
    return evaluateResult(unwrapToolResult(raw), options);
  } finally {
    await client.close();
  }
}

function printResult(result, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const report = result.payload?.data || {};
  process.stdout.write(`[texture-policy] ${result.code}\n`);
  process.stdout.write(`  preset: ${report.preset?.name || '?'} (${report.preset?.id || '?'}) WebP ${report.preset?.webpQuality ?? '?'}\n`);
  process.stdout.write(`  eligible=${report.eligible ?? 0} updated=${report.updated ?? 0} unchanged=${report.unchanged ?? 0} failed=${report.failed ?? 0}\n`);
  if (!result.ok && result.payload?.error) process.stderr.write(`  error: ${result.payload.error}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await run(options);
  printResult(result, options);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`[texture-policy] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createClient,
  DEFAULT_PRESET_ID,
  TOOL_NAME,
  evaluateResult,
  parseArgs,
  parseMcpEnvelope,
  resolveMcpUrl,
  run,
  unwrapToolResult,
  usage,
};
