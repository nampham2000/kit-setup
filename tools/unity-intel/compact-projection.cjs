'use strict';

const {
  stableStringify,
  sha256Hex,
  isAbsoluteFilesystemPath,
} = require('./live-schema.cjs');

const SUMMARY_MAX_BYTES = 24 * 1024;
const PAGE_MAX_BYTES = 48 * 1024;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CURSOR_VERSION = 1;
const SECRET_KEY = /(?:token|password|secret|api[-_]?key|authorization|credential|private[-_]?key)/i;
const RAW_SOURCE_KEY = /^(?:rawSource|sourceText|yamlText|csharpSource|codeText|fileContents?)$/i;
const SEVERITY_ORDER = new Map([['high', 3], ['medium', 2], ['low', 1]]);

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function redactAbsolutePaths(value) {
  let result = value;
  if (isAbsoluteFilesystemPath(result)) return '[redacted:absolute-path]';
  // Require a non-scheme boundary so the `p:/` portion of `http://...` is not
  // mistaken for a Windows drive path. Absolute paths at the start of a string
  // or after punctuation/whitespace are still redacted.
  result = result.replace(/(?<![a-z0-9+.-])[a-z]:[\\/](?:[^\s,;"'<>]|\s(?![-–—]))+/gi,
    '[redacted:absolute-path]');
  result = result.replace(/\\\\[^\\/\s]+[\\/][^\s,;"'<>]+/g, '[redacted:absolute-path]');
  result = result.replace(/(^|\s)\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)\/[^\s,;"'<>]+/g,
    '$1[redacted:absolute-path]');
  return result;
}

function sanitizeForProjection(value, options = {}, state = { depth: 0, seen: new Set() }) {
  const maxString = Number.isInteger(options.maxString) ? Math.max(16, options.maxString) : 240;
  const maxArray = Number.isInteger(options.maxArray) ? Math.max(1, options.maxArray) : MAX_PAGE_SIZE;
  const maxDepth = Number.isInteger(options.maxDepth) ? Math.max(2, options.maxDepth) : 10;
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const redacted = redactAbsolutePaths(value);
    return redacted.length <= maxString ? redacted : `${redacted.slice(0, maxString - 1)}…`;
  }
  if (typeof value !== 'object') return String(value).slice(0, maxString);
  if (state.depth >= maxDepth) return '[truncated:depth]';
  if (state.seen.has(value)) return '[truncated:circular]';
  state.seen.add(value);
  const childState = { depth: state.depth + 1, seen: state.seen };
  let output;
  if (Array.isArray(value)) {
    output = value.slice(0, maxArray).map(item => sanitizeForProjection(item, options, childState));
    if (value.length > maxArray) output.push({ truncatedItems: value.length - maxArray });
  } else {
    output = {};
    for (const key of Object.keys(value).sort()) {
      if (SECRET_KEY.test(key) || RAW_SOURCE_KEY.test(key)) continue;
      output[key] = sanitizeForProjection(value[key], options, childState);
    }
  }
  state.seen.delete(value);
  return output;
}

function cursorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function queryHash(query) {
  return sha256Hex(stableStringify(sanitizeForProjection(query || {}, { maxString: 160, maxArray: 50 }))).slice(0, 24);
}

function encodeCursor(input) {
  const payload = {
    v: CURSOR_VERSION,
    s: String(input.scanId),
    x: String(input.section),
    q: String(input.queryHash || queryHash(input.query)),
    a: String(input.after),
  };
  return Buffer.from(stableStringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor, expected = {}) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || !/^[a-z0-9_-]+$/i.test(cursor)) {
    throw cursorError('UNITY_CURSOR_INVALID', 'Cursor không hợp lệ.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (_) {
    throw cursorError('UNITY_CURSOR_INVALID', 'Cursor không giải mã được.');
  }
  if (!payload || payload.v !== CURSOR_VERSION || typeof payload.s !== 'string' ||
      typeof payload.x !== 'string' || typeof payload.q !== 'string' || typeof payload.a !== 'string') {
    throw cursorError('UNITY_CURSOR_INVALID', 'Cursor thiếu trường bắt buộc.');
  }
  if (expected.scanId !== undefined && payload.s !== String(expected.scanId)) {
    throw cursorError('UNITY_CURSOR_STALE', 'Cursor thuộc scan khác.');
  }
  if (expected.section !== undefined && payload.x !== String(expected.section)) {
    throw cursorError('UNITY_CURSOR_SECTION_MISMATCH', 'Cursor thuộc section khác.');
  }
  const expectedQueryHash = expected.queryHash || (expected.query !== undefined ? queryHash(expected.query) : null);
  if (expectedQueryHash && payload.q !== expectedQueryHash) {
    throw cursorError('UNITY_CURSOR_QUERY_MISMATCH', 'Cursor thuộc query khác.');
  }
  return { version: payload.v, scanId: payload.s, section: payload.x, queryHash: payload.q, after: payload.a };
}

function sectionItems(snapshot, section) {
  if (section === 'assets') return snapshot.assets && snapshot.assets.records || [];
  if (section === 'dependencies') return snapshot.dependencies && snapshot.dependencies.edges || [];
  if (section === 'unresolved') return snapshot.dependencies && snapshot.dependencies.unresolved || [];
  if (section === 'diagnostics') return snapshot.diagnostics || [];
  if (section === 'features') return snapshot.features && (snapshot.features.sketch || snapshot.features.signals || snapshot.features.blockers) || [];
  if (section === 'scenes') return snapshot.buildScenes || [];
  if (section === 'scripts') return snapshot.scriptIndex && snapshot.scriptIndex.scripts || snapshot.scripts || [];
  throw cursorError('UNITY_SECTION_INVALID', `Section không hỗ trợ: ${section}`);
}

function stableItemId(item, section) {
  if (item && typeof item === 'object') {
    const direct = item.stableId || item.id || item.key || item.guid || item.assetPath || item.path;
    if (direct) return String(direct);
    if (section === 'dependencies') {
      return [item.from || '', item.to || '', item.kind || '', item.objectId || '', item.fieldPath || ''].join('|');
    }
    if (section === 'diagnostics') return [item.code || '', item.objectId || '', item.fieldPath || ''].join('|');
  }
  return `item:${sha256Hex(stableStringify(item)).slice(0, 20)}`;
}

function keyedItems(items, section) {
  const sorted = items.map(item => {
    const sanitized = sanitizeForProjection(item, { maxString: 320, maxArray: 100 });
    const stableId = stableItemId(sanitized, section);
    return {
      baseKey: `${stableId}\0${sha256Hex(stableStringify(sanitized)).slice(0, 16)}`,
      stableId,
      item: sanitized,
    };
  }).sort((a, b) => a.baseKey.localeCompare(b.baseKey));
  const occurrences = new Map();
  return sorted.map(entry => {
    const occurrence = occurrences.get(entry.baseKey) || 0;
    occurrences.set(entry.baseKey, occurrence + 1);
    return { ...entry, key: `${entry.baseKey}\0${String(occurrence).padStart(8, '0')}` };
  });
}

function pageEnvelope(scanId, section, queryDigest, items, total, nextCursor, truncatedItems) {
  return {
    schemaVersion: 1,
    scanId,
    section,
    queryHash: queryDigest,
    total,
    count: items.length,
    items,
    nextCursor,
    truncatedItems,
  };
}

function oversizedPlaceholder(entry) {
  const item = entry.item && typeof entry.item === 'object' ? entry.item : {};
  return {
    id: entry.stableId,
    type: item.type || item.kind || null,
    path: item.assetPath || item.path || null,
    truncated: true,
  };
}

function createCompactPage(snapshot, request = {}) {
  const section = request.section || 'assets';
  const scanId = String(request.scanId || snapshot.scanId || snapshot.live && snapshot.live.scanId || snapshot.fingerprint || 'static');
  const query = request.query || {};
  const digest = queryHash(query);
  const pageSize = request.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(request.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw cursorError('UNITY_PAGE_SIZE_INVALID', `pageSize phải nằm trong 1..${MAX_PAGE_SIZE}.`);
  }
  const maxBytes = request.maxBytes === undefined ? PAGE_MAX_BYTES : Number(request.maxBytes);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > PAGE_MAX_BYTES) {
    throw cursorError('UNITY_PAGE_LIMIT_INVALID', `maxBytes phải nằm trong 1024..${PAGE_MAX_BYTES}.`);
  }
  const entries = keyedItems(request.items || sectionItems(snapshot, section), section);
  let start = 0;
  if (request.cursor) {
    const decoded = decodeCursor(request.cursor, { scanId, section, queryHash: digest });
    const found = entries.findIndex(entry => entry.key === decoded.after);
    if (found < 0) throw cursorError('UNITY_CURSOR_STALE', 'Cursor item không còn tồn tại trong scan.');
    start = found + 1;
  }

  const page = [];
  let lastKey = null;
  let stoppedByBytes = false;
  for (let index = start; index < entries.length && page.length < pageSize; index += 1) {
    const entry = entries[index];
    const candidate = [...page, entry.item];
    const hasMore = index + 1 < entries.length;
    const candidateCursor = hasMore ? encodeCursor({ scanId, section, queryHash: digest, after: entry.key }) : null;
    const envelope = pageEnvelope(scanId, section, digest, candidate, entries.length, candidateCursor, 0);
    if (jsonBytes(envelope) <= maxBytes) {
      page.push(entry.item);
      lastKey = entry.key;
      continue;
    }
    stoppedByBytes = true;
    if (!page.length) {
      const placeholder = oversizedPlaceholder(entry);
      const placeholderCursor = hasMore ? encodeCursor({ scanId, section, queryHash: digest, after: entry.key }) : null;
      const placeholderEnvelope = pageEnvelope(scanId, section, digest, [placeholder], entries.length, placeholderCursor, 1);
      if (jsonBytes(placeholderEnvelope) > maxBytes) {
        throw cursorError('UNITY_PAGE_ITEM_TOO_LARGE', 'Không thể tạo placeholder trong giới hạn payload.');
      }
      page.push(placeholder);
      lastKey = entry.key;
    }
    break;
  }
  const consumed = start + page.length;
  const hasMore = consumed < entries.length || stoppedByBytes;
  const nextCursor = hasMore && lastKey
    ? encodeCursor({ scanId, section, queryHash: digest, after: lastKey })
    : null;
  const truncatedItems = Math.max(0, entries.length - consumed);
  const result = pageEnvelope(scanId, section, digest, page, entries.length, nextCursor, truncatedItems);
  if (jsonBytes(result) > maxBytes) throw cursorError('UNITY_PAGE_LIMIT_EXCEEDED', 'Payload vượt giới hạn sau khi đóng gói.');
  return result;
}

function compactDiagnostic(diagnostic) {
  return sanitizeForProjection({
    key: diagnostic.key,
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    action: diagnostic.action,
    count: diagnostic.count,
    evidence: (diagnostic.evidence || []).slice(0, 3),
  }, { maxString: 200, maxArray: 3 });
}

function createCompactSummary(snapshot, options = {}) {
  const maxBytes = options.maxBytes === undefined ? SUMMARY_MAX_BYTES : Number(options.maxBytes);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > SUMMARY_MAX_BYTES) {
    throw cursorError('UNITY_SUMMARY_LIMIT_INVALID', `maxBytes phải nằm trong 1024..${SUMMARY_MAX_BYTES}.`);
  }
  const packages = Object.entries(snapshot.project && snapshot.project.packages || {})
    .sort(([a], [b]) => a.localeCompare(b));
  const allFeatures = snapshot.features &&
    (snapshot.features.sketch || snapshot.features.signals || snapshot.features.blockers) || [];
  const allDiagnostics = [...(snapshot.diagnostics || [])].sort((a, b) =>
    (SEVERITY_ORDER.get(b.severity) || 0) - (SEVERITY_ORDER.get(a.severity) || 0) ||
    String(a.code || '').localeCompare(String(b.code || '')));
  const allScenes = [...(snapshot.buildScenes || [])].sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
  const diagnosticCounts = { high: 0, medium: 0, low: 0 };
  for (const diagnostic of allDiagnostics) {
    if (Object.prototype.hasOwnProperty.call(diagnosticCounts, diagnostic.severity)) {
      diagnosticCounts[diagnostic.severity] += Math.max(1, Number(diagnostic.count) || 1);
    }
  }
  const summary = {
    schemaVersion: snapshot.schemaVersion,
    provider: snapshot.provider,
    scanId: snapshot.scanId || snapshot.live && snapshot.live.scanId || snapshot.fingerprint || 'static',
    project: {
      name: snapshot.project && snapshot.project.name || null,
      unityVersion: snapshot.project && snapshot.project.unityVersion || null,
      packages: packages.slice(0, 40).map(([name, version]) => sanitizeForProjection(
        { name, version }, { maxString: 160, maxArray: 2 },
      )),
      packageCount: packages.length,
    },
    inventory: sanitizeForProjection(snapshot.inventory || {}, { maxString: 80, maxArray: 30 }),
    buildScenes: sanitizeForProjection(allScenes.slice(0, 20), { maxString: 200, maxArray: 20 }),
    dependencySummary: {
      edges: snapshot.dependencies && snapshot.dependencies.edgeCount || 0,
      unresolved: snapshot.dependencies && snapshot.dependencies.unresolvedCount || 0,
      classifications: snapshot.dependencies && snapshot.dependencies.classificationCounts || {},
    },
    featureSketch: sanitizeForProjection(allFeatures.slice(0, 20), { maxString: 200, maxArray: 20 }),
    diagnostics: allDiagnostics.slice(0, 30).map(compactDiagnostic),
    diagnosticCounts,
    preflightGate: {
      scanComplete: true,
      featureCount: allFeatures.length,
      sourceHighCount: diagnosticCounts.high,
      state: diagnosticCounts.high ? 'disposition-required' : 'ready',
    },
    sections: {
      assets: snapshot.assets && snapshot.assets.records && snapshot.assets.records.length || 0,
      dependencies: snapshot.dependencies && snapshot.dependencies.edges && snapshot.dependencies.edges.length || 0,
      unresolved: snapshot.dependencies && snapshot.dependencies.unresolved && snapshot.dependencies.unresolved.length || 0,
      diagnostics: allDiagnostics.length,
      features: allFeatures.length,
      scenes: allScenes.length,
      scripts: snapshot.scriptIndex && snapshot.scriptIndex.scripts && snapshot.scriptIndex.scripts.length || 0,
    },
    truncated: {
      packages: Math.max(0, packages.length - 40),
      buildScenes: Math.max(0, allScenes.length - 20),
      features: Math.max(0, allFeatures.length - 20),
      diagnostics: Math.max(0, allDiagnostics.length - 30),
    },
  };

  const trimTargets = [
    ['diagnostics', 'diagnostics'],
    ['featureSketch', 'features'],
    ['buildScenes', 'buildScenes'],
    ['project.packages', 'packages'],
  ];
  while (jsonBytes(summary) > maxBytes) {
    let trimmed = false;
    for (const [target, counter] of trimTargets) {
      const array = target === 'project.packages' ? summary.project.packages : summary[target];
      if (!array.length) continue;
      array.pop();
      summary.truncated[counter] += 1;
      trimmed = true;
      if (jsonBytes(summary) <= maxBytes) break;
    }
    if (!trimmed) break;
  }
  if (jsonBytes(summary) > maxBytes) {
    const minimal = {
      schemaVersion: summary.schemaVersion,
      provider: summary.provider,
      scanId: summary.scanId,
      project: { name: summary.project.name, unityVersion: summary.project.unityVersion },
      inventory: summary.inventory,
      dependencySummary: summary.dependencySummary,
      diagnosticCounts: summary.diagnosticCounts,
      preflightGate: summary.preflightGate,
      sections: summary.sections,
      truncated: { ...summary.truncated, compacted: true },
    };
    if (jsonBytes(minimal) > maxBytes) throw cursorError('UNITY_SUMMARY_LIMIT_EXCEEDED', 'Summary tối thiểu vẫn vượt giới hạn.');
    return minimal;
  }
  return summary;
}

module.exports = {
  SUMMARY_MAX_BYTES,
  PAGE_MAX_BYTES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  jsonBytes,
  redactAbsolutePaths,
  sanitizeForProjection,
  queryHash,
  encodeCursor,
  decodeCursor,
  stableItemId,
  createCompactPage,
  createCompactSummary,
};
