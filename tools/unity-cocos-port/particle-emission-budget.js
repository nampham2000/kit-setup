'use strict';

// Bound arrivals in any time window, including delayed sub-emitter births.
// Input nodes are the live Unity closure (particleSubEmitters resolves owners).
function emissionBudget(nodes, targetPath, window, upper, visiting = new Set()) {
  if (!(window >= 0) || visiting.has(targetPath)) throw new Error('Invalid/cyclic particle emission budget: ' + targetPath);
  const node = nodes.find(n => n.path === targetPath);
  const component = node?.components.find(c => c.type === 'UnityEngine.ParticleSystem');
  if (!component) throw new Error('Missing particle budget owner: ' + targetPath);
  const p = JSON.parse(component.json).ParticleSystem;
  const e = p.EmissionModule;
  if (!e?.enabled) return 0;
  const parents = [];
  for (const owner of nodes) for (const c of owner.components) {
    for (const link of c.particleSubEmitters || []) if (link.path === targetPath) parents.push({owner, link});
  }
  const next = new Set(visiting); next.add(targetPath);
  if (parents.length) {
    if (upper(e.rateOverTime) !== 0 || upper(e.rateOverDistance) !== 0) throw new Error('Continuous sub-emitter budget requires an emission-duration contract');
    const bursts = e.m_Bursts || [];
    let count = 0, first = Infinity, last = -Infinity;
    for (const b of bursts) {
      if (!(b.cycleCount > 0)) throw new Error('Unbounded sub-emitter burst');
      count += Math.ceil(upper(b.countCurve)) * b.cycleCount;
      first = Math.min(first, b.time);
      last = Math.max(last, b.time + (b.cycleCount - 1) * b.repeatInterval);
    }
    if (!count) return 0;
    return parents.reduce((sum, {owner, link}) => {
      if (link.type !== 0 || link.probability !== 1) throw new Error('Unsupported sub-emitter trigger budget: ' + targetPath);
      return sum + count * emissionBudget(nodes, owner.path, window + last - first, upper, next);
    }, 0);
  }
  if (upper(e.rateOverDistance) !== 0) throw new Error('Distance emission needs an emitter-distance budget');
  const events = [];
  const duration = p.lengthInSec;
  if (!(duration > 0)) throw new Error('Invalid emitter duration');
  const cycles = p.looping ? Math.ceil(window / duration) + 2 : 1;
  for (let cycle = 0; cycle < cycles; cycle++) for (const b of e.m_Bursts || []) {
    if (!(b.cycleCount > 0)) throw new Error('Unbounded root burst');
    for (let i = 0; i < b.cycleCount; i++) {
      const time = b.time + i * b.repeatInterval;
      if (time > duration) break;
      events.push({time: cycle * duration + time, count: Math.ceil(upper(b.countCurve))});
      if (events.length > 100000) throw new Error('Particle budget schedule exceeds bounded analysis');
    }
  }
  events.sort((a,b) => a.time-b.time);
  let left=0, sum=0, peak=0;
  for (let right=0; right<events.length; right++) {
    sum += events[right].count;
    while (events[right].time-events[left].time > window+1e-7) sum -= events[left++].count;
    peak = Math.max(peak,sum);
  }
  const rate = upper(e.rateOverTime);
  return peak + (rate > 0 ? Math.ceil(rate*window)+1 : 0);
}

module.exports = {emissionBudget};
