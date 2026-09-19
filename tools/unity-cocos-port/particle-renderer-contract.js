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
  if ((Number(pivot.x || 0) !== 0 || Number(pivot.z || 0) !== 0) || (mode !== 1 && Number(pivot.y || 0) !== 0)) unsupported.push('pivot-axes');
  if (alignment !== 0 && alignment !== 2 && !straightBoxVelocity && mode !== 1) unsupported.push('alignment');
  if ((localBillboard || mesh) && Number(particle.RotationModule?.enabled) === 1) unsupported.push('euler-rotation-over-lifetime');
  return {
    version: 1, mode, alignment, localBillboard, straightBoxVelocity,
    cocosAlignment: localBillboard || straightBoxVelocity || alignment === 2 ? 0 : alignment === 0 ? 2 : 1,
    eulerSigns: mesh ? [-1, -1, 1] : localBillboard ? [1, 1, -1] : [-1, 1, -1],
    requiresMaterialAdapter: localBillboard || stretchedPivot || mesh,
    sourceRendererPivot: [Number(pivot.x || 0), Number(pivot.y || 0), Number(pivot.z || 0), localBillboard ? 2 : 0],
    unsupported,
  };
}

module.exports = { particleRendererContract };
