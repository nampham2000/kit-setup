'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createStore, inspectDatabaseIntegrity, repairDatabase } = require('./store');

test('repair keeps an exact backup and recovers only valid memory rows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-memory-repair-'));
  const dbPath = path.join(root, 'repo.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_items (
      id TEXT, scope TEXT, repo_id TEXT, repo_root TEXT, category TEXT, title TEXT, content TEXT,
      tags_json TEXT, tags_text TEXT, source_kind TEXT, source_path TEXT, source_symbol TEXT,
      importance REAL, confidence REAL, pinned INTEGER, created_at TEXT, updated_at TEXT,
      last_accessed_at TEXT, access_count INTEGER, metadata_json TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO memory_items VALUES (
      @id, @scope, @repo_id, @repo_root, @category, @title, @content,
      @tags_json, @tags_text, @source_kind, @source_path, @source_symbol,
      @importance, @confidence, @pinned, @created_at, @updated_at,
      @last_accessed_at, @access_count, @metadata_json
    )
  `);
  insert.run({
    id: 'valid-1', scope: 'repo', repo_id: 'repo:test', repo_root: root,
    category: 'tip', title: 'Valid memory', content: 'Keep this row.',
    tags_json: '["repair"]', tags_text: 'repair', source_kind: null,
    source_path: null, source_symbol: null, importance: 0.9, confidence: 0.95,
    pinned: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    last_accessed_at: null, access_count: 0, metadata_json: '{}',
  });
  insert.run({
    id: null, scope: 'repo', repo_id: 'repo:test', repo_root: root,
    category: null, title: null, content: null, tags_json: null, tags_text: null,
    source_kind: null, source_path: null, source_symbol: null, importance: null,
    confidence: null, pinned: null, created_at: null, updated_at: null,
    last_accessed_at: null, access_count: null, metadata_json: null,
  });
  db.close();
  const original = fs.readFileSync(dbPath);

  const result = await repairDatabase({
    dbPath, scope: 'repo', repoRoot: root, repoId: 'repo:test', reindexSemantic: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.equal(result.recoveredRowCount, 1);
  assert.equal(result.invalidRowCount, 1);
  assert.equal(inspectDatabaseIntegrity(dbPath).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(result.backupDir, path.basename(dbPath))), original);

  const store = createStore({ dbPath, scope: 'repo', repoRoot: root, repoId: 'repo:test' });
  try {
    assert.equal(store.getStats().itemCount, 1);
    assert.equal(store.queryMemories({ text: 'Valid', repoId: 'repo:test', limit: 5 }).length, 1);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
