'use strict';

const crypto = require('crypto');
const path = require('path');
const { toIso } = require('./store');

function stableId(seed) {
  return crypto.createHash('sha1').update(String(seed || '')).digest('hex');
}

function normalizeBlock(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .trim();
}

function cleanTitle(text) {
  return String(text || '')
    .replace(/^[-*+\d.\s]+/, '')
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, 120) || 'Untitled memory';
}

function splitMarkdownBlocks(text) {
  const normalized = normalizeBlock(text);
  if (!normalized) return [];
  const lines = normalized.split('\n');
  const blocks = [];
  let current = [];

  function flush() {
    const joined = current.join('\n').trim();
    if (joined) blocks.push(joined);
    current = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed) && current.length) {
      flush();
    }
    if (/^[-*+]\s+/.test(trimmed) && current.length) {
      flush();
    }
    if (/^\d+\.\s+/.test(trimmed) && current.length) {
      flush();
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function inferCategory(block, fallback) {
  if (fallback && fallback !== 'note') return fallback;
  const lower = block.toLowerCase();
  if (lower.includes('bug') || lower.includes('issue') || lower.includes('fix')) return 'bug-fix';
  if (lower.includes('port') || lower.includes('convert')) return 'porting-note';
  if (lower.includes('tip') || lower.includes('workaround') || lower.includes('trap')) return 'tip';
  return fallback || 'note';
}

function inferImportance(block, fallback) {
  const lower = block.toLowerCase();
  if (lower.includes('critical') || lower.includes('always')) return 0.95;
  if (lower.includes('issue') || lower.includes('bug') || lower.includes('trap')) return Math.max(fallback, 0.7);
  return fallback;
}

function parseMarkdownMemories(text, options = {}) {
  const filePath = options.filePath ? path.resolve(options.filePath) : null;
  const baseTags = Array.isArray(options.tags) ? options.tags : [];
  const createdAt = toIso(new Date());
  const blocks = splitMarkdownBlocks(text)
    .filter((block) => {
      if (options.minCharacters && block.length < Number(options.minCharacters)) return false;
      if (options.minWords) {
        const words = block.split(/\s+/).filter(Boolean);
        if (words.length < Number(options.minWords)) return false;
      }
      if (/^```[\s\S]*```$/.test(block.trim())) return false;
      return true;
    })
    .slice(0, options.maxBlocks ? Number(options.maxBlocks) : undefined);
  return blocks.map((block, index) => ({
    id: stableId([filePath || 'inline', options.sourceKind || 'markdown', index, cleanTitle(block.split('\n', 1)[0])].join('|')),
    scope: options.scope || 'repo',
    repoId: options.scope === 'repo' ? options.repoId || null : null,
    repoRoot: options.scope === 'repo' ? options.repoRoot || null : null,
    category: inferCategory(block, options.category || 'note'),
    title: cleanTitle(block.split('\n', 1)[0]),
    content: block,
    tags: Array.from(new Set([...baseTags, inferCategory(block, options.category || 'note')])),
    sourceKind: options.sourceKind || 'markdown',
    sourcePath: filePath,
    sourceSymbol: null,
    importance: inferImportance(block, Number(options.importance) || 0.55),
    confidence: Number(options.confidence) || 0.7,
    pinned: Boolean(options.pinned),
    createdAt,
    updatedAt: createdAt,
    metadata: {
      importIndex: index,
      importedFrom: filePath,
      parser: 'markdown-blocks',
    },
  }));
}

module.exports = {
  parseMarkdownMemories,
};