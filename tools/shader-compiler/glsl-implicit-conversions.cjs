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
  if (new RegExp(`^${NUMBER}$`).test(e)) return 1;
  const id = /^([A-Za-z_]\w*)(?:\.([xyzwrgba]{1,4}))?$/.exec(e);
  if (id) return id[2] ? id[2].length : widthOfType(types.get(id[1]));
  // `a * b / c` at top level: component-wise, so the result is the vector operand's width,
  // provided every operand's width is known and they agree (scalars broadcast).
  const factors = splitTopLevel(e, /[*/]/);
  if (factors.length > 1) {
    const widths = factors.map(f => knownWidth(f, types));
    if (widths.some(w => !w)) return null;
    const vec = [...new Set(widths.filter(w => w > 1))];
    return vec.length === 0 ? 1 : vec.length === 1 ? vec[0] : null;
  }
  return null;
}

/** Split on single-character operators outside parentheses/brackets; [] when a + - or ? is top-level. */
function splitTopLevel(e, operator) {
  const parts = [];
  let depth = 0, last = 0;
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && /[+\-?:<>=&|,]/.test(ch) && !(ch === '-' && /[*/(,]\s*$|^\s*$/.test(e.slice(last, i)))) return [];
    else if (depth === 0 && operator.test(ch)) { parts.push(e.slice(last, i)); last = i + 1; }
  }
  parts.push(e.slice(last));
  return parts.map(p => p.trim()).filter(Boolean);
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

/** A scalar literal next to a vector argument of a component-wise builtin (`max(0.00001, col)`). */
function broadcastBuiltinScalars(expression, types) {
  return expression
    .replace(new RegExp(`\\b(max|min|step|pow)\\s*\\(\\s*(${NUMBER})\\s*,\\s*([A-Za-z_]\\w*)\\s*\\)`, 'g'), (m, fn, lit, id) => {
      const w = widthOfType(types.get(id));
      return w > 1 ? `${fn}(vec${w}(${lit}), ${id})` : m;
    })
    .replace(new RegExp(`\\b(max|min)\\s*\\(\\s*([A-Za-z_]\\w*)\\s*,\\s*(${NUMBER})\\s*\\)`, 'g'), (m, fn, id, lit) => {
      const w = widthOfType(types.get(id));
      return w > 1 ? `${fn}(${id}, vec${w}(${lit}))` : m;
    });
}

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

  // 3. int operands of float arithmetic (`v.z * steps`). Only direct operands of * / + -: an int
  // passed as a call argument (`ShadeCustomLights(v, n, lightCount)`) must stay int.
  if (intNames.size) {
    const masked = rhs.replace(/\[[^\[\]]*\]/g, s => ' '.repeat(s.length));
    let out = '';
    let last = 0;
    for (const id of masked.matchAll(/(?<![\w.])([A-Za-z_]\w*)\b(?!\s*\()/g)) {
      if (!intNames.has(id[1])) continue;
      const before = masked.slice(0, id.index).trimEnd();
      const after = masked.slice(id.index + id[1].length).trimStart();
      if (!/[*/+-]$/.test(before) && !/^[*/+-](?!=)/.test(after)) continue;
      out += rhs.slice(last, id.index) + `float(${id[1]})`;
      last = id.index + id[1].length;
    }
    if (last) rhs = out + rhs.slice(last);
  }

  rhs = broadcastBuiltinScalars(rhs, types);

  // 4. scalar literal broadcast.
  if (lhsWidth > 1 && op === '=' && new RegExp(`^${NUMBER}$`).test(rhs)) rhs = `vec${lhsWidth}(${rhs})`;

  // 5. truncation of a known 4-wide expression.
  if (lhsWidth < 4) {
    const rw = knownWidth(rhs, types);
    if (rw === 4) rhs = `(${rhs})${SWIZZLE[lhsWidth]}`;
  }

  if (rhs === rhsRaw.trim()) return line;
  return `${indent}${declType ? `${declType} ` : ''}${name}${swizzle || ''} ${op} ${rhs};${rest}`;
}

/**
 * 2. Non-constant `for` bounds -> capped constant loop with an early break. ES 1.0 also only
 * accepts the loop index (not a copy) as an array subscript, so `[index]` in the body becomes
 * `[index_es]`; `index` itself still holds the value for everything else.
 */
function capLoops(code, types) {
  const header = /\bfor\s*\(\s*(?:int\s+)?([A-Za-z_]\w*)\s*=\s*(\d+)\s*;\s*\1\s*(<=?)\s*([^;]+?)\s*;\s*(\1\+\+|\+\+\1|\1\s*\+=\s*1)\s*\)\s*\{/g;
  let out = '', last = 0, m;
  while ((m = header.exec(code))) {
    const [text, index, start, cmp, bound] = m;
    if (new RegExp(`^${NUMBER}$`).test(bound.trim())) continue;
    // Body: from the opening brace to its matching close.
    const open = m.index + text.length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) { close = i; break; }
    }
    if (close < 0) continue;
    const loop = `${index}_es`;
    const declared = types.has(index) && !new RegExp(`for\\s*\\(\\s*int\\s+${index}\\b`).test(text);
    const guard = `if (${index} ${cmp === '<' ? '>=' : '>'} ${bound.trim()}) break;`;
    const body = code.slice(open + 1, close).replace(new RegExp(`\\[\\s*${index}\\s*\\]`, 'g'), `[${loop}]`);
    out += code.slice(last, m.index)
      + `for (int ${loop} = ${start}; ${loop} < ${LOOP_CAP}; ${loop}++) {\n${declared ? '' : 'int '}${index} = ${loop}; ${guard}`
      + body + '}';
    last = close + 1;
    header.lastIndex = close + 1;
  }
  return out + code.slice(last);
}

function glslImplicitConversions(code) {
  const types = declaredTypes(code);
  const intNames = new Set([...types].filter(([, t]) => t === 'int' || t === 'uint').map(([n]) => n));
  const capped = capLoops(code, types);
  return capped.split('\n').map((raw) => {
    // Vendor HLSL often keeps CRLF; `.` does not match '\r', so rewrite the line without it.
    const cr = raw.endsWith('\r') ? '\r' : '';
    const line = cr ? raw.slice(0, -1) : raw;
    // One-line `if (cond) stmt;` / `else stmt;` / `else if (cond) stmt;`: rewrite the statement part.
    const guard = /^\s*(?:else\b\s*)?(?:if\s*\()?/.exec(line)[0];
    if (/\b(?:if|else)\b/.test(guard)) {
      let end = guard.length;
      if (/\($/.test(guard)) {
        let depth = 1;
        while (end < line.length && depth > 0) { if (line[end] === '(') depth++; else if (line[end] === ')') depth--; end++; }
        if (depth) return raw;
      }
      const stmt = line.slice(end);
      if (!stmt.trim() || /^\s*\{/.test(stmt) || /^\s*(?:if|for|while|return)\b/.test(stmt)) return raw;
      const lead = stmt.match(/^\s*/)[0];
      return line.slice(0, end) + lead + rewriteStatement(stmt.slice(lead.length), types, intNames).trimStart() + cr;
    }
    if (/^\s*(?:#|layout\b|precision\b|uniform\b|attribute\b|varying\b|in\b|out\b|for\b|while\b|\}|\{)/.test(line)) return raw;
    const ret = /^(\s*)return\s+([^;]+);(.*)$/.exec(line);
    // Literal returns are handled by glsl-es1-compat scalarReturns; only builtin broadcasts here.
    if (ret) {
      const expr = broadcastBuiltinScalars(ret[2], types);
      return expr === ret[2] ? raw : `${ret[1]}return ${expr};${ret[3]}${cr}`;
    }
    return rewriteStatement(line, types, intNames) + cr;
  }).join('\n');
}

module.exports = { glslImplicitConversions, declaredTypes, knownWidth, LOOP_CAP };
