'use strict';

/**
 * GLSL ES reserved words that are legal HLSL identifiers.
 *
 * Cocos compiles every effect for GLSL ES 1.00 (WebGL 1) as well as 3.00, and refuses a
 * program that uses a word the spec reserves "for future use", e.g. TextMeshPro's
 * TMP_SDF.shader `pixel_t output;`:
 *
 *     Error EFX2402: using reserved keyword in glsl1: output
 *
 * The effect is written, but the importer marks it failed and every material/scene that
 * references it later reports `download failed: import://...json`.
 *
 * RENAMEABLE are words HLSL code can only use as names (variables, parameters, functions,
 * struct members), so renaming every occurrence consistently is behaviour-preserving.
 * Qualifier/type-like words (`static`, `inline`, `half`, `fixed`, `double`, `sampler1D`,
 * ...) are NOT renamed: if one survives lowering the program is wrong for a different
 * reason, so the validator reports them instead of hiding them behind a new name.
 * Sources: GLSL ES 1.00 spec s3.7 and GLSL ES 3.00 spec s3.8 (reserved keywords).
 */
const RENAMEABLE = Object.freeze([
  'input', 'output', 'filter', 'sample', 'active', 'common', 'partition', 'resource', 'patch',
  'subroutine', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'packed', 'goto',
  'public', 'extern', 'external', 'interface', 'sizeof', 'cast', 'namespace', 'using', 'asm',
  'noinline', 'superp', 'coherent', 'restrict', 'readonly', 'writeonly', 'noperspective',
]);
const REPORT_ONLY = Object.freeze([
  'static', 'inline', 'volatile', 'long', 'short', 'double', 'half', 'fixed', 'unsigned',
  'hvec2', 'hvec3', 'hvec4', 'dvec2', 'dvec3', 'dvec4', 'fvec2', 'fvec3', 'fvec4',
  'sampler1D', 'sampler1DShadow', 'sampler2DRect', 'sampler2DRectShadow', 'sampler3DRect',
  'atomic_uint',
]);
const RENAMEABLE_SET = new Set(RENAMEABLE);
const RESERVED_SET = new Set([...RENAMEABLE, ...REPORT_ONLY]);

/** Split GLSL into code and non-code (comments, preprocessor #include/#pragma lines). */
function segments(code) {
  const parts = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|^[ \t]*#[ \t]*(?:include|pragma)\b[^\n]*/gm;
  let last = 0;
  for (const m of code.matchAll(re)) {
    if (m.index > last) parts.push({ code: true, text: code.slice(last, m.index) });
    parts.push({ code: false, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < code.length) parts.push({ code: true, text: code.slice(last) });
  return parts;
}

function identifiersIn(code) {
  const found = new Set();
  for (const part of segments(code)) {
    if (!part.code) continue;
    for (const m of part.text.matchAll(/[A-Za-z_]\w*/g)) found.add(m[0]);
  }
  return found;
}

/** Reserved words used as identifiers in GLSL code (comments and #include/#pragma ignored). */
function findReservedIdentifiers(code) {
  return [...identifiersIn(code)].filter(name => RESERVED_SET.has(name)).sort();
}

/**
 * Rename every RENAMEABLE reserved identifier in `code` to a collision-free name
 * (`output` -> `output_`, or `output_1`, ... if taken). Returns the new code and the map.
 */
function renameReservedIdentifiers(code) {
  const used = identifiersIn(code);
  const renamed = {};
  for (const name of [...used].filter(n => RENAMEABLE_SET.has(n)).sort()) {
    let candidate = `${name}_`;
    for (let i = 1; used.has(candidate) || Object.values(renamed).includes(candidate); i++) candidate = `${name}_${i}`;
    renamed[name] = candidate;
  }
  if (!Object.keys(renamed).length) return { code, renamed };
  const text = segments(code).map((part) => (part.code
    ? part.text.replace(/[A-Za-z_]\w*/g, word => (Object.prototype.hasOwnProperty.call(renamed, word) ? renamed[word] : word))
    : part.text)).join('');
  return { code: text, renamed };
}

/** Apply renameReservedIdentifiers to every `CCProgram <name> %{ ... }%` block of an effect. */
function renameReservedInEffect(effectText) {
  const renamedByProgram = {};
  const text = effectText.replace(/(CCProgram\s+([\w-]+)\s*%\{)([\s\S]*?)(\}%)/g, (all, head, name, body, tail) => {
    const result = renameReservedIdentifiers(body);
    if (Object.keys(result.renamed).length) renamedByProgram[name] = result.renamed;
    return `${head}${result.code}${tail}`;
  });
  return { text, renamedByProgram };
}

module.exports = {
  RENAMEABLE,
  REPORT_ONLY,
  findReservedIdentifiers,
  renameReservedIdentifiers,
  renameReservedInEffect,
};
