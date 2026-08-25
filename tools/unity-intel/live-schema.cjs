'use strict';

const crypto = require('node:crypto');

const LIVE_PATCH_SCHEMA_VERSION = 1;
const LIVE_PATCH_KIND = 'unity-live-patch';
const LIVE_PROVIDERS = new Set(['unity-mcp', 'unity-batch', 'unity-editor']);
const SEVERITIES = new Set(['high', 'medium', 'low']);
const MAX_LIVE_DIAGNOSTICS = 64;
const MAX_DIAGNOSTIC_CODE_LENGTH = 96;
const MAX_CANDIDATE_REFERENCES_TOTAL = 512;
const MAX_CANDIDATE_DISPOSITIONS_BYTES = 768 * 1024;
const MAX_CANDIDATE_PATH_LENGTH = 320;
const MAX_CANDIDATE_TYPE_LENGTH = 160;
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
    resolvesUnresolvedGuids: [...new Set(input.resolvesUnresolvedGuids || [])].sort(),
    candidateDispositions: Array.isArray(input.candidateDispositions) ? input.candidateDispositions : [],
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
  else if (patch.diagnostics.length > MAX_LIVE_DIAGNOSTICS) {
    errors.push(`diagnostics must contain at most ${MAX_LIVE_DIAGNOSTICS} entries`);
  }
  for (const diagnostic of patch.diagnostics || []) {
    if (!diagnostic || typeof diagnostic !== 'object') {
      errors.push('diagnostic must be an object');
      break;
    }
    if (!SEVERITIES.has(diagnostic.severity)) {
      errors.push(`diagnostic severity is invalid: ${diagnostic.severity}`);
      break;
    }
    if (typeof diagnostic.code !== 'string' || !diagnostic.code.trim() ||
        diagnostic.code.length > MAX_DIAGNOSTIC_CODE_LENGTH) {
      errors.push(`diagnostic code must contain 1-${MAX_DIAGNOSTIC_CODE_LENGTH} characters`);
      break;
    }
  }
  if (!Array.isArray(patch.resolvesDiagnosticKeys) ||
      patch.resolvesDiagnosticKeys.some(key => typeof key !== 'string' || !key.trim())) {
    errors.push('resolvesDiagnosticKeys must contain non-empty strings');
  }
  if (patch.resolvesUnresolvedGuids !== undefined &&
      (!Array.isArray(patch.resolvesUnresolvedGuids) || patch.resolvesUnresolvedGuids.length > 512 ||
       patch.resolvesUnresolvedGuids.some(guid => typeof guid !== 'string' || !/^[0-9a-f]{32}$/i.test(guid)))) {
    errors.push('resolvesUnresolvedGuids must contain at most 512 Unity GUIDs');
  }
  if (patch.candidateDispositions !== undefined &&
      (!Array.isArray(patch.candidateDispositions) || patch.candidateDispositions.length > 1024)) {
    errors.push('candidateDispositions must be an array with at most 1024 entries');
  } else if (Array.isArray(patch.candidateDispositions)) {
    const totalReferences = patch.candidateDispositions.reduce((total, disposition) =>
      total + (Array.isArray(disposition && disposition.references) ? disposition.references.length : 0), 0);
    if (totalReferences > MAX_CANDIDATE_REFERENCES_TOTAL) {
      errors.push(`candidateDispositions exceed the global ${MAX_CANDIDATE_REFERENCES_TOTAL} reference budget`);
    }
    if (Buffer.byteLength(JSON.stringify(patch.candidateDispositions), 'utf8') > MAX_CANDIDATE_DISPOSITIONS_BYTES) {
      errors.push(`candidateDispositions exceed the global ${MAX_CANDIDATE_DISPOSITIONS_BYTES} byte budget`);
    }
    for (const disposition of patch.candidateDispositions) {
      const assetPath = disposition && disposition.assetPath;
      if (!disposition || !['guid', 'serialized-asset'].includes(disposition.kind) ||
          typeof disposition.key !== 'string' || !disposition.key || disposition.key.length > 320 ||
          !['resolved', 'missing', 'partial'].includes(disposition.status) ||
          (assetPath && (typeof assetPath !== 'string' || assetPath.length > MAX_CANDIDATE_PATH_LENGTH ||
            !/^(?:Assets|Packages)\//.test(assetPath))) ||
          (disposition.assetType !== undefined &&
            (typeof disposition.assetType !== 'string' || disposition.assetType.length > MAX_CANDIDATE_TYPE_LENGTH)) ||
          (disposition.dependencyCount !== undefined &&
            (!Number.isInteger(disposition.dependencyCount) || disposition.dependencyCount < 0)) ||
          (disposition.serializedScanComplete !== undefined && typeof disposition.serializedScanComplete !== 'boolean') ||
          (disposition.serializedPropertyCount !== undefined &&
            (!Number.isInteger(disposition.serializedPropertyCount) || disposition.serializedPropertyCount < 0)) ||
          (disposition.missingReferenceCount !== undefined &&
            (!Number.isInteger(disposition.missingReferenceCount) || disposition.missingReferenceCount < 0)) ||
          (disposition.references !== undefined &&
            (!Array.isArray(disposition.references) || disposition.references.length > 128 ||
             disposition.references.some(reference => !reference ||
               typeof reference.fieldPath !== 'string' || reference.fieldPath.length > 320 ||
               typeof reference.assetPath !== 'string' || reference.assetPath.length > MAX_CANDIDATE_PATH_LENGTH ||
                 !/^(?:Assets|Packages)\//.test(reference.assetPath) ||
               typeof reference.guid !== 'string' || (reference.guid && !/^[0-9a-f]{32}$/i.test(reference.guid)) ||
               (reference.objectId !== undefined &&
                 (typeof reference.objectId !== 'string' ||
                  !((reference.objectId === '' && reference.fieldPath === '') || /^-?\d{1,20}$/.test(reference.objectId)))) ||
               typeof reference.type !== 'string' || reference.type.length > MAX_CANDIDATE_TYPE_LENGTH)))) {
        errors.push('candidateDisposition contains an invalid kind/key/status/assetPath');
        break;
      }
      const references = Array.isArray(disposition.references) ? disposition.references : [];
      const dependencyReferences = references.filter(reference => reference && reference.fieldPath === '');
      if ((disposition.kind === 'guid' && !/^[0-9a-f]{32}$/i.test(disposition.key)) ||
          (disposition.kind === 'serialized-asset' && !/^(?:Assets|Packages)\//.test(disposition.key)) ||
          (disposition.status === 'resolved' &&
            (!assetPath || disposition.referencesComplete !== true || !Array.isArray(disposition.references) ||
             !Number.isInteger(disposition.dependencyCount) ||
             disposition.dependencyCount > dependencyReferences.length)) ||
          (disposition.kind === 'serialized-asset' && disposition.status === 'resolved' &&
            (assetPath !== disposition.key || disposition.serializedScanComplete !== true ||
             !Number.isInteger(disposition.serializedPropertyCount) || disposition.missingReferenceCount !== 0 ||
             references.some(reference => reference.fieldPath && !reference.objectId))) ||
          (disposition.status === 'missing' && !!assetPath)) {
        errors.push('candidateDisposition status is inconsistent with its bounded evidence');
        break;
      }
    }
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
  MAX_LIVE_DIAGNOSTICS,
  MAX_DIAGNOSTIC_CODE_LENGTH,
  MAX_CANDIDATE_REFERENCES_TOTAL,
  MAX_CANDIDATE_DISPOSITIONS_BYTES,
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
