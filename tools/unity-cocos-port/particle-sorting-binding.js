'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleSorting', 'UnityParticleSortingAdapter'];
const UNITY_QUEUE_TAGS = { Background: 1000, Geometry: 2000, AlphaTest: 2450, GeometryLast: 2500, Transparent: 3000, Overlay: 4000 };

// Unity URP transparent order is sorting layer, sortingOrder, render queue, then
// camera distance + sortingFudge (fixtures/particle-sort-key-native.json). Cocos
// priorities are only comparable when every transparent renderer carries one,
// so every transparent particle renderer is bound, including fudge 0.

function unityShaderQueue(text) {
  const match = /"Queue"\s*=\s*"\s*(\w+)\s*(?:([+-])\s*(\d+))?\s*"/.exec(String(text || ''));
  if (!match || !(match[1] in UNITY_QUEUE_TAGS)) return null;
  return UNITY_QUEUE_TAGS[match[1]] + (match[2] ? (match[2] === '-' ? -1 : 1) * Number(match[3]) : 0);
}

/** m_CustomRenderQueue when >= 0, else the shader "Queue" tag; null when unknown. */
function unityMaterialRenderQueue(materialAsset, unityDb) {
  let text;
  try { text = fs.readFileSync(materialAsset.path, 'utf8'); } catch { return null; }
  const custom = /m_CustomRenderQueue:\s*(-?\d+)/.exec(text);
  if (custom && Number(custom[1]) >= 0) return Number(custom[1]);
  const shader = /m_Shader:\s*\{[^}]*guid:\s*([0-9a-f]{32})/.exec(text);
  const asset = shader && unityDb?.get ? unityDb.get(shader[1]) : null;
  if (!asset?.path) return null;
  try { return unityShaderQueue(fs.readFileSync(asset.path, 'utf8')); } catch { return null; }
}

function readSortingLayers(options) {
  if (options._unitySortingLayers !== undefined) return options._unitySortingLayers;
  let layers = null;
  for (let dir = options.unityRoot ? path.resolve(options.unityRoot) : ''; dir; ) {
    const file = path.join(dir, 'ProjectSettings', 'TagManager.asset');
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      layers = [];
      for (let i = lines.findIndex((line) => /^\s*m_SortingLayers:\s*$/.test(line)) + 1; i > 0 && i < lines.length && !/^\s*m_\w+:/.test(lines[i]); i++) {
        const match = /uniqueID:\s*(-?\d+)/.exec(lines[i]);
        if (match) layers.push(Number(match[1]));
      }
      break;
    }
    const parent = path.dirname(dir);
    dir = parent === dir ? '' : parent;
  }
  options._unitySortingLayers = layers;
  return layers;
}

/** Sorting layer value (list position) of a unique layer id; Default (0) falls back to 0. */
function unitySortingLayerValue(layerId, options) {
  const layers = readSortingLayers(options);
  const index = layers ? layers.indexOf(Number(layerId) || 0) : -1;
  if (index >= 0) return { value: index, known: true };
  return { value: 0, known: !Number(layerId) };
}

function unityParticleSortSpec(particle, objects, options) {
  const contract = particle.unityRendererContract;
  const sorting = contract?.sorting || {};
  const renderer = objects[particle.renderer?.__id__] || {};
  const queue = Number.isFinite(particle.unityRenderQueue) ? particle.unityRenderQueue : null;
  const layer = unitySortingLayerValue(sorting.layer, options);
  const spec = { path: objects[particle.node?.__id__]?._name || '', fudge: Number(sorting.fudge) || 0, queue: queue ?? 3000 };
  if (sorting.order) spec.order = Number(sorting.order);
  if (layer.value) spec.layer = layer.value;
  if (sorting.sortMode) spec.sortMode = Number(sorting.sortMode);
  if (contract?.mode === 1) {
    spec.lengthScale = Number(renderer._lengthScale) || 0;
    spec.velocityScale = Number(renderer._velocityScale) || 0;
  }
  return { spec, queueKnown: queue !== null, layerKnown: layer.known };
}

function stageSortingRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
  }
}

function attachSortingRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id }))
    .filter(({ p }) => p?.__type__ === 'cc.ParticleSystem' && p.unityRendererContract
      && !(Number.isFinite(p.unityRenderQueue) && p.unityRenderQueue <= 2500));
  if (!particles.length) return;
  stageSortingRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleSortingAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleSortingAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  if (!classId) {
    reporter.high('PARTICLE_SORTING_ADAPTER_REQUIRED', options.src || '', '',
      `${particles.length} transparent particle renderers need the Unity sort key; AssetDB must import assets/script/UnityParticleSortingAdapter.ts, then rerun porter.`);
    return;
  }
  let bound = 0, keyed = 0;
  for (const { p, id } of particles) {
    const { spec, queueKnown, layerKnown } = unityParticleSortSpec(p, builder.objects, options);
    if (!layerKnown) {
      reporter.high('PARTICLE_SORTING_ADAPTER_REQUIRED', options.src || '', spec.path,
        `Sorting layer ${p.unityRendererContract.sorting.layer} is not in ProjectSettings/TagManager.asset; its sort value is unknown.`);
      continue;
    }
    if (!queueKnown) reporter.medium('PARTICLE_SORTING_QUEUE_ASSUMED', options.src || '', spec.path,
      'Unity material render queue could not be read; the Unity Transparent queue 3000 is assumed.');
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id }, sourceContract: JSON.stringify(spec) }, null, `cmp-unity-sorting-${id}`);
    bound += 1;
    if (spec.fudge || spec.order || spec.layer || spec.queue !== 3000 || spec.sortMode) keyed += 1;
  }
  if (bound) reporter.low('PARTICLE_SORTING_ADAPTER_BOUND', options.src || '', '',
    `Unity transparent sort key bound to ${bound} particle renderers (${keyed} with non-default fudge/order/layer/queue/sortMode); live preview acceptance still required.`);
}

module.exports = { unityShaderQueue, unityMaterialRenderQueue, unitySortingLayerValue, unityParticleSortSpec, stageSortingRuntime, attachSortingRuntime };
