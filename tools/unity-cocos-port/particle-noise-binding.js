'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const { LIMIT_VELOCITY_COMPOSITION } = require('./particle-limit-velocity-binding');
const names = ['UnityNoiseKernel', 'UnityParticleLimitVelocity', 'UnityParticleNoise', 'UnityParticleNoiseAdapter'];

function noiseRotates(spec) {
  return spec.rotationAmount?.minMaxState !== 0 || spec.rotationAmount?.scalar !== 0;
}

function unsupportedNoiseReasons(spec, limitEnabled) {
  const reasons = [];
  // Low (1D), Medium (2D) and High (3D) kernels are native-validated.
  if (![0, 1, 2].includes(spec.quality)) reasons.push('quality-unknown');
  if (spec.remapEnabled) reasons.push('remap');
  // Unity limits stored + Noise velocity and stores only the non-animated part; bind
  // only with the shared limit runtime that implements that measured composition.
  if (limitEnabled && LIMIT_VELOCITY_COMPOSITION !== 'animated-velocity-before-limit') reasons.push('velocity-limit-integration');
  const curves = ['strength', 'strengthY', 'strengthZ', 'scrollSpeed', 'positionAmount', 'sizeAmount'];
  if (noiseRotates(spec)) curves.push('rotationAmount');
  for (const name of curves) {
    const curve = spec[name];
    if (!curve || ![0, 1].includes(curve.minMaxState)) reasons.push(`${name}-random-or-missing`);
    if (curve?.maxCurve?.m_Curve?.some(key => key.weightedMode)) reasons.push(`${name}-weighted`);
  }
  return reasons;
}

function stageNoiseRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
    // AssetDB owns .meta creation and UUIDs. A first import needs a refresh
    // and another porter pass; never fabricate a script UUID here.
  }
}

function attachNoiseRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p,id) => ({p,id})).filter(({p}) => p?.unityNoiseContract?.enabled);
  if (!particles.length) return;
  stageNoiseRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleNoiseAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleNoiseAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const {p,id} of particles) {
    const spec = p.unityNoiseContract;
    const limit = builder.objects[p._limitVelocityOvertimeModule?.__id__];
    const reasons = unsupportedNoiseReasons(spec, !!(limit?._enable ?? limit?.enable));
    const renderer = p.unityRendererContract, rotation = builder.objects[p._rotationOvertimeModule?.__id__];
    if (noiseRotates(spec) && !renderer?.eulerSigns) reasons.push('rotationAmount-renderer-signs');
    // Rotation noise feeds the Unity Euler accumulator: packed by the Euler adapter for
    // Mesh/Local billboards, or read directly when rotation over lifetime is off.
    if (noiseRotates(spec) && !!(rotation?._enable ?? rotation?.enable) && !(renderer?.localBillboard || renderer?.worldBillboard || renderer?.mode === 4 || renderer?.mode===0&&renderer?.alignment===0&&p.startRotation3D)) reasons.push('rotationAmount-with-builtin-rotation-over-lifetime');
    if (reasons.length || !classId) {
      reporter.high('PARTICLE_NOISE_ADAPTER_REQUIRED', options.src || '', builder.objects[p.node.__id__]?._name || '',
        `Native Noise not accepted: ${reasons.length ? reasons.join(', ') : 'AssetDB must import assets/script/UnityParticleNoiseAdapter.ts; refresh and rerun porter'}`);
      continue;
    }
    const contract = noiseRotates(spec) ? { ...spec, rotationSigns: renderer.eulerSigns } : spec;
    builder.addComponent(p.node.__id__, classId, {source:{__id__:id},sourceContract:JSON.stringify(contract)}, null, `cmp-unity-noise-${id}`);
    reporter.low('PARTICLE_NOISE_ADAPTER_BOUND', options.src || '', builder.objects[p.node.__id__]?._name || '',
      'Native Low/Medium/High Noise adapter attached with source curves; live visual acceptance still required.');
  }
}

module.exports = { noiseRotates, unsupportedNoiseReasons, stageNoiseRuntime, attachNoiseRuntime };
