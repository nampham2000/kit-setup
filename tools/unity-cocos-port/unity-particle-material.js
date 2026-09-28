'use strict';

// Maps a Unity particle material (shader family, blend floats, active keywords, colours) onto the
// unity-particle.effect contract. Evidence: tools/port/unity-particle-material-oracle.cs renders one particle per
// material in Unity 6 (Linear, URP) and pins the formulas below; see unity-particle.effect for the shader side.

const path = require('path');

const UNITY_PARTICLE_EFFECT_TEMPLATE = path.join(__dirname, 'unity-particle.effect');
// Cocos only accepts a CPU particle material whose effect name contains lowercase 'particle'
// (ParticleSystemRenderer.cpuMaterial setter, warning 6035), so the file name must keep it.
const UNITY_PARTICLE_EFFECT_PATH = path.join('assets', 'effects', 'unity-particle.effect');
const UNITY_BUILTIN_RESOURCE_GUID = '0000000000000000f000000000000000';

const TECHNIQUE = { alpha: 0, premultiply: 1, additive: 2, 'additive-one': 3, 'soft-additive': 4, multiply: 5, 'multiply-double': 6, opaque: 7 };
const FORMULA = { standard: 0, legacyTinted: 1, legacyPremultiply: 2, legacySoftAdditive: 3, legacyMultiply: 4, legacyMultiplyDouble: 5, premultiplyAlpha: 6 };
const LIGHTING = { unlit: 0, simpleLit: 1, lit: 2 };

// Unity built-in shaders referenced by fileID (guid 0000000000000000f000000000000000). The legacy particle shaders
// use fixed blend states and _TintColor (default 0.5); the Mobile ones are fixed-function texture * vertex colour.
const BUILTIN_PARTICLE_SHADERS = {
  200: { name: 'Legacy Shaders/Particles/Additive', technique: 'additive', formula: 'legacyTinted', colorKey: '_TintColor', colorDefault: 0.5 },
  201: { name: 'Legacy Shaders/Particles/~Additive-Multiply', technique: 'premultiply', formula: 'legacyTinted', colorKey: '_TintColor', colorDefault: 0.5, approximate: 'Additive-Multiply alpha is (1 - tex.a) * tint.a * vc.a * 2; approximated as tinted premultiply' },
  202: { name: 'Legacy Shaders/Particles/Additive (Soft)', technique: 'soft-additive', formula: 'legacySoftAdditive' },
  203: { name: 'Legacy Shaders/Particles/Alpha Blended', technique: 'alpha', formula: 'legacyTinted', colorKey: '_TintColor', colorDefault: 0.5 },
  205: { name: 'Legacy Shaders/Particles/Multiply', technique: 'multiply', formula: 'legacyMultiply' },
  206: { name: 'Legacy Shaders/Particles/Multiply (Double)', technique: 'multiply-double', formula: 'legacyMultiplyDouble' },
  207: { name: 'Legacy Shaders/Particles/Alpha Blended Premultiply', technique: 'premultiply', formula: 'legacyPremultiply' },
  209: { name: 'Legacy Shaders/Particles/Anim Alpha Blended', technique: 'alpha', formula: 'legacyTinted', colorKey: '_TintColor', colorDefault: 0.5, approximate: 'flipbook frame blending is not ported' },
  211: { name: 'Particles/Standard Unlit', standard: true, lighting: 'unlit', colorKey: '_Color', colorDefault: 1 },
  212: { name: 'Particles/Standard Surface', standard: true, lighting: 'lit', colorKey: '_Color', colorDefault: 1 },
  10720: { name: 'Mobile/Particles/Additive', technique: 'additive', formula: 'standard' },
  10721: { name: 'Mobile/Particles/Alpha Blended', technique: 'alpha', formula: 'standard' },
  10722: { name: 'Mobile/Particles/VertexLit Blended', technique: 'alpha', formula: 'standard', approximate: 'fixed-function vertex lighting is not ported' },
  10723: { name: 'Mobile/Particles/Multiply', technique: 'multiply', formula: 'legacyMultiply' },
};

// Unity built-in materials a ParticleSystemRenderer can reference directly (unity_builtin_extra). Their state was
// read in Unity 6 (psdump + oracle): Default-ParticleSystem is Particles/Standard Unlit alpha blended, white _Color;
// Default-Particle is the legacy premultiply shader. Their textures are Unity built-ins exported per project by
// unity-builtin-particle-textures.cs.
const BUILTIN_PARTICLE_MATERIALS = {
  10308: { name: 'Default-ParticleSystem', shaderFileId: 211, texture: 'Default-ParticleSystem', floats: { _SrcBlend: 5, _DstBlend: 10, _Surface: 1 }, colors: { _Color: { r: 1, g: 1, b: 1, a: 1 } } },
  10301: { name: 'Default-Particle', shaderFileId: 207, texture: 'Default-Particle', floats: {}, colors: {} },
};
const UNITY_BUILTIN_TEXTURE_DIR = 'assets/unity_imported/_builtin';

// URP shaders by name. Lit/Simple Lit/Unlit (non particle) do not read the vertex colour at all.
const URP_PARTICLE_SHADERS = [
  { pattern: /^Universal Render Pipeline\/Particles\/Unlit$/, lighting: 'unlit', vertexColor: 1 },
  { pattern: /^Universal Render Pipeline\/Particles\/Simple Lit$/, lighting: 'simpleLit', vertexColor: 1 },
  { pattern: /^Universal Render Pipeline\/Particles\/Lit$/, lighting: 'lit', vertexColor: 1 },
  { pattern: /^Universal Render Pipeline\/Lit$/, lighting: 'lit', vertexColor: 0 },
  { pattern: /^Universal Render Pipeline\/Simple Lit$/, lighting: 'simpleLit', vertexColor: 0 },
  { pattern: /^Universal Render Pipeline\/Unlit$/, lighting: 'unlit', vertexColor: 0 },
];

// Unity UnityEngine.Rendering.BlendMode pairs -> effect technique.
function techniqueFromBlend(src, dst) {
  const key = `${Number(src)},${Number(dst)}`;
  return {
    '5,10': 'alpha', '1,10': 'premultiply', '5,1': 'additive', '1,1': 'additive-one', '1,6': 'soft-additive',
    '4,1': 'soft-additive', '2,0': 'multiply', '0,3': 'multiply', '2,3': 'multiply-double', '1,0': 'opaque',
  }[key] || null;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function vec4(x, y, z, w) {
  return { __type__: 'cc.Vec4', x, y, z, w };
}

/**
 * @param {object} input
 * @param {string} input.shaderGuid
 * @param {string|number} input.shaderFileId
 * @param {string} input.shaderName        resolved ShaderLab name ('' for built-ins)
 * @param {Set<string>} input.keywords     active keywords only (m_ValidKeywords / m_ShaderKeywords)
 * @param {object} input.floats            m_Floats
 * @param {object} input.colors            m_Colors
 * @returns {{technique:string, formula:string, lighting:string, vertexColor:number, colorKey:string|null,
 *   colorDefault:number, colorIsHdr:boolean, emission:boolean, alphaClip:number, smoothness:number, metallic:number,
 *   notes:string[], supported:boolean}}
 */
function resolveUnityParticleSemantics(input) {
  const { shaderGuid = '', shaderFileId = '', shaderName = '', keywords = new Set(), floats = {} } = input;
  const notes = [];
  const builtin = shaderGuid === UNITY_BUILTIN_RESOURCE_GUID ? BUILTIN_PARTICLE_SHADERS[Number(shaderFileId)] : null;
  const urp = !builtin ? URP_PARTICLE_SHADERS.find((entry) => entry.pattern.test(String(shaderName || '').trim())) : null;
  const semantics = {
    technique: 'alpha', formula: 'standard', lighting: 'unlit', vertexColor: 1, colorKey: '_BaseColor', colorDefault: 1,
    colorIsHdr: false, emission: false, alphaClip: 0, smoothness: 0.5, metallic: 0, notes, supported: true,
  };
  if (builtin && !builtin.standard) {
    Object.assign(semantics, { technique: builtin.technique, formula: builtin.formula, colorKey: builtin.colorKey || null, colorDefault: builtin.colorDefault ?? 1 });
    if (builtin.approximate) notes.push(builtin.approximate);
    return semantics;
  }
  if (builtin?.standard) {
    semantics.lighting = builtin.lighting;
    semantics.colorKey = builtin.colorKey;
    if (num(floats._ColorMode, 0) !== 0) notes.push(`Standard particle _ColorMode ${floats._ColorMode} is not ported (multiply used)`);
  } else if (urp) {
    semantics.lighting = urp.lighting;
    semantics.vertexColor = urp.vertexColor;
    if (urp.vertexColor && num(floats._ColorMode, 0) !== 0) notes.push(`URP particle _ColorMode ${floats._ColorMode} is not ported (multiply used)`);
  } else {
    semantics.supported = false;
    notes.push(`Shader "${shaderName}" is not a known Unity particle shader; approximated as standard alpha-blended`);
  }

  // Blend: the material's _SrcBlend/_DstBlend drive the render state of URP and Standard particle shaders.
  // Unity 6 moves legacy _ALPHABLEND_ON into m_InvalidKeywords, so keywords are only a fallback.
  const surface = num(floats._Surface, floats._Mode != null ? (num(floats._Mode, 0) === 0 ? 0 : 1) : 1);
  const blended = techniqueFromBlend(floats._SrcBlend, floats._DstBlend);
  if (surface === 0 || blended === 'opaque') semantics.technique = 'opaque';
  else if (blended) semantics.technique = blended;
  else if (keywords.has('_ALPHAPREMULTIPLY_ON')) semantics.technique = 'premultiply';
  else if (keywords.has('_ALPHAMODULATE_ON')) semantics.technique = 'multiply';
  else {
    semantics.technique = 'alpha';
    if (floats._SrcBlend != null || floats._DstBlend != null) notes.push(`Unsupported blend pair ${floats._SrcBlend},${floats._DstBlend}; alpha blend used`);
  }
  // URP premultiply (_Blend 1 / _ALPHAPREMULTIPLY_ON) multiplies the shaded albedo by alpha before One/OneMinusSrcAlpha.
  if (semantics.technique === 'premultiply') semantics.formula = 'premultiplyAlpha';
  if (semantics.technique === 'opaque' && (num(floats._AlphaClip, 0) !== 0 || keywords.has('_ALPHATEST_ON'))) {
    semantics.alphaClip = Math.max(num(floats._Cutoff, 0.5), 0.0001);
  }
  semantics.emission = keywords.has('_EMISSION');
  semantics.smoothness = num(floats._Smoothness ?? floats._Glossiness, 0.5);
  semantics.metallic = num(floats._Metallic, 0);
  if (semantics.lighting === 'lit' && num(floats._WorkflowMode, 1) === 0) notes.push('URP specular workflow is approximated with the metallic BRDF');
  if (num(floats._SoftParticlesEnabled, 0) !== 0 || keywords.has('_SOFTPARTICLES_ON')) notes.push('Soft particles need the camera depth texture and are not ported');
  if (keywords.has('_DISTORTION_ON')) notes.push('Particle distortion is not ported');
  if (keywords.has('_FLIPBOOKBLENDING_ON')) notes.push('Flipbook frame blending is not ported');
  if (semantics.lighting !== 'unlit') notes.push('Lit particles receive no shadows in the port');
  return semantics;
}

/**
 * Builds the cc.Material JSON for unity-particle.effect.
 * @param {object} input
 * @param {ReturnType<typeof resolveUnityParticleSemantics>} input.semantics
 * @param {object} input.colors m_Colors
 * @param {string} input.textureUuid '' keeps the white default
 * @param {boolean} input.textureSrgb
 * @param {boolean} input.linear Unity project is Linear
 * @param {boolean} input.applyActiveColorSpace ParticleSystemRenderer.m_ApplyActiveColorSpace
 * @param {object|null} input.mainTexEnv {m_Scale, m_Offset}
 * @param {number[]|null} input.sourceRendererPivot
 * @param {string} input.effectUuid
 * @param {string} input.name
 */
function unityParticleMaterialData(input) {
  const { semantics, colors = {}, textureUuid = '', textureSrgb = true, linear = false, applyActiveColorSpace = true,
    mainTexEnv = null, sourceRendererPivot = null, effectUuid, name = '' } = input;
  const fallback = semantics.colorDefault ?? 1;
  const color = semantics.colorKey ? (colors[semantics.colorKey] || { r: fallback, g: fallback, b: fallback, a: fallback }) : { r: 1, g: 1, b: 1, a: 1 };
  // [HDR] _EmissionColor is stored linear by Unity; plain Color properties are serialized sRGB.
  const emission = semantics.emission ? (colors._EmissionColor || { r: 0, g: 0, b: 0 }) : { r: 0, g: 0, b: 0 };
  const scale = mainTexEnv?.m_Scale || { x: 1, y: 1 };
  const offset = mainTexEnv?.m_Offset || { x: 0, y: 0 };
  const props = {
    unityColor: vec4(num(color.r, 1), num(color.g, 1), num(color.b, 1), num(color.a, 1)),
    unityEmission: vec4(num(emission.r, 0), num(emission.g, 0), num(emission.b, 0), semantics.emission ? 1 : 0),
    unityColorSpace: vec4(
      linear && textureUuid && textureSrgb ? 1 : 0,
      linear && applyActiveColorSpace ? 1 : 0,
      linear && !semantics.colorIsHdr ? 1 : 0,
      linear ? 1 : 0,
    ),
    unityParticleParams: vec4(FORMULA[semantics.formula], semantics.vertexColor, LIGHTING[semantics.lighting], semantics.alphaClip),
    unityPbrParams: vec4(semantics.smoothness, semantics.metallic, 0, 0),
  };
  if (!(num(scale.x, 1) === 1 && num(scale.y, 1) === 1 && num(offset.x, 0) === 0 && num(offset.y, 0) === 0)) {
    props.mainTiling_Offset = vec4(num(scale.x, 1), num(scale.y, 1), num(offset.x, 0), num(offset.y, 0));
  }
  if (textureUuid) props.mainTexture = { __uuid__: textureUuid, __expectedType__: 'cc.Texture2D' };
  if (sourceRendererPivot) props.sourceRendererPivot = vec4(...sourceRendererPivot.map(Number));
  return {
    __type__: 'cc.Material',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: { __uuid__: effectUuid, __expectedType__: 'cc.EffectAsset' },
    _techIdx: TECHNIQUE[semantics.technique],
    _defines: [{}, {}],
    _states: [{}, {}],
    _props: [props, {}],
  };
}

// ---- Reference model of unity-particle.effect (mirrors the GLSL; used by tests against the Unity oracle) ----
const srgbToLinear = (c) => (c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => {
  const v = Math.max(c, 0);
  return v < 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
const v4 = (value, fallback = [0, 0, 0, 0]) => (value
  ? (value.__type__ === 'cc.Color' ? [value.r / 255, value.g / 255, value.b / 255, value.a / 255] : [num(value.x, 0), num(value.y, 0), num(value.z, 0), num(value.w, 0)])
  : fallback);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Evaluates the fragment of unity-particle.effect for one material (its _props[0]) in linear space.
 * @param {object} props material _props[0]
 * @param {object} input {vertexColor:[r,g,b,a] 0..1, texel:[r,g,b,a] 0..1, normal:[x,y,z] (towards the viewer),
 *   viewDirection:[x,y,z]} in the same world space as unityLightDirection*
 * @returns {number[]} linear rgba the shader returns before the final encode
 */
function evaluateUnityParticleFragment(props, input) {
  const cs = v4(props.unityColorSpace); const pp = v4(props.unityParticleParams, [0, 1, 0, 0]); const pbr = v4(props.unityPbrParams, [0.5, 0, 0, 0]);
  const lin = (rgb, flag) => (flag > 0.5 ? rgb.map(srgbToLinear) : rgb);
  const texel = input.texel || [1, 1, 1, 1];
  const tex = [...lin(texel.slice(0, 3), cs[0]), texel[3]];
  let vc = [...lin(input.vertexColor.slice(0, 3), cs[1]), input.vertexColor[3]];
  vc = vc.map((value) => 1 + (value - 1) * pp[1]);
  const color = v4(props.unityColor, [1, 1, 1, 1]);
  const tint = [...lin(color.slice(0, 3), cs[2]), color[3]];
  const mul = (...vs) => [0, 1, 2, 3].map((i) => vs.reduce((acc, v) => acc * v[i], 1));
  const formula = pp[0];
  let col;
  if (formula < 0.5) col = mul(tint, vc, tex);
  else if (formula < 1.5) col = mul(vc, tint, tex).map((v) => 2 * v);
  else if (formula < 2.5) col = mul(vc, tex).map((v) => v * vc[3]);
  else if (formula < 3.5) { col = mul(vc, tex); col = [col[0] * col[3], col[1] * col[3], col[2] * col[3], col[3]]; }
  else if (formula < 4.5) { col = mul(vc, tex); col = col.map((v) => 1 + (v - 1) * col[3]); }
  else if (formula < 5.5) { col = [tex[0] * vc[0] * 2, tex[1] * vc[1] * 2, tex[2] * vc[2] * 2, vc[3] * tex[3]]; col = col.map((v) => 0.5 + (v - 0.5) * col[3]); }
  else col = mul(tint, vc, tex);
  const model = pp[2];
  if (model > 0.5) {
    const normal = norm3(input.normal); const view = norm3(input.viewDirection || input.normal);
    const metallic = pbr[1];
    const light = (dirValue, colorValue, intensity) => {
      const dir = norm3(v4(dirValue).slice(0, 3));
      const noL = Math.max(dot3(normal, dir), 0);
      const radiance = lin(v4(colorValue, [1, 1, 1, 1]).slice(0, 3), cs[3]).map((c) => c * intensity * noL);
      if (model < 1.5) return col.slice(0, 3).map((a, i) => a * radiance[i]);
      const half = norm3([dir[0] + view[0], dir[1] + view[1], dir[2] + view[2]]);
      const noH = Math.max(dot3(normal, half), 0); const loH = Math.max(dot3(dir, half), 0);
      const roughness = Math.max((1 - pbr[0]) ** 2, 0.0078125); const r2 = Math.max(roughness * roughness, 0.000061035);
      const d = noH * noH * (r2 - 1) + 1.00001;
      const specularTerm = r2 / Math.max(d * d * Math.max(0.1, loH * loH) * (roughness * 4 + 2), 0.000001);
      return col.slice(0, 3).map((a, i) => ((a * (1 - (0.04 + 0.96 * metallic))) + (0.04 + (a - 0.04) * metallic) * specularTerm) * radiance[i]);
    };
    const intensities = v4(props.unityLightIntensities);
    const l0 = light(props.unityLightDirection0, props.unityLightColor0, intensities[0]);
    const l1 = light(props.unityLightDirection1, props.unityLightColor1, intensities[1]);
    const up = Math.max(normal[1], 0); const down = Math.max(-normal[1], 0);
    const sky = lin(v4(props.unityAmbientSky).slice(0, 3), cs[3]); const equator = lin(v4(props.unityAmbientEquator).slice(0, 3), cs[3]);
    const ground = lin(v4(props.unityAmbientGround).slice(0, 3), cs[3]);
    const ambient = [0, 1, 2].map((i) => (normal[1] >= 0 ? equator[i] + (sky[i] - equator[i]) * up : equator[i] + (ground[i] - equator[i]) * down) * v4(props.unityAmbientParams, [1, 0, 0, 0])[0]);
    const ambientAlbedo = col.slice(0, 3).map((a) => (model < 1.5 ? a : a * (1 - (0.04 + 0.96 * metallic))));
    col = [0, 1, 2].map((i) => l0[i] + l1[i] + ambient[i] * ambientAlbedo[i]).concat(col[3]);
  }
  if (formula > 5.5) col = [col[0] * col[3], col[1] * col[3], col[2] * col[3], col[3]];
  const emission = v4(props.unityEmission);
  return [col[0] + emission[0], col[1] + emission[1], col[2] + emission[2], col[3]];
}

/** Fixed-function blend of a shader result over a destination, both linear (Unity / float-output model). */
function blendUnityParticle(technique, src, dst) {
  const [r, g, b, a] = src;
  const s = [r, g, b];
  switch (technique) {
    case 'premultiply': return dst.map((d, i) => s[i] + d * (1 - a));
    case 'additive': return dst.map((d, i) => s[i] * a + d);
    case 'additive-one': return dst.map((d, i) => s[i] + d);
    case 'soft-additive': return dst.map((d, i) => s[i] + d * (1 - s[i]));
    case 'multiply': return dst.map((d, i) => s[i] * d);
    case 'multiply-double': return dst.map((d, i) => 2 * s[i] * d);
    case 'opaque': return s;
    default: return dst.map((d, i) => s[i] * a + d * (1 - a));
  }
}

module.exports = {
  srgbToLinear,
  linearToSrgb,
  evaluateUnityParticleFragment,
  blendUnityParticle,
  UNITY_PARTICLE_EFFECT_PATH,
  UNITY_PARTICLE_EFFECT_TEMPLATE,
  UNITY_BUILTIN_TEXTURE_DIR,
  BUILTIN_PARTICLE_MATERIALS,
  BUILTIN_PARTICLE_SHADERS,
  TECHNIQUE,
  FORMULA,
  LIGHTING,
  techniqueFromBlend,
  resolveUnityParticleSemantics,
  unityParticleMaterialData,
};
