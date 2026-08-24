'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const {
  createUnityProjectSnapshot,
  emptyInventory,
  assertUnityProjectSnapshot,
} = require('./schema.cjs');
const {
  SEVERITIES,
  createDiagnostic,
  detectBlockerIds,
  aggregateBlockers,
  diagnosticsFromBlockers,
} = require('./diagnostics.cjs');
const {
  extractGuidFromMeta,
  extractGuidReferences,
  buildGuidIndex,
} = require('./guid-index.cjs');
const { buildDependencyGraph } = require('./dependency-graph.cjs');
const { readUtf8, readAssetEvidence } = require('./asset-reader.cjs');
const { discoverPackageRoots } = require('./package-roots.cjs');
const {
  analyzeCSharpSource,
  analyzeAsmdefSource,
  buildScriptIndex,
} = require('./script-index.cjs');
const {
  createCacheContext,
  loadIndexCache,
  saveIndexCache,
  fileStamp,
} = require('./cache.cjs');

const VENDOR_DIRS = new Set([
  'plugins', 'packages', 'thirdparties', 'thirdparty', 'zenject', 'textmesh pro',
  'firebase', 'maxsdk', 'onesignal', 'googleplayplugins', 'externaldependencymanager',
  'restclient', 'uniwebview', 'bitlabs', 'mcofferwallsdk', 'gameanalytics',
  'cheatdetected', 'jmo assets', 'recyclable scroll rect', 'simple scroll-snap',
  'ugui particle', 'uguiparticle', 'vibration', 'internetchecker', 'realtimenet',
  'spine', 'stompyrobot', 'nicevibrations', 'shinyeffectforugui',
  'standard assets',
]);
const SAMPLE_DIRS = new Set([
  'samples', 'sample', 'demo', 'demos', 'examples', 'example',
]);
const EDITOR_DIRS = new Set(['editor', 'editor default resources', 'gizmos']);

const TYPE_BY_EXTENSION = new Map([
  ['.unity', 'scene'],
  ['.prefab', 'prefab'],
  ['.cs', 'script'],
  ['.shader', 'shader'],
  ['.shadergraph', 'shaderGraph'],
  ['.mat', 'material'],
  ['.fbx', 'model'],
  ['.obj', 'model'],
  ['.gltf', 'model'],
  ['.glb', 'model'],
  ['.png', 'texture'],
  ['.jpg', 'texture'],
  ['.jpeg', 'texture'],
  ['.tga', 'texture'],
  ['.psd', 'texture'],
  ['.exr', 'texture'],
  ['.anim', 'animation'],
  ['.controller', 'controller'],
  ['.overridecontroller', 'controller'],
  ['.mp3', 'audio'],
  ['.wav', 'audio'],
  ['.ogg', 'audio'],
  ['.m4a', 'audio'],
]);

function slash(value) {
  return value.replace(/\\/g, '/');
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findUnityProjectRoot(inputPath) {
  let cursor = path.resolve(inputPath);
  try {
    if (fs.statSync(cursor).isFile()) cursor = path.dirname(cursor);
  } catch (_) {
    return null;
  }
  for (;;) {
    if (fs.existsSync(path.join(cursor, 'ProjectSettings', 'ProjectVersion.txt')) &&
        fs.existsSync(path.join(cursor, 'Assets'))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function resolveUnityProjectLayout(inputPath, explicitProjectRoot) {
  const resolvedInput = path.resolve(inputPath);
  const projectRoot = explicitProjectRoot
    ? path.resolve(explicitProjectRoot)
    : findUnityProjectRoot(resolvedInput);
  let assetsRoot = null;
  let sourceRoot = resolvedInput;

  if (projectRoot) {
    assetsRoot = path.join(projectRoot, 'Assets');
    if (resolvedInput === projectRoot) sourceRoot = assetsRoot;
    if (explicitProjectRoot && !isInside(assetsRoot, sourceRoot)) {
      throw new Error(`Unity source must be inside ${assetsRoot} when --project is supplied: ${sourceRoot}`);
    }
  } else if (path.basename(resolvedInput).toLowerCase() === 'assets') {
    assetsRoot = resolvedInput;
  }

  const roots = [{
    kind: 'assets',
    origin: 'project',
    physicalRoot: sourceRoot,
    logicalPrefix: assetsRoot && isInside(assetsRoot, sourceRoot)
      ? slash(path.join('Assets', path.relative(assetsRoot, sourceRoot)))
      : 'Assets',
    precedence: 0,
    indexed: true,
  }];
  const packages = discoverPackageRoots(projectRoot);
  roots.push(...packages.roots);

  return { projectRoot, assetsRoot, sourceRoot, roots, packages };
}

function pathTags(logicalPath) {
  const segments = slash(logicalPath).toLowerCase().split('/').filter(Boolean);
  const normalizedSegments = segments.map(segment => segment.replace(/~$/, ''));
  const tags = [];
  if (segments[0] === 'packages') tags.push('package');
  if (normalizedSegments.some(segment => EDITOR_DIRS.has(segment))) tags.push('editor');
  if (normalizedSegments.some(segment => SAMPLE_DIRS.has(segment) ||
      /(?:^|[ _-])(demo|demos|sample|samples|example|examples)(?:[ _-]|$)/.test(segment))) {
    tags.push('sample');
  }
  if (normalizedSegments.some(segment => VENDOR_DIRS.has(segment))) tags.push('vendor');
  if (!tags.length) tags.push('runtime');
  return [...new Set(tags)];
}

function classifyPath(logicalPath) {
  const tags = pathTags(logicalPath);
  if (tags.includes('editor')) return 'editor';
  if (tags.includes('sample')) return 'sample';
  if (tags.includes('vendor')) return 'vendor';
  if (tags.includes('package')) return 'package';
  return 'runtime';
}

function isNativePluginPayload(logicalPath) {
  const segments = slash(logicalPath).split('/');
  return segments.slice(0, -1).some(segment => /\.(?:androidlib|bundle|framework|xcframework)$/i.test(segment));
}

function listRootFiles(root) {
  const files = [];
  const excludedViewRoots = new Set();
  let totalBytes = 0;
  const stack = [root.physicalRoot];

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) {
      continue;
    }
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const full = path.join(dir, entry.name);
      const relative = slash(path.relative(root.physicalRoot, full));
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || (root.origin === 'package' && entry.name.endsWith('~'))) continue;
        const logical = slash(path.join(root.logicalPrefix, relative));
        const scope = classifyPath(logical);
        if (scope !== 'runtime') {
          const alreadyNested = [...excludedViewRoots].some(root => relative.startsWith(`${root}/`));
          if (!alreadyNested) excludedViewRoots.add(relative);
        }
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      totalBytes += stat.size;
      files.push({ full, relative, stat, root });
    }
  }

  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return { files, totalBytes, excludedViewRoots: [...excludedViewRoots].sort() };
}

function countYamlDocs(text) {
  let gameObjects = 0;
  let materials = 0;
  for (const _match of text.matchAll(/(?:^|\n)--- !u!1\s/g)) gameObjects += 1;
  for (const _match of text.matchAll(/(?:^|\n)--- !u!21\s/g)) materials += 1;
  return { gameObjects, materials };
}

function logicalAssetPath(file) {
  return slash(path.join(file.root.logicalPrefix, file.relative));
}

function scanAssetFile(file, metaFile) {
  const extension = path.extname(file.full).toLowerCase();
  const type = file.directoryAsset ? 'folder' : (TYPE_BY_EXTENSION.get(extension) || 'asset');
  const assetPath = logicalAssetPath(file);
  const packageCatalogOnly = file.root.kind === 'package-cache';
  const evidence = file.directoryAsset
    ? { format: 'folder', complete: true, text: '', error: null }
    : packageCatalogOnly
      ? { format: 'package-guid-catalog', complete: true, text: '', error: null }
      : readAssetEvidence(file.full, extension, file.stat.size);
  const text = evidence.text;
  let guid = null;
  const metaText = metaFile ? readUtf8(metaFile.full, metaFile.stat.size) : '';
  if (metaText) guid = extractGuidFromMeta(metaText);
  const yaml = extension === '.unity' || extension === '.prefab'
    ? countYamlDocs(text)
    : { gameObjects: 0, materials: 0 };
  const referenceEvidence = [
    ...extractGuidReferences(text, {
      provider: evidence.format === 'binary' ? 'binary' : 'asset',
      allowBareGuid: extension === '.shadergraph',
    }),
    ...extractGuidReferences(metaText, { provider: 'meta', excludeGuids: guid ? [guid] : [] }),
  ];

  return {
    path: file.relative,
    assetPath,
    origin: file.root.origin || 'project',
    rootKind: file.root.kind,
    rootPrecedence: file.root.precedence,
    packageName: file.root.packageName || null,
    extension,
    type,
    scope: classifyPath(assetPath),
    tags: pathTags(assetPath),
    sizeBytes: file.stat.size,
    kb: Math.round(file.stat.size / 1024),
    guid,
    references: [...new Set(referenceEvidence.map(reference => reference.guid))].sort(),
    referenceEvidence,
    blockerIds: detectBlockerIds(assetPath, text),
    gameObjects: yaml.gameObjects,
    inlineMaterials: yaml.materials,
    serialization: {
      format: evidence.format,
      complete: evidence.complete,
      error: evidence.error,
    },
    scriptEvidence: type === 'script' ? analyzeCSharpSource(text) : undefined,
    assemblyEvidence: extension === '.asmdef' ? analyzeAsmdefSource(text, assetPath) : undefined,
  };
}

function readUnityVersion(projectRoot) {
  if (!projectRoot) return null;
  try {
    const firstLine = fs.readFileSync(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
      .split(/\r?\n/, 1)[0];
    return firstLine.replace(/^m_EditorVersion:\s*/, '').trim() || null;
  } catch (_) {
    return null;
  }
}

function readPackages(projectRoot) {
  if (!projectRoot) return {};
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'Packages', 'manifest.json'), 'utf8'));
    return manifest && manifest.dependencies && typeof manifest.dependencies === 'object'
      ? manifest.dependencies
      : {};
  } catch (_) {
    return {};
  }
}

function readBuildScenes(projectRoot) {
  if (!projectRoot) return [];
  let text;
  try {
    text = fs.readFileSync(path.join(projectRoot, 'ProjectSettings', 'EditorBuildSettings.asset'), 'utf8');
  } catch (_) {
    return [];
  }
  const scenes = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const enabled = /^\s*-\s+enabled:\s*([01])\s*$/.exec(line);
    if (enabled) {
      if (current && current.path) scenes.push(current);
      current = { enabled: enabled[1] === '1', path: null, guid: null };
      continue;
    }
    if (!current) continue;
    const scenePath = /^\s+path:\s*(.*?)\s*$/.exec(line);
    if (scenePath) { current.path = slash(scenePath[1]); continue; }
    const guid = /^\s+guid:\s*([0-9a-f]{32})\s*$/i.exec(line);
    if (guid) current.guid = guid[1].toLowerCase();
  }
  if (current && current.path) scenes.push(current);
  return scenes;
}

function incrementInventory(inventory, record) {
  if (record.type === 'scene') inventory.scenes += 1;
  else if (record.type === 'prefab') inventory.prefabs += 1;
  else if (record.type === 'script') inventory.scripts += 1;
  else if (record.type === 'shader') inventory.shaders += 1;
  else if (record.type === 'shaderGraph') inventory.shaderGraphs += 1;
  else if (record.type === 'material') inventory.materials += 1;
  else if (record.type === 'model') inventory.models += 1;
  else if (record.type === 'texture') inventory.textures += 1;
  else if (record.type === 'animation') inventory.animations += 1;
  else if (record.type === 'controller') inventory.controllers += 1;
  else if (record.type === 'audio') inventory.audio += 1;
  if (record.type === 'scene' || record.type === 'prefab') {
    inventory.inlineMaterials += record.inlineMaterials;
    inventory.sceneObjects += record.gameObjects;
  }
}

function inventoryFor(records, totalBytes) {
  const inventory = emptyInventory();
  for (const record of records) incrementInventory(inventory, record);
  inventory.totalMb = Math.round((totalBytes / 1024 / 1024) * 10) / 10;
  return inventory;
}

function buildUnityProjectSnapshot(options) {
  const startedAt = performance.now();
  const layout = resolveUnityProjectLayout(options.sourceRoot || options.projectRoot, options.projectRoot);
  const packageMode = options.packageMode === 'none' ? 'none' : 'guid-catalog';
  if (packageMode === 'none') {
    layout.roots = layout.roots.filter(root => root.origin === 'project');
    layout.packages = { ...layout.packages, roots: [], unavailable: [], scanDisabled: true };
  }
  let sourceStat = null;
  try { sourceStat = fs.statSync(layout.sourceRoot); } catch (_) { /* handled below */ }
  if (!sourceStat || !sourceStat.isDirectory()) throw new Error(`Unity source directory not found: ${layout.sourceRoot}`);

  const cacheContext = createCacheContext({
    enabled: options.cache !== false,
    cacheDir: options.cacheDir,
    projectRoot: layout.projectRoot,
    sourceRoot: layout.sourceRoot,
    packageRoots: layout.packages.roots,
  });
  const previousCache = options.refreshCache ? null : loadIndexCache(cacheContext);
  const previousEntries = previousCache ? previousCache.entries : {};
  const rootListings = layout.roots.map(root => {
    const reused = !!previousCache && root.kind === 'package-cache';
    return {
      root,
      reused,
      listing: reused
        ? { files: [], totalBytes: 0, excludedViewRoots: [] }
        : listRootFiles(root),
    };
  });
  const projectListing = rootListings.find(item => item.root.kind === 'assets').listing;
  const allFiles = rootListings.flatMap(item => item.listing.files);
  const pathKey = value => {
    const resolved = path.resolve(value).replace(/\\/g, '/');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const byFull = new Map(allFiles.map(file => [pathKey(file.full), file]));
  const assetFiles = allFiles.filter(file =>
    !file.relative.toLowerCase().endsWith('.meta') &&
    (file.root.origin === 'project' || byFull.has(`${pathKey(file.full)}.meta`)));
  for (const metaFile of allFiles.filter(file => file.relative.toLowerCase().endsWith('.meta'))) {
    const assetFull = metaFile.full.slice(0, -'.meta'.length);
    let stat;
    try { stat = fs.statSync(assetFull); } catch (_) { continue; }
    if (!stat.isDirectory()) continue;
    assetFiles.push({
      full: assetFull,
      relative: metaFile.relative.slice(0, -'.meta'.length),
      stat,
      root: metaFile.root,
      directoryAsset: true,
    });
  }
  assetFiles.sort((a, b) =>
    a.root.precedence - b.root.precedence || logicalAssetPath(a).localeCompare(logicalAssetPath(b)));
  const deduplicatedFiles = [];
  const claimedAssetPaths = new Set();
  for (const file of assetFiles) {
    const key = logicalAssetPath(file).toLowerCase();
    if (claimedAssetPaths.has(key)) continue;
    claimedAssetPaths.add(key);
    deduplicatedFiles.push(file);
  }
  const nextEntries = {};
  const records = [];
  let hits = 0;
  let misses = 0;

  for (const item of rootListings.filter(item => item.reused)) {
    const prefix = `${item.root.kind}:${item.root.packageName || ''}:`;
    for (const [entryKey, cached] of Object.entries(previousEntries)) {
      if (!entryKey.startsWith(prefix) || !cached.record) continue;
      records.push(cached.record);
      nextEntries[entryKey] = cached;
      hits += 1;
    }
  }

  for (const file of deduplicatedFiles) {
    const metaFile = byFull.get(`${pathKey(file.full)}.meta`) || null;
    const extension = path.extname(file.full).toLowerCase();
    const stamp = fileStamp(file.stat, metaFile && metaFile.stat, file.directoryAsset ? null : file.full,
      metaFile && metaFile.full, { hashContent: false, hashMeta: false });
    const entryKey = `${file.root.kind}:${file.root.packageName || ''}:${file.relative}`;
    const cached = previousEntries[entryKey];
    let record;
    if (cached && cached.stamp === stamp && cached.record) {
      record = cached.record;
      hits += 1;
    } else {
      record = scanAssetFile(file, metaFile);
      misses += 1;
    }
    records.push(record);
    nextEntries[entryKey] = { stamp, record };
  }

  records.sort((a, b) => a.assetPath.localeCompare(b.assetPath));
  const staleEntries = Math.max(0, Object.keys(previousEntries).length - hits);
  const cacheWrite = previousCache && misses === 0 && staleEntries === 0
    ? { written: false, error: null, reused: true }
    : saveIndexCache(cacheContext, nextEntries);
  const guidIndex = buildGuidIndex(records);
  const includeVendor = !!options.includeVendor;
  const projectRecords = records.filter(record => record.origin === 'project');
  const packageRecords = records.filter(record => record.origin === 'package');
  const scriptIndex = buildScriptIndex(projectRecords);
  const graph = buildDependencyGraph(records, guidIndex, { scriptIndex });
  const recordByAssetPath = new Map(records.map(record => [record.assetPath.toLowerCase(), record]));
  const viewRecords = includeVendor
    ? projectRecords
    : projectRecords.filter(record => record.scope === 'runtime');
  const rawBytes = projectRecords.reduce((sum, record) => sum + record.sizeBytes, 0);
  const packageBytes = packageRecords.reduce((sum, record) => sum + record.sizeBytes, 0);
  const rawInventory = inventoryFor(projectRecords, rawBytes);
  const packageInventory = inventoryFor(packageRecords, packageBytes);
  const viewBytes = viewRecords.reduce((sum, record) => sum + record.sizeBytes, 0);
  const inventory = inventoryFor(viewRecords, viewBytes);

  const buildScenes = readBuildScenes(layout.projectRoot).map(scene => {
    const record = recordByAssetPath.get(scene.path.toLowerCase()) || null;
    const scope = record ? record.scope : classifyPath(scene.path);
    const guidMatches = !scene.guid || !record || !record.guid || scene.guid === record.guid;
    return {
      ...scene,
      indexed: !!record,
      scope,
      guidMatches,
      gameplayCandidate: scene.enabled && (includeVendor || scope === 'runtime'),
    };
  });
  const enabledScenePaths = buildScenes
    .filter(scene => scene.gameplayCandidate && scene.indexed)
    .map(scene => recordByAssetPath.get(scene.path.toLowerCase()).assetPath);
  const distances = graph.distancesFrom(enabledScenePaths);
  const reachablePaths = new Set(distances.keys());
  const reachableProjectRecords = projectRecords.filter(record => reachablePaths.has(record.assetPath));
  const reachableVisualTypes = new Set(['shader', 'shaderGraph', 'controller', 'prefab', 'material']);
  const gatingRecords = reachableProjectRecords.filter(record =>
    record.scope === 'runtime' || (record.scope !== 'editor' && reachableVisualTypes.has(record.type)));
  const blockers = aggregateBlockers(gatingRecords);
  const projectRisks = aggregateBlockers(viewRecords);
  const diagnostics = diagnosticsFromBlockers(blockers);

  const prefabs = projectRecords
    .filter(record => record.type === 'prefab')
    .map(record => ({
      path: record.path,
      assetPath: record.assetPath,
      guid: record.guid,
      scope: record.scope,
      tags: record.tags,
      kb: record.kb,
      gameObjects: record.gameObjects,
      inlineMaterials: record.inlineMaterials,
      buildSceneDistance: distances.has(record.assetPath) ? distances.get(record.assetPath) : null,
    }));
  const scenes = projectRecords
    .filter(record => record.type === 'scene')
    .map(record => {
      const buildScene = buildScenes.find(scene => scene.path.toLowerCase() === record.assetPath.toLowerCase());
      return {
        path: record.path,
        assetPath: record.assetPath,
        guid: record.guid,
        scope: record.scope,
        tags: record.tags,
        kb: record.kb,
        gameObjects: record.gameObjects,
        inlineMaterials: record.inlineMaterials,
        enabled: !!(buildScene && buildScene.enabled),
        gameplayCandidate: !!(buildScene && buildScene.gameplayCandidate),
      };
    });
  const scriptInfoByPath = new Map(scriptIndex.scripts.map(script => [script.assetPath, script]));
  const scripts = projectRecords
    .filter(record => record.type === 'script')
    .map(record => ({
      path: record.path,
      assetPath: record.assetPath,
      guid: record.guid,
      scope: record.scope,
      assembly: scriptInfoByPath.get(record.assetPath)?.assembly || null,
      kb: record.kb,
    }));

  const assetRecordByPath = new Map(records.map(record => [record.assetPath, record]));
  const runtimePrefabs = prefabs.filter(prefab => includeVendor || prefab.scope === 'runtime');
  const rootPrefabs = runtimePrefabs.filter(prefab => {
    for (const sourcePath of graph.incoming.get(prefab.assetPath) || []) {
      const source = assetRecordByPath.get(sourcePath);
      if (source && (source.type === 'scene' || source.type === 'prefab') &&
          (includeVendor || source.scope === 'runtime')) return false;
    }
    return true;
  });
  const entryPrefabs = runtimePrefabs
    .filter(prefab => prefab.buildSceneDistance !== null)
    .sort((a, b) => a.buildSceneDistance - b.buildSceneDistance || b.kb - a.kb || a.path.localeCompare(b.path));

  if (!buildScenes.some(scene => scene.enabled)) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_NO_ENABLED_BUILD_SCENE',
      severity: SEVERITIES.MEDIUM,
      message: 'Project không khai báo scene enabled trong EditorBuildSettings.',
      action: 'Chọn scene gameplay bằng evidence trước khi port.',
    }));
  }
  const missingBuildScenes = buildScenes.filter(scene => scene.enabled && !scene.indexed);
  if (missingBuildScenes.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_BUILD_SCENE_OUTSIDE_SCAN_SCOPE',
      severity: SEVERITIES.MEDIUM,
      message: `${missingBuildScenes.length} build scene enabled nằm ngoài source scope hoặc không tồn tại.`,
      action: 'Chạy lại với Unity project root hoặc Assets root.',
      count: missingBuildScenes.length,
      evidence: missingBuildScenes.slice(0, 5).map(scene => scene.path),
    }));
  }
  const mismatchedBuildScenes = buildScenes.filter(scene => scene.enabled && scene.indexed && !scene.guidMatches);
  if (mismatchedBuildScenes.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_BUILD_SCENE_GUID_MISMATCH',
      severity: SEVERITIES.HIGH,
      message: `${mismatchedBuildScenes.length} build scene có GUID không khớp file .meta tại path đã khai báo.`,
      action: 'Mở Build Settings trong Unity, bỏ reference hỏng rồi add lại scene đúng.',
      count: mismatchedBuildScenes.length,
      evidence: mismatchedBuildScenes.slice(0, 5).map(scene => ({ path: scene.path, guid: scene.guid })),
    }));
  }
  if (guidIndex.duplicates.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_DUPLICATE_GUID',
      severity: SEVERITIES.HIGH,
      message: `${guidIndex.duplicates.length} GUID trùng giữa các Unity asset.`,
      action: 'Sửa duplicate GUID bằng Unity Editor trước khi tin dependency graph.',
      count: guidIndex.duplicates.length,
      evidence: guidIndex.duplicates.slice(0, 5),
    }));
  }
  if (guidIndex.shadowed.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_PACKAGE_GUID_SHADOWED',
      severity: SEVERITIES.LOW,
      message: `${guidIndex.shadowed.length} package GUID bị bản copy trong Assets hoặc root ưu tiên cao hơn che khuất.`,
      action: 'Không cần xử lý nếu đây là project override có chủ ý; dependency graph đã chọn đúng root ưu tiên.',
      count: guidIndex.shadowed.length,
      evidence: guidIndex.shadowed.slice(0, 10),
    }));
  }
  const missingMeta = projectRecords.filter(record =>
    record.type !== 'folder' && !record.guid && !isNativePluginPayload(record.assetPath));
  if (missingMeta.length) {
    const reachableMissingMeta = missingMeta.filter(record => reachablePaths.has(record.assetPath));
    diagnostics.push(createDiagnostic({
      code: 'UNITY_ASSET_META_MISSING',
      severity: reachableMissingMeta.length ? SEVERITIES.HIGH : SEVERITIES.MEDIUM,
      message: `${missingMeta.length} Unity asset không có GUID từ .meta${reachableMissingMeta.length ? `; ${reachableMissingMeta.length} asset reachable từ build scene` : ''}.`,
      action: 'Mở Unity để import/recreate .meta; không tự tạo hoặc sửa .meta bằng tay.',
      count: missingMeta.length,
      evidence: (reachableMissingMeta.length ? reachableMissingMeta : missingMeta).slice(0, 10).map(record => record.assetPath),
    }));
  }
  const incompleteSerialization = records.filter(record => record.serialization && !record.serialization.complete);
  if (incompleteSerialization.length) {
    const reachableIncomplete = incompleteSerialization.filter(record => reachablePaths.has(record.assetPath));
    diagnostics.push(createDiagnostic({
      code: 'UNITY_SERIALIZED_FILE_PARTIAL',
      severity: reachableIncomplete.length ? SEVERITIES.HIGH : SEVERITIES.MEDIUM,
      message: `${incompleteSerialization.length} serialized asset không đọc đủ evidence tĩnh.`,
      action: 'Phase 2 sẽ yêu cầu Unity-side scanner xuất snapshot đã deserialize; kiểm tra các asset reachable trước khi port.',
      count: incompleteSerialization.length,
      evidence: (reachableIncomplete.length ? reachableIncomplete : incompleteSerialization).slice(0, 10)
        .map(record => ({ path: record.assetPath, error: record.serialization.error })),
    }));
  }
  if (layout.packages.unavailable.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_PACKAGE_ASSETS_UNAVAILABLE',
      severity: SEVERITIES.MEDIUM,
      message: `${layout.packages.unavailable.length} package khai báo nhưng không tìm thấy source trong Packages/PackageCache.`,
      action: 'Restore packages bằng Unity trước khi tin các GUID dependency chưa resolve.',
      count: layout.packages.unavailable.length,
      evidence: layout.packages.unavailable.slice(0, 10),
    }));
  }
  if (packageRecords.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_PACKAGE_GUID_CATALOG',
      severity: SEVERITIES.LOW,
      message: `${packageRecords.length} package asset được index ở chế độ GUID catalog để giữ cold/warm scan gọn.`,
      action: 'Phase 2 Unity-side scanner sẽ mở rộng dependency bên trong package khi gameplay thực sự cần.',
      count: packageRecords.length,
      evidence: layout.packages.roots.slice(0, 5).map(root => root.packageName),
    }));
  }
  const dependencies = graph.toJSON({
    reachablePaths,
    packageAssetsAvailable: layout.packages.unavailable.length === 0,
  });
  const reachableUnresolved = dependencies.unresolved.filter(entry => entry.category === 'reachable-missing');
  if (reachableUnresolved.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_REACHABLE_GUID_UNRESOLVED',
      severity: SEVERITIES.HIGH,
      message: `${reachableUnresolved.length} GUID dependency reachable từ build scene không resolve được.`,
      action: 'Restore package/meta bị thiếu hoặc mở Unity để Phase 2 resolver xác nhận object reference.',
      count: reachableUnresolved.length,
      evidence: reachableUnresolved.slice(0, 10),
    }));
  }
  for (const item of scriptIndex.diagnostics) {
    diagnostics.push(createDiagnostic({
      code: item.code,
      severity: item.severity,
      message: item.message,
      action: 'Kiểm tra assembly/script layout trước khi chạy port.closure hoặc port.compile.',
      evidence: item.evidence || (item.assetPath ? [item.assetPath] : []),
    }));
  }
  const packageSignals = [
    ['com.unity.addressables', 'UNITY_ADDRESSABLES_PACKAGE_PRESENT', SEVERITIES.MEDIUM,
      'Project khai báo Addressables; static package presence chưa chứng minh gameplay có load runtime.',
      'Ưu tiên kiểm tra Addressables/AssetReference reachable và chuyển sang asset nhúng/resources.'],
    ['com.unity.inputsystem', 'UNITY_INPUT_SYSTEM_PACKAGE_PRESENT', SEVERITIES.LOW,
      'Project dùng Input System package.', 'Map action gameplay cần thiết sang touch/mouse input tối giản của Cocos.'],
    ['com.unity.render-pipelines.universal', 'UNITY_URP_PACKAGE_PRESENT', SEVERITIES.LOW,
      'Project dùng Universal Render Pipeline.', 'Ưu tiên material/shader reachable; không port toàn bộ pipeline.'],
  ];
  const declaredPackages = readPackages(layout.projectRoot);
  for (const [packageName, code, severity, message, action] of packageSignals) {
    if (!Object.prototype.hasOwnProperty.call(declaredPackages, packageName)) continue;
    diagnostics.push(createDiagnostic({ code, severity, message, action, evidence: [packageName] }));
  }
  if (!gatingRecords.length && projectRisks.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_PROJECT_RISKS_NOT_GATED',
      severity: SEVERITIES.LOW,
      message: `${projectRisks.length} nhóm rủi ro phát hiện ngoài build-scene reachable slice; không nâng thành blocker bắt buộc.`,
      action: 'Chọn đúng gameplay scene/prefab nếu static build graph chưa đủ.',
      count: projectRisks.length,
      evidence: projectRisks.slice(0, 5).map(risk => risk.label),
    }));
  }
  if (!includeVendor && projectListing.excludedViewRoots.length) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_NON_GAMEPLAY_ASSETS_FILTERED',
      severity: SEVERITIES.LOW,
      message: `${projectListing.excludedViewRoots.length} vendor/sample/editor scope được giữ trong raw index nhưng lọc khỏi porting view.`,
      action: 'Dùng --include-vendor nếu chính package/sample đó là mục tiêu port.',
      count: projectListing.excludedViewRoots.length,
      evidence: projectListing.excludedViewRoots.slice(0, 10),
    }));
  }
  if (cacheWrite.error) {
    diagnostics.push(createDiagnostic({
      code: 'UNITY_INTEL_CACHE_WRITE_FAILED',
      severity: SEVERITIES.LOW,
      message: `Không ghi được cache Unity intelligence: ${cacheWrite.error}`,
      action: 'Dùng --cache-dir tới thư mục có quyền ghi hoặc --no-cache.',
    }));
  }

  const snapshot = createUnityProjectSnapshot({
    project: {
      name: layout.projectRoot ? path.basename(layout.projectRoot) : path.basename(layout.sourceRoot),
      root: layout.projectRoot ? slash(layout.projectRoot) : null,
      unityVersion: readUnityVersion(layout.projectRoot),
      packages: declaredPackages,
      layout: {
        roots: layout.roots.map(root => ({ ...root, physicalRoot: slash(root.physicalRoot) })),
        unavailablePackages: layout.packages.unavailable,
      },
    },
    source: {
      root: slash(layout.sourceRoot),
      assetsRoot: layout.assetsRoot ? slash(layout.assetsRoot) : null,
      includeVendor,
      view: includeVendor ? 'all' : 'runtime',
      packageMode,
    },
    inventory,
    buildScenes,
    assets: {
      count: records.length,
      projectCount: projectRecords.length,
      packageCount: packageRecords.length,
      rawInventory,
      packageInventory,
      records,
    },
    scenes,
    prefabs,
    scripts,
    scriptIndex,
    dependencies,
    features: { blockers, projectRisks },
    diagnostics,
    skippedVendorDirs: includeVendor ? [] : projectListing.excludedViewRoots,
    cache: {
      enabled: cacheContext.enabled,
      mode: !cacheContext.enabled ? 'disabled' : hits > 0 ? 'warm' : 'cold',
      file: cacheContext.file ? slash(cacheContext.file) : null,
      hits,
      misses,
      staleEntries,
      written: cacheWrite.written,
      packageCachePolicy: 'Library/PackageCache is immutable; use --refresh-cache after manual in-place edits',
    },
  });

  snapshot.metrics = {
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    indexedFiles: records.length,
    projectFiles: projectRecords.length,
    packageFiles: packageRecords.length,
    viewFiles: viewRecords.length,
  };
  snapshot.views = {
    entryPrefabs,
    rootPrefabs: rootPrefabs.sort((a, b) => b.kb - a.kb || a.path.localeCompare(b.path)),
  };
  return assertUnityProjectSnapshot(snapshot);
}

module.exports = {
  VENDOR_DIRS,
  SAMPLE_DIRS,
  EDITOR_DIRS,
  TYPE_BY_EXTENSION,
  classifyPath,
  findUnityProjectRoot,
  resolveUnityProjectLayout,
  readBuildScenes,
  buildUnityProjectSnapshot,
};
