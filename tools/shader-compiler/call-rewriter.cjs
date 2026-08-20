'use strict';

/**
 * Balanced-paren call rewriter for HLSL -> GLSL lowering.
 *
 * Lowering rules must NOT capture call arguments with flat character classes
 * such as `[^)]+` or `[^,]+`: those stop at the first `)` or `,` and therefore
 * mis-handle every nested call. `saturate(dot(a,b))` becomes
 * `clamp(dot(a,b, 0.0, 1.0))` -- the outer function's extra arguments get
 * injected into the inner call. `clip(min(a,b) - c);` matches nothing at all
 * and survives into the emitted GLSL as an undefined function.
 *
 * Use `replaceCall` / `replaceCallStatement` instead. Both scan to the true
 * matching parenthesis and split arguments on top-level commas only.
 */

const OPEN = { '(': ')', '[': ']' };

/**
 * Split an argument list on top-level commas.
 * Respects (), [], string/char literals. Ignores commas nested in calls.
 * @param {string} src raw text between the outer parentheses
 * @returns {string[]} trimmed arguments ([] for an empty list)
 */
function splitArgs(src) {
  if (src == null) return [];
  const text = String(src);
  if (!text.trim()) return [];

  const args = [];
  let depth = 0;
  let start = 0;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }

    if (OPEN[ch]) depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

/**
 * Find the index of the `)` matching the `(` at `openIdx`.
 * @returns {number} index of the closing paren, or -1 if unbalanced
 */
function matchParen(text, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const IDENT_TAIL = /[A-Za-z0-9_]/;

/** True when `text[idx]` starts a real identifier (not the tail of a longer one). */
function isTokenStart(text, idx) {
  if (idx === 0) return true;
  const prev = text[idx - 1];
  // `.Sample` style member calls are matched by their own patterns, so a
  // preceding `.` still counts as a boundary for the bare-name forms we rewrite.
  return !IDENT_TAIL.test(prev) && prev !== '.';
}

/**
 * Rewrite every call to `name(...)` using balanced-paren argument parsing.
 * Arguments are recursively rewritten first, so nested same-name calls
 * (`saturate(saturate(x))`) lower correctly in a single pass.
 *
 * @param {string} code
 * @param {string|string[]} names function name(s) to match
 * @param {(args: string[], raw: string) => string|null} build
 *        receives the split arguments; return the replacement text, or `null`
 *        to leave the call untouched (e.g. wrong arity).
 * @returns {string}
 */
function replaceCall(code, names, build) {
  if (!code) return code || '';
  const list = Array.isArray(names) ? names : [names];
  let out = String(code);

  for (const name of list) {
    let cursor = 0;
    let result = '';

    while (cursor < out.length) {
      const found = out.indexOf(name, cursor);
      if (found === -1) break;

      const after = found + name.length;
      // must be a standalone identifier followed by optional space then '('
      let p = after;
      while (p < out.length && (out[p] === ' ' || out[p] === '\t')) p++;
      if (!isTokenStart(out, found) || out[p] !== '(' ||
          (after < out.length && IDENT_TAIL.test(out[after]))) {
        result += out.slice(cursor, after);
        cursor = after;
        continue;
      }

      const close = matchParen(out, p);
      if (close === -1) {
        result += out.slice(cursor, after);
        cursor = after;
        continue;
      }

      const inner = out.slice(p + 1, close);
      // recurse into arguments so inner occurrences lower before the outer call
      const loweredInner = replaceCall(inner, name, build);
      const args = splitArgs(loweredInner);
      const replacement = build(args, loweredInner);

      result += out.slice(cursor, found);
      if (replacement == null) {
        result += `${name}(${loweredInner})`;
      } else {
        result += replacement;
      }
      cursor = close + 1;
    }

    result += out.slice(cursor);
    out = result;
  }

  return out;
}

/**
 * Like `replaceCall`, but for statement-form intrinsics that consume a trailing
 * `;` (e.g. `clip(x);` -> `if ((x) < 0.0) { discard; }`). The expression may
 * contain nested calls and trailing arithmetic outside the call parens is kept.
 *
 * @param {string} code
 * @param {string} name
 * @param {(args: string[], raw: string) => string|null} build
 */
function replaceCallStatement(code, name, build) {
  if (!code) return code || '';
  let out = String(code);
  let cursor = 0;
  let result = '';

  while (cursor < out.length) {
    const found = out.indexOf(name, cursor);
    if (found === -1) break;

    const after = found + name.length;
    let p = after;
    while (p < out.length && (out[p] === ' ' || out[p] === '\t')) p++;
    if (!isTokenStart(out, found) || out[p] !== '(') {
      result += out.slice(cursor, after);
      cursor = after;
      continue;
    }

    const close = matchParen(out, p);
    if (close === -1) {
      result += out.slice(cursor, after);
      cursor = after;
      continue;
    }

    // consume the rest of the statement: `clip(a) - b;` -> expr is `(a) - b`
    let end = close + 1;
    let depth = 0;
    while (end < out.length) {
      const ch = out[end];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') {
        if (depth === 0) break; // closing paren of an enclosing construct
        depth--;
      } else if (ch === ';' && depth === 0) break;
      else if ((ch === '\n' || ch === '{' || ch === '}') && depth === 0) break;
      end++;
    }

    const tail = out.slice(close + 1, end);
    const inner = out.slice(p + 1, close);
    const args = splitArgs(inner);
    const expr = tail.trim() ? `(${inner})${tail}` : inner;
    const replacement = build(args, expr);

    result += out.slice(cursor, found);
    if (replacement == null) {
      result += out.slice(found, end);
    } else {
      result += replacement;
      // swallow the terminating semicolon; the replacement supplies its own
      if (out[end] === ';') end++;
    }
    cursor = end;
  }

  result += out.slice(cursor);
  return result;
}

module.exports = { splitArgs, matchParen, replaceCall, replaceCallStatement };
