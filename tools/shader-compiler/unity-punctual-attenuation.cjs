'use strict';

// Creator 3.8.x additive-light queue uploads luminance * exposure * 10000.
// This adapter is opt-in for Built-in Unity LUT-backed lights, not URP/HDRP.
function normalization(exposure, intensityScale = 10000, lightMeterScale = 10000) {
  if (!(exposure > 0 && intensityScale > 0 && lightMeterScale > 0)) throw new Error('Positive exposure and light scales are required');
  return Math.PI / (exposure * intensityScale * lightMeterScale);
}

function shaderSource({intensityScale = 10000, lightMeterScale = 10000} = {}) {
  normalization(1, intensityScale, lightMeterScale);
  return `
  uniform sampler2D unityAttenuation;
  float UnityDistanceAttenuation(float distanceSquared, float lightRange) {
    float normalizedSquared=distanceSquared/max(lightRange*lightRange,0.0001);
    if(normalizedSquared>=1.0)return 0.0;
    float sourceAttenuation=texture(unityAttenuation,vec2(normalizedSquared,0.5)).r;
    // Unity Standard diffuse omits the 1/PI factor used by Cocos Standard.
    return sourceAttenuation*3.14159265359/max(${(intensityScale * lightMeterScale).toFixed(1)}*cc_exposure.x,0.000001);
  }
`;
}

module.exports = {normalization, shaderSource};
