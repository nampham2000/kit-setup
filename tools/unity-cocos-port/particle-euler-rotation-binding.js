'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleEulerRotation', 'UnityParticleEulerRotationAdapter'];

// Unity integrates rotation over lifetime per Euler component and renders Mesh
// and Local-billboard particles with Z-X-Y composition; View/Stretched/
// Horizontal/Vertical billboards only use the Z angle. Their deterministic
// composition matches, but View billboard TwoConstants still needs the native
// retained RNG channel (Electro Charge exposed the missing binding).
function eulerRotationRequired(particle, objects) {
  const contract = particle?.unityRendererContract;
  const rotation = objects[particle._rotationOvertimeModule?.__id__];
  const planarRandom = contract?.mode===0 && contract.alignment===0 && objects[rotation?.z?.__id__]?.mode===3;
  if (!contract || !(contract.localBillboard || contract.worldBillboard || contract.mode === 4 || contract.mode===0&&contract.alignment===0&&particle.startRotation3D || planarRandom)) return false;
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
        'Unity rotation over lifetime requires native Euler composition or retained RNG; AssetDB must import assets/script/UnityParticleEulerRotationAdapter.ts, then rerun porter.');
      continue;
    }
    const contract = p.unityRendererContract;
    const shape = builder.objects[p._shapeModule?.__id__];
    const aligned = !!shape?.alignToDirection;
    const shapeAlignment = aligned && contract.mode === 4 && p._simulationSpace === 1 && (shape._shapeType ?? shape.shapeType) === 3;
    if (aligned && !shapeAlignment) reporter.high('PARTICLE_SHAPE_ALIGNMENT_UNMEASURED', options.src || '', name,
      'Align to Direction is measured only for Local Sphere Mesh with Euler rotation enabled.');
    builder.addComponent(p.node.__id__, classId, {
      source: { __id__: id },
      sourceContract: JSON.stringify({ renderer: contract.localBillboard ? 'local-billboard' : contract.worldBillboard ? 'world-billboard' : contract.mode===0 ? (p.startRotation3D ? 'view-billboard-3d' : 'view-billboard') : 'mesh', eulerSigns: contract.eulerSigns, ...(shapeAlignment ? {shapeAlignment:true} : {}) }),
    }, null, `cmp-unity-euler-rotation-${id}`);
    reporter.low('PARTICLE_EULER_ROTATION_ADAPTER_BOUND', options.src || '', name,
      'Unity Euler rotation-over-lifetime adapter attached; live preview acceptance still required.');
  }
}

module.exports = { eulerRotationRequired, stageEulerRotationRuntime, attachEulerRotationRuntime };
