'use strict';

const crypto = require('node:crypto');

const LIVE_PATCH_SCHEMA_VERSION = 1;
const LIVE_PATCH_KIND = 'unity-live-patch';
const LIVE_PROVIDERS = new Set(['unity-mcp', 'unity-batch', 'unity-editor']);
const SEVERITIES = new Set(['high', 'medium', 'low']);
const FORBIDDEN_KEY = /(?:raw[-_]?(?:source|yaml|csharp|code)|source[-_]?text|token|password|secret|api[-_]?key|authorization|credential|private[-_]?key)/i;

function stableValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('Cannot canonicalize a circular value');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(item => stableValue(item, seen));
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = stableValue(value[key], seen);
    }
  }
  seen.delete(value);
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Cross-language project identity contract. Unity can reproduce this without a
 * JSON canonicalizer: SHA-256 over NUL-delimited UTF-8 fields, beginning with
 * the version marker, project name, Unity version, then each enabled build
 * scene's slash-normalized path and lowercase GUID in sorted order.
 */
function computeStaticProjectFingerprint(snapshotOrProject) {
  const container = snapshotOrProject && snapshotOrProject.project
    ? snapshotOrProject
    : { project: snapshotOrProject || {} };
  const project = container.project || {};
  const scenes = (container.buildScenes || project.buildScenes || [])
    .filter(scene => scene && scene.enabled === true)
    .map(scene => ({
      path: String(scene.path || '').replace(/\\/g, '/'),
      guid: String(scene.guid || '').toLowerCase(),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 :
      a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0));
  const fields = [
    'unity-intel-project-v1',
    project.name ? String(project.name) : '',
    project.unityVersion ? String(project.unityVersion) : '',
  ];
  for (const scene of scenes) fields.push(scene.path, scene.guid);
  return sha256Hex(fields.join('\0'));
}

const computeProjectFingerprint = computeStaticProjectFingerprint;

function diagnosticKey(diagnostic) {
  if (diagnostic && typeof diagnostic.key === 'string' && diagnostic.key.trim()) {
    return diagnostic.key.trim();
  }
  const evidence = Array.isArray(diagnostic && diagnostic.evidence)
    ? [...new Set(diagnostic.evidence.filter(value => typeof value === 'string'))].sort().slice(0, 3)
    : [];
  const identity = {
    code: String(diagnostic && diagnostic.code || 'UNITY_INTEL_NOTE'),
    assetPath: diagnostic && (diagnostic.assetPath || diagnostic.path) || null,
    objectId: diagnostic && diagnostic.objectId || null,
    fieldPath: diagnostic && diagnostic.fieldPath || null,
    evidence,
  };
  return `diag:${sha256Hex(stableStringify(identity)).slice(0, 24)}`;
}

function isAbsoluteFilesystemPath(value) {
  if (typeof value !== 'string' || !value) return false;
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || /^\/(?!\/)/.test(value);
}

function findUnsafePayloadEntries(value, currentPath = '$', seen = new Set(), entries = []) {
  if (value === null || value === undefined) return entries;
  if (typeof value === 'string') {
    if (isAbsoluteFilesystemPath(value)) entries.push(`${currentPath}: absolute filesystem path`);
    return entries;
  }
  if (typeof value !== 'object') return entries;
  if (seen.has(value)) {
    entries.push(`${currentPath}: circular value`);
    return entries;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUnsafePayloadEntries(item, `${currentPath}[${index}]`, seen, entries));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) entries.push(`${currentPath}.${key}: forbidden field`);
      findUnsafePayloadEntries(item, `${currentPath}.${key}`, seen, entries);
    }
  }
  seen.delete(value);
  return entries;
}

function createUnityLiveSnapshotPatch(input = {}) {
  return {
    kind: LIVE_PATCH_KIND,
    schemaVersion: LIVE_PATCH_SCHEMA_VERSION,
    snapshotSchemaVersion: Number.isInteger(input.snapshotSchemaVersion) ? input.snapshotSchemaVersion : 1,
    provider: input.provider || 'unity-mcp',
    generatedAt: input.generatedAt || new Date().toISOString(),
    projectFingerprint: input.projectFingerprint || null,
    scanId: input.scanId || null,
    project: input.project || {},
    buildScenes: Array.isArray(input.buildScenes) ? input.buildScenes : [],
    assets: input.assets || { records: [] },
    dependencies: input.dependencies || { edges: [], unresolved: [] },
    facts: input.facts || {},
    features: input.features || {},
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics : [],
    resolvesDiagnosticKeys: [...new Set(input.resolvesDiagnosticKeys || [])].sort(),
    capabilities: input.capabilities || { playModeCapture: false },
  };
}

function validateUnityLiveSnapshotPatch(patch, options = {}) {
  const errors = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['live patch must be an object'];
  if (patch.kind !== LIVE_PATCH_KIND) errors.push(`kind must be ${LIVE_PATCH_KIND}`);
  if (patch.schemaVersion !== LIVE_PATCH_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${LIVE_PATCH_SCHEMA_VERSION}`);
  }
  if (!Number.isInteger(patch.snapshotSchemaVersion) || patch.snapshotSchemaVersion < 1) {
    errors.push('snapshotSchemaVersion must be a positive integer');
  }
  if (!LIVE_PROVIDERS.has(patch.provider)) errors.push(`provider is invalid: ${patch.provider}`);
  if (typeof patch.projectFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(patch.projectFingerprint)) {
    errors.push('projectFingerprint must be a SHA-256 hex string');
  }
  if (options.expectedProjectFingerprint && patch.projectFingerprint !== options.expectedProjectFingerprint) {
    errors.push('projectFingerprint does not match the requested Unity project');
  }
  if (typeof patch.scanId !== 'string' || !/^[a-z0-9._:-]{1,128}$/i.test(patch.scanId)) {
    errors.push('scanId must contain 1-128 safe characters');
  }
  if (typeof patch.generatedAt !== 'string' || !Number.isFinite(Date.parse(patch.generatedAt))) {
    errors.push('generatedAt must be an ISO-compatible timestamp');
  }
  if (!patch.project || typeof patch.project !== 'object' || Array.isArray(patch.project)) {
    errors.push('project must be an object');
  }
  if (!Array.isArray(patch.buildScenes)) errors.push('buildScenes must be an array');
  if (!patch.assets || !Array.isArray(patch.assets.records)) errors.push('assets.records must be an array');
  if (!patch.dependencies || !Array.isArray(patch.dependencies.edges) || !Array.isArray(patch.dependencies.unresolved)) {
    errors.push('dependencies must contain edges and unresolved arrays');
  }
  if (!Array.isArray(patch.diagnostics)) errors.push('diagnostics must be an array');
  for (const diagnostic of patch.diagnostics || []) {
    if (!diagnostic || typeof diagnostic !== 'object') {
      errors.push('diagnostic must be an object');
      break;
    }
    if (!SEVERITIES.has(diagnostic.severity)) {
      errors.push(`diagnostic severity is invalid: ${diagnostic.severity}`);
      break;
    }
  }
  if (!Array.isArray(patch.resolvesDiagnosticKeys) ||
      patch.resolvesDiagnosticKeys.some(key => typeof key !== 'string' || !key.trim())) {
    errors.push('resolvesDiagnosticKeys must contain non-empty strings');
  }
  const unsafe = findUnsafePayloadEntries(patch);
  if (unsafe.length) errors.push(`live patch contains unsafe payload: ${unsafe.slice(0, 3).join('; ')}`);
  return errors;
}

function assertUnityLiveSnapshotPatch(patch, options = {}) {
  const errors = validateUnityLiveSnapshotPatch(patch, options);
  if (errors.length) throw new Error(`Invalid UnityLiveSnapshotPatch: ${errors.join('; ')}`);
  return patch;
}

module.exports = {
  LIVE_PATCH_SCHEMA_VERSION,
  LIVE_PATCH_KIND,
  LIVE_PROVIDERS,
  stableStringify,
  sha256Hex,
  computeStaticProjectFingerprint,
  computeProjectFingerprint,
  diagnosticKey,
  isAbsoluteFilesystemPath,
  findUnsafePayloadEntries,
  createUnityLiveSnapshotPatch,
  validateUnityLiveSnapshotPatch,
  assertUnityLiveSnapshotPatch,
};
