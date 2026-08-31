#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createClient, unwrapToolResult } = require('./texture-compression-policy.cjs');

const TOOL_NAME = 'assetAdvanced_enforce_fbx_import_policy';

function usage() {
  return `Portable Cocos FBX model import policy

Usage:
  node playable-shared-kit/tools/model-import-policy.cjs [options]

Options:
  --project <dir>       Cocos project root (default: current directory)
  --directory <db-url>  Asset DB root (default: db://assets)
  --mcp-url <url>       Override Cocos MCP URL
  --timeout <ms>        MCP timeout (default: 300000)
  --dry-run             Report importer changes without saving
  --verify              Fail unless every FBX is already compliant
  --json                Print JSON
  --help                Show this help

The tool writes importer metadata only through Cocos Asset DB. It enforces:
  Mesh Optimize: enable, Vertex Cache, Vertex Fetch, Overdraw
  Mesh Simplify: enable, ratio 0.8, manual error 1, unlocked boundary
  Mesh Cluster: disabled
  Mesh Compress: enable, Compress on, Encode/Quantize off`;
}

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    directory: 'db://assets',
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
    else if (token === '--timeout') options.timeoutMs = Number(next());
    else if (token === '--mcp-url') options.mcpUrl = next();
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--verify') options.verify = true;
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 900_000) {
    throw new Error('--timeout must be between 1000 and 900000 milliseconds');
  }
  options.project = path.resolve(options.project);
  return options;
}

function evaluateResult(payload, options) {
  if (!payload?.success || !payload?.data?.complete) {
    return { ok: false, code: 'FBX_POLICY_APPLY_FAILED', payload };
  }
  if (options.verify && payload.data.updated !== 0) {
    return { ok: false, code: 'FBX_POLICY_DRIFT', payload };
  }
  return { ok: true, code: 'FBX_POLICY_OK', payload };
}

async function run(options) {
  const client = await createClient(options);
  try {
    const raw = await client.call(TOOL_NAME, {
      directory: options.directory,
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
  process.stdout.write(`[fbx-policy] ${result.code}\n`);
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
    process.stderr.write(`[fbx-policy] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { TOOL_NAME, evaluateResult, parseArgs, run, usage };
