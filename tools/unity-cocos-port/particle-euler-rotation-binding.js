'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleEulerRotation', 'UnityParticleEulerRotationAdapter'];

// Unity integrates rotation over lifetime per Euler component and renders Mesh
// and Local-billboard particles with Z-X-Y composition; View/Stretched/
// Horizontal/Vertical billboards only use the Z angle, where Cocos already
// matches. See fixtures/particle-rotation-over-lifetime-native.json.
function eulerRotationRequired(particle, objects) {
  const contract = particle?.unityRendererContract;
  if (!contract || !(contract.localBillboard || contract.worldBillboard || contract.mode === 4 || contract.mode===0&&contract.alignment===0&&particle.startRotation3D)) return false;
  const rotation = objects[particle._rotationOvertimeModule?.__id__];
  return !!(rotation?._enable ?? rotation?.enable);
}

function stageEulerRotationRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
  }
}

function attachEulerRotationRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id }))
    .filter(({ p }) => p?.__type__ === 'cc.ParticleSystem' && eulerRotationRequired(p, builder.objects));
  if (!particles.length) return;
  stageEulerRotationRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleEulerRotationAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleEulerRotationAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node?.__id__]?._name || '';
    if (!classId) {
      reporter.high('PARTICLE_EULER_ROTATION_ADAPTER_REQUIRED', options.src || '', name,
        'Unity rotation over lifetime integrates Euler components (Z-X-Y) for Mesh/Local billboards; AssetDB must import assets/script/UnityParticleEulerRotationAdapter.ts, then rerun porter.');
      continue;
    }
    const contract = p.unityRendererContract;
    builder.addComponent(p.node.__id__, classId, {
      source: { __id__: id },
      sourceContract: JSON.stringify({ renderer: contract.localBillboard ? 'local-billboard' : contract.worldBillboard ? 'world-billboard' : contract.mode===0 ? 'view-billboard-3d' : 'mesh', eulerSigns: contract.eulerSigns }),
    }, null, `cmp-unity-euler-rotation-${id}`);
    reporter.low('PARTICLE_EULER_ROTATION_ADAPTER_BOUND', options.src || '', name,
      'Unity Euler rotation-over-lifetime adapter attached; live preview acceptance still required.');
  }
}

module.exports = { eulerRotationRequired, stageEulerRotationRuntime, attachEulerRotationRuntime };
