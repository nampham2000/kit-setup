'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleBurstEmission', 'UnityParticleBurstSpreadAdapter'];

// Unity BurstSpread is shape arc mode 3. Cocos 3.8.8 serializes the value but
// emits the whole burst at one angle, so the shared spread must be bound.
function burstSpreadSystems(builder) {
  return builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => {
    if (p?.__type__ !== 'cc.ParticleSystem') return false;
    const shape = builder.objects[p._shapeModule?.__id__];
    return !!shape && Number(shape.arcMode) === 3 && !!(shape._enable ?? shape.enable);
  });
}

function emitsContinuously(builder, particle) {
  return ['rateOverTime', 'rateOverDistance'].some((key) => {
    const curve = builder.objects[particle[key]?.__id__];
    return !!curve && !(Number(curve.mode ?? curve._mode ?? 0) === 0 && Number(curve.constant ?? 0) === 0);
  });
}

function stageBurstSpreadRuntime(options) {
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

function attachBurstSpreadRuntime(builder, reporter, options) {
  const particles = burstSpreadSystems(builder);
  if (!particles.length) return;
  stageBurstSpreadRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleBurstSpreadAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleBurstSpreadAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node.__id__]?._name || '';
    if (!classId) {
      reporter.high('PARTICLE_BURST_SPREAD_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleBurstSpreadAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id } }, null, `cmp-unity-burst-spread-${id}`);
    if (emitsContinuously(builder, p)) {
      reporter.medium('PARTICLE_BURST_SPREAD_RATE_UNMEASURED', options.src || '', name,
        'Burst Spread with rate emission spreads each emitted batch; only burst distribution is measured against Unity.');
    }
    reporter.low('PARTICLE_BURST_SPREAD_ADAPTER_BOUND', options.src || '', name,
      'Unity Burst Spread arc distribution attached; live visual acceptance still required.');
  }
}

module.exports = { burstSpreadSystems, stageBurstSpreadRuntime, attachBurstSpreadRuntime };
