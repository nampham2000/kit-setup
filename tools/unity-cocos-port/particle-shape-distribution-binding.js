'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleShapeDistribution', 'UnityParticleShapeDistributionAdapter'];

// Cocos ShapeModule shape types / emit locations (Cocos 3.8.8 enums).
const CIRCLE = 1, CONE = 2, SPHERE = 3, HEMISPHERE = 4;
const BASE = 0, VOLUME = 3;

// Unity samples Circle/Cone/Sphere/Hemisphere birth radii uniformly over area or volume;
// Cocos 3.8.8 draws the radius linearly, crowding particles near the shape centre
// (fixtures/shape-distribution-native.json). Every such emitter gets the shared remap.
function shapeDistributionSystems(builder) {
  return builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => {
    if (p?.__type__ !== 'cc.ParticleSystem') return false;
    const shape = builder.objects[p._shapeModule?.__id__];
    if (!shape || !(shape._enable ?? shape.enable)) return false;
    const type = Number(shape._shapeType ?? shape.shapeType);
    const from = Number(shape.emitFrom ?? 0);
    const applies = type === CIRCLE || (type === CONE && (from === BASE || from === VOLUME))
      || ((type === SPHERE || type === HEMISPHERE) && from === VOLUME);
    return applies && Number(shape.radius ?? 0) > 0 && Number(shape.radiusThickness ?? 1) > 0;
  });
}

function stageShapeDistributionRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

function attachShapeDistributionRuntime(builder, reporter, options) {
  const particles = shapeDistributionSystems(builder);
  if (!particles.length) return;
  stageShapeDistributionRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleShapeDistributionAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleShapeDistributionAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node.__id__]?._name || '';
    if (!classId) {
      reporter.high('PARTICLE_SHAPE_DISTRIBUTION_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleShapeDistributionAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id } }, null, `cmp-unity-shape-distribution-${id}`);
  }
  reporter.low('PARTICLE_SHAPE_DISTRIBUTION_ADAPTER_BOUND', options.src || '', `${particles.length} system(s)`,
    'Unity area/volume-uniform shape radius distribution attached; live visual acceptance still required.');
}

module.exports = { shapeDistributionSystems, stageShapeDistributionRuntime, attachShapeDistributionRuntime };
