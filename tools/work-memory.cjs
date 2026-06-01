#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createStore,
  DEFAULT_GLOBAL_DB_PATH,
  DEFAULT_REPO_DIR_NAME,
  DEFAULT_CACHE_FILE_NAME,
  computeRepoId,
  ensureDirectory,
  toIso,
} = require('./work-memory/store');
const {
  parseArgs,
  printJson,
  printTable,
  parseCsv,
  readTextFromArgs,
  normalizeScope,
  parseNumber,
  parseBoolean,
} = require('./work-memory/cli-utils');
const { parseMarkdownMemories } = require('./work-memory/markdown-importer');
const { discoverMemorySources } = require('./work-memory/source-discovery');

function printHelp() {
  console.log(`
Work Memory CLI

Usage:
  node tools/work-memory.cjs <command> [options]

Commands:
  init              Initialize global and repo SQLite databases.
  remember          Upsert one memory item.
  import-markdown   Import notes from a markdown or text file.
  import-sources    Auto-import discovered markdown sources from the repo.
  query             Query memories with filters and FTS.
  warmup            Build a ranked working-set cache for startup preload.
  session-start     Sync sources, reindex semantics, warm cache, and print hot memories.
  reindex-semantic  Rebuild semantic vectors for existing memories.
  stats             Print counts and scope distribution.
  inspect-cache     Show cache metadata and optionally the cached items.

Common options:
  --repo-root <path>     Repo root. Default: current working directory.
  --repo-db <path>       Repo database path. Default: <repo-root>/.local-memory/repo-memory.db
  --global-db <path>     Global database path. Default: ${DEFAULT_GLOBAL_DB_PATH}
  --cache-file <path>    Cache file path. Default: <repo-root>/.local-memory/${DEFAULT_CACHE_FILE_NAME}
  --json                 Print machine-readable JSON.

Examples:
  node tools/work-memory.cjs init
  node tools/work-memory.cjs remember --scope repo --category bug-fix --title "Sprite effect trap" --content "Start from builtin-sprite.effect semantics" --tags cocos,sprite,effect --source-path assets/effects/TestSpriteNodeShine.effect
  node tools/work-memory.cjs import-markdown --file tools/unity-cocos-port.TODO.md --scope repo --category porting-note --tags unity,cocos,porting
  node tools/work-memory.cjs import-sources --scope repo
  node tools/work-memory.cjs query --text particle rotation --scope repo --semantic hybrid
  node tools/work-memory.cjs warmup --repo-limit 20 --global-limit 10
  node tools/work-memory.cjs session-start --sync-sources true --hot-limit 8
`);
}

function resolvePaths(options) {
  const repoRoot = path.resolve(options['repo-root'] || process.cwd());
  const repoMemoryDir = path.join(repoRoot, DEFAULT_REPO_DIR_NAME);
  const repoDbPath = path.resolve(options['repo-db'] || path.join(repoMemoryDir, 'repo-memory.db'));
  const globalDbPath = path.resolve(options['global-db'] || DEFAULT_GLOBAL_DB_PATH);
  const cacheFile = path.resolve(options['cache-file'] || path.join(repoMemoryDir, DEFAULT_CACHE_FILE_NAME));
  return {
    repoRoot,
    repoId: options['repo-id'] || computeRepoId(repoRoot),
    repoDbPath,
    globalDbPath,
    cacheFile,
  };
}

function createStores(paths) {
  return {
    repoStore: createStore({ dbPath: paths.repoDbPath, scope: 'repo', repoRoot: paths.repoRoot, repoId: paths.repoId }),
    globalStore: createStore({ dbPath: paths.globalDbPath, scope: 'global', repoRoot: paths.repoRoot, repoId: paths.repoId }),
  };
}

function closeStores(stores) {
  for (const store of Object.values(stores)) {
    if (store && typeof store.close === 'function') {
      store.close();
    }
  }
}

function pickStoreByScope(scope, stores) {
  return scope === 'global' ? stores.globalStore : stores.repoStore;
}

function normalizeTags(value) {
  return parseCsv(value)
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean);
}

function buildMemoryItem(options, paths, fallbackContent = '') {
  const scope = normalizeScope(options.scope || 'repo');
  const content = readTextFromArgs(options, fallbackContent);
  if (!content) {
    throw new Error('Missing memory content. Use --content, --content-file, or pipe text to stdin.');
  }
  const now = toIso(new Date());
  return {
    scope,
    repoId: scope === 'repo' ? paths.repoId : null,
    repoRoot: scope === 'repo' ? paths.repoRoot : null,
    category: options.category || 'note',
    title: options.title || content.split(/\r?\n/, 1)[0].trim().slice(0, 120) || 'Untitled memory',
    content,
    tags: normalizeTags(options.tags),
    sourceKind: options['source-kind'] || null,
    sourcePath: options['source-path'] ? path.resolve(paths.repoRoot, options['source-path']) : null,
    sourceSymbol: options['source-symbol'] || null,
    importance: parseNumber(options.importance, 0.5),
    confidence: parseNumber(options.confidence, 0.7),
    pinned: parseBoolean(options.pinned, false),
    createdAt: options['created-at'] || now,
    updatedAt: options['updated-at'] || now,
    metadata: options.metadata ? JSON.parse(options.metadata) : {},
  };
}

function formatRowsForTable(rows) {
  return rows.map((row) => ({
    score: Number(row.score ?? row.rankScore ?? 0).toFixed(3),
    match: row.matchSource || row.preloadSource || '',
    scope: row.scope,
    category: row.category,
    title: row.title,
    tags: Array.isArray(row.tags) ? row.tags.join(',') : '',
    source: row.sourcePath || row.sourceSymbol || '',
    updated: row.updatedAt,
  }));
}

function printResult(options, payload, tableRows) {
  if (options.json) {
    printJson(payload);
    return;
  }
  if (tableRows) {
    printTable(tableRows);
    return;
  }
  if (payload && typeof payload === 'object') {
    printJson(payload);
  }
}

function normalizeSemanticMode(value) {
  const mode = String(value || 'hybrid').toLowerCase();
  if (!['off', 'hybrid', 'only'].includes(mode)) {
    throw new Error(`Invalid semantic mode: ${value}`);
  }
  return mode;
}

function ensureCacheParent(filePath) {
  ensureDirectory(path.dirname(filePath));
}

const CACHE_REPO_ROOT_TOKEN = '<repo-root>';
const CACHE_HOME_TOKEN = '<home>';
const CACHE_PATH_KEYS = new Set([
  'repoRoot',
  'sourcePath',
  'importedFrom',
  'filePath',
  'cacheFile',
  'repoDbPath',
  'globalDbPath',
  'dbPath',
]);

function normalizePortablePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function uniquePortableRoots(entries) {
  const seen = new Set();
  return entries
    .filter((entry) => entry && entry.root && entry.token)
    .map((entry) => ({ ...entry, root: normalizePortablePath(path.resolve(entry.root)) }))
    .filter((entry) => {
      const key = `${entry.token}|${entry.root.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.root.length - a.root.length);
}

function makePortablePath(value, roots) {
  if (!value) return value;
  const normalizedValue = normalizePortablePath(value);
  const lowerValue = normalizedValue.toLowerCase();
  for (const { root, token } of roots) {
    const lowerRoot = root.toLowerCase();
    if (lowerValue === lowerRoot) return token;
    if (lowerValue.startsWith(`${lowerRoot}/`)) {
      return `${token}/${normalizedValue.slice(root.length + 1)}`;
    }
  }
  return normalizedValue;
}

function portableizeCacheValue(value, roots, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => portableizeCacheValue(entry, roots));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      portableizeCacheValue(entryValue, roots, entryKey),
    ]));
  }
  if (typeof value === 'string' && CACHE_PATH_KEYS.has(key)) {
    return makePortablePath(value, roots);
  }
  return value;
}

function makeCachePortableItem(item, paths) {
  const roots = uniquePortableRoots([
    { root: item.repoRoot, token: CACHE_REPO_ROOT_TOKEN },
    { root: paths.repoRoot, token: CACHE_REPO_ROOT_TOKEN },
    { root: os.homedir(), token: CACHE_HOME_TOKEN },
  ]);
  return portableizeCacheValue(item, roots);
}

function createWarmSnapshot(paths, stores, options) {
  const repoLimit = Math.max(1, Math.min(100, parseNumber(options['repo-limit'], 20)));
  const globalLimit = Math.max(0, Math.min(100, parseNumber(options['global-limit'], 10)));
  const includeContent = parseBoolean(options['include-content'], true);
  const items = [];
  for (const row of stores.repoStore.getHotMemories({ limit: repoLimit, includeContent })) {
    items.push({ ...row, preloadSource: 'repo-db' });
  }
  for (const row of stores.globalStore.getHotMemories({ limit: globalLimit, includeContent })) {
    items.push({ ...row, preloadSource: 'global-db' });
  }
  const deduped = Array.from(new Map(items.map((item) => [item.id, item])).values()).sort(
    (a, b) => Number(b.rankScore || 0) - Number(a.rankScore || 0)
  );
  const portableItems = deduped.map((item) => makeCachePortableItem(item, paths));
  const snapshot = {
    ok: true,
    createdAt: toIso(new Date()),
    repoId: paths.repoId,
    repoRoot: CACHE_REPO_ROOT_TOKEN,
    cacheVersion: 2,
    pathMode: 'portable',
    pathTokens: {
      [CACHE_REPO_ROOT_TOKEN]: 'Resolved from --repo-root or the current working directory at runtime.',
      [CACHE_HOME_TOKEN]: 'Resolved from the current user home directory at runtime.',
    },
    itemCount: portableItems.length,
    items: portableItems,
  };
  ensureCacheParent(paths.cacheFile);
  fs.writeFileSync(paths.cacheFile, JSON.stringify(snapshot, null, 2));
  return { snapshot, items: portableItems };
}

async function importOneMarkdownSource(plan, scope, store, paths) {
  const content = fs.readFileSync(plan.filePath, 'utf8');
  const sourceKind = plan.sourceKind || 'markdown';
  const removed = store.removeSourceMemories({ sourcePath: plan.filePath, sourceKind });
  const parsed = parseMarkdownMemories(content, {
    filePath: plan.filePath,
    repoId: scope === 'repo' ? paths.repoId : null,
    repoRoot: scope === 'repo' ? paths.repoRoot : null,
    scope,
    category: plan.category,
    tags: plan.tags,
    sourceKind,
    pinned: false,
    importance: plan.importance,
    confidence: plan.confidence,
    minCharacters: plan.minCharacters,
    minWords: plan.minWords,
    maxBlocks: plan.maxBlocks,
  });
  const imported = [];
  for (const item of parsed) {
    imported.push(await store.upsertMemory(item));
  }
  return {
    filePath: plan.filePath,
    relativePath: plan.relativePath,
    sourceKind,
    category: plan.category,
    removedCount: removed.removedCount,
    importedCount: imported.length,
  };
}

async function runSourceImport(paths, stores, options) {
  const scope = normalizeScope(options.scope || 'repo');
  if (scope === 'hybrid') {
    throw new Error('import-sources does not support hybrid scope. Use repo or global.');
  }
  const store = pickStoreByScope(scope, stores);
  const plans = discoverMemorySources(paths.repoRoot, {
    maxFileBytes: parseNumber(options['max-file-bytes'], 256 * 1024),
    includeReference: parseBoolean(options['include-reference'], false),
  });
  const keepSourceKeys = new Set(plans.map((plan) => `${plan.sourceKind}|${plan.filePath}`));
  let prunedCount = 0;
  for (const source of store.listImportedSources()) {
    if (!keepSourceKeys.has(`${source.sourceKind}|${source.sourcePath}`)) {
      prunedCount += store.removeSourceMemories({ sourcePath: source.sourcePath, sourceKind: source.sourceKind }).removedCount;
    }
  }
  const importedFiles = [];
  let importedCount = 0;
  let removedCount = 0;
  const groups = new Map();
  for (const plan of plans) {
    const result = await importOneMarkdownSource(plan, scope, store, paths);
    importedFiles.push(result);
    importedCount += result.importedCount;
    removedCount += result.removedCount;
    const group = groups.get(result.sourceKind) || { sourceKind: result.sourceKind, files: 0, importedCount: 0 };
    group.files += 1;
    group.importedCount += result.importedCount;
    groups.set(result.sourceKind, group);
  }
  return {
    ok: true,
    scope,
    fileCount: importedFiles.length,
    importedCount,
    removedCount: removedCount + prunedCount,
    groups: Array.from(groups.values()).sort((a, b) => b.importedCount - a.importedCount || a.sourceKind.localeCompare(b.sourceKind)),
    files: importedFiles,
  };
}

function commandInit(options) {
  const paths = resolvePaths(options);
  ensureDirectory(path.dirname(paths.globalDbPath));
  ensureDirectory(path.dirname(paths.repoDbPath));
  const stores = createStores(paths);
  try {
    const payload = {
      ok: true,
      repoId: paths.repoId,
      repoDbPath: paths.repoDbPath,
      globalDbPath: paths.globalDbPath,
      cacheFile: paths.cacheFile,
      repoStats: stores.repoStore.getStats(),
      globalStats: stores.globalStore.getStats(),
    };
    printResult(options, payload);
  } finally {
    closeStores(stores);
  }
}

async function commandRemember(options) {
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const item = buildMemoryItem(options, paths);
    const store = pickStoreByScope(item.scope, stores);
    const saved = await store.upsertMemory(item);
    printResult(options, { ok: true, memory: saved });
  } finally {
    closeStores(stores);
  }
}

async function commandImportMarkdown(options) {
  if (!options.file) {
    throw new Error('Missing --file for import-markdown.');
  }
  const paths = resolvePaths(options);
  const scope = normalizeScope(options.scope || 'repo');
  const inputFile = path.resolve(paths.repoRoot, options.file);
  const sourceText = fs.readFileSync(inputFile, 'utf8');
  const parsed = parseMarkdownMemories(sourceText, {
    filePath: inputFile,
    repoId: scope === 'repo' ? paths.repoId : null,
    repoRoot: scope === 'repo' ? paths.repoRoot : null,
    scope,
    category: options.category || 'note',
    tags: normalizeTags(options.tags),
    sourceKind: options['source-kind'] || 'markdown',
    pinned: parseBoolean(options.pinned, false),
    importance: parseNumber(options.importance, 0.55),
    confidence: parseNumber(options.confidence, 0.7),
  });
  const stores = createStores(paths);
  try {
    const store = pickStoreByScope(scope, stores);
    const sourceKind = options['source-kind'] || 'markdown';
    const removed = store.removeSourceMemories({ sourcePath: inputFile, sourceKind });
    const imported = [];
    for (const item of parsed) {
      imported.push(await store.upsertMemory(item));
    }
    printResult(options, {
      ok: true,
      file: inputFile,
      importedCount: imported.length,
      removedCount: removed.removedCount,
      scope,
      sampleTitles: imported.slice(0, 5).map((item) => item.title),
    });
  } finally {
    closeStores(stores);
  }
}

async function commandImportSources(options) {
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const payload = await runSourceImport(paths, stores, options);
    printResult(options, payload, payload.files.slice(0, 20).map((file) => ({
      imported: file.importedCount,
      removed: file.removedCount,
      type: file.sourceKind,
      category: file.category,
      path: file.relativePath,
    })));
  } finally {
    closeStores(stores);
  }
}

function buildQueryOptions(options, paths) {
  const text = options.text || options.q || '';
  const scope = options.scope ? normalizeScope(options.scope) : 'hybrid';
  return {
    text,
    scope,
    repoId: paths.repoId,
    tags: normalizeTags(options.tags),
    category: options.category || null,
    sourcePath: options['source-path'] ? path.resolve(paths.repoRoot, options['source-path']) : null,
    sourceSymbol: options['source-symbol'] || null,
    limit: Math.max(1, Math.min(100, parseNumber(options.limit, 10))),
    semanticLimit: Math.max(1, Math.min(100, parseNumber(options['semantic-limit'], parseNumber(options.limit, 10) || 10))),
    includeContent: parseBoolean(options['include-content'], false),
    preferCache: parseBoolean(options['prefer-cache'], true),
    semanticMode: normalizeSemanticMode(options.semantic || 'hybrid'),
    cacheFile: paths.cacheFile,
  };
}

function loadCache(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

function queryCacheSnapshot(cache, query) {
  if (!cache || !Array.isArray(cache.items) || !query.text) return [];
  const tokens = String(query.text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  return cache.items
    .map((item) => {
      const haystack = `${item.title}\n${item.content}\n${(item.tags || []).join(' ')}\n${item.sourcePath || ''}\n${item.sourceSymbol || ''}`.toLowerCase();
      let hits = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) hits += 1;
      }
      return { ...item, score: hits / tokens.length };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(query.limit, 20));
}

async function commandQuery(options) {
  const paths = resolvePaths(options);
  const query = buildQueryOptions(options, paths);
  const stores = createStores(paths);
  try {
    const results = [];
    const shouldUseLexical = query.semanticMode !== 'only';
    const shouldUseSemantic = query.semanticMode !== 'off' && Boolean(query.text);
    const cache = shouldUseLexical && query.preferCache ? loadCache(query.cacheFile) : null;
    if (cache) {
      for (const item of queryCacheSnapshot(cache, query)) {
        results.push({ ...item, matchSource: 'cache' });
      }
    }

    if (query.scope === 'repo' || query.scope === 'hybrid') {
      if (shouldUseLexical) {
        for (const row of stores.repoStore.queryMemories(query)) {
          results.push({ ...row, matchSource: 'repo-db' });
        }
      }
      if (shouldUseSemantic) {
        for (const row of await stores.repoStore.querySemanticMemories(query)) {
          results.push({ ...row, matchSource: 'repo-semantic' });
        }
      }
    }

    if (query.scope === 'global' || query.scope === 'hybrid') {
      if (shouldUseLexical) {
        for (const row of stores.globalStore.queryMemories({ ...query, repoId: null })) {
          results.push({ ...row, matchSource: 'global-db' });
        }
      }
      if (shouldUseSemantic) {
        for (const row of await stores.globalStore.querySemanticMemories({ ...query, repoId: null })) {
          results.push({ ...row, matchSource: 'global-semantic' });
        }
      }
    }

    const merged = new Map();
    for (const row of results) {
      const existing = merged.get(row.id);
      if (!existing || Number(row.score || 0) > Number(existing.score || 0)) {
        merged.set(row.id, row);
      }
    }
    const finalRows = Array.from(merged.values())
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, query.limit);

    printResult(
      options,
      {
        ok: true,
        query,
        semantic: {
          repo: stores.repoStore.getSemanticStatus(),
          global: stores.globalStore.getSemanticStatus(),
        },
        count: finalRows.length,
        items: finalRows,
      },
      formatRowsForTable(finalRows)
    );
  } finally {
    closeStores(stores);
  }
}

function commandWarmup(options) {
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const { snapshot, items } = createWarmSnapshot(paths, stores, options);
    printResult(options, { ...snapshot, cacheFile: paths.cacheFile }, formatRowsForTable(items));
  } finally {
    closeStores(stores);
  }
}

async function commandReindexSemantic(options) {
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const force = parseBoolean(options.force, false);
    const payload = {
      ok: true,
      force,
      repo: await stores.repoStore.reindexSemantic({ force }),
      global: await stores.globalStore.reindexSemantic({ force }),
    };
    printResult(options, payload);
  } finally {
    closeStores(stores);
  }
}

async function commandSessionStart(options) {
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const syncSources = parseBoolean(options['sync-sources'], true);
    const forceSemanticReindex = parseBoolean(options['force-reindex-semantic'], false);
    const importSummary = syncSources ? await runSourceImport(paths, stores, { ...options, scope: 'repo' }) : null;
    const semanticReindex = {
      repo: await stores.repoStore.reindexSemantic({ force: forceSemanticReindex }),
      global: await stores.globalStore.reindexSemantic({ force: forceSemanticReindex }),
    };
    const { snapshot, items } = createWarmSnapshot(paths, stores, options);
    const hotLimit = Math.max(1, Math.min(20, parseNumber(options['hot-limit'], 8)));
    const payload = {
      ok: true,
      repoId: paths.repoId,
      importSummary,
      semanticReindex,
      semantic: {
        repo: stores.repoStore.getSemanticStatus(),
        global: stores.globalStore.getSemanticStatus(),
      },
      cache: {
        cacheFile: paths.cacheFile,
        createdAt: snapshot.createdAt,
        itemCount: snapshot.itemCount,
      },
      repo: stores.repoStore.getStats(),
      global: stores.globalStore.getStats(),
      topItems: items.slice(0, hotLimit),
    };
    if (options.json) {
      printJson(payload);
      return;
    }
    if (importSummary) {
      console.log(`Imported ${importSummary.importedCount} memories from ${importSummary.fileCount} discovered source files.`);
    }
    console.log(`Repo semantic index: ${payload.semantic.repo.available ? 'ready' : `unavailable (${payload.semantic.repo.reason})`}`);
    console.log(`Warm cache: ${payload.cache.itemCount} items at ${payload.cache.cacheFile}`);
    printTable(formatRowsForTable(payload.topItems));
  } finally {
    closeStores(stores);
  }
}

function commandStats(options) {
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const cache = loadCache(paths.cacheFile);
    const payload = {
      ok: true,
      repoId: paths.repoId,
      repoDbPath: paths.repoDbPath,
      globalDbPath: paths.globalDbPath,
      cacheFile: paths.cacheFile,
      repo: stores.repoStore.getStats(),
      global: stores.globalStore.getStats(),
      semantic: {
        repo: stores.repoStore.getSemanticStatus(),
        global: stores.globalStore.getSemanticStatus(),
      },
      cache: cache ? { itemCount: cache.itemCount || cache.items.length, createdAt: cache.createdAt } : null,
    };
    printResult(options, payload);
  } finally {
    closeStores(stores);
  }
}

function commandInspectCache(options) {
  const paths = resolvePaths(options);
  const cache = loadCache(paths.cacheFile);
  if (!cache) {
    throw new Error(`Cache file not found or invalid: ${paths.cacheFile}`);
  }
  const showItems = parseBoolean(options.items, false);
  printResult(options, showItems ? cache : {
    ok: true,
    cacheFile: paths.cacheFile,
    createdAt: cache.createdAt,
    repoId: cache.repoId,
    itemCount: cache.itemCount,
  }, showItems ? formatRowsForTable(cache.items || []) : null);
}

const COMMANDS = {
  init: commandInit,
  remember: commandRemember,
  'import-markdown': commandImportMarkdown,
  'import-sources': commandImportSources,
  query: commandQuery,
  warmup: commandWarmup,
  'session-start': commandSessionStart,
  'reindex-semantic': commandReindexSemantic,
  stats: commandStats,
  'inspect-cache': commandInspectCache,
};

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || options.help) {
    printHelp();
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }
  await handler(options);
}

main().catch((error) => {
  console.error(`[work-memory] ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
