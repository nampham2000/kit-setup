'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('URP Lit emission texture is sampled instead of replacing it with flat grey', () => {
  const source = fs.readFileSync(path.join(__dirname, 'urp-lit.effect'), 'utf8');
  assert.match(source, /emissiveMap:\s*\{\s*value:\s*white\s*\}/);
  assert.match(source, /uniform sampler2D emissiveMap/);
  assert.match(source, /emissionContribution\s*\*=\s*SRGBToLinear\(texture\(emissiveMap,\s*v_uv\)\.rgb\)/);
  assert.doesNotMatch(source, /direct\s*\+\s*ambient\s*\+\s*emissive\.rgb/);
});

test('URP Lit can replay a bounded Unity light rig and calibrated output response', () => {
  const source = fs.readFileSync(path.join(__dirname, 'urp-lit.effect'), 'utf8');
  assert.match(source, /specularColor:\s*\{[^\n]*linear:\s*true/);
  assert.match(source, /#if USE_UNITY_SOURCE_LIGHT_RIG/);
  assert.match(source, /unityDirectSpecular/);
  assert.match(source, /unityDirectLight[\s\S]*unityLightDirection0/);
  assert.match(source, /unityDirectLight[\s\S]*unityLightDirection1/);
  assert.match(source, /unityTrilightAmbient/);
  assert.match(source, /unityOutputColorScale/);
  assert.match(source, /finalColor\s*=\s*\(direct\s*\+\s*ambient\s*\+\s*emissionContribution\)\s*\*\s*unityOutputColorScale\.rgb/);
});

test('URP Lit can preserve an HDR camera that has no Unity post-processing tone mapper', () => {
  const source = fs.readFileSync(path.join(__dirname, 'urp-lit.effect'), 'utf8');
  assert.match(source, /#if USE_UNITY_UNTONEMAPPED_OUTPUT[\s\S]*LinearToSRGB\(color\.rgb\)/);
  assert.match(source, /#else\s*\n\s*return CCFragOutput\(color\)/);
  assert.match(source, /return unityUrpFragOutput\(vec4\(finalColor, baseColor\.a\)\)/);
});

test('URP material port distinguishes regular colors from HDR emission', () => {
  const source = fs.readFileSync(path.join(__dirname, 'material-porter.js'), 'utf8');
  assert.match(source, /\(customShaderEffectUuid \|\| urpLit\)[\s\S]*\? unityColorToCocos/,
    'URP _BaseColor must retain authored sRGB bytes');
  assert.match(source, /props\.specularColor = unityColorToCocos/,
    'URP _SpecColor is a regular ShaderLab Color');
  assert.match(source, /props\.emissive = urpLit[\s\S]*\? unityLinearColorToCocos\(emissionColor\)/,
    'URP [HDR] _EmissionColor must be gamma-encoded once for a Cocos linear property');
  assert.match(source, /materialKeywords\.has\('_EMISSION'\)/,
    'URP emission is owned by its active local keyword');
});
