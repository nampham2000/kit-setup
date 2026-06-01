#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveRootDir() {
  if (process.env.PLAYABLE_PROJECT_ROOT) {
    return path.resolve(process.env.PLAYABLE_PROJECT_ROOT);
  }

  return findProjectRoot(process.cwd())
    || findProjectRoot(path.resolve(__dirname, '..', '..'))
    || path.resolve(process.cwd());
}

const ROOT_DIR = resolveRootDir();

const CLI_CONFIG_PATH = path.join(__dirname, 'playable-cli.config.cjs');
const CLI_CONFIG_TEMPLATE_PATH = path.join(__dirname, 'playable-cli.config_TEMPLATE.cjs');

function bootstrapCliConfigFile() {
  if (fs.existsSync(CLI_CONFIG_PATH)) return;
  if (!fs.existsSync(CLI_CONFIG_TEMPLATE_PATH)) {
    console.error('[playable-cli] ERROR: Missing playable-shared-kit/tools/playable-build/playable-cli.config.cjs and playable-shared-kit/tools/playable-build/playable-cli.config_TEMPLATE.cjs');
    process.exit(1);
  }
  fs.copyFileSync(CLI_CONFIG_TEMPLATE_PATH, CLI_CONFIG_PATH);
  console.log('[playable-cli] Created playable-shared-kit/tools/playable-build/playable-cli.config.cjs from playable-shared-kit/tools/playable-build/playable-cli.config_TEMPLATE.cjs');
}

bootstrapCliConfigFile();

const {
  RETAINED_AD_PLATFORMS,
  INSTALL_DIRS,
  SUBTREE_DEFAULTS,
  DEFAULT_MEM_PER_JOB_GB,
  DEFAULT_MEM_HEADROOM_GB,
  MIN_AUTO_FREE_MEM_GB,
  UV_THREADPOOL_AUTO,
  PRIORITY_CHOICES,
  COCOS_DEFAULTS,
} = require('./playable-cli.config.cjs');

const BUILD_STATS_FILE = path.join(ROOT_DIR, 'temp', 'playable-cli-runtime', 'build-stats.json');
const BUILD_CONFIGS_DIR = path.join(ROOT_DIR, 'configs');
const BUILDER_PROFILE_PATH = path.join(ROOT_DIR, 'profiles', 'v2', 'packages', 'builder.json');

function log(message) {
  console.log(`[playable-cli] ${message}`);
}

function warn(message) {
  console.warn(`[playable-cli] WARN: ${message}`);
}

function fail(message) {
  console.error(`[playable-cli] ERROR: ${message}`);
  process.exit(1);
}

function loadBuildConfigs() {
  if (!fs.existsSync(BUILD_CONFIGS_DIR)) {
    return {};
  }

  const entries = fs.readdirSync(BUILD_CONFIGS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .sort((a, b) => a.name.localeCompare(b.name));

  const configs = {};
  for (const entry of entries) {
    const brief = normalizeBriefName(path.basename(entry.name, '.json'));
    if (configs[brief]) {
      fail(`Duplicate build config name in ${path.relative(ROOT_DIR, BUILD_CONFIGS_DIR)}: ${entry.name}`);
    }
    configs[brief] = path.join('configs', entry.name);
  }
  return configs;
}

const BUILD_CONFIGS = loadBuildConfigs();

function printHelp() {
  console.log(`
Playable CLI

Usage:
  node playable-shared-kit/tools/playable-build.cjs <command> [options]

Commands:
  doctor
      Validate local setup and print detected Cocos Creator path.

  export-build-configs [--source <path>] [--out <path>]
      Export build task options from profiles/v2/packages/builder.json into ./configs.
      --source <path>     Override builder profile json path.
      --out <path>        Override output config directory.

  install [--clean]
      Install npm dependencies for root + required extensions.
      --clean removes each node_modules before npm install.

  build [--all] [--brief <name>] [--clean|--no-clean] [--cocos <path>] [--jobs <n>|--parallel|--sequential]
        [--mem-per-job-gb <n>] [--priority <low|normal|high>]
        [--uv-threadpool-size <n|auto>] [--aggressive] [--no-worker-temp] [--no-smart-order]
    Build one or more configs from ./configs.
    --all               Build all *.json config files in ./configs.
    --brief <name>      Build one config by filename (without .json). Can be used multiple times.
      --clean             Remove ./build before building (default: true).
      --no-clean          Keep existing ./build folder.
      --cocos <path>      Cocos Creator executable path override.
      --parallel          Auto jobs by CPU cores (default).
      --jobs <n>          Max parallel builds.
      --sequential        Force jobs=1.
      --mem-per-job-gb    Estimated RAM per Cocos worker (default: ${DEFAULT_MEM_PER_JOB_GB} GB, auto mode only).
      --priority          Process priority for Cocos workers (default: normal).
      --uv-threadpool-size
                         Set UV_THREADPOOL_SIZE per worker (or "auto").
      --aggressive        Shortcut for CPU-heavy mode (priority high + uv threadpool auto).
      --no-worker-temp    Use system TEMP/TMP instead of isolated temp folder per brief.
      --no-smart-order    Keep requested brief order (skip historical duration scheduling).
      Note: if parallel workers fail, CLI retries failed briefs sequentially.

  subtree-pull [--prefix <path>] [--remote <url>] [--branch <name>] [--no-squash]
      Pull playable core via git subtree.
      Default prefix: ${SUBTREE_DEFAULTS.prefix}
      Default remote: ${SUBTREE_DEFAULTS.remote}
      Default branch: ${SUBTREE_DEFAULTS.branch}
      Requires clean tracked working tree (same as legacy script).

Examples:
  npm run doctor
  npm run setup
  node playable-shared-kit/tools/playable-build.cjs build --brief brief1
  node playable-shared-kit/tools/playable-build.cjs build --all --cocos "C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe"
  node playable-shared-kit/tools/playable-build.cjs subtree-pull
`);
}

function normalizeBriefName(value) {
  if (!value) return '';
  const v = String(value).trim().toLowerCase();
  if (/^\d+$/.test(v)) return `brief${v}`;
  return v;
}

function parsePositiveIntOption(value, optionName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail(`${optionName} requires a positive integer`);
  }
  return parsed;
}

function parsePositiveNumberOption(value, optionName) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${optionName} requires a positive number`);
  }
  return parsed;
}

function parsePriorityOption(value, optionName = '--priority') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!PRIORITY_CHOICES.includes(normalized)) {
    fail(`${optionName} must be one of: ${PRIORITY_CHOICES.join(', ')}`);
  }
  return normalized;
}

function parseUvThreadpoolSizeOption(value, optionName = '--uv-threadpool-size') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'auto') return UV_THREADPOOL_AUTO;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 128) {
    fail(`${optionName} requires integer 1..128 or "auto"`);
  }
  return parsed;
}

function parseBuildOptions(args) {
  const briefs = [];
  let clean = true;
  let cocosPath = '';
  let buildAll = false;
  let jobs = 0; // 0 = auto
  let memPerJobGb = DEFAULT_MEM_PER_JOB_GB;
  let useWorkerTemp = true;
  let smartOrder = true;
  let priority = 'normal';
  let uvThreadpoolSize = 0;
  let aggressive = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') {
      buildAll = true;
      continue;
    }
    if (arg === '--clean') {
      clean = true;
      continue;
    }
    if (arg === '--no-clean') {
      clean = false;
      continue;
    }
    if (arg === '--brief') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --brief');
      briefs.push(normalizeBriefName(value));
      i += 1;
      continue;
    }
    if (arg.startsWith('--brief=')) {
      briefs.push(normalizeBriefName(arg.slice('--brief='.length)));
      continue;
    }
    if (arg === '--cocos') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --cocos');
      cocosPath = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--cocos=')) {
      cocosPath = arg.slice('--cocos='.length);
      continue;
    }
    if (arg === '--jobs' || arg === '-j') {
      const value = args[i + 1];
      if (!value) fail(`Missing value for ${arg}`);
      jobs = parsePositiveIntOption(value, '--jobs');
      i += 1;
      continue;
    }
    if (arg.startsWith('--jobs=')) {
      jobs = parsePositiveIntOption(arg.slice('--jobs='.length), '--jobs');
      continue;
    }
    if (arg === '--parallel') {
      jobs = 0;
      continue;
    }
    if (arg.startsWith('--parallel=')) {
      jobs = parsePositiveIntOption(arg.slice('--parallel='.length), '--parallel');
      continue;
    }
    if (arg === '--sequential' || arg === '--no-parallel') {
      jobs = 1;
      continue;
    }
    if (arg === '--mem-per-job-gb') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --mem-per-job-gb');
      memPerJobGb = parsePositiveNumberOption(value, '--mem-per-job-gb');
      i += 1;
      continue;
    }
    if (arg.startsWith('--mem-per-job-gb=')) {
      memPerJobGb = parsePositiveNumberOption(arg.slice('--mem-per-job-gb='.length), '--mem-per-job-gb');
      continue;
    }
    if (arg === '--priority') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --priority');
      priority = parsePriorityOption(value, '--priority');
      i += 1;
      continue;
    }
    if (arg.startsWith('--priority=')) {
      priority = parsePriorityOption(arg.slice('--priority='.length), '--priority');
      continue;
    }
    if (arg === '--uv-threadpool-size') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --uv-threadpool-size');
      uvThreadpoolSize = parseUvThreadpoolSizeOption(value, '--uv-threadpool-size');
      i += 1;
      continue;
    }
    if (arg.startsWith('--uv-threadpool-size=')) {
      uvThreadpoolSize = parseUvThreadpoolSizeOption(arg.slice('--uv-threadpool-size='.length), '--uv-threadpool-size');
      continue;
    }
    if (arg === '--aggressive') {
      aggressive = true;
      continue;
    }
    if (arg === '--no-worker-temp') {
      useWorkerTemp = false;
      continue;
    }
    if (arg === '--worker-temp') {
      useWorkerTemp = true;
      continue;
    }
    if (arg === '--no-smart-order') {
      smartOrder = false;
      continue;
    }
    if (arg === '--smart-order') {
      smartOrder = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('--')) {
      briefs.push(normalizeBriefName(arg));
      continue;
    }
    fail(`Unknown option: ${arg}`);
  }

  const finalBriefs = buildAll || briefs.length === 0
    ? Object.keys(BUILD_CONFIGS)
    : Array.from(new Set(briefs));

  const unknownBriefs = finalBriefs.filter((brief) => !BUILD_CONFIGS[brief]);
  if (unknownBriefs.length > 0) {
    fail(`Unknown brief(s): ${unknownBriefs.join(', ')}. Valid: ${Object.keys(BUILD_CONFIGS).join(', ')}`);
  }

  return {
    briefs: finalBriefs,
    clean,
    cocosPath,
    jobs,
    memPerJobGb,
    priority,
    uvThreadpoolSize,
    aggressive,
    useWorkerTemp,
    smartOrder,
  };
}

function parseInstallOptions(args) {
  let clean = false;
  for (const arg of args) {
    if (arg === '--clean') {
      clean = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    fail(`Unknown option for install: ${arg}`);
  }
  return { clean };
}

function parseExportBuildConfigsOptions(args) {
  let sourcePath = BUILDER_PROFILE_PATH;
  let outDir = BUILD_CONFIGS_DIR;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --source');
      sourcePath = resolveProjectPath(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--source=')) {
      sourcePath = resolveProjectPath(arg.slice('--source='.length));
      continue;
    }
    if (arg === '--out') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --out');
      outDir = resolveProjectPath(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outDir = resolveProjectPath(arg.slice('--out='.length));
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    fail(`Unknown option for export-build-configs: ${arg}`);
  }

  return { sourcePath, outDir };
}

function parseSubtreePullOptions(args) {
  let prefix = SUBTREE_DEFAULTS.prefix;
  let remote = SUBTREE_DEFAULTS.remote;
  let branch = SUBTREE_DEFAULTS.branch;
  let squash = SUBTREE_DEFAULTS.squash;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--prefix') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --prefix');
      prefix = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      prefix = arg.slice('--prefix='.length);
      continue;
    }
    if (arg === '--remote' || arg === '--remote-url') {
      const value = args[i + 1];
      if (!value) fail(`Missing value for ${arg}`);
      remote = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--remote=')) {
      remote = arg.slice('--remote='.length);
      continue;
    }
    if (arg.startsWith('--remote-url=')) {
      remote = arg.slice('--remote-url='.length);
      continue;
    }
    if (arg === '--branch') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --branch');
      branch = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--branch=')) {
      branch = arg.slice('--branch='.length);
      continue;
    }
    if (arg === '--no-squash') {
      squash = false;
      continue;
    }
    if (arg === '--squash') {
      squash = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    fail(`Unknown option for subtree-pull: ${arg}`);
  }

  prefix = `${prefix ?? ''}`.trim();
  remote = `${remote ?? ''}`.trim();
  branch = `${branch ?? ''}`.trim();

  if (!prefix) fail('subtree-pull requires non-empty --prefix');
  if (!remote) fail('subtree-pull requires non-empty --remote');
  if (!branch) fail('subtree-pull requires non-empty --branch');

  return { prefix, remote, branch, squash };
}

function versionToParts(version) {
  return String(version)
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}

function compareVersionDesc(a, b) {
  const pa = versionToParts(a);
  const pb = versionToParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return vb - va;
  }
  return 0;
}

function getDefaultCocosCandidates() {
  const candidates = [];

  if (process.platform === 'win32') {
    const base = COCOS_DEFAULTS?.win32?.versionBaseDir || '';
    const exeRel = COCOS_DEFAULTS?.win32?.versionExecutable || 'CocosCreator.exe';
    if (base && fs.existsSync(base)) {
      const versions = fs.readdirSync(base, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort(compareVersionDesc);

      for (const version of versions) {
        candidates.push(path.join(base, version, exeRel));
      }
    }
    const fallback = Array.isArray(COCOS_DEFAULTS?.win32?.fallbackPaths) ? COCOS_DEFAULTS.win32.fallbackPaths : [];
    candidates.push(...fallback);
  }

  if (process.platform === 'darwin') {
    const appBase = COCOS_DEFAULTS?.darwin?.versionBaseDir || '';
    const exeRel = COCOS_DEFAULTS?.darwin?.versionExecutable || 'CocosCreator.app/Contents/MacOS/CocosCreator';
    if (appBase && fs.existsSync(appBase)) {
      const versions = fs.readdirSync(appBase, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort(compareVersionDesc);

      for (const version of versions) {
        candidates.push(path.join(appBase, version, exeRel));
      }
    }
    const fallback = Array.isArray(COCOS_DEFAULTS?.darwin?.fallbackPaths) ? COCOS_DEFAULTS.darwin.fallbackPaths : [];
    candidates.push(...fallback);
  }

  if (process.platform === 'linux') {
    const fallback = Array.isArray(COCOS_DEFAULTS?.linux?.fallbackPaths) ? COCOS_DEFAULTS.linux.fallbackPaths : [];
    candidates.push(...fallback);
  }

  return candidates;
}

function resolveCocosPath(explicitPath) {
  const envPath = process.env.COCOS_CREATOR || process.env.COCOS_PATH;
  const inputCandidates = [
    explicitPath,
    envPath,
    ...getDefaultCocosCandidates(),
  ].filter(Boolean);

  for (const candidate of inputCandidates) {
    const fullPath = path.isAbsolute(candidate) ? candidate : path.resolve(ROOT_DIR, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return '';
}

function runCommand(command, args, cwd, opts = {}) {
  const env = { ...process.env };
  const unsetEnv = Array.isArray(opts.unsetEnv) ? opts.unsetEnv : [];
  const allowedExitCodes = Array.isArray(opts.allowedExitCodes) ? opts.allowedExitCodes : [];
  const setEnv = opts.setEnv && typeof opts.setEnv === 'object' ? opts.setEnv : {};
  for (const key of unsetEnv) {
    delete env[key];
  }
  Object.assign(env, setEnv);

  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env,
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0 && !allowedExitCodes.includes(result.status)) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }

  return result;
}

function runCommandAsync(command, args, cwd, opts = {}) {
  const env = { ...process.env };
  const unsetEnv = Array.isArray(opts.unsetEnv) ? opts.unsetEnv : [];
  const allowedExitCodes = Array.isArray(opts.allowedExitCodes) ? opts.allowedExitCodes : [];
  const setEnv = opts.setEnv && typeof opts.setEnv === 'object' ? opts.setEnv : {};
  const onSpawn = typeof opts.onSpawn === 'function' ? opts.onSpawn : null;
  for (const key of unsetEnv) {
    delete env[key];
  }
  Object.assign(env, setEnv);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env,
    });
    if (onSpawn) {
      try {
        onSpawn(child);
      } catch (error) {
        warn(`onSpawn hook failed: ${error.message || error}`);
      }
    }

    child.on('error', (error) => reject(error));
    child.on('close', (status, signal) => {
      if (typeof status === 'number' && status !== 0 && !allowedExitCodes.includes(status)) {
        reject(new Error(`Command failed (${status}): ${command} ${args.join(' ')}`));
        return;
      }
      resolve({ status, signal });
    });
  });
}

function resolveProjectPath(rawPath) {
  if (!rawPath) return '';
  if (rawPath.startsWith('project://')) {
    const rel = rawPath.slice('project://'.length).replace(/^[/\\]+/, '');
    return path.join(ROOT_DIR, rel);
  }
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(ROOT_DIR, rawPath);
}

function readBuildConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function getBuildPathFromConfig(configPath) {
  const config = readBuildConfig(configPath);
  return resolveProjectPath(config.buildPath);
}

function movePathFast(src, dst) {
  if (fs.existsSync(dst)) {
    fs.rmSync(dst, { recursive: true, force: true });
  }
  try {
    fs.renameSync(src, dst);
    return true;
  } catch (error) {
    const recoverableCodes = new Set(['EXDEV', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EBUSY']);
    if (!error || !recoverableCodes.has(error.code)) {
      throw error;
    }
    fs.cpSync(src, dst, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
    return false;
  }
}

function pruneBuildPlatformOutputs(buildPath) {
  const retained = new Set(['common', ...(RETAINED_AD_PLATFORMS || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean)]);
  const removed = [];

  for (const entry of fs.readdirSync(buildPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (retained.has(entry.name.toLowerCase())) continue;
    fs.rmSync(path.join(buildPath, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }

  if (removed.length > 0) {
    log(`Removed platform outputs from ${path.relative(ROOT_DIR, buildPath)}: ${removed.join(', ')}`);
  }
}

function processBuildOutputByPath(buildPath) {
  if (!buildPath) {
    warn('Missing build path');
    return;
  }
  if (!fs.existsSync(buildPath)) {
    warn(`Build folder not found: ${buildPath}`);
    return;
  }

  const webMobileDir = path.join(buildPath, 'web-mobile');
  if (fs.existsSync(webMobileDir)) {
    fs.rmSync(webMobileDir, { recursive: true, force: true });
    log(`Removed ${path.relative(ROOT_DIR, webMobileDir)}`);
  }

  const superHtmlDir = path.join(buildPath, 'super-html');
  if (fs.existsSync(superHtmlDir)) {
    let movedCount = 0;
    let copiedCount = 0;
    for (const item of fs.readdirSync(superHtmlDir)) {
      const src = path.join(superHtmlDir, item);
      const dst = path.join(buildPath, item);
      if (movePathFast(src, dst)) {
        movedCount += 1;
      } else {
        copiedCount += 1;
      }
    }
    fs.rmSync(superHtmlDir, { recursive: true, force: true });
    const moveSummary = copiedCount > 0
      ? `${movedCount} moved, ${copiedCount} copied`
      : `${movedCount} moved`;
    log(`Flattened super-html output into ${path.relative(ROOT_DIR, buildPath)} (${moveSummary})`);
  }

  pruneBuildPlatformOutputs(buildPath);
}

function processBuildOutput(configPath) {
  const buildPath = getBuildPathFromConfig(configPath);
  processBuildOutputByPath(buildPath);
}

function cleanBuildOutput(buildPath) {
  if (!buildPath || !fs.existsSync(buildPath)) return;
  fs.rmSync(buildPath, { recursive: true, force: true });
}

function cleanBuildOutputByConfig(configPath) {
  cleanBuildOutput(getBuildPathFromConfig(configPath));
}

function exportBuildConfigs(options) {
  const sourcePath = options?.sourcePath || BUILDER_PROFILE_PATH;
  const outDir = options?.outDir || BUILD_CONFIGS_DIR;

  if (!fs.existsSync(sourcePath)) {
    fail(`Builder profile not found: ${sourcePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const taskMap = raw?.BuildTaskManager?.taskMap || {};
  const tasks = Object.values(taskMap)
    .filter((task) => task?.type === 'build' && task?.options?.taskName)
    .sort((a, b) => (Number.parseInt(String(b.id), 10) || 0) - (Number.parseInt(String(a.id), 10) || 0));

  if (tasks.length === 0) {
    fail(`No build tasks with options.taskName found in ${path.relative(ROOT_DIR, sourcePath)}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const exported = [];
  const seen = new Set();
  for (const task of tasks) {
    const taskName = String(task.options.taskName).trim();
    if (!taskName || seen.has(taskName)) continue;
    seen.add(taskName);

    const outPath = path.join(outDir, `${taskName}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(task.options, null, 2)}\n`, 'utf8');
    exported.push(path.relative(ROOT_DIR, outPath));
  }

  log(`Exported ${exported.length} build config(s) from ${path.relative(ROOT_DIR, sourcePath)}`);
  log(`Configs written: ${exported.join(', ')}`);
}

function getCpuCoreCount() {
  if (typeof os.availableParallelism === 'function') {
    return Math.max(1, os.availableParallelism());
  }
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 1;
  return Math.max(1, cpuCount || 1);
}

function bytesToGb(bytes) {
  return bytes / (1024 * 1024 * 1024);
}

function formatGb(bytes) {
  return `${bytesToGb(bytes).toFixed(1)}GB`;
}

function resolvePriorityValue(priorityName) {
  const constants = os.constants?.priority || {};
  if (priorityName === 'low') {
    return constants.PRIORITY_BELOW_NORMAL ?? constants.PRIORITY_LOW ?? 10;
  }
  if (priorityName === 'high') {
    return constants.PRIORITY_ABOVE_NORMAL ?? constants.PRIORITY_HIGH ?? -7;
  }
  return constants.PRIORITY_NORMAL ?? 0;
}

function trySetProcessPriority(pid, priorityName) {
  if (priorityName === 'normal') return;
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    os.setPriority(pid, resolvePriorityValue(priorityName));
  } catch (error) {
    warn(`Could not set worker priority "${priorityName}" for PID ${pid}: ${error.message || error}`);
  }
}

function resolveAutoUvThreadpoolSize(cpuLimit, concurrency) {
  const perWorkerCpu = Math.max(1, Math.floor(Math.max(1, cpuLimit) / Math.max(1, concurrency)));
  return Math.max(4, Math.min(64, perWorkerCpu * 2));
}

function resolveBuildConcurrency(totalBuilds, jobsOption, memPerJobGb) {
  const cpuLimit = getCpuCoreCount();
  if (totalBuilds <= 1) {
    return { concurrency: 1, mode: 'single', cpuLimit };
  }
  if (jobsOption >= 1) {
    return { concurrency: Math.min(totalBuilds, jobsOption), mode: 'manual', cpuLimit };
  }

  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const memPerJobBytes = Math.max(0.25, memPerJobGb) * 1024 * 1024 * 1024;
  const reservedHeadroomBytes = DEFAULT_MEM_HEADROOM_GB * 1024 * 1024 * 1024;
  const minFreeMemBytes = MIN_AUTO_FREE_MEM_GB * 1024 * 1024 * 1024;
  const maxUsableBytes = Math.max(minFreeMemBytes, totalMemBytes - reservedHeadroomBytes);
  const softUsableBytes = Math.max(
    minFreeMemBytes,
    Math.min(maxUsableBytes, freeMemBytes + totalMemBytes * 0.2),
  );

  const memLimit = Math.max(1, Math.floor(softUsableBytes / memPerJobBytes));
  const concurrency = Math.max(1, Math.min(totalBuilds, cpuLimit, memLimit));

  return {
    concurrency,
    mode: 'auto',
    cpuLimit,
    memLimit,
    totalMemBytes,
    freeMemBytes,
    softUsableBytes,
    memPerJobGb,
  };
}

function loadBuildStats() {
  try {
    if (!fs.existsSync(BUILD_STATS_FILE)) return {};
    const raw = fs.readFileSync(BUILD_STATS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    warn(`Could not read build stats cache: ${error.message || error}`);
  }
  return {};
}

function saveBuildStats(stats) {
  try {
    fs.mkdirSync(path.dirname(BUILD_STATS_FILE), { recursive: true });
    fs.writeFileSync(BUILD_STATS_FILE, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  } catch (error) {
    warn(`Could not write build stats cache: ${error.message || error}`);
  }
}

function getEstimatedBuildDurationMs(stats, brief) {
  const value = Number(stats?.[brief]?.avgMs ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function recordBuildDuration(stats, brief, durationMs) {
  const safeDurationMs = Math.max(1, Math.round(durationMs));
  const previous = stats[brief];
  if (!previous) {
    stats[brief] = {
      runs: 1,
      lastMs: safeDurationMs,
      avgMs: safeDurationMs,
      updatedAt: new Date().toISOString(),
    };
    return;
  }
  const previousAvg = Number(previous.avgMs) || safeDurationMs;
  const nextAvg = Math.round((previousAvg * 0.65) + (safeDurationMs * 0.35));
  stats[brief] = {
    runs: (Number(previous.runs) || 0) + 1,
    lastMs: safeDurationMs,
    avgMs: nextAvg,
    updatedAt: new Date().toISOString(),
  };
}

function orderTasksByEstimatedDuration(tasks, buildStats, enabled) {
  const enriched = tasks.map((task) => ({
    ...task,
    expectedMs: getEstimatedBuildDurationMs(buildStats, task.brief),
  }));
  if (!enabled) return enriched;
  const hasHistory = enriched.some((task) => task.expectedMs > 0);
  if (!hasHistory) return enriched;
  enriched.sort((a, b) => b.expectedMs - a.expectedMs);
  log(`Smart order: ${enriched.map((task) => `${task.brief}~${(task.expectedMs / 1000).toFixed(1)}s`).join(' -> ')}`);
  return enriched;
}

function attachWorkerTemp(task, useWorkerTemp) {
  if (!useWorkerTemp) {
    return { ...task, workerTempDir: '', workerEnv: undefined };
  }
  const safeBrief = task.brief.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  const workerTempDir = path.join(ROOT_DIR, 'temp', 'playable-cli-runtime', safeBrief);
  fs.mkdirSync(workerTempDir, { recursive: true });
  const workerEnv = {
    TMP: workerTempDir,
    TEMP: workerTempDir,
  };
  if (process.platform !== 'win32') {
    workerEnv.TMPDIR = workerTempDir;
  }
  return { ...task, workerTempDir, workerEnv };
}

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });

  await Promise.all(runners);
}

async function runBuildTask(task, cocosPath, runtimeOptions = {}) {
  const { brief, configPath, buildPath, workerEnv, workerTempDir } = task;
  const processPriority = runtimeOptions.processPriority || 'normal';
  const uvThreadpoolSize = Number(runtimeOptions.uvThreadpoolSize) || 0;
  const effectiveEnv = {
    ...(workerEnv || {}),
  };
  if (uvThreadpoolSize > 0) {
    effectiveEnv.UV_THREADPOOL_SIZE = String(uvThreadpoolSize);
  }
  const withTemp = workerTempDir ? ` (temp: ${path.relative(ROOT_DIR, workerTempDir)})` : '';
  log(`Building ${brief} with ${path.relative(ROOT_DIR, configPath)}${withTemp}`);

  const result = await runCommandAsync(
    cocosPath,
    ['--project', ROOT_DIR, '--build', `configPath=${configPath}`],
    ROOT_DIR,
    {
      unsetEnv: ['ELECTRON_RUN_AS_NODE'],
      allowedExitCodes: [36],
      setEnv: effectiveEnv,
      onSpawn: (child) => trySetProcessPriority(child.pid, processPriority),
    },
  );

  if (typeof result.status === 'number' && result.status === 36) {
    if (buildPath && fs.existsSync(buildPath)) {
      warn(`Cocos exited with code 36 but build output exists at ${path.relative(ROOT_DIR, buildPath)}. Continuing.`);
    } else {
      throw new Error(`Cocos exited with code 36 and no build output found for ${brief}.`);
    }
  }

  processBuildOutputByPath(buildPath);
  log(`Build done: ${brief}`);
}

async function buildBriefs(options) {
  const {
    briefs,
    clean,
    cocosPath: explicitCocosPath,
    jobs,
    memPerJobGb,
    priority,
    uvThreadpoolSize,
    aggressive,
    useWorkerTemp,
    smartOrder,
  } = options;
  const cocosPath = resolveCocosPath(explicitCocosPath);

  if (!cocosPath) {
    fail('Could not find Cocos Creator executable. Set COCOS_CREATOR or pass --cocos "<path>".');
  }

  log(`Using Cocos Creator: ${cocosPath}`);

  const buildRoot = path.join(ROOT_DIR, 'build');
  if (clean && fs.existsSync(buildRoot)) {
    fs.rmSync(buildRoot, { recursive: true, force: true });
    log('Cleaned build directory');
  }

  const buildStats = loadBuildStats();
  const taskBase = briefs.map((brief) => {
    const configRel = BUILD_CONFIGS[brief];
    const configPath = path.join(ROOT_DIR, configRel);
    if (!fs.existsSync(configPath)) {
      fail(`Config file not found for ${brief}: ${configRel}`);
    }
    const buildPath = getBuildPathFromConfig(configPath);
    return { brief, configPath, buildPath };
  });

  const orderedTasks = orderTasksByEstimatedDuration(taskBase, buildStats, smartOrder);
  const tasks = orderedTasks.map((task) => attachWorkerTemp(task, useWorkerTemp));

  if (useWorkerTemp) {
    log(`Worker temp root: ${path.relative(ROOT_DIR, path.dirname(BUILD_STATS_FILE))}`);
  } else {
    log('Worker temp isolation disabled (--no-worker-temp)');
  }

  const plan = resolveBuildConcurrency(tasks.length, jobs, memPerJobGb);
  const concurrency = plan.concurrency;
  let effectivePriority = priority;
  let effectiveUvThreadpoolSize = uvThreadpoolSize;
  if (aggressive) {
    if (effectivePriority === 'normal') effectivePriority = 'high';
    if (effectiveUvThreadpoolSize === 0) effectiveUvThreadpoolSize = UV_THREADPOOL_AUTO;
  }
  if (effectiveUvThreadpoolSize === UV_THREADPOOL_AUTO) {
    effectiveUvThreadpoolSize = resolveAutoUvThreadpoolSize(plan.cpuLimit, concurrency);
  }

  if (plan.mode === 'manual') {
    log(`Build workers: ${concurrency}/${tasks.length} (manual --jobs)`);
  } else if (plan.mode === 'single') {
    log(`Build workers: ${concurrency}/${tasks.length}`);
  } else {
    log(
      `Build workers: ${concurrency}/${tasks.length} `
      + `(cpu=${plan.cpuLimit}, mem-limit=${plan.memLimit}, free=${formatGb(plan.freeMemBytes)}, `
      + `budget=${formatGb(plan.softUsableBytes)}, est/job=${plan.memPerJobGb}GB)`,
    );
  }
  if (effectivePriority !== 'normal') {
    log(`Worker priority: ${effectivePriority}`);
  }
  if (effectiveUvThreadpoolSize > 0) {
    log(`UV threadpool size/worker: ${effectiveUvThreadpoolSize}`);
  }

  const startedAt = Date.now();
  const failures = [];
  let statsDirty = false;
  const runtimeOptions = {
    processPriority: effectivePriority,
    uvThreadpoolSize: effectiveUvThreadpoolSize,
  };

  try {
    await runWithConcurrency(tasks, concurrency, async (task) => {
      const taskStartedAt = Date.now();
      try {
        await runBuildTask(task, cocosPath, runtimeOptions);
        recordBuildDuration(buildStats, task.brief, Date.now() - taskStartedAt);
        statsDirty = true;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        failures.push({ task, error: new Error(message) });
        warn(`Build failed in ${task.brief}: ${message}`);
      }
    });

    if (failures.length > 0) {
      if (concurrency <= 1) {
        throw failures[0].error;
      }

      warn(`Parallel build failed for ${failures.length}/${tasks.length} brief(s). Retrying failed briefs sequentially...`);
      for (const item of failures) {
        const { task } = item;
        warn(`Retrying ${task.brief} in sequential mode...`);
        cleanBuildOutput(task.buildPath);

        const retryStartedAt = Date.now();
        await runBuildTask(task, cocosPath, runtimeOptions);
        recordBuildDuration(buildStats, task.brief, Date.now() - retryStartedAt);
        statsDirty = true;
      }
    }
  } finally {
    if (statsDirty) {
      saveBuildStats(buildStats);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`All builds completed in ${elapsedSec}s`);
}

function installDependencies(options) {
  const { clean } = options;
  const isWindows = process.platform === 'win32';
  const windowsShell = process.env.ComSpec || 'cmd.exe';

  for (const relDir of INSTALL_DIRS) {
    const fullDir = path.join(ROOT_DIR, relDir);
    if (!fs.existsSync(fullDir)) {
      warn(`Directory does not exist, skipped: ${relDir}`);
      continue;
    }

    const packageJsonPath = path.join(fullDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      log(`No package.json in ${relDir}, skipped`);
      continue;
    }

    if (clean) {
      const nodeModulesPath = path.join(fullDir, 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        fs.rmSync(nodeModulesPath, { recursive: true, force: true });
        log(`Removed ${path.relative(ROOT_DIR, nodeModulesPath)}`);
      }
    }

    log(`npm install in ${relDir}`);
    if (isWindows) {
      runCommand(windowsShell, ['/d', '/s', '/c', 'npm', 'install'], fullDir);
    } else {
      runCommand('npm', ['install'], fullDir);
    }
  }
}

function ensureCleanTrackedWorkingTree() {
  const result = spawnSync('git', ['diff-index', '--quiet', 'HEAD', '--'], {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error('Working tree has tracked changes. Commit or stash before subtree pull.');
  }
}

function subtreePull(options) {
  const { prefix, remote, branch, squash } = options;

  log('Checking repository status...');
  runCommand('git', ['status'], ROOT_DIR);

  ensureCleanTrackedWorkingTree();

  const args = ['subtree', 'pull', '--prefix', prefix, remote, branch];
  if (squash) args.push('--squash');

  log(`Pulling subtree: prefix="${prefix}", branch="${branch}"`);
  runCommand('git', args, ROOT_DIR);
  log('Subtree pull completed.');
}

function runDoctor() {
  log(`Project root: ${ROOT_DIR}`);
  log(`Node version: ${process.version}`);

  const configNames = Object.keys(BUILD_CONFIGS);
  if (configNames.length === 0) {
    warn(`No build config files found in ${path.relative(ROOT_DIR, BUILD_CONFIGS_DIR)}`);
  }

  const missingConfigs = Object.entries(BUILD_CONFIGS)
    .filter(([, configRel]) => !fs.existsSync(path.join(ROOT_DIR, configRel)))
    .map(([brief]) => brief);

  if (missingConfigs.length > 0) {
    warn(`Missing brief config(s): ${missingConfigs.join(', ')}`);
  } else if (configNames.length > 0) {
    log(`Configs OK: ${configNames.join(', ')}`);
  }

  const missingInstallDirs = INSTALL_DIRS
    .filter((relDir) => !fs.existsSync(path.join(ROOT_DIR, relDir)));
  if (missingInstallDirs.length > 0) {
    warn(`Missing install dir(s): ${missingInstallDirs.join(', ')}`);
  } else {
    log('Install directories OK');
  }

  const cocosPath = resolveCocosPath('');
  if (cocosPath) {
    log(`Detected Cocos Creator: ${cocosPath}`);
  } else {
    warn('Cocos Creator executable not detected.');
    warn('Set COCOS_CREATOR environment variable or use --cocos when building.');
  }
}

async function main() {
  const [, , command = 'help', ...args] = process.argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  try {
    if (command === 'doctor') {
      runDoctor();
      return;
    }

    if (command === 'install') {
      const options = parseInstallOptions(args);
      installDependencies(options);
      return;
    }

    if (command === 'export-build-configs') {
      const options = parseExportBuildConfigsOptions(args);
      exportBuildConfigs(options);
      return;
    }

    if (command === 'build') {
      const options = parseBuildOptions(args);
      await buildBriefs(options);
      return;
    }

    if (command === 'subtree-pull') {
      const options = parseSubtreePullOptions(args);
      subtreePull(options);
      return;
    }

    fail(`Unknown command: ${command}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    fail(message);
  }
}

main();
