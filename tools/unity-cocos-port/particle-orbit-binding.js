'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const { unsupportedNoiseReasons } = require('./particle-noise-binding');
const { orbitCurveActive } = require('./particle-orbit-contract');
const names = ['UnityNoiseKernel', 'UnityParticleLimitVelocity', 'UnityParticleOrbit', 'UnityParticleOrbitAdapter'];

function unsupportedOrbitReasons(spec) {
  const reasons=[];
  if(![0,1].includes(spec.simulationSpace))reasons.push('custom-simulation-space');
  // fixtures/orbit-velocity-space-native.json: Velocity over Lifetime `space` moves only the
  // linear X/Y/Z axes; orbital and radial motion is identical in Local and World. World linear
  // velocity is not measured into the simulation frame yet.
  if(spec.inWorldSpace&&['x','y','z'].some(k=>orbitCurveActive(spec.velocity?.[k])))reasons.push('world-linear-velocity');
  if(spec.simulationSpace===1&&spec.scalingMode!==0)reasons.push('world-nonhierarchical-scaling');
  if(spec.simulationSpace===1&&spec.noiseEnabled)reasons.push('world-noise-composition');
  // Unity limits stored + orbital/radial velocity and stores only the non-animated part
  // (velocity-limit-composition-native.json); its speed modifier acts after the limit.
  if(spec.limitEnabled&&(spec.velocity.speedModifier?.minMaxState!==0||spec.velocity.speedModifier?.scalar!==1))reasons.push('velocity-limit-speed-modifier');
  if(spec.noiseEnabled && (!spec.noise?.enabled || unsupportedNoiseReasons(spec.noise,spec.limitEnabled).length || spec.velocity.speedModifier?.minMaxState!==0 || spec.velocity.speedModifier?.scalar!==1))reasons.push('noise-composition');
  // fixtures/particle-orbit-offset-native.json: Local simulation orbits (and pushes radially) around the
  // offset point, measured to 6e-7; the world-simulation frame of the offset is not measured yet.
  if(spec.simulationSpace!==0)for(const key of ['orbitalOffsetX','orbitalOffsetY','orbitalOffsetZ'])if(orbitCurveActive(spec.velocity[key]))reasons.push(key+'-world-simulation');
  for(const [key,c] of Object.entries(spec.velocity))if(c?.maxCurve&&[c.maxCurve,c.minCurve].some(v=>v?.m_Curve?.some(k=>k.weightedMode)))reasons.push(key+'-weighted');
  return reasons;
}

function canBindOrbit(spec) { return !!spec.enabled && unsupportedOrbitReasons(spec).length === 0; }

function stageOrbitRuntime(options) {
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

function attachOrbitRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p,id) => ({p,id})).filter(({p}) => p?.unityOrbitContract?.enabled);
  if (!particles.length) return;
  stageOrbitRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleOrbitAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleOrbitAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const {p,id} of particles) {
    const spec = p.unityOrbitContract;
    const limit = builder.objects[p._limitVelocityOvertimeModule?.__id__];
    const reasons = unsupportedOrbitReasons(spec, !!(limit?._enable ?? limit?.enable));
    if (reasons.length || !classId) {
      reporter.high('PARTICLE_ORBIT_ADAPTER_REQUIRED', options.src || '', builder.objects[p.node.__id__]?._name || '',
        `Native Orbit not accepted: ${reasons.length ? reasons.join(', ') : 'AssetDB must import assets/script/UnityParticleOrbitAdapter.ts; refresh and rerun porter'}`);
      continue;
    }
    builder.addComponent(p.node.__id__, classId, {source:{__id__:id},sourceContract:JSON.stringify(spec)}, null, `cmp-unity-orbit-${id}`);
    reporter.low('PARTICLE_ORBIT_ADAPTER_BOUND', options.src || '', builder.objects[p.node.__id__]?._name || '',
      'Native orbital adapter attached with source curves and simulation frame; live visual acceptance still required.');
  }
}

module.exports = { canBindOrbit, unsupportedOrbitReasons, stageOrbitRuntime, attachOrbitRuntime };
