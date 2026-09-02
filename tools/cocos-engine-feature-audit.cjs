#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PHYSICS_BACKENDS = Object.freeze([
  'physics-builtin',
  'physics-cannon',
  'physics-ammo',
  'physics-physx',
]);
const SPINE_BACKENDS = Object.freeze(['spine-3.8', 'spine-4.2']);
const PHYSICS_2D_BACKENDS = Object.freeze([
  'physics-2d-box2d',
  'physics-2d-box2d-wasm',
  'physics-2d-builtin',
  'physics-2d-box2d-jsb',
]);
const BACKEND_LABELS = Object.freeze({
  'physics-builtin': 'Builtin',
  'physics-cannon': 'Cannon',
  'physics-ammo': 'Bullet',
  'physics-physx': 'PhysX',
});
// These Cocos 3.8.8 features intentionally have no cc-fu import-map entry.
// Some toggle engine intrinsic flags, while others are profile-side hooks.
// Their applied receipt is therefore the regenerated preview timestamp rather
// than a non-existent cce:/internal/x/cc-fu/<feature> mapping.
const IMPORT_MAP_SILENT_FEATURES = new Set([
  'occlusion-query',
  'debug-renderer',
  'marionette',
  'procedural-animation',
  'custom-pipeline-builtin-scripts',
  'websocket',
  'websocket-server',
  'meshopt',
]);
// Cocos 3.8.8 persists option parents as enabled cache records with an exact
// `_option`, but normalizes `includeModules` to the selected child. The active
// preview likewise exposes Physics2D's parent as `physics-2d-framework`, while
// the version-specific Spine backend is represented by the generic `spine`
// runtime module. These are engine-owned representations, not missing features.
const OPTION_PARENT_FEATURES = new Set(['spine', 'physics-2d']);
const PHYSICS_COMPONENTS = new Set([
  'RigidBody', 'ConstantForce',
  'BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshCollider',
  'CylinderCollider', 'ConeCollider', 'PlaneCollider', 'TerrainCollider', 'SimplexCollider',
  'PointToPointConstraint', 'HingeConstraint', 'FixedConstraint', 'ConfigurableConstraint',
  'BoxCharacterController', 'CapsuleCharacterController', 'CharacterController',
]);
const BUILTIN_SUPPORTED_COLLIDERS = new Set(['BoxCollider', 'SphereCollider', 'CapsuleCollider']);
const FEATURE_COMPONENTS = Object.freeze({
  animation: new Set(['Animation', 'AnimationController', 'AnimationGraph', 'AnimationGraphVariant', 'SkeletalAnimation']),
  graphics: new Set(['Graphics']),
  mask: new Set(['Mask']),
  'rich-text': new Set(['RichText']),
  particle: new Set(['ParticleSystem']),
  'particle-2d': new Set(['ParticleSystem2D']),
  // AnimationController lives behind Cocos' MARIONETTE intrinsic flag. The
  // feature has no standalone JS module in cc.config.json, so checking only
  // the basic `animation` feature leaves the serialized class unregistered.
  marionette: new Set(['AnimationController', 'AnimationGraph', 'AnimationGraphVariant']),
  'skeletal-animation': new Set(['SkeletalAnimation']),
  terrain: new Set(['Terrain']),
  'tiled-map': new Set(['TiledMap', 'TiledLayer', 'TiledObjectGroup']),
});
const SCANNED_EXTENSIONS = new Set(['.ts', '.js', '.scene', '.prefab', '.anim', '.animgraph']);
const MAX_SCAN_FILES = 20_000;
const MAX_SCAN_FILE_BYTES = 12 * 1024 * 1024;

class EngineFeatureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EngineFeatureError';
    this.code = code;
    this.details = details;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resolveSpineBackend(requiredModules = [], options = {}) {
  const explicit = options.spineBackend || null;
  if (explicit && !SPINE_BACKENDS.includes(explicit)) {
    throw new EngineFeatureError('ENGINE_FEATURE_SPINE_BACKEND_UNKNOWN', `Unknown Cocos Spine backend: ${explicit}`);
  }
  const requested = SPINE_BACKENDS.filter(name => requiredModules.includes(name));
  if (requested.length > 1) {
    throw new EngineFeatureError('ENGINE_FEATURE_SPINE_BACKEND_CONFLICT', `Multiple Cocos Spine backends requested: ${requested.join(', ')}`);
  }
  if (explicit && requested.length && explicit !== requested[0]) {
    throw new EngineFeatureError('ENGINE_FEATURE_SPINE_BACKEND_CONFLICT', `Spine selector ${explicit} conflicts with required module ${requested[0]}.`);
  }
  return explicit || requested[0] || null;
}

function resolvePhysics2dBackend(requiredModules = [], options = {}) {
  const explicit = options.physics2dBackend || null;
  if (explicit && !PHYSICS_2D_BACKENDS.includes(explicit)) {
    throw new EngineFeatureError('ENGINE_FEATURE_PHYSICS_2D_BACKEND_UNKNOWN', `Unknown Cocos Physics2D backend: ${explicit}`);
  }
  const requested = PHYSICS_2D_BACKENDS.filter(name => requiredModules.includes(name));
  if (requested.length > 1) {
    throw new EngineFeatureError('ENGINE_FEATURE_PHYSICS_2D_BACKEND_CONFLICT', `Multiple Cocos Physics2D backends requested: ${requested.join(', ')}`);
  }
  if (explicit && requested.length && explicit !== requested[0]) {
    throw new EngineFeatureError('ENGINE_FEATURE_PHYSICS_2D_BACKEND_CONFLICT', `Physics2D selector ${explicit} conflicts with required module ${requested[0]}.`);
  }
  return explicit || requested[0] || null;
}

function normalizeComponent(value) {
  const normalized = String(value || '').replace(/^cc\./, '').replace(/^physics\./, '');
  const segments = normalized.split('.').filter(Boolean);
  return segments.length ? segments[segments.length - 1] : '';
}

function createEvidence(options = {}) {
  return {
    sourceEngine: options.sourceEngine || 'unity-physx',
    filesScanned: 0,
    bytesScanned: 0,
    skippedLargeFiles: [],
    facts: {},
  };
}

function addFact(evidence, name, source, detail = '') {
  const key = normalizeComponent(name);
  if (!key) return;
  const fact = evidence.facts[key] || { count: 0, files: [], details: [] };
  fact.count += 1;
  const normalizedSource = String(source || '').replace(/\\/g, '/');
  if (normalizedSource && !fact.files.includes(normalizedSource) && fact.files.length < 8) {
    fact.files.push(normalizedSource);
  }
  if (detail && !fact.details.includes(detail) && fact.details.length < 8) fact.details.push(detail);
  evidence.facts[key] = fact;
}

function hasFact(evidence, name) {
  return Boolean(evidence?.facts?.[normalizeComponent(name)]?.count);
}

function scanTextEvidence(text, source = '', evidence = createEvidence()) {
  const body = String(text || '');
  let match;

  const serializedType = /["']__type__["']\s*:\s*["'](?:cc\.|physics\.)?([A-Za-z0-9_.]+)["']/g;
  while ((match = serializedType.exec(body))) addFact(evidence, match[1], source, 'serialized-component');

  // Cocos generates cc.SkeletalAnimation in the imported model prefab when a
  // model meta contains a skeleton sub-asset. The authored wrapper prefab only
  // stores a nested-prefab UUID, so component-only scans otherwise miss this
  // runtime dependency until preview deserialization fails.
  if (/["']importer["']\s*:\s*["'](?:gltf|fbx)-skeleton["']/.test(body)) {
    addFact(evidence, 'SkeletalAnimation', source, 'model-importer-skeleton');
  }

  const ccNamespace = /\bcc\.([A-Z][A-Za-z0-9_]*)\b/g;
  while ((match = ccNamespace.exec(body))) addFact(evidence, match[1], source, 'cc-namespace-use');

  const namedImport = /import\s*\{([\s\S]*?)\}\s*from\s*["']cc["']/g;
  while ((match = namedImport.exec(body))) {
    for (const token of match[1].split(',')) {
      const imported = token.trim().split(/\s+as\s+/i)[0]?.trim();
      if (imported && /^[A-Z][A-Za-z0-9_]*$/.test(imported)) addFact(evidence, imported, source, 'cc-named-import');
    }
  }

  const apiPatterns = [
    ['PhysicsRaycast', /\b(?:PhysicsSystem(?:\.instance)?|physicsSystem)\.(?:raycast|raycastClosest)\s*\(/],
    ['PhysicsSweep', /\b(?:PhysicsSystem(?:\.instance)?|physicsSystem)\.sweep(?:Box|Sphere|Capsule)(?:Closest)?\s*\(/],
    ['PhysicsSimulation', /\b(?:applyForce|applyImpulse|applyTorque|setLinearVelocity|setAngularVelocity)\s*\(/],
    ['CharacterControllerMove', /\b(?:CharacterController|characterController)\.move\s*\(/],
    ['ContinuousCollisionDetection', /(?:["']?_useCCD["']?\s*:\s*true|\buseCCD\s*=\s*true|m_CollisionDetection:\s*[1-9]\d*)/],
    ['HingeDriveOrLimit', /(?:["']?_enable(?:Motor|Limit)["']?\s*:\s*true|m_Use(?:Motor|Limits):\s*1)/],
  ];
  for (const [name, regex] of apiPatterns) {
    if (regex.test(body)) addFact(evidence, name, source, 'runtime-api');
  }
  return evidence;
}

function scanSerializedObjects(objects, source = 'generated-prefab', options = {}) {
  const evidence = options.evidence || createEvidence(options);
  return scanTextEvidence(JSON.stringify(objects), source, evidence);
}

function walkProjectSources(root, onFile) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return;
  const rootReal = fs.realpathSync.native(resolvedRoot);
  const stack = [resolvedRoot];
  let count = 0;
  while (stack.length) {
    const directory = stack.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new EngineFeatureError('ENGINE_FEATURE_SYMLINK_REFUSED', 'Feature scan refuses symbolic links/reparse aliases.', { file });
      }
      if (entry.isDirectory()) {
        stack.push(file);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      const isModelMeta = extension === '.meta' && /\.(?:fbx|glb|gltf|dae|obj)\.meta$/i.test(entry.name);
      if (!entry.isFile() || (!SCANNED_EXTENSIONS.has(extension) && !isModelMeta)) continue;
      count += 1;
      if (count > MAX_SCAN_FILES) {
        throw new EngineFeatureError('ENGINE_FEATURE_SCAN_BUDGET', `Feature scan exceeded ${MAX_SCAN_FILES} files.`);
      }
      const real = fs.realpathSync.native(file);
      const relative = path.relative(rootReal, real);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new EngineFeatureError('ENGINE_FEATURE_PATH_ESCAPE', 'Feature scan escaped the project assets root.', { file });
      }
      onFile(real, relative.replace(/\\/g, '/'));
    }
  }
}

function scanCocosProject(projectRoot, options = {}) {
  const root = validateProjectRoot(projectRoot);
  const evidence = createEvidence(options);
  walkProjectSources(path.join(root, 'assets'), (file, relative) => {
    const stat = fs.statSync(file);
    if (stat.size > MAX_SCAN_FILE_BYTES) {
      if (evidence.skippedLargeFiles.length < 16) evidence.skippedLargeFiles.push(`assets/${relative}`);
      return;
    }
    evidence.filesScanned += 1;
    evidence.bytesScanned += stat.size;
    scanTextEvidence(fs.readFileSync(file, 'utf8'), `assets/${relative}`, evidence);
  });
  return evidence;
}

function physicsFactNames(evidence) {
  return Object.keys(evidence.facts).filter((name) => PHYSICS_COMPONENTS.has(name)
    || name.startsWith('Physics') || name === 'ContinuousCollisionDetection'
    || name === 'CharacterControllerMove' || name === 'HingeDriveOrLimit');
}

function decidePhysicsBackend(evidence, options = {}) {
  const physicsFacts = physicsFactNames(evidence);
  if (!physicsFacts.length) {
    return {
      required: false,
      backend: null,
      label: null,
      complexity: 'none',
      confidence: 'high',
      reasons: ['NO_3D_PHYSICS_EVIDENCE'],
      rejected: [],
      sourceEngine: evidence.sourceEngine || null,
    };
  }

  const colliders = [...PHYSICS_COMPONENTS].filter((name) => name.endsWith('Collider') && hasFact(evidence, name));
  const hasRigidBody = hasFact(evidence, 'RigidBody') || hasFact(evidence, 'ConstantForce') || hasFact(evidence, 'PhysicsSimulation');
  const hasConstraint = ['PointToPointConstraint', 'HingeConstraint', 'FixedConstraint', 'ConfigurableConstraint']
    .some((name) => hasFact(evidence, name));
  const hasCharacter = ['CharacterController', 'BoxCharacterController', 'CapsuleCharacterController', 'CharacterControllerMove']
    .some((name) => hasFact(evidence, name));
  const builtinUnsupported = colliders.filter((name) => !BUILTIN_SUPPORTED_COLLIDERS.has(name));
  const cannonUnsupported = [];
  if (hasFact(evidence, 'CapsuleCollider')) cannonUnsupported.push('CapsuleCollider');
  if (hasFact(evidence, 'PhysicsSweep')) cannonUnsupported.push('sweep query');
  if (hasCharacter) cannonUnsupported.push('character controller');
  if (hasFact(evidence, 'ConfigurableConstraint')) cannonUnsupported.push('configurable constraint');
  if (hasFact(evidence, 'ContinuousCollisionDetection')) cannonUnsupported.push('continuous collision detection');
  if (hasFact(evidence, 'HingeDriveOrLimit')) cannonUnsupported.push('hinge motor/limit');

  const reasons = [];
  const rejected = [];
  let backend;
  let complexity;
  if (cannonUnsupported.length) {
    backend = 'physics-ammo';
    complexity = 'advanced-simulation';
    reasons.push(`BULLET_REQUIRED_FOR_${cannonUnsupported.join('_').replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`);
    rejected.push({ backend: 'physics-builtin', reason: 'Builtin is only a discrete detector and lacks advanced simulation.' });
    rejected.push({ backend: 'physics-cannon', reason: `Cannon 3.8.8 lacks: ${cannonUnsupported.join(', ')}.` });
  } else if (hasRigidBody || hasConstraint || builtinUnsupported.length) {
    backend = 'physics-cannon';
    complexity = hasRigidBody || hasConstraint ? 'simple-simulation' : 'query-with-complex-shapes';
    if (builtinUnsupported.length) reasons.push(`CANNON_REQUIRED_FOR_${builtinUnsupported.join('_').toUpperCase()}`);
    if (hasRigidBody) reasons.push('CANNON_REQUIRED_FOR_RIGID_BODY_SIMULATION');
    if (hasConstraint) reasons.push('CANNON_REQUIRED_FOR_BASIC_CONSTRAINT');
    rejected.push({ backend: 'physics-builtin', reason: builtinUnsupported.length
      ? `Builtin 3.8.8 does not implement: ${builtinUnsupported.join(', ')}.`
      : 'Builtin does not provide rigid-body simulation.' });
  } else {
    backend = 'physics-builtin';
    complexity = 'simple-query-or-trigger';
    reasons.push('BUILTIN_SUFFICIENT_FOR_SIMPLE_COLLIDER_QUERY');
  }

  if ((evidence.sourceEngine || '').toLowerCase().includes('physx')) {
    reasons.push(backend === 'physics-ammo'
      ? 'UNITY_PHYSX_ADVANCED_BEHAVIOR_PREFERS_BULLET'
      : 'UNITY_PHYSX_SOURCE_ALONE_DOES_NOT_REQUIRE_HEAVY_BACKEND');
  }

  const override = options.backend || options.physicsBackend;
  if (override) {
    if (!PHYSICS_BACKENDS.includes(override)) {
      throw new EngineFeatureError('ENGINE_FEATURE_BACKEND_UNKNOWN', `Unknown Cocos physics backend: ${override}`);
    }
    const incompatibilities = [];
    if (override === 'physics-builtin' && (hasRigidBody || hasConstraint || builtinUnsupported.length)) {
      incompatibilities.push('Builtin cannot preserve the detected simulation/shape behavior.');
    }
    if (override === 'physics-cannon' && cannonUnsupported.length) {
      incompatibilities.push(`Cannon cannot preserve: ${cannonUnsupported.join(', ')}.`);
    }
    if (incompatibilities.length && !options.forceBackend) {
      throw new EngineFeatureError('ENGINE_FEATURE_BACKEND_INCOMPATIBLE', incompatibilities.join(' '), {
        requested: override,
        recommended: backend,
      });
    }
    reasons.push(`EXPLICIT_BACKEND_${override.toUpperCase().replace(/-/g, '_')}`);
    backend = override;
  }

  return {
    required: true,
    backend,
    label: BACKEND_LABELS[backend],
    complexity,
    confidence: evidence.filesScanned || physicsFacts.some((name) => evidence.facts[name]?.details?.includes('serialized-component'))
      ? 'high' : 'medium',
    reasons,
    rejected,
    sourceEngine: evidence.sourceEngine || null,
    evidence: {
      colliders,
      rigidBody: hasRigidBody,
      constraints: hasConstraint,
      characterController: hasCharacter,
      advanced: cannonUnsupported,
    },
  };
}

function inferRequiredModules(evidence, physicsDecision = decidePhysicsBackend(evidence)) {
  const modules = new Set();
  for (const [moduleName, components] of Object.entries(FEATURE_COMPONENTS)) {
    if ([...components].some((name) => hasFact(evidence, name))) modules.add(moduleName);
  }
  if (physicsDecision.backend) modules.add(physicsDecision.backend);
  return [...modules].sort();
}

function compactEvidence(evidence) {
  const relevant = new Set([
    ...PHYSICS_COMPONENTS,
    ...Object.values(FEATURE_COMPONENTS).flatMap((names) => [...names]),
    'PhysicsSystem', 'PhysicsRaycast', 'PhysicsSweep', 'PhysicsSimulation',
    'CharacterControllerMove', 'ContinuousCollisionDetection', 'HingeDriveOrLimit',
  ]);
  const facts = {};
  for (const name of [...relevant].sort()) {
    if (evidence.facts[name]) facts[name] = evidence.facts[name];
  }
  return {
    sourceEngine: evidence.sourceEngine,
    filesScanned: evidence.filesScanned,
    bytesScanned: evidence.bytesScanned,
    skippedLargeFiles: evidence.skippedLargeFiles,
    facts,
  };
}

function validateProjectRoot(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  if (!fs.existsSync(path.join(root, 'package.json')) || !fs.existsSync(path.join(root, 'assets'))) {
    throw new EngineFeatureError('ENGINE_FEATURE_PROJECT_INVALID', `Not a Cocos project root: ${root}`);
  }
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new EngineFeatureError('ENGINE_FEATURE_PROJECT_SYMLINK', 'Cocos project root must not be a symbolic link.');
  return root;
}

function engineProfilePath(projectRoot) {
  return path.join(projectRoot, 'settings', 'v2', 'packages', 'engine.json');
}

function parseEngineProfile(bytes, file = 'settings/v2/packages/engine.json') {
  let document;
  try {
    document = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8').replace(/^\uFEFF/, '') : String(bytes));
  } catch (error) {
    throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_JSON_INVALID', `${file}: ${error.message}`);
  }
  if (!document || typeof document !== 'object' || typeof document.__version__ !== 'string') {
    throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', `${file} has no supported __version__ marker.`);
  }
  const modules = document.modules;
  const configKey = modules?.globalConfigKey || 'defaultConfig';
  const config = modules?.configs?.[configKey];
  if (!config || typeof config !== 'object' || !config.cache || !Array.isArray(config.includeModules)) {
    throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', `${file} is missing modules.configs.${configKey}.cache/includeModules.`);
  }
  return { document, modules, configKey, config };
}

function readEngineProfile(projectRoot) {
  const file = engineProfilePath(projectRoot);
  if (!fs.existsSync(file)) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_MISSING', `Missing ${file}`);
  const bytes = fs.readFileSync(file);
  const parsed = parseEngineProfile(bytes, file);
  return { ...parsed, file, bytes, hash: sha256(bytes), modifiedMs: fs.statSync(file).mtimeMs };
}

function readAppliedPreviewFeatures(projectRoot) {
  const file = path.join(projectRoot, 'temp', 'programming', 'packer-driver', 'targets', 'preview', 'import-map.json');
  if (!fs.existsSync(file)) {
    return { available: false, features: [], file, hash: null, modifiedMs: null, error: 'preview import map is unavailable' };
  }
  try {
    const bytes = fs.readFileSync(file);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const features = new Set();
    for (const scope of Object.values(parsed.scopes || {})) {
      if (!scope || typeof scope !== 'object') continue;
      for (const value of Object.values(scope)) {
        if (typeof value !== 'string') continue;
        const prefix = 'cce:/internal/x/cc-fu/';
        if (value.startsWith(prefix)) features.add(value.slice(prefix.length));
      }
    }
    return {
      available: true,
      features: [...features].sort(),
      file,
      hash: sha256(bytes),
      modifiedMs: fs.statSync(file).mtimeMs,
    };
  } catch (error) {
    return { available: false, features: [], file, hash: null, modifiedMs: null, error: error.message };
  }
}

function profileFeatureEnabled(config, include, moduleName) {
  const record = config.cache[moduleName];
  if (!record || record._value !== true) return false;
  if (include.has(moduleName)) return true;
  if (!OPTION_PARENT_FEATURES.has(moduleName)) return false;
  const selected = record._option;
  return typeof selected === 'string'
    && config.cache[selected]?._value === true
    && include.has(selected);
}

function appliedFeaturePresent(applied, moduleName, selectors = {}) {
  if (applied.features.includes(moduleName)) return true;
  if (moduleName === 'physics-2d') return applied.features.includes('physics-2d-framework');
  if (SPINE_BACKENDS.includes(moduleName)
    && selectors.spineBackend === moduleName
    && applied.features.includes('spine')) return true;
  return false;
}

function auditCocosEngineFeatures(projectRoot, options = {}) {
  const root = validateProjectRoot(projectRoot);
  const evidence = options.evidence || scanCocosProject(root, options);
  const physicsDecision = decidePhysicsBackend(evidence, options);
  const requiredModules = options.requiredModules
    ? [...new Set(options.requiredModules)].sort()
    : inferRequiredModules(evidence, physicsDecision);
  const disabledModules = [...new Set(options.disabledModules || [])].sort();
  const overlap = disabledModules.filter(moduleName => requiredModules.includes(moduleName));
  if (overlap.length) {
    throw new EngineFeatureError('ENGINE_FEATURE_PLAN_CONFLICT', `Features cannot be both required and disabled: ${overlap.join(', ')}`);
  }
  const spineBackend = resolveSpineBackend(requiredModules, options);
  const physics2dBackend = resolvePhysics2dBackend(requiredModules, options);
  const profile = readEngineProfile(root);
  const include = new Set(profile.config.includeModules);
  const profileMissing = [];
  const profileUnexpected = [];
  for (const moduleName of requiredModules) {
    if (!profile.config.cache[moduleName]) {
      profileMissing.push(`${moduleName}:unknown-to-profile`);
    } else if (!profileFeatureEnabled(profile.config, include, moduleName)) {
      profileMissing.push(moduleName);
    }
  }
  const selectedBackend = profile.config.cache.physics?._option || null;
  if (physicsDecision.backend && selectedBackend !== physicsDecision.backend) {
    profileMissing.push(`physics:${physicsDecision.backend}`);
  }
  for (const moduleName of disabledModules) {
    if (!profile.config.cache[moduleName]) {
      profileUnexpected.push(`${moduleName}:unknown-to-profile`);
    } else if (profile.config.cache[moduleName]._value !== false || include.has(moduleName)) {
      profileUnexpected.push(moduleName);
    }
  }
  const selectedSpineBackend = profile.config.cache.spine?._option || null;
  if (spineBackend && selectedSpineBackend !== spineBackend) {
    profileMissing.push(`spine:${spineBackend}`);
  }
  const selectedPhysics2dBackend = profile.config.cache['physics-2d']?._option || null;
  if (physics2dBackend && selectedPhysics2dBackend !== physics2dBackend) {
    profileMissing.push(`physics-2d:${physics2dBackend}`);
  }
  const applied = readAppliedPreviewFeatures(root);
  const inferredProfileFeatures = [];
  const previewRegeneratedAfterProfile = Number.isFinite(applied.modifiedMs)
    && Number.isFinite(profile.modifiedMs)
    && applied.modifiedMs >= profile.modifiedMs;
  const appliedMissing = applied.available
    ? requiredModules.filter((moduleName) => {
      if (appliedFeaturePresent(applied, moduleName, { spineBackend, physics2dBackend })) return false;
      const profileEnabled = profileFeatureEnabled(profile.config, include, moduleName);
      if (IMPORT_MAP_SILENT_FEATURES.has(moduleName) && profileEnabled && previewRegeneratedAfterProfile) {
        inferredProfileFeatures.push(moduleName);
        return false;
      }
      return true;
    })
    : [...requiredModules];
  const appliedUnexpected = applied.available
    ? disabledModules.filter(moduleName => applied.features.includes(moduleName) || !previewRegeneratedAfterProfile)
    : [...disabledModules];
  const profileComplete = profileMissing.length === 0 && profileUnexpected.length === 0;
  const complete = profileComplete && applied.available && appliedMissing.length === 0 && appliedUnexpected.length === 0;
  return {
    ok: profileComplete,
    complete,
    projectRoot: root,
    evidence: compactEvidence(evidence),
    physicsDecision,
    requiredModules,
    disabledModules,
    profile: {
      file: path.relative(root, profile.file).replace(/\\/g, '/'),
      version: profile.document.__version__,
      configKey: profile.configKey,
      hash: profile.hash,
      modifiedMs: profile.modifiedMs,
      includeModules: [...profile.config.includeModules],
      selectedBackend,
      selectedSpineBackend,
      selectedPhysics2dBackend,
      missing: profileMissing,
      unexpected: profileUnexpected,
      complete: profileComplete,
    },
    appliedPreview: {
      ...applied,
      file: path.relative(root, applied.file).replace(/\\/g, '/'),
      inferredProfileFeatures,
      inference: inferredProfileFeatures.length
        ? 'profile-enabled-and-preview-regenerated-after-profile'
        : null,
      missing: appliedMissing,
      unexpected: appliedUnexpected,
      complete: applied.available && appliedMissing.length === 0 && appliedUnexpected.length === 0,
    },
    pendingEditorApply: profileComplete && !complete,
  };
}

function acquireLock(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = `${JSON.stringify(value)}\n`;
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_LOCKED', 'Another engine-feature transaction owns the project lock.', { file });
    }
    throw error;
  }
  fs.writeFileSync(descriptor, payload, 'utf8');
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      // An external actor may replace a lock path after this process acquired
      // it. Delete only the exact bytes owned by this transaction.
      if (fs.readFileSync(file, 'utf8') === payload) fs.unlinkSync(file);
    } catch (_) { /* best effort; preserve a replacement lock */ }
  };
}

function exactBackup(projectRoot, bytes, options = {}) {
  const directory = path.join(projectRoot, '.unity', 'engine-feature-backups');
  fs.mkdirSync(directory, { recursive: true });
  const stamp = options.now || Date.now();
  const file = path.join(directory, `${stamp}-${sha256(bytes).slice(0, 16)}.engine.json`);
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (sha256(fs.readFileSync(file)) !== sha256(bytes)) {
    throw new EngineFeatureError('ENGINE_FEATURE_BACKUP_VERIFY_FAILED', 'Exact-byte engine profile backup verification failed.', { file });
  }
  return file;
}

function atomicReplace(file, bytes, expectedHash, options = {}) {
  const current = fs.readFileSync(file);
  if (sha256(current) !== expectedHash) {
    throw new EngineFeatureError('ENGINE_FEATURE_CAS_CONFLICT', 'engine.json changed concurrently; refusing to overwrite it.');
  }
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
  let descriptor = null;
  try {
    descriptor = fs.openSync(temp, 'wx', fs.statSync(file).mode & 0o777);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (typeof options.beforeReplace === 'function') options.beforeReplace();
    if (sha256(fs.readFileSync(file)) !== expectedHash) {
      throw new EngineFeatureError('ENGINE_FEATURE_CAS_CONFLICT', 'engine.json changed before atomic replace; refusing to overwrite it.');
    }
    fs.renameSync(temp, file);
    if (sha256(fs.readFileSync(file)) !== sha256(bytes)) {
      throw new EngineFeatureError('ENGINE_FEATURE_WRITE_VERIFY_FAILED', 'engine.json bytes differ after atomic replace.');
    }
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch (_) { /* best effort */ }
    try { fs.unlinkSync(temp); } catch (_) { /* renamed or best effort */ }
  }
}

function writeReceipt(projectRoot, receipt) {
  const directory = path.join(projectRoot, '.unity', 'engine-feature-receipts');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${Date.now()}-${process.pid}.json`);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return file;
}

function patchEngineProfile(projectRoot, plan, options = {}) {
  const root = validateProjectRoot(projectRoot);
  const profile = readEngineProfile(root);
  const next = JSON.parse(JSON.stringify(profile.document));
  const parsed = parseEngineProfile(JSON.stringify(next));
  const nextDocument = parsed.document;
  const config = parsed.config;
  const requiredModules = [...new Set(plan.requiredModules || [])];
  const disabledModules = [...new Set(plan.disabledModules || [])];
  const overlap = disabledModules.filter(moduleName => requiredModules.includes(moduleName));
  if (overlap.length) {
    throw new EngineFeatureError('ENGINE_FEATURE_PLAN_CONFLICT', `Features cannot be both required and disabled: ${overlap.join(', ')}`);
  }
  const backend = plan.physicsBackend || plan.physicsDecision?.backend || null;
  const spineBackend = resolveSpineBackend(requiredModules, plan);
  const physics2dBackend = resolvePhysics2dBackend(requiredModules, plan);
  for (const moduleName of requiredModules) {
    if (!config.cache[moduleName]) {
      throw new EngineFeatureError('ENGINE_FEATURE_UNKNOWN_MODULE', `Cocos profile does not define feature '${moduleName}'; refusing a blind insert.`);
    }
    config.cache[moduleName]._value = true;
  }
  const include = new Set(config.includeModules);
  for (const moduleName of requiredModules) {
    if (OPTION_PARENT_FEATURES.has(moduleName)) include.delete(moduleName);
    else include.add(moduleName);
  }
  for (const moduleName of disabledModules) {
    if (!config.cache[moduleName]) {
      throw new EngineFeatureError('ENGINE_FEATURE_UNKNOWN_MODULE', `Cocos profile does not define feature '${moduleName}'; refusing a blind removal.`);
    }
    config.cache[moduleName]._value = false;
    include.delete(moduleName);
  }
  if (backend) {
    if (!PHYSICS_BACKENDS.includes(backend)) throw new EngineFeatureError('ENGINE_FEATURE_BACKEND_UNKNOWN', `Unknown backend: ${backend}`);
    if (!config.cache.physics) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', 'Profile has no physics selector.');
    config.cache.physics._value = true;
    config.cache.physics._option = backend;
    for (const candidate of PHYSICS_BACKENDS) {
      if (!config.cache[candidate]) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', `Profile has no ${candidate} entry.`);
      config.cache[candidate]._value = candidate === backend;
      if (candidate === backend) include.add(candidate);
      else include.delete(candidate);
    }
  }
  if (spineBackend) {
    if (!config.cache.spine) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', 'Profile has no spine selector.');
    config.cache.spine._value = true;
    config.cache.spine._option = spineBackend;
    include.delete('spine');
    for (const candidate of SPINE_BACKENDS) {
      if (!config.cache[candidate]) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', `Profile has no ${candidate} entry.`);
      config.cache[candidate]._value = candidate === spineBackend;
      if (candidate === spineBackend) include.add(candidate);
      else include.delete(candidate);
    }
  }
  if (physics2dBackend) {
    if (!config.cache['physics-2d']) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', 'Profile has no physics-2d selector.');
    config.cache['physics-2d']._value = true;
    config.cache['physics-2d']._option = physics2dBackend;
    include.delete('physics-2d');
    for (const candidate of PHYSICS_2D_BACKENDS) {
      if (!config.cache[candidate]) throw new EngineFeatureError('ENGINE_FEATURE_PROFILE_SCHEMA', `Profile has no ${candidate} entry.`);
      config.cache[candidate]._value = candidate === physics2dBackend;
      if (candidate === physics2dBackend) include.add(candidate);
      else include.delete(candidate);
    }
  }
  config.includeModules = [...include];
  const afterBytes = Buffer.from(`${JSON.stringify(nextDocument, null, 2)}\n`);
  const afterHash = sha256(afterBytes);
  if (afterHash === profile.hash) {
    return { changed: false, fallbackUsed: true, beforeHash: profile.hash, afterHash, pendingEditorApply: true };
  }
  if (options.dryRun) {
    return { changed: true, dryRun: true, fallbackUsed: true, beforeHash: profile.hash, afterHash, pendingEditorApply: true };
  }
  const lockFile = path.join(root, '.unity', 'engine-feature.lock');
  const release = acquireLock(lockFile, { pid: process.pid, createdAt: new Date().toISOString(), projectRoot: root });
  try {
    const backup = exactBackup(root, profile.bytes, options);
    atomicReplace(profile.file, afterBytes, profile.hash, options);
    const receipt = {
      version: 1,
      operation: 'feature-cropping-direct-patch',
      fallbackUsed: true,
      changed: true,
      createdAt: new Date().toISOString(),
      projectRoot: root,
      profileFile: path.relative(root, profile.file).replace(/\\/g, '/'),
      backupFile: path.relative(root, backup).replace(/\\/g, '/'),
      beforeHash: profile.hash,
      afterHash,
      requiredModules,
      disabledModules,
      physicsBackend: backend,
      spineBackend,
      physics2dBackend,
      pendingEditorApply: true,
    };
    const receiptFile = writeReceipt(root, receipt);
    return { ...receipt, receiptFile: path.relative(root, receiptFile).replace(/\\/g, '/') };
  } finally {
    release();
  }
}

function parseMcpEnvelope(body, id) {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = JSON.parse(line.slice(5));
    if (payload.id === id) return payload;
  }
  throw new EngineFeatureError('ENGINE_FEATURE_MCP_PROTOCOL', 'Cocos MCP returned no matching JSON-RPC response.');
}

async function createMcpClient(projectRoot, options = {}) {
  let url = options.mcpUrl;
  if (!url) {
    const settingsFile = path.join(projectRoot, 'settings', 'mcp-server.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    url = `http://127.0.0.1:${settings.port || 3000}/mcp`;
  }
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let id = 0;
  const rpc = async (method, params) => {
    const requestId = ++id;
    const response = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal: AbortSignal.timeout(options.timeoutMs || 300_000),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) headers['Mcp-Session-Id'] = session;
    const body = await response.text();
    if (!response.ok) throw new EngineFeatureError('ENGINE_FEATURE_MCP_HTTP', `Cocos MCP HTTP ${response.status}: ${body.slice(0, 400)}`);
    const envelope = parseMcpEnvelope(body, requestId);
    if (envelope.error) throw new EngineFeatureError('ENGINE_FEATURE_MCP_RPC', JSON.stringify(envelope.error));
    return envelope.result;
  };
  await rpc('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'shared-kit-engine-feature-audit', version: '1.0.0' },
  });
  return {
    call: (name, args) => rpc('tools/call', { name, arguments: args || {} }),
    close: () => fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) }).catch(() => undefined),
  };
}

function unwrapToolResult(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (text) {
    try { return JSON.parse(text); } catch (_) { return { success: !result.isError, message: text }; }
  }
  return result;
}

function portOwner(port = 3000) {
  if (process.platform !== 'win32') return null;
  const script = '$c=Get-NetTCPConnection -LocalPort ([int]$env:PLAYABLE_FEATURE_PORT) -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1;if($c){[Console]::Write($c.OwningProcess)}';
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, PLAYABLE_FEATURE_PORT: String(port) },
    encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 16_384,
  });
  const value = Number(String(run.stdout || '').trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function waitForPort(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (ok) resolve(true);
        else if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, 500);
      };
      socket.setTimeout(700, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    };
    attempt();
  });
}

async function restartCocosProject(projectRoot, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    return { attempted: false, complete: false, error: 'External Cocos restart is currently implemented for Windows only.' };
  }
  const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, 'settings', 'mcp-server.json'), 'utf8'));
  const port = Number(settings.port) || 3000;
  const canonicalScript = path.resolve(__dirname, '..', 'scripts', '1_open-project.bat');
  const projectScript = path.join(projectRoot, '1_open-project.bat');
  // Prefer the exact shared-kit launcher that shipped with this gate. A copied
  // project-root launcher may predate automation exit semantics and can report
  // failure after successfully restarting Cocos.
  const script = options.restartScript || (fs.existsSync(canonicalScript) ? canonicalScript : projectScript);
  if (!fs.existsSync(script)) return { attempted: false, complete: false, error: '1_open-project.bat was not found.' };
  const owner = options.portOwner || portOwner;
  const wait = options.waitForPort || waitForPort;
  const spawn = options.spawnSync || spawnSync;
  const beforePid = owner(port);
  // Pass the exact batch path through the environment and invoke it with
  // PowerShell's call operator. cmd.exe /s /c rewrites outer quotes and can
  // turn a valid absolute batch path into a literal `\"...\"` command.
  const run = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', '& $env:PLAYABLE_OPEN_PROJECT_BAT',
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYABLE_OPEN_PROJECT_BAT: script,
      PLAYABLE_AUTOMATION_MODE: '1',
      PLAYABLE_SKIP_MCP_BACKENDS: '1',
      PLAYABLE_SKIP_MCP_VERIFY: '1',
    },
    encoding: 'utf8', windowsHide: true,
    timeout: options.restartTimeoutMs || 180_000,
    maxBuffer: 512 * 1024,
  });
  const processSucceeded = !run.error && run.status === 0 && !run.signal;
  const ready = processSucceeded ? await wait(port, 120_000) : false;
  const afterPid = owner(port);
  const changedPid = Boolean(beforePid && afterPid && beforePid !== afterPid);
  const outputTail = `${run.stdout || ''}\n${run.stderr || ''}`.trim().split(/\r?\n/).slice(-20);
  const processError = run.error?.message || (!processSucceeded
    ? `Cocos restart command failed with status ${run.status === null ? 'null' : run.status}${run.signal ? ` (signal ${run.signal})` : ''}.`
    : null);
  return {
    attempted: true,
    complete: processSucceeded && ready && (!beforePid || changedPid),
    beforePid,
    afterPid,
    changedPid,
    port,
    processStatus: run.status,
    processSucceeded,
    outputTail,
    error: processError,
  };
}

async function waitForEngineApplication(projectRoot, options = {}) {
  const timeoutMs = Math.max(1000, Math.min(90_000, Number(options.applyTimeoutMs) || 45_000));
  const deadline = Date.now() + timeoutMs;
  let audit = auditCocosEngineFeatures(projectRoot, options);
  while (!audit.complete && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    audit = auditCocosEngineFeatures(projectRoot, options);
  }
  return audit;
}

function writeAuditReport(projectRoot, report, options = {}) {
  const file = options.reportFile || path.join(projectRoot, '.unity', 'engine-feature-report.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return file;
}

async function ensureCocosEngineFeatures(projectRoot, options = {}) {
  const root = validateProjectRoot(projectRoot);
  let audit = auditCocosEngineFeatures(root, options);
  const result = {
    ok: false,
    complete: false,
    fallbackUsed: false,
    pendingEditorApply: false,
    mcpAttempts: [],
    restartReceipts: [],
    patchReceipt: null,
    initialAudit: audit,
    finalAudit: audit,
  };
  if (audit.complete) {
    result.ok = result.complete = true;
    writeAuditReport(root, result, options);
    return result;
  }

  const maxAttempts = Math.max(0, Math.min(3, Number(options.maxMcpAttempts ?? 2)));
  for (let attempt = 1; attempt <= maxAttempts && !audit.profile.complete; attempt += 1) {
    let client;
    try {
      client = await createMcpClient(root, options);
      const raw = await client.call('engineFeature_ensure_features', {
        modules: audit.requiredModules.filter((name) => !PHYSICS_BACKENDS.includes(name) &&
          !SPINE_BACKENDS.includes(name) && !PHYSICS_2D_BACKENDS.includes(name)),
        disabledModules: audit.disabledModules,
        physicsBackend: audit.physicsDecision.backend || undefined,
        spineBackend: resolveSpineBackend(audit.requiredModules, options) || undefined,
        physics2dBackend: resolvePhysics2dBackend(audit.requiredModules, options) || undefined,
        reload: true,
        timeoutMs: options.timeoutMs || 240_000,
      });
      const receipt = unwrapToolResult(raw);
      result.mcpAttempts.push({ attempt, ok: receipt?.success !== false, receipt });
    } catch (error) {
      result.mcpAttempts.push({ attempt, ok: false, code: error.code || 'ENGINE_FEATURE_MCP_ERROR', error: error.message });
    } finally {
      if (client) await client.close();
    }
    audit = auditCocosEngineFeatures(root, options);
    if (audit.profile.complete) break;
  }

  if (!audit.profile.complete) {
    result.fallbackUsed = true;
    result.patchReceipt = patchEngineProfile(root, {
      requiredModules: audit.requiredModules,
      disabledModules: audit.disabledModules,
      physicsBackend: audit.physicsDecision.backend,
      spineBackend: resolveSpineBackend(audit.requiredModules, options),
      physics2dBackend: resolvePhysics2dBackend(audit.requiredModules, options),
    }, options);
    audit = auditCocosEngineFeatures(root, options);
  }

  if (!audit.complete && options.restart !== false && !options.dryRun) {
    const restart = await restartCocosProject(root, options);
    result.restartReceipts.push(restart);
    if (restart.complete) audit = await waitForEngineApplication(root, options);
  }

  result.finalAudit = audit;
  result.ok = audit.profile.complete;
  result.complete = audit.complete;
  result.pendingEditorApply = !audit.complete;
  writeAuditReport(root, result, options);
  return result;
}

function parseCli(argv) {
  const options = { command: 'audit', projectRoot: process.cwd(), sourceEngine: 'unity-physx', restart: true };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) options.command = args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project') options.projectRoot = args[++index];
    else if (arg === '--mcp-url') options.mcpUrl = args[++index];
    else if (arg === '--source-engine') options.sourceEngine = args[++index];
    else if (arg === '--physics-backend') options.physicsBackend = args[++index];
    else if (arg === '--spine-backend') options.spineBackend = args[++index];
    else if (arg === '--physics-2d-backend') options.physics2dBackend = args[++index];
    else if (arg === '--max-mcp-attempts') options.maxMcpAttempts = Number(args[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++index]);
    else if (arg === '--report') options.reportFile = path.resolve(args[++index]);
    else if (arg === '--no-restart') options.restart = false;
    else if (arg === '--force-backend') options.forceBackend = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new EngineFeatureError('ENGINE_FEATURE_ARGUMENT_UNKNOWN', `Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Cocos Engine Feature Cropping audit/repair\n\n` +
    `Usage:\n` +
    `  node playable-shared-kit/tools/cocos-engine-feature-audit.cjs audit --project <CocosRoot>\n` +
    `  node playable-shared-kit/tools/cocos-engine-feature-audit.cjs ensure --project <CocosRoot> [--no-restart]\n` +
    `  node playable-shared-kit/tools/cocos-engine-feature-audit.cjs patch --project <CocosRoot> [--dry-run]\n\n` +
    `Options:\n` +
    `  --mcp-url <url>             Override the project Cocos-MCP endpoint.\n` +
    `  --max-mcp-attempts <n>      Profile API attempts before guarded fallback (default 2).\n` +
    `  --physics-backend <name>    Checked override: physics-builtin|physics-cannon|physics-ammo|physics-physx.\n` +
    `  --spine-backend <name>      Exact selector: spine-3.8|spine-4.2.\n` +
    `  --physics-2d-backend <name> Exact selector: physics-2d-box2d|physics-2d-box2d-wasm|physics-2d-builtin|physics-2d-box2d-jsb.\n` +
    `  --force-backend             Permit an incompatible backend override and record the risk.\n` +
    `  --no-restart                Persist/patch only; leave pendingEditorApply=true.\n` +
    `  --dry-run                   Do not write Profile/engine.json or restart Cocos.\n` +
    `  --json                      Emit JSON (JSON is the default machine-readable format).\n\n` +
    `The ensure command tries Cocos-MCP/Profile API up to two times, then uses a guarded\n` +
    `exact-backup + lock + CAS engine.json fallback. Completion requires the active\n` +
    `preview import map, not merely a successful profile write. It never builds a game.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.help) return printHelp();
  const root = path.resolve(options.projectRoot);
  let output;
  if (options.command === 'audit') output = auditCocosEngineFeatures(root, options);
  else if (options.command === 'ensure') output = await ensureCocosEngineFeatures(root, options);
  else if (options.command === 'patch') {
    const audit = auditCocosEngineFeatures(root, options);
    output = patchEngineProfile(root, {
      requiredModules: audit.requiredModules,
      physicsBackend: audit.physicsDecision.backend,
      spineBackend: resolveSpineBackend(audit.requiredModules, options),
      physics2dBackend: resolvePhysics2dBackend(audit.requiredModules, options),
    }, options);
  } else throw new EngineFeatureError('ENGINE_FEATURE_COMMAND_UNKNOWN', `Unknown command: ${options.command}`);
  console.log(JSON.stringify(output, null, 2));
  if (options.command !== 'patch' && !output.complete) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, code: error.code || 'ENGINE_FEATURE_ERROR', error: error.message, details: error.details || {} }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  PHYSICS_BACKENDS,
  SPINE_BACKENDS,
  PHYSICS_2D_BACKENDS,
  BACKEND_LABELS,
  EngineFeatureError,
  createEvidence,
  addFact,
  scanTextEvidence,
  scanSerializedObjects,
  scanCocosProject,
  decidePhysicsBackend,
  inferRequiredModules,
  parseEngineProfile,
  readEngineProfile,
  readAppliedPreviewFeatures,
  auditCocosEngineFeatures,
  patchEngineProfile,
  ensureCocosEngineFeatures,
  createMcpClient,
  unwrapToolResult,
  restartCocosProject,
  waitForEngineApplication,
  writeAuditReport,
  sha256,
  resolveSpineBackend,
  resolvePhysics2dBackend,
};
