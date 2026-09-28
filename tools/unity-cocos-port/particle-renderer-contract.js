'use strict';
const {unityProceduralSortCenter,unityProceduralSortGravityDrop}=require("./particle-procedural-sort-center.cjs");

// World width (m) of the narrowest view in which a Min/Max Particle Size clamp is expected to bind.
const CLAMP_REFERENCE_VIEW_WIDTH = 2;

// Largest value a serialized MinMaxCurve can take (constants, two constants, curve keys x scalar).
function minMaxCurveUpperBound(curve) {
  if (!curve) return 0;
  const state = Number(curve.minMaxState ?? 0);
  const scalar = Number(curve.scalar ?? 0);
  if (state === 0) return Math.abs(scalar);
  if (state === 3) return Math.max(Math.abs(scalar), Math.abs(Number(curve.minScalar ?? 0)));
  const keys = [curve.maxCurve, state === 2 ? curve.minCurve : null]
    .flatMap(c => (c && Array.isArray(c.m_Curve) ? c.m_Curve : []))
    .map(key => Math.abs(Number(key.value))).filter(Number.isFinite);
  return Math.abs(scalar) * (keys.length ? Math.max(...keys) : 1);
}

// Upper bound of a particle's rendered world size: start size (largest axis) x Size over Lifetime.
function particleWorldSizeUpperBound(particle = {}) {
  const initial = particle.InitialModule;
  if (!initial) return 0;
  const axes = [initial.startSize];
  if (Number(initial.size3D) === 1) axes.push(initial.startSizeY, initial.startSizeZ);
  let size = Math.max(0, ...axes.map(minMaxCurveUpperBound));
  const module = particle.SizeModule;
  if (module && Number(module.enabled) === 1) size *= minMaxCurveUpperBound(module.curve);
  return size;
}

// Geometry contracts measured with Unity ParticleSystemRenderer.BakeMesh.
// Local billboard rotations are clockwise; mesh rotations are not. Both are
// reflected through Z when crossing into Cocos. Never infer a ground plane
// from a node name, texture, or a single screenshot.
function particleRendererContract(particle = {}, renderer = {}) {
  const mode = Number(renderer.m_RenderMode ?? 0);
  const alignment = Number(renderer.m_RenderAlignment ?? 0);
  const localBillboard = mode === 0 && alignment === 2;
  const worldBillboard = mode === 0 && alignment === 1;
  const mesh = mode === 4;
  const pivot = renderer.m_Pivot || {};
  const shape = particle.ShapeModule || {}, initial = particle.InitialModule || {};
  const constant = (curve, value) => !!curve && Number(curve.minMaxState ?? 0) === 0 && Number(curve.scalar) === value;
  const straightBoxVelocity = mesh && alignment === 4 && Number(shape.enabled) === 1 && Number(shape.type) === 5
    && Number(shape.randomDirectionAmount) === 0 && Number(shape.sphericalDirectionAmount) === 0
    && !!shape.m_Rotation && ['x', 'y', 'z'].every(axis => Number(shape.m_Rotation[axis]) === 0)
    && Number(initial.startSpeed?.minMaxState) === 0 && Number(initial.startSpeed?.scalar) > 0
    && constant(initial.gravityModifier, 0)
    && ['VelocityModule', 'ForceModule', 'NoiseModule'].every(key => particle[key] && Number(particle[key].enabled) === 0);
  const stretched = mode === 1;
  // BakeMesh (fixtures/particle-pivot-alignment-native.json): View billboards move by
  // pivot*size in their rotated camera plane and by pivot.z*size.x toward the camera;
  // Mesh vertices are offset by pivot*mesh bounds (Unity negates Z) before size and
  // rotation. Mesh World alignment ignores the emitter rotation; Mesh Velocity alignment
  // is LookRotation(total world velocity, world up) followed by rotation3D.
  const pivotValues = [Number(pivot.x || 0), Number(pivot.y || 0), Number(pivot.z || 0)];
  const pivotSet = pivotValues.some(value => value !== 0);
  const viewBillboard = mode === 0 && alignment === 0;
  // Native billboard-frames BakeMesh: axial render modes ignore the alignment
  // enum and emitter rotation. Vertical still tracks camera yaw; Horizontal
  // stays in the world XZ plane. Do not classify their World enum as a gap.
  const axialBillboard = mode === 2 || mode === 3;
  const meshWorldFrame = mesh && alignment === 1;
  const meshVelocityFrame = mesh && alignment === 4 && !straightBoxVelocity;
  const unsupported = [];
  // Sorting is bound for every transparent renderer by particle-sorting-binding.
  const sorting = { fudge: Number(renderer.m_SortingFudge || 0), order: Number(renderer.m_SortingOrder || 0), layer: Number(renderer.m_SortingLayerID || 0), sortMode: Number(renderer.m_SortMode || 0) };
  const proceduralCenter=unityProceduralSortCenter(particle);
  if(proceduralCenter){sorting.proceduralCenter=proceduralCenter;const drop=unityProceduralSortGravityDrop(particle);if(drop)sorting.proceduralGravityDrop=drop;}
  // Local/axial billboard pivots, stretched X/Z pivots, Facing and billboard Velocity are unmeasured.
  if (pivotSet && !(mesh || viewBillboard || (mode === 1 && pivotValues[0] === 0 && pivotValues[2] === 0))) unsupported.push('pivot-axes');
  if (alignment !== 0 && alignment !== 2 && !worldBillboard && !straightBoxVelocity && mode !== 1 && !axialBillboard && !meshWorldFrame && !meshVelocityFrame) unsupported.push('alignment');
  if(mode===3)unsupported.push('vertical-camera-frame');
  if ((localBillboard || mesh) && Number(particle.RotationModule?.enabled) === 1) unsupported.push('euler-rotation-over-lifetime');
  // Min/Max Particle Size (Unity defaults 0 and 0.5) are fractions of the
  // viewport WIDTH at the particle's view depth. BakeMesh: billboards scale
  // max(size.x, size.y) uniformly, stretched billboards clamp only the width,
  // mesh particles are never clamped. A stretched minimum is not measured.
  const sizeValue = (value, fallback) => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value));
  const sizeClamp = { min: sizeValue(renderer.m_MinParticleSize, 0), max: sizeValue(renderer.m_MaxParticleSize, 0.5) };
  if (mode === 1 && sizeClamp.min > 0) unsupported.push('stretched-min-particle-size');
  // The clamp binds wherever a particle is wider than max x the viewport width at its depth,
  // which the port cannot bound statically. View/Facing billboards and stretched particles
  // that exceed max x CLAMP_REFERENCE_VIEW_WIDTH are routed through the source effect (its
  // default View billboard path matches the builtin one and adds the measured clamp), e.g.
  // JellyCubeRun2048 ParHitEffect: Blast size 25 / circle 10 with max 0.3, which the builtin
  // effect drew over the whole screen. Small particles keep the builtin effect.
  const sizeBound = particleWorldSizeUpperBound(particle);
  const clampReachable = (mode === 0 && (alignment === 0 || alignment === 3) || mode === 1)
    && sizeBound > sizeClamp.max * CLAMP_REFERENCE_VIEW_WIDTH;
  return {
    version: 4, sorting, mode, alignment, localBillboard, worldBillboard, straightBoxVelocity,
    meshScalarAxis: mesh && alignment===2 && !initial.rotation3D && !particle.RotationModule?.enabled
      && particle.moveWithTransform===0 && shape.enabled && shape.type===0 && shape.radius?.value>0
      && !shape.alignToDirection && !shape.randomDirectionAmount && !shape.sphericalDirectionAmount && !shape.randomPositionAmount
      && shape.arc?.mode===0 && (shape.arc.spread??0)===0 && ['x','y','z'].every(k=>shape.m_Rotation?.[k]===0),
    cocosAlignment: localBillboard || straightBoxVelocity || alignment === 2 ? 0 : alignment === 0 ? 2 : 1,
    eulerSigns: mesh ? [-1, -1, 1] : localBillboard || worldBillboard ? [1, 1, -1] : viewBillboard ? [-1, -1, -1] : [-1, 1, -1],
    // Horizontal/Vertical billboards need the source vertex program for Unity's
    // size/sqrt(2) corner geometry; builtin particle effects draw them at size.
    requiresMaterialAdapter: localBillboard || worldBillboard || stretched || mesh || mode === 2 || mode === 3 || (viewBillboard && pivotSet) || clampReachable,
    clampReachable,
    // w: 2 Local billboard; 3 Mesh rotation already in world space (World alignment,
    // or the Velocity frame written by UnityParticleMeshFrameAdapter).
    sourceRendererPivot: [...pivotValues, localBillboard ? 2 : worldBillboard ? 4 : meshWorldFrame || meshVelocityFrame ? 3 : 0],
    // Runtime state a material cannot carry: mesh bounds for the pivot, per-particle Velocity frame.
    meshFrame: mesh && (pivotSet || meshVelocityFrame) ? { pivot: pivotSet, velocity: meshVelocityFrame } : null,
    // Unity linearizes particle vertex colors in a Linear project unless the
    // renderer opts out; the default for new renderers is on.
    applyActiveColorSpace: renderer.m_ApplyActiveColorSpace === undefined ? true : Number(renderer.m_ApplyActiveColorSpace) !== 0,
    // Vertex-program state: x=min, y=max, w=1 enables (the effect default w=0
    // leaves materials written before this contract unclamped).
    sizeClamp, sourceRendererSize: [sizeClamp.min, sizeClamp.max, 0, 1],
    unsupported,
  };
}

module.exports = { particleRendererContract };
