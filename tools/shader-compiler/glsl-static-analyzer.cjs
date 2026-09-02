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

function matchingBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * GLSL does not allow two locals with the same name in one function scope.
 * This catches a generator regression that emitted both `vec4 pos` and
 * `VertexPositionInputs pos`; the previous analyzer merged declarations into a
 * Set and therefore reported the invalid shader as compile-clean.
 */
function checkDuplicateFunctionLocals(code, program, diags) {
  const userTypes = [...code.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)].map(m => m[1]);
  const types = [
    'bool', 'int', 'uint', 'float', 'double',
    'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
    'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
    'mat2', 'mat3', 'mat4', ...userTypes,
  ].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const fnRe = /\b[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  let fn;
  while ((fn = fnRe.exec(code)) !== null) {
    const open = fn.index + fn[0].lastIndexOf('{');
    const close = matchingBrace(code, open);
    if (close < 0) continue;

    const declared = new Map();
    for (const param of splitArgs(fn[2])) {
      const pm = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/.exec(param.trim());
      if (pm && param.trim() !== 'void') declared.set(pm[1], { type: 'parameter', line: lineAt(code, fn.index) });
    }

    const body = code.slice(open + 1, close);
    const bodyStartLine = lineAt(code, open);
    let depth = 0;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (depth === 0 && !/^\s*for\s*\(/.test(line)) {
        const dm = new RegExp(`^\\s*(?:const\\s+)?(${types})\\s+([A-Za-z_]\\w*)\\s*(?:=|;|,)`).exec(line);
        if (dm) {
          const previous = declared.get(dm[2]);
          if (previous) {
            diags.push({
              severity: 'high', code: 'GLSL_DUPLICATE_LOCAL', program,
              line: bodyStartLine + i,
              message: `'${dm[2]}' is declared twice in ${fn[1]}() (${previous.type} and ${dm[1]}); GLSL cannot compile this scope.`,
            });
          } else {
            declared.set(dm[2], { type: dm[1], line: bodyStartLine + i });
          }
        }
      }
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
      }
    }
    fnRe.lastIndex = close + 1;
  }
}

/** A varying that first receives itself is still undefined for every vertex. */
function checkUninitializedOutputSelfAssignments(code, program, diags) {
  const outputs = new Set(
    [...code.matchAll(/^\s*out\s+(?:lowp\s+|mediump\s+|highp\s+|flat\s+)*[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*;/gm)]
      .map(m => m[1])
  );
  if (!outputs.size) return;

  const initialized = new Set();
  const reported = new Set();
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const name of outputs) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const assignment = new RegExp(`(?<![<>=!])\\b${escaped}\\s*=\\s*([^;]+);`).exec(line);
      if (!assignment) continue;
      if (!initialized.has(name) && new RegExp(`^\\s*${escaped}\\s*$`).test(assignment[1]) && !reported.has(name)) {
        reported.add(name);
        diags.push({
          severity: 'high', code: 'GLSL_UNINITIALIZED_OUTPUT', program, line: i + 1,
          message: `'${name}' is assigned from itself before any value is written; the vertex output is undefined. Bind the corresponding attribute or compute the varying.`,
        });
      }
      initialized.add(name);
    }
  }
}

/**
 * GLSL ES has no implicit vecN truncation/extension on assignment. Catch the
 * high-confidence direct cases produced by a lowering bug, for example:
 *
 *   out vec2 v_uv;
 *   v_uv = vec4(a_texCoord, 0.0, 0.0); // cannot compile
 *
 * This deliberately ignores arithmetic expressions whose result type would
 * need a real compiler to infer.
 */
function checkVectorAssignmentDimensions(code, program, diags) {
  const widths = new Map();
  const declarations = /\b(?:(?:const|in|out|uniform|flat|smooth|centroid|sample|noperspective|lowp|mediump|highp)\s+)*(vec[234]|ivec[234]|uvec[234]|bvec[234])\s+([A-Za-z_]\w*)\b/g;
  for (const declaration of code.matchAll(declarations)) {
    const width = Number(declaration[1].match(/[234]$/)[0]);
    widths.set(declaration[2], width);
  }

  const expressionWidth = expression => {
    const value = String(expression || '').trim();
    const constructor = /^(?:vec|ivec|uvec|bvec)([234])\s*\([\s\S]*\)\s*(?:\.([xyzwrgba]{1,4}))?$/.exec(value);
    if (constructor) return constructor[2] ? constructor[2].length : Number(constructor[1]);
    const identifier = /^([A-Za-z_]\w*)(?:\.([xyzwrgba]{1,4}))?$/.exec(value);
    if (!identifier || !widths.has(identifier[1])) return null;
    return identifier[2] ? identifier[2].length : widths.get(identifier[1]);
  };

  const lines = code.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const assignments = lines[lineIndex].matchAll(/(?<![<>=!])\b([A-Za-z_]\w*)(?:\.([xyzwrgba]{1,4}))?\s*=\s*([^;]+);/g);
    for (const assignment of assignments) {
      if (!widths.has(assignment[1])) continue;
      const leftWidth = assignment[2] ? assignment[2].length : widths.get(assignment[1]);
      const rightWidth = expressionWidth(assignment[3]);
      if (!rightWidth || leftWidth === rightWidth) continue;
      diags.push({
        severity: 'high', code: 'GLSL_VECTOR_ASSIGNMENT_WIDTH_MISMATCH', program,
        line: lineIndex + 1,
        message: `'${assignment[1]}' is ${leftWidth} components wide but the direct assignment supplies ${rightWidth}; GLSL ES does not implicitly truncate or extend vectors. Add the authored destination-width swizzle or constructor.`,
      });
    }
  }
}

/**
 * A material UBO is one linked interface shared by the vertex and fragment
 * programs. In GLSL ES, an unqualified float/vector/matrix member inherits the
 * program's default float precision. Therefore these two visually identical
 * blocks are ABI-incompatible and WebGL rejects the program at link time:
 *
 *   VS: precision highp float;   uniform Constant { vec4 color; };
 *   FS: precision mediump float; uniform Constant { vec4 color; };
 */
function checkUniformBlockAbi(programs, diags) {
  const firstByBlock = new Map();
  const reported = new Set();
  const floatType = /^(?:float|vec[234]|mat[234](?:x[234])?)$/;

  for (const program of programs) {
    const code = stripComments(program.code);
    const defaultFloat = /\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.exec(code)?.[1] || '';
    const blockRe = /(?:layout\s*\([^)]*\)\s*)?uniform\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}\s*;/g;
    let block;
    while ((block = blockRe.exec(code)) !== null) {
      const members = [];
      for (const member of block[2].matchAll(/^\s*(?:(lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*;/gm)) {
        const type = member[2];
        members.push({
          name: member[3],
          type,
          array: member[4] || '',
          precision: member[1] || (floatType.test(type) ? defaultFloat : ''),
        });
      }

      const signature = { program: program.name, block: block[1], members };
      const first = firstByBlock.get(block[1]);
      if (!first) {
        firstByBlock.set(block[1], signature);
        continue;
      }

      const max = Math.max(first.members.length, members.length);
      for (let i = 0; i < max; i++) {
        const a = first.members[i];
        const b = members[i];
        if (!a || !b || a.name !== b.name || a.type !== b.type || a.array !== b.array) {
          const key = `layout:${block[1]}:${first.program}:${program.name}`;
          if (!reported.has(key)) {
            reported.add(key);
            diags.push({
              severity: 'high', code: 'GLSL_UBO_LAYOUT_MISMATCH', program: program.name,
              line: lineAt(code, block.index),
              message: `Uniform block '${block[1]}' has a different member order/type in '${first.program}' and '${program.name}'. Linked stages must expose the same UBO ABI.`,
            });
          }
          break;
        }
        if (a.precision && b.precision && a.precision !== b.precision) {
          const key = `precision:${block[1]}:${a.name}:${first.program}:${program.name}`;
          if (reported.has(key)) continue;
          reported.add(key);
          diags.push({
            severity: 'high', code: 'GLSL_UBO_PRECISION_MISMATCH', program: program.name,
            line: lineAt(code, block.index),
            message: `Uniform block '${block[1]}' member '${a.name}' is ${a.precision} in '${first.program}' but ${b.precision} in '${program.name}'. WebGL cannot link stages with different UBO member precision.`,
          });
        }
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

/**
 * Resolve declarations contributed by CCProgram chunks included from another
 * CCProgram in the same .effect file. Cocos expands `#include <chunk-name>`
 * before GLSL compilation, so analyzing each block in isolation incorrectly
 * reports shared UBO members and helper functions as undeclared.
 */
function collectLocalIncludeDeclarations(program, programsByName) {
  const declared = new Set();
  const visited = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    const included = programsByName.get(name);
    if (!included) return;
    const code = stripComments(included.code);
    for (const symbol of collectDeclared(code)) declared.add(symbol);
    for (const match of code.matchAll(/^\s*#\s*include\s+<([^>]+)>/gm)) visit(match[1]);
  };
  for (const match of program.code.matchAll(/^\s*#\s*include\s+<([^>]+)>/gm)) visit(match[1]);
  return declared;
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

    // Cocos compiles material effects for its WebGL1/GLES100 fallback too.
    // textureSize() is lowered to unsupported texture2DSize there and causes
    // EFX2406, rejecting the whole effect even if the WebGL2 variant is valid.
    if (/\btextureSize\s*\(/.test(line)) {
      diags.push({
        severity: 'high', code: 'GLSL_WEBGL1_TEXTURE_SIZE_UNSUPPORTED', program, line: i + 1,
        message: 'textureSize() is unavailable in the Cocos WebGL1/GLES100 effect variant. Bind an explicit texel-size vec4 uniform from the actual texture dimensions.',
      });
    }

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
  const builtinLocalSamplers = new Set();
  for (const sampler of effectText.matchAll(
    /#pragma\s+builtin\s*\(\s*local\s*\)\s*\n\s*(?:layout\s*\([^)]*\)\s*)?uniform\s+sampler\w+\s+([A-Za-z_]\w*)\s*;/g,
  )) {
    builtinLocalSamplers.add(sampler[1]);
  }
  for (const blk of effectText.matchAll(/uniform\s+\w+\s*\{([\s\S]*?)\}/g)) {
    for (const mm of blk[1].matchAll(/^\s*(?:lowp|mediump|highp\s+)?[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/gm)) {
      members.add(mm[1]);
    }
  }
  for (const s of effectText.matchAll(/uniform\s+sampler\w+\s+([A-Za-z_]\w*)\s*;/g)) {
    if (!builtinLocalSamplers.has(s[1])) members.add(s[1]);
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
  const programsByName = new Map(programs.map(program => [program.name, program]));

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
    const linkedDeclarations = collectLocalIncludeDeclarations(p, programsByName);
    if (pooled) for (const name of pooled) linkedDeclarations.add(name);
    checkBalance(code, p.name, diags);
    checkCallArity(code, p.name, diags);
    checkDuplicateFunctionLocals(code, p.name, diags);
    checkUninitializedOutputSelfAssignments(code, p.name, diags);
    checkVectorAssignmentDimensions(code, p.name, diags);
    checkResidualsAndScope(code, p.name, diags, linkedDeclarations);
  }
  checkUniformBlockAbi(programs, diags);
  checkPropertyBinding(stripComments(effectText), effectYaml, diags);

  const errors = diags.filter(d => d.severity === 'high');
  const warnings = diags.filter(d => d.severity !== 'high');
  return { ok: errors.length === 0, errors, warnings, diagnostics: diags };
}

module.exports = {
  analyzeEffect,
  splitEffect,
  collectDeclared,
  collectLocalIncludeDeclarations,
  checkUniformBlockAbi,
  BUILTIN_ARITY,
};
