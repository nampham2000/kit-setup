'use strict';

const { isAbsoluteFilesystemPath, stableStringify } = require('./live-schema.cjs');

const FEATURE_SKETCH_VERSION = 1;

const FEATURE_RULES = Object.freeze([
  {
    id: 'input', label: 'Player input', priority: 10,
    tests: [
      ['component', /(?:^|\.)(?:PlayerInput|InputSystemUIInputModule|EventSystem|StandaloneInputModule|Button)$/i],
      ['package', /^com\.unity\.inputsystem$/i],
      ['type', /(?:InputController|TouchController|Swipe|Drag|Tap)/i],
    ],
    target: 'Cocos touch/mouse events', action: 'Giữ action gameplay tối thiểu và map sang Node/Input events.',
  },
  {
    id: 'physics-2d', label: '2D physics', priority: 20,
    tests: [
      ['component', /(?:Rigidbody2D|Collider2D|Joint2D|Effector2D)$/i],
      ['method', /^On(?:Collision|Trigger)(?:Enter|Stay|Exit)2D$/],
    ],
    target: 'Cocos Physics2D', action: 'Map collider/body, collision matrix và callback 2D.',
  },
  {
    id: 'physics-3d', label: '3D physics', priority: 21,
    tests: [
      ['component', /(?:^|\.)(?:Rigidbody|Collider|BoxCollider|SphereCollider|CapsuleCollider|MeshCollider|CharacterController)$/i],
      ['method', /^On(?:Collision|Trigger)(?:Enter|Stay|Exit)$/],
    ],
    target: 'Cocos PhysicsSystem', action: 'Map rigidbody/collider, layer mask và trigger/collision callbacks.',
  },
  {
    id: 'ui', label: 'UI and HUD', priority: 30,
    tests: [
      ['component', /(?:Canvas|CanvasScaler|RectTransform|GraphicRaycaster|Image|RawImage|Text|TMP_|Button|Slider|Toggle)$/i],
      ['blocker', /^textmeshpro$/i],
      ['type', /(?:HUD|UI|Screen|Panel|Popup|Button|Counter)$/i],
    ],
    target: 'Cocos UI/Widget/Label', action: 'Dựng lại responsive layout và chỉ giữ UI phục vụ playable loop.',
  },
  {
    id: 'camera', label: 'Camera control', priority: 35,
    tests: [
      ['component', /(?:^|\.)(?:Camera|Cinemachine.+)$/i],
      ['package', /^com\.unity\.cinemachine$/i],
      ['type', /Camera(?:Controller|Manager|Follow|Rig)/i],
    ],
    target: 'Cocos Camera', action: 'Map FOV, projection, follow và portrait/landscape framing.',
  },
  {
    id: 'animation', label: 'Animation state', priority: 40,
    tests: [
      ['component', /(?:^|\.)(?:Animator|Animation|PlayableDirector)$/i],
      ['asset-type', /^(?:animation|controller|UnityEngine\.(?:AnimationClip|RuntimeAnimatorController|AnimatorController))$/i],
      ['blocker', /^animator$/i],
    ],
    target: 'Cocos Animation/code state', action: 'Port clip reachable và dựng lại transition/condition bằng code khi cần.',
  },
  {
    id: 'particles-vfx', label: 'Particles and VFX', priority: 45,
    tests: [
      ['component', /(?:ParticleSystem|VisualEffect|TrailRenderer|LineRenderer)$/i],
      ['package', /^com\.unity\.visualeffectgraph$/i],
      ['blocker', /^particle$/i],
    ],
    target: 'Cocos ParticleSystem/effects', action: 'Port module reachable và kiểm tra sub-emitter/trail bằng hình ảnh.',
  },
  {
    id: 'rendering-shaders', label: 'Rendering and shaders', priority: 50,
    tests: [
      ['component', /(?:Renderer|Light|Volume)$/i],
      ['asset-type', /^(?:shader|shaderGraph|material|UnityEngine\.(?:Shader|Material))$/i],
      ['package', /^com\.unity\.render-pipelines\./i],
      ['blocker', /^(?:shadergraph|shaderlab|urp-volume)$/i],
    ],
    target: 'Cocos materials/effects', action: 'Ưu tiên shader/material reachable, convert rồi validate và đối chiếu visual.',
  },
  {
    id: 'audio', label: 'Audio', priority: 55,
    tests: [
      ['component', /(?:AudioSource|AudioListener|AudioLowPassFilter|AudioHighPassFilter)$/i],
      ['asset-type', /^(?:audio|UnityEngine\.AudioClip)$/i],
      ['type', /(?:Audio|Sound|Music)(?:Manager|Controller|Service)/i],
    ],
    target: 'Cocos AudioSource/SoundManager', action: 'Map BGM/SFX, volume và mobile autoplay unlock.',
  },
  {
    id: 'runtime-loading', label: 'Runtime asset loading', priority: 60,
    tests: [
      ['package', /^com\.unity\.addressables$/i],
      ['blocker', /^addressables$/i],
      ['type', /(?:Addressable|AssetReference|AssetBundle|ResourceLoader)/i],
    ],
    target: 'Embedded Cocos resources', action: 'Loại remote/runtime catalog và nhúng dependency cần cho playable.',
  },
  {
    id: 'tweening', label: 'Tween sequences', priority: 65,
    tests: [
      ['blocker', /^dotween$/i],
      ['package', /dotween/i],
      ['type', /(?:Tween|Sequence)/i],
    ],
    target: 'cc.tween', action: 'Map duration/easing/callback/sequence theo semantics gốc.',
  },
  {
    id: 'timing-coroutines', label: 'Coroutine timing', priority: 66,
    tests: [
      ['blocker', /^coroutine$/i],
      ['type', /(?:Coroutine|Routine|WaitFor)/i],
    ],
    target: 'schedule/tween/async', action: 'Giữ đúng thứ tự, delay và cancellation khi thay coroutine.',
  },
  {
    id: 'spawning-pooling', label: 'Spawning and pooling', priority: 70,
    tests: [
      ['type', /(?:Spawner|SpawnManager|ObjectPool|PoolManager|Factory)$/i],
      ['component', /(?:Spawner|ObjectPool|PoolManager)$/i],
    ],
    target: 'playable-core ObjectPool', action: 'Pool object sinh lặp và tránh cấp phát trong update loop.',
  },
  {
    id: 'persistence', label: 'Persistence/state', priority: 75,
    tests: [
      ['type', /(?:SaveManager|PlayerPrefs|Persistence|DataStore|GameState)$/i],
      ['package', /(?:save|serialization)/i],
    ],
    target: 'In-memory playable state', action: 'Chỉ giữ state cần trong một phiên playable; bỏ persistence thừa.',
  },
  {
    id: 'analytics-monetization', label: 'Analytics/SDK hooks', priority: 80,
    tests: [
      ['type', /(?:Analytics|Tracking|Ads|Advertisement|IAP|Monetization|Firebase|GameAnalytics)/i],
      ['package', /(?:analytics|firebase|advertisement|iap|gameanalytics)/i],
    ],
    target: 'playable-sdk analytics/CTA', action: 'Map engagement, interaction, game end và CTA theo TrackingConfig.',
  },
]);

function logicalPath(value) {
  if (typeof value !== 'string' || !value || isAbsoluteFilesystemPath(value)) return null;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  return /^(?:Assets|Packages)\//.test(normalized) ? normalized : null;
}

function normalizedValue(value) {
  return String(value || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 160);
}

function addFact(target, kind, value, input = {}, exact = true) {
  const normalized = normalizedValue(value);
  if (!normalized) return;
  target.push({
    kind,
    value: normalized,
    path: logicalPath(input.assetPath || input.path),
    count: Number.isFinite(input.count) && input.count > 0 ? input.count : 1,
    exact: input.exact === undefined ? exact : !!input.exact,
  });
}

function objectEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

function collectComponentFacts(facts, value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') addFact(facts, 'component', item);
      else if (item && typeof item === 'object') addFact(facts, 'component', item.type || item.name, item);
    }
    return;
  }
  for (const [name, count] of objectEntries(value)) addFact(facts, 'component', name, { count });
}

function collectScriptFacts(facts, scripts) {
  for (const script of scripts || []) {
    const path = script.assetPath || script.path;
    for (const type of script.declaredTypes || (script.type ? [script.type] : [])) {
      addFact(facts, 'type', type, { path }, false);
    }
    for (const method of script.methods || script.lifecycleMethods || []) {
      addFact(facts, 'method', method, { path });
    }
  }
}

function collectFacts(snapshot) {
  const facts = [];
  const liveFacts = snapshot && snapshot.live && snapshot.live.facts || snapshot && snapshot.facts || {};
  collectComponentFacts(facts, liveFacts.componentTypes);
  collectComponentFacts(facts, liveFacts.components);
  collectComponentFacts(facts, liveFacts.componentCensus);
  collectScriptFacts(facts, liveFacts.scripts || liveFacts.scriptMethods || []);
  collectScriptFacts(facts, snapshot && snapshot.scriptIndex && snapshot.scriptIndex.scripts || []);

  const packages = snapshot && snapshot.project && snapshot.project.packages || {};
  for (const packageName of Object.keys(packages)) addFact(facts, 'package', packageName);
  if (Array.isArray(liveFacts.packages)) {
    for (const item of liveFacts.packages) {
      if (typeof item === 'string') addFact(facts, 'package', item);
      else if (item) addFact(facts, 'package', item.name || item.id, item);
    }
  } else {
    for (const [packageName, count] of objectEntries(liveFacts.packages)) addFact(facts, 'package', packageName, { count });
  }
  for (const item of liveFacts.typeCounts || []) {
    if (item && typeof item === 'object') addFact(facts, 'asset-type', item.type || item.name, item, false);
  }

  for (const blocker of snapshot && snapshot.features && snapshot.features.blockers || []) {
    addFact(facts, 'blocker', blocker.id || blocker.label, {
      path: blocker.examples && blocker.examples[0],
      count: blocker.count,
    });
  }
  for (const record of snapshot && snapshot.assets && snapshot.assets.records || []) {
    if (record.type && record.type !== 'asset' && record.type !== 'folder') {
      addFact(facts, 'asset-type', record.type, { path: record.assetPath || record.path }, false);
    }
    for (const blockerId of record.blockerIds || []) {
      addFact(facts, 'blocker', blockerId, { path: record.assetPath || record.path });
    }
  }
  return facts;
}

function dedupeFacts(facts) {
  const entries = new Map();
  for (const fact of facts) {
    const key = stableStringify({ kind: fact.kind, value: fact.value, path: fact.path, exact: fact.exact });
    const previous = entries.get(key);
    if (!previous) entries.set(key, { ...fact });
    else previous.count += fact.count;
  }
  return [...entries.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value) || String(a.path || '').localeCompare(String(b.path || '')));
}

function ruleMatches(rule, fact) {
  return rule.tests.some(([kind, pattern]) => kind === fact.kind && pattern.test(fact.value));
}

function buildFeatureSketch(snapshot, options = {}) {
  const maxEvidence = Number.isInteger(options.maxEvidence) ? Math.max(1, options.maxEvidence) : 3;
  const maxFeatures = Number.isInteger(options.maxFeatures) ? Math.max(1, options.maxFeatures) : 20;
  const facts = dedupeFacts(collectFacts(snapshot || {}));
  const features = [];
  for (const rule of FEATURE_RULES) {
    const matches = facts.filter(fact => ruleMatches(rule, fact));
    if (!matches.length) continue;
    const evidence = matches.slice(0, maxEvidence).map(fact => ({
      kind: fact.kind,
      value: fact.value,
      path: fact.path,
      count: fact.count,
    }));
    features.push({
      id: rule.id,
      label: rule.label,
      confidence: matches.some(fact => fact.exact) ? 'high' : 'medium',
      evidenceCount: matches.length,
      evidence,
      porting: { target: rule.target, action: rule.action },
      priority: rule.priority,
    });
  }
  return features
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .slice(0, maxFeatures);
}

module.exports = {
  FEATURE_SKETCH_VERSION,
  FEATURE_RULES,
  collectFacts,
  buildFeatureSketch,
};
