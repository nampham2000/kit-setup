'use strict';
/**
 * Typed lowering of HLSL-flavoured GLSL (Unity ShaderGraph generated code after the textual renames) to strict
 * GLSL ES 1.00 / 3.00.
 *
 * HLSL converts implicitly where GLSL ES refuses to: int literals in float expressions, scalar -> vector splats,
 * vector truncation (float4 -> float3), scalar swizzles (`x.xxx`), float/vector predicates (`p ? a : b`,
 * component-wise `v < c ? a : b`), mixed scalar/vector intrinsic arguments (`step(v, 0.5)`), row-major matrix
 * constructors + mul(). Guessing these with regular expressions is what produced the EFX2406 "dimension mismatch" /
 * "cannot convert" / "no matching overload" failures, so this module parses every function body into an
 * expression AST, infers types from declarations (locals, parameters, struct fields, uniforms, shim signatures)
 * and inserts the exact conversions.
 *
 * Matrix convention: every GLSL matrix value holds the TRANSPOSE of the HLSL matrix (HLSL constructors are
 * row-major, GLSL column-major, and engine matrices are wrapped in sgTranspose by the shims). With that, indexing
 * m[i] keeps HLSL row semantics and mul(a, b) lowers to (b * a).
 */

const TYPE_WORDS = new Set([
  'void', 'bool', 'int', 'uint', 'float',
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'uvec2', 'uvec3', 'uvec4',
  'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube',
]);
const QUALIFIERS = new Set(['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'uniform', 'precision']);

// ---------------------------------------------------------------------------------------------------------------
// tokenizer

const MULTI_OPS = ['<<=', '>>=', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '^^', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];

function tokenize(src) {
  const out = [];
  const s = String(src);
  let i = 0;
  let lineStart = true;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (c === '#' && lineStart) {
      let e = i;
      while (e < s.length && s[e] !== '\n') { if (s[e] === '\\' && s[e + 1] === '\n') e++; e++; }
      out.push({ k: 'pp', v: s.slice(i, e).trim() });
      i = e;
      continue;
    }
    lineStart = false;
    if (/[A-Za-z_]/.test(c)) {
      let e = i + 1;
      while (e < s.length && /\w/.test(s[e])) e++;
      out.push({ k: 'id', v: s.slice(i, e) });
      i = e;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(s[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFhHuUlL]?)/.exec(s.slice(i));
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = MULTI_OPS.find((o) => s.startsWith(o, i));
    if (op) { out.push({ k: 'op', v: op }); i += op.length; continue; }
    out.push({ k: 'op', v: c });
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// expression parser (Pratt)

const BINARY = {
  '||': 3, '^^': 3, '&&': 4, '|': 5, '^': 6, '&': 7, '==': 8, '!=': 8, '<': 9, '>': 9, '<=': 9, '>=': 9,
  '<<': 10, '>>': 10, '+': 11, '-': 11, '*': 12, '/': 12, '%': 12,
};
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

class Parser {
  constructor(tokens, isType) { this.t = tokens; this.i = 0; this.isType = isType || ((n) => TYPE_WORDS.has(n)); }
  peek(o = 0) { return this.t[this.i + o]; }
  next() { return this.t[this.i++]; }
  at(v) { const t = this.peek(); return t && t.k === 'op' && t.v === v; }
  expect(v) { const t = this.next(); if (!t || t.v !== v) throw new Error(`expected '${v}' got '${t ? t.v : 'EOF'}'`); return t; }
  done() { return this.i >= this.t.length; }

  expression(minPrec = 0) {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op') break;
      if (ASSIGN.has(t.v) && minPrec <= 1) {
        this.next();
        const right = this.expression(1);
        left = { k: 'assign', op: t.v, l: left, r: right };
        continue;
      }
      if (t.v === '?' && minPrec <= 2) {
        this.next();
        const a = this.expression(1);
        this.expect(':');
        const b = this.expression(2);
        left = { k: 'ternary', c: left, a, b };
        continue;
      }
      const prec = BINARY[t.v];
      if (!prec || prec < minPrec) break;
      this.next();
      const right = this.expression(prec + 1);
      left = { k: 'binary', op: t.v, l: left, r: right };
    }
    return left;
  }

  unary() {
    const t = this.peek();
    if (!t) throw new Error('unexpected end of expression');
    if (t.k === 'op' && ['-', '+', '!', '~', '++', '--'].includes(t.v)) {
      this.next();
      return { k: 'unary', op: t.v, a: this.unary() };
    }
    // C-style cast: (type) expr
    if (t.k === 'op' && t.v === '(' && this.peek(1) && this.peek(1).k === 'id' && this.isType(this.peek(1).v)
      && this.peek(2) && this.peek(2).v === ')' && this.peek(3)
      && (this.peek(3).k !== 'op' || ['(', '-', '!', '~'].includes(this.peek(3).v))) {
      this.next();
      const type = this.next().v;
      this.next();
      return { k: 'cast', type, a: this.unary() };
    }
    return this.postfix(this.primary());
  }

  primary() {
    const t = this.next();
    if (!t) throw new Error('unexpected end of expression');
    if (t.k === 'num') return { k: 'num', v: t.v };
    if (t.k === 'id') {
      if (this.at('(')) {
        this.next();
        const args = [];
        if (!this.at(')')) {
          for (;;) {
            args.push(this.expression(1));
            if (this.at(',')) { this.next(); continue; }
            break;
          }
        }
        this.expect(')');
        return { k: 'call', name: t.v, args };
      }
      return { k: 'id', v: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      const e = this.expression(0);
      this.expect(')');
      return { k: 'paren', a: e };
    }
    throw new Error(`unexpected token '${t.v}'`);
  }

  postfix(node) {
    for (;;) {
      if (this.at('.')) {
        this.next();
        const f = this.next();
        if (!f || f.k !== 'id') throw new Error('expected member name');
        if (this.at('(')) { // method call (HLSL): kept as call with receiver
          this.next();
          const args = [];
          if (!this.at(')')) for (;;) { args.push(this.expression(1)); if (this.at(',')) { this.next(); continue; } break; }
          this.expect(')');
          node = { k: 'method', obj: node, name: f.v, args };
        } else {
          node = { k: 'member', obj: node, f: f.v };
        }
        continue;
      }
      if (this.at('[')) {
        this.next();
        const idx = this.expression(0);
        this.expect(']');
        node = { k: 'index', obj: node, idx };
        continue;
      }
      if (this.at('++') || this.at('--')) { node = { k: 'postfix', op: this.next().v, a: node }; continue; }
      return node;
    }
  }
}

function parseExpression(tokens, isType) {
  const p = new Parser(tokens, isType);
  const e = p.expression(0);
  if (!p.done()) throw new Error(`trailing tokens after expression: '${p.peek().v}'`);
  return e;
}

// ---------------------------------------------------------------------------------------------------------------
// printer

const PREC = (n) => {
  switch (n.k) {
    case 'assign': return 1;
    case 'ternary': return 2;
    case 'binary': return BINARY[n.op];
    case 'unary': case 'cast': return 13;
    default: return 14;
  }
};

function print(n) {
  switch (n.k) {
    case 'num': return normalizeNumber(n.v);
    case 'id': return n.v;
    case 'raw': return /^[\w.]+$/.test(n.v) || /^\/\*.*\*\/$/.test(n.v) ? n.v : `(${n.v})`;
    case 'paren': return `(${print(n.a)})`;
    case 'call': return `${n.name}(${n.args.map(print).join(', ')})`;
    case 'method': return `${wrap(n.obj, 14)}.${n.name}(${n.args.map(print).join(', ')})`;
    case 'member': return `${wrap(n.obj, 14)}.${n.f}`;
    case 'index': return `${wrap(n.obj, 14)}[${print(n.idx)}]`;
    case 'postfix': return `${wrap(n.a, 14)}${n.op}`;
    case 'unary': return `${n.op}${wrap(n.a, 13, n.op === '-' || n.op === '+')}`;
    case 'cast': return `${n.type}(${print(n.a)})`;
    case 'binary': return `${wrap(n.l, BINARY[n.op])} ${n.op} ${wrap(n.r, BINARY[n.op] + 1)}`;
    case 'ternary': return `${wrap(n.c, 3)} ? ${wrap(n.a, 1)} : ${wrap(n.b, 2)}`;
    case 'assign': return `${wrap(n.l, 14)} ${n.op} ${wrap(n.r, 1)}`;
    default: throw new Error(`cannot print ${n.k}`);
  }
}

function normalizeNumber(v) {
  // GLSL ES has no f/h/l suffixes; ES 1.00 has no unsigned literals either (ES 3.00 keeps 'u')
  if (/^0[xX]/.test(v)) return v.replace(/[lL]$/, '');
  if (/[uU]$/.test(v)) return v;
  return v.replace(/[fFhHlL]$/, '');
}

function wrap(n, prec, signed = false) {
  const s = print(n);
  if (PREC(n) < prec) return `(${s})`;
  if (signed && /^[-+]/.test(s)) return `(${s})`; // - -x
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// types

const vecSize = (t) => {
  if (!t) return 0;
  if (t === 'float' || t === 'int' || t === 'bool' || t === 'uint') return 1;
  const m = /^[biu]?vec([234])$/.exec(t);
  return m ? Number(m[1]) : 0;
};
const family = (t) => {
  if (!t) return null;
  if (t === 'float' || /^vec[234]$/.test(t)) return 'float';
  if (t === 'int' || t === 'uint' || /^[iu]vec[234]$/.test(t)) return 'int';
  if (t === 'bool' || /^bvec[234]$/.test(t)) return 'bool';
  if (/^mat[234]$/.test(t)) return 'mat';
  return 'other';
};
const makeType = (fam, n) => {
  if (n === 1) return fam === 'float' ? 'float' : fam === 'int' ? 'int' : 'bool';
  return (fam === 'float' ? 'vec' : fam === 'int' ? 'ivec' : 'bvec') + n;
};
const isNumericScalar = (t) => t === 'float' || t === 'int' || t === 'uint';
const isIntLiteral = (n) => n && n.k === 'num' && /^(\d+|0[xX][0-9a-fA-F]+)[uUlL]?$/.test(n.v);
const isFloatLiteral = (n) => n && n.k === 'num' && !isIntLiteral(n);

function floatLiteral(text) {
  let t = String(text).replace(/[fFhHlL]$/, '');
  if (/^0[xX]/.test(t)) return `${parseInt(t, 16)}.0`;
  t = t.replace(/[uU]$/, '');
  if (/^\d+$/.test(t)) return `${t}.0`;
  if (/^\.\d/.test(t)) return `0${t}`;
  if (/\.$/.test(t)) return `${t}0`;
  if (/^\d+[eE]/.test(t)) return t.replace(/^(\d+)/, '$1.0');
  return t;
}

/** Convert `node` of type `from` to `to` (HLSL implicit conversion semantics). */
function coerce(node, from, to) {
  if (!to || !from || from === to) return node;
  const ff = family(from), tf = family(to), fn = vecSize(from), tn = vecSize(to);
  if (!ff || !tf || ff === 'other' || tf === 'other' || ff === 'mat' || tf === 'mat') return node;
  // literal fast paths
  if (isIntLiteral(node) && tf === 'float') {
    const lit = { k: 'num', v: floatLiteral(node.v) };
    return tn === 1 ? lit : { k: 'call', name: to, args: [lit] };
  }
  if (isFloatLiteral(node) && tf === 'int' && tn === 1) return { k: 'call', name: 'int', args: [node] };
  if (fn === 1 && tn > 1) { // splat
    const scalar = coerce(node, from, makeType(tf, 1));
    return { k: 'call', name: to, args: [scalar] };
  }
  if (fn > 1 && tn < fn) { // truncation
    const sw = 'xyzw'.slice(0, tn);
    const truncated = { k: 'member', obj: node, f: sw };
    return ff === tf ? truncated : { k: 'call', name: to, args: [truncated] };
  }
  if (fn === tn) {
    if (tf === 'bool' && tn === 1) return { k: 'binary', op: '!=', l: node, r: { k: 'num', v: ff === 'float' ? '0.0' : '0' } };
    return { k: 'call', name: to, args: [node] };
  }
  if (fn < tn && fn > 1) { // HLSL cannot widen vectors implicitly; keep (caller reports)
    return node;
  }
  return node;
}

// ---------------------------------------------------------------------------------------------------------------
// builtin function typing

const GEN1 = new Set(['radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'exp', 'log', 'exp2', 'log2', 'sqrt',
  'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'normalize', 'dFdx', 'dFdy', 'fwidth', 'trunc', 'round']);
// functions whose float-typed parameters may take a scalar in the listed positions (GLSL ES overloads)
const SCALAR_OK = {
  mod: [1], min: [1], max: [1], clamp: [1, 2], mix: [2], step: [0], smoothstep: [0, 1],
  pow: [], atan: [], reflect: [], refract: [2], distance: [], dot: [], cross: [], faceforward: [],
};

/**
 * Scope-aware typed rewriter. `env` gives: lookupVar(name) -> type, structField(struct, field) -> type,
 * functions(name) -> [{ret, params:[{type, qual}]}].
 */
class Typer {
  constructor(env, diagnostics) { this.env = env; this.diag = diagnostics || []; }

  /** Returns { n: node, t: type|null } */
  visit(n) {
    switch (n.k) {
      case 'num': return { n, t: isIntLiteral(n) ? (/[uU]$/.test(n.v) ? 'uint' : 'int') : 'float' };
      case 'raw': return { n, t: n.t || null };
      case 'id': {
        const g = this.env.globalExpr ? this.env.globalExpr(n.v) : null;
        if (g) return { n: { k: 'raw', v: g.text, t: g.type }, t: g.type };
        return { n, t: this.env.lookupVar(n.v) || null };
      }
      case 'paren': { const a = this.visit(n.a); return { n: { k: 'paren', a: a.n }, t: a.t }; }
      case 'member': return this.member(n);
      case 'index': {
        const o = this.visit(n.obj);
        const idx = this.visit(n.idx);
        let t = null;
        if (o.t) {
          const arr = /^(.+)\[\d*\]$/.exec(o.t);
          if (arr) t = arr[1];
          else if (/^mat([234])$/.test(o.t)) t = `vec${o.t[3]}`;
          else if (vecSize(o.t) > 1) t = makeType(family(o.t), 1);
        }
        const index = idx.t === 'float' ? coerce(idx.n, 'float', 'int') : idx.n;
        return { n: { k: 'index', obj: o.n, idx: index }, t };
      }
      case 'postfix': { const a = this.visit(n.a); return { n: { k: 'postfix', op: n.op, a: a.n }, t: a.t }; }
      case 'unary': {
        const a = this.visit(n.a);
        if (n.op === '!') {
          return { n: { k: 'unary', op: '!', a: a.t && a.t !== 'bool' && vecSize(a.t) === 1 ? { k: 'paren', a: coerce(a.n, a.t, 'bool') } : a.n }, t: 'bool' };
        }
        return { n: { k: 'unary', op: n.op, a: a.n }, t: a.t };
      }
      case 'cast': {
        const a = this.visit(n.a);
        if (this.env.isStruct && this.env.isStruct(n.type)) return { n: { k: 'raw', v: `/*zero ${n.type}*/`, zeroStruct: n.type }, t: n.type };
        return { n: this.constructorCall(n.type, [a]), t: n.type };
      }
      case 'call': return this.call(n);
      case 'method': {
        const obj = this.visit(n.obj);
        const args = n.args.map((a) => this.visit(a).n);
        return { n: { k: 'method', obj: obj.n, name: n.name, args }, t: null };
      }
      case 'binary': return this.binary(n);
      case 'ternary': return this.ternary(n);
      case 'assign': return this.assign(n);
      default: return { n, t: null };
    }
  }

  member(n) {
    const o = this.visit(n.obj);
    const t = o.t;
    if (t && family(t) && family(t) !== 'other' && family(t) !== 'mat' && /^[xyzwrgbastpq]+$/.test(n.f)) {
      const size = n.f.length;
      if (vecSize(t) === 1) {
        // scalar swizzle (HLSL only): x.x -> x, x.xxx -> vec3(x)
        if (!/^[xr]+$/.test(n.f)) this.diag.push({ severity: 'high', code: 'SG_SCALAR_SWIZZLE', message: `invalid scalar swizzle .${n.f}` });
        if (size === 1) return { n: o.n, t };
        const target = makeType(family(t), size);
        return { n: { k: 'call', name: target, args: [o.n] }, t: target };
      }
      return { n: { k: 'member', obj: o.n, f: n.f }, t: makeType(family(t), size) };
    }
    let ft = null;
    if (t && this.env.structField) ft = this.env.structField(t, n.f);
    return { n: { k: 'member', obj: o.n, f: n.f }, t: ft };
  }

  constructorCall(type, visited) {
    const fam = family(type);
    const args = visited.map((v) => {
      // numeric literals become float for vecN/matN, int for ivecN
      if (fam === 'float' || fam === 'mat') return coerceScalarLiteral(v, 'float');
      if (fam === 'int' && isFloatLiteral(v.n)) return v.n;
      return v.n;
    });
    // mat constructors: keep argument order (GLSL value = transpose of HLSL matrix, see header)
    return { k: 'call', name: type, args };
  }

  call(n) {
    const name = n.name;
    const visited = n.args.map((a) => this.visit(a));
    if (TYPE_WORDS.has(name) && name !== 'void') {
      if ((name === 'float' || name === 'int' || name === 'bool') && visited.length === 1 && visited[0].t && vecSize(visited[0].t) > 1) {
        // HLSL float(vec) truncates to .x
        return { n: { k: 'call', name, args: [{ k: 'member', obj: visited[0].n, f: 'x' }] }, t: name };
      }
      return { n: this.constructorCall(name, visited), t: name === 'uint' ? 'int' : name };
    }
    if (name === 'mul' && visited.length === 2) {
      const [a, b] = visited;
      const t = mulType(a.t, b.t);
      return { n: { k: 'paren', a: { k: 'binary', op: '*', l: b.n, r: a.n } }, t };
    }
    const user = this.env.functions && this.env.functions(name);
    if (user && user.length) return this.userCall(name, user, visited);
    return this.builtinCall(name, visited);
  }

  userCall(name, overloads, visited) {
    let pick = overloads.filter((o) => o.params.length === visited.length);
    if (pick.length > 1) {
      const exact = pick.find((o) => o.params.every((p, i) => !visited[i].t || p.type === visited[i].t));
      pick = exact ? [exact] : pick;
      if (!exact) {
        const scored = pick.map((o) => ({ o, s: o.params.reduce((acc, p, i) => acc + (visited[i].t ? Math.abs(vecSize(p.type) - vecSize(visited[i].t)) : 0), 0) }));
        scored.sort((x, y) => x.s - y.s);
        pick = [scored[0].o];
      }
    }
    const sig = pick[0];
    if (!sig) return { n: { k: 'call', name, args: visited.map((v) => v.n) }, t: null };
    const outFix = [];
    const args = visited.map((v, i) => {
      const p = sig.params[i];
      if (!p) return v.n;
      if (p.qual === 'out' || p.qual === 'inout') {
        // HLSL converts out arguments implicitly (e.g. a float variable bound to an `out bool`); GLSL needs the exact
        // type: the statement emitter routes such arguments through a temporary.
        if (v.t && p.type && v.t !== p.type && family(v.t) && family(p.type) && family(v.t) !== 'other' && family(p.type) !== 'other') {
          const temp = `sgOut${Typer.tempCounter = (Typer.tempCounter || 0) + 1}`;
          outFix.push({ temp, arg: v.n, argType: v.t, paramType: p.type, inout: p.qual === 'inout' });
          return { k: 'id', v: temp };
        }
        return v.n;
      }
      return coerce(v.n, v.t, p.type);
    });
    const node = { k: 'call', name, args };
    if (outFix.length) node.outFix = outFix;
    return { n: node, t: sig.ret === 'void' ? null : sig.ret };
  }

  builtinCall(name, visited) {
    const args = visited.map((v) => v.n);
    const types = visited.map((v) => v.t);
    const result = (t) => ({ n: { k: 'call', name, args }, t });
    if (GEN1.has(name)) {
      if (types[0] === 'int') args[0] = coerce(args[0], 'int', 'float');
      return result(types[0] === 'int' ? 'float' : types[0]);
    }
    if (['length', 'distance', 'dot'].includes(name)) {
      normalizeGen(args, types, SCALAR_OK[name] || []);
      return result('float');
    }
    if (['min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'mod', 'pow', 'atan', 'reflect', 'refract', 'cross', 'faceforward'].includes(name)) {
      const t = normalizeGen(args, types, SCALAR_OK[name] || []);
      if (name === 'mix' && types[2] && family(types[2]) === 'bool') {
        // mix(a, b, bvec) is ES 3.00 only: select with a float weight
        args[2] = coerce(args[2], types[2], makeType('float', vecSize(types[2])));
      }
      return result(t);
    }
    if (['lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual'].includes(name)) {
      return result(types[0] ? makeType('bool', vecSize(types[0])) : null);
    }
    if (name === 'any' || name === 'all') {
      if (types[0] && family(types[0]) !== 'bool') {
        const n2 = vecSize(types[0]);
        args[0] = n2 === 1 ? coerce(args[0], types[0], 'bool')
          : { k: 'call', name: 'notEqual', args: [args[0], { k: 'call', name: makeType(family(types[0]) === 'int' ? 'int' : 'float', n2), args: [{ k: 'num', v: family(types[0]) === 'int' ? '0' : '0.0' }] }] };
        if (n2 === 1) return { n: args[0], t: 'bool' };
      }
      return result('bool');
    }
    if (name === 'not') return result(types[0]);
    if (/^texture(2D|Cube)?(Lod|Proj)?$|^sgTex/.test(name)) return result('vec4');
    if (name === 'transpose' || name === 'sgTranspose') return result(types[0]);
    if (name === 'determinant') return result('float');
    return result(null);
  }

  binary(n) {
    const l = this.visit(n.l);
    const r = this.visit(n.r);
    let ln = l.n, rn = r.n;
    const lt = l.t, rt = r.t;
    const op = n.op;
    if (op === '&&' || op === '||' || op === '^^') {
      if (lt && lt !== 'bool' && vecSize(lt) === 1) ln = coerce(ln, lt, 'bool');
      if (rt && rt !== 'bool' && vecSize(rt) === 1) rn = coerce(rn, rt, 'bool');
      return { n: { k: 'binary', op, l: ln, r: rn }, t: 'bool' };
    }
    if (['<', '>', '<=', '>=', '==', '!='].includes(op)) {
      const size = Math.max(vecSize(lt), vecSize(rt));
      const fam = (family(lt) === 'float' || family(rt) === 'float') ? 'float' : (family(lt) || family(rt));
      if (lt && rt && family(lt) !== family(rt) && fam === 'float') {
        if (family(lt) === 'int') ln = coerce(ln, lt, makeType('float', vecSize(lt)));
        if (family(rt) === 'int') rn = coerce(rn, rt, makeType('float', vecSize(rt)));
      }
      if (size > 1 && lt && rt) {
        // HLSL compares component-wise
        const vt = makeType(fam === 'bool' ? 'float' : fam, size);
        const L = coerce(ln, family(lt) === 'int' && fam === 'float' ? makeType('float', vecSize(lt)) : lt, vt);
        const R = coerce(rn, family(rt) === 'int' && fam === 'float' ? makeType('float', vecSize(rt)) : rt, vt);
        const fn = { '<': 'lessThan', '>': 'greaterThan', '<=': 'lessThanEqual', '>=': 'greaterThanEqual', '==': 'equal', '!=': 'notEqual' }[op];
        return { n: { k: 'call', name: fn, args: [L, R] }, t: makeType('bool', size) };
      }
      return { n: { k: 'binary', op, l: ln, r: rn }, t: 'bool' };
    }
    // arithmetic
    if (lt && rt) {
      const lf = family(lt), rf = family(rt);
      if (lf === 'mat' || rf === 'mat') {
        if (op === '*' && lf === 'mat' && rf === 'mat') {
          // HLSL '*' on matrices is component-wise
          return { n: { k: 'call', name: 'matrixCompMult', args: [ln, rn] }, t: lt };
        }
        if (lf === 'mat' && rf !== 'mat' && vecSize(rt) === 1 && rf === 'int') rn = coerce(rn, rt, 'float');
        if (rf === 'mat' && lf !== 'mat' && vecSize(lt) === 1 && lf === 'int') ln = coerce(ln, lt, 'float');
        return { n: { k: 'binary', op, l: ln, r: rn }, t: lf === 'mat' ? lt : rt };
      }
      const ls = vecSize(lt), rs = vecSize(rt);
      const fam = lf === 'float' || rf === 'float' ? 'float' : lf;
      if (lf !== rf && fam === 'float') {
        if (lf !== 'float') ln = coerce(ln, lt, makeType('float', ls));
        if (rf !== 'float') rn = coerce(rn, rt, makeType('float', rs));
      }
      if (ls > 1 && rs > 1 && ls !== rs) {
        // HLSL truncates the wider operand
        const size = Math.min(ls, rs);
        if (ls > size) ln = coerce(ln, makeType(fam, ls), makeType(fam, size));
        else rn = coerce(rn, makeType(fam, rs), makeType(fam, size));
        return { n: { k: 'binary', op, l: ln, r: rn }, t: makeType(fam, size) };
      }
      if (op === '%' && fam === 'float') {
        return { n: { k: 'call', name: 'sgFmod', args: [ln, rn] }, t: makeType(fam, Math.max(ls, rs)) };
      }
      return { n: { k: 'binary', op, l: ln, r: rn }, t: makeType(fam, Math.max(ls, rs)) };
    }
    // one side unknown: promote an int literal next to a known float
    if (lt && family(lt) === 'float' && isIntLiteral(rn)) rn = coerce(rn, 'int', 'float');
    if (rt && family(rt) === 'float' && isIntLiteral(ln)) ln = coerce(ln, 'int', 'float');
    if (!lt && !rt && (isIntLiteral(ln) || isIntLiteral(rn))) {
      // unknown operands: HLSL shader math is float unless proven int
      if (isIntLiteral(ln) && !isIntLiteral(rn)) ln = coerce(ln, 'int', 'float');
      if (isIntLiteral(rn) && !isIntLiteral(ln)) rn = coerce(rn, 'int', 'float');
    }
    if (op === '%' && (family(lt) === 'float' || family(rt) === 'float')) {
      return { n: { k: 'call', name: 'sgFmod', args: [ln, rn] }, t: lt || rt };
    }
    return { n: { k: 'binary', op, l: ln, r: rn }, t: lt || rt };
  }

  ternary(n) {
    const c = this.visit(n.c);
    const a = this.visit(n.a);
    const b = this.visit(n.b);
    let an = a.n, bn = b.n;
    let t = a.t || b.t;
    if (a.t && b.t && a.t !== b.t) {
      const size = Math.max(vecSize(a.t), vecSize(b.t));
      const fam = family(a.t) === 'float' || family(b.t) === 'float' ? 'float' : family(a.t);
      t = makeType(fam, size);
      an = coerce(an, a.t, t);
      bn = coerce(bn, b.t, t);
    } else if (!a.t && b.t) { an = coerce(an, isIntLiteral(an) ? 'int' : null, b.t); t = b.t; }
    else if (a.t && !b.t) { bn = coerce(bn, isIntLiteral(bn) ? 'int' : null, a.t); }
    const ct = c.t;
    if (ct && vecSize(ct) > 1) {
      // component-wise select: mix(b, a, vecN(cond))
      const size = vecSize(ct);
      const vt = t && vecSize(t) === size ? t : makeType('float', size);
      const weight = family(ct) === 'bool' ? { k: 'call', name: makeType('float', size), args: [c.n] } : coerce({ k: 'call', name: 'notEqual', args: [c.n, { k: 'call', name: makeType(family(ct) === 'int' ? 'int' : 'float', size), args: [{ k: 'num', v: family(ct) === 'int' ? '0' : '0.0' }] }] }, makeType('bool', size), makeType('float', size));
      return { n: { k: 'call', name: 'mix', args: [coerce(bn, t, vt), coerce(an, t, vt), weight] }, t: vt };
    }
    let cn = c.n;
    if (ct && ct !== 'bool') cn = { k: 'paren', a: coerce(c.n, ct, 'bool') };
    return { n: { k: 'ternary', c: cn, a: an, b: bn }, t };
  }

  assign(n) {
    const l = this.visit(n.l);
    const r = this.visit(n.r);
    let rn = r.n;
    if (n.op === '=') {
      if (l.t) {
        if (r.t) rn = coerce(rn, r.t, l.t);
        else if (isIntLiteral(rn) && family(l.t) === 'float') rn = coerce(rn, 'int', l.t);
      }
    } else if (l.t && r.t) {
      const lf = family(l.t), rf = family(r.t);
      if (lf === 'float' && rf === 'int') rn = coerce(rn, r.t, makeType('float', vecSize(r.t)));
      if (vecSize(r.t) > vecSize(l.t) && vecSize(l.t) >= 1 && lf !== 'mat') rn = coerce(rn, makeType(lf, vecSize(r.t)), l.t);
      if (n.op === '*=' && lf === 'mat' && rf === 'mat') {
        return { n: { k: 'assign', op: '=', l: l.n, r: { k: 'call', name: 'matrixCompMult', args: [l.n, rn] } }, t: l.t };
      }
      if (n.op === '%=' && lf === 'float') {
        return { n: { k: 'assign', op: '=', l: l.n, r: { k: 'call', name: 'sgFmod', args: [l.n, rn] } }, t: l.t };
      }
    } else if (l.t && family(l.t) === 'float' && isIntLiteral(rn)) {
      rn = coerce(rn, 'int', 'float');
    }
    return { n: { k: 'assign', op: n.op, l: l.n, r: rn }, t: l.t };
  }
}

function coerceScalarLiteral(v, to) {
  if (isIntLiteral(v.n) && to === 'float') return { k: 'num', v: floatLiteral(v.n.v) };
  if (v.t === 'int' && to === 'float') return { k: 'call', name: 'float', args: [v.n] };
  if (v.t === 'uint' && to === 'float') return { k: 'call', name: 'float', args: [v.n] };
  if (v.t === 'bool' && to === 'float') return { k: 'call', name: 'float', args: [v.n] };
  if (v.t && family(v.t) === 'int' && vecSize(v.t) > 1 && to === 'float') return { k: 'call', name: `vec${vecSize(v.t)}`, args: [v.n] };
  return v.n;
}

/** Make genType arguments agree (HLSL promotes scalars / truncates vectors). Returns the result type. */
function normalizeGen(args, types, scalarOk) {
  // HLSL promotes every argument to the widest one; GLSL keeps a scalar only where an overload allows it.
  let size = 0;
  let fam = 'float';
  types.forEach((t) => { if (t) size = Math.max(size, vecSize(t)); });
  if (types.every((t) => t && family(t) === 'int')) fam = 'float';
  if (!size) {
    for (let i = 0; i < args.length; i++) if (isIntLiteral(args[i])) args[i] = coerce(args[i], 'int', 'float');
    return types.find(Boolean) || null;
  }
  const target = makeType(fam, size);
  for (let i = 0; i < args.length; i++) {
    const t = types[i] || (isIntLiteral(args[i]) ? 'int' : null);
    if (!t) continue;
    if (scalarOk.includes(i) && vecSize(t) === 1) { if (family(t) !== 'float') args[i] = coerce(args[i], t, 'float'); continue; }
    if (family(t) === 'bool') continue;
    args[i] = coerce(args[i], t, target);
  }
  return target;
}

function mulType(a, b) {
  if (!a || !b) return a && /^mat/.test(a) && vecSize(b) ? b : (b && /^mat/.test(b) && vecSize(a) ? a : (a || b));
  if (/^mat/.test(a) && /^mat/.test(b)) return a;
  if (/^mat/.test(a)) return b;   // mul(M, v) -> vector
  if (/^mat/.test(b)) return a;   // mul(v, M) -> vector
  return a;
}

module.exports = {
  TYPE_WORDS, QUALIFIERS, tokenize, parseExpression, Parser, print, Typer, coerce, family, vecSize, makeType,
  isIntLiteral, floatLiteral,
};
