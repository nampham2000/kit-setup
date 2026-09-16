const test = require('node:test');
const assert = require('node:assert/strict');
const {normalization} = require('./unity-punctual-attenuation.cjs');
test('Unity LUT intensity survives Cocos photometric upload at different exposures', () => {
  for (const exposure of [0.000001, 0.00001, 0.001]) {
    for (const sourceAttenuation of [1, 0.38823529411764707, 0]) {
      const sourceIntensity = 3;
      const uploaded = sourceIntensity * 10000 * exposure * 10000;
      const diffuse = uploaded * sourceAttenuation * normalization(exposure) / Math.PI;
      assert.ok(Math.abs(diffuse - sourceIntensity * sourceAttenuation) < 1e-10);
      assert.ok(diffuse <= sourceIntensity + 1e-10, 'bounded source LUT cannot develop an inverse-square singularity');
    }
  }
});
