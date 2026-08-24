#!/usr/bin/env node
'use strict';

/**
 * Unity Port Planner
 * ==================
 * Compact, backwards-compatible view over the canonical UnityProjectSnapshot.
 * The static index keeps vendor/sample evidence for GUID resolution while the
 * default porting view filters it out of gameplay recommendations.
 */

const fs = require('node:fs');
const path = require('node:path');

const { color } = require('./lib/term-color.cjs');
const { CAPABILITIES } = require('../ai/capabilities.def.cjs');
const { BLOCKER_RULES } = require('./unity-intel/diagnostics.cjs');
const { buildUnityProjectSnapshot } = require('./unity-intel/project-index.cjs');
const { scanUnityProject } = require('./unity-intel/service.cjs');

const USAGE = `Unity Port Planner

Usage:
  node playable-shared-kit/tools/port-plan.cjs --project <UnityProjectRoot> [options]
  node playable-shared-kit/tools/port-plan.cjs --src <UnityAssetsFolder> [options]
  npm run ai:port:plan -- --project <UnityProjectRoot>

Options:
  --project <path>   Unity project root. Scanner tự chọn thư mục Assets.
  --src <path>       Unity Assets hoặc module con. Giữ tương thích CLI cũ.
  --json             Xuất JSON (mặc định khi không phải TTY).
  --out <file>       Ghi JSON ra file.
  --top <n>          Số scene/prefab liệt kê. Default: 15.
  --include-vendor   Hiện vendor/sample/editor trong porting view.
  --provider <mode>  auto | static | unity-mcp. Default: auto (read-only fallback).
  --bootstrap        Tự cài Unity scanner + Unity-MCP, reload rồi scan.
  --unity <file>     Unity Editor executable; phải đúng version project.
  --mcp-url <url>    Override HTTP loopback endpoint (token qua UNITY_MCP_TOKEN).
  --timeout-ms <n>   Timeout live scan/setup.
  --cache-dir <dir>  Ghi incremental index cache ngoài Unity/Cocos project.
  --no-cache         Không đọc hoặc ghi persistent cache.
  --refresh-cache    Bỏ cache cũ, scan lại rồi ghi cache mới.
  --help             Hiện trợ giúp và thoát.

Mặc định không sửa Unity/Cocos project. Chỉ --bootstrap mới ghi package/config Unity.`;

const MEASURED_SECONDS_PER_PREFAB = 2.9;
const MEASURED_SECONDS_PER_PREFAB_JOBS4 = 1.1;

/** Legacy public export retained for existing consumers. */
const BLOCKERS = BLOCKER_RULES;

function capabilityInvocation(id) {
  const capability = CAPABILITIES.find(item => item.id === id);
  if (!capability) throw new Error(`Capability not found: ${id}`);
  if (capability.npm) return capability.npm;
  return [capability.cmd, ...(capability.args || [])].filter(Boolean).join(' ');
}

function compactBlocker(blocker) {
  return {
    id: blocker.id,
    label: blocker.label,
    impact: blocker.impact,
    action: blocker.action,
    count: blocker.count,
    examples: blocker.examples,
  };
}

function legacyAssetEntry(asset) {
  return {
    path: asset.path,
    kb: asset.kb,
    gameObjects: asset.gameObjects,
    inlineMaterials: asset.inlineMaterials,
  };
}

/**
 * Backwards-compatible analysis API. Values are now derived from one canonical
 * index pass; the returned snapshot is additive and is intentionally omitted
 * from the compact CLI JSON by buildPlan().
 */
function analysisFromSnapshot(snapshot, options = {}) {
  const top = Number.isInteger(options.top) && options.top > 0 ? options.top : 15;
  const { totalMb, ...counts } = snapshot.inventory;
  const visible = asset => options.includeVendor || asset.scope === 'runtime';
  const rankedScenes = snapshot.scenes
    .filter(visible)
    .sort((a, b) => Number(b.gameplayCandidate) - Number(a.gameplayCandidate) ||
      Number(b.enabled) - Number(a.enabled) || b.kb - a.kb || a.path.localeCompare(b.path));
  const rankedPrefabs = snapshot.prefabs
    .filter(visible)
    .sort((a, b) => b.kb - a.kb || a.path.localeCompare(b.path));
  const entryPrefabs = snapshot.views.entryPrefabs.length
    ? snapshot.views.entryPrefabs
    : snapshot.views.rootPrefabs;

  return {
    counts,
    totalMb,
    scenes: rankedScenes.slice(0, top).map(legacyAssetEntry),
    rootPrefabs: snapshot.views.rootPrefabs.slice(0, top).map(legacyAssetEntry),
    entryPrefabs: entryPrefabs.slice(0, top).map(legacyAssetEntry),
    heaviestPrefabs: rankedPrefabs.slice(0, top).map(legacyAssetEntry),
    rootPrefabCount: snapshot.views.rootPrefabs.length,
    entryPrefabCount: snapshot.views.entryPrefabs.length,
    skippedVendorDirs: snapshot.skippedVendorDirs,
    blockers: snapshot.features.blockers.map(compactBlocker),
    snapshot,
  };
}

function analyze(srcRoot, options = {}) {
  const snapshot = buildUnityProjectSnapshot({
    sourceRoot: path.resolve(srcRoot),
    projectRoot: options.projectRoot,
    includeVendor: !!options.includeVendor,
    cache: options.cache !== false,
    cacheDir: options.cacheDir,
    refreshCache: !!options.refreshCache,
  });
  return analysisFromSnapshot(snapshot, options);
}

async function analyzeAsync(srcRoot, options = {}) {
  const intelligence = await scanUnityProject({
    project: options.projectRoot,
    sourceRoot: path.resolve(srcRoot),
    provider: options.provider || 'auto',
    bootstrap: !!options.bootstrap,
    unity: options.unity,
    mcpUrl: options.mcpUrl,
    mcpToken: process.env.UNITY_MCP_TOKEN || undefined,
    timeoutMs: options.timeoutMs,
    includeVendor: !!options.includeVendor,
    cache: options.cache !== false,
    cacheDir: options.cacheDir,
    refreshCache: !!options.refreshCache,
  });
  return {
    ...analysisFromSnapshot(intelligence.snapshot, options),
    intelligence: {
      summary: intelligence.summary,
      doctor: intelligence.doctor,
      setup: intelligence.setup,
    },
  };
}

function actionStep(step, what, why, capabilityId, extra = {}) {
  return {
    step,
    what,
    why,
    capabilityId,
    command: capabilityInvocation(capabilityId),
    ...extra,
  };
}

function buildPlan(srcRoot, analysis) {
  const prefabCount = analysis.counts.prefabs;
  const snapshot = analysis.snapshot || {
    schemaVersion: null,
    provider: 'legacy',
    project: { name: null, root: null, unityVersion: null, packages: {} },
    buildScenes: [],
    dependencies: { edgeCount: 0, unresolvedCount: 0 },
    diagnostics: [],
    cache: { enabled: false, mode: 'legacy', hits: 0, misses: 0 },
    metrics: { durationMs: null },
  };
  const entryPrefabs = Array.isArray(analysis.entryPrefabs) && analysis.entryPrefabs.length
    ? analysis.entryPrefabs
    : (analysis.rootPrefabs || []);
  const entryPrefabCount = Number.isInteger(analysis.entryPrefabCount)
    ? analysis.entryPrefabCount
    : (analysis.entryPrefabs || []).length;
  const rootPrefabCount = Number.isInteger(analysis.rootPrefabCount)
    ? analysis.rootPrefabCount
    : (analysis.rootPrefabs || []).length;
  return {
    _meta: {
      tool: 'port-plan',
      source: path.resolve(srcRoot).replace(/\\/g, '/'),
      generatedFor: 'AI agent — đọc file này TRƯỚC khi port, thay cho việc quét cây thư mục',
      note: 'Chỉ đọc Unity/Cocos project; incremental cache nằm ngoài hai project.',
      snapshotSchemaVersion: snapshot.schemaVersion,
      provider: snapshot.provider,
      liveStatus: snapshot.live && snapshot.live.status || 'not-requested',
    },
    inventory: { ...analysis.counts, totalMb: analysis.totalMb },
    estimate: {
      prefabs: prefabCount,
      secondsPerPrefabMeasured: MEASURED_SECONDS_PER_PREFAB,
      singleProcessMinutes: Math.round((prefabCount * MEASURED_SECONDS_PER_PREFAB) / 60),
      jobs4Minutes: Math.round((prefabCount * MEASURED_SECONDS_PER_PREFAB_JOBS4) / 60),
      basis: 'Đo trên MyCozyHome sau khi sửa PERF-01; không tính thời gian agent sửa tay.',
    },
    suggestedOrder: [
      {
        step: 1,
        what: entryPrefabCount ? 'Port prefab reachable từ build scene trước' : 'Port prefab gốc trước',
        why: entryPrefabCount
          ? 'Dependency graph từ build scene ưu tiên đúng gameplay thay vì demo/plugin nặng.'
          : 'Chưa resolve được build-scene graph; prefab gốc là static fallback tốt nhất.',
        items: entryPrefabs.map(item => item.path),
      },
      actionStep(2, 'Xử lý mọi dòng `high` trong report', 'high = mất hành vi hoặc mất hình ảnh.', 'port.report'),
      actionStep(3, 'Chuyển và validate shader còn thiếu', 'Shader compile được chưa chứng minh tương đương hình ảnh.', 'shader.batch', {
        verifyCapabilityId: 'shader.validate',
        verify: capabilityInvocation('shader.validate'),
      }),
      actionStep(4, 'Kiểm tra prefab đã port', 'Bắt UUID treo và script thiếu trước khi build.', 'verify.prefab'),
      actionStep(5, 'Build rồi smoke test', 'Compile được không có nghĩa playable chạy đúng.', 'build.playable', {
        verifyCapabilityId: 'verify.runtime',
        verify: capabilityInvocation('verify.runtime'),
      }),
    ],
    blockers: analysis.blockers,
    heaviestPrefabs: analysis.heaviestPrefabs,
    scenes: analysis.scenes,
    skippedVendorDirs: analysis.skippedVendorDirs,
    project: {
      name: snapshot.project.name,
      root: snapshot.project.root,
      unityVersion: snapshot.project.unityVersion,
      packages: snapshot.project.packages,
    },
    buildScenes: snapshot.buildScenes,
    dependencySummary: {
      edges: snapshot.dependencies.edgeCount,
      unresolvedGuids: snapshot.dependencies.unresolvedCount,
      unresolvedByCategory: snapshot.dependencies.classificationCounts || {},
      reachableMissing: snapshot.dependencies.classificationCounts?.['reachable-missing'] || 0,
      reachableAmbiguous: snapshot.dependencies.classificationCounts?.['reachable-ambiguous'] || 0,
      packageOrDll: snapshot.dependencies.classificationCounts?.['package-or-dll'] || 0,
      builtinOrNull: snapshot.dependencies.builtinCount || 0,
      packageGuidCatalogAssets: snapshot.assets?.packageCount || 0,
      rootPrefabs: rootPrefabCount,
      entryPrefabs: entryPrefabCount,
    },
    diagnostics: snapshot.diagnostics,
    featureSketch: snapshot.features && snapshot.features.sketch || [],
    unityEnvironment: analysis.intelligence ? {
      doctor: analysis.intelligence.doctor,
      setup: analysis.intelligence.setup,
    } : null,
    cache: snapshot.cache,
    metrics: snapshot.metrics,
  };
}

function printHuman(plan) {
  const inventory = plan.inventory;
  console.log('');
  console.log('======================================================');
  console.log(' Unity Port Planner ');
  console.log('======================================================');
  console.log(`Nguồn: ${plan._meta.source}`);
  if (plan.project.unityVersion) console.log(`Unity: ${plan.project.unityVersion}`);
  console.log('');
  console.log(`Tồn kho runtime: ${inventory.prefabs} prefab, ${inventory.scenes} scene, ${inventory.scripts} script C#, ` +
    `${inventory.shaders + inventory.shaderGraphs} shader, ${inventory.materials} material, ${inventory.models} model, ` +
    `${inventory.textures} texture, ${inventory.controllers} animator, ${inventory.audio} audio — ${inventory.totalMb} MB`);
  if (inventory.sceneObjects) {
    console.log(`Trong scene/prefab: ${inventory.sceneObjects} GameObject, ${inventory.inlineMaterials} material nhúng`);
  }
  console.log(`Index: ${plan.cache.mode}, ${plan.cache.hits} cache hit / ${plan.cache.misses} scan — ${plan.metrics.durationMs} ms`);
  if (plan.buildScenes.length) {
    const candidates = plan.buildScenes.filter(scene => scene.gameplayCandidate).map(scene => scene.path);
    console.log(`Build scene gameplay: ${candidates.join(', ') || '(chưa xác định)'}`);
  }
  if (plan.skippedVendorDirs.length) {
    console.log('');
    console.log(color('yellow', `Đã lọc ${plan.skippedVendorDirs.length} vendor/sample/editor scope khỏi porting view.`));
    console.log('  Evidence vẫn nằm trong raw index để resolve GUID; dùng --include-vendor để hiện trong view.');
  }
  console.log('');

  if (plan.blockers.length) {
    console.log(color('yellow', 'Rủi ro cần xử lý khi port:'));
    for (const blocker of plan.blockers) {
      console.log(`  • ${blocker.label} (${blocker.count} file)`);
      console.log(`      hệ quả: ${blocker.impact}`);
      console.log(`      cần làm: ${blocker.action}`);
      if (blocker.examples.length) console.log(`      ví dụ: ${blocker.examples.join(', ')}`);
    }
    console.log('');
  }

  console.log('Prefab ưu tiên:');
  for (const item of plan.suggestedOrder[0].items) console.log(`  ${item}`);
  console.log('');
  console.log('Thứ tự đề xuất:');
  for (const step of plan.suggestedOrder) {
    console.log(`  ${step.step}. ${step.what}`);
    console.log(`     ${step.why}`);
    if (step.command) console.log(`     $ ${step.command}`);
    if (step.verify) console.log(`     verify: $ ${step.verify}`);
  }
  console.log('======================================================');
  console.log('');
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} cần một giá trị.`);
  return value;
}

function parseArgs(argv) {
  const options = { top: 15, json: false, help: false, includeVendor: false, cache: true, provider: 'auto' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--include-vendor') { options.includeVendor = true; continue; }
    if (argument === '--bootstrap') { options.bootstrap = true; continue; }
    if (argument === '--no-cache') { options.cache = false; continue; }
    if (argument === '--refresh-cache') { options.refreshCache = true; continue; }
    if (argument === '--src') { options.src = readOptionValue(argv, index, '--src'); index += 1; continue; }
    if (argument.startsWith('--src=')) { options.src = argument.slice('--src='.length); continue; }
    if (argument === '--project') { options.project = readOptionValue(argv, index, '--project'); index += 1; continue; }
    if (argument.startsWith('--project=')) { options.project = argument.slice('--project='.length); continue; }
    if (argument === '--out') { options.out = readOptionValue(argv, index, '--out'); index += 1; continue; }
    if (argument.startsWith('--out=')) { options.out = argument.slice('--out='.length); continue; }
    if (argument === '--cache-dir') { options.cacheDir = readOptionValue(argv, index, '--cache-dir'); index += 1; continue; }
    if (argument.startsWith('--cache-dir=')) { options.cacheDir = argument.slice('--cache-dir='.length); continue; }
    if (argument === '--provider') { options.provider = readOptionValue(argv, index, '--provider'); index += 1; continue; }
    if (argument.startsWith('--provider=')) { options.provider = argument.slice('--provider='.length); continue; }
    if (argument === '--unity') { options.unity = readOptionValue(argv, index, '--unity'); index += 1; continue; }
    if (argument.startsWith('--unity=')) { options.unity = argument.slice('--unity='.length); continue; }
    if (argument === '--mcp-url') { options.mcpUrl = readOptionValue(argv, index, '--mcp-url'); index += 1; continue; }
    if (argument.startsWith('--mcp-url=')) { options.mcpUrl = argument.slice('--mcp-url='.length); continue; }
    if (argument === '--timeout-ms') { options.timeoutMs = Number(readOptionValue(argv, index, '--timeout-ms')); index += 1; continue; }
    if (argument.startsWith('--timeout-ms=')) { options.timeoutMs = Number(argument.slice('--timeout-ms='.length)); continue; }
    if (argument === '--top') { options.top = Number(readOptionValue(argv, index, '--top')); index += 1; continue; }
    if (argument.startsWith('--top=')) { options.top = Number(argument.slice('--top='.length)); continue; }
    throw new Error(`Option không hỗ trợ: ${argument}`);
  }
  if (!Number.isInteger(options.top) || options.top < 1) throw new Error('--top phải là số nguyên >= 1.');
  if (!['auto', 'static', 'unity-mcp'].includes(options.provider)) {
    throw new Error('--provider phải là auto, static hoặc unity-mcp.');
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250)) {
    throw new Error('--timeout-ms phải là số nguyên >= 250.');
  }
  if (options.project && !options.src) options.src = path.join(options.project, 'Assets');
  return options;
}

async function main() {
  require('./lib/auto-strip-ansi.cjs');
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[port-plan] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) { console.log(USAGE); return; }
  if (!options.src) {
    console.error('[port-plan] Thiếu --project <UnityProjectRoot> hoặc --src <UnityAssetsFolder>. Xem --help.');
    process.exitCode = 1;
    return;
  }
  const srcRoot = path.resolve(options.src);
  let stat;
  try { stat = fs.statSync(srcRoot); } catch (_) { stat = null; }
  if (!stat || !stat.isDirectory()) {
    console.error(`[port-plan] Không tìm thấy thư mục ${srcRoot}`);
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    const analysis = await analyzeAsync(srcRoot, {
      ...options,
      projectRoot: options.project ? path.resolve(options.project) : undefined,
    });
    plan = buildPlan(srcRoot, analysis, options);
  } catch (error) {
    console.error(`[port-plan] Scan thất bại: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(path.resolve(options.out), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const status = `[port-plan] Đã ghi ${options.out}`;
    if (options.json || !process.stdout.isTTY) console.error(status);
    else console.log(status);
  }
  if (options.json || !process.stdout.isTTY) console.log(JSON.stringify(plan));
  else printHuman(plan);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[port-plan] ${error.code || 'SCAN_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  analyze,
  analyzeAsync,
  analysisFromSnapshot,
  buildPlan,
  BLOCKERS,
  capabilityInvocation,
  parseArgs,
};
