'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityNoiseKernel', 'UnityParticleNoise', 'UnityParticleNoiseAdapter'];

function unsupportedNoiseReasons(spec, limitEnabled) {
  const reasons = [];
  if (spec.quality !== 1 && spec.quality !== 2) reasons.push('quality-other-than-Medium-or-High');
  if (spec.remapEnabled) reasons.push('remap');
  if (limitEnabled) reasons.push('velocity-limit-integration');
  for (const name of ['rotationAmount', 'sizeAmount']) {
    if (spec[name]?.minMaxState !== 0 || spec[name]?.scalar !== 0) reasons.push(name);
  }
  for (const name of ['strength', 'strengthY', 'strengthZ', 'scrollSpeed', 'positionAmount']) {
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
    if (reasons.length || !classId) {
      reporter.high('PARTICLE_NOISE_ADAPTER_REQUIRED', options.src || '', builder.objects[p.node.__id__]?._name || '',
        `Native Noise not accepted: ${reasons.length ? reasons.join(', ') : 'AssetDB must import assets/script/UnityParticleNoiseAdapter.ts; refresh and rerun porter'}`);
      continue;
    }
    builder.addComponent(p.node.__id__, classId, {source:{__id__:id},sourceContract:JSON.stringify(spec)}, null, `cmp-unity-noise-${id}`);
    reporter.low('PARTICLE_NOISE_ADAPTER_BOUND', options.src || '', builder.objects[p.node.__id__]?._name || '',
      'Native Medium/High curl adapter attached with source curves; live visual acceptance still required.');
  }
}

module.exports = { unsupportedNoiseReasons, stageNoiseRuntime, attachNoiseRuntime };
