'use strict';

const path = require('node:path');

const SCRIPT_INDEX_SCHEMA_VERSION = 2;

/**
 * Names which commonly occur in C# source but do not identify a project-owned
 * declaration. This deliberately mirrors port-closure's conservative lexical
 * resolver: false-positive dependencies are preferable to silently omitting a
 * gameplay type, but engine/BCL names must not pull unrelated files into a
 * closure merely because a project happens to contain the same basename.
 */
const NON_PROJECT_TYPES = new Set([
  'int', 'float', 'double', 'bool', 'string', 'char', 'byte', 'short', 'long',
  'uint', 'ulong', 'ushort', 'sbyte', 'decimal', 'object', 'void', 'var', 'dynamic',
  'List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'Array', 'IEnumerable',
  'IEnumerator', 'IList', 'ICollection', 'IDictionary', 'Action', 'Func', 'Task',
  'Nullable', 'Tuple', 'KeyValuePair', 'Exception', 'Math', 'Convert', 'String',
  'Debug', 'MonoBehaviour', 'ScriptableObject', 'GameObject', 'Transform',
  'Vector2', 'Vector3', 'Vector4', 'Quaternion', 'Color', 'Color32', 'Rect',
  'Mathf', 'Time', 'Random', 'Input', 'Camera', 'Sprite', 'Texture2D', 'Material',
  'Animator', 'Animation', 'AudioClip', 'AudioSource', 'Rigidbody', 'Collider',
  'Coroutine', 'WaitForSeconds', 'Serializable', 'SerializeField', 'Header',
  'Tooltip', 'Range', 'RequireComponent', 'System', 'UnityEngine', 'UnityEditor',
]);

function compareText(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareAssetPaths(left, right) {
  const a = normalizeAssetPath(left);
  const b = normalizeAssetPath(right);
  const folded = compareText(a.toLowerCase(), b.toLowerCase());
  return folded || compareText(a, b);
}

function normalizeAssetPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function normalizeGuid(value) {
  const guid = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(guid) ? guid : null;
}

/** Remove text which must not participate in lexical identifier matching. */
function stripCommentsAndStrings(source) {
  return String(source || '')
    .replace(/@"(?:[^"]|"")*"/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r\u2028\u2029]*/g, ' ');
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function stripCommentsPreserveStrings(source) {
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r\u2028\u2029]*/g, ' ');
}

function extractResourceLoadPaths(text) {
  const source = stripCommentsPreserveStrings(text);
  const paths = [];
  const pattern = /\bResources\s*\.\s*Load(?:Async)?(?:\s*<[^>{}]+>)?\s*\(\s*@?"((?:""|\\.|[^"\\])*)"/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[1]
      .replace(/""/g, '"')
      .replace(/\\([\\"'])/g, '$1')
      .replace(/\\\//g, '/')
      .replace(/\\n|\\r|\\t/g, '')
      .replace(/\\/g, '/');
    const normalized = normalizeAssetPath(value).replace(/^\/+|\/+$/g, '');
    if (normalized) paths.push(normalized);
  }
  return sortedUnique(paths);
}

function splitTopLevelCommaList(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '<' || character === '(' || character === '[') depth += 1;
    else if (character === '>' || character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function extractBaseTypeName(value) {
  const text = String(value || '').trim().replace(/^global::/, '');
  const match = /^([A-Za-z_][\w]*(?:(?:\s*\.\s*|::)[A-Za-z_][\w]*)*)/.exec(text);
  if (!match) return null;
  return match[1].split(/\s*\.\s*|::/).filter(Boolean).pop() || null;
}

function extractDeclaredTypeBases(source) {
  const entries = new Map();
  const declarationPattern = /\b(?:class|struct|interface|record(?:\s+(?:class|struct))?)\s+([A-Za-z_][\w]*)(?:\s*<[^{};]*?>)?([^{};]*?)\{/g;
  for (const match of source.matchAll(declarationPattern)) {
    const typeName = match[1];
    const tail = match[2] || '';
    const colon = tail.indexOf(':');
    let baseTypes = [];
    if (colon >= 0) {
      const baseClause = tail.slice(colon + 1).replace(/\bwhere\b[\s\S]*$/i, '');
      baseTypes = splitTopLevelCommaList(baseClause).map(extractBaseTypeName).filter(Boolean);
    }
    if (!entries.has(typeName)) entries.set(typeName, []);
    entries.set(typeName, sortedUnique([...entries.get(typeName), ...baseTypes]));
  }
  return objectFromSortedEntries(entries.entries());
}

/**
 * Extract compact, cache-safe evidence from one C# source file. Raw C# text is
 * intentionally not returned: project-index may persist this result directly.
 */
function analyzeCSharpSource(text) {
  const source = stripCommentsAndStrings(text);
  const declaredTypes = [];
  for (const match of source.matchAll(
    /\b(?:class|struct|enum|interface|record(?:\s+(?:class|struct))?)\s+([A-Za-z_][\w]*)/g,
  )) {
    declaredTypes.push(match[1]);
  }

  const identifierCandidates = [];
  for (const match of source.matchAll(/\b([A-Z][\w]*)\b/g)) {
    const name = match[1];
    if (!NON_PROJECT_TYPES.has(name)) identifierCandidates.push(name);
  }

  return {
    declaredTypes: sortedUnique(declaredTypes),
    declaredTypeBases: extractDeclaredTypeBases(source),
    identifierCandidates: sortedUnique(identifierCandidates),
    resourceLoadPaths: extractResourceLoadPaths(text),
  };
}

function analyzeAsmdefSource(text, assetPath = '') {
  const fallbackName = path.posix.basename(normalizeAssetPath(assetPath), '.asmdef') || 'UnnamedAssembly';
  let parsed;
  try {
    parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch (_) {
    return {
      valid: false,
      name: fallbackName,
      includePlatforms: [],
      excludePlatforms: [],
      autoReferenced: true,
    };
  }

  const stringList = value => sortedUnique(
    (Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()),
  );
  return {
    valid: true,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallbackName,
    includePlatforms: stringList(parsed.includePlatforms),
    excludePlatforms: stringList(parsed.excludePlatforms),
    autoReferenced: parsed.autoReferenced !== false,
  };
}

function evidenceForScript(record) {
  const evidence = record && record.scriptEvidence;
  if (evidence && Array.isArray(evidence.declaredTypes) && Array.isArray(evidence.identifierCandidates)) {
    const declaredTypeBases = {};
    if (evidence.declaredTypeBases && typeof evidence.declaredTypeBases === 'object') {
      for (const typeName of Object.keys(evidence.declaredTypeBases).sort(compareText)) {
        declaredTypeBases[typeName] = sortedUnique(
          (Array.isArray(evidence.declaredTypeBases[typeName]) ? evidence.declaredTypeBases[typeName] : [])
            .filter(value => typeof value === 'string' && value),
        );
      }
    }
    return {
      declaredTypes: sortedUnique(evidence.declaredTypes.filter(value => typeof value === 'string' && value)),
      declaredTypeBases,
      identifierCandidates: sortedUnique(
        evidence.identifierCandidates.filter(value => typeof value === 'string' && value && !NON_PROJECT_TYPES.has(value)),
      ),
      resourceLoadPaths: sortedUnique(
        (Array.isArray(evidence.resourceLoadPaths) ? evidence.resourceLoadPaths : [])
          .filter(value => typeof value === 'string' && value).map(normalizeAssetPath),
      ),
    };
  }
  return analyzeCSharpSource(record && record.text);
}

function evidenceForAssembly(record) {
  const evidence = record && record.assemblyEvidence;
  if (evidence && typeof evidence === 'object' && typeof evidence.name === 'string' && evidence.name.trim()) {
    const stringList = value => sortedUnique(
      (Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()),
    );
    return {
      valid: evidence.valid !== false,
      name: evidence.name.trim(),
      includePlatforms: stringList(evidence.includePlatforms),
      excludePlatforms: stringList(evidence.excludePlatforms),
      autoReferenced: evidence.autoReferenced !== false,
    };
  }
  return analyzeAsmdefSource(record && record.text, record && record.assetPath);
}

function dirnameAssetPath(assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  const dir = path.posix.dirname(normalized);
  return dir === '.' ? '' : dir;
}

function pathDepth(assetPath) {
  return normalizeAssetPath(assetPath).split('/').filter(Boolean).length;
}

function isWithinRoot(assetPath, rootPath) {
  const asset = normalizeAssetPath(assetPath).toLowerCase();
  const root = normalizeAssetPath(rootPath).replace(/\/$/, '').toLowerCase();
  return !root || asset === root || asset.startsWith(`${root}/`);
}

function isEditorPath(assetPath) {
  return normalizeAssetPath(assetPath).split('/').some(segment => segment.toLowerCase() === 'editor');
}

function buildAssemblyDefinitions(records, diagnostics) {
  const definitions = [];
  for (const record of records) {
    const assetPath = normalizeAssetPath(record && record.assetPath);
    if (!assetPath.toLowerCase().endsWith('.asmdef')) continue;
    const evidence = evidenceForAssembly(record);
    const includePlatforms = evidence.includePlatforms;
    definitions.push({
      name: evidence.name,
      assetPath,
      rootPath: dirnameAssetPath(assetPath),
      guid: normalizeGuid(record.guid),
      scope: record.scope || 'runtime',
      includePlatforms,
      excludePlatforms: evidence.excludePlatforms,
      autoReferenced: evidence.autoReferenced,
      editorOnly: includePlatforms.length === 1 && includePlatforms[0].toLowerCase() === 'editor',
    });
    if (!evidence.valid) {
      diagnostics.push({
        severity: 'medium',
        code: 'UNITY_ASMDEF_INVALID_JSON',
        assetPath,
        message: `Không parse được asmdef; tạm dùng tên file "${evidence.name}".`,
      });
    }
  }

  definitions.sort((left, right) => compareAssetPaths(left.assetPath, right.assetPath));
  const byRoot = new Map();
  for (const definition of definitions) {
    const key = definition.rootPath.toLowerCase();
    if (!byRoot.has(key)) byRoot.set(key, []);
    byRoot.get(key).push(definition);
  }
  for (const sameRoot of byRoot.values()) {
    if (sameRoot.length < 2) continue;
    diagnostics.push({
      severity: 'high',
      code: 'UNITY_MULTIPLE_ASMDEF_IN_DIRECTORY',
      assetPath: sameRoot[0].rootPath,
      message: `Có ${sameRoot.length} asmdef trong cùng một thư mục; chọn file đầu theo thứ tự ổn định.`,
      evidence: sameRoot.map(item => item.assetPath),
    });
  }

  return definitions;
}

function resolveAssemblyForScript(assetPath, definitions) {
  const candidates = definitions
    .filter(definition => isWithinRoot(assetPath, definition.rootPath))
    .sort((left, right) => {
      const depth = pathDepth(right.rootPath) - pathDepth(left.rootPath);
      return depth || compareAssetPaths(left.assetPath, right.assetPath);
    });
  if (candidates.length) {
    return {
      name: candidates[0].name,
      definitionPath: candidates[0].assetPath,
      editorOnly: candidates[0].editorOnly,
    };
  }
  return {
    name: isEditorPath(assetPath) ? 'Assembly-CSharp-Editor' : 'Assembly-CSharp',
    definitionPath: null,
    editorOnly: isEditorPath(assetPath),
  };
}

function objectFromSortedEntries(entries) {
  const output = {};
  for (const [key, value] of [...entries].sort((left, right) => compareText(left[0], right[0]))) {
    output[key] = value;
  }
  return output;
}

/**
 * Build a deterministic, JSON-safe C# project index from asset records.
 *
 * Each `.cs` record may carry raw `text` for a cold scan or compact
 * `scriptEvidence` from cache. Each `.asmdef` record follows the same pattern
 * with `assemblyEvidence`. Raw text is never retained in the returned index.
 */
function buildScriptIndex(inputRecords = []) {
  const records = [...inputRecords]
    .filter(record => record && record.assetPath)
    .sort((left, right) => compareAssetPaths(left.assetPath, right.assetPath));
  const diagnostics = [];
  const assemblies = buildAssemblyDefinitions(records, diagnostics);
  const workingScripts = [];
  const declarations = new Map();

  for (const record of records) {
    const assetPath = normalizeAssetPath(record.assetPath);
    if (!assetPath.toLowerCase().endsWith('.cs')) continue;
    const evidence = evidenceForScript(record);
    const assembly = resolveAssemblyForScript(assetPath, assemblies);
    const script = {
      assetPath,
      guid: normalizeGuid(record.guid),
      scope: record.scope || 'runtime',
      assembly: assembly.name,
      assemblyDefinition: assembly.definitionPath,
      editorOnly: assembly.editorOnly,
      declaredTypes: evidence.declaredTypes,
      declaredTypeBases: evidence.declaredTypeBases,
      identifierCandidates: evidence.identifierCandidates,
      resourceLoadPaths: evidence.resourceLoadPaths,
    };
    workingScripts.push(script);
    for (const typeName of script.declaredTypes) {
      if (!declarations.has(typeName)) declarations.set(typeName, []);
      declarations.get(typeName).push(assetPath);
    }
  }

  for (const paths of declarations.values()) paths.sort(compareAssetPaths);

  const declaredTypeBases = new Map();
  for (const script of workingScripts) {
    for (const typeName of script.declaredTypes) {
      const existing = declaredTypeBases.get(typeName) || [];
      declaredTypeBases.set(typeName, sortedUnique([
        ...existing,
        ...(script.declaredTypeBases[typeName] || []),
      ]));
    }
  }
  const scriptableObjectMemo = new Map();
  function isScriptableObjectType(typeName, visiting = new Set()) {
    if (typeName === 'ScriptableObject') return true;
    if (scriptableObjectMemo.has(typeName)) return scriptableObjectMemo.get(typeName);
    if (visiting.has(typeName)) return false;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(typeName);
    const result = (declaredTypeBases.get(typeName) || []).some(baseType =>
      baseType === 'ScriptableObject' || isScriptableObjectType(baseType, nextVisiting));
    scriptableObjectMemo.set(typeName, result);
    return result;
  }
  const scriptableObjectDeclarations = new Map();
  for (const [typeName, paths] of declarations.entries()) {
    if (isScriptableObjectType(typeName)) scriptableObjectDeclarations.set(typeName, [...paths]);
  }

  const guidEntries = new Map();
  const scripts = workingScripts.map(script => {
    const referencedProjectTypes = script.identifierCandidates.filter(typeName => {
      const declaredIn = declarations.get(typeName);
      return declaredIn && declaredIn.some(assetPath => assetPath !== script.assetPath);
    });
    if (script.guid) {
      if (!guidEntries.has(script.guid)) {
        guidEntries.set(script.guid, script.assetPath);
      } else if (guidEntries.get(script.guid) !== script.assetPath) {
        diagnostics.push({
          severity: 'high',
          code: 'UNITY_DUPLICATE_SCRIPT_GUID',
          assetPath: script.assetPath,
          message: `Script GUID ${script.guid} đã được dùng bởi ${guidEntries.get(script.guid)}.`,
          evidence: [guidEntries.get(script.guid), script.assetPath],
        });
      }
    }
    return {
      assetPath: script.assetPath,
      guid: script.guid,
      scope: script.scope,
      assembly: script.assembly,
      assemblyDefinition: script.assemblyDefinition,
      editorOnly: script.editorOnly,
      declaredTypes: script.declaredTypes,
      declaredTypeBases: script.declaredTypeBases,
      scriptableObjectTypes: script.declaredTypes.filter(isScriptableObjectType),
      resourceLoadPaths: script.resourceLoadPaths,
      referencedProjectTypes: sortedUnique(referencedProjectTypes),
    };
  });

  diagnostics.sort((left, right) =>
    compareText(left.code, right.code) || compareAssetPaths(left.assetPath, right.assetPath));

  return {
    schemaVersion: SCRIPT_INDEX_SCHEMA_VERSION,
    scriptCount: scripts.length,
    assemblyCount: assemblies.length,
    guidToScript: objectFromSortedEntries(guidEntries.entries()),
    typeDeclarations: objectFromSortedEntries(
      [...declarations.entries()].map(([typeName, paths]) => [typeName, [...paths]]),
    ),
    declaredTypeBases: objectFromSortedEntries(
      [...declaredTypeBases.entries()].map(([typeName, baseTypes]) => [typeName, [...baseTypes]]),
    ),
    scriptableObjectTypes: objectFromSortedEntries(scriptableObjectDeclarations.entries()),
    scripts,
    assemblies,
    diagnostics,
  };
}

module.exports = {
  SCRIPT_INDEX_SCHEMA_VERSION,
  NON_PROJECT_TYPES,
  normalizeAssetPath,
  normalizeGuid,
  stripCommentsAndStrings,
  extractResourceLoadPaths,
  analyzeCSharpSource,
  analyzeAsmdefSource,
  resolveAssemblyForScript,
  buildScriptIndex,
};
