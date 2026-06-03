'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
let DatabaseSync = null;
let databaseSyncLoadError = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (error) {
  databaseSyncLoadError = error;
}
const {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_EMBEDDING_MODEL,
  embedText,
  buildMemoryEmbeddingInput,
  buildQueryEmbeddingInput,
} = require('./embedder');

let sqliteVec = null;
try {
  sqliteVec = require('sqlite-vec');
} catch {
  sqliteVec = null;
}

const DEFAULT_GLOBAL_DB_PATH = path.join(os.homedir(), '.copilot-work-memory', 'global-memory.db');
const DEFAULT_REPO_DIR_NAME = '.local-memory';
const DEFAULT_CACHE_FILE_NAME = 'hot-cache.json';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toIso(date) {
  return new Date(date || Date.now()).toISOString();
}

function stableId(seed) {
  return crypto.createHash('sha1').update(String(seed || '')).digest('hex');
}

function findGitRoot(startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveGitDir(gitRoot) {
  const dotGitPath = path.join(gitRoot, '.git');
  try {
    const stat = fs.statSync(dotGitPath);
    if (stat.isDirectory()) return dotGitPath;
    if (stat.isFile()) {
      const text = fs.readFileSync(dotGitPath, 'utf8');
      const match = text.match(/^gitdir:\s*(.+)\s*$/m);
      if (match) return path.resolve(gitRoot, match[1].trim());
    }
  } catch {
    return null;
  }
  return null;
}

function parseOriginUrl(configText) {
  let inOrigin = false;
  for (const rawLine of String(configText || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1].trim());
      continue;
    }
    if (!inOrigin) continue;
    const url = line.match(/^url\s*=\s*(.+)$/);
    if (url) return url[1].trim();
  }
  return null;
}

function normalizeRepoIdentity(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

function getGitRepoIdentity(repoRoot) {
  const gitRoot = findGitRoot(repoRoot);
  if (!gitRoot) return null;
  const gitDir = resolveGitDir(gitRoot);
  const relativePath = path.relative(gitRoot, repoRoot).replace(/\\/g, '/') || '.';
  let originUrl = null;
  if (gitDir) {
    try {
      originUrl = parseOriginUrl(fs.readFileSync(path.join(gitDir, 'config'), 'utf8'));
    } catch {
      originUrl = null;
    }
  }
  const repoIdentity = originUrl ? `git:${normalizeRepoIdentity(originUrl)}` : `git-local:${path.basename(gitRoot)}`;
  return `${repoIdentity}#${relativePath}`;
}

function computeRepoId(repoRoot) {
  const normalized = path.resolve(repoRoot || process.cwd());
  return `${path.basename(normalized)}:${stableId(getGitRepoIdentity(normalized) || normalized).slice(0, 12)}`;
}

function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function serializeTags(tags) {
  return JSON.stringify(Array.isArray(tags) ? tags : []);
}

function normalizeTags(tags) {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function tagsText(tags) {
  return normalizeTags(tags).join(' ');
}

function rowToMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    repoId: row.repo_id,
    repoRoot: row.repo_root,
    category: row.category,
    title: row.title,
    content: row.content,
    tags: parseJson(row.tags_json, []),
    sourceKind: row.source_kind,
    sourcePath: row.source_path,
    sourceSymbol: row.source_symbol,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: Number(row.access_count || 0),
    metadata: parseJson(row.metadata_json, {}),
    score: row.score == null ? undefined : Number(row.score),
    rankScore: row.rank_score == null ? undefined : Number(row.rank_score),
    distance: row.distance == null ? undefined : Number(row.distance),
  };
}

function semanticDistanceToScore(distance) {
  const numericDistance = Number(distance);
  if (!Number.isFinite(numericDistance)) return 0;
  return Number((2.25 / (1 + numericDistance)).toFixed(6));
}

function createStore(options) {
  if (!DatabaseSync) {
    const reason = databaseSyncLoadError && databaseSyncLoadError.message ? databaseSyncLoadError.message : 'node:sqlite is unavailable';
    throw new Error(`Work Memory CLI requires a Node.js runtime with node:sqlite support. Current runtime cannot load node:sqlite: ${reason}`);
  }
  const dbPath = path.resolve(options.dbPath);
  ensureDirectory(path.dirname(dbPath));
  let db;
  try {
    db = new DatabaseSync(dbPath, { allowExtension: true });
  } catch {
    db = new DatabaseSync(dbPath);
  }

  function prepare(sql) {
    const statement = db.prepare(sql);
    statement.setAllowBareNamedParameters(true);
    return statement;
  }

  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      repo_id TEXT,
      repo_root TEXT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      tags_text TEXT NOT NULL DEFAULT '',
      source_kind TEXT,
      source_path TEXT,
      source_symbol TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.7,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_memory_scope_repo ON memory_items(scope, repo_id);
    CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory_items(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_items(category);
    CREATE INDEX IF NOT EXISTS idx_memory_source_path ON memory_items(source_path);
    CREATE INDEX IF NOT EXISTS idx_memory_source_symbol ON memory_items(source_symbol);
    CREATE INDEX IF NOT EXISTS idx_memory_pinned ON memory_items(pinned DESC, importance DESC, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tags,
      source_path,
      source_symbol,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  const insertItem = prepare(`
    INSERT INTO memory_items (
      id, scope, repo_id, repo_root, category, title, content, tags_json, tags_text,
      source_kind, source_path, source_symbol, importance, confidence, pinned,
      created_at, updated_at, last_accessed_at, access_count, metadata_json
    ) VALUES (
      $id, $scope, $repo_id, $repo_root, $category, $title, $content, $tags_json, $tags_text,
      $source_kind, $source_path, $source_symbol, $importance, $confidence, $pinned,
      $created_at, $updated_at, $last_accessed_at, $access_count, $metadata_json
    )
    ON CONFLICT(id) DO UPDATE SET
      scope = excluded.scope,
      repo_id = excluded.repo_id,
      repo_root = excluded.repo_root,
      category = excluded.category,
      title = excluded.title,
      content = excluded.content,
      tags_json = excluded.tags_json,
      tags_text = excluded.tags_text,
      source_kind = excluded.source_kind,
      source_path = excluded.source_path,
      source_symbol = excluded.source_symbol,
      importance = excluded.importance,
      confidence = excluded.confidence,
      pinned = excluded.pinned,
      updated_at = excluded.updated_at,
      metadata_json = excluded.metadata_json
  `);

  const deleteFtsRow = prepare('DELETE FROM memory_fts WHERE id = ?');
  const insertFtsRow = prepare(`
    INSERT INTO memory_fts (id, title, content, tags, source_path, source_symbol)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const selectById = prepare('SELECT * FROM memory_items WHERE id = ?');
  const selectStats = prepare(`
    SELECT
      COUNT(*) AS item_count,
      SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) AS pinned_count,
      COUNT(DISTINCT category) AS category_count,
      MAX(updated_at) AS newest_update
    FROM memory_items
  `);
  const selectCategoryBreakdown = prepare(`
    SELECT category, COUNT(*) AS count
    FROM memory_items
    GROUP BY category
    ORDER BY count DESC, category ASC
  `);
  const selectHot = prepare(`
    SELECT
      *,
      (
        (CASE WHEN pinned = 1 THEN 1.2 ELSE 0 END) +
        (importance * 0.9) +
        (confidence * 0.5) +
        (MIN(access_count, 20) * 0.04) +
        (CASE
          WHEN julianday('now') - julianday(updated_at) <= 3 THEN 0.4
          WHEN julianday('now') - julianday(updated_at) <= 14 THEN 0.2
          ELSE 0
        END)
      ) AS rank_score
    FROM memory_items
    WHERE ($scope = 'repo' AND repo_id = $repo_id) OR $scope = 'global'
    ORDER BY rank_score DESC, updated_at DESC
    LIMIT $limit
  `);
  const selectAllMemories = prepare('SELECT * FROM memory_items ORDER BY updated_at DESC');
  const deleteMemoryItem = prepare('DELETE FROM memory_items WHERE id = ?');
  const selectSourceMemoryIds = prepare(`
    SELECT id
    FROM memory_items
    WHERE source_path = $source_path
      AND ($source_kind IS NULL OR source_kind = $source_kind)
  `);
  const selectImportedSources = prepare(`
    SELECT DISTINCT source_path, source_kind
    FROM memory_items
    WHERE source_path IS NOT NULL
      AND source_kind IS NOT NULL
  `);

  function createSemanticState() {
    const semantic = {
      available: false,
      provider: DEFAULT_EMBEDDING_PROVIDER,
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      reason: null,
    };
    if (!sqliteVec) {
      semantic.reason = 'sqlite-vec package not installed';
      return semantic;
    }
    try {
      sqliteVec.load(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          embedding_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          text_hash TEXT NOT NULL,
          input_text TEXT NOT NULL,
          embedded_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id ON memory_embeddings(memory_id);
      `);
      const inventory = prepare(`
        SELECT
          COUNT(*) AS indexed_count,
          MAX(dimensions) AS dimensions,
          MAX(provider) AS provider,
          MAX(model) AS model
        FROM memory_embeddings
      `).get() || {};
      const indexedCount = Number(inventory.indexed_count || 0);
      const needsReset =
        indexedCount === 0 ||
        Number(inventory.dimensions || 0) !== DEFAULT_EMBEDDING_DIMENSIONS ||
        inventory.provider !== DEFAULT_EMBEDDING_PROVIDER ||
        inventory.model !== DEFAULT_EMBEDDING_MODEL;
      if (needsReset) {
        db.exec('DROP TABLE IF EXISTS memory_vec;');
        if (indexedCount > 0) {
          db.exec('DELETE FROM memory_embeddings;');
        }
      }
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
          embedding float[${DEFAULT_EMBEDDING_DIMENSIONS}]
        );
      `);
      semantic.available = true;
      semantic.selectEmbeddingMeta = prepare(`
        SELECT embedding_rowid, text_hash
        FROM memory_embeddings
        WHERE memory_id = ?
      `);
      semantic.insertEmbeddingMeta = prepare(`
        INSERT INTO memory_embeddings (
          memory_id, provider, model, dimensions, text_hash, input_text, embedded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      semantic.updateEmbeddingMeta = prepare(`
        UPDATE memory_embeddings
        SET provider = ?,
            model = ?,
            dimensions = ?,
            text_hash = ?,
            input_text = ?,
            embedded_at = ?
        WHERE embedding_rowid = ?
      `);
      semantic.deleteEmbeddingVec = prepare('DELETE FROM memory_vec WHERE rowid = ?');
      semantic.insertEmbeddingVec = prepare('INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)');
      semantic.deleteEmbeddingMetaByMemory = prepare('DELETE FROM memory_embeddings WHERE memory_id = ?');
      semantic.selectEmbeddingStats = prepare(`
        SELECT COUNT(*) AS indexed_count, MAX(embedded_at) AS last_embedded_at
        FROM memory_embeddings
      `);
      semantic.selectEmbeddingIdByMemory = prepare(`
        SELECT embedding_rowid
        FROM memory_embeddings
        WHERE memory_id = ?
      `);
      return semantic;
    } catch (error) {
      semantic.available = false;
      semantic.reason = error && error.message ? error.message : String(error);
      return semantic;
    }
  }

  const semantic = createSemanticState();

  function buildId(item) {
    const sourceSeed = [
      item.scope,
      item.repoId || '',
      item.category || '',
      item.title || '',
      item.sourcePath || '',
      item.sourceSymbol || '',
      String(item.content || '').slice(0, 160),
    ].join('|');
    return item.id || stableId(sourceSeed);
  }

  async function indexMemory(memory, options = {}) {
    if (!semantic.available) {
      return { available: false, indexed: false, reason: semantic.reason };
    }
    const inputText = buildMemoryEmbeddingInput(memory);
    const textHash = stableId(inputText);
    const existing = semantic.selectEmbeddingMeta.get(memory.id);
    if (existing && existing.text_hash === textHash && !options.force) {
      return {
        available: true,
        indexed: false,
        skipped: true,
        embeddingRowId: Number(existing.embedding_rowid),
      };
    }
    let embeddingRowId = existing ? Number(existing.embedding_rowid) : null;
    const embeddedAt = toIso(new Date());
    if (!embeddingRowId) {
      const insertResult = semantic.insertEmbeddingMeta.run(
        memory.id,
        semantic.provider,
        semantic.model,
        semantic.dimensions,
        textHash,
        inputText,
        embeddedAt
      );
      embeddingRowId = Number(insertResult.lastInsertRowid);
    } else {
      semantic.updateEmbeddingMeta.run(
        semantic.provider,
        semantic.model,
        semantic.dimensions,
        textHash,
        inputText,
        embeddedAt,
        embeddingRowId
      );
    }
    if (!embeddingRowId) {
      return { available: true, indexed: false, reason: 'Failed to resolve embedding row id' };
    }
    embeddingRowId = Math.trunc(embeddingRowId);
    const vectorRowId = BigInt(embeddingRowId);
    const vector = JSON.stringify(await embedText(inputText));
    semantic.deleteEmbeddingVec.run(vectorRowId);
    semantic.insertEmbeddingVec.run(vectorRowId, vector);
    return {
      available: true,
      indexed: true,
      embeddingRowId,
      textHash,
    };
  }

  function removeMemoryById(memoryId) {
    if (semantic.available) {
      const existingEmbedding = semantic.selectEmbeddingMeta.get(memoryId);
      if (existingEmbedding) {
        semantic.deleteEmbeddingVec.run(BigInt(existingEmbedding.embedding_rowid));
        semantic.deleteEmbeddingMetaByMemory.run(memoryId);
      }
    }
    deleteFtsRow.run(memoryId);
    deleteMemoryItem.run(memoryId);
  }

  async function upsertMemory(item) {
    const tags = normalizeTags(item.tags);
    const record = {
      id: buildId(item),
      scope: item.scope || options.scope || 'repo',
      repo_id: item.scope === 'repo' ? (item.repoId || options.repoId || null) : null,
      repo_root: item.scope === 'repo' ? (item.repoRoot || options.repoRoot || null) : null,
      category: item.category || 'note',
      title: String(item.title || '').trim() || 'Untitled memory',
      content: String(item.content || '').trim(),
      tags_json: serializeTags(tags),
      tags_text: tagsText(tags),
      source_kind: item.sourceKind || null,
      source_path: item.sourcePath || null,
      source_symbol: item.sourceSymbol || null,
      importance: clamp01(item.importance, 0.5),
      confidence: clamp01(item.confidence, 0.7),
      pinned: item.pinned ? 1 : 0,
      created_at: item.createdAt || toIso(new Date()),
      updated_at: item.updatedAt || toIso(new Date()),
      last_accessed_at: item.lastAccessedAt || null,
      access_count: Number.isFinite(Number(item.accessCount)) ? Number(item.accessCount) : 0,
      metadata_json: JSON.stringify(item.metadata || {}),
    };
    insertItem.run(record);
    deleteFtsRow.run(record.id);
    insertFtsRow.run(
      record.id,
      record.title,
      record.content,
      record.tags_text,
      record.source_path || '',
      record.source_symbol || ''
    );
    const saved = rowToMemory(selectById.get(record.id));
    if (semantic.available) {
      await indexMemory(saved);
    }
    return saved;
  }

  function buildBaseWhereClauses(query, alias, params) {
    const where = [];
    if (options.scope === 'repo') {
      where.push(`${alias}.repo_id = $repo_id`);
      params.repo_id = query.repoId || options.repoId || null;
    }
    if (query.category) {
      where.push(`${alias}.category = $category`);
      params.category = query.category;
    }
    if (query.sourcePath) {
      where.push(`${alias}.source_path = $source_path`);
      params.source_path = query.sourcePath;
    }
    if (query.sourceSymbol) {
      where.push(`${alias}.source_symbol = $source_symbol`);
      params.source_symbol = query.sourceSymbol;
    }
    if (Array.isArray(query.tags) && query.tags.length) {
      query.tags.forEach((tag, index) => {
        const key = `tag_${index}`;
        where.push(`${alias}.tags_text LIKE '%' || $${key} || '%'`);
        params[key] = tag;
      });
    }
    return where;
  }

  function buildSearchRows(query) {
    const params = {
      limit: query.limit || 10,
    };
    const where = buildBaseWhereClauses(query, 'm', params);
    const text = String(query.text || '').trim();
    let sql;

    if (text) {
      params.text = text;
      params.fts = text
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => `${token.replace(/"/g, '""')}*`)
        .join(' OR ');
      where.push(`(
        f.rowid IS NOT NULL OR
        m.title LIKE '%' || $text || '%' OR
        m.content LIKE '%' || $text || '%' OR
        m.tags_text LIKE '%' || $text || '%' OR
        COALESCE(m.source_path, '') LIKE '%' || $text || '%' OR
        COALESCE(m.source_symbol, '') LIKE '%' || $text || '%'
      )`);
      sql = `
        SELECT
          m.*,
          (
            (CASE WHEN m.title LIKE '%' || $text || '%' THEN 1.2 ELSE 0 END) +
            (CASE WHEN m.content LIKE '%' || $text || '%' THEN 0.7 ELSE 0 END) +
            (CASE WHEN m.tags_text LIKE '%' || $text || '%' THEN 0.5 ELSE 0 END) +
            (CASE WHEN f.rowid IS NOT NULL THEN 1.4 ELSE 0 END) +
            (m.importance * 0.8) +
            (m.confidence * 0.5) +
            (CASE WHEN m.pinned = 1 THEN 0.5 ELSE 0 END) +
            (CASE
              WHEN julianday('now') - julianday(m.updated_at) <= 7 THEN 0.3
              WHEN julianday('now') - julianday(m.updated_at) <= 30 THEN 0.15
              ELSE 0
            END)
          ) AS score
        FROM memory_items AS m
        LEFT JOIN memory_fts AS f ON f.id = m.id AND memory_fts MATCH $fts
        WHERE ${where.join(' AND ')}
        ORDER BY score DESC, m.updated_at DESC
        LIMIT $limit
      `;
    } else {
      sql = `
        SELECT
          m.*,
          (
            (CASE WHEN m.pinned = 1 THEN 1 ELSE 0 END) +
            (m.importance * 0.9) +
            (m.confidence * 0.4) +
            (CASE
              WHEN julianday('now') - julianday(m.updated_at) <= 7 THEN 0.3
              WHEN julianday('now') - julianday(m.updated_at) <= 30 THEN 0.15
              ELSE 0
            END)
          ) AS score
        FROM memory_items AS m
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY score DESC, m.updated_at DESC
        LIMIT $limit
      `;
    }
    return prepare(sql).all(params).map(rowToMemory);
  }

  async function querySemanticMemories(query) {
    if (!semantic.available || !String(query.text || '').trim()) {
      return [];
    }
    const params = {
      limit: query.semanticLimit || query.limit || 10,
    };
    const where = buildBaseWhereClauses(query, 'm', params);
    params.embedding = JSON.stringify(await embedText(buildQueryEmbeddingInput(query)));
    const sql = `
      SELECT
        m.*,
        v.distance
      FROM memory_vec AS v
      JOIN memory_embeddings AS e ON e.embedding_rowid = v.rowid
      JOIN memory_items AS m ON m.id = e.memory_id
      WHERE v.embedding MATCH $embedding
        AND v.k = $limit
        ${where.length ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY v.distance ASC
      LIMIT $limit
    `;
    return prepare(sql)
      .all(params)
      .map((row) => {
        const item = rowToMemory(row);
        item.score = semanticDistanceToScore(row.distance);
        return item;
      });
  }

  function queryMemories(query) {
    const rows = buildSearchRows(query);
    const now = toIso(new Date());
    const touch = prepare(`
      UPDATE memory_items
      SET access_count = access_count + 1,
          last_accessed_at = ?
      WHERE id = ?
    `);
    for (const row of rows) {
      touch.run(now, row.id);
    }
    return rows;
  }

  function removeSourceMemories({ sourcePath, sourceKind = null } = {}) {
    if (!sourcePath) return { removedCount: 0 };
    const rows = selectSourceMemoryIds.all({ source_path: sourcePath, source_kind: sourceKind });
    for (const row of rows) {
      removeMemoryById(row.id);
    }
    return { removedCount: rows.length };
  }

  async function reindexSemantic({ force = false, limit = 0 } = {}) {
    if (!semantic.available) {
      return { available: false, reason: semantic.reason, indexedCount: 0, skippedCount: 0 };
    }
    const rows = selectAllMemories.all().map(rowToMemory);
    const cappedRows = limit > 0 ? rows.slice(0, limit) : rows;
    let indexedCount = 0;
    let skippedCount = 0;
    for (const row of cappedRows) {
      const result = await indexMemory(row, { force });
      if (result.indexed) indexedCount += 1;
      else skippedCount += 1;
    }
    return {
      available: true,
      provider: semantic.provider,
      model: semantic.model,
      dimensions: semantic.dimensions,
      indexedCount,
      skippedCount,
    };
  }

  function listImportedSources() {
    return selectImportedSources.all().map((row) => ({
      sourcePath: row.source_path,
      sourceKind: row.source_kind,
    }));
  }

  function getSemanticStatus() {
    if (!semantic.available) {
      return {
        available: false,
        provider: semantic.provider,
        model: semantic.model,
        dimensions: semantic.dimensions,
        indexedCount: 0,
        lastEmbeddedAt: null,
        reason: semantic.reason,
      };
    }
    const stats = semantic.selectEmbeddingStats.get() || {};
    return {
      available: true,
      provider: semantic.provider,
      model: semantic.model,
      dimensions: semantic.dimensions,
      indexedCount: Number(stats.indexed_count || 0),
      lastEmbeddedAt: stats.last_embedded_at || null,
    };
  }

  function getHotMemories({ limit = 20, includeContent = true } = {}) {
    const rows = selectHot
      .all({ scope: options.scope || 'repo', repo_id: options.repoId || null, limit })
      .map(rowToMemory)
      .map((item) => (includeContent ? item : { ...item, content: '' }));
    return rows;
  }

  function getStats() {
    const totals = selectStats.get() || {};
    return {
      dbPath,
      scope: options.scope,
      repoId: options.repoId || null,
      itemCount: Number(totals.item_count || 0),
      pinnedCount: Number(totals.pinned_count || 0),
      categoryCount: Number(totals.category_count || 0),
      newestUpdate: totals.newest_update || null,
      categories: selectCategoryBreakdown.all().map((row) => ({ category: row.category, count: Number(row.count || 0) })),
      semantic: getSemanticStatus(),
    };
  }

  function close() {
    db.close();
  }

  return {
    upsertMemory,
    queryMemories,
    querySemanticMemories,
    getHotMemories,
    removeSourceMemories,
    listImportedSources,
    reindexSemantic,
    getSemanticStatus,
    getStats,
    close,
  };
}

module.exports = {
  createStore,
  DEFAULT_GLOBAL_DB_PATH,
  DEFAULT_REPO_DIR_NAME,
  DEFAULT_CACHE_FILE_NAME,
  computeRepoId,
  ensureDirectory,
  toIso,
};
