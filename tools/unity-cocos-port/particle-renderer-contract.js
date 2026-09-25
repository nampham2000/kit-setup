'use strict';

// Geometry contracts measured with Unity ParticleSystemRenderer.BakeMesh.
// Local billboard rotations are clockwise; mesh rotations are not. Both are
// reflected through Z when crossing into Cocos. Never infer a ground plane
// from a node name, texture, or a single screenshot.
function particleRendererContract(particle = {}, renderer = {}) {
  const mode = Number(renderer.m_RenderMode ?? 0);
  const alignment = Number(renderer.m_RenderAlignment ?? 0);
  const localBillboard = mode === 0 && alignment === 2;
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
  const stretchedPivot = mode === 1 && Number(pivot.y || 0) !== 0;
  const unsupported = [];
  // Sorting is bound for every transparent renderer by particle-sorting-binding.
  const sorting = { fudge: Number(renderer.m_SortingFudge || 0), order: Number(renderer.m_SortingOrder || 0), layer: Number(renderer.m_SortingLayerID || 0), sortMode: Number(renderer.m_SortMode || 0) };
  if ((Number(pivot.x || 0) !== 0 || Number(pivot.z || 0) !== 0) || (mode !== 1 && Number(pivot.y || 0) !== 0)) unsupported.push('pivot-axes');
  if (alignment !== 0 && alignment !== 2 && !straightBoxVelocity && mode !== 1) unsupported.push('alignment');
  if ((localBillboard || mesh) && Number(particle.RotationModule?.enabled) === 1) unsupported.push('euler-rotation-over-lifetime');
  // Min/Max Particle Size (Unity defaults 0 and 0.5) are fractions of the
  // viewport WIDTH at the particle's view depth. BakeMesh: billboards scale
  // max(size.x, size.y) uniformly, stretched billboards clamp only the width,
  // mesh particles are never clamped. A stretched minimum is not measured.
  const sizeValue = (value, fallback) => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value));
  const sizeClamp = { min: sizeValue(renderer.m_MinParticleSize, 0), max: sizeValue(renderer.m_MaxParticleSize, 0.5) };
  if (mode === 1 && sizeClamp.min > 0) unsupported.push('stretched-min-particle-size');
  return {
    version: 2, sorting, mode, alignment, localBillboard, straightBoxVelocity,
    cocosAlignment: localBillboard || straightBoxVelocity || alignment === 2 ? 0 : alignment === 0 ? 2 : 1,
    eulerSigns: mesh ? [-1, -1, 1] : localBillboard ? [1, 1, -1] : [-1, 1, -1],
    // Horizontal/Vertical billboards need the source vertex program for Unity's
    // size/sqrt(2) corner geometry; builtin particle effects draw them at size.
    requiresMaterialAdapter: localBillboard || stretchedPivot || mesh || mode === 2 || mode === 3,
    sourceRendererPivot: [Number(pivot.x || 0), Number(pivot.y || 0), Number(pivot.z || 0), localBillboard ? 2 : 0],
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
