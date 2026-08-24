'use strict';

const GUID_RE = /guid:\s*([0-9a-f]{32})/gi;
const BUILTIN_GUIDS = new Set([
  '00000000000000000000000000000000',
  '0000000000000000d000000000000000',
  '0000000000000000e000000000000000',
  '0000000000000000f000000000000000',
]);

function extractGuidFromMeta(text) {
  const match = /(?:^|\r?\n)guid:\s*([0-9a-f]{32})(?:\r?\n|$)/i.exec(text || '');
  return match ? match[1].toLowerCase() : null;
}

function extractReferencedGuids(text) {
  const guids = new Set();
  for (const match of String(text || '').matchAll(GUID_RE)) guids.add(match[1].toLowerCase());
  return [...guids];
}

function referenceKind(fieldPath, provider) {
  if (provider === 'meta') return 'importer';
  const field = String(fieldPath || '').toLowerCase();
  if (field.includes('m_script')) return 'script';
  if (field.includes('sourceprefab') || field.includes('prefab')) return 'prefab';
  if (field.includes('material')) return 'material';
  if (field.includes('shader')) return 'shader';
  if (field.includes('sprite')) return 'sprite';
  if (field.includes('texture')) return 'texture';
  if (field.includes('controller')) return 'controller';
  if (field.includes('font')) return 'font';
  if (field.includes('audioclip')) return 'audio';
  return 'asset';
}

function extractGuidReferences(text, options = {}) {
  const provider = options.provider || 'asset';
  const allowBareGuid = options.allowBareGuid === true;
  const excluded = new Set((options.excludeGuids || []).filter(Boolean).map(value => String(value).toLowerCase()));
  const references = [];
  const stack = [];
  let objectId = null;
  let classId = null;
  const lines = String(text || '').split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    const header = /^---\s+!u!(\d+)\s+&(-?\d+)/.exec(line);
    if (header) {
      classId = Number(header[1]);
      objectId = header[2];
      stack.length = 0;
      continue;
    }
    const keyMatch = /^(\s*)(?:-\s+)?([^:#][^:]*):/.exec(line);
    let fieldPath = stack.map(item => item.key).join('.');
    if (keyMatch) {
      const indent = keyMatch[1].replace(/\t/g, '  ').length;
      const key = keyMatch[2].trim().replace(/^['"]|['"]$/g, '');
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      fieldPath = [...stack.map(item => item.key), key].filter(Boolean).join('.');
      stack.push({ indent, key });
    }
    GUID_RE.lastIndex = 0;
    for (const match of line.matchAll(GUID_RE)) {
      const guid = match[1].toLowerCase();
      if (excluded.has(guid)) continue;
      let hasPointerEvidence = /\bfileID\s*:/i.test(line);
      // A split Unity PPtr is a mapping whose bare `guid` key sits directly
      // after a sibling `fileID` key. Do not accept list entries such as
      // `- guid:`: AudioMixer and other assets use those for internal IDs.
      if (!hasPointerEvidence && /^\s*guid\s*:/i.test(line)) {
        const indent = /^\s*/.exec(line)[0].replace(/\t/g, '  ').length;
        for (let cursor = lineIndex - 1; cursor >= 0; cursor -= 1) {
          const sibling = lines[cursor];
          if (!sibling.trim()) continue;
          const siblingIndent = /^\s*/.exec(sibling)[0].replace(/\t/g, '  ').length;
          if (siblingIndent < indent) break;
          if (siblingIndent === indent) {
            hasPointerEvidence = /^\s*fileID\s*:/i.test(sibling);
            break;
          }
        }
      }
      if (!allowBareGuid && !hasPointerEvidence) continue;
      references.push({
        guid,
        kind: referenceKind(fieldPath, provider),
        objectId,
        classId,
        fieldPath: fieldPath || null,
        line: lineNumber,
        provider,
        resolution: 'exact',
      });
    }
  }
  return references;
}

function isBuiltinGuid(guid) {
  return BUILTIN_GUIDS.has(String(guid || '').toLowerCase());
}

function buildGuidIndex(records) {
  const byGuid = new Map();
  const duplicates = [];
  const shadowed = [];
  for (const record of records) {
    if (!record.guid) continue;
    const previous = byGuid.get(record.guid);
    if (previous && previous.assetPath !== record.assetPath) {
      if (previous.origin !== record.origin) {
        const previousPrecedence = Number.isFinite(previous.rootPrecedence) ? previous.rootPrecedence : 999;
        const recordPrecedence = Number.isFinite(record.rootPrecedence) ? record.rootPrecedence : 999;
        const winner = previousPrecedence <= recordPrecedence ? previous : record;
        const hidden = winner === previous ? record : previous;
        byGuid.set(record.guid, winner);
        shadowed.push({
          guid: record.guid,
          winner: winner.assetPath,
          shadowed: hidden.assetPath,
          reason: winner.origin === 'project' ? 'project-overrides-package' : 'root-precedence',
        });
        continue;
      }
      duplicates.push({ guid: record.guid, paths: [previous.assetPath, record.assetPath] });
      continue;
    }
    byGuid.set(record.guid, record);
  }
  return { byGuid, duplicates, shadowed };
}

module.exports = {
  BUILTIN_GUIDS,
  extractGuidFromMeta,
  extractReferencedGuids,
  extractGuidReferences,
  isBuiltinGuid,
  buildGuidIndex,
};
