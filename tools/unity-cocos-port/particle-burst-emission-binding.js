'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleBurstEmission', 'UnityParticleBurstEmissionAdapter'];

// Unity emits every repeat of a burst; Cocos 3.8.8 Burst.update emits at most one
// per frame and loses the rest once repeats outpace frames. Every system with a
// repeating burst gets the shared catch-up (runtime/UnityParticleBurstEmission.ts,
// fixtures in particle-burst-emission.test.cjs).
function repeatingBurstSystems(builder) {
  return builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => p?.__type__ === 'cc.ParticleSystem'
    && (p.bursts || []).some((ref) => Number(builder.objects[ref?.__id__]?._repeatCount ?? 1) > 1));
}

function stageBurstEmissionRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

function attachBurstEmissionRuntime(builder, reporter, options) {
  const particles = repeatingBurstSystems(builder);
  if (!particles.length) return;
  stageBurstEmissionRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleBurstEmissionAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleBurstEmissionAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node.__id__]?._name || '';
    if (!classId) {
      reporter.high('PARTICLE_BURST_EMISSION_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleBurstEmissionAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id } }, null, `cmp-unity-burst-emission-${id}`);
  }
  reporter.low('PARTICLE_BURST_EMISSION_ADAPTER_BOUND', options.src || '', `${particles.length} system(s)`,
    'Unity repeating-burst catch-up attached; live visual acceptance still required.');
}

module.exports = { repeatingBurstSystems, stageBurstEmissionRuntime, attachBurstEmissionRuntime };
