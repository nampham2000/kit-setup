'use strict';

/**
 * Incremental Migration Cache & State Database
 *
 * Implements Section 7.6 of the Migration Specification:
 * - Cache migration results per file (by source hash SHA-256)
 * - On re-run, only process changed files
 * - Reuse previously generated AI refinements unless source changed
 * - Maintain a persistent migration state database
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MigrationCacheManager {
  constructor(cacheFilePath = '') {
    this.cacheFilePath = cacheFilePath || path.resolve(process.cwd(), '.migration_cache.json');
    this.state = {
      version: '1.0.0',
      lastRun: new Date().toISOString(),
      files: {},       // filePath -> { hash, tsPath, lastModified, astChunksCount }
      refinements: {}, // chunkId -> { sourceHash, patch, explanation, timestamp }
    };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = { ...this.state, ...parsed };
      }
    } catch (e) {
      // Ignore cache load errors and start fresh
    }
  }

  save() {
    try {
      this.state.lastRun = new Date().toISOString();
      const parent = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[MigrationCache] Failed to save cache: ${e.message}`);
    }
  }

  computeHash(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Checks if a file needs migration or can use cached output.
   * @param {string} filePath - Source C# file path
   * @param {string} content - Source C# file content
   * @returns {boolean} True if file changed and must be migrated
   */
  isChanged(filePath, content) {
    const hash = this.computeHash(content);
    const cached = this.state.files[filePath];
    if (!cached) return true;
    return cached.hash !== hash;
  }

  /**
   * Records a successful compilation / migration for a file.
   * @param {string} filePath - Source C# file path
   * @param {string} content - Source C# file content
   * @param {string} tsPath - Emitted TypeScript file path
   * @param {number} [astChunksCount=0]
   */
  recordFile(filePath, content, tsPath, astChunksCount = 0) {
    const hash = this.computeHash(content);
    this.state.files[filePath] = {
      hash,
      tsPath,
      lastModified: new Date().toISOString(),
      astChunksCount,
    };
  }

  /**
   * Retrieves a previously cached AI refinement patch for a chunk ID if the source hash matches.
   * @param {string} chunkId - Identifier of the chunk (e.g. 'Player:update:45')
   * @param {string} currentSourceHash - Hash of the source file
   * @returns {Object | null}
   */
  getCachedRefinement(chunkId, currentSourceHash) {
    const cached = this.state.refinements[chunkId];
    if (cached && cached.sourceHash === currentSourceHash) {
      return cached.patch;
    }
    return null;
  }

  /**
   * Records an AI refinement patch for a chunk ID.
   * @param {string} chunkId
   * @param {string} sourceHash
   * @param {Object} patch
   * @param {string} explanation
   */
  recordRefinement(chunkId, sourceHash, patch, explanation = '') {
    this.state.refinements[chunkId] = {
      sourceHash,
      patch,
      explanation,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Clears the entire cache.
   */
  clear() {
    this.state.files = {};
    this.state.refinements = {};
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        fs.unlinkSync(this.cacheFilePath);
      } catch (e) {}
    }
  }
}

module.exports = {
  MigrationCacheManager,
};
