'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleAlignToDirection', 'UnityParticleAlignToDirectionAdapter'];
const MESH_RENDER_MODE = 4;

// Unity ShapeModule.alignToDirection. Cocos 3.8.8 serializes the flag but never
// applies it, so every such emitter gets the shared runtime
// (runtime/UnityParticleAlignToDirection.ts, fixtures/align-to-direction.json).
function particleAlignToDirectionContract(particle = {}, renderer = {}) {
  const shape = particle.ShapeModule || {};
  return {
    enabled: Number(shape.enabled) === 1 && Number(shape.alignToDirection) === 1,
    mesh: Number(renderer.m_RenderMode) === MESH_RENDER_MODE,
    worldSpace: Number(particle.moveWithTransform) === 1,
  };
}

function stageAlignToDirectionRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

function attachAlignToDirectionRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id }))
    .filter(({ p }) => p?.__type__ === 'cc.ParticleSystem' && p.unityAlignToDirectionContract?.enabled);
  if (!particles.length) return;
  stageAlignToDirectionRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleAlignToDirectionAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleAlignToDirectionAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  let bound = 0;
  for (const { p, id } of particles) {
    const spec = p.unityAlignToDirectionContract;
    const name = builder.objects[p.node.__id__]?._name || '';
    if (!spec.mesh) {
      reporter.high('PARTICLE_ALIGN_TO_DIRECTION_UNMEASURED', options.src || '', name,
        'alignToDirection is only measured for mesh particles; billboards keep their unaligned rotation.');
      continue;
    }
    if (spec.worldSpace) {
      reporter.medium('PARTICLE_ALIGN_TO_DIRECTION_WORLD_SPACE', options.src || '', name,
        'alignToDirection uses the shape-local birth direction; world simulation space is unmeasured.');
    }
    if (!classId) {
      reporter.high('PARTICLE_ALIGN_TO_DIRECTION_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleAlignToDirectionAdapter.ts; refresh and rerun porter.');
      continue;
    }
    const eulerSigns = p.unityRendererContract?.eulerSigns || [-1, -1, 1];
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id }, sourceContract: JSON.stringify({ eulerSigns }) },
      null, `cmp-unity-align-to-direction-${id}`);
    bound++;
  }
  if (bound) {
    reporter.low('PARTICLE_ALIGN_TO_DIRECTION_BOUND', options.src || '', `${bound} system(s)`,
      'Unity alignToDirection pitch/yaw added to the start rotation; live visual acceptance still required.');
  }
}

module.exports = { particleAlignToDirectionContract, stageAlignToDirectionRuntime, attachAlignToDirectionRuntime };
