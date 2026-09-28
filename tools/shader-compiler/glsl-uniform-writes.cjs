'use strict';
// HLSL treats material properties as per-invocation globals, so vendor shaders write to them
// (KriptoFX RFX4_Tornado: `_TwistScale = pow(_TwistScale, 0.4545);`). GLSL uniforms are
// read-only ("l-value required (can't modify a uniform)"). A stage body that assigns a uniform
// gets a local copy initialised from the uniform, and every use in that body reads the copy,
// which is exactly HLSL's semantics for the rest of the invocation.

const DECL = /^\s*(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*;/;

/** name -> GLSL type of the plain (non-array) members declared in a uniform block text. */
function uniformMembers(uboGlsl) {
  const members = new Map();
  for (const line of String(uboGlsl || '').split('\n')) {
    if (/\buniform\b/.test(line)) continue; // the block header itself
    const m = DECL.exec(line);
    if (m && !m[3]) members.set(m[2], m[1]);
  }
  return members;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrites a lowered stage body so assignments to uniforms target a local copy.
 * Returns the body unchanged when it writes no uniform.
 */
function shadowWrittenUniforms(body, uboGlsl) {
  const members = uniformMembers(uboGlsl);
  const written = [];
  for (const [name, type] of members) {
    const id = escape(name);
    // A body that declares a local of the same name (Unity `float4 tintColor = _TintColor * c;` after
    // `_TintColor` -> `tintColor`) already shadows the uniform; GLSL scopes the local from its
    // initializer on, so its writes are legal and must stay on the local.
    const declares = new RegExp(`(?:^|[;{}(,\\s])(?:const\\s+)?(?:(?:highp|mediump|lowp)\\s+)?(?:float|int|uint|bool|[biu]?vec[234]|mat[234](?:x[234])?)\\s+${id}\\s*(?:=|;|,|\\[)`, 'm');
    if (declares.test(body)) continue;
    // `name =`, `name +=` ..., `name.xy =`, `name++`, `++name`; not `name ==`.
    const write = new RegExp(`(?<![\\w.])${id}(?:\\s*\\.\\s*[xyzwrgba]{1,4})?\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)|(?:\\+\\+|--)\\s*${id}\\b`);
    if (write.test(body)) written.push([name, type]);
  }
  if (!written.length) return body;
  let out = body;
  const decls = [];
  for (const [name, type] of written) {
    let local = `${name}_rw`;
    while (new RegExp(`\\b${escape(local)}\\b`).test(out)) local += '_';
    out = out.replace(new RegExp(`(?<![\\w.])${escape(name)}\\b`, 'g'), local);
    decls.push(`${type} ${local} = ${name};`);
  }
  return `${decls.join('\n')}\n${out}`;
}

module.exports = { uniformMembers, shadowWrittenUniforms };
