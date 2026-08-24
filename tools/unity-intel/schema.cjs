'use strict';

const SNAPSHOT_SCHEMA_VERSION = 1;

function emptyInventory() {
  return {
    scenes: 0,
    prefabs: 0,
    scripts: 0,
    shaders: 0,
    shaderGraphs: 0,
    materials: 0,
    models: 0,
    textures: 0,
    animations: 0,
    controllers: 0,
    audio: 0,
    inlineMaterials: 0,
    sceneObjects: 0,
    totalMb: 0,
  };
}

function createUnityProjectSnapshot(input = {}) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt || new Date().toISOString(),
    provider: input.provider || 'static',
    project: input.project || {
      name: null,
      root: null,
      unityVersion: null,
      packages: {},
    },
    source: input.source || {
      root: null,
      assetsRoot: null,
      includeVendor: false,
    },
    inventory: input.inventory || emptyInventory(),
    buildScenes: input.buildScenes || [],
    assets: input.assets || { count: 0, records: [] },
    scenes: input.scenes || [],
    prefabs: input.prefabs || [],
    scripts: input.scripts || [],
    scriptIndex: input.scriptIndex || {
      schemaVersion: 1,
      scriptCount: 0,
      assemblyCount: 0,
      guidToScript: {},
      typeDeclarations: {},
      scripts: [],
      assemblies: [],
      diagnostics: [],
    },
    dependencies: input.dependencies || {
      edgeCount: 0,
      edges: [],
      unresolvedCount: 0,
      unresolved: [],
    },
    features: input.features || { blockers: [] },
    diagnostics: input.diagnostics || [],
    skippedVendorDirs: input.skippedVendorDirs || [],
    cache: input.cache || { enabled: false, mode: 'disabled' },
  };
}

function validateUnityProjectSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') return ['snapshot must be an object'];
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SNAPSHOT_SCHEMA_VERSION}`);
  }
  if (!snapshot.project || typeof snapshot.project !== 'object') errors.push('project is required');
  if (!snapshot.source || typeof snapshot.source !== 'object') errors.push('source is required');
  if (!snapshot.inventory || typeof snapshot.inventory !== 'object') errors.push('inventory is required');
  if (!snapshot.assets || !Array.isArray(snapshot.assets.records)) errors.push('assets.records must be an array');
  if (!snapshot.dependencies || !Array.isArray(snapshot.dependencies.edges)) {
    errors.push('dependencies.edges must be an array');
  }
  for (const key of ['buildScenes', 'scenes', 'prefabs', 'scripts']) {
    if (!Array.isArray(snapshot[key])) errors.push(`${key} must be an array`);
  }
  if (!snapshot.scriptIndex || !Array.isArray(snapshot.scriptIndex.scripts) ||
      !snapshot.scriptIndex.guidToScript || typeof snapshot.scriptIndex.guidToScript !== 'object') {
    errors.push('scriptIndex must contain scripts and guidToScript');
  }
  if (!Array.isArray(snapshot.diagnostics)) errors.push('diagnostics must be an array');
  for (const diagnostic of snapshot.diagnostics || []) {
    if (!['high', 'medium', 'low'].includes(diagnostic && diagnostic.severity)) {
      errors.push(`diagnostic severity is invalid: ${diagnostic && diagnostic.severity}`);
      break;
    }
  }
  return errors;
}

function assertUnityProjectSnapshot(snapshot) {
  const errors = validateUnityProjectSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid UnityProjectSnapshot: ${errors.join('; ')}`);
  return snapshot;
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  emptyInventory,
  createUnityProjectSnapshot,
  validateUnityProjectSnapshot,
  assertUnityProjectSnapshot,
};
