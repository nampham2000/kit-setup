#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[0-9a-f]+)?/gi;
const NON_DEPENDENCY_EXTENSIONS = new Set(['.js', '.json', '.scene', '.ts']);

function fail(message) {
  console.error(`[unused-prefab-cleanup] ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[unused-prefab-cleanup] ${message}`);
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'assets')) &&
      fs.existsSync(path.join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseArgs(argv) {
  const options = {
    delete: false,
    help: false,
    projectRoot: '',
    prefabDir: 'assets/prefabs',
    scenes: [],
    roots: [],
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--delete') options.delete = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--project-root') options.projectRoot = argv[++index] || '';
    else if (arg === '--prefab-dir') options.prefabDir = argv[++index] || '';
    else if (arg === '--scene') options.scenes.push(argv[++index] || '');
    else if (arg === '--root') options.roots.push(argv[++index] || '');
    else fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
Cocos Unused Prefab Cleanup

Usage:
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs [options]

Options:
  --project-root <path>  Cocos project root. Default: auto-detect from cwd.
  --prefab-dir <path>    Prefab folder to clean. Default: assets/prefabs.
  --scene <path>         Runtime scene root. Repeatable. Default: assets/Scene/Gameplay.scene.
  --root <path>          Extra runtime asset root. Repeatable.
  --delete               Delete confirmed unused prefabs and exclusive dependencies.
  --json                 Print the complete audit report as JSON.
  --help, -h             Show help.

Examples:
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs --json
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs --root assets/prefabs/PowerText/PowerText.prefab --delete
`);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function collectOwnedUuids(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectOwnedUuids(item, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;

  for (const [key, item] of Object.entries(value)) {
    if (key === 'uuid' && typeof item === 'string') {
      const match = item.match(UUID_PATTERN);
      if (match?.[0]) result.add(match[0].toLowerCase());
    } else {
      collectOwnedUuids(item, result);
    }
  }
  return result;
}

function extractKnownUuids(file, knownUuids) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return new Set();
  }

  const result = new Set();
  for (const match of content.matchAll(UUID_PATTERN)) {
    const uuid = match[0].toLowerCase();
    if (knownUuids.has(uuid)) result.add(uuid);
  }
  return result;
}

function normalizeAssetPath(projectRoot, value) {
  if (!value) return '';
  const absolute = path.resolve(projectRoot, value);
  const relative = toPosix(path.relative(projectRoot, absolute));
  if (relative.startsWith('../') || path.isAbsolute(relative)) {
    fail(`Path is outside project root: ${value}`);
  }
  return relative;
}

function detectDynamicResourceRoots(projectRoot, assetFiles) {
  const roots = new Set();
  const loadPattern =
    /\bresources\s*\.\s*load\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*(Prefab|JsonAsset|Material|SpriteFrame|AudioClip)\b/g;
  const assetPathLiteralPattern =
    /(['"`])((?:prefabs|json)\/[^'"`]+)\1/g;

  function addExistingCandidates(resourcePath, extension) {
    const normalized = resourcePath.replace(/^\/+/, '');
    for (const candidate of [
      `assets/${normalized}${extension}`,
      `assets/resources/${normalized}${extension}`,
    ]) {
      if (fs.existsSync(path.join(projectRoot, candidate))) roots.add(candidate);
    }
  }

  for (const relativeFile of assetFiles) {
    if (!/\.(?:js|ts)$/.test(relativeFile)) continue;
    const content = fs.readFileSync(path.join(projectRoot, relativeFile), 'utf8');
    for (const match of content.matchAll(loadPattern)) {
      const resourcePath = match[2];
      const expectedType = match[3];
      const extension =
        expectedType === 'Prefab'
          ? '.prefab'
          : expectedType === 'JsonAsset'
            ? '.json'
            : '';
      if (!extension) continue;
      addExistingCandidates(resourcePath, extension);
    }
    for (const match of content.matchAll(assetPathLiteralPattern)) {
      const resourcePath = match[2];
      const extension = resourcePath.startsWith('prefabs/') ? '.prefab' : '.json';
      addExistingCandidates(resourcePath, extension);
    }
  }
  return [...roots];
}

function closure(roots, dependencies) {
  const visited = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const dependency of dependencies.get(current) || []) {
      queue.push(dependency);
    }
  }
  return visited;
}

function createAudit(projectRoot, options) {
  const assetsRoot = path.join(projectRoot, 'assets');
  const allFiles = walk(assetsRoot);
  const assetFiles = allFiles
    .filter((file) => !file.endsWith('.meta'))
    .map((file) => toPosix(path.relative(projectRoot, file)));
  const metaFiles = allFiles.filter((file) => file.endsWith('.meta'));
  const assetsByPath = new Set(assetFiles);
  const canonicalAssetPathByLowerCase = new Map(
    assetFiles.map((file) => [file.toLowerCase(), file]),
  );
  const ownerByUuid = new Map();

  for (const metaFile of metaFiles) {
    const ownerFile = metaFile.slice(0, -'.meta'.length);
    if (!fs.existsSync(ownerFile) || fs.statSync(ownerFile).isDirectory()) continue;
    const json = readJson(metaFile);
    if (!json) continue;
    const ownerPath = toPosix(path.relative(projectRoot, ownerFile));
    for (const uuid of collectOwnedUuids(json)) ownerByUuid.set(uuid, ownerPath);
  }

  const knownUuids = new Set(ownerByUuid.keys());
  const dependencies = new Map();
  const referrers = new Map();

  for (const ownerPath of assetFiles) {
    const ownerFile = path.join(projectRoot, ownerPath);
    const refs = new Set([
      ...extractKnownUuids(ownerFile, knownUuids),
      ...extractKnownUuids(`${ownerFile}.meta`, knownUuids),
    ]);
    const deps = new Set();
    for (const uuid of refs) {
      const dependency = ownerByUuid.get(uuid);
      if (!dependency || dependency === ownerPath) continue;
      deps.add(dependency);
      if (!referrers.has(dependency)) referrers.set(dependency, new Set());
      referrers.get(dependency).add(ownerPath);
    }
    dependencies.set(ownerPath, deps);
  }

  const defaultScene = 'assets/Scene/Gameplay.scene';
  const sceneRoots = (options.scenes.length > 0 ? options.scenes : [defaultScene])
    .map((item) => normalizeAssetPath(projectRoot, item));
  const manualRoots = options.roots.map((item) => normalizeAssetPath(projectRoot, item));
  const detectedDynamicRoots = detectDynamicResourceRoots(projectRoot, assetFiles)
    .map((item) => canonicalAssetPathByLowerCase.get(item.toLowerCase()) || item);
  const missingRoots = [...sceneRoots, ...manualRoots].filter(
    (item) => !assetsByPath.has(item),
  );
  const runtimeRoots = [...new Set([
    ...sceneRoots,
    ...manualRoots,
    ...detectedDynamicRoots.filter((item) => assetsByPath.has(item)),
  ])];
  const runtimeReachable = closure(runtimeRoots, dependencies);

  const prefabPrefix = `${normalizeAssetPath(projectRoot, options.prefabDir).replace(/\/+$/, '')}/`;
  const prefabs = assetFiles.filter(
    (file) => file.startsWith(prefabPrefix) && file.endsWith('.prefab'),
  );
  const unusedPrefabs = new Set(
    prefabs.filter((prefab) => !runtimeReachable.has(prefab)),
  );
  const deletable = new Set(unusedPrefabs);

  let removablePrefabSetChanged = true;
  while (removablePrefabSetChanged) {
    removablePrefabSetChanged = false;
    for (const prefab of [...deletable]) {
      const externalReferrers = [...(referrers.get(prefab) || [])].filter(
        (referrer) => !deletable.has(referrer),
      );
      if (externalReferrers.length > 0) {
        deletable.delete(prefab);
        removablePrefabSetChanged = true;
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const deletedAsset of [...deletable]) {
      for (const dependency of dependencies.get(deletedAsset) || []) {
        if (deletable.has(dependency)) continue;
        if (NON_DEPENDENCY_EXTENSIONS.has(path.extname(dependency))) continue;
        const externalReferrers = [...(referrers.get(dependency) || [])].filter(
          (referrer) => !deletable.has(referrer),
        );
        if (externalReferrers.length === 0) {
          deletable.add(dependency);
          changed = true;
        }
      }
    }
  }

  const sort = (items) => [...items].sort((a, b) => a.localeCompare(b));
  const unsafeDeletions = sort(deletable).flatMap((asset) => {
    const externalReferrers = sort(
      [...(referrers.get(asset) || [])].filter(
        (referrer) => !deletable.has(referrer),
      ),
    );
    return externalReferrers.length > 0 ? [{ asset, externalReferrers }] : [];
  });

  return {
    projectRoot,
    assetsRoot,
    runtimeRoots,
    detectedDynamicRoots,
    missingRoots,
    prefabs,
    runtimeReachable,
    unusedPrefabs,
    deletable,
    unsafeDeletions,
    sort,
  };
}

function deleteAssets(audit) {
  if (audit.unsafeDeletions.length > 0) {
    fail(`Refusing unsafe deletions:\n${JSON.stringify(audit.unsafeDeletions, null, 2)}`);
  }

  const candidateDirectories = new Set();
  for (const asset of audit.sort(audit.deletable)) {
    const fullPath = path.resolve(audit.projectRoot, asset);
    if (!fullPath.startsWith(`${audit.assetsRoot}${path.sep}`)) {
      fail(`Refusing to delete path outside assets: ${fullPath}`);
    }
    fs.unlinkSync(fullPath);
    if (fs.existsSync(`${fullPath}.meta`)) fs.unlinkSync(`${fullPath}.meta`);

    let directory = path.dirname(fullPath);
    while (directory.startsWith(`${audit.assetsRoot}${path.sep}`)) {
      candidateDirectories.add(directory);
      directory = path.dirname(directory);
    }
  }

  for (const directory of [...candidateDirectories].sort(
    (a, b) => b.length - a.length,
  )) {
    if (!fs.existsSync(directory) || fs.readdirSync(directory).length > 0) continue;
    fs.rmdirSync(directory);
    if (fs.existsSync(`${directory}.meta`)) fs.unlinkSync(`${directory}.meta`);
  }
}

function report(audit, asJson) {
  const runtimePrefabs = audit.prefabs.filter((item) => audit.runtimeReachable.has(item));
  const result = {
    projectRoot: audit.projectRoot,
    counts: {
      prefabCount: audit.prefabs.length,
      runtimePrefabCount: runtimePrefabs.length,
      unusedPrefabCount: audit.unusedPrefabs.size,
      deletableAssetCount: audit.deletable.size,
      unsafeDeletionCount: audit.unsafeDeletions.length,
      missingRootCount: audit.missingRoots.length,
    },
    runtimeRoots: audit.sort(audit.runtimeRoots),
    detectedDynamicRoots: audit.sort(audit.detectedDynamicRoots),
    missingRoots: audit.sort(audit.missingRoots),
    unusedPrefabs: audit.sort(audit.unusedPrefabs),
    deletableAssets: audit.sort(audit.deletable),
    unsafeDeletions: audit.unsafeDeletions,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  log(`Project: ${audit.projectRoot}`);
  log(`Runtime prefabs: ${result.counts.runtimePrefabCount}/${result.counts.prefabCount}`);
  log(`Unused prefabs: ${result.counts.unusedPrefabCount}`);
  log(`Deletable assets including exclusive dependencies: ${result.counts.deletableAssetCount}`);
  if (result.missingRoots.length > 0) {
    log(`Missing runtime roots: ${result.missingRoots.join(', ')}`);
  }
  if (result.unusedPrefabs.length > 0) {
    console.log('\nUnused prefabs:');
    for (const prefab of result.unusedPrefabs) console.log(`- ${prefab}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const projectRoot = options.projectRoot
    ? path.resolve(options.projectRoot)
    : findProjectRoot(process.cwd()) || findProjectRoot(path.resolve(__dirname, '..'));
  if (!projectRoot) fail('Cannot find a Cocos project root.');

  const audit = createAudit(projectRoot, options);
  report(audit, options.json);

  if (!options.delete) {
    if (audit.deletable.size > 0) {
      log('Audit only. Re-run with --delete to remove the listed assets.');
    }
    return;
  }

  deleteAssets(audit);
  log(`Deleted ${audit.deletable.size} assets and their .meta files.`);

  const verification = createAudit(projectRoot, options);
  if (verification.unusedPrefabs.size > 0 || verification.unsafeDeletions.length > 0) {
    fail('Post-delete verification failed. Re-run without --delete for details.');
  }
  log('Post-delete verification passed.');
}

main();
