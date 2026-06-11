#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[0-9a-f]+)?/gi;
const SOURCE_EXTENSIONS = new Set(['.js', '.ts']);
const DEFAULT_SCOPE = 'all';

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
    scope: DEFAULT_SCOPE,
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
    else if (arg === '--scope') options.scope = argv[++index] || '';
    else if (arg === '--scene') options.scenes.push(argv[++index] || '');
    else if (arg === '--root') options.roots.push(argv[++index] || '');
    else fail(`Unknown argument: ${arg}`);
  }

  if (!['all', 'prefabs'].includes(options.scope)) {
    fail(`Invalid --scope "${options.scope}". Expected "all" or "prefabs".`);
  }
  return options;
}

function printHelp() {
  console.log(`
Cocos Unused Asset Cleanup

Usage:
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs [options]

Options:
  --project-root <path>  Cocos project root. Default: auto-detect from cwd.
  --scope <all|prefabs>  Cleanup scope. Default: all.
  --prefab-dir <path>    Prefab folder to clean. Default: assets/prefabs.
  --scene <path>         Runtime scene root. Repeatable. Default: all scenes under assets.
  --root <path>          Extra runtime asset root. Repeatable.
  --delete               Delete confirmed unused prefabs and exclusive dependencies.
  --json                 Print the complete audit report as JSON.
  --help, -h             Show help.

Examples:
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs --json
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs --delete
  node playable-shared-kit/tools/unused-prefab-cleanup.cjs --scope prefabs --delete
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
    /\bresources\s*\.\s*(?:load|loadDir)\s*\(\s*(['"`])([^'"`]+)\1/g;
  const literalPattern = /(['"`])([^'"`\r\n]+)\1/g;
  const assetByResourceKey = new Map();

  function addResourceKey(key, asset) {
    const normalized = toPosix(key).replace(/^\/+/, '').toLowerCase();
    if (!normalized) return;
    if (!assetByResourceKey.has(normalized)) assetByResourceKey.set(normalized, []);
    assetByResourceKey.get(normalized).push(asset);
  }

  for (const asset of assetFiles) {
    const extension = path.posix.extname(asset);
    const withoutExtension = extension ? asset.slice(0, -extension.length) : asset;
    addResourceKey(asset, asset);
    addResourceKey(withoutExtension, asset);
    if (asset.startsWith('assets/')) {
      addResourceKey(asset.slice('assets/'.length), asset);
      addResourceKey(withoutExtension.slice('assets/'.length), asset);
    }
    if (asset.startsWith('assets/resources/')) {
      addResourceKey(asset.slice('assets/resources/'.length), asset);
      addResourceKey(withoutExtension.slice('assets/resources/'.length), asset);
    }
  }

  function addExactMatchingAssets(resourcePath) {
    const normalized = resourcePath.replace(/^\/+/, '');
    for (const candidate of assetByResourceKey.get(normalized.toLowerCase()) || []) {
      roots.add(candidate);
    }
  }

  function addDirectoryMatchingAssets(resourcePath) {
    const normalized = resourcePath.replace(/^\/+/, '');
    addExactMatchingAssets(normalized);
    const prefix = `${normalized.toLowerCase().replace(/\/+$/, '')}/`;
    for (const [key, candidates] of assetByResourceKey) {
      if (!key.startsWith(prefix)) continue;
      for (const candidate of candidates) roots.add(candidate);
    }
  }

  for (const relativeFile of assetFiles) {
    if (!/\.(?:js|ts)$/.test(relativeFile)) continue;
    const content = fs.readFileSync(path.join(projectRoot, relativeFile), 'utf8');
    for (const match of content.matchAll(loadPattern)) {
      addDirectoryMatchingAssets(match[2]);
    }
    for (const match of content.matchAll(literalPattern)) {
      const literal = match[2];
      if (literal.includes('/') || literal.includes('\\')) {
        addExactMatchingAssets(literal);
      }
    }
  }
  return [...roots];
}

function detectExternalUuidRoots(projectRoot, ownerByUuid) {
  const roots = new Set();
  const referencePaths = [
    'settings',
    'profiles',
    'config',
    'configs',
    '.vscode',
    'package.json',
    'tsconfig.json',
    'playable-cli.config.cjs',
  ]
    .map((item) => path.join(projectRoot, item))
    .filter((item) => fs.existsSync(item));

  for (const file of referencePaths.flatMap((item) =>
    fs.statSync(item).isDirectory() ? walk(item) : [item],
  )) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of content.matchAll(UUID_PATTERN)) {
      const owner = ownerByUuid.get(match[0].toLowerCase());
      if (owner) roots.add(owner);
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
  const orphanMetaFiles = metaFiles
    .filter((file) => !fs.existsSync(file.slice(0, -'.meta'.length)))
    .map((file) => toPosix(path.relative(projectRoot, file)));
  const assetsByPath = new Set(assetFiles);
  const canonicalAssetPathByLowerCase = new Map(
    assetFiles.map((file) => [file.toLowerCase(), file]),
  );
  const ownerByUuid = new Map();
  const uuidsByOwner = new Map();

  for (const metaFile of metaFiles) {
    const ownerFile = metaFile.slice(0, -'.meta'.length);
    if (!fs.existsSync(ownerFile) || fs.statSync(ownerFile).isDirectory()) continue;
    const json = readJson(metaFile);
    if (!json) continue;
    const ownerPath = toPosix(path.relative(projectRoot, ownerFile));
    const ownedUuids = collectOwnedUuids(json);
    uuidsByOwner.set(ownerPath, ownedUuids);
    for (const uuid of ownedUuids) ownerByUuid.set(uuid, ownerPath);
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

  const defaultScenes = assetFiles.filter((file) => file.endsWith('.scene'));
  const sceneRoots = (options.scenes.length > 0 ? options.scenes : defaultScenes)
    .map((item) => normalizeAssetPath(projectRoot, item));
  const sourceRoots = assetFiles.filter((file) =>
    SOURCE_EXTENSIONS.has(path.posix.extname(file)),
  );
  const manualRoots = options.roots.map((item) => normalizeAssetPath(projectRoot, item));
  const detectedDynamicRoots = detectDynamicResourceRoots(projectRoot, assetFiles)
    .map((item) => canonicalAssetPathByLowerCase.get(item.toLowerCase()) || item);
  const externalUuidRoots = detectExternalUuidRoots(projectRoot, ownerByUuid);
  const missingRoots = [...sceneRoots, ...manualRoots].filter(
    (item) => !assetsByPath.has(item),
  );
  const runtimeRoots = [...new Set([
    ...sceneRoots,
    ...sourceRoots,
    ...manualRoots,
    ...detectedDynamicRoots.filter((item) => assetsByPath.has(item)),
    ...externalUuidRoots,
  ])];
  const runtimeReachable = closure(runtimeRoots, dependencies);

  const prefabPrefix = `${normalizeAssetPath(projectRoot, options.prefabDir).replace(/\/+$/, '')}/`;
  const prefabs = assetFiles.filter(
    (file) => file.startsWith(prefabPrefix) && file.endsWith('.prefab'),
  );
  const unusedPrefabs = new Set(
    prefabs.filter((prefab) => !runtimeReachable.has(prefab)),
  );
  const unusedAssets = new Set(
    assetFiles.filter((asset) => !runtimeReachable.has(asset)),
  );
  const deletable = options.scope === 'prefabs'
    ? new Set(unusedPrefabs)
    : new Set(unusedAssets);
  const deletableMetaFiles = options.scope === 'all'
    ? new Set(orphanMetaFiles)
    : new Set();

  if (options.scope === 'prefabs') {
    let changed = true;
    while (changed) {
      changed = false;
      for (const deletedAsset of [...deletable]) {
        for (const dependency of dependencies.get(deletedAsset) || []) {
          if (deletable.has(dependency)) continue;
          if (SOURCE_EXTENSIONS.has(path.posix.extname(dependency))) continue;
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
    externalUuidRoots,
    missingRoots,
    sourceRoots,
    uuidsByOwner,
    prefabs,
    runtimeReachable,
    unusedPrefabs,
    unusedAssets,
    deletable,
    orphanMetaFiles,
    deletableMetaFiles,
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

  for (const metaFile of audit.sort(audit.deletableMetaFiles)) {
    const fullPath = path.resolve(audit.projectRoot, metaFile);
    if (!fullPath.startsWith(`${audit.assetsRoot}${path.sep}`)) {
      fail(`Refusing to delete meta path outside assets: ${fullPath}`);
    }
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
}

function findDanglingDeletedUuidReferences(audit) {
  const deletedUuidOwners = new Map();
  for (const asset of audit.deletable) {
    for (const uuid of audit.uuidsByOwner.get(asset) || []) {
      deletedUuidOwners.set(uuid, asset);
    }
  }

  const danglingReferences = [];
  for (const file of walk(audit.assetsRoot)) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of content.matchAll(UUID_PATTERN)) {
      const uuid = match[0].toLowerCase();
      const deletedOwner = deletedUuidOwners.get(uuid);
      if (!deletedOwner) continue;
      danglingReferences.push({
        file: toPosix(path.relative(audit.projectRoot, file)),
        uuid,
        deletedOwner,
      });
    }
  }
  return danglingReferences;
}

function report(audit, asJson) {
  const runtimePrefabs = audit.prefabs.filter((item) => audit.runtimeReachable.has(item));
  const deletableByExtension = {};
  for (const asset of audit.sort(audit.deletable)) {
    const extension = path.posix.extname(asset) || '(no extension)';
    deletableByExtension[extension] = (deletableByExtension[extension] || 0) + 1;
  }
  const result = {
    projectRoot: audit.projectRoot,
    counts: {
      prefabCount: audit.prefabs.length,
      runtimePrefabCount: runtimePrefabs.length,
      unusedPrefabCount: audit.unusedPrefabs.size,
      runtimeAssetCount: audit.runtimeReachable.size,
      unusedAssetCount: audit.unusedAssets.size,
      deletableAssetCount: audit.deletable.size,
      orphanMetaCount: audit.orphanMetaFiles.length,
      deletableMetaCount: audit.deletableMetaFiles.size,
      unsafeDeletionCount: audit.unsafeDeletions.length,
      missingRootCount: audit.missingRoots.length,
    },
    runtimeRoots: audit.sort(audit.runtimeRoots),
    detectedDynamicRoots: audit.sort(audit.detectedDynamicRoots),
    externalUuidRoots: audit.sort(audit.externalUuidRoots),
    missingRoots: audit.sort(audit.missingRoots),
    sourceRoots: audit.sort(audit.sourceRoots),
    unusedPrefabs: audit.sort(audit.unusedPrefabs),
    unusedAssets: audit.sort(audit.unusedAssets),
    deletableAssets: audit.sort(audit.deletable),
    orphanMetaFiles: audit.sort(audit.orphanMetaFiles),
    deletableMetaFiles: audit.sort(audit.deletableMetaFiles),
    deletableByExtension,
    unsafeDeletions: audit.unsafeDeletions,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  log(`Project: ${audit.projectRoot}`);
  log(`Runtime prefabs: ${result.counts.runtimePrefabCount}/${result.counts.prefabCount}`);
  log(`Unused prefabs: ${result.counts.unusedPrefabCount}`);
  log(`Unused assets: ${result.counts.unusedAssetCount}`);
  log(`Deletable assets: ${result.counts.deletableAssetCount}`);
  log(`Deletable orphan meta files: ${result.counts.deletableMetaCount}`);
  log(`Deletable by extension: ${JSON.stringify(result.deletableByExtension)}`);
  if (result.missingRoots.length > 0) {
    log(`Missing runtime roots: ${result.missingRoots.join(', ')}`);
  }
  if (result.deletableAssets.length > 0) {
    console.log('\nDeletable assets:');
    for (const asset of result.deletableAssets) console.log(`- ${asset}`);
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
    if (audit.deletable.size > 0 || audit.deletableMetaFiles.size > 0) {
      log('Audit only. Re-run with --delete to remove the listed assets.');
    }
    return;
  }

  deleteAssets(audit);
  log(`Deleted ${audit.deletable.size} assets and their .meta files.`);
  log(`Deleted ${audit.deletableMetaFiles.size} orphan meta files.`);

  const danglingReferences = findDanglingDeletedUuidReferences(audit);
  if (danglingReferences.length > 0) {
    fail(`Dangling deleted UUID references found:\n${JSON.stringify(danglingReferences, null, 2)}`);
  }

  const verification = createAudit(projectRoot, options);
  if (
    verification.deletable.size > 0 ||
    verification.deletableMetaFiles.size > 0 ||
    verification.unsafeDeletions.length > 0
  ) {
    fail('Post-delete verification failed. Re-run without --delete for details.');
  }
  log('Post-delete verification passed.');
}

main();
