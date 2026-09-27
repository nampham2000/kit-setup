'use strict';

const fs = require('fs');
const path = require('path');

// Unity projects that cannot run built-in pipeline shaders under URP may bind
// their legacy materials to Assets/LegacyPreviewCompatibility shims. Only the
// serialized material state reaches the shim, so shader defaults apply to any
// property the original shader never saved (_TintColor = 1, _MainTex = white).
const LEGACY_PREVIEW_SHADERS = {
  'LegacyPreview/URP': { pass: 'OPAQUE', colorKey: '_Color' },
  'LegacyPreview/URP Effect': { pass: 'EFFECT', colorKey: '_TintColor' },
};
const LEGACY_PREVIEW_TECHNIQUES = { 'mesh-opaque': 0, 'mesh-effect': 1, 'particle-effect': 2, 'particle-opaque': 3 };
const LEGACY_PREVIEW_EFFECT_TEMPLATE = path.join(__dirname, 'legacy-preview-particle.effect');
const LEGACY_PREVIEW_EFFECT_PATH = path.join('assets', 'effects', 'unity-legacy-preview-particle.effect');

function legacyPreviewShader(shaderName) {
  return LEGACY_PREVIEW_SHADERS[String(shaderName || '').trim()] || null;
}

// URP draws only the first pass of a material whose LightMode matches, so the
// multi-pass LegacyPreview/URP shader renders its OPAQUE pass everywhere.
function legacyPreviewTechnique(shader, usage) {
  const particle = usage === 'particle';
  if (shader.pass === 'EFFECT') return LEGACY_PREVIEW_TECHNIQUES[particle ? 'particle-effect' : 'mesh-effect'];
  return LEGACY_PREVIEW_TECHNIQUES[particle ? 'particle-opaque' : 'mesh-opaque'];
}

function unityProjectRoot(unityRoot) {
  const root = path.resolve(String(unityRoot || ''));
  return path.basename(root).toLowerCase() === 'assets' ? path.dirname(root) : root;
}

function unityProjectIsLinear(unityRoot) {
  const file = path.join(unityProjectRoot(unityRoot), 'ProjectSettings', 'ProjectSettings.asset');
  if (!fs.existsSync(file)) return false;
  const match = /^\s*m_ActiveColorSpace:\s*(\d+)/m.exec(fs.readFileSync(file, 'utf8'));
  return Number(match?.[1]) === 1;
}

function unityTextureIsSrgb(textureAsset) {
  const metaFile = textureAsset?.path ? `${textureAsset.path}.meta` : '';
  if (!metaFile || !fs.existsSync(metaFile)) return true;
  const match = /^\s*sRGBTexture:\s*(\d+)/m.exec(fs.readFileSync(metaFile, 'utf8'));
  return match ? Number(match[1]) !== 0 : true;
}

function vec4(x, y, z, w) {
  return { __type__: 'cc.Vec4', x, y, z, w };
}

/**
 * @param {object} input
 * @param {{pass:string,colorKey:string}} input.shader
 * @param {'particle'|'mesh'} input.usage
 * @param {object} input.colors       serialized m_Colors map
 * @param {object|null} input.mainTexEnv serialized _MainTex texEnv entry
 * @param {string} input.textureUuid  Cocos texture uuid ('' keeps the white default)
 * @param {boolean} input.textureSrgb Unity TextureImporter sRGBTexture
 * @param {boolean} input.linear      Unity project uses Linear color space
 * @param {boolean} input.applyActiveColorSpace ParticleSystemRenderer flag
 * @param {number[]|null} input.sourceRendererPivot particle renderer adapter state
 * @param {number[]|null} input.sourceRendererSize particle renderer min/max size clamp
 */
function legacyPreviewMaterialData(input) {
  const { shader, usage, colors = {}, mainTexEnv = null, textureUuid = '', textureSrgb = true,
    linear = false, applyActiveColorSpace = true, sourceRendererPivot = null, sourceRendererSize = null, name = '', effectUuid } = input;
  const color = colors[shader.colorKey] || { r: 1, g: 1, b: 1, a: 1 };
  const scale = mainTexEnv?.m_Scale || { x: 1, y: 1 };
  const offset = mainTexEnv?.m_Offset || { x: 0, y: 0 };
  const props = {
    unityColor: vec4(Number(color.r ?? 1), Number(color.g ?? 1), Number(color.b ?? 1), Number(color.a ?? 1)),
    unityColorSpace: vec4(
      linear && textureUuid && textureSrgb ? 1 : 0,
      linear && usage === 'particle' && applyActiveColorSpace ? 1 : 0,
      linear ? 1 : 0,
      linear ? 1 : 0,
    ),
    mainTiling_Offset: vec4(Number(scale.x ?? 1), Number(scale.y ?? 1), Number(offset.x ?? 0), Number(offset.y ?? 0)),
  };
  if (textureUuid) props.mainTexture = { __uuid__: textureUuid, __expectedType__: 'cc.Texture2D' };
  if (usage === 'particle' && sourceRendererPivot) props.sourceRendererPivot = vec4(...sourceRendererPivot.map(Number));
  if (usage === 'particle' && sourceRendererSize) props.sourceRendererSize = vec4(...sourceRendererSize.map(Number));
  return {
    __type__: 'cc.Material',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: { __uuid__: effectUuid, __expectedType__: 'cc.EffectAsset' },
    _techIdx: legacyPreviewTechnique(shader, usage),
    _defines: [{}],
    _states: [],
    _props: [props],
  };
}

module.exports = {
  LEGACY_PREVIEW_EFFECT_PATH,
  LEGACY_PREVIEW_EFFECT_TEMPLATE,
  LEGACY_PREVIEW_TECHNIQUES,
  legacyPreviewShader,
  legacyPreviewTechnique,
  legacyPreviewMaterialData,
  unityProjectIsLinear,
  unityTextureIsSrgb,
};
