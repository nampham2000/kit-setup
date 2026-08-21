'use strict';

/**
 * GLSL ES 3.00 static analyzer for generated Cocos `.effect` programs.
 *
 * The structural validator in shader-validator.cjs answers "does this file have
 * the right shape" -- CCEffect block present, entry points named, varyings
 * matched. It cannot answer "does this GLSL compile", which is the question that
 * actually matters: a mis-lowered intrinsic produces a file of perfect shape
 * containing `clamp(dot(a,b))` or `vec3(0,1,0, 0.0, 1.0)`.
 *
 * This module closes that gap with checks chosen for precision over coverage --
 * every rule here fires only on constructs that cannot compile or cannot link,
 * so a finding is never a judgement call:
 *
 *   1. bracket balance per program block
 *   2. arity of GLSL ES 300 builtins (fixed-arity ones only)
 *   3. scalar-literal vector constructor component counts
 *   4. residual Unity identifiers (`_Foo`, `unity_*`, `UNITY_*`)
 *   5. member access through an undeclared variable (`i.wn`)
 *   6. UBO members absent from the CCEffect properties block
 */

const { splitArgs, matchParen } = require('./call-rewriter.cjs');

// Fixed-arity GLSL ES 3.00 builtins. Variadic/overloaded-arity functions
// (texture, min, max, ...) are deliberately absent: only exact arities here.
const BUILTIN_ARITY = {
  clamp: [3], mix: [3], smoothstep: [3], faceforward: [3], refract: [3],
  step: [2], reflect: [2], distance: [2], dot: [2], cross: [2],
  pow: [2], mod: [2], atan: [1, 2], min: [2], max: [2],
  radians: [1], degrees: [1], sin: [1], cos: [1], tan: [1],
  asin: [1], acos: [1], exp: [1], log: [1], exp2: [1], log2: [1],
  sqrt: [1], inversesqrt: [1], abs: [1], sign: [1], floor: [1],
  ceil: [1], fract: [1], trunc: [1], round: [1], roundEven: [1],
  length: [1], normalize: [1], dFdx: [1], dFdy: [1], fwidth: [1],
  transpose: [1], determinant: [1], inverse: [1],
};

const VECTOR_SIZE = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, bvec2: 2, bvec3: 3, bvec4: 4 };

const GLSL_KEYWORDS = new Set([
  'void', 'bool', 'int', 'uint', 'float', 'double', 'return', 'if', 'else',
  'for', 'while', 'do', 'break', 'continue', 'discard', 'struct', 'const',
  'in', 'out', 'inout', 'uniform', 'layout', 'set', 'binding', 'precision',
  'lowp', 'mediump', 'highp', 'true', 'false', 'switch', 'case', 'default',
  'flat', 'smooth', 'centroid', 'sample', 'noperspective', 'invariant',
  'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3',
  'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
  'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DArray',
  'sampler2DShadow', 'samplerCubeShadow', 'isampler2D', 'usampler2D',
  ...Object.keys(VECTOR_SIZE), ...Object.keys(BUILTIN_ARITY),
  'texture', 'textureLod', 'textureProj', 'textureGrad', 'textureSize',
  'texelFetch', 'textureOffset', 'gl_Position', 'gl_FragCoord',
  'gl_FrontFacing', 'gl_PointCoord', 'gl_VertexID', 'gl_InstanceID',
  'gl_FragDepth', 'gl_PointSize', 'lessThan', 'greaterThan', 'equal',
  'notEqual', 'lessThanEqual', 'greaterThanEqual', 'any', 'all', 'not',
  'isnan', 'isinf', 'matrixCompMult', 'outerProduct', 'packSnorm2x16',
  'unpackSnorm2x16', 'floatBitsToInt', 'intBitsToFloat',
]);

const SCALAR_LITERAL = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

// Component count of the surface-shader stage inputs, from
// chunks/shading-entries/data-structures. Used to catch a swizzle that reads
// past the end of one.
const ENGINE_INPUT_WIDTH = {
  FSInput_texcoord: 2,
  FSInput_texcoord1: 2,
  FSInput_worldPos: 3,
  FSInput_worldNormal: 3,
  FSInput_localPos: 3,
  FSInput_vertexColor: 4,
  FSInput_worldTangent: 4,
  FSInput_clipPos: 4,
};

/** Strip comments so text scans do not trip over commented-out code. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, '');
}

/** Extract the CCProgram blocks and the CCEffect YAML from an effect file. */
function splitEffect(effectText) {
  const programs = [];
  const re = /CCProgram\s+(\S+)\s*%\{([\s\S]*?)\n\}%/g;
  let m;
  while ((m = re.exec(effectText)) !== null) {
    const lineOffset = effectText.slice(0, m.index).split('\n').length;
    programs.push({ name: m[1], code: m[2], lineOffset });
  }
  const eff = /CCEffect\s*%\{([\s\S]*?)\n\}%/.exec(effectText);
  return { programs, effectYaml: eff ? eff[1] : '' };
}

function checkBalance(code, program, diags) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const closing = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  const lines = code.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    // preprocessor lines are conditionals, not expressions
    if (/^\s*#/.test(lines[ln])) continue;
    for (const ch of lines[ln]) {
      if (pairs[ch]) stack.push({ ch, ln });
      else if (closing[ch]) {
        const top = stack.pop();
        if (!top || top.ch !== closing[ch]) {
          diags.push({
            severity: 'high', code: 'GLSL_UNBALANCED_BRACKET', program,
            line: ln + 1,
            message: `Unmatched '${ch}' in ${program} -- the emitted GLSL cannot parse.`,
          });
          return;
        }
      }
    }
  }
  if (stack.length) {
    diags.push({
      severity: 'high', code: 'GLSL_UNBALANCED_BRACKET', program,
      line: stack[0].ln + 1,
      message: `Unclosed '${stack[0].ch}' in ${program} -- the emitted GLSL cannot parse.`,
    });
  }
}

/** Line number of a character offset, 1-based. */
function lineAt(code, idx) {
  return code.slice(0, idx).split('\n').length;
}

function checkCallArity(code, program, diags) {
  const re = /\b([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    const arity = BUILTIN_ARITY[name];
    const vecSize = VECTOR_SIZE[name];
    if (!arity && !vecSize) continue;
    // skip declarations/definitions: `float clamp(...)` would be a redefinition,
    // and a preceding type token means this is not a call
    const before = code.slice(Math.max(0, m.index - 24), m.index);
    if (/\b(?:float|vec[234]|int|bool|void|mat[234])\s+$/.test(before)) continue;

    const open = m.index + m[0].length - 1;
    const close = matchParen(code, open);
    if (close === -1) continue;
    const args = splitArgs(code.slice(open + 1, close));

    if (arity && !arity.includes(args.length)) {
      diags.push({
        severity: 'high', code: 'GLSL_BAD_ARITY', program, line: lineAt(code, m.index),
        message: `${name}() called with ${args.length} argument(s); GLSL ES 300 requires ${arity.join(' or ')}. Usually a mis-lowered HLSL intrinsic.`,
      });
    }

    if (vecSize) {
      // Only judge constructors whose arguments are all scalar literals: with a
      // swizzle or variable present, the component count is not decidable here.
      const allScalar = args.length > 0 && args.every(a => SCALAR_LITERAL.test(a));
      if (allScalar && args.length !== 1 && args.length !== vecSize) {
        diags.push({
          severity: 'high', code: 'GLSL_BAD_VECTOR_CTOR', program, line: lineAt(code, m.index),
          message: `${name}(...) built from ${args.length} scalar literals; needs 1 or ${vecSize}. Usually arguments leaked in from an enclosing call.`,
        });
      }
    }
  }
}

/** Names declared anywhere in a program block, plus loop/param bindings. */
function collectDeclared(code) {
  const names = new Set();
  const add = (n) => { if (n) names.add(n); };

  // Struct types the program declares itself. Locals typed by one of these
  // (`VertexPositionInputs posInputs = ...`) are declarations too, and without
  // this they read as undeclared.
  const userTypes = new Set();
  let sm;
  const structRe = /\bstruct\s+([A-Za-z_]\w*)/g;
  while ((sm = structRe.exec(code)) !== null) userTypes.add(sm[1]);
  for (const t of userTypes) {
    const localRe = new RegExp(`\\b${t}\\s+([A-Za-z_]\\w*)`, 'g');
    let lm;
    while ((lm = localRe.exec(code)) !== null) add(lm[1]);
  }

  // uniforms, varyings, attributes, locals: `[qualifier] type name[...]`
  const declRe = /\b(?:uniform|in|out|attribute|varying|const|flat)?\s*\b(?:lowp|mediump|highp\s+)?\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:=|;|,|\))/g;
  let m;
  while ((m = declRe.exec(code)) !== null) {
    if (GLSL_KEYWORDS.has(m[1]) || /^(?:vec|mat|ivec|bvec|sampler)/.test(m[1]) ||
        ['float', 'int', 'bool', 'uint', 'void'].includes(m[1])) add(m[2]);
  }
  // UBO / struct members: every `type name;` inside a block
  const blockRe = /\{([^{}]*)\}/g;
  while ((m = blockRe.exec(code)) !== null) {
    const inner = m[1];
    let mm;
    const memRe = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/g;
    while ((mm = memRe.exec(inner)) !== null) add(mm[2]);
  }
  // function names and their parameters
  const fnRe = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  while ((m = fnRe.exec(code)) !== null) {
    add(m[2]);
    for (const p of m[3].split(',')) {
      const pm = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/.exec(p.trim());
      if (pm) add(pm[1]);
    }
  }
  // #define macros
  const defRe = /#\s*define\s+([A-Za-z_]\w*)/g;
  while ((m = defRe.exec(code)) !== null) add(m[1]);
  return names;
}

// A trailing `.xy`/`.rgba` component selector, not a variable.
const SWIZZLE = /^[xyzw]{1,4}$|^[rgba]{1,4}$|^[stpq]{1,4}$/;

function checkResidualsAndScope(code, program, diags, extraDeclared) {
  const declared = collectDeclared(code);
  if (extraDeclared) for (const n of extraDeclared) declared.add(n);
  const reportedResidual = new Set();
  const reportedScope = new Set();

  // Preprocessor lines are conditions, not expressions: `#if defined(_FOO)` and
  // `#define UNITY_BAR 1` name macros, and a macro that is merely *tested* is
  // valid GLSL whether or not it is defined. Reporting those as unlowered
  // symbols floods the result with noise and makes the whole gate ignorable.
  // Names introduced by any preprocessor line count as declared.
  const lines = code.split('\n');
  const macroNames = new Set();
  for (const ln of lines) {
    if (!/^\s*#/.test(ln)) continue;
    for (const mm of ln.matchAll(/\b([A-Za-z_]\w*)\b/g)) macroNames.add(mm[1]);
  }
  const isKnown = (n) => declared.has(n) || macroNames.has(n);

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    offset += line.length + 1;
    if (/^\s*#/.test(line)) continue;

    // 4. residual Unity identifiers -- these are never valid Cocos GLSL
    for (const m of line.matchAll(/\b(UNITY_[A-Z0-9_]+|unity_[A-Za-z]\w*|_[A-Z]\w*)\b/g)) {
      const name = m[1];
      if (isKnown(name) || reportedResidual.has(name)) continue;
      reportedResidual.add(name);
      diags.push({
        severity: 'high', code: 'UNLOWERED_UNITY_SYMBOL', program, line: i + 1,
        message: `'${name}' is an unlowered Unity symbol with no Cocos equivalent bound; it will not link.`,
      });
    }

    // 4b. A texture call naming a sampler this stage never declared. Samplers
    // are emitted per stage, so vertex code that samples or queries a texture
    // declared only in the fragment stage will not compile -- and unlike a
    // member access this leaves no `.field` for the check below to catch.
    for (const m of line.matchAll(/\b(?:texture|textureLod|textureProj|textureGrad|textureSize|texelFetch|textureOffset)\s*\(\s*([A-Za-z_]\w*)/g)) {
      const tex = m[1];
      if (isKnown(tex) || GLSL_KEYWORDS.has(tex)) continue;
      if (reportedScope.has(tex)) continue;
      reportedScope.add(tex);
      diags.push({
        severity: 'high', code: 'GLSL_UNDECLARED_SAMPLER', program, line: i + 1,
        message: `'${tex}' is sampled in ${program} but no sampler of that name is declared in this stage.`,
      });
    }

    // 4c. Swizzle wider than the engine input it reads from. Skipping
    // FSInput_* above buys a false-positive fix at the cost of never checking
    // them, and the common failure is real: a Unity float3 UV mapped onto
    // Cocos's vec2 texcoord yields `FSInput_texcoord.z`, which will not compile.
    for (const m of line.matchAll(/\b(FSInput_[A-Za-z0-9_]+)\.([xyzwrgba]{1,4})\b/g)) {
      const width = ENGINE_INPUT_WIDTH[m[1]];
      if (!width) continue;
      const maxIndex = Math.max(...[...m[2]].map(c => 'xyzw'.indexOf(c) >= 0 ? 'xyzw'.indexOf(c) : 'rgba'.indexOf(c)));
      if (maxIndex < width) continue;
      const key = `${m[1]}.${m[2]}`;
      if (reportedScope.has(key)) continue;
      reportedScope.add(key);
      diags.push({
        severity: 'high', code: 'GLSL_SWIZZLE_OUT_OF_RANGE', program, line: i + 1,
        message: `'${key}' selects component ${maxIndex + 1} of '${m[1]}', which is only ${width} wide in Cocos. The Unity source used a wider input; carry the extra channel in a custom varying.`,
      });
    }

    // 5. member access through an undeclared variable (`i.wn` after a partial rename)
    for (const m of line.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/g)) {
      const base = m[1];
      if (isKnown(base) || GLSL_KEYWORDS.has(base)) continue;
      // Engine/stage names. FSInput_*/VSInput_* come from the surface-shader
      // chunks (surfaces/includes/common-fs), which are not in this file.
      if (/^(?:cc_|gl_|v_|a_|o_|FSInput_|VSInput_)/.test(base)) continue;
      if (SCALAR_LITERAL.test(base)) continue;            // `1.0.xyz` is not real
      if (SWIZZLE.test(base)) continue;                   // `foo.xy.xy`
      if (reportedResidual.has(base) || reportedScope.has(base)) continue;
      reportedScope.add(base);
      diags.push({
        severity: 'high', code: 'GLSL_UNDECLARED_BASE', program, line: i + 1,
        message: `'${base}.${m[2]}' reads through '${base}', which is never declared -- a struct field that was not remapped to a varying.`,
      });
    }
  }
}

/**
 * 6. Every UBO member and sampler must appear in the CCEffect properties block,
 * otherwise Cocos has no way to bind or author it and it stays at zero.
 */
function checkPropertyBinding(effectText, effectYaml, diags) {
  const declaredProps = new Set(
    [...effectYaml.matchAll(/^\s+([A-Za-z_]\w*):\s*\{/gm)].map(x => x[1])
  );
  // Cocos lets a property write into a slice of a UBO member:
  //     alphaThreshold: { value: 0.5, target: colorScaleAndCutoff.w }
  // The member is then bound through that target, not by sharing its name. Without
  // reading `target:`, any effect that packs scalars into vec4 slots reports every
  // slot as unbound -- measured: 34 false warnings on a 171-property uber-shader,
  // which is enough noise to train people to ignore the gate.
  for (const t of effectYaml.matchAll(/\btarget:\s*([A-Za-z_]\w*)/g)) {
    declaredProps.add(t[1]);
  }
  const members = new Set();
  for (const blk of effectText.matchAll(/uniform\s+\w+\s*\{([\s\S]*?)\}/g)) {
    for (const mm of blk[1].matchAll(/^\s*(?:lowp|mediump|highp\s+)?[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/gm)) {
      members.add(mm[1]);
    }
  }
  for (const s of effectText.matchAll(/uniform\s+sampler\w+\s+([A-Za-z_]\w*)\s*;/g)) {
    members.add(s[1]);
  }
  for (const name of members) {
    if (declaredProps.has(name)) continue;
    diags.push({
      severity: 'medium', code: 'UBO_MEMBER_UNBOUND',
      message: `Uniform '${name}' is declared in the material UBO but absent from the CCEffect properties block: it is not authorable and stays zero at runtime.`,
    });
  }
}

/**
 * Analyze a generated `.effect` file.
 * @param {string} effectText
 * @returns {{ok: boolean, errors: object[], warnings: object[], diagnostics: object[]}}
 */
function analyzeEffect(effectText) {
  const diags = [];
  if (!effectText || typeof effectText !== 'string') {
    return { ok: false, errors: [{ severity: 'high', code: 'EMPTY_EFFECT', message: 'Empty effect content' }], warnings: [], diagnostics: [] };
  }

  const { programs, effectYaml } = splitEffect(effectText);

  // A surface-shader effect is not a set of independent programs: `standard-vs`
  // and `standard-fs` `#include` the shared-ubos / macro-remapping / surface-*
  // blocks, so a uniform declared in shared-ubos is in scope inside
  // surface-vertex. Scoping each block on its own reports every material
  // uniform as undeclared. Composition is per-file here, so declarations are
  // pooled across blocks.
  const isSurfaceEffect = programs.some(p => p.name === 'standard-fs') &&
    /surfaces\/includes\/(?:common|standard)-fs/.test(effectText);
  const pooled = isSurfaceEffect
    ? collectDeclared(stripComments(programs.map(p => p.code).join('\n')))
    : null;
  // Names the engine's own surface chunks bring in.
  if (pooled) {
    for (const n of [
      'SurfacesMaterialData', 'SurfacesStandardVertexIntermediate', 'In',
      'surfaceData', 'CCGetWorldMatrixFull',
    ]) pooled.add(n);
  }

  for (const p of programs) {
    const code = stripComments(p.code);
    checkBalance(code, p.name, diags);
    checkCallArity(code, p.name, diags);
    checkResidualsAndScope(code, p.name, diags, pooled);
  }
  checkPropertyBinding(stripComments(effectText), effectYaml, diags);

  const errors = diags.filter(d => d.severity === 'high');
  const warnings = diags.filter(d => d.severity !== 'high');
  return { ok: errors.length === 0, errors, warnings, diagnostics: diags };
}

module.exports = { analyzeEffect, splitEffect, collectDeclared, BUILTIN_ARITY };
