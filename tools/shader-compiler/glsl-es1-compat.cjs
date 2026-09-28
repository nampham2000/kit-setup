'use strict';
/**
 * Cocos compiles every effect to GLSL ES 1.0 as well, which lacks several things HLSL (and
 * GLSL ES 3.0) accept. Mechanical, type-independent rewrites of one stage's generated code:
 * - `#ifdef 0` / `#ifndef 1` left behind when a Unity macro was lowered to a literal;
 * - `transpose(m)` (GLSL ES 3.0 only) -> an inlined overload for mat2/mat3/mat4;
 * - `return <literal>;` inside a vecN function (HLSL promotes the scalar) -> `return vecN(<literal>);`;
 * - `pow(x, <literal>)` (HLSL promotes the exponent) -> `pow(x, x * 0.0 + <literal>)`, which has x's type.
 */

const TRANSPOSE = `
mat2 esTranspose(mat2 m) { return mat2(m[0][0], m[1][0], m[0][1], m[1][1]); }
mat3 esTranspose(mat3 m) { return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]); }
mat4 esTranspose(mat4 m) { return mat4(m[0][0], m[1][0], m[2][0], m[3][0], m[0][1], m[1][1], m[2][1], m[3][1], m[0][2], m[1][2], m[2][2], m[3][2], m[0][3], m[1][3], m[2][3], m[3][3]); }`;

const NUMBER = String.raw`[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?`;

function preprocessorLiterals(code) {
  return code
    .replace(/^(\s*)#ifdef\s+0\b.*$/gm, '$1#if 0')
    .replace(/^(\s*)#ifdef\s+1\b.*$/gm, '$1#if 1')
    .replace(/^(\s*)#ifndef\s+0\b.*$/gm, '$1#if 1')
    .replace(/^(\s*)#ifndef\s+1\b.*$/gm, '$1#if 0');
}

function transposeHelpers(code) {
  if (!/\btranspose\s*\(/.test(code)) return code;
  const renamed = code.replace(/\btranspose\s*\(/g, 'esTranspose(');
  // Insert the helpers before the first function definition of the stage.
  const match = /^[ \t]*(?:highp\s+|mediump\s+|lowp\s+)?(?:void|float|int|bool|vec[234]|mat[234]|[A-Z]\w*)\s+\w+\s*\([^;{]*\)\s*\{?\s*$/m.exec(renamed);
  if (!match) return renamed;
  return `${renamed.slice(0, match.index)}${TRANSPOSE.trim()}\n${renamed.slice(match.index)}`;
}

function scalarReturns(code) {
  const lines = code.split('\n');
  let type = null, depth = 0;
  return lines.map((line) => {
    const header = /^\s*(vec[234])\s+\w+\s*\([^;]*\)\s*\{?\s*$/.exec(line);
    if (header && depth === 0) type = header[1];
    const out = type ? line.replace(new RegExp(`\\breturn\\s+(${NUMBER})\\s*;`), `return ${type}($1);`) : line;
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) type = null; } }
    return out;
  }).join('\n');
}

/** pow(a, literal) with a balanced first argument. */
function powLiterals(code) {
  let out = '', i = 0;
  const re = /\bpow\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    let depth = 1, j = m.index + m[0].length, comma = -1;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') depth--;
      else if (code[j] === ',' && depth === 1 && comma < 0) comma = j;
    }
    if (comma < 0) continue;
    const first = code.slice(m.index + m[0].length, comma).trim();
    const second = code.slice(comma + 1, j - 1).trim();
    if (!new RegExp(`^${NUMBER}$`).test(second) || /^[-+]?(?:\d|\.)/.test(first)) continue;
    out += code.slice(i, m.index) + `pow(${first}, (${first}) * 0.0 + ${second})`;
    i = j;
    re.lastIndex = j;
  }
  return out + code.slice(i);
}

function glslEs1Compat(code) {
  return powLiterals(scalarReturns(transposeHelpers(preprocessorLiterals(code))));
}

module.exports = { glslEs1Compat, preprocessorLiterals, transposeHelpers, scalarReturns, powLiterals };
