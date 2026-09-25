'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BUILTIN_PARTICLE_MATERIALS,
  resolveUnityParticleSemantics,
  unityParticleMaterialData,
  evaluateUnityParticleFragment,
  blendUnityParticle,
  srgbToLinear,
  linearToSrgb,
  techniqueFromBlend,
} = require('./unity-particle-material');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/unity-particle-oracle-tanks.json'), 'utf8'));
const BUILTIN = '0000000000000000f000000000000000';

// Unity-space vectors: billboard normal faces the camera, the light direction points towards the light.
function unityForward([x, y]) {
  const r = Math.PI / 180;
  return [Math.sin(y * r) * Math.cos(x * r), -Math.sin(x * r), Math.cos(y * r) * Math.cos(x * r)];
}

function materialInput(name) {
  const builtinId = Object.keys(BUILTIN_PARTICLE_MATERIALS).find((id) => BUILTIN_PARTICLE_MATERIALS[id].name === name);
  if (builtinId) {
    const builtin = BUILTIN_PARTICLE_MATERIALS[builtinId];
    return { shaderGuid: BUILTIN, shaderFileId: builtin.shaderFileId, shaderName: '', floats: builtin.floats, colors: builtin.colors, keywords: new Set() };
  }
  const entry = fixture.materials[name];
  return { ...entry, keywords: new Set(entry.keywords) };
}

function lightRigProps() {
  const light = fixture.oracle.lights[0];
  const amb = fixture.oracle.ambient;
  const vec = (x, y, z, w) => ({ __type__: 'cc.Vec4', x, y, z, w });
  return {
    unityLightDirection0: vec(-light.forward[0], -light.forward[1], -light.forward[2], 0),
    unityLightColor0: vec(...light.color, 1),
    unityLightIntensities: vec(light.intensity, 0, 0, 0),
    unityAmbientSky: vec(...amb.color, 1),
    unityAmbientEquator: vec(...amb.color, 1),
    unityAmbientGround: vec(...amb.color, 1),
    unityAmbientParams: vec(amb.intensity, 0, 0, 0),
  };
}

test('Unity blend factor pairs map onto unity-particle techniques', () => {
  assert.equal(techniqueFromBlend(5, 10), 'alpha');
  assert.equal(techniqueFromBlend(1, 10), 'premultiply');
  assert.equal(techniqueFromBlend(5, 1), 'additive');
  assert.equal(techniqueFromBlend(2, 0), 'multiply');
  assert.equal(techniqueFromBlend(1, 0), 'opaque');
  assert.equal(techniqueFromBlend(7, 7), null);
});

test('Unity 6 invalid _ALPHABLEND_ON keyword does not decide the blend; _SrcBlend/_DstBlend do', () => {
  const gray = materialInput('Particle_Explosion_Gray');
  const semantics = resolveUnityParticleSemantics(gray);
  assert.equal(semantics.technique, 'alpha');
  assert.equal(semantics.lighting, 'lit');
  assert.equal(semantics.vertexColor, 0, 'URP Lit ignores particle vertex colours');
  assert.equal(semantics.emission, true);
  const brown = resolveUnityParticleSemantics(materialInput('Demo_Explosion_Brown'));
  assert.equal(brown.lighting, 'simpleLit');
  assert.equal(brown.emission, false, 'saved _EmissionColor is dormant without the _EMISSION keyword');
  assert.equal(resolveUnityParticleSemantics(materialInput('Default-Particle')).formula, 'legacyPremultiply');
});

test('unity-particle model reproduces every Unity oracle sample (linear blending) within 2/255', () => {
  const { cameraEuler, colorSpace } = fixture.oracle;
  const normal = unityForward(cameraEuler).map((v) => -v);
  let worst = { error: 0 };
  for (const material of fixture.oracle.materials) {
    const input = materialInput(material.name);
    const semantics = resolveUnityParticleSemantics(input);
    const data = unityParticleMaterialData({ semantics, colors: input.colors, textureUuid: '', linear: colorSpace === 'Linear', effectUuid: 'fixture' });
    const props = { ...data._props[0], ...lightRigProps() };
    for (const sample of material.samples.filter((s) => s.tex === 'white')) {
      const src = evaluateUnityParticleFragment(props, { vertexColor: sample.vc, texel: [1, 1, 1, 1], normal, viewDirection: normal });
      const dst = sample.bg.map(srgbToLinear);
      const out = blendUnityParticle(semantics.technique, src, dst).map((c) => Math.round(linearToSrgb(Math.min(Math.max(c, 0), 1)) * 255));
      const error = Math.max(...out.map((c, i) => Math.abs(c - sample.out[i])));
      if (error > worst.error) worst = { error, material: material.name, sample, out };
    }
  }
  assert.ok(worst.error <= 2, `worst ${worst.error}/255 on ${worst.material}: ${JSON.stringify(worst)}`);
});
