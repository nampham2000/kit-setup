'use strict';

const {
  addFact,
  createEvidence,
  decidePhysicsBackend,
} = require('../cocos-engine-feature-audit.cjs');

const ENGINE_FEATURE_CLOSURE_SCHEMA_VERSION = 1;
const SUPPORTED_SPINE_SOURCE_VERSIONS = new Set(['3.8', '4.2']);
const OPTIONAL_3D_FEATURE_MODULES = Object.freeze([
  'primitive',
  'occlusion-query',
  'geometry-renderer',
  'debug-renderer',
  'terrain',
  'light-probe',
]);

const MODULE_ORDER = Object.freeze([
  '3d',
  'animation',
  'skeletal-animation',
  'marionette',
  'graphics',
  'primitive',
  'occlusion-query',
  'geometry-renderer',
  'debug-renderer',
  'terrain',
  'light-probe',
  'spine',
  'spine-3.8',
  'spine-4.2',
  'physics-builtin',
  'physics-cannon',
  'physics-ammo',
  'physics-physx',
  'physics-2d',
  'physics-2d-box2d',
]);

const FEATURE_MODULES = Object.freeze({
  'animator-controller': ['animation', 'skeletal-animation', 'marionette'],
  graphics: ['graphics'],
  primitive: ['3d', 'primitive'],
  'occlusion-query': ['3d', 'occlusion-query'],
  'geometry-renderer': ['3d', 'geometry-renderer'],
  'debug-renderer': ['3d', 'debug-renderer'],
  terrain: ['3d', 'terrain'],
  'light-probe': ['3d', 'light-probe'],
});

const UNITY_PHYSICS_FACTS = Object.freeze([
  ['RigidBody', /(?:^|\n)(?:Rigidbody:|---\s*!u!54\s)/m],
  ['BoxCollider', /(?:^|\n)(?:BoxCollider:|---\s*!u!65\s)/m],
  ['SphereCollider', /(?:^|\n)(?:SphereCollider:|---\s*!u!135\s)/m],
  ['CapsuleCollider', /(?:^|\n)(?:CapsuleCollider:|---\s*!u!136\s)/m],
  ['MeshCollider', /(?:^|\n)(?:MeshCollider:|---\s*!u!64\s)/m],
  ['TerrainCollider', /(?:^|\n)(?:TerrainCollider:|---\s*!u!154\s)/m],
  ['CharacterController', /(?:^|\n)(?:CharacterController:|---\s*!u!143\s)/m],
  ['HingeConstraint', /(?:^|\n)(?:HingeJoint:|---\s*!u!59\s)/m],
  ['FixedConstraint', /(?:^|\n)(?:FixedJoint:|---\s*!u!138\s)/m],
  ['ConfigurableConstraint', /(?:^|\n)(?:ConfigurableJoint:|---\s*!u!153\s)/m],
  ['PhysicsRaycast', /\bPhysics\.(?:Raycast|RaycastAll|RaycastNonAlloc|Linecast|SphereCast|BoxCast|CapsuleCast)\s*\(/],
  ['PhysicsSweep', /\bPhysics\.(?:SphereCast|BoxCast|CapsuleCast)(?:All|NonAlloc)?\s*\(/],
  ['PhysicsSimulation', /\b(?:AddForce|AddRelativeForce|AddTorque|AddExplosionForce|MovePosition|MoveRotation)\s*\(/],
  ['CharacterControllerMove', /\bCharacterController\s*\.\s*(?:Move|SimpleMove)\s*\(/],
  ['ContinuousCollisionDetection', /\bCollisionDetectionMode\s*\.\s*(?:Continuous|ContinuousDynamic|ContinuousSpeculative)\b/],
]);

const UNITY_PHYSICS_2D_FACTS = Object.freeze([
  ['Rigidbody2D', /(?:^|\n)Rigidbody2D:\s*/m],
  ['Collider2D', /(?:^|\n)(?:BoxCollider2D|CircleCollider2D|CapsuleCollider2D|PolygonCollider2D|EdgeCollider2D|CompositeCollider2D):\s*/m],
  ['Physics2DQuery', /\bPhysics2D\s*\.\s*(?:Raycast|RaycastAll|RaycastNonAlloc|Linecast|Overlap\w+|CircleCast|BoxCast|CapsuleCast)\s*\(/],
  ['Physics2DSimulation', /\bRigidbody2D\b|\bAddForce\s*\(/],
]);

function normalizeLogicalPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return /^(?:Assets|Packages)\//.test(normalized) ? normalized : null;
}

function addMarker(markers, feature, signal, details = {}) {
  if (!feature || !signal) return;
  const marker = { feature, signal };
  if (details.version) marker.version = details.version;
  if (details.fact) marker.fact = details.fact;
  const key = JSON.stringify(marker);
  if (!markers.some(item => JSON.stringify(item) === key)) markers.push(marker);
}

function spineVersion(text) {
  const match = /["']spine["']\s*:\s*["'](\d+\.\d+)(?:\.[^"']*)?["']/i.exec(String(text || ''));
  return match ? match[1] : null;
}

const UNITY_RUNTIME_ENTRY_METHOD = /^(?:Awake|Start|OnEnable|OnDisable|Update|LateUpdate|FixedUpdate|OnGUI|OnRenderObject|OnWillRenderObject|OnBecameVisible|OnBecameInvisible|OnCollision(?:Enter|Stay|Exit)|OnTrigger(?:Enter|Stay|Exit)|OnMouse(?:Down|Up|Drag|Enter|Exit|Over)|OnPointer(?:Down|Up|Click|Enter|Exit|Move)|OnDrag|OnBeginDrag|OnEndDrag)$/;

function maskCommentsAndStrings(source) {
  return String(source || '')
    .replace(/@"(?:[^"]|"")*"/g, match => ' '.repeat(match.length))
    .replace(/"(?:\\.|[^"\\])*"/g, match => ' '.repeat(match.length))
    .replace(/'(?:\\.|[^'\\])*'/g, match => ' '.repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
    .replace(/\/\/[^\n\r\u2028\u2029]*/g, match => ' '.repeat(match.length));
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Keep feature API tokens only from Unity callbacks and the local methods they
 * actually call. Public/protected methods remain possible serialized/external
 * entry points; an uncalled private debug helper is deliberately excluded.
 */
function reachableCSharpBody(text) {
  const masked = maskCommentsAndStrings(text);
  const methods = [];
  const declaration = /\b(?:(public|protected|internal|private)\s+)?(?:(?:static|virtual|override|abstract|sealed|async|extern|new|unsafe|partial)\s+)*(?:[A-Za-z_][\w.<>?,\[\]]*\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g;
  let match;
  while ((match = declaration.exec(masked))) {
    const open = masked.indexOf('{', match.index + match[0].length - 1);
    const close = matchingBrace(masked, open);
    if (close < 0) break;
    methods.push({
      access: match[1] || 'private',
      name: match[2],
      body: masked.slice(open + 1, close),
    });
    declaration.lastIndex = close + 1;
  }
  const byName = new Map(methods.map(method => [method.name, method]));
  const queue = methods.filter(method => method.access !== 'private' || UNITY_RUNTIME_ENTRY_METHOD.test(method.name));
  const reachable = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const method = queue[cursor];
    if (!method || reachable.has(method.name)) continue;
    reachable.add(method.name);
    for (const called of method.body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const target = byName.get(called[1]);
      if (target && !reachable.has(target.name)) queue.push(target);
    }
  }
  return methods.filter(method => reachable.has(method.name)).map(method => method.body).join('\n');
}

function hasActiveBuiltinPrimitiveMesh(text) {
  const documents = String(text || '').split(/(?=^---\s*!u!)/m);
  const builtinMesh = /\bm_Mesh:\s*\{\s*fileID:\s*(?:1020[2-9]|10210)\s*,\s*guid:\s*0{1,32}\b/i;
  return documents.some(document =>
    (/\bMeshFilter:\s*/.test(document) && builtinMesh.test(document)) ||
    (/\bParticleSystemRenderer:\s*/.test(document) && /\bm_RenderMode:\s*4\b/.test(document) && builtinMesh.test(document)));
}

/**
 * Extract only bounded, decision-changing engine feature facts. Raw Unity text
 * never leaves the static index record, so the preflight projection stays
 * portable and cannot become a source dump.
 */
function detectUnityEngineFeatureEvidence(input = {}) {
  const assetPath = normalizeLogicalPath(input.assetPath || input.path) || '';
  const extension = String(input.extension || '').toLowerCase();
  const type = String(input.type || '').toLowerCase();
  const text = String(input.text || '');
  const runtimeText = extension === '.cs' ? reachableCSharpBody(text) : text;
  const markers = [];

  const controllerReference = /\bm_Controller:\s*\{\s*fileID:\s*(?!0(?:\D|$))[-\d]+(?:,\s*guid:\s*[0-9a-f]{32})?/i.test(text);
  if (extension === '.controller' || type === 'controller' ||
      ((/(?:^|\n)(?:Animator:|---\s*!u!95\s)/m.test(text)) && controllerReference)) {
    addMarker(markers, 'animator-controller', extension === '.controller' ? 'animator-controller-asset' : 'animator-with-controller');
  }

  const detectedSpineVersion = spineVersion(text);
  if (detectedSpineVersion) {
    addMarker(markers, 'spine-version', 'spine-skeleton-json-version', { version: detectedSpineVersion });
  }
  if (/\b(?:skeletonDataAsset|m_SkeletonDataAsset|skeletonJSON)\s*:/i.test(text) ||
      /\b(?:SkeletonAnimation|SkeletonGraphic|SkeletonDataAsset)\b/.test(text) && /\bSpine(?:\.|\s)/.test(text)) {
    addMarker(markers, 'spine-runtime', 'spine-runtime-reference');
  }

  if (hasActiveBuiltinPrimitiveMesh(text) ||
      /\bGameObject\s*\.\s*CreatePrimitive\s*\(/.test(runtimeText)) {
    addMarker(markers, 'primitive', 'unity-builtin-primitive');
  }

  if (/(?:^|\n)(?:OcclusionArea|OcclusionPortal):/m.test(text) ||
      /\buseOcclusionCulling\s*=/.test(runtimeText)) {
    addMarker(markers, 'occlusion-query', 'unity-occlusion-runtime');
  }

  if (/\b(?:GL\s*\.\s*Begin|Graphics\s*\.\s*(?:DrawMeshNow|DrawProceduralNow))\s*\(/.test(runtimeText)) {
    addMarker(markers, 'geometry-renderer', 'unity-immediate-geometry-rendering');
  }
  if (/\bDebug\s*\.\s*(?:DrawLine|DrawRay)\s*\(/.test(runtimeText)) {
    addMarker(markers, 'debug-renderer', 'unity-runtime-debug-draw');
  }
  if (/(?:^|\n)(?:Terrain|TerrainCollider):/m.test(text) ||
      /\b(?:TerrainData|TerrainCollider)\b/.test(runtimeText)) {
    addMarker(markers, 'terrain', 'unity-terrain-runtime');
  }
  if (/(?:^|\n)(?:LightProbeGroup|LightProbeProxyVolume):/m.test(text) ||
      /\b(?:LightProbeGroup|LightProbeProxyVolume|LightmapSettings\s*\.\s*lightProbes)\b/.test(runtimeText)) {
    addMarker(markers, 'light-probe', 'unity-light-probe-runtime');
  }
  if (/(?:^|\n)(?:LineRenderer|TrailRenderer):/m.test(text) ||
      /\b(?:OnPopulateMesh\s*\(|VertexHelper\b)/.test(runtimeText)) {
    addMarker(markers, 'graphics', 'unity-runtime-vector-geometry');
  }

  for (const [fact, pattern] of UNITY_PHYSICS_FACTS) {
    if (pattern.test(extension === '.cs' ? runtimeText : text)) addMarker(markers, 'physics-3d', `unity-${fact}`, { fact });
  }
  for (const [fact, pattern] of UNITY_PHYSICS_2D_FACTS) {
    if (pattern.test(extension === '.cs' ? runtimeText : text)) addMarker(markers, 'physics-2d', `unity-${fact}`, { fact });
  }

  return markers;
}

function sourcePathsForScope(snapshot, coreScope) {
  if (!coreScope || coreScope.profile === 'full-project' || !coreScope.pathSet) return null;
  return new Set([
    ...coreScope.pathSet,
    ...(coreScope.adapterPathSet || []),
  ]);
}

function moduleSort(left, right) {
  const a = MODULE_ORDER.indexOf(left);
  const b = MODULE_ORDER.indexOf(right);
  if (a >= 0 || b >= 0) return (a < 0 ? Number.MAX_SAFE_INTEGER : a) - (b < 0 ? Number.MAX_SAFE_INTEGER : b) || left.localeCompare(right);
  return left.localeCompare(right);
}

function pushModuleEvidence(target, moduleName, marker, source) {
  if (!target.has(moduleName)) target.set(moduleName, { module: moduleName, sources: [], signals: [] });
  const entry = target.get(moduleName);
  if (source && entry.sources.length < 3 && !entry.sources.includes(source)) entry.sources.push(source);
  if (marker.signal && entry.signals.length < 4 && !entry.signals.includes(marker.signal)) entry.signals.push(marker.signal);
}

function buildUnityEngineFeatureClosure(snapshot, coreScope) {
  const allowedPaths = sourcePathsForScope(snapshot, coreScope);
  const records = snapshot && snapshot.assets && snapshot.assets.records || [];
  const modules = new Set();
  const moduleEvidence = new Map();
  const spineUsageSources = [];
  const spineVersionSources = new Map();
  const physicsEvidence = createEvidence({ sourceEngine: 'unity-physx' });
  const physics2dSources = [];
  let evidenceRecordCount = 0;

  for (const record of records) {
    const source = normalizeLogicalPath(record && (record.assetPath || record.path));
    if (!source || (allowedPaths && !allowedPaths.has(source))) continue;
    const markers = Array.isArray(record.engineFeatureEvidence) ? record.engineFeatureEvidence : [];
    if (!markers.length) continue;
    evidenceRecordCount += 1;
    for (const marker of markers) {
      if (marker.feature === 'spine-runtime') {
        if (spineUsageSources.length < 3 && !spineUsageSources.includes(source)) spineUsageSources.push(source);
        continue;
      }
      if (marker.feature === 'spine-version' && marker.version) {
        if (!spineVersionSources.has(marker.version)) spineVersionSources.set(marker.version, []);
        const sources = spineVersionSources.get(marker.version);
        if (sources.length < 3 && !sources.includes(source)) sources.push(source);
        continue;
      }
      if (marker.feature === 'physics-3d' && marker.fact) {
        addFact(physicsEvidence, marker.fact, source, marker.signal);
        continue;
      }
      if (marker.feature === 'physics-2d') {
        if (physics2dSources.length < 3 && !physics2dSources.includes(source)) physics2dSources.push(source);
        continue;
      }
      for (const moduleName of FEATURE_MODULES[marker.feature] || []) {
        modules.add(moduleName);
        pushModuleEvidence(moduleEvidence, moduleName, marker, source);
      }
    }
  }

  physicsEvidence.filesScanned = evidenceRecordCount;
  const physicsDecision = decidePhysicsBackend(physicsEvidence);
  if (physicsDecision.backend) {
    modules.add('3d');
    modules.add(physicsDecision.backend);
    const physicsSources = Object.values(physicsEvidence.facts).flatMap(fact => fact.files || []);
    const synthetic = { signal: physicsDecision.reasons[0] || 'unity-physics-3d' };
    for (const source of physicsSources.slice(0, 3)) {
      pushModuleEvidence(moduleEvidence, '3d', synthetic, source);
      pushModuleEvidence(moduleEvidence, physicsDecision.backend, synthetic, source);
    }
  }
  const physics2dBackend = physics2dSources.length ? 'physics-2d-box2d' : null;
  if (physics2dBackend) {
    modules.add('physics-2d');
    modules.add(physics2dBackend);
    const marker = { signal: 'unity-physics-2d-runtime' };
    for (const source of physics2dSources) {
      pushModuleEvidence(moduleEvidence, 'physics-2d', marker, source);
      pushModuleEvidence(moduleEvidence, physics2dBackend, marker, source);
    }
  }

  const blockers = [];
  let spineBackend = null;
  const spineVersions = [...spineVersionSources.keys()].sort();
  const spineUsed = spineUsageSources.length > 0 || spineVersions.length > 0;
  if (spineUsed) {
    if (spineVersions.length !== 1) {
      blockers.push({
        code: spineVersions.length ? 'UNITY_SPINE_MULTIPLE_RUNTIME_VERSIONS' : 'UNITY_SPINE_VERSION_UNRESOLVED',
        message: spineVersions.length
          ? `Reachable Spine closure contains multiple skeleton runtime versions: ${spineVersions.join(', ')}.`
          : 'Reachable Spine runtime usage has no exact skeleton JSON version evidence.',
        evidence: [...spineUsageSources, ...spineVersions.flatMap(version => spineVersionSources.get(version) || [])].slice(0, 3),
      });
    } else if (!SUPPORTED_SPINE_SOURCE_VERSIONS.has(spineVersions[0])) {
      blockers.push({
        code: 'UNITY_SPINE_RUNTIME_UNSUPPORTED',
        message: `Reachable Spine skeleton version ${spineVersions[0]} has no exact Cocos 3.8.8 backend mapping.`,
        evidence: (spineVersionSources.get(spineVersions[0]) || []).slice(0, 3),
      });
    } else {
      spineBackend = `spine-${spineVersions[0]}`;
      modules.add('spine');
      modules.add(spineBackend);
      const marker = { signal: `unity-spine-${spineVersions[0]}` };
      for (const source of [...spineUsageSources, ...(spineVersionSources.get(spineVersions[0]) || [])].slice(0, 3)) {
        pushModuleEvidence(moduleEvidence, 'spine', marker, source);
        pushModuleEvidence(moduleEvidence, spineBackend, marker, source);
      }
    }
  }

  const requiredModules = [...modules].sort(moduleSort);
  // These are the lightweight 3D Feature Cropping switches owned by the
  // Unity source-closure decision. Persisting the negative decision matters:
  // an earlier/stale detector may already have enabled one, and an add-only
  // repair would leave that false positive active forever.
  const disabledModules = OPTIONAL_3D_FEATURE_MODULES.filter(moduleName => !modules.has(moduleName));
  const evidence = requiredModules.map(moduleName => moduleEvidence.get(moduleName) || {
    module: moduleName,
    sources: [],
    signals: [],
  });
  return {
    schemaVersion: ENGINE_FEATURE_CLOSURE_SCHEMA_VERSION,
    status: blockers.length ? 'blocked' : requiredModules.length || disabledModules.length ? 'required' : 'not-required',
    requiredModules,
    disabledModules,
    selectors: {
      physicsBackend: physicsDecision.backend || null,
      physics2dBackend,
      spineBackend,
    },
    evidence,
    blockers,
  };
}

module.exports = {
  ENGINE_FEATURE_CLOSURE_SCHEMA_VERSION,
  SUPPORTED_SPINE_SOURCE_VERSIONS,
  OPTIONAL_3D_FEATURE_MODULES,
  FEATURE_MODULES,
  detectUnityEngineFeatureEvidence,
  buildUnityEngineFeatureClosure,
  reachableCSharpBody,
  hasActiveBuiltinPrimitiveMesh,
};
