#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createStore,
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

const DEFAULT_SHARED_DB_FILE_NAME = 'shared-memory.db';
const DEFAULT_SHARED_DATA_DIR_NAME = 'data';
const DEFAULT_REPO_DB_DIR_NAME = 'repo';
const DEFAULT_CACHE_DIR_NAME = 'cache';
const DEFAULT_SHARED_CAPTURE_FILE_NAME = 'shared-capture.md';
const DEFAULT_WATCH_POLL_SECONDS = 15;
const DEFAULT_AGENT_MEMORY_SCOPE = 'global';
const AGENT_MEMORY_MARKER_NAME = 'WORK_MEMORY';
const AGENT_MEMORY_MARKER_REGEX = /<!--\s*WORK_MEMORY:\s*([\s\S]*?)\s*-->/g;
const AGENT_MEMORY_CATEGORY_KEYWORDS = [
  { category: 'bug-fix', keywords: ['bugfix', 'bug fix', 'root cause', 'regression', 'broken', 'crash', 'failure', 'failing'] },
  { category: 'porting-note', keywords: ['porting', 'ported', 'migration', 'migrate', 'remap', 'unity'] },
  { category: 'command', keywords: ['powershell', 'terminal', 'command', 'cli'] },
  { category: 'workflow', keywords: ['workflow', 'process', 'convention', 'guideline', 'policy', 'rule'] },
];
const AGENT_MEMORY_TAG_KEYWORDS = [
  { tag: 'cocos', keywords: ['cocos', 'creator', 'ccclass', 'prefab', 'scene'] },
  { tag: 'unity', keywords: ['unity'] },
  { tag: 'porting', keywords: ['porting', 'ported', 'migration', 'migrate', 'remap'] },
  { tag: 'shader', keywords: ['shader', 'effect', 'semantics'] },
  { tag: 'sprite', keywords: ['sprite'] },
  { tag: 'particle', keywords: ['particle', 'particles', 'shuriken'] },
  { tag: 'analytics', keywords: ['analytics', 'tracking', 'cta'] },
  { tag: 'mvvm', keywords: ['mvvm', 'viewmodel'] },
  { tag: 'debugging', keywords: ['root cause', 'regression', 'debug'] },
  { tag: 'workflow', keywords: ['workflow', 'process', 'guideline', 'policy'] },
  { tag: 'cli', keywords: ['powershell', 'terminal', 'command', 'cli'] },
];

function stableId(seed) {
  return crypto.createHash('sha1').update(String(seed || '')).digest('hex');
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function sanitizeFileFragment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'memory';
}

function getSharedKitRoot() {
  return path.resolve(__dirname, '..');
}

function getMemoryToolRoot() {
  return path.resolve(__dirname, 'work-memory');
}

function getDefaultStorageLayout(repoRoot, repoId) {
  const memoryToolRoot = getMemoryToolRoot();
  const dataDir = path.join(memoryToolRoot, DEFAULT_SHARED_DATA_DIR_NAME);
  const repoFileStem = sanitizeFileFragment(repoId || path.basename(repoRoot));
  return {
    sharedKitRoot: getSharedKitRoot(),
    memoryToolRoot,
    dataDir,
    repoDbPath: path.join(dataDir, DEFAULT_REPO_DB_DIR_NAME, `${repoFileStem}.db`),
    globalDbPath: path.join(dataDir, DEFAULT_SHARED_DB_FILE_NAME),
    cacheFile: path.join(dataDir, DEFAULT_CACHE_DIR_NAME, `${repoFileStem}-${DEFAULT_CACHE_FILE_NAME}`),
    sharedCaptureFile: path.join(memoryToolRoot, DEFAULT_SHARED_CAPTURE_FILE_NAME),
  };
}

function ensureFile(filePath) {
  ensureDirectory(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf8');
  }
}

function printHelp() {
  console.log(`
Work Memory CLI

Usage:
  node playable-shared-kit/tools/work-memory.cjs <command> [options]

Commands:
  init              Initialize global and repo SQLite databases.
  remember          Upsert one memory item.
  remember-auto     Upsert one or more AI-generated memories from JSON.
  import-agent-memories
                    Import hidden agent memory markers from a transcript file.
  import-markdown   Import notes from a markdown or text file.
  import-sources    Auto-import discovered markdown sources from the repo.
  query             Query memories with filters and FTS.
  warmup            Build a ranked working-set cache for startup preload.
  session-start     Sync sources, reindex semantics, warm cache, and print hot memories.
  watch             Run session-start once, then keep syncing changed note sources.
  reindex-semantic  Rebuild semantic vectors for existing memories.
  stats             Print counts and scope distribution.
  inspect-cache     Show cache metadata and optionally the cached items.

Common options:
  --repo-root <path>     Repo root. Default: current working directory.
  --repo-db <path>       Repo database path. Default: <repo-root>/playable-shared-kit/tools/work-memory/data/repo/<repo-id>.db
  --global-db <path>     Shared database path. Default: <repo-root>/playable-shared-kit/tools/work-memory/data/${DEFAULT_SHARED_DB_FILE_NAME}
  --cache-file <path>    Cache file path. Default: <repo-root>/playable-shared-kit/tools/work-memory/data/cache/<repo-id>-${DEFAULT_CACHE_FILE_NAME}
  --shared-capture-file <path>
                        Shared capture markdown watched for reusable lessons. Default: <repo-root>/playable-shared-kit/tools/work-memory/${DEFAULT_SHARED_CAPTURE_FILE_NAME}
  --json                 Print machine-readable JSON.

Examples:
  node playable-shared-kit/tools/work-memory.cjs init
  node playable-shared-kit/tools/work-memory.cjs remember --scope repo --category bug-fix --title "Sprite effect trap" --content "Start from builtin-sprite.effect semantics" --tags cocos,sprite,effect --source-path assets/effects/TestSpriteNodeShine.effect
  node playable-shared-kit/tools/work-memory.cjs remember-auto --memory '{"scope":"global","category":"tip","title":"Preserve sprite semantics","content":"Preserve builtin sprite semantics when porting sprite effects.","tags":["shader","cocos","porting"]}'
  node playable-shared-kit/tools/work-memory.cjs import-agent-memories --transcript C:/tmp/copilot-transcript.json
  node playable-shared-kit/tools/work-memory.cjs import-markdown --file playable-shared-kit/tools/unity-cocos-port.TODO.md --scope repo --category porting-note --tags unity,cocos,porting
  node playable-shared-kit/tools/work-memory.cjs import-sources --scope repo
  node playable-shared-kit/tools/work-memory.cjs query --text particle rotation --scope repo --semantic hybrid
  node playable-shared-kit/tools/work-memory.cjs warmup --repo-limit 20 --global-limit 10
  node playable-shared-kit/tools/work-memory.cjs session-start --sync-sources true --hot-limit 8
  node playable-shared-kit/tools/work-memory.cjs watch --poll-seconds 15
`);
}

function resolvePaths(options) {
  const repoRoot = path.resolve(options['repo-root'] || process.cwd());
  const repoId = options['repo-id'] || computeRepoId(repoRoot);
  const layout = getDefaultStorageLayout(repoRoot, repoId);
  const repoDbPath = path.resolve(options['repo-db'] || layout.repoDbPath);
  const globalDbPath = path.resolve(options['global-db'] || layout.globalDbPath);
  const cacheFile = path.resolve(options['cache-file'] || layout.cacheFile);
  const sharedCaptureFile = path.resolve(options['shared-capture-file'] || layout.sharedCaptureFile);
  return {
    repoRoot,
    repoId,
    sharedKitRoot: layout.sharedKitRoot,
    memoryToolRoot: layout.memoryToolRoot,
    memoryDataDir: layout.dataDir,
    repoDbPath,
    globalDbPath,
    cacheFile,
    sharedCaptureFile,
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

function firstDefined(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value.trim() : value;
    if (text === '') continue;
    return value;
  }
  return null;
}

function normalizeCategory(value, fallback = 'tip') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  return normalized || fallback;
}

function normalizeAgentTagInput(...values) {
  const tags = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const tag of value) tags.push(...normalizeAgentTagInput(tag));
      continue;
    }
    tags.push(...normalizeTags(value));
  }
  return Array.from(new Set(tags));
}

function includesAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function resolveAgentMemorySourcePath(payload, paths) {
  const sourcePath = firstDefined(payload.sourcePath, payload.file, payload.path);
  return sourcePath ? path.resolve(paths.repoRoot, String(sourcePath)) : null;
}

function resolveAgentMemorySourceSymbol(payload) {
  return firstDefined(payload.sourceSymbol, payload.symbol);
}

function buildAgentMemorySearchText({ title, content, sourcePath, sourceSymbol, tags }) {
  return [title, content, sourcePath, sourceSymbol, ...(tags || [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function inferAgentMemoryScope(payload, options = {}) {
  if (payload.scope) return resolveAgentMemoryScope(payload.scope);
  if (options.sourcePath || options.sourceSymbol) return 'repo';
  return resolveAgentMemoryScope(options.defaultScope);
}

function inferAgentMemoryCategory(payload, context) {
  const explicitCategory = firstDefined(payload.category, payload.kind, payload.type);
  if (explicitCategory) return normalizeCategory(explicitCategory);
  const searchText = buildAgentMemorySearchText(context);
  for (const rule of AGENT_MEMORY_CATEGORY_KEYWORDS) {
    if (includesAnyKeyword(searchText, rule.keywords)) return rule.category;
  }
  return 'tip';
}

function inferAgentMemoryTags(payload, context) {
  const tags = normalizeAgentTagInput(payload.tags, payload.labels, payload.tag);
  if (context.category === 'bug-fix') tags.push('debugging');
  if (context.category === 'porting-note') tags.push('porting');
  if (context.category === 'workflow') tags.push('workflow');
  if (context.category === 'command') tags.push('cli');
  const searchText = buildAgentMemorySearchText({ ...context, tags });
  for (const rule of AGENT_MEMORY_TAG_KEYWORDS) {
    if (includesAnyKeyword(searchText, rule.keywords)) tags.push(rule.tag);
  }
  return Array.from(new Set(tags));
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

function resolveAgentMemoryScope(value) {
  const scope = String(value || DEFAULT_AGENT_MEMORY_SCOPE).trim().toLowerCase();
  if (scope === 'repo' || scope === 'global') return scope;
  return DEFAULT_AGENT_MEMORY_SCOPE;
}

function collectStringFields(value, sink = []) {
  if (typeof value === 'string') {
    sink.push(value);
    return sink;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStringFields(entry, sink);
    return sink;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStringFields(entry, sink);
  }
  return sink;
}

function readJsonInput(options, primaryKey, fileKey) {
  if (options[primaryKey]) return String(options[primaryKey]);
  if (fileKey && options[fileKey]) return fs.readFileSync(String(options[fileKey]), 'utf8');
  const stdin = readTextFromArgs({}, '');
  return String(stdin || '').trim();
}

function parseJsonEntries(text, description) {
  const parsed = parseJson(String(text || '').trim(), null);
  if (!parsed) {
    throw new Error(`Invalid JSON for ${description}.`);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const objects = entries.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  if (!objects.length) {
    throw new Error(`${description} did not contain any memory objects.`);
  }
  return objects;
}

function dedupeAgentMemoryPayloads(items) {
  const unique = new Map();
  for (const item of items) {
    const key = JSON.stringify([
      item.scope,
      item.category,
      item.title,
      item.content,
      item.sourceSymbol,
      item.tags,
    ]);
    if (!unique.has(key)) unique.set(key, item);
  }
  return Array.from(unique.values());
}

function extractAgentMemoryMarkers(text) {
  const searchable = [];
  const parsedTranscript = parseJson(String(text || ''), null);
  if (parsedTranscript) {
    collectStringFields(parsedTranscript, searchable);
  } else {
    searchable.push(String(text || ''));
  }
  const markers = [];
  for (const chunk of searchable) {
    AGENT_MEMORY_MARKER_REGEX.lastIndex = 0;
    let match;
    while ((match = AGENT_MEMORY_MARKER_REGEX.exec(String(chunk || '')))) {
      const parsed = parseJson(String(match[1] || '').trim(), null);
      if (!parsed) continue;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) markers.push(entry);
        }
        continue;
      }
      if (typeof parsed === 'object') markers.push(parsed);
    }
  }
  return markers;
}

function normalizeAgentMemoryPayload(payload, paths, options = {}) {
  const content = Array.isArray(payload.content)
    ? payload.content.map((entry) => String(entry || '').trim()).filter(Boolean).join('\n')
    : String(payload.content || payload.note || payload.summary || '').trim();
  const title = String(payload.title || '').trim() || content.split(/\r?\n/, 1)[0].trim().slice(0, 120);
  if (!title || !content) return null;
  const sourcePath = resolveAgentMemorySourcePath(payload, paths);
  const sourceSymbol = resolveAgentMemorySourceSymbol(payload);
  const scope = inferAgentMemoryScope(payload, { defaultScope: options.defaultScope, sourcePath, sourceSymbol });
  const category = inferAgentMemoryCategory(payload, { title, content, sourcePath, sourceSymbol, tags: [] });
  const tags = inferAgentMemoryTags(payload, { title, content, sourcePath, sourceSymbol, category });
  const id = stableId([
    'agent-memory',
    scope,
    scope === 'repo' ? paths.repoId : 'global',
    category,
    title,
    content,
    tags.join(','),
  ].join('|'));
  return {
    id,
    scope,
    repoId: scope === 'repo' ? paths.repoId : null,
    repoRoot: scope === 'repo' ? paths.repoRoot : null,
    category,
    title,
    content,
    tags,
    sourceKind: payload.sourceKind || 'agent-memory',
    sourcePath,
    sourceSymbol,
    importance: parseNumber(payload.importance, 0.8),
    confidence: parseNumber(payload.confidence, 0.92),
    pinned: parseBoolean(payload.pinned, false),
    createdAt: payload.createdAt || options.capturedAt || toIso(new Date()),
    updatedAt: payload.updatedAt || options.capturedAt || toIso(new Date()),
    metadata: {
      ...parseJson(JSON.stringify(payload.metadata || {}), {}),
      agentMemory: true,
      marker: AGENT_MEMORY_MARKER_NAME,
      hookEvent: options.hookEvent || null,
      sessionId: options.sessionId || null,
      transcriptPath: options.transcriptPath || null,
      importedAt: options.capturedAt || toIso(new Date()),
    },
  };
}

async function saveNormalizedMemories(memories, stores) {
  const imported = [];
  for (const memory of memories) {
    const store = pickStoreByScope(memory.scope, stores);
    imported.push(await store.upsertMemory(memory));
  }
  return imported;
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

function buildSharedCapturePlan(paths, options = {}) {
  return {
    filePath: paths.sharedCaptureFile,
    relativePath: path.relative(paths.repoRoot, paths.sharedCaptureFile).replace(/\\/g, '/'),
    sourceKind: 'shared-capture-markdown',
    category: options['shared-capture-category'] || 'tip',
    tags: ['shared', 'memory', 'lesson'],
    importance: parseNumber(options['shared-capture-importance'], 0.85),
    confidence: parseNumber(options['shared-capture-confidence'], 0.95),
    priority: 100,
    minCharacters: parseNumber(options['shared-capture-min-characters'], 0),
    minWords: parseNumber(options['shared-capture-min-words'], 0),
    maxBlocks: parseNumber(options['shared-capture-max-blocks'], 0),
  };
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

async function runSharedCaptureImport(paths, stores, options) {
  ensureFile(paths.sharedCaptureFile);
  const result = await importOneMarkdownSource(
    buildSharedCapturePlan(paths, options),
    'global',
    stores.globalStore,
    paths
  );
  return {
    ok: true,
    scope: 'global',
    filePath: paths.sharedCaptureFile,
    ...result,
  };
}

async function runSessionWorkflow(paths, stores, options) {
  const syncSources = parseBoolean(options['sync-sources'], true);
  const syncSharedCapture = parseBoolean(options['sync-shared-capture'], true);
  const forceSemanticReindex = parseBoolean(options['force-reindex-semantic'], false);
  const importSummary = syncSources ? await runSourceImport(paths, stores, { ...options, scope: 'repo' }) : null;
  const sharedCapture = syncSharedCapture ? await runSharedCaptureImport(paths, stores, options) : null;
  const semanticReindex = {
    repo: await stores.repoStore.reindexSemantic({ force: forceSemanticReindex }),
    global: await stores.globalStore.reindexSemantic({ force: forceSemanticReindex }),
  };
  const { snapshot, items } = createWarmSnapshot(paths, stores, options);
  return {
    importSummary,
    sharedCapture,
    semanticReindex,
    snapshot,
    items,
  };
}

function buildSessionPayload(paths, stores, workflow, options) {
  const hotLimit = Math.max(1, Math.min(20, parseNumber(options['hot-limit'], 8)));
  return {
    ok: true,
    repoId: paths.repoId,
    repoDbPath: paths.repoDbPath,
    globalDbPath: paths.globalDbPath,
    sharedCaptureFile: paths.sharedCaptureFile,
    importSummary: workflow.importSummary,
    sharedCapture: workflow.sharedCapture,
    semanticReindex: workflow.semanticReindex,
    semantic: {
      repo: stores.repoStore.getSemanticStatus(),
      global: stores.globalStore.getSemanticStatus(),
    },
    cache: {
      cacheFile: paths.cacheFile,
      createdAt: workflow.snapshot.createdAt,
      itemCount: workflow.snapshot.itemCount,
    },
    repo: stores.repoStore.getStats(),
    global: stores.globalStore.getStats(),
    topItems: workflow.items.slice(0, hotLimit),
  };
}

function printSessionPayload(payload, options) {
  if (options.json) {
    printJson(payload);
    return;
  }
  if (payload.importSummary) {
    console.log(`Imported ${payload.importSummary.importedCount} memories from ${payload.importSummary.fileCount} discovered source files.`);
  }
  if (payload.sharedCapture) {
    console.log(`Shared capture: ${payload.sharedCapture.importedCount} memories from ${payload.sharedCapture.filePath}.`);
  }
  console.log(`Repo semantic index: ${payload.semantic.repo.available ? 'ready' : `unavailable (${payload.semantic.repo.reason})`}`);
  console.log(`Warm cache: ${payload.cache.itemCount} items at ${payload.cache.cacheFile}`);
  printTable(formatRowsForTable(payload.topItems));
}

function buildWatchSignature(paths, options) {
  const watchedFiles = [];
  if (parseBoolean(options['sync-sources'], true)) {
    for (const plan of discoverMemorySources(paths.repoRoot, {
      maxFileBytes: parseNumber(options['max-file-bytes'], 256 * 1024),
      includeReference: parseBoolean(options['include-reference'], false),
    })) {
      watchedFiles.push(path.resolve(plan.filePath));
    }
  }
  if (parseBoolean(options['sync-shared-capture'], true)) {
    ensureFile(paths.sharedCaptureFile);
    watchedFiles.push(paths.sharedCaptureFile);
  }
  const uniqueFiles = Array.from(new Set(watchedFiles)).sort((left, right) => left.localeCompare(right));
  return JSON.stringify(uniqueFiles.map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return [filePath, Math.trunc(stat.mtimeMs), stat.size];
    } catch {
      return [filePath, 'missing', 0];
    }
  }));
}

function summarizeSync(payload) {
  const repoImported = payload.importSummary ? payload.importSummary.importedCount : 0;
  const sharedImported = payload.sharedCapture ? payload.sharedCapture.importedCount : 0;
  return `repo=${repoImported} shared=${sharedImported} cache=${payload.cache.itemCount}`;
}

function commandInit(options) {
  const paths = resolvePaths(options);
  ensureDirectory(path.dirname(paths.globalDbPath));
  ensureDirectory(path.dirname(paths.repoDbPath));
  ensureDirectory(path.dirname(paths.cacheFile));
  const stores = createStores(paths);
  try {
    const payload = {
      ok: true,
      repoId: paths.repoId,
      sharedCaptureFile: paths.sharedCaptureFile,
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

async function commandRememberAuto(options) {
  const raw = readJsonInput(options, 'memory', 'memory-file');
  if (!raw) {
    throw new Error('Missing memory JSON. Use --memory, --memory-file, or pipe JSON to stdin.');
  }
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const normalized = dedupeAgentMemoryPayloads(
      parseJsonEntries(raw, 'remember-auto input')
        .map((payload) => normalizeAgentMemoryPayload(payload, paths, {
          defaultScope: options.scope || DEFAULT_AGENT_MEMORY_SCOPE,
          sessionId: options['session-id'] || null,
          transcriptPath: options.transcript ? path.resolve(paths.repoRoot, String(options.transcript)) : null,
          capturedAt: toIso(new Date()),
        }))
        .filter(Boolean)
    );
    const imported = await saveNormalizedMemories(normalized, stores);
    printResult(options, {
      ok: true,
      marker: AGENT_MEMORY_MARKER_NAME,
      importedCount: imported.length,
      items: imported,
    }, formatRowsForTable(imported));
  } finally {
    closeStores(stores);
  }
}

async function commandImportAgentMemories(options) {
  if (!options.transcript) {
    throw new Error('Missing --transcript for import-agent-memories.');
  }
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  try {
    const transcriptPath = path.resolve(paths.repoRoot, options.transcript);
    const transcriptText = fs.readFileSync(transcriptPath, 'utf8');
    const rawMarkers = extractAgentMemoryMarkers(transcriptText);
    const capturedAt = toIso(new Date());
    const skippedCount = rawMarkers.length;
    const normalized = dedupeAgentMemoryPayloads(
      rawMarkers
        .map((marker) => normalizeAgentMemoryPayload(marker, paths, {
          defaultScope: options.scope || DEFAULT_AGENT_MEMORY_SCOPE,
          sessionId: options['session-id'] || null,
          transcriptPath,
          hookEvent: options['hook-event'] || null,
          capturedAt,
        }))
        .filter(Boolean)
    );
    const imported = await saveNormalizedMemories(normalized, stores);
    printResult(options, {
      ok: true,
      marker: AGENT_MEMORY_MARKER_NAME,
      transcriptPath,
      markerCount: rawMarkers.length,
      discoveredCount: rawMarkers.length,
      importedCount: imported.length,
      skippedCount: Math.max(0, skippedCount - imported.length),
      items: imported,
    }, formatRowsForTable(imported));
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
    const workflow = await runSessionWorkflow(paths, stores, options);
    const payload = buildSessionPayload(paths, stores, workflow, options);
    printSessionPayload(payload, options);
  } finally {
    closeStores(stores);
  }
}

async function commandWatch(options) {
  const once = parseBoolean(options.once, false);
  const jsonMode = parseBoolean(options.json, false);
  if (jsonMode && !once) {
    throw new Error('watch supports --json only with --once true.');
  }
  const paths = resolvePaths(options);
  const stores = createStores(paths);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeStores(stores);
  };
  try {
    if (!jsonMode) {
      console.log('[work-memory] watch starting');
    }
    const initialWorkflow = await runSessionWorkflow(paths, stores, options);
    const initialPayload = buildSessionPayload(paths, stores, initialWorkflow, options);
    if (once) {
      printSessionPayload(initialPayload, options);
      return;
    }
    console.log(`[work-memory] initial sync ${summarizeSync(initialPayload)}`);
    console.log('[work-memory] watch ready');
    const pollMs = Math.max(5, Math.min(300, parseNumber(options['poll-seconds'], DEFAULT_WATCH_POLL_SECONDS))) * 1000;
    let lastSignature = buildWatchSignature(paths, options);
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      const nextSignature = buildWatchSignature(paths, options);
      if (nextSignature === lastSignature) return;
      busy = true;
      try {
        const workflow = await runSessionWorkflow(paths, stores, options);
        const payload = buildSessionPayload(paths, stores, workflow, options);
        lastSignature = buildWatchSignature(paths, options);
        console.log(`[work-memory] sync complete ${summarizeSync(payload)}`);
      } catch (error) {
        console.error(`[work-memory] watch error: ${error && error.message ? error.message : error}`);
      } finally {
        busy = false;
      }
    }, pollMs);
    const stop = () => {
      clearInterval(timer);
      close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await new Promise(() => {});
  } finally {
    if (once) {
      close();
    }
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
      sharedCaptureFile: paths.sharedCaptureFile,
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
  'remember-auto': commandRememberAuto,
  'import-agent-memories': commandImportAgentMemories,
  'import-markdown': commandImportMarkdown,
  'import-sources': commandImportSources,
  query: commandQuery,
  warmup: commandWarmup,
  'session-start': commandSessionStart,
  watch: commandWatch,
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
