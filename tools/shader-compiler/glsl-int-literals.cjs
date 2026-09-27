'use strict';
/**
 * HLSL converts int literals implicitly (`t * 3`, `x + 1`, `pow(v, 2)`); GLSL ES 1.0, which
 * Cocos also compiles every effect to, does not: `highp float * const int` fails at import
 * (EFX2406). This pass rewrites integer literals to float literals in statement code, except
 * where an integer is required or likely:
 * - preprocessor, declaration-only and layout/precision lines;
 * - array subscripts `[..]` and array sizes;
 * - arguments of int/uint/ivec/uvec/bool constructors and texelFetch-style integer calls;
 * - `for (...)` headers (loop counters) and `case N:` labels;
 * - operands of `%`, `&`, `|`, `^`, `<<`, `>>`, `~`;
 * - any statement that mentions a variable declared with an integer type (its mix of int
 *   and float operands is left for the author: promoting there could create the reverse error).
 * Float literals, hex literals and identifiers containing digits are untouched.
 */

const INT_TYPES = /\b(?:int|uint|ivec[234]|uvec[234]|bool)\s+([A-Za-z_]\w*)/g;
const INT_CALLS = /\b(?:int|uint|ivec[234]|uvec[234]|bool|texelFetch|textureSize|bitfieldExtract)\s*\($/;
const SKIP_LINE = /^\s*(?:#|layout\b|precision\b|uniform\b|in\b|out\b|attribute\b|varying\b|struct\b|\}|\{)/;
const LITERAL = /(?<![\w.])(\d+)(?![\w.])/g;

function integerNames(code) {
  const names = new Set();
  for (const m of code.matchAll(INT_TYPES)) names.add(m[1]);
  return names;
}

/** Index ranges covered by `open ... close` groups that start where `test(prefix)` holds. */
function guardedRanges(line, opener, closer, test) {
  const ranges = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== opener || !test(line.slice(0, i))) continue;
    let depth = 0;
    for (let j = i; j < line.length; j++) {
      if (line[j] === opener) depth++;
      else if (line[j] === closer && --depth === 0) { ranges.push([i, j]); break; }
    }
  }
  return ranges;
}

function promoteLine(line, intNames) {
  if (SKIP_LINE.test(line) || /\bfor\s*\(/.test(line) || /\bcase\s+\d/.test(line)) return line;
  for (const name of intNames) if (new RegExp(`\\b${name}\\b`).test(line)) return line;
  // A declaration of an integer-typed local keeps its initializer integral.
  if (/\b(?:int|uint|ivec[234]|uvec[234]|bool)\s+[A-Za-z_]\w*\s*(?:=|;|\[)/.test(line)) return line;
  const guarded = [
    ...guardedRanges(line, '[', ']', () => true),
    ...guardedRanges(line, '(', ')', (prefix) => INT_CALLS.test(prefix)),
  ];
  return line.replace(LITERAL, (match, digits, offset) => {
    if (guarded.some(([a, b]) => offset > a && offset < b)) return match;
    const before = line.slice(0, offset).trimEnd(), after = line.slice(offset + match.length).trimStart();
    if (/(?:%|&|\||\^|<<|>>|~)$/.test(before) || /^(?:%|&|\||\^|<<|>>)/.test(after)) return match;
    return `${digits}.0`;
  });
}

/** Promote int literals inside function bodies of one GLSL stage. */
function promoteIntLiterals(code) {
  const intNames = integerNames(code);
  let depth = 0;
  return code.split('\n').map((line) => {
    const inFunction = depth > 0;
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1); }
    // Only statement lines inside a function body (uniform blocks close on the same depth pattern
    // but their member lines are declaration-only and skipped by SKIP_LINE / the declaration test).
    return inFunction ? promoteLine(line, intNames) : line;
  }).join('\n');
}

module.exports = { promoteIntLiterals, promoteLine, integerNames };
