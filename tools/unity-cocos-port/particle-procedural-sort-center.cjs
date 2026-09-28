'use strict';

const UNITY_GRAVITY = 9.81;

// Measured native procedural bounds, not the AABB of currently living particles.
// Deliberately bounded to Local/Hierarchy, full random arcs, unrotated shapes and
// motion-free modules. Unsupported contracts retain the dynamic bounds path.
// Constant gravity is accepted (Tanks! PowerUpEffect/Trails, Unity 6): Unity unites
// the envelope with its copy dropped by 0.5 * g * gravity * life^2 along world -Y,
// which moves the center by half the drop; see unityProceduralSortGravityDrop.
function proceduralSortContract(p) {
  const m=p.InitialModule,s=p.ShapeModule;
  if(!m||!s||p.moveWithTransform!==0||p.scalingMode!==0||p.ringBufferMode)return null;
  if(['VelocityModule','ForceModule','NoiseModule','CollisionModule','TriggerModule',
    'ExternalForcesModule','InheritVelocityModule','LifetimeByEmitterSpeedModule',
    'ClampVelocityModule','SubModule','TrailModule','SizeBySpeedModule',
    'RotationBySpeedModule','ColorBySpeedModule'].some(k=>p[k]?.enabled))return null;
  const g=m.gravityModifier,v=m.startSpeed,l=m.startLifetime;
  if(!g||g.minMaxState!==0||!Number.isFinite(g.scalar)||!v||!l||![0,3].includes(v.minMaxState)||![0,3].includes(l.minMaxState))return null;
  if(![v.scalar,l.scalar,...(v.minMaxState===3?[v.minScalar]:[]),...(l.minMaxState===3?[l.minScalar]:[])].every(Number.isFinite))return null;
  const life=Math.max(l.scalar,l.minMaxState===3?l.minScalar:l.scalar);
  if(!(life>=.0001))return null;
  const low=v.minMaxState===3?Math.min(v.scalar,v.minScalar):v.scalar;
  const high=v.minMaxState===3?Math.max(v.scalar,v.minScalar):v.scalar;
  const gravityDrop=.5*UNITY_GRAVITY*g.scalar*life*life;
  if(!s.enabled)return low===0&&high===0?{center:[0,0,0],gravityDrop}:null;
  if(s.arc?.value!==360||s.arc.mode!==0||s.randomDirectionAmount||s.sphericalDirectionAmount||s.randomPositionAmount||s.alignToDirection)return null;
  if(!['x','y','z'].every(k=>s.m_Rotation?.[k]===0&&Number.isFinite(s.m_Position?.[k])&&Number.isFinite(s.m_Scale?.[k])))return null;
  if(!Number.isFinite(s.radius?.value)||s.radius.value<0)return null;
  const center=[s.m_Position.x,s.m_Position.y,s.m_Position.z];
  if(s.type===0||s.type===10)return {center,gravityDrop};
  // Hemisphere: positions span z in [0, r*sz] and directions z in [0, 1], both
  // extreme at the pole, so speed extends the far end by high*life (near end by low*life).
  if(s.type===2){center[2]+=(s.radius.value*s.m_Scale.z+(Math.min(0,low)+Math.max(0,high))*life)/2;return {center,gravityDrop};}
  if(s.type===4){center[2]+=(Math.min(0,low)+Math.max(0,high))*life/2;return {center,gravityDrop};}
  return null;
}
function unityProceduralSortCenter(p){return proceduralSortContract(p)?.center||null;}
/** World -Y drop of the analytic envelope, 0 without gravity; null when the center is unsupported. */
function unityProceduralSortGravityDrop(p){const c=proceduralSortContract(p);return c?c.gravityDrop:null;}
module.exports={unityProceduralSortCenter,unityProceduralSortGravityDrop};
