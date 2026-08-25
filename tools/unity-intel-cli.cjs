#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  inspectUnityProject,
  createCompactScanEnvelope,
  queryUnitySnapshot,
  scanUnityProject,
} = require('./unity-intel/service.cjs');
const { runUnityPortPreflight } = require('./unity-intel/preflight.cjs');

const COMMANDS = new Set(['doctor', 'setup', 'preflight', 'scan', 'query']);
const SECTIONS = new Set(['features', 'assets', 'dependencies', 'unresolved', 'diagnostics', 'scenes', 'scripts']);

const USAGE = `Unity Intelligence

Usage:
  node playable-shared-kit/tools/unity-intel-cli.cjs doctor --project <UnityProjectRoot> [options]
  node playable-shared-kit/tools/unity-intel-cli.cjs setup  --project <UnityProjectRoot> [options]
  node playable-shared-kit/tools/unity-intel-cli.cjs preflight --project <UnityProjectRoot> [options]
  node playable-shared-kit/tools/unity-intel-cli.cjs scan   --project <UnityProjectRoot> [options]
  node playable-shared-kit/tools/unity-intel-cli.cjs query  --project <UnityProjectRoot> --section <name> [options]

Commands:
  doctor             Kiểm tra Unity version/editor/lock và Unity-MCP endpoint, không ghi project.
  setup              Cài package scanner + Unity-MCP, cấu hình loopback, reload và scan trong một lệnh.
  preflight          Bắt buộc trước port: scan + feature sketch + high routing + receipt ngoài project.
  scan               Static-first compact scan; provider auto không tự cài package.
  query              Lấy một page nhỏ từ feature/assets/dependency/script/diagnostic index.

Options:
  --project <path>   Unity project root (bắt buộc).
  --provider <mode>  auto | static | unity-mcp. Default: auto.
  --bootstrap        Cho phép scan/preflight tự cài/reload Unity-MCP (setup luôn bật).
  --unity <file>     Unity Editor executable; phải đúng version project.
  --mcp-url <url>    Override HTTP loopback endpoint. Token chỉ nhận qua UNITY_MCP_TOKEN.
  --timeout-ms <n>   Thời gian chờ setup/reload/live scan. Default: 180000 khi bootstrap.
  --request-timeout-ms <n>  Timeout cho một full scan HTTP request. Default tối đa 120000.
  --keep-on-failure  Giữ package/config khi bootstrap không tạo được live marker (mặc định rollback).
  --include-vendor   Giữ vendor/sample/editor trong porting view.
  --cache-dir <dir>  Static incremental cache ngoài Unity project.
  --no-cache         Tắt static cache.
  --refresh-cache    Bỏ static cache cũ.
  --intent <kind>    project | scene | prefab | script | shader | feature | diagnostic. Default: project.
  --target <value>   Logical path/symbol cần tập trung; có thể lặp lại (intent khác project).
  --section <name>   features | assets | dependencies | unresolved | diagnostics | scenes | scripts.
  --search <text>    Lọc page theo chuỗi compact.
  --severity <level> high | medium | low.
  --type <type>      Lọc theo type/kind/id.
  --cursor <token>   Cursor từ page trước.
  --limit <n>        1..200, default 50.
  --out <file>       Ghi JSON compact ra file.
  --json             Xuất JSON (mặc định khi stdout không phải TTY).
  --help             Hiện trợ giúp.

Mặc định không sửa Unity project. Chỉ setup hoặc --bootstrap mới ghi package/config.`;

function valueAfter(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} cần một giá trị.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    command: 'scan',
    provider: 'auto',
    cache: true,
    json: false,
    help: false,
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    if (!COMMANDS.has(argv[0])) throw new Error(`Command không hỗ trợ: ${argv[0]}`);
    options.command = argv[0];
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--bootstrap') { options.bootstrap = true; continue; }
    if (argument === '--include-vendor') { options.includeVendor = true; continue; }
    if (argument === '--no-cache') { options.cache = false; continue; }
    if (argument === '--refresh-cache') { options.refreshCache = true; continue; }
    if (argument === '--keep-unity-artifacts') { options.keepUnityArtifacts = true; continue; }
    if (argument === '--keep-on-failure') { options.keepOnFailure = true; continue; }
    const equal = /^--([a-z-]+)=(.*)$/.exec(argument);
    const name = equal ? equal[1] : argument.startsWith('--') ? argument.slice(2) : null;
    const supported = new Set([
      'project', 'provider', 'unity', 'mcp-url', 'timeout-ms', 'request-timeout-ms', 'cache-dir', 'section',
      'search', 'severity', 'type', 'cursor', 'limit', 'out', 'intent', 'target',
    ]);
    if (!name || !supported.has(name)) throw new Error(`Option không hỗ trợ: ${argument}`);
    const value = equal ? equal[2] : valueAfter(argv, index, `--${name}`);
    if (!equal) index += 1;
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === 'target') {
      options.targets = options.targets || [];
      options.targets.push(value);
    } else options[key] = value;
  }
  if (options.timeoutMs !== undefined) options.timeoutMs = Number(options.timeoutMs);
  if (options.requestTimeoutMs !== undefined) options.requestTimeoutMs = Number(options.requestTimeoutMs);
  if (options.limit !== undefined) options.limit = Number(options.limit);
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250)) {
    throw new Error('--timeout-ms phải là số nguyên >= 250.');
  }
  if (options.requestTimeoutMs !== undefined && (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 250)) {
    throw new Error('--request-timeout-ms phải là số nguyên >= 250.');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200)) {
    throw new Error('--limit phải nằm trong 1..200.');
  }
  if (!['auto', 'static', 'unity-mcp'].includes(options.provider)) {
    throw new Error('--provider phải là auto, static hoặc unity-mcp.');
  }
  if (options.severity && !['high', 'medium', 'low'].includes(options.severity)) {
    throw new Error('--severity phải là high, medium hoặc low.');
  }
  if (options.section && !SECTIONS.has(options.section)) throw new Error(`--section không hỗ trợ: ${options.section}`);
  if (options.intent && !['project', 'scene', 'prefab', 'script', 'shader', 'feature', 'diagnostic'].includes(options.intent)) {
    throw new Error('--intent không hỗ trợ.');
  }
  if (options.targets && (options.targets.length > 8 || options.targets.some(value => value.length > 320))) {
    throw new Error('--target tối đa 8 giá trị, mỗi giá trị <=320 ký tự.');
  }
  if (options.command === 'setup') {
    options.bootstrap = true;
    options.provider = 'unity-mcp';
  }
  return options;
}

function scanInput(options) {
  return {
    project: options.project,
    provider: options.provider,
    bootstrap: !!options.bootstrap,
    unity: options.unity,
    mcpUrl: options.mcpUrl,
    mcpToken: process.env.UNITY_MCP_TOKEN || undefined,
    timeoutMs: options.timeoutMs || (options.bootstrap ? 180_000 : 10_000),
    requestTimeoutMs: options.requestTimeoutMs,
    includeVendor: !!options.includeVendor,
    cache: options.cache,
    cacheDir: options.cacheDir,
    refreshCache: !!options.refreshCache,
    keepUnityArtifacts: !!options.keepUnityArtifacts,
    keepOnFailure: !!options.keepOnFailure,
  };
}

function compactScanResult(result) {
  return createCompactScanEnvelope(result);
}

async function execute(options) {
  if (!options.project) throw new Error('Thiếu --project <UnityProjectRoot>.');
  if (options.command === 'doctor') {
    return inspectUnityProject({
      project: options.project,
      unity: options.unity,
      mcpUrl: options.mcpUrl,
      mcpToken: process.env.UNITY_MCP_TOKEN || undefined,
    });
  }
  if (options.command === 'preflight') {
    const result = await runUnityPortPreflight({
      ...scanInput(options),
      intent: options.intent || 'project',
      targets: options.targets,
      indexCacheDir: options.cacheDir,
      // --cache-dir scopes the potentially large incremental index only. Mutation
      // receipts stay in the fixed user-local receipt store used by every port gate.
      cacheDir: undefined,
    });
    return result.brief;
  }
  const result = await scanUnityProject(scanInput(options));
  if (options.command === 'query') {
    return queryUnitySnapshot(result.snapshot, {
      section: options.section || 'features',
      search: options.search,
      severity: options.severity,
      type: options.type,
      cursor: options.cursor,
      limit: options.limit,
    });
  }
  return compactScanResult(result);
}

function printHuman(payload, command) {
  if (command === 'doctor') {
    console.log(`Unity project: ${payload.project}`);
    console.log(`Editor: ${payload.doctor && payload.doctor.ready ? 'ready' : 'not ready'}`);
    console.log(`Lock: ${payload.doctor && payload.doctor.lock ? payload.doctor.lock.state : 'unknown'}`);
    console.log(`Unity-MCP: ${payload.connection && payload.connection.url ? payload.connection.url : 'not configured'}`);
    return;
  }
  if (payload.section) {
    console.log(`${payload.section}: ${payload.count}/${payload.total}`);
    for (const item of payload.items) console.log(`  ${JSON.stringify(item)}`);
    if (payload.nextCursor) console.log(`nextCursor: ${payload.nextCursor}`);
    return;
  }
  if (payload.kind === 'unity-port-implementation-brief') {
    console.log(`${payload.project.name || 'Unity project'} — ${payload.project.provider}`);
    console.log(`Preflight: ${payload.decision.status} (${payload.receiptId})`);
    console.log(`Features: ${payload.features.map(item => item.id).join(', ') || '(none)'}`);
    console.log(`High obligations: ${payload.decision.obligationCount}; hard blockers: ${payload.decision.hardBlockerCount}`);
    return;
  }
  console.log(`${payload.project.name || 'Unity project'} — ${payload.provider}`);
  console.log(`Scan: ${payload.scanId}`);
  console.log(`Features: ${(payload.featureSketch || []).map(item => item.label || item.id).join(', ') || '(none)'}`);
  console.log(`Diagnostics: ${(payload.diagnostics || []).length}`);
}

async function main() {
  require('./lib/auto-strip-ansi.cjs');
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    const payload = await execute(options);
    if (options.out) {
      const outputPath = path.resolve(options.out);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
      if (options.json || !process.stdout.isTTY) console.log(JSON.stringify({ ok: true, out: outputPath }));
      else console.log(`[unity-intel] Đã ghi ${outputPath}`);
      return;
    }
    if (options.json || !process.stdout.isTTY) console.log(JSON.stringify(payload));
    else printHuman(payload, options.command);
  } catch (error) {
    const code = error.code || 'UNITY_INTEL_FAILED';
    console.error(`[unity-intel] ${code}: ${error.message}`);
    if (error.artifacts) console.error(`[unity-intel] Unity logs: ${error.artifacts}`);
    if (error.rollback) console.error(`[unity-intel] Rollback: ${JSON.stringify(error.rollback)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  COMMANDS,
  SECTIONS,
  USAGE,
  parseArgs,
  scanInput,
  compactScanResult,
  execute,
};
