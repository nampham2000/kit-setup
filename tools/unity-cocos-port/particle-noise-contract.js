'use strict';

// NoiseModule is not a scalar-to-scalar mapping. Keep the native curve data
// intact for an adapter; Cocos' builtin random position jitter is not curl noise.
function particleNoiseContract(particle = {}) {
  const source = particle.NoiseModule;
  if (!source || !source.enabled) return { version: 1, enabled: false };
  const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  return {
    version: 1, enabled: true, algorithm: 'unity-shuriken-curl',
    autoRandomSeed: particle.autoRandomSeed !== false && particle.autoRandomSeed !== 0,
    randomSeed: Number(particle.randomSeed || 0) >>> 0,
    quality: source.quality, separateAxes: !!source.separateAxes,
    frequency: source.frequency, damping: !!source.damping,
    octaves: source.octaves, octaveMultiplier: source.octaveMultiplier, octaveScale: source.octaveScale,
    strength: copy(source.strength), strengthY: copy(source.strengthY), strengthZ: copy(source.strengthZ),
    scrollSpeed: copy(source.scrollSpeed), positionAmount: copy(source.positionAmount),
    rotationAmount: copy(source.rotationAmount), sizeAmount: copy(source.sizeAmount),
    remapEnabled: !!source.remapEnabled, remap: copy(source.remap), remapY: copy(source.remapY), remapZ: copy(source.remapZ),
    integration: 'animated-velocity-before-limit',
    // A data contract is not evidence that an adapter is installed or accepted.
    requiresNativeValidatedAdapter: true,
  };
}

module.exports = { particleNoiseContract };
