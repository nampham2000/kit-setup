'use strict';
/**
 * Textual HLSL -> GLSL lowering of Unity ShaderGraph generated code (runs before the typed pass):
 * type names, intrinsic names, statement intrinsics (sincos, clip), URP texture/sampler struct model, gradient
 * literals, engine globals, hybrid-instancing wrappers. Everything that needs types (implicit conversions,
 * scalar swizzles, mixed-type intrinsics, mul) is left to sg-program / sg-glsl-types.
 *
 * Texture model (GLSL ES 1.00 cannot keep samplers in local structs): UnityTexture2D values are resolved at compile
 * time. A local `UnityTexture2D x = UnityBuildTexture2DStruct(_Tex)` becomes an alias of `_Tex`; `.tex` is the
 * sampler, `.texelSize` the `_Tex_TexelSize` uniform, `.scaleTranslate` `_Tex_ST`, `.GetTransformedUV(uv)` applies
 * `_Tex_ST` (identity for the NoScale builder). A subgraph parameter `UnityTexture2D p` becomes three parameters
 * (`sampler2D p, vec4 p_sgST, vec4 p_sgTexelSize`) and every call site passes the matching triple. UnitySamplerState
 * values/parameters are dropped (Cocos keeps sampler state on the texture asset) and reported.
 */
const { replaceCall, replaceCallStatement, splitArgs, matchParen } = require('../call-rewriter.cjs');

const TYPE_RENAMES = [
  [/\b(?:half|min16float|min10float|real)([1-4])x([1-4])\b/g, (m, a, b) => (a === b ? `mat${a}` : `SG_UNSUPPORTED_MATRIX_${a}x${b}`)],
  [/\bfloat([1-4])x([1-4])\b/g, (m, a, b) => (a === b ? `mat${a}` : `SG_UNSUPPORTED_MATRIX_${a}x${b}`)],
  [/\b(?:half|min16float|min10float|real)([2-4])\b/g, 'vec$1'],
  [/\b(?:half|min16float|min10float|real)1?\b/g, 'float'],
  [/\bfloat([2-4])\b/g, 'vec$1'],
  [/\bfloat1\b/g, 'float'],
  [/\b(?:min16)?u?int([2-4])\b/g, 'ivec$1'],
  [/\b(?:min16)?uint1?\b/g, 'int'],
  [/\bint1\b/g, 'int'],
  [/\bbool([2-4])\b/g, 'bvec$1'],
];

const CALL_RENAMES = {
  lerp: 'mix', frac: 'fract', rsqrt: 'inversesqrt', atan2: 'atan', fmod: 'sgFmod',
  ddx: 'dFdx', ddy: 'dFdy', ddx_coarse: 'dFdx', ddy_coarse: 'dFdy', ddx_fine: 'dFdx', ddy_fine: 'dFdy',
  saturate: 'sgSaturate', round: 'sgRound', trunc: 'sgTrunc', log10: 'sgLog10', rcp: 'sgRcp', exp10: 'sgExp10',
  transpose: 'sgTranspose', determinant: 'sgDeterminant', isnan: 'sgIsNan', isinf: 'sgIsInf',
  SRGBToLinear: 'sgSRGBToLinear', LinearToSRGB: 'sgLinearToSRGB', FastSRGBToLinear: 'sgSRGBToLinear', FastLinearToSRGB: 'sgLinearToSRGB',
  UnpackNormal: 'sgUnpackNormal', UnpackNormalRGB: 'sgUnpackNormalRGB', UnpackNormalRGBNoScale: 'sgUnpackNormalRGBNoScale',
  UnpackNormalmapRGorAG: 'sgUnpackNormal', UnpackNormalAG: 'sgUnpackNormal', UnpackNormalScale: 'sgUnpackNormalScale',
  tex2D: 'texture', tex2Dlod: 'sgTex2DLodLegacy', texCUBE: 'texture',
  GetCameraRelativePositionWS: '', GetAbsolutePositionWS: '',
};

const UNSUPPORTED_CALLS = {
  asuint: 'bit casts have no GLSL ES 1.00 form', asfloat: 'bit casts have no GLSL ES 1.00 form', asint: 'bit casts have no GLSL ES 1.00 form',
  SHADERGRAPH_SAMPLE_SCENE_DEPTH: 'camera depth texture (Scene Depth node) has no Cocos equivalent in a playable effect',
  SHADERGRAPH_SAMPLE_SCENE_COLOR: 'camera opaque texture (Scene Color node) has no Cocos equivalent in a playable effect',
  SHADERGRAPH_SAMPLE_SCENE_NORMAL: 'camera normals texture has no Cocos equivalent',
  SAMPLE_TEXTURE2D_ARRAY: 'Texture2DArray sampling is GLSL ES 3.00 only',
  SAMPLE_TEXTURE3D: 'Texture3D sampling is GLSL ES 3.00 only',
  LOAD_TEXTURE2D: 'texel fetch (Load) is GLSL ES 3.00 only',
};

function diag(ctx, severity, code, message) {
  if (!ctx.diagnostics.some((d) => d.code === code && d.message === message)) ctx.diagnostics.push({ severity, code, message });
}

function renameCalls(s) {
  for (const [from, to] of Object.entries(CALL_RENAMES)) {
    s = s.replace(new RegExp(`\\b${from}\\s*\\(`, 'g'), to ? `${to}(` : '(');
  }
  return s;
}

/** Texture expression -> { tex, st, texel } for a UnityTexture2D value (alias name, builder call, parameter). */
function textureOf(expr, ctx) {
  const e = String(expr).trim();
  let m = /^UnityBuildTexture2DStruct(NoScale)?\s*\(\s*(\w+)\s*\)$/.exec(e);
  if (m) {
    const tex = m[2];
    return { tex, st: m[1] ? null : (ctx.materialProps.has(`${tex}_ST`) ? `${tex}_ST` : null), texel: ctx.materialProps.has(`${tex}_TexelSize`) ? `${tex}_TexelSize` : null, kind: '2D' };
  }
  m = /^UnityBuildTextureCubeStruct\s*\(\s*(\w+)\s*\)$/.exec(e);
  if (m) return { tex: m[1], st: null, texel: null, kind: 'Cube' };
  m = /^Unity_GetLightTexture([0-3])\s*\(\s*\)$/.exec(e);
  if (m) return { tex: `sgLightTexture${m[1]}`, st: null, texel: null, kind: '2D', light: Number(m[1]) };
  if (ctx.textureAliases.has(e)) return ctx.textureAliases.get(e);
  if (ctx.textureParams.has(e)) return { tex: e, st: `${e}_sgST`, texel: `${e}_sgTexelSize`, kind: ctx.textureParams.get(e), param: true };
  return null;
}

function stExpr(t) { return t && t.st ? t.st : 'vec4(1.0, 1.0, 0.0, 0.0)'; }
function texelExpr(t, ctx) {
  if (t && t.texel) return t.texel;
  if (t && !t.param) diag(ctx, 'medium', 'SG_TEXEL_SIZE_DEFAULT', `${t.tex}.texelSize has no _TexelSize uniform; using 1/1024`);
  return 'vec4(0.0009765625, 0.0009765625, 1024.0, 1024.0)';
}

/**
 * Lower texture struct usage in one function body / section. Aliases are tracked per call of this function
 * (function bodies are lowered separately, see lowerFunctions()).
 */
function lowerTextures(code, ctx) {
  let s = code;
  // local aliases: UnityTexture2D x = <texture expression>;
  s = s.replace(/\b(UnityTexture2D|UnityTextureCube|UnityTexture2DArray|UnityTexture3D)\s+(\w+)\s*=\s*([^;]+);/g, (whole, type, name, rhs) => {
    if (type === 'UnityTexture2DArray' || type === 'UnityTexture3D') {
      diag(ctx, 'high', 'SG_UNSUPPORTED_TEXTURE', `${type} ${name}: GLSL ES 1.00 has no ${type.replace('Unity', '')}`);
      return '';
    }
    const t = textureOf(rhs, ctx);
    if (!t) { diag(ctx, 'high', 'SG_TEXTURE_UNRESOLVED', `cannot resolve texture value '${rhs.trim()}' for ${name}`); return ''; }
    ctx.textureAliases.set(name, t);
    ctx.usedTextures.add(t.tex);
    return '';
  });
  s = s.replace(/\bUnitySamplerState\s+(\w+)\s*=\s*[^;]+;/g, (whole, name) => { ctx.samplerAliases.add(name); return ''; });
  s = s.replace(/\bSamplerState\s+(\w+)\s*=\s*[^;]+;/g, (whole, name) => { ctx.samplerAliases.add(name); return ''; });

  const texArg = (arg) => {
    const a = String(arg).trim();
    let m = /^(.+)\.tex$/.exec(a);
    const t = textureOf(m ? m[1] : a, ctx);
    if (t) { ctx.usedTextures.add(t.tex); return t; }
    if (/^\w+$/.test(a)) return { tex: a, st: null, texel: null, kind: ctx.textureKinds.get(a) || '2D' };
    return null;
  };
  const lodCall = (kind) => (kind === 'Cube' ? 'sgTexCubeLod' : 'sgTexLod');
  // HLSL texture object methods (custom function files): tex.Sample(ss, uv), SampleLevel, SampleBias, SampleGrad
  const methodCalls = new Set();
  s = s.replace(/\b(\w+)\.(Sample|SampleLevel|SampleBias|SampleGrad)\s*\(/g, (whole, t, m) => {
    const name = `SGMETHOD_${m}__${t}`;
    methodCalls.add(name);
    return `${name}(`;
  });
  for (const name of methodCalls) {
    const [, m, t] = /^SGMETHOD_(\w+?)__(\w+)$/.exec(name);
    s = replaceCall(s, name, (args) => {
      const tex = (textureOf(t, ctx) || { tex: t }).tex;
      ctx.usedTextures.add(tex);
      if (m === 'Sample') return `texture(${tex}, ${args[1]})`;
      if (m === 'SampleLevel') return `${lodCall(ctx.textureKinds.get(tex))}(${tex}, ${args[1]}, ${args[2]})`;
      if (m === 'SampleBias') return `sgTexBias(${tex}, ${args[1]}, ${args[2]})`;
      return `sgTexGrad(${tex}, ${args[1]}, ${args[2]}, ${args[3]})`;
    });
  }
  if (/\.GetDimensions\s*\(/.test(s)) diag(ctx, 'high', 'SG_TEXTURE_QUERY', 'Texture.GetDimensions has no GLSL ES 1.00 form (pass the size as a property)');
  // uv transform of any texture value (alias, parameter, inline builder, light texture)
  s = s.replace(/(UnityBuildTexture2DStruct(?:NoScale)?\s*\(\s*\w+\s*\)|Unity_GetLightTexture[0-3]\s*\(\s*\)|\b\w+)\.GetTransformedUV\s*\(/g, (whole, base) => {
    const t = textureOf(base, ctx);
    if (!t) return whole;
    return t.st || t.param ? `sgTransformUV(${stExpr(t)}, ` : '(';
  });
  // SAMPLE_* macros (sampler argument dropped)
  s = replaceCall(s, ['SAMPLE_TEXTURE2D', 'SAMPLE_TEXTURECUBE'], (args) => {
    const t = texArg(args[0]);
    if (!t || args.length < 3) return null;
    if (t.light !== undefined) return `sgLightSample${t.light}(${args[2]})`;
    return `texture(${t.tex}, ${args[2]})`;
  });
  s = replaceCall(s, ['SAMPLE_TEXTURE2D_LOD', 'SAMPLE_TEXTURECUBE_LOD'], (args) => {
    const t = texArg(args[0]);
    if (!t || args.length < 4) return null;
    if (t.light !== undefined) return `sgLightSample${t.light}(${args[2]})`;
    return `${lodCall(t.kind)}(${t.tex}, ${args[2]}, ${args[3]})`;
  });
  s = replaceCall(s, ['SAMPLE_TEXTURE2D_BIAS', 'SAMPLE_TEXTURECUBE_BIAS'], (args) => {
    const t = texArg(args[0]);
    if (!t || args.length < 4) return null;
    return `sgTexBias(${t.tex}, ${args[2]}, ${args[3]})`;
  });
  s = replaceCall(s, ['SAMPLE_TEXTURE2D_GRAD'], (args) => {
    const t = texArg(args[0]);
    if (!t || args.length < 5) return null;
    diag(ctx, 'medium', 'SG_TEXTURE_GRAD', 'SAMPLE_TEXTURE2D_GRAD: explicit gradients are ignored in GLSL ES 1.00');
    return `sgTexGrad(${t.tex}, ${args[2]}, ${args[3]}, ${args[4]})`;
  });
  // struct members
  s = s.replace(/(UnityBuildTexture2DStruct(?:NoScale)?\s*\(\s*\w+\s*\)|UnityBuildTextureCubeStruct\s*\(\s*\w+\s*\)|Unity_GetLightTexture[0-3]\s*\(\s*\)|\b\w+)\.(tex|texelSize|scaleTranslate|samplerstate)\b/g, (whole, base, field) => {
    const t = textureOf(base, ctx);
    if (!t) return whole;
    ctx.usedTextures.add(t.tex);
    if (field === 'tex') return t.tex;
    if (field === 'texelSize') return texelExpr(t, ctx);
    if (field === 'scaleTranslate') return stExpr(t);
    return 'SG_SAMPLER_STATE_DROPPED';
  });
  // a bare builder call left as a value (e.g. an argument of a subgraph call handled later)
  return s;
}

/** Rewrite subgraph function signatures with UnityTexture2D / UnitySamplerState parameters. */
function lowerTextureParams(code, ctx) {
  // signatures
  return code.replace(/^([ \t]*(?:void|float|vec[234]|int|bool|mat[234]|[A-Z]\w*)\s+(\w+)\s*\()([^)]*)\)/gm, (whole, head, fname, params) => {
    if (!/\bUnity(?:Texture\w*|SamplerState)\b|\bSamplerState\b|\b[Tt]exture(?:2D|CUBE|Cube)\b|\bsampler(?:2D|CUBE)\b/.test(params)) return whole;
    const list = splitArgs(params);
    const spec = [];
    const out = [];
    for (const p of list) {
      const m = /^(?:in\s+)?(UnityTexture2D|UnityTextureCube|UnityTexture2DArray|UnityTexture3D|UnitySamplerState|SamplerState|[Tt]exture2D|[Tt]extureCUBE|TextureCube|sampler2D|samplerCUBE)\s+(\w+)$/.exec(p.trim());
      if (!m) { out.push(p); spec.push('value'); continue; }
      if (m[1] === 'UnitySamplerState' || m[1] === 'SamplerState') { spec.push('sampler'); continue; }
      if (/^([Tt]exture|sampler)/.test(m[1])) { // raw HLSL texture objects (custom function files)
        const cube = /cube/i.test(m[1]);
        ctx.textureKinds.set(m[2], cube ? 'Cube' : '2D');
        out.push(`${cube ? 'samplerCube' : 'sampler2D'} ${m[2]}`);
        spec.push('raw');
        continue;
      }
      if (m[1] === 'UnityTexture2DArray' || m[1] === 'UnityTexture3D') {
        diag(ctx, 'high', 'SG_UNSUPPORTED_TEXTURE', `${fname}: ${m[1]} parameter`);
        spec.push('value');
        out.push(`sampler2D ${m[2]}`);
        continue;
      }
      const kind = m[1] === 'UnityTextureCube' ? 'Cube' : '2D';
      ctx.textureParams.set(m[2], kind);
      out.push(kind === 'Cube' ? `samplerCube ${m[2]}` : `sampler2D ${m[2]}`, `vec4 ${m[2]}_sgST`, `vec4 ${m[2]}_sgTexelSize`);
      spec.push(kind === 'Cube' ? 'cube' : 'texture');
    }
    ctx.textureSignatures.set(fname, spec);
    return `${head}${out.join(', ')})`;
  });
}

/** Expand call sites of functions whose texture/sampler parameters were rewritten. */
function lowerTextureCallSites(code, ctx) {
  let s = code;
  for (const [fname, spec] of ctx.textureSignatures) {
    s = replaceCall(s, fname, (args) => {
      if (args.length !== spec.length) return null;
      const out = [];
      args.forEach((a, i) => {
        if (spec[i] === 'sampler') return;
        if (spec[i] === 'raw') {
          const t = textureOf(a, ctx) || textureOf(a.replace(/\.tex$/, ''), ctx);
          if (t) ctx.usedTextures.add(t.tex);
          out.push(t ? t.tex : a);
          return;
        }
        if (spec[i] === 'texture' || spec[i] === 'cube') {
          const t = textureOf(a, ctx) || (/^\w+$/.test(a.trim()) ? { tex: a.trim(), st: null, texel: null } : null);
          if (!t) { diag(ctx, 'high', 'SG_TEXTURE_UNRESOLVED', `${fname}: texture argument '${a}'`); out.push(a); return; }
          ctx.usedTextures.add(t.tex);
          out.push(t.tex);
          if (spec[i] === 'texture' || spec[i] === 'cube') { out.push(stExpr(t)); out.push(t.param ? t.texel : (t.texel || 'vec4(0.0009765625, 0.0009765625, 1024.0, 1024.0)')); }
          return;
        }
        out.push(a);
      });
      return `${fname}(${out.join(', ')})`;
    });
  }
  return s;
}

/**
 * Gradient literals: GLSL ES 1.00 has no arrays in structs returned by value nor array constructors, so every
 * NewGradient(...) literal becomes one specialised sampling function (Unity_SampleGradientV1_float semantics:
 * type 0 blend, 1 fixed, 2 perceptual/OkLab). Gradients passed to subgraphs are reported.
 */
function lowerGradients(code, ctx) {
  let s = code;
  // inline literal as first argument of the sample call
  s = replaceCall(s, ['Unity_SampleGradientV1_float', 'Unity_SampleGradient_float'], (args) => {
    if (!args.length) return null;
    const lit = /^NewGradient\s*\(/.test(args[0]) ? args[0] : null;
    const name = lit ? registerGradient(lit, ctx) : (ctx.gradientVars.get(args[0].trim()) || null);
    if (!name) { diag(ctx, 'high', 'SG_GRADIENT_UNRESOLVED', `gradient value '${args[0].slice(0, 60)}' is not a literal`); return null; }
    return `${name}(${args.slice(1).join(', ')})`;
  });
  return s;
}

function registerGradient(literal, ctx) {
  const open = literal.indexOf('(');
  const close = matchParen(literal, open);
  const nums = literal.slice(open + 1, close).replace(/(?:float|vec|half)[24]\s*\(/g, '(').replace(/[()]/g, ' ').split(',').map((x) => Number(x.trim()));
  const key = nums.join(',');
  if (ctx.gradientByKey.has(key)) return ctx.gradientByKey.get(key);
  const name = `sgGradient${ctx.gradients.length}`;
  const [type, colorsLength, alphasLength] = nums;
  const colors = []; const alphas = [];
  for (let i = 0; i < 8; i++) colors.push(nums.slice(3 + i * 4, 7 + i * 4));
  for (let i = 0; i < 8; i++) alphas.push(nums.slice(35 + i * 2, 37 + i * 2));
  ctx.gradients.push({ name, type, colorsLength, alphasLength, colors, alphas });
  ctx.gradientByKey.set(key, name);
  return name;
}

function gradientFunction(g) {
  const f = (x) => { const v = Number.isFinite(x) ? x : 0; const t = String(v); return /[.eE]/.test(t) ? t : `${t}.0`; };
  const perceptual = g.type === 2;
  const fixed = g.type % 2 === 1 ? '1.0' : '0.0';
  const col = (c) => `vec3(${c.slice(0, 3).map(f).join(', ')})`;
  const lines = [`void ${g.name}(float Time, out vec4 Out) {`];
  lines.push(`  vec3 color = ${perceptual ? `sgLinearToOklab(${col(g.colors[0])})` : col(g.colors[0])};`);
  lines.push('  float pos;');
  for (let c = 1; c < g.colorsLength; c++) {
    const p = g.colors[c - 1], q = g.colors[c];
    lines.push(`  pos = clamp((Time - ${f(p[3])}) / (${f(q[3])} - ${f(p[3])}), 0.0, 1.0);`);
    lines.push(`  color = mix(color, ${perceptual ? `sgLinearToOklab(${col(q)})` : col(q)}, mix(pos, step(0.01, pos), ${fixed}));`);
  }
  if (perceptual) lines.push('  color = sgOklabToLinear(color);');
  lines.push(`  float alpha = ${f(g.alphas[0][0])};`);
  for (let a = 1; a < g.alphasLength; a++) {
    const p = g.alphas[a - 1], q = g.alphas[a];
    lines.push(`  pos = clamp((Time - ${f(p[1])}) / (${f(q[1])} - ${f(p[1])}), 0.0, 1.0);`);
    lines.push(`  alpha = mix(alpha, ${f(q[0])}, mix(pos, step(0.01, pos), ${fixed}));`);
  }
  lines.push('  Out = vec4(color, alpha);', '}');
  return lines.join('\n');
}

/** Remove Unity library function definitions the shims replace (they reference HLSL-only constructs). */
function dropReplacedDefinitions(code, names) {
  let s = code;
  for (const name of names) {
    const re = new RegExp(`^[ \\t]*(?:void|float|vec[234]|[A-Z]\\w*)\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
    for (;;) {
      const m = re.exec(s);
      if (!m) break;
      let depth = 0; let j = s.indexOf('{', m.index);
      for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') { depth--; if (depth === 0) break; } }
      s = s.slice(0, m.index) + s.slice(j + 1);
    }
  }
  return s;
}

/**
 * Lower one source section (graph functions, vertex or pixel section, custom function include).
 * ctx: { materialProps:Set, textureKinds:Map, diagnostics:[], textureAliases, textureParams, textureSignatures,
 *        samplerAliases, usedTextures, gradients, gradientVars, gradientByKey, overrides:Set }
 */
function lowerSection(code, ctx) {
  let s = String(code).replace(/\r\n/g, '\n');
  s = s.replace(/^[ \t]*UNITY_TEXTURE_STREAMING_DEBUG_VARS\s*;.*$/gm, '');
  const samplerStates = new Set([...s.matchAll(/\b(SamplerState_(?:Linear|Point|Trilinear)_\w+)/g)].map((m) => m[1]));
  s = s.replace(/\bIsGammaSpace\s*\(\s*\)/g, 'false');
  s = s.replace(/#ifdef\s+UNITY_COLORSPACE_GAMMA[\s\S]*?#endif/g, '');
  s = s.replace(/^[ \t]*\/\*\s*WARNING:[^*]*\*\/\s*$/gm, '');
  s = dropReplacedDefinitions(s, ['Unity_SampleGradientV1_float', 'Unity_SampleGradient_float',
    'Unity_GetLightTexture0', 'Unity_GetLightTexture1', 'Unity_GetLightTexture2', 'Unity_GetLightTexture3', ...(ctx.overrides || [])]);
  // gradient variables: Gradient g = NewGradient(...);
  s = s.replace(/\bGradient\s+(\w+)\s*=\s*(NewGradient\s*\([^;]*\))\s*;/g, (whole, v, lit) => { ctx.gradientVars.set(v, registerGradient(lit, ctx)); return ''; });
  s = lowerGradients(s, ctx);
  if (/\bGradient\b/.test(s)) diag(ctx, 'high', 'SG_GRADIENT_PARAMETER', 'a Gradient value is passed through a function parameter');
  for (const [type, fn] of TYPE_RENAMES) s = s.replace(type, fn);
  s = s.replace(/\bstatic\s+(?=const\b|[a-z])/g, '').replace(/\binline\s+/g, '');
  s = s.replace(/\bUNITY_ACCESS_HYBRID_INSTANCED_PROP\s*\(/g, 'SG_HYBRID_PROP(');
  s = replaceCall(s, 'SG_HYBRID_PROP', (args) => args[0]);
  s = replaceCall(s, 'UNITY_ACCESS_DOTS_INSTANCED_PROP_WITH_DEFAULT', (args) => args[1] || args[0]);
  s = replaceCall(s, 'UNITY_ACCESS_DOTS_INSTANCED_PROP', (args) => args[1] || args[0]);
  s = lowerTextureParams(s, ctx);
  s = lowerTextures(s, ctx);
  s = lowerTextureCallSites(s, ctx);
  s = replaceCallStatement(s, 'sincos', (args) => (args.length === 3 ? `${args[1]} = sin(${args[0]}); ${args[2]} = cos(${args[0]});` : null));
  s = replaceCall(s, 'mad', (args) => (args.length === 3 ? `((${args[0]}) * (${args[1]}) + (${args[2]}))` : null));
  s = replaceCallStatement(s, 'clip', (args, expr) => `sgClip(${expr});`);
  s = renameCalls(s);
  s = s.replace(/\bSG_SAMPLER_STATE_DROPPED\b\s*,?/g, '');
  if (ctx.samplerAliases.size) {
    diag(ctx, 'medium', 'SG_SAMPLER_STATE', `graph sampler state overrides (${[...ctx.samplerAliases].slice(0, 4).join(', ')}) are not per-sample in Cocos; set wrap/filter on the texture asset`);
    for (const a of ctx.samplerAliases) s = s.replace(new RegExp(`,\\s*${a}\\b(?:\\.samplerstate)?`, 'g'), '');
  }
  s = s.replace(/,\s*UnityBuildSamplerStateStruct\s*\(\s*\w+\s*\)(?:\.samplerstate)?/g, '');
  if (samplerStates.size) {
    diag(ctx, 'medium', 'SG_SAMPLER_STATE', `graph sampler state overrides (${[...samplerStates].slice(0, 4).join(', ')}) are not per-sample in Cocos; set wrap/filter on the texture asset`);
  }
  for (const [name, why] of Object.entries(UNSUPPORTED_CALLS)) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(s)) diag(ctx, 'high', 'SG_UNSUPPORTED_NODE', `${name}: ${why}`);
  }
  if (/\bSG_UNSUPPORTED_MATRIX_/.test(s)) diag(ctx, 'high', 'SG_UNSUPPORTED_MATRIX', 'non-square matrix types have no GLSL ES 1.00 form');
  return s;
}

function createLoweringContext(pass, options = {}) {
  const textureKinds = new Map(pass.textures.map((t) => [t.name, /CUBE/.test(t.kind) ? 'Cube' : /ARRAY|3D/.test(t.kind) ? 'Unsupported' : '2D']));
  return {
    materialProps: new Set(pass.materialProps.map((p) => p.name)),
    textureKinds,
    diagnostics: [],
    textureAliases: new Map(),
    textureParams: new Map(),
    textureSignatures: new Map(),
    samplerAliases: new Set(),
    usedTextures: new Set(),
    gradients: [],
    gradientVars: new Map(),
    gradientByKey: new Map(),
    overrides: options.overrides || [],
  };
}

module.exports = { lowerSection, createLoweringContext, gradientFunction, dropReplacedDefinitions, TYPE_RENAMES };
