'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleMeshFrame', 'UnityParticleMeshFrameAdapter'];

// Mesh particle pivots are in mesh-bounds units and Velocity alignment is a per-particle
// LookRotation of the world velocity (fixtures/particle-pivot-alignment-native.json);
// both need runtime state that a material cannot carry. See particle-renderer-contract.js.
function meshFrameRequired(particle) {
  return !!particle?.unityRendererContract?.meshFrame;
}

function stageMeshFrameRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
  }
}

function attachMeshFrameRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id }))
    .filter(({ p }) => p?.__type__ === 'cc.ParticleSystem' && meshFrameRequired(p));
  if (!particles.length) return;
  stageMeshFrameRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleMeshFrameAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleMeshFrameAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node?.__id__]?._name || '';
    if (!classId) {
      reporter.high('PARTICLE_MESH_FRAME_ADAPTER_REQUIRED', options.src || '', name,
        'Unity mesh pivot (mesh-bounds units) or Velocity alignment needs assets/script/UnityParticleMeshFrameAdapter.ts imported by AssetDB; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, {
      source: { __id__: id },
      sourceContract: JSON.stringify(p.unityRendererContract.meshFrame),
    }, null, `cmp-unity-mesh-frame-${id}`);
    reporter.low('PARTICLE_MESH_FRAME_ADAPTER_BOUND', options.src || '', name,
      'Unity mesh pivot bounds and/or Velocity frame adapter attached; live preview acceptance still required.');
  }
}

module.exports = { meshFrameRequired, stageMeshFrameRuntime, attachMeshFrameRuntime };
