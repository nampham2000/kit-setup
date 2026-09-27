'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticlePrewarm', 'UnityParticlePrewarmAdapter'];

// Unity honours Prewarm only on looping systems and starts them in the steady
// state of the last lifetime-worth of cycles. Cocos serializes the flag but
// prewarms with one coarse step that drops those bursts.
function prewarmSystems(builder) {
  return builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => p?.__type__ === 'cc.ParticleSystem'
    && (p._prewarm ?? p.prewarm) === true && (p.loop ?? p._loop) === true);
}

function stagePrewarmRuntime(options) {
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

function attachPrewarmRuntime(builder, reporter, options) {
  const particles = prewarmSystems(builder);
  if (!particles.length) return;
  stagePrewarmRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticlePrewarmAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticlePrewarmAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node.__id__]?._name || '';
    if (!classId) {
      reporter.high('PARTICLE_PREWARM_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticlePrewarmAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id } }, null, `cmp-unity-prewarm-${id}`);
    reporter.low('PARTICLE_PREWARM_ADAPTER_BOUND', options.src || '', name,
      'Unity steady-state prewarm attached; live visual acceptance still required.');
  }
}

module.exports = { prewarmSystems, stagePrewarmRuntime, attachPrewarmRuntime };
