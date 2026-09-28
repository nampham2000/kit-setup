'use strict';
/**
 * Cocos Creator 3.8 effect emitter for Unity ShaderGraph generated code.
 *
 * Supported URP targets (by the pass include Unity composes the surface with):
 *   2D  SpriteUnlitPass / SpriteLitPass (+ SpriteNormalPass)   -> sprite effect (world-space batched vertices,
 *       USE_LOCAL toggles the node transform like builtin-sprite)
 *   2D  MeshUnlitPass / Mesh2DLitPass (+ MeshNormalPass)       -> mesh effect (node transform)
 *   3D  UnlitPass (Universal Unlit)                            -> mesh effect, CCFragOutput (colour space gamma)
 * Everything else gets an explicit disposition (not-renderer-material / unsupported-target / unsupported-pipeline)
 * instead of a broken effect.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseGeneratedShaderGraph } = require('./sg-source.cjs');
const { lowerSection, createLoweringContext, gradientFunction } = require('./sg-lower.cjs');
const { Program, functionSignatures } = require('./sg-program.cjs');
const { tokenize } = require('./sg-glsl-types.cjs');
const { replaceCall } = require('../call-rewriter.cjs');

const GLSL_DIR = path.join(__dirname, 'glsl');
const SHIMS = fs.readFileSync(path.join(GLSL_DIR, 'sg-urp-shims.glsl'), 'utf8');
const LIGHTING_2D = fs.readFileSync(path.join(GLSL_DIR, 'sg-urp2d-lighting.glsl'), 'utf8');

// Engine globals ShaderGraph code may reference -> GLSL expression (object-like #define in sg-common).
const ENGINE_GLOBALS = {
  _TimeParameters: ['vec4', 'vec4(cc_time.x, sin(cc_time.x), cos(cc_time.x), 0.0)'],
  _Time: ['vec4', 'vec4(cc_time.x / 20.0, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0)'],
  _SinTime: ['vec4', 'vec4(sin(cc_time.x / 8.0), sin(cc_time.x / 4.0), sin(cc_time.x / 2.0), sin(cc_time.x))'],
  _CosTime: ['vec4', 'vec4(cos(cc_time.x / 8.0), cos(cc_time.x / 4.0), cos(cc_time.x / 2.0), cos(cc_time.x))'],
  unity_DeltaTime: ['vec4', 'vec4(cc_time.y, 1.0 / max(cc_time.y, 1e-5), cc_time.y, 1.0 / max(cc_time.y, 1e-5))'],
  _WorldSpaceCameraPos: ['vec3', 'cc_cameraPos.xyz'],
  _ScreenParams: ['vec4', 'vec4(cc_screenSize.xy, 1.0 + cc_screenSize.zw)'],
  _ProjectionParams: ['vec4', 'vec4(1.0, cc_nearFar.x, cc_nearFar.y, 1.0 / cc_nearFar.y)'],
  _ZBufferParams: ['vec4', 'vec4(1.0 - cc_nearFar.y / cc_nearFar.x, cc_nearFar.y / cc_nearFar.x, (1.0 - cc_nearFar.y / cc_nearFar.x) / cc_nearFar.y, 1.0 / cc_nearFar.x)'],
  // (orthographic width, height, unused, 1 when orthographic) from the active projection matrix
  unity_OrthoParams: ['vec4', 'vec4(1.0 / cc_matProj[0][0], 1.0 / cc_matProj[1][1], 0.0, cc_matProj[3][3])'],
  SHADERGRAPH_OBJECT_POSITION: ['vec3', 'sgMatWorld[3].xyz'],
  UNITY_MATRIX_M: ['mat4', 'sgTranspose(sgMatWorld)'],
  UNITY_MATRIX_I_M: ['mat4', 'sgMatWorldIT'],
  unity_ObjectToWorld: ['mat4', 'sgTranspose(sgMatWorld)'],
  unity_WorldToObject: ['mat4', 'sgMatWorldIT'],
  UNITY_MATRIX_V: ['mat4', 'sgTranspose(cc_matView)'],
  UNITY_MATRIX_I_V: ['mat4', 'sgTranspose(cc_matViewInv)'],
  UNITY_MATRIX_P: ['mat4', 'sgTranspose(cc_matProj)'],
  UNITY_MATRIX_I_P: ['mat4', 'sgTranspose(cc_matProjInv)'],
  UNITY_MATRIX_VP: ['mat4', 'sgTranspose(cc_matViewProj)'],
  UNITY_MATRIX_I_VP: ['mat4', 'sgTranspose(cc_matViewProjInv)'],
  UNITY_MATRIX_MV: ['mat4', 'sgTranspose(cc_matView * sgMatWorld)'],
  UNITY_MATRIX_T_MV: ['mat4', '(cc_matView * sgMatWorld)'],
  UNITY_MATRIX_IT_MV: ['mat4', 'sgTranspose(cc_matView * sgMatWorld)'],
  UNITY_MATRIX_MVP: ['mat4', 'sgTranspose(cc_matViewProj * sgMatWorld)'],
  PI: ['float', '3.14159265359'],
  TWO_PI: ['float', '6.28318530718'],
  HALF_PI: ['float', '1.57079632679'],
  INV_PI: ['float', '0.31830988618'],
  FLT_EPS: ['float', '5.960464478e-8'],
  FLT_MIN: ['float', '1.175494351e-38'],
  FLT_MAX: ['float', '3.402823466e+38'],
  HALF_MIN: ['float', '6.103515625e-5'],
  HALF_MAX: ['float', '65504.0'],
  REAL_MIN: ['float', '1.175494351e-38'],
  REAL_MAX: ['float', '3.402823466e+38'],
  unity_AmbientSky: ['vec4', 'cc_ambientSky'],
  unity_AmbientEquator: ['vec4', 'cc_ambientSky'],
  unity_AmbientGround: ['vec4', 'cc_ambientGround'],
  _MainLightPosition: ['vec4', 'vec4(-cc_mainLitDir.xyz, 0.0)'],
  _MainLightColor: ['vec4', 'vec4(cc_mainLitColor.rgb * cc_mainLitColor.w, 1.0)'],
};
const REPORTED_GLOBALS = {
  unity_OrthoParams: ['medium', 'SG_ORTHO_PARAMS', 'unity_OrthoParams is derived from the active projection matrix; a perspective camera yields its projection scale, not the unused orthographicSize Unity keeps'],
  _MainLightPosition: ['medium', 'SG_MAIN_LIGHT', 'main light direction/colour read from the Cocos main light'],
  _MainLightColor: ['medium', 'SG_MAIN_LIGHT', 'main light direction/colour read from the Cocos main light'],
  unity_AmbientEquator: ['medium', 'SG_AMBIENT', 'Cocos has no equator ambient colour; the sky colour is used'],
};

// SurfaceDescriptionInputs / VertexDescriptionInputs fields -> Cocos expressions (fragment / vertex stage)
const FRAGMENT_INPUTS = {
  uv0: ['v_uv0', ['uv0']], uv1: ['v_uv1', ['uv1']], uv2: ['v_uv2', ['uv2']], uv3: ['v_uv3', ['uv3']],
  VertexColor: ['v_color', ['color']],
  WorldSpacePosition: ['v_posWS', ['posWS']],
  AbsoluteWorldSpacePosition: ['v_posWS', ['posWS']],
  ObjectSpacePosition: ['v_posOS', ['posOS']],
  ViewSpacePosition: ['(cc_matView * vec4(v_posWS, 1.0)).xyz', ['posWS']],
  NDCPosition: ['((v_clip.xy / v_clip.w) * 0.5 + 0.5)', ['clip']],
  PixelPosition: ['(((v_clip.xy / v_clip.w) * 0.5 + 0.5) * cc_screenSize.xy)', ['clip']],
  ScreenPosition: ['vec4((v_clip.xy + v_clip.w) * 0.5, v_clip.zw)', ['clip']],
  TimeParameters: ['vec3(cc_time.x, sin(cc_time.x), cos(cc_time.x))', []],
  TangentSpaceNormal: ['vec3(0.0, 0.0, 1.0)', []],
  WorldSpaceNormal: ['normalize(v_normalWS)', ['normalWS']],
  ObjectSpaceNormal: ['TransformWorldToObjectNormal(normalize(v_normalWS))', ['normalWS']],
  ViewSpaceNormal: ['normalize((cc_matView * vec4(normalize(v_normalWS), 0.0)).xyz)', ['normalWS']],
  WorldSpaceTangent: ['normalize(v_tangentWS.xyz)', ['tangentWS']],
  ObjectSpaceTangent: ['TransformWorldToObjectDir(normalize(v_tangentWS.xyz))', ['tangentWS']],
  WorldSpaceBiTangent: ['(v_tangentWS.w * cross(normalize(v_normalWS), normalize(v_tangentWS.xyz)))', ['normalWS', 'tangentWS']],
  ObjectSpaceBiTangent: ['TransformWorldToObjectDir(v_tangentWS.w * cross(normalize(v_normalWS), normalize(v_tangentWS.xyz)))', ['normalWS', 'tangentWS']],
  WorldSpaceViewDirection: ['(cc_cameraPos.xyz - v_posWS)', ['posWS']],
  ObjectSpaceViewDirection: ['TransformWorldToObjectDir(cc_cameraPos.xyz - v_posWS, false)', ['posWS']],
  ViewSpaceViewDirection: ['(cc_matView * vec4(cc_cameraPos.xyz - v_posWS, 0.0)).xyz', ['posWS']],
  TangentSpaceViewDirection: ['sgTangentViewDir()', ['posWS', 'normalWS', 'tangentWS']],
  FaceSign: ['(gl_FrontFacing ? 1.0 : 0.0)', []],
};
const VERTEX_INPUTS = {
  ObjectSpacePosition: 'a_position',
  ObjectSpaceNormal: 'a_normal',
  ObjectSpaceTangent: 'a_tangent.xyz',
  ObjectSpaceBiTangent: '(a_tangent.w * cross(a_normal, a_tangent.xyz))',
  WorldSpacePosition: '(sgMatWorld * vec4(a_position, 1.0)).xyz',
  AbsoluteWorldSpacePosition: '(sgMatWorld * vec4(a_position, 1.0)).xyz',
  WorldSpaceNormal: 'normalize((sgMatWorldIT * vec4(a_normal, 0.0)).xyz)',
  WorldSpaceTangent: 'normalize((sgMatWorld * vec4(a_tangent.xyz, 0.0)).xyz)',
  WorldSpaceBiTangent: '(a_tangent.w * cross(normalize((sgMatWorldIT * vec4(a_normal, 0.0)).xyz), normalize((sgMatWorld * vec4(a_tangent.xyz, 0.0)).xyz)))',
  ViewSpacePosition: '(cc_matView * (sgMatWorld * vec4(a_position, 1.0))).xyz',
  WorldSpaceViewDirection: '(cc_cameraPos.xyz - (sgMatWorld * vec4(a_position, 1.0)).xyz)',
  ObjectSpaceViewDirection: 'TransformWorldToObjectDir(cc_cameraPos.xyz - (sgMatWorld * vec4(a_position, 1.0)).xyz, false)',
  TimeParameters: 'vec3(cc_time.x, sin(cc_time.x), cos(cc_time.x))',
  uv0: 'vec4(a_texCoord, 0.0, 0.0)', uv1: 'vec4(a_texCoord1, 0.0, 0.0)', uv2: 'vec4(a_texCoord2, 0.0, 0.0)', uv3: 'vec4(a_texCoord3, 0.0, 0.0)',
  VertexColor: 'a_color',
};

const TARGETS = {
  SpriteUnlitPass: { kind: '2d', sprite: true, lit: false },
  SpriteLitPass: { kind: '2d', sprite: true, lit: true },
  MeshUnlitPass: { kind: '2d', sprite: false, lit: false },
  Mesh2DLitPass: { kind: '2d', sprite: false, lit: true },
  UnlitPass: { kind: '3d', sprite: false, lit: false },
};

const BLEND = {
  SrcAlpha: 'src_alpha', OneMinusSrcAlpha: 'one_minus_src_alpha', One: 'one', Zero: 'zero', DstColor: 'dst_color',
  OneMinusDstColor: 'one_minus_dst_color', SrcColor: 'src_color', OneMinusSrcColor: 'one_minus_src_color',
  DstAlpha: 'dst_alpha', OneMinusDstAlpha: 'one_minus_dst_alpha', SrcAlphaSaturate: 'src_alpha_saturate',
};
const DEPTH_FUNC = { Less: 'less', LEqual: 'less_equal', Equal: 'equal', GEqual: 'greater_equal', Greater: 'greater', NotEqual: 'not_equal', Always: 'always', Never: 'never' };
const DATA_TEXTURE = /(normal|bump|mask|noise|height|depth|flow|distort|dissolve|lut|ramp|matcap|metal|rough|smooth|occlusion|\bao\b|specular|gloss|data)/i;

// ---------------------------------------------------------------------------------------------------------------
// stage pruning: keep the top-level items (structs, functions with overloads, #define lines) a stage reaches

function splitItems(code) {
  const items = [];
  const lines = code.split('\n');
  let buf = [];
  let depth = 0;
  let name = null;
  let kind = null;
  let ppGroup = null;
  const flush = () => {
    if (buf.length) items.push({ name, kind, text: buf.join('\n') });
    buf = []; name = null; kind = null;
  };
  for (const line of lines) {
    const t = line.trim();
    if (depth === 0 && /^#/.test(t)) {
      // #if/#else/#endif around items are kept with the items they wrap (hash shims): treat as own item
      flush();
      const def = /^#define\s+(\w+)/.exec(t);
      items.push({ name: def ? def[1] : null, kind: def ? 'define' : 'pp', text: line });
      ppGroup = null;
      continue;
    }
    if (depth === 0 && !buf.length) {
      if (!t || /^\/\//.test(t)) continue;
      const sm = /^struct\s+(\w+)/.exec(t);
      const fm = /^(?:[\w]+\s+)+(\w+)\s*\(/.exec(t);
      name = sm ? sm[1] : fm ? fm[1] : null;
      kind = sm ? 'struct' : fm ? 'function' : 'other';
    }
    buf.push(line);
    for (const ch of line.replace(/\/\/.*$/, '')) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && (/[};]\s*$/.test(t))) flush();
  }
  flush();
  return items;
}

/** Items reachable from `roots` (identifier references), preserving order; conditional (#if) lines kept balanced. */
function pruneItems(items, roots) {
  const byName = new Map();
  for (const it of items) if (it.name) { if (!byName.has(it.name)) byName.set(it.name, []); byName.get(it.name).push(it); }
  const keep = new Set();
  const visit = (text) => {
    for (const m of text.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      const list = byName.get(m[0]);
      if (!list) continue;
      for (const it of list) if (!keep.has(it)) { keep.add(it); visit(it.text); }
    }
  };
  for (const r of roots) visit(r);
  const out = [];
  for (const it of items) {
    if (it.kind === 'pp') out.push(it);
    else if (keep.has(it)) out.push(it);
  }
  // drop empty #if/#else/#endif groups
  const text = out.map((it) => it.text).join('\n');
  return text.replace(/^#if[^\n]*\n(?:#else\n)?#endif\n?/gm, '').replace(/^#if[^\n]*\n#else\n([\s\S]*?)#endif/gm, (m) => m);
}

// ---------------------------------------------------------------------------------------------------------------

function glslType(hlsl) {
  const t = hlsl.replace(/^half/, 'float');
  if (t === 'float') return 'float';
  if (/^float[234]$/.test(t)) return `vec${t[5]}`;
  if (/^float([234])x\1$/.test(t)) return `mat${t[5]}`;
  if (t === 'int' || t === 'uint') return 'int';
  if (t === 'bool') return 'bool';
  return null;
}

function num(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 1e6) / 1e6);
}

function textureDefault(prop) {
  const v = String(prop && prop.value != null ? prop.value : 'white').toLowerCase();
  if (prop && (prop.normal || v === 'bump')) return 'normal';
  if (v === 'black') return 'black';
  if (v === 'grey' || v === 'gray') return 'grey';
  return 'white';
}

/**
 * Build the effect for one generated ShaderGraph text.
 * options: { name, colorSpace: 'gamma'|'linear', vertexColor: 'srgb'|'linear' (default: srgb in gamma, linear in linear),
 *            linearTextures:[], srgbTextures:[], resolveInclude(path)->text|null,
 *            overrides: { functions: glslText, names: [..] }, normalsTechnique: bool }
 * returns { disposition, effect|null, diagnostics[], properties[], textures[], target, name }
 */
function generateEffect(sourceText, options = {}) {
  const parsed = parseGeneratedShaderGraph(sourceText);
  const name = options.name || (parsed.shaderName.split('/').pop() || 'ShaderGraph');
  const result = { name, shaderName: parsed.shaderName, targetId: parsed.targetId, disposition: null, effect: null, diagnostics: [], properties: [], textures: [], target: null };
  const report = (severity, code, message) => {
    if (!result.diagnostics.some((d) => d.code === code && d.message === message)) result.diagnostics.push({ severity, code, message });
  };
  if (parsed.error) { result.disposition = 'dump-error'; report('high', 'SG_DUMP_ERROR', parsed.error); return result; }
  if (!parsed.targetId || !/^Universal/.test(parsed.targetId)) {
    const pipeline = /HDRenderPipeline|HDRP/i.test(sourceText) ? 'HDRP' : (parsed.passes.some((p) => p.passInclude === 'UITKPass') ? 'UI Toolkit' : 'unknown');
    result.disposition = pipeline === 'UI Toolkit' ? 'not-renderer-material' : 'unsupported-pipeline';
    report(pipeline === 'UI Toolkit' ? 'medium' : 'high', 'SG_TARGET_UNSUPPORTED', `${pipeline} ShaderGraph target is not a Cocos renderer material; port the owner (UI/pipeline) separately`);
    return result;
  }
  if (parsed.targetId === 'UniversalFullscreenSubTarget') {
    result.disposition = 'not-renderer-material';
    report('medium', 'SG_TARGET_UNSUPPORTED', 'Fullscreen ShaderGraph (renderer feature / blit) is not a material effect; port it as a post-process pass if the playable needs it');
    return result;
  }
  const colorPass = parsed.passes.find((p) => TARGETS[p.passInclude] && /^(Universal2D|UniversalForward|UniversalForwardOnly|SRPDefaultUnlit)$/.test(p.lightMode || 'UniversalForward'))
    || parsed.passes.find((p) => TARGETS[p.passInclude]);
  if (!colorPass) {
    result.disposition = 'unsupported-target';
    const includes = [...new Set(parsed.passes.map((p) => p.passInclude).filter(Boolean))].join(', ');
    report('high', 'SG_TARGET_UNSUPPORTED', `${parsed.targetId} (${includes || 'no pass include'}) has no Cocos composition in this generator yet (Universal Lit needs a surface-shader template)`);
    return result;
  }
  const target = TARGETS[colorPass.passInclude];
  result.target = colorPass.passInclude;
  const normalPass = options.normalsTechnique === false ? null
    : parsed.passes.find((p) => p.lightMode === 'NormalsRendering' && /NormalPass$/.test(p.passInclude || ''));
  const colorSpace = options.colorSpace || 'gamma';
  // Vertex colours: Unity (linear colour space) writes SpriteRenderer / Tilemap / SpriteShape colours linearized, so a
  // project running its own linear pipeline may still feed gamma vertex colours and want them decoded ('srgb').
  const vertexColor = options.vertexColor || (colorSpace === 'gamma' ? 'srgb' : 'linear');

  // ---- lowering ---------------------------------------------------------------------------------------------
  const overrideNames = (options.overrides && options.overrides.names) || [];
  const ctx = createLoweringContext(colorPass, { overrides: overrideNames });
  const includeCode = [];
  const includePaths = new Set([...colorPass.graphIncludes, ...(normalPass ? normalPass.graphIncludes : [])]);
  // URP/core library includes whose content the shims provide (Hashes, Color, 2D light textures)
  const SHIMMED_INCLUDE = /^Packages\/com\.unity\.render-pipelines\.(core|universal)\/(ShaderLibrary\/(Hashes|Color|Common|Macros)\.hlsl|Shaders\/2D\/Include\/(ShapeLightShared|ShapeLightVariables|LightingUtility)\.hlsl)$/;
  const seenIncludes = new Set();
  const expandInclude = (inc) => {
    if (SHIMMED_INCLUDE.test(inc) || seenIncludes.has(inc)) return;
    seenIncludes.add(inc);
    const text = options.resolveInclude ? options.resolveInclude(inc) : null;
    if (text == null) { report('high', 'SG_CUSTOM_FUNCTION_INCLUDE', `custom function include '${inc}' not found (pass --unity-project or provide an override)`); return; }
    for (const m of text.matchAll(/^\s*#include(?:_with_pragmas)?\s+"([^"]+)"/gm)) {
      const nested = /^(Assets|Packages)\//.test(m[1]) ? m[1] : path.posix.join(path.posix.dirname(inc), m[1]);
      expandInclude(nested);
    }
    includeCode.push(lowerSection(stripIncludeGuard(text.replace(/\r\n/g, '\n')).replace(/^\s*#(pragma|include|include_with_pragmas)\b[^\n]*$/gm, ''), ctx));
  };
  for (const inc of includePaths) expandInclude(inc);
  const funcs = lowerSection(colorPass.functions, ctx);
  const vtx = lowerSection(colorPass.vertex, ctx);
  const pix = lowerSection(colorPass.pixel, ctx);
  let nFuncs = '';
  let nPix = '';
  if (normalPass) {
    nFuncs = lowerSection(normalPass.functions, ctx);
    nPix = lowerSection(normalPass.pixel, ctx)
      .replace(/\bSurfaceDescriptionInputs\b/g, 'SurfaceDescriptionInputsN')
      .replace(/\bSurfaceDescriptionFunction\b/g, 'SurfaceDescriptionFunctionN')
      .replace(/\bSurfaceDescription\b/g, 'SurfaceDescriptionN');
  }
  for (const d of ctx.diagnostics) report(d.severity, d.code, d.message);

  // ---- properties / uniforms ----------------------------------------------------------------------------------
  const propByName = new Map(parsed.properties.map((p) => [p.name, p]));
  const scalarProps = [];
  const uboMembers = [];
  const globalTypes = [];
  const globalExprs = [];
  const yaml = [];
  let pack = null;
  const allProps = [...colorPass.materialProps, ...colorPass.globalScalars.map((g) => ({ ...g, global: true }))];
  for (const p of allProps) {
    const type = glslType(p.type);
    if (!type) { report('high', 'SG_PROPERTY_TYPE', `property ${p.name}: unsupported type ${p.type}`); continue; }
    const prop = propByName.get(p.name);
    const editor = prop ? `, editor: { displayName: '${prop.display.replace(/'/g, '')}'${/color/i.test(prop.type) && !prop.hdr ? ', type: color' : ''}${prop.hidden ? ', visible: false' : ''} }` : '';
    if (type === 'float' || type === 'int' || type === 'bool') {
      if (!pack || pack.used === 4) { pack = { name: `sgPack${scalarProps.length}`, used: 0 }; scalarProps.push(pack); uboMembers.push(`vec4 ${pack.name};`); }
      const comp = 'xyzw'[pack.used++];
      const member = `${pack.name}.${comp}`;
      globalTypes.push([p.name, type]);
      globalExprs.push([p.name, { text: type === 'float' ? member : type === 'int' ? `int(${member})` : `(${member} != 0.0)`, type }]);
      const value = prop && prop.value != null && typeof prop.value === 'number' ? prop.value : 0;
      yaml.push(`${p.name}: { value: ${num(value)}, target: ${member}${editor} }`);
      result.properties.push({ unity: p.name, cocos: p.name, uniform: member, type });
    } else if (type === 'vec2' || type === 'vec3') {
      const member = `sgv${p.name}`;
      uboMembers.push(`vec4 ${member};`);
      const sw = type === 'vec2' ? 'xy' : 'xyz';
      globalTypes.push([p.name, type]);
      globalExprs.push([p.name, { text: `${member}.${sw}`, type }]);
      const v = Array.isArray(prop && prop.value) ? prop.value : [];
      const vals = [0, 1, 2].slice(0, type === 'vec2' ? 2 : 3).map((i) => num(v[i] || 0));
      yaml.push(`${p.name}: { value: [${vals.join(', ')}], target: ${member}.${sw}${editor} }`);
      result.properties.push({ unity: p.name, cocos: p.name, uniform: `${member}.${sw}`, type });
    } else if (type === 'vec4') {
      uboMembers.push(`vec4 ${p.name};`);
      globalTypes.push([p.name, 'vec4']);
      let v = Array.isArray(prop && prop.value) ? prop.value : null;
      if (!v && /_ST$/.test(p.name)) v = [1, 1, 0, 0];
      if (!v && /_TexelSize$/.test(p.name)) {
        v = [0.0009765625, 0.0009765625, 1024, 1024];
        report('medium', 'SG_TEXEL_SIZE_BINDING', `${p.name}: Cocos does not fill texel sizes; set it from the bound texture (default 1/1024)`);
      }
      v = v || [0, 0, 0, 0];
      yaml.push(`${p.name}: { value: [${[0, 1, 2, 3].map((i) => num(v[i] || 0)).join(', ')}]${editor} }`);
      result.properties.push({ unity: p.name, cocos: p.name, uniform: p.name, type });
    } else if (/^mat/.test(type)) {
      uboMembers.push(`${type} ${p.name};`);
      globalTypes.push([p.name, type]);
      report('medium', 'SG_MATRIX_PROPERTY', `${p.name}: matrix property holds the transpose of the Unity matrix (row-major HLSL convention)`);
      result.properties.push({ unity: p.name, cocos: p.name, uniform: p.name, type });
    }
  }
  const linear = new Set(options.linearTextures || []);
  const srgb = new Set(options.srgbTextures || []);
  const samplerDecls = [];
  const srgbTextures = [];
  const latlongOption = options.latlongCubes || [];
  const latlongCubes = new Set();
  for (const t of colorPass.textures) {
    let kind = /CUBE/.test(t.kind) ? 'samplerCube' : /ARRAY|3D/.test(t.kind) ? null : 'sampler2D';
    if (!kind) { report('high', 'SG_UNSUPPORTED_TEXTURE', `${t.name}: ${t.kind} has no GLSL ES 1.00 form`); continue; }
    if (!ctx.usedTextures.has(t.name) && !new RegExp(`\\b${t.name}\\b`).test(funcs + vtx + pix + nPix + includeCode.join('\n'))) continue;
    const prop = propByName.get(t.name);
    if (kind === 'samplerCube' && (latlongOption === 'all' || latlongOption.includes(t.name))) {
      kind = 'sampler2D';
      latlongCubes.add(t.name);
      report('medium', 'SG_CUBEMAP_LATLONG', `${t.name}: Unity cube map sampled as its equirect source image (sgLatLongUV); check orientation against a Unity reference`);
    } else if (kind === 'samplerCube') {
      report('medium', 'SG_CUBEMAP', `${t.name}: sampled as a Cocos cube map; an equirect HDR imported as Cube in Unity needs a Cocos cube map import or --latlong-cubes ${t.name}`);
    }
    samplerDecls.push(`uniform ${kind} ${t.name};`);
    yaml.push(`${t.name}: { value: ${kind === 'samplerCube' ? 'default-cube' : textureDefault(prop)} }`);
    const isData = linear.has(t.name) || (!srgb.has(t.name) && ((prop && (prop.normal || prop.value === 'bump')) || DATA_TEXTURE.test(t.name) || DATA_TEXTURE.test(prop ? prop.display : '')));
    if (!isData && colorSpace === 'gamma') srgbTextures.push(t.name);
    result.textures.push({ unity: t.name, cocos: t.name, kind, srgb: !isData, latlong: latlongCubes.has(t.name) || undefined });
  }
  if (colorSpace === 'gamma' && srgbTextures.length) {
    report('medium', 'SG_COLOR_SPACE', `sRGB decode applied to ${srgbTextures.join(', ')} (override with --linear-textures); 2D output is re-encoded per draw, so blending happens in gamma space unlike a Unity linear project`);
  }

  // ---- shims + typed pass ---------------------------------------------------------------------------------------
  const usesLighting = target.lit || /\bsgLightSample[0-3]\s*\(/.test(funcs + pix + nPix + includeCode.join('\n'));
  const stageHelpers = `vec4 sgTexLod (sampler2D t, vec2 uv, float lod) { return texture(t, uv); }
vec4 sgTexBias (sampler2D t, vec2 uv, float bias) { return texture(t, uv); }
vec4 sgTexGrad (sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return texture(t, uv); }
vec4 sgTexCubeLod (samplerCube t, vec3 d, float lod) { return texture(t, d); }
vec4 sgTex2DLodLegacy (sampler2D t, vec4 uv) { return texture(t, uv.xy); }
vec3 sgTangentViewDir () { return vec3(0.0); }`;
  const lightingSigs = usesLighting ? LIGHTING_2D : '';
  // project override file: functions replacing graph/custom functions + the uniforms those functions need
  // (emitted only when a stage reaches an override function)
  const overrideUniforms = { blocks: [], samplers: [], yaml: [] };
  const overrideGlobals = [];
  const overrideCode = ((options.overrides && options.overrides.functions) || '')
    .replace(/\buniform\s+(\w+)\s*\{([^}]*)\}\s*;/g, (whole, block, body) => {
      overrideUniforms.blocks.push(`uniform ${block} {\n${body.split(';').map((m) => m.trim()).filter(Boolean).map((m) => `    ${m};`).join('\n')}\n  };`);
      for (const m of body.matchAll(/(\w+)\s+(\w+)\s*;/g)) {
        overrideGlobals.push([m[2], m[1]]);
        if (m[1] === 'vec4') overrideUniforms.yaml.push(`${m[2]}: { value: [0, 0, 0, 0], editor: { visible: false } }`);
      }
      return '';
    })
    .replace(/\buniform\s+(sampler2D|samplerCube)\s+(\w+)\s*;/g, (whole, type, n) => {
      overrideUniforms.samplers.push(`uniform ${type} ${n};`);
      overrideGlobals.push([n, type]);
      overrideUniforms.yaml.push(`${n}: { value: ${type === 'samplerCube' ? 'default-cube' : 'white'}, editor: { visible: false } }`);
      return '';
    });
  const overrideUniformBlocks = [];
  const external = functionSignatures([SHIMS, stageHelpers, lightingSigs, overrideCode].join('\n'));
  const globals = [...globalTypes, ...overrideGlobals];
  for (const [n, [t]] of Object.entries(ENGINE_GLOBALS)) globals.push([n, t]);
  globals.push(['sgLightUse', 'vec4'], ['sgLightSample', 'vec4'], ['sgLightConst0', 'vec4'], ['sgLightConst1', 'vec4'], ['sgLightConst2', 'vec4'], ['sgLightConst3', 'vec4']);
  for (const t of colorPass.textures) globals.push([t.name, /CUBE/.test(t.kind) && !latlongCubes.has(t.name) ? 'samplerCube' : 'sampler2D']);
  for (const [n, t] of ['cc_time:vec4', 'cc_screenSize:vec4', 'cc_cameraPos:vec4', 'cc_matView:mat4', 'cc_matViewInv:mat4', 'cc_matProj:mat4', 'cc_matViewProj:mat4', 'cc_nearFar:vec4'].map((x) => x.split(':'))) globals.push([n, t]);
  globals.push(['sgMatWorld', 'mat4'], ['sgMatWorldIT', 'mat4']);

  const structs = [];
  const inputStruct = (nm, fields) => `struct ${nm} {\n${(fields.length ? fields : [{ type: 'float', name: 'sgUnused' }]).map((f) => `  ${glslType(f.type) || f.type} ${f.name};`).join('\n')}\n};`;
  structs.push(inputStruct('VertexDescriptionInputs', colorPass.vertexInputs));
  structs.push(inputStruct('SurfaceDescriptionInputs', colorPass.surfaceInputs));
  if (normalPass) structs.push(inputStruct('SurfaceDescriptionInputsN', normalPass.surfaceInputs));
  const gradientCode = ctx.gradients.map(gradientFunction).join('\n\n');
  // normal pass helpers the colour pass does not define
  const program = new Program({ externalFunctions: external.functions, structs: external.structs, globals, globalExprs });
  const graphSource = [structs.join('\n\n'), gradientCode, includeCode.join('\n'), funcs, normalPass ? dedupeFunctions(nFuncs, funcs) : '', vtx, pix, nPix].join('\n');
  let typed;
  try {
    typed = program.transform(graphSource);
  } catch (error) {
    report('high', 'SG_TYPED_PASS', `typed lowering failed: ${error.message}`);
    result.disposition = 'failed';
    return result;
  }
  if (/\bSG_UNSUPPORTED_MATRIX_|\bUnity(Texture|SamplerState)\w*\b/.test(typed)) report('high', 'SG_UNLOWERED', 'HLSL-only texture/sampler or matrix types remain after lowering');

  // equirect images standing in for Unity cube maps: direction -> lat-long uv
  if (latlongCubes.size) {
    typed = replaceCall(typed, 'texture', (args) => (args.length === 2 && latlongCubes.has(args[0].trim()) ? `texture(${args[0]}, sgLatLongUV(${args[1]}))` : null));
    typed = replaceCall(typed, 'sgTexCubeLod', (args) => (args.length === 3 && latlongCubes.has(args[0].trim()) ? `sgTexLod(${args[0]}, sgLatLongUV(${args[1]}), ${args[2]})` : null));
  }
  // sRGB decode of colour textures
  if (colorSpace === 'gamma' && srgbTextures.length) {
    const set = new Set(srgbTextures);
    for (const fn of ['texture', 'sgTexLod', 'sgTexBias', 'sgTexGrad']) {
      typed = replaceCall(typed, fn, (args) => (args.length && set.has(args[0].trim()) ? `sgDecodeSRGB(${fn}(${args.join(', ')}))` : null));
    }
  }
  if (/\bHash_Tchou_/.test(typed)) report('medium', 'SG_ES1_HASH', 'Tchou hashes are exact in WebGL2; WebGL1 (no integer ops) uses sine hashes, so noise patterns differ there');

  // ---- assemble ---------------------------------------------------------------------------------------------
  const usedGlobals = Object.entries(ENGINE_GLOBALS).filter(([n]) => new RegExp(`\\b${n}\\b`).test(typed));
  for (const [n] of usedGlobals) if (REPORTED_GLOBALS[n]) report(...REPORTED_GLOBALS[n]);
  const defines = usedGlobals.map(([n, [, def]]) => `#ifndef ${n}\n#define ${n} ${def}\n#endif`).join('\n');
  const pool = splitItems([SHIMS, usesLighting ? LIGHTING_2D : '', overrideCode, typed].join('\n'));
  // roots: the description functions plus every helper the generated vert()/frag() bodies call
  const fragInputExprs = (fields) => fields.map((f) => (FRAGMENT_INPUTS[f.name] || [''])[0]).join('\n');
  const vsRoots = ['VertexDescriptionFunction', colorPass.vertexInputs.map((f) => VERTEX_INPUTS[f.name] || '').join('\n'),
    vertexColor === 'srgb' ? 'sgSRGBToLinear' : ''];
  const fsRoots = ['SurfaceDescriptionFunction', fragInputExprs(colorPass.surfaceInputs), target.lit ? 'sgCombinedShapeLight' : '',
    colorSpace === 'gamma' && target.kind === '2d' ? 'sgLinearToSRGB' : ''];
  const vsFuncs = pruneItems(pool, vsRoots);
  const fsFuncs = pruneItems(pool, fsRoots);
  const nsFuncs = normalPass ? pruneItems(pool, ['SurfaceDescriptionFunctionN', fragInputExprs(normalPass.surfaceInputs)]) : '';
  const allStageCode = vsFuncs + fsFuncs + nsFuncs;
  if (overrideNames.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(allStageCode))) {
    overrideUniformBlocks.push(...overrideUniforms.blocks);
    samplerDecls.push(...overrideUniforms.samplers);
    yaml.push(...overrideUniforms.yaml);
    report('medium', 'SG_PROJECT_OVERRIDE', `project override functions used: ${overrideNames.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(allStageCode)).join(', ')}`);
  }
  // typed-pass findings count only in code a stage actually compiles
  for (const d of program.diagnostics) if (!d.fn || new RegExp(`\\b${d.fn}\\s*\\(`).test(allStageCode)) report(d.severity, d.code, d.fn ? `${d.fn}: ${d.message}` : d.message);
  if (/\bdFdx|\bdFdy|\bfwidth/.test(vsFuncs)) report('high', 'SG_VERTEX_DERIVATIVE', 'the vertex stage reaches a derivative (ddx/ddy/fwidth): not available in vertex shaders');

  const inputsUsed = (fields) => fields.map((f) => f.name);
  const fragFields = inputsUsed(colorPass.surfaceInputs);
  const nFields = normalPass ? inputsUsed(normalPass.surfaceInputs) : [];
  const needs = new Set(['uv0', 'color']);
  for (const f of [...fragFields, ...nFields]) {
    const b = FRAGMENT_INPUTS[f];
    if (!b) { report('high', 'SG_INPUT_UNSUPPORTED', `SurfaceDescriptionInputs.${f} has no Cocos binding`); continue; }
    for (const v of b[1]) needs.add(v);
  }
  if (target.lit || normalPass) needs.add('clip');
  if (normalPass) { needs.add('normalWS'); needs.add('tangentWS'); }
  for (const f of colorPass.vertexInputs) if (!VERTEX_INPUTS[f.name]) report('high', 'SG_INPUT_UNSUPPORTED', `VertexDescriptionInputs.${f.name} has no Cocos binding`);
  if (fragFields.includes('TangentSpaceViewDirection')) report('medium', 'SG_INPUT_APPROX', 'TangentSpaceViewDirection is not reconstructed (zero vector)');

  const varyings = [];
  if (needs.has('uv0')) varyings.push(['vec4', 'v_uv0']);
  for (const u of ['uv1', 'uv2', 'uv3']) if (needs.has(u)) varyings.push(['vec4', `v_${u}`]);
  if (needs.has('color')) varyings.push(['vec4', 'v_color']);
  if (needs.has('posWS')) varyings.push(['vec3', 'v_posWS']);
  if (needs.has('posOS')) varyings.push(['vec3', 'v_posOS']);
  if (needs.has('normalWS')) varyings.push(['vec3', 'v_normalWS']);
  if (needs.has('tangentWS')) varyings.push(['vec4', 'v_tangentWS']);
  if (needs.has('clip')) varyings.push(['vec4', 'v_clip']);
  const varyingDecl = (dir) => varyings.map(([t, n]) => `  ${dir} ${t} ${n};`).join('\n');

  const attributes = ['  in vec3 a_position;', '  in vec2 a_texCoord;', '  in vec4 a_color;'];
  const vUses = (s) => new RegExp(`\\b${s}\\b`).test(vsFuncs) || colorPass.vertexInputs.some((f) => (VERTEX_INPUTS[f.name] || '').includes(s));
  const needNormalAttr = needs.has('normalWS') || colorPass.vertexInputs.some((f) => /Normal|BiTangent/.test(f.name));
  const needTangentAttr = needs.has('tangentWS') || colorPass.vertexInputs.some((f) => /Tangent/.test(f.name));
  if (needNormalAttr || target.kind === '3d') attributes.push('  in vec3 a_normal;');
  if (needTangentAttr) attributes.push('  in vec4 a_tangent;');
  for (let k = 1; k <= 3; k++) if (needs.has(`uv${k}`) || vUses(`a_texCoord${k}`)) attributes.push(`  in vec2 a_texCoord${k};`);

  const vBind = colorPass.vertexInputs.filter((f) => VERTEX_INPUTS[f.name]).map((f) => `    IN.${f.name} = ${VERTEX_INPUTS[f.name]};`).join('\n');
  const fBind = (fields) => fields.filter((f) => FRAGMENT_INPUTS[f.name]).map((f) => `    IN.${f.name} = ${FRAGMENT_INPUTS[f.name][0]};`).join('\n');
  const outputs = new Set(colorPass.surfaceOutputs.map((f) => f.name));
  const has = (d) => colorPass.defines.has(d);
  const alphaClip = (has('ALPHA_CLIP_THRESHOLD') || has('_ALPHATEST_ON')) && outputs.has('AlphaClipThreshold');
  const legacySprite = has('UNIVERSAL_USELEGACYSPRITEBLOCKS') && outputs.has('SpriteColor');
  const colorExpr = legacySprite ? 's.SpriteColor'
    : `vec4(${outputs.has('BaseColor') ? 's.BaseColor' : 'vec3(1.0)'}, ${outputs.has('Alpha') ? 's.Alpha' : '1.0'})`;
  const tint = target.kind === '2d' && !has('_DISABLE_COLOR_TINT');
  // linear: the project owns the linear frame (HDR target + its own final encode), so 3D targets pass through too
  // instead of CCFragOutput's builtin-pipeline encode
  const outputLine = colorSpace === 'linear' ? 'return color;'
    : (target.kind === '3d' ? 'return CCFragOutput(color);' : 'return vec4(sgLinearToSRGB(color.rgb), color.a);');
  const objectSpace = target.sprite
    ? `#if USE_LOCAL
  #include <builtin/uniforms/cc-local>
  #define sgMatWorld cc_matWorld
  #define sgMatWorldIT cc_matWorldIT
#else
  // batched sprite vertices are already in world space (builtin-sprite convention): object space == world space
  #define sgMatWorld mat4(1.0)
  #define sgMatWorldIT mat4(1.0)
#endif`
    : `#include <builtin/uniforms/cc-local>
#define sgMatWorld cc_matWorld
#define sgMatWorldIT cc_matWorldIT`;
  if (target.sprite && /\bsgMatWorld\b/.test(allStageCode + vBind)) report('medium', 'SG_SPRITE_OBJECT_SPACE', 'object-space nodes on batched sprites see world space unless the material enables USE_LOCAL');

  const blend = colorPass.state.blend;
  const blendOn = !!blend && !(blend[0] === 'One' && blend[1] === 'Zero');
  const passState = (state, extra = '') => {
    const b = state.blend;
    const on = !!b && !(b[0] === 'One' && b[1] === 'Zero');
    const depthTest = !['Off', 'Always'].includes(state.ztest) || state.zwrite === 'On';
    const lines = [
      `      depthStencilState: { depthTest: ${depthTest}, depthWrite: ${state.zwrite === 'On'}${DEPTH_FUNC[state.ztest] && state.ztest !== 'LEqual' ? `, depthFunc: ${DEPTH_FUNC[state.ztest]}` : ''} }`,
      '      blendState:',
      '        targets:',
      `        - blend: ${on}`,
    ];
    if (on) {
      lines.push(`          blendSrc: ${BLEND[b[0]] || 'one'}`, `          blendDst: ${BLEND[b[1]] || 'zero'}`,
        `          blendSrcAlpha: ${BLEND[b[2] || b[0]] || 'one'}`, `          blendDstAlpha: ${BLEND[b[3] || b[1]] || 'zero'}`);
    }
    lines.push(`      rasterizerState: { cullMode: ${{ Off: 'none', Back: 'back', Front: 'front' }[state.cull] || 'back'} }`);
    return lines.join('\n') + extra;
  };
  if (usesLighting) {
    yaml.push('sgLightUse: { value: [1, 0, 0, 0], editor: { visible: false } }', 'sgLightSample: { value: [0, 0, 0, 0], editor: { visible: false } }',
      'sgLightConst0: { value: [1, 1, 1, 1], editor: { type: color, visible: false } }', 'sgLightConst1: { value: [0, 0, 0, 0], editor: { type: color, visible: false } }',
      'sgLightConst2: { value: [0, 0, 0, 0], editor: { type: color, visible: false } }', 'sgLightConst3: { value: [0, 0, 0, 0], editor: { type: color, visible: false } }',
      'sgLightTexture0: { value: white, editor: { visible: false } }', 'sgLightTexture1: { value: black, editor: { visible: false } }',
      'sgLightTexture2: { value: black, editor: { visible: false } }', 'sgLightTexture3: { value: black, editor: { visible: false } }');
    report('medium', 'SG_2D_LIGHTS', 'URP 2D lighting reads sgLightTexture0..3 / sgLightUse / sgLightSample / sgLightConst0..3; bind them from the project 2D light system (defaults render unlit)');
  }
  const propsYaml = yaml.length ? yaml.map((l) => `        ${l}`).join('\n') : '';
  const fragPrelude = `  #if __VERSION__ >= 300
  vec4 sgTexLod (sampler2D t, vec2 uv, float lod) { return textureLod(t, uv, lod); }
  vec4 sgTexBias (sampler2D t, vec2 uv, float bias) { return texture(t, uv, bias); }
  vec4 sgTexGrad (sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(t, uv, dx, dy); }
  vec4 sgTexCubeLod (samplerCube t, vec3 d, float lod) { return textureLod(t, d, lod); }
  #else
  // GLSL ES 1.00 fragment stage: no explicit-LOD sampling without EXT_shader_texture_lod -> base sampling
  vec4 sgTexLod (sampler2D t, vec2 uv, float lod) { return texture2D(t, uv); }
  vec4 sgTexBias (sampler2D t, vec2 uv, float bias) { return texture2D(t, uv, bias); }
  vec4 sgTexGrad (sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return texture2D(t, uv); }
  vec4 sgTexCubeLod (samplerCube t, vec3 d, float lod) { return textureCube(t, d); }
  #endif
  vec4 sgTex2DLodLegacy (sampler2D t, vec4 uv) { return sgTexLod(t, uv.xy, uv.w); }`;
  const vertPrelude = `  #if __VERSION__ >= 300
  vec4 sgTexLod (sampler2D t, vec2 uv, float lod) { return textureLod(t, uv, lod); }
  vec4 sgTexCubeLod (samplerCube t, vec3 d, float lod) { return textureLod(t, d, lod); }
  #else
  vec4 sgTexLod (sampler2D t, vec2 uv, float lod) { return texture2DLod(t, uv, lod); }
  vec4 sgTexCubeLod (samplerCube t, vec3 d, float lod) { return textureCubeLod(t, d, lod); }
  #endif
  // no bias / gradients in the vertex stage (implicit LOD is the base level there)
  vec4 sgTexBias (sampler2D t, vec2 uv, float bias) { return sgTexLod(t, uv, 0.0); }
  vec4 sgTexGrad (sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return sgTexLod(t, uv, 0.0); }
  vec4 sgTex2DLodLegacy (sampler2D t, vec4 uv) { return sgTexLod(t, uv.xy, uv.w); }`;
  const tangentViewDir = fragFields.includes('TangentSpaceViewDirection') ? '' : '';
  const needsHelper = (code, n) => new RegExp(`\\b${n}\\b`).test(code);
  const pickPrelude = (prelude, code) => {
    const lines = prelude.split('\n');
    let scope = code;
    let kept = lines;
    for (let pass = 0; pass < 3; pass++) { // helpers calling helpers (sgTexBias -> sgTexLod)
      kept = lines.filter((l) => {
        const m = /^\s*vec4\s+(\w+)\s*\(/.exec(l);
        return !m || needsHelper(scope, m[1]);
      });
      scope = code + kept.filter((l) => /^\s*vec4\s+\w+\s*\(/.test(l)).map((l) => l.replace(/^\s*vec4\s+\w+/, '')).join('\n');
    }
    return kept.some((l) => /^\s*vec4\s+\w+\s*\(/.test(l)) ? kept.join('\n') : '';
  };
  const derivExt = (code) => (/\b(dFdx|dFdy|fwidth)\s*\(/.test(code) ? '  #pragma extension([GL_OES_standard_derivatives, __VERSION__ < 300])\n' : '');
  const fragBody = (inputsName, fnName, descName, fields, pass, normals) => {
    const lines = [`    ${inputsName} IN;`, fBind(fields), `    ${descName} s = ${fnName}(IN);`];
    if (normals) {
      const outs = new Set(pass.surfaceOutputs.map((f) => f.name));
      const legacy = pass.defines.has('UNIVERSAL_USELEGACYSPRITEBLOCKS') && outs.has('SpriteColor');
      lines.push(`    vec4 color = ${legacy ? 's.SpriteColor' : `vec4(1.0, 1.0, 1.0, ${outs.has('Alpha') ? 's.Alpha' : '1.0'})`};`);
      if ((pass.defines.has('ALPHA_CLIP_THRESHOLD') || pass.defines.has('_ALPHATEST_ON')) && outs.has('AlphaClipThreshold')) lines.push('    if (color.a - s.AlphaClipThreshold < 0.0) discard;');
      lines.push('    vec3 bitangent = v_tangentWS.w * cross(v_normalWS, v_tangentWS.xyz);');
      lines.push(`    vec3 n = ${outs.has('NormalTS') ? 'normalize(s.NormalTS.x * v_tangentWS.xyz + s.NormalTS.y * bitangent + s.NormalTS.z * v_normalWS)' : 'normalize(v_normalWS)'};`);
      lines.push('    return vec4(0.5 * (n + 1.0), color.a);');
      return lines.join('\n');
    }
    lines.push(`    vec4 color = ${colorExpr};`);
    if (target.sprite && !target.lit) lines.push('    if (color.a == 0.0) discard;');
    if (alphaClip) lines.push('    if (color.a - s.AlphaClipThreshold < 0.0) discard;');
    if (tint) lines.push('    color *= v_color;');
    if (target.lit) {
      lines.push('    vec2 lightingUV = (v_clip.xy / v_clip.w) * 0.5 + 0.5;');
      lines.push(`    color = sgCombinedShapeLight(color, ${outputs.has('SpriteMask') ? 's.SpriteMask' : 'vec4(1.0)'}, lightingUV);`);
    }
    lines.push(`    ${outputLine}`);
    return lines.join('\n');
  };
  const vColor = vertexColor === 'srgb' ? 'vec4(sgSRGBToLinear(a_color.rgb), a_color.a)' : 'a_color';
  const vertLines = [
    '    VertexDescriptionInputs IN;',
    vBind.replace(/IN\.VertexColor = a_color;/, `IN.VertexColor = ${vColor};`),
    '    VertexDescription d = VertexDescriptionFunction(IN);',
    '    vec4 world = sgMatWorld * vec4(d.Position, 1.0);',
    needs.has('posWS') ? '    v_posWS = world.xyz;' : '',
    needs.has('posOS') ? '    v_posOS = d.Position;' : '',
    needs.has('uv0') ? '    v_uv0 = vec4(a_texCoord, 0.0, 0.0);' : '',
    ...[1, 2, 3].map((k) => (needs.has(`uv${k}`) ? `    v_uv${k} = vec4(a_texCoord${k}, 0.0, 0.0);` : '')),
    needs.has('color') ? `    v_color = ${vColor};` : '',
    needs.has('normalWS') ? `    v_normalWS = normalize((sgMatWorldIT * vec4(${colorPass.vertexOutputs.some((f) => f.name === 'Normal') ? 'd.Normal' : 'a_normal'}, 0.0)).xyz);` : '',
    needs.has('tangentWS') ? `    v_tangentWS = vec4(normalize((sgMatWorld * vec4(${colorPass.vertexOutputs.some((f) => f.name === 'Tangent') ? 'd.Tangent' : 'a_tangent.xyz'}, 0.0)).xyz), a_tangent.w);` : '',
    '    vec4 clip = cc_matViewProj * world;',
    needs.has('clip') ? '    v_clip = clip;' : '',
    '    return clip;',
  ].filter(Boolean).join('\n');

  const header = `// GENERATED by playable-shared-kit/tools/shader-compiler/shadergraph-codegen.cjs from Unity ShaderGraph "${parsed.shaderName}" (${parsed.targetId}, ${colorPass.passInclude}) - do not edit.
// Colour space: ${colorSpace}. Diagnostics: ${result.diagnostics.length ? result.diagnostics.map((d) => `${d.severity} ${d.code}`).join(', ') : 'none'}.`;
  const effect = `${header}
CCEffect %{
  techniques:
  - name: ${blendOn ? 'transparent' : 'opaque'}
    passes:
    - vert: sg-vs:vert
      frag: sg-fs:frag
${passState(colorPass.state)}
      properties:${propsYaml ? ` &props\n${propsYaml}` : ' {}'}${normalPass ? `
  - name: normals
    passes:
    - vert: sg-vs:vert
      frag: sg-normals-fs:frag
      depthStencilState: { depthTest: false, depthWrite: false }
      blendState:
        targets:
        - blend: true
          blendSrc: src_alpha
          blendDst: one_minus_src_alpha
          blendSrcAlpha: one
          blendDstAlpha: one_minus_src_alpha
      rasterizerState: { cullMode: ${{ Off: 'none', Back: 'back', Front: 'front' }[normalPass.state.cull] || 'back'} }
      properties:${propsYaml ? ' *props' : ' {}'}` : ''}
}%

CCProgram sg-common %{
  #include <builtin/uniforms/cc-global>
${objectSpace.split('\n').map((l) => `  ${l}`).join('\n')}
${overrideUniformBlocks.map((b) => `  ${b}`).join('\n')}
${uboMembers.length ? `  uniform SGMaterial {\n${uboMembers.map((m) => `    ${m}`).join('\n')}\n  };` : ''}
${usesLighting ? '  uniform SGLighting {\n    vec4 sgLightUse;\n    vec4 sgLightSample;\n    vec4 sgLightConst0;\n    vec4 sgLightConst1;\n    vec4 sgLightConst2;\n    vec4 sgLightConst3;\n  };\n  uniform sampler2D sgLightTexture0;\n  uniform sampler2D sgLightTexture1;\n  uniform sampler2D sgLightTexture2;\n  uniform sampler2D sgLightTexture3;' : ''}
${samplerDecls.map((s) => `  ${s}`).join('\n')}
${defines.split('\n').filter(Boolean).map((l) => `  ${l}`).join('\n')}
}%

CCProgram sg-vs %{
  precision highp float;
  #include <sg-common>
${pickPrelude(vertPrelude, vsFuncs)}
${attributes.join('\n')}
${varyingDecl('out')}

${indent(vsFuncs)}

  vec4 vert () {
${vertLines}
  }
}%

CCProgram sg-fs %{
  precision highp float;
${derivExt(fsFuncs)}  #include <sg-common>
${target.kind === '3d' && colorSpace !== 'linear' ? '  #include <legacy/output>\n' : ''}${pickPrelude(fragPrelude, fsFuncs)}
${varyingDecl('in')}

${indent(fsFuncs)}

  vec4 frag () {
${fragBody('SurfaceDescriptionInputs', 'SurfaceDescriptionFunction', 'SurfaceDescription', colorPass.surfaceInputs, colorPass, false)}
  }
}%
${normalPass ? `
CCProgram sg-normals-fs %{
  precision highp float;
${derivExt(nsFuncs)}  #include <sg-common>
${pickPrelude(fragPrelude, nsFuncs)}
${varyingDecl('in')}

${indent(nsFuncs)}

  vec4 frag () {
${fragBody('SurfaceDescriptionInputsN', 'SurfaceDescriptionFunctionN', 'SurfaceDescriptionN', normalPass.surfaceInputs, normalPass, true)}
  }
}%
` : ''}`;
  result.effect = effect.replace(/\n{3,}/g, '\n\n');
  result.disposition = 'generated';
  void tangentViewDir;
  return result;
}

/** Remove a classic `#ifndef X / #define X ... #endif` include guard. */
function stripIncludeGuard(text) {
  const m = /^[ \t]*#ifndef[ \t]+(\w+)[ \t]*\n[ \t]*#define[ \t]+\1\b[^\n]*\n/m.exec(text);
  if (!m) return text;
  const body = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  const last = body.lastIndexOf('#endif');
  return last < 0 ? body : body.slice(0, last) + body.slice(last).replace(/^#endif[^\n]*/, '');
}

function indent(code) {
  return code.split('\n').map((l) => (l.trim() ? `  ${l}` : '')).join('\n');
}

/** Functions/structs of the normal pass not already defined by the colour pass. */
function dedupeFunctions(extra, base) {
  const have = new Set();
  for (const m of base.matchAll(/^[ \t]*(?:struct\s+(\w+)|(?:void|float|vec[234]|mat[234]|int|bool|[A-Z]\w*)\s+(\w+)\s*\([^)]*\))/gm)) have.add(m[0].replace(/\s+/g, ' ').trim());
  const items = splitItems(extra);
  return items.filter((it) => {
    if (it.kind !== 'function' && it.kind !== 'struct') return true;
    const head = (/^[ \t]*(?:struct\s+\w+|(?:void|float|vec[234]|mat[234]|int|bool|[A-Z]\w*)\s+\w+\s*\([^)]*\))/m.exec(it.text) || [''])[0].replace(/\s+/g, ' ').trim();
    return !have.has(head);
  }).map((it) => it.text).join('\n');
}

module.exports = { generateEffect, splitItems, pruneItems, ENGINE_GLOBALS, TARGETS };
