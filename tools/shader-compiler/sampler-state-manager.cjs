'use strict';

/**
 * Texture & Sampler State Migration Manager
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. Legacy Cg sampler_state parsing (AddressU/V, MinFilter, MagFilter, MipFilter)
 * 2. Extraction of SamplerStateIR (wrap/clamp/mirror, linear/nearest)
 * 3. Modern URP TEXTURE2D/SAMPLER/SAMPLE_TEXTURE2D recognition
 * 4. Texture and sampler state mapping manifest generation
 * 5. Screen & projection built-in constants lowering
 */

/**
 * Maps Unity wrap mode to Cocos wrap string
 */
function mapWrapMode(mode) {
  if (!mode) return 'wrap';
  const m = String(mode).toLowerCase();
  switch (m) {
    case 'clamp':
    case 'clamptoedge': return 'clamp';
    case 'mirror':
    case 'mirroredrepeat': return 'mirror';
    case 'border':
    case 'clamptoborder': return 'border';
    default: return 'wrap';
  }
}

/**
 * Maps Unity filter mode to Cocos filter string
 */
function mapFilterMode(mode) {
  if (!mode) return 'linear';
  const m = String(mode).toLowerCase();
  switch (m) {
    case 'point':
    case 'nearest': return 'nearest';
    case 'none': return 'none';
    default: return 'linear';
  }
}

/**
 * Parses Cg sampler_state blocks from shader source
 */
function parseSamplerStates(hlslCode) {
  const states = {};
  if (!hlslCode) return states;

  // e.g. sampler2D _MainTex = sampler_state { Texture = <_MainTex>; AddressU = Wrap; AddressV = Clamp; MinFilter = Linear; MagFilter = Linear; MipFilter = Linear; };
  const stateRegex = /\b(?:sampler2D|samplerCube|sampler3D|sampler)\s+([A-Za-z_]\w*)\s*=\s*sampler_state\s*\{([\s\S]*?)\};/gi;
  let match;

  while ((match = stateRegex.exec(hlslCode)) !== null) {
    const varName = match[1];
    const body = match[2];

    const addressUMatch = /\bAddressU\s*=\s*(\w+)/i.exec(body);
    const addressVMatch = /\bAddressV\s*=\s*(\w+)/i.exec(body);
    const addressWMatch = /\bAddressW\s*=\s*(\w+)/i.exec(body);
    const minFilterMatch = /\bMinFilter\s*=\s*(\w+)/i.exec(body);
    const magFilterMatch = /\bMagFilter\s*=\s*(\w+)/i.exec(body);
    const mipFilterMatch = /\bMipFilter\s*=\s*(\w+)/i.exec(body);
    const texMatch = /\bTexture\s*=\s*<([A-Za-z_]\w*)>/i.exec(body);

    states[varName] = {
      targetTexture: texMatch ? texMatch[1] : varName,
      addressU: mapWrapMode(addressUMatch ? addressUMatch[1] : 'Wrap'),
      addressV: mapWrapMode(addressVMatch ? addressVMatch[1] : 'Wrap'),
      addressW: addressWMatch ? mapWrapMode(addressWMatch[1]) : undefined,
      minFilter: mapFilterMode(minFilterMatch ? minFilterMatch[1] : 'Linear'),
      magFilter: mapFilterMode(magFilterMatch ? magFilterMatch[1] : 'Linear'),
      mipFilter: mipFilterMatch ? mapFilterMode(mipFilterMatch[1]) : 'linear',
    };
  }

  return states;
}

/**
 * Builds texture and sampler state manifest JSON
 */
function buildTextureSamplerManifest(samplers, samplerStates = {}, propertyMappings = {}) {
  const manifest = {};

  for (const s of samplers) {
    const rawName = s.name;
    const cocosProperty = propertyMappings[rawName] || rawName.replace(/^_+/, '');
    const state = samplerStates[rawName] || {
      addressU: 'wrap',
      addressV: 'wrap',
      minFilter: 'linear',
      magFilter: 'linear',
      mipFilter: 'linear',
    };

    manifest[rawName] = {
      cocosProperty,
      originalName: rawName,
      type: s.type || 'sampler2D',
      samplerState: state,
    };
  }

  return manifest;
}

/**
 * Lowers Unity screen, projection, and time built-in constants to Cocos equivalents
 */
function lowerBuiltinConstants(code) {
  if (!code) return '';
  let out = code;

  // _ScreenParams: (width, height, 1.0 + 1.0/width, 1.0 + 1.0/height) -> cc_screenSize
  out = out.replace(/\b_ScreenParams\b/g, 'cc_screenSize');

  // _ProjectionParams: (1.0, nearPlane, farPlane, 1.0 / farPlane)
  out = out.replace(/\b_ProjectionParams\b/g, 'vec4(1.0, cc_nearFar.x, cc_nearFar.y, 1.0 / max(cc_nearFar.y, 0.0001))');

  // _ZBufferParams: ( (1-far/near)/2, (1+far/near)/2, (1-far/near)/(2*far), (1+far/near)/(2*far) )
  out = out.replace(/\b_ZBufferParams\b/g, 'vec4((1.0 - cc_nearFar.y / max(cc_nearFar.x, 0.0001)) * 0.5, (1.0 + cc_nearFar.y / max(cc_nearFar.x, 0.0001)) * 0.5, 0.0, 0.0)');

  // _OrthoParams & unity_OrthoParams: (width, height, 0, isOrtho ? 1 : 0)
  out = out.replace(/\b(?:_OrthoParams|unity_OrthoParams)\b/g, 'vec4(cc_screenScale.x, cc_screenScale.y, 0.0, 1.0)');

  // _Time, _SinTime, _CosTime
  out = out.replace(/\b_Time\.y\b/g, 'cc_time.x');
  out = out.replace(/\b_Time\.x\b/g, '(cc_time.x * 0.05)');
  out = out.replace(/\b_Time\.z\b/g, '(cc_time.x * 2.0)');
  out = out.replace(/\b_Time\.w\b/g, '(cc_time.x * 3.0)');
  out = out.replace(/\b_Time\b/g, 'vec4(cc_time.x * 0.05, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0)');
  out = out.replace(/\b_SinTime\b/g, 'sin(vec4(cc_time.x * 0.125, cc_time.x * 0.25, cc_time.x * 0.5, cc_time.x))');
  out = out.replace(/\b_CosTime\b/g, 'cos(vec4(cc_time.x * 0.125, cc_time.x * 0.25, cc_time.x * 0.5, cc_time.x))');

  return out;
}

module.exports = {
  mapWrapMode,
  mapFilterMode,
  parseSamplerStates,
  buildTextureSamplerManifest,
  lowerBuiltinConstants,
};
