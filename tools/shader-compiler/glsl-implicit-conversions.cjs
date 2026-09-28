'use strict';
/**
 * HLSL applies implicit conversions that GLSL ES 1.0 (which Cocos also compiles every effect to)
 * rejects. This pass rewrites one generated stage so the authored HLSL meaning survives:
 * 1. `const int n = <non-constant>;` (HLSL allows a runtime initializer) -> `int n = ...;`
 * 2. `for (i = 0; i < bound; i++)` with a non-constant bound -> a constant-capped loop that
 *    breaks at the bound (ES 1.0 Appendix A requires constant loop bounds);
 * 3. an int variable operand in a float statement -> `float(name)`;
 * 4. a scalar literal assigned to a vecN -> `vecN(literal)`;
 * 5. a 4-wide expression (texture sample, `cc_mat* * v`, vec4 variable) assigned to vec3/vec2 ->
 *    the destination-width swizzle (HLSL truncates silently).
 * Rules only fire on shapes whose types are known from declarations in the stage, so anything
 * ambiguous is left for shader validation to report.
 */

const LOOP_CAP = 128;
const NUMBER = String.raw`[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?`;
const DECL = /\b(?:(?:const|highp|mediump|lowp|in|out|inout|uniform)\s+)*(float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?/g;

function declaredTypes(code) {
  const types = new Map();
  for (const m of code.matchAll(DECL)) if (!types.has(m[2])) types.set(m[2], m[3] ? `${m[1]}[]` : m[1]);
  return types;
}

const widthOfType = type => (type === 'float' ? 1 : /^vec([234])$/.test(type) ? Number(type.slice(3)) : null);

/** Width of a whole expression when it is one of the recognisable 4-wide shapes, else null. */
function knownWidth(expression, types) {
  const e = expression.trim();
  const unwrapped = /^\(([\s\S]*)\)$/.exec(e);
  if (unwrapped && balanced(unwrapped[1])) return knownWidth(unwrapped[1], types);
  if (/^(?:texture|texture2D|textureCube|texU|CCDecodeColorSample|SRGBToLinear)\s*\(/.test(e) && balancedCall(e)) return 4;
  if (/^cc_mat\w+\s*\*/.test(e) && !/[+\-/]/.test(e.replace(/\([^()]*\)/g, ''))) return 4;
  if (/^vec([234])\s*\(/.test(e) && balancedCall(e)) return Number(e[3]);
  const id = /^([A-Za-z_]\w*)$/.exec(e);
  if (id) return widthOfType(types.get(id[1]));
  return null;
}

function balanced(s) {
  let depth = 0;
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')' && --depth < 0) return false; }
  return depth === 0;
}

/** `name(...)` where the call's parentheses span the whole expression. */
function balancedCall(e) {
  const open = e.indexOf('(');
  let depth = 0;
  for (let i = open; i < e.length; i++) {
    if (e[i] === '(') depth++;
    else if (e[i] === ')' && --depth === 0) return i === e.length - 1;
  }
  return false;
}

const SWIZZLE = { 2: '.xy', 3: '.xyz' };

function rewriteStatement(line, types, intNames) {
  // 1. const int with a non-literal initializer.
  line = line.replace(/\bconst\s+(int|uint)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/, (m, type, name, init) =>
    (new RegExp(`^\\s*${NUMBER}\\s*$`).test(init) ? m : `${type} ${name} = ${init};`));

  // Assignment / declaration: `[type ]lhs[.swz] op= rhs;`
  const m = /^(\s*)(?:(float|vec[234])\s+)?([A-Za-z_]\w*)(\.[xyzwrgba]{1,4})?\s*([-+*/]?=)(?!=)\s*([^;]+);(.*)$/.exec(line);
  if (!m) return line;
  const [, indent, declType, name, swizzle, op, rhsRaw, rest] = m;
  const lhsType = declType || types.get(name);
  const lhsWidth = swizzle ? swizzle.length - 1 : widthOfType(lhsType);
  if (!lhsWidth) return line;
  let rhs = rhsRaw.trim();

  // 3. int operands in float arithmetic (outside subscripts and int() casts).
  if (intNames.size) {
    const masked = rhs.replace(/\[[^\[\]]*\]/g, s => ' '.repeat(s.length));
    let out = '';
    let last = 0;
    for (const id of masked.matchAll(/(?<![\w.])([A-Za-z_]\w*)\b(?!\s*\()/g)) {
      if (!intNames.has(id[1])) continue;
      const before = masked.slice(0, id.index);
      if (/\b(?:int|uint)\s*\(\s*$/.test(before)) continue;
      out += rhs.slice(last, id.index) + `float(${id[1]})`;
      last = id.index + id[1].length;
    }
    if (last) rhs = out + rhs.slice(last);
  }

  // 4. scalar literal broadcast.
  if (lhsWidth > 1 && op === '=' && new RegExp(`^${NUMBER}$`).test(rhs)) rhs = `vec${lhsWidth}(${rhs})`;

  // 5. truncation of a known 4-wide expression.
  if (lhsWidth < 4 && op === '=') {
    const rw = knownWidth(rhs, types);
    if (rw === 4) rhs = `(${rhs})${SWIZZLE[lhsWidth]}`;
  }

  return `${indent}${declType ? `${declType} ` : ''}${name}${swizzle || ''} ${op} ${rhs};${rest}`;
}

/** 2. Non-constant `for` bounds -> capped constant loop with an early break. */
function capLoops(code, types) {
  return code.replace(/\bfor\s*\(\s*(?:int\s+)?([A-Za-z_]\w*)\s*=\s*(\d+)\s*;\s*\1\s*(<=?)\s*([^;]+?)\s*;\s*(\1\+\+|\+\+\1|\1\s*\+=\s*1)\s*\)\s*\{/g,
    (m, index, start, cmp, bound) => {
      if (new RegExp(`^${NUMBER}$`).test(bound.trim())) return m;
      const loop = `${index}_es`;
      const declared = types.has(index) && !new RegExp(`for\\s*\\(\\s*int\\s+${index}\\b`).test(m);
      const guard = `if (${index} ${cmp === '<' ? '>=' : '>'} ${bound.trim()}) break;`;
      return `for (int ${loop} = ${start}; ${loop} < ${LOOP_CAP}; ${loop}++) {\n${declared ? '' : 'int '}${index} = ${loop}; ${guard}`;
    });
}

function glslImplicitConversions(code) {
  const types = declaredTypes(code);
  const intNames = new Set([...types].filter(([, t]) => t === 'int' || t === 'uint').map(([n]) => n));
  const capped = capLoops(code, types);
  return capped.split('\n').map((line) => {
    if (/^\s*(?:#|layout\b|precision\b|uniform\b|attribute\b|varying\b|in\b|out\b|for\b|if\b|while\b|return\b|\}|\{)/.test(line)) return line;
    return rewriteStatement(line, types, intNames);
  }).join('\n');
}

module.exports = { glslImplicitConversions, declaredTypes, knownWidth, LOOP_CAP };
