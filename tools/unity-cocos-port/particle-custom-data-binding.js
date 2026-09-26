'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleCustomData', 'UnityParticleCustomDataAdapter'];

// UnityEngine.ParticleSystemVertexStream: Custom1X..Custom1XYZW, Custom2X..Custom2XYZW.
const CUSTOM1_X = 31, CUSTOM1_XYZW = 34, CUSTOM2_X = 35, CUSTOM2_XYZW = 38;
const VECTOR_MODE = 1;

function vertexStreams(renderer = {}) {
  const hex = String(renderer.m_VertexStreams ?? '');
  // The default stream set (Position, Normal, Color, UV) is serialized as an empty string.
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return [];
  return hex.match(/../g).map((byte) => parseInt(byte, 16));
}

function curveKeys(curve) {
  return (curve?.m_Curve || []).map((key) => ({
    time: Number(key.time ?? 0), value: Number(key.value ?? 0),
    inSlope: Number(key.inSlope ?? 0), outSlope: Number(key.outSlope ?? 0),
  }));
}

function minMaxCurve(curve = {}) {
  return {
    mode: Number(curve.minMaxState ?? 0), scalar: Number(curve.scalar ?? 0), minimum: Number(curve.minScalar ?? 0),
    keys: curveKeys(curve.maxCurve), minKeys: curveKeys(curve.minCurve),
  };
}

// Unity Custom1 as the renderer streams it: the shader reads only the streamed
// components, and a disabled module still streams zeros.
function particleCustomDataContract(particle = {}, renderer = {}) {
  const streams = vertexStreams(renderer);
  const custom1 = streams.filter((s) => s >= CUSTOM1_X && s <= CUSTOM1_XYZW).map((s) => s - CUSTOM1_X + 1);
  const components = custom1.length ? Math.max(...custom1) : 0;
  const custom2 = streams.some((s) => s >= CUSTOM2_X && s <= CUSTOM2_XYZW);
  const module = particle.CustomDataModule || {};
  const enabled = Number(module.enabled) === 1;
  const mode = Number(module.mode0 ?? 0);
  const count = Math.min(components, Number(module.vectorComponentCount0 ?? 4));
  const curves = enabled && mode === VECTOR_MODE
    ? Array.from({ length: count }, (_, i) => minMaxCurve(module[`vector0_${i}`])) : [];
  return { components, custom2, enabled, mode, curves };
}

function stageCustomDataRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

function attachCustomDataRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id }))
    .filter(({ p }) => p?.__type__ === 'cc.ParticleSystem' && p.unityCustomDataContract);
  let bound = 0;
  for (const { p, id } of particles) {
    const spec = p.unityCustomDataContract;
    const name = builder.objects[p.node.__id__]?._name || '';
    if (spec.custom2) {
      reporter.high('PARTICLE_CUSTOM2_STREAM_UNPORTED', options.src || '', name, 'Renderer streams Unity Custom2; only Custom1 is fed to the material.');
    }
    if (!spec.components || !spec.curves.length) continue;
    if (spec.curves.some((c) => c.keys.some((k) => !Number.isFinite(k.value)))) {
      reporter.high('PARTICLE_CUSTOM_DATA_CURVE_INVALID', options.src || '', name, 'Custom1 curve has non-finite key values.');
      continue;
    }
    const textureAnimation = builder.objects[p._textureAnimationModule?.__id__];
    if (textureAnimation && (textureAnimation._enable ?? textureAnimation.enable)) {
      reporter.high('PARTICLE_CUSTOM_DATA_FRAME_CONFLICT', options.src || '', name,
        'Custom1 and texture-sheet animation both need the per-vertex frame index; Custom1 is not bound.');
      continue;
    }
    if (!bound++) stageCustomDataRuntime(options);
    let classId = builder.cocosDb?.findScriptClass?.('UnityParticleCustomDataAdapter')?.classId;
    const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleCustomDataAdapter.ts.meta');
    if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
    if (!classId) {
      reporter.high('PARTICLE_CUSTOM_DATA_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleCustomDataAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id }, sourceContract: JSON.stringify({ curves: spec.curves }) },
      null, `cmp-unity-custom-data-${id}`);
  }
  if (bound) {
    reporter.low('PARTICLE_CUSTOM_DATA_BOUND', options.src || '', `${bound} system(s)`,
      'Unity Custom1 curves feed the material under UNITY_PARTICLE_CUSTOM_DATA; the material must read customDataTexture.');
  }
}

module.exports = { vertexStreams, particleCustomDataContract, stageCustomDataRuntime, attachCustomDataRuntime };
