'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SOURCE_OVERRIDE_FILE = path.join('.local-memory', 'source-overrides.json');
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.local-memory',
  'assets',
  'library',
  'node_modules',
  'profiles',
  'temp',
]);
const GENERIC_TAGS = new Set(['docs', 'doc', 'guide', 'notes', 'repo', 'root', 'tools', 'extensions', 'readme', 'feature', 'features']);

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function sanitizeTag(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function addUniqueTags(target, values) {
  const set = new Set(target);
  for (const value of values) {
    const tag = sanitizeTag(value);
    if (!tag || GENERIC_TAGS.has(tag)) continue;
    set.add(tag);
  }
  return Array.from(set);
}

function inferPathTags(relativePath) {
  const segments = toPosixPath(relativePath).split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] || '';
  const pathTags = segments.slice(0, -1).slice(-3);
  return addUniqueTags([], [...pathTags, fileName.replace(/\.[^.]+$/, '')]);
}

function createSourcePlan(filePath, relativePath, details) {
  return {
    filePath,
    relativePath,
    sourceKind: details.sourceKind,
    category: details.category,
    tags: addUniqueTags(details.tags || [], inferPathTags(relativePath)),
    importance: details.importance,
    confidence: details.confidence,
    priority: details.priority,
  };
}

function classifyMarkdownSource(repoRoot, filePath) {
  const relativePath = toPosixPath(path.relative(repoRoot, filePath));
  const fileName = path.basename(relativePath).toLowerCase();

  if (/\.todo\.md$/.test(fileName)) {
    return createSourcePlan(filePath, relativePath, {
      sourceKind: 'todo-markdown',
      category: 'porting-note',
      tags: ['todo', 'porting'],
      importance: 0.62,
      confidence: 0.72,
      priority: 10,
      includeByDefault: true,
    });
  }
  if (/changelog/.test(fileName)) {
    return createSourcePlan(filePath, relativePath, {
      sourceKind: 'changelog-markdown',
      category: 'change-note',
      tags: ['changelog', 'history'],
      importance: 0.5,
      confidence: 0.78,
      priority: 8,
      includeByDefault: true,
    });
  }
  if (/(summary|postmortem|retro|incident|bugfix|bug-fix|lessons|fix-summary)/.test(fileName)) {
    return createSourcePlan(filePath, relativePath, {
      sourceKind: 'bug-summary-markdown',
      category: 'bug-fix',
      tags: ['summary', 'bug-fix'],
      importance: 0.68,
      confidence: 0.8,
      priority: 9,
      includeByDefault: true,
    });
  }
  if (/^readme(\.[a-z]+)?\.md$/.test(fileName) || /^feature_guide/i.test(fileName)) {
    if (relativePath.startsWith('tools/') || relativePath.startsWith('extensions/')) {
      return createSourcePlan(filePath, relativePath, {
        sourceKind: 'reference-markdown',
        category: 'implementation-note',
        tags: ['reference'],
        importance: 0.3,
        confidence: 0.64,
        priority: 4,
        includeByDefault: false,
        minCharacters: 80,
        minWords: 12,
        maxBlocks: 80,
      });
    }
  }
  return null;
}

function walkMarkdownSources(repoRoot, directory, sink, options) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      walkMarkdownSources(repoRoot, absolutePath, sink, options);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const stats = fs.statSync(absolutePath);
    if (stats.size > options.maxFileBytes) continue;
    const plan = classifyMarkdownSource(repoRoot, absolutePath);
    if (plan) sink.push(plan);
  }
}

function loadOverrideSources(repoRoot, overrideFile) {
  const absoluteOverrideFile = path.resolve(repoRoot, overrideFile || DEFAULT_SOURCE_OVERRIDE_FILE);
  if (!fs.existsSync(absoluteOverrideFile)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absoluteOverrideFile, 'utf8'));
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.sources) ? parsed.sources : [];
  return entries
    .filter((entry) => entry && entry.path)
    .map((entry, index) => {
      const filePath = path.isAbsolute(entry.path) ? entry.path : path.resolve(repoRoot, entry.path);
      if (!fs.existsSync(filePath)) return null;
      return createSourcePlan(filePath, toPosixPath(path.relative(repoRoot, filePath)), {
        sourceKind: entry.sourceKind || 'override-markdown',
        category: entry.category || 'note',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        importance: Number(entry.importance) || 0.55,
        confidence: Number(entry.confidence) || 0.7,
        priority: 20 - index,
        includeByDefault: true,
        minCharacters: Number(entry.minCharacters) || 0,
        minWords: Number(entry.minWords) || 0,
        maxBlocks: Number(entry.maxBlocks) || 0,
      });
    })
    .filter(Boolean);
}

function discoverMemorySources(repoRoot, options = {}) {
  const root = path.resolve(repoRoot || process.cwd());
  const results = [];
  walkMarkdownSources(root, root, results, {
    maxFileBytes: Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES,
  });
  if (options.includeOverrides !== false) {
    for (const plan of loadOverrideSources(root, options.overrideFile)) {
      results.push(plan);
    }
  }
  return results
    .filter((plan) => options.includeReference ? true : plan.sourceKind !== 'reference-markdown')
    .sort((a, b) => b.priority - a.priority || a.relativePath.localeCompare(b.relativePath))
    .filter((plan, index, all) => all.findIndex((other) => other.filePath === plan.filePath && other.sourceKind === plan.sourceKind) === index);
}

module.exports = {
  DEFAULT_SOURCE_OVERRIDE_FILE,
  discoverMemorySources,
};