'use strict';
/**
 * Program-level typed pass: splits GLSL-ish code into top-level items (preprocessor lines, structs, functions,
 * global declarations), records struct layouts and function signatures, and rewrites every function body
 * statement by statement through the expression Typer (sg-glsl-types.cjs) with the right expected type
 * (declaration type, assignment target, function return type, bool conditions).
 */
const { tokenize, Parser, print, Typer, coerce, TYPE_WORDS, isIntLiteral } = require('./sg-glsl-types.cjs');

const PARAM_QUALS = new Set(['in', 'out', 'inout']);
const PRECISION = new Set(['highp', 'mediump', 'lowp']);
const GLOBAL_QUALS = new Set(['const', 'uniform', 'in', 'out', 'varying', 'attribute', 'flat', 'centroid', 'static', 'inline', 'layout']);
const STATEMENT_KEYWORDS = new Set(['return', 'discard', 'break', 'continue', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'struct', 'precision']);
const ATTRIBUTES = new Set(['unroll', 'loop', 'branch', 'flatten', 'fastopt', 'call', 'forcecase']);

function matchClose(tokens, i, open, close) {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j].k === 'op' && tokens[j].v === open) depth++;
    else if (tokens[j].k === 'op' && tokens[j].v === close) { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function textOf(tokens) {
  // re-join tokens with minimal spacing (used for pass-through fragments)
  let s = '';
  let prev = null;
  for (const t of tokens) {
    if (t.k === 'pp') { s += `\n${t.v}\n`; prev = null; continue; }
    const needSpace = prev && ((prev.k !== 'op' && t.k !== 'op') || (prev.k === 'op' && /[=<>!&|+\-*/%^?:,]$/.test(prev.v) && t.v !== ';' && t.v !== ')' && t.v !== ']' && t.v !== ',')
      || (t.k === 'op' && /^[=<>!&|+\-*/%^?:]/.test(t.v) && prev.v !== '(' && prev.v !== '['));
    s += (needSpace ? ' ' : '') + t.v;
    prev = t;
  }
  return s;
}

/** Split `a, b, c` at top-level commas (token arrays). */
function splitTop(tokens, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = [];
  for (const t of tokens) {
    if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
    if (t.k === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) depth--;
    if (depth === 0 && t.k === 'op' && t.v === sep) { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length || parts.length) parts.push(cur);
  return parts;
}

class Program {
  constructor(options = {}) {
    this.structs = new Map(options.structs || []);
    this.functions = new Map();
    this.globals = new Map(options.globals || []);
    this.globalExprs = new Map(options.globalExprs || []);
    this.diagnostics = [];
    for (const f of options.externalFunctions || []) this.addFunction(f);
  }

  addFunction(sig) {
    if (!this.functions.has(sig.name)) this.functions.set(sig.name, []);
    const list = this.functions.get(sig.name);
    const key = sig.params.map((p) => p.type).join(',');
    if (!list.some((s) => s.params.map((p) => p.type).join(',') === key)) list.push(sig);
  }

  isType(name) { return TYPE_WORDS.has(name) || this.structs.has(name); }

  env(scopes) {
    return {
      lookupVar: (name) => {
        for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
        return this.globals.get(name) || null;
      },
      structField: (struct, field) => (this.structs.get(struct) || new Map()).get(field) || null,
      functions: (name) => this.functions.get(name) || null,
      isStruct: (name) => this.structs.has(name),
      globalExpr: (name) => {
        for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i] !== this.globals && scopes[i].has(name)) return null;
        return this.globalExprs.get(name) || null;
      },
    };
  }

  /** Parse signatures + struct layouts only (for shim libraries). */
  collect(code) {
    this.transform(code, { signaturesOnly: true });
  }

  /** Full typed rewrite. Returns rewritten code. */
  transform(code, options = {}) {
    this.src = String(code);
    const tokens = tokenize(this.src);
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.k === 'pp') { out.push(t.v); i++; continue; }
      if (t.k === 'op' && t.v === ';') { i++; continue; }
      if (t.k === 'id' && t.v === 'struct') {
        const name = tokens[i + 1].v;
        const open = i + 2;
        const close = matchClose(tokens, open, '{', '}');
        const fields = new Map();
        const lines = [];
        for (const decl of splitTop(tokens.slice(open + 1, close), ';')) {
          const d = decl.filter((x) => !(x.k === 'id' && (PRECISION.has(x.v))));
          if (d.length < 2) continue;
          const type = d[0].v;
          for (const part of splitTop(d.slice(1))) {
            if (!part.length) continue;
            const fname = part[0].v;
            const arr = part.length > 1 && part[1].v === '[' ? textOf(part.slice(1)) : '';
            fields.set(fname, arr ? `${type}[${arr.replace(/[[\]]/g, '')}]` : type);
            lines.push(`  ${type} ${fname}${arr};`);
          }
        }
        this.structs.set(name, fields);
        if (!lines.length) lines.push('  float sgUnused;');
        out.push(`struct ${name} {\n${lines.join('\n')}\n};`);
        i = close + 1;
        if (tokens[i] && tokens[i].v === ';') i++;
        continue;
      }
      // function or global declaration
      let j = i;
      const quals = [];
      while (tokens[j] && tokens[j].k === 'id' && (PRECISION.has(tokens[j].v) || tokens[j].v === 'const' || tokens[j].v === 'uniform' || tokens[j].v === 'static' || tokens[j].v === 'inline')) quals.push(tokens[j++].v);
      const typeTok = tokens[j];
      const nameTok = tokens[j + 1];
      if (typeTok && nameTok && typeTok.k === 'id' && nameTok.k === 'id' && tokens[j + 2] && tokens[j + 2].v === '(') {
        const pOpen = j + 2;
        const pClose = matchClose(tokens, pOpen, '(', ')');
        const params = this.parseParams(tokens.slice(pOpen + 1, pClose));
        const sig = { name: nameTok.v, ret: typeTok.v, params };
        this.addFunction(sig);
        let after = pClose + 1;
        // HLSL output semantic on a helper signature: `float4 Frag(v2f i) : SV_Target {`
        if (tokens[after] && tokens[after].v === ':' && tokens[after + 1] && tokens[after + 1].k === 'id') after += 2;
        if (tokens[after] && tokens[after].v === '{') {
          const bClose = matchClose(tokens, after, '{', '}');
          if (!options.signaturesOnly) {
            const scope = new Map(params.map((p) => [p.name, p.type]));
            const before = this.diagnostics.length;
            const body = this.block(tokens.slice(after + 1, bClose), [scope], sig.ret, 1);
            for (let k = before; k < this.diagnostics.length; k++) if (!this.diagnostics[k].fn) this.diagnostics[k].fn = nameTok.v;
            const paramText = params.map((p) => `${p.qual && p.qual !== 'in' ? `${p.qual} ` : ''}${p.type} ${p.name}${p.array || ''}`).join(', ');
            out.push(`${quals.filter((q) => PRECISION.has(q)).map((q) => `${q} `).join('')}${typeTok.v} ${nameTok.v}(${paramText}) {\n${body.join('\n')}\n}`);
          }
          i = bClose + 1;
        } else {
          if (!options.signaturesOnly) out.push(this.raw(tokens, i, after));
          i = after + 1; // prototype
        }
        continue;
      }
      // global declaration statement (uniform blocks and anything unrecognised pass through verbatim)
      let end = i;
      let depth = 0;
      for (; end < tokens.length; end++) {
        const x = tokens[end];
        if (x.k === 'op' && (x.v === '{' || x.v === '(' || x.v === '[')) depth++;
        if (x.k === 'op' && (x.v === '}' || x.v === ')' || x.v === ']')) depth--;
        if (depth === 0 && x.k === 'op' && x.v === ';') break;
      }
      const stmt = tokens.slice(i, end);
      this.recordGlobal(stmt);
      if (!options.signaturesOnly) {
        const hasBlock = stmt.some((x) => x.k === 'op' && x.v === '{');
        const decl = hasBlock ? null : this.declaration(stmt.filter((x) => !(x.k === 'id' && (x.v === 'static' || x.v === 'inline'))), [this.globals], 0, true);
        out.push(...(decl || [this.raw(tokens, i, end)]));
      }
      i = end + 1;
    }
    return out.join('\n\n');
  }

  /** Original text of tokens[from..to] (inclusive), for constructs the typed pass leaves untouched. */
  raw(tokens, from, to) {
    const a = tokens[from];
    const b = tokens[Math.min(to, tokens.length - 1)];
    if (!a || !b || a.s == null || this.src == null) return textOf(tokens.slice(from, to + 1));
    return this.src.slice(a.s, b.e);
  }

  /** Remember types of global declarations: `[in|out|uniform|varying|attribute|flat|const|precision] T a, b;` and blocks. */
  recordGlobal(input) {
    let stmt = input;
    const layout = stmt.findIndex((x) => x.k === 'id' && x.v === 'layout');
    if (layout >= 0 && stmt[layout + 1] && stmt[layout + 1].v === '(') {
      const close = matchClose(stmt, layout + 1, '(', ')');
      stmt = [...stmt.slice(0, layout), ...stmt.slice(close + 1)];
    }
    const blockOpen = stmt.findIndex((x) => x.k === 'op' && x.v === '{');
    if (blockOpen >= 0) { // uniform Block { T a; T b; }
      const close = matchClose(stmt, blockOpen, '{', '}');
      for (const decl of splitTop(stmt.slice(blockOpen + 1, close), ';')) {
        const d = decl.filter((x) => !(x.k === 'id' && PRECISION.has(x.v)));
        if (d.length >= 2 && d[0].k === 'id' && d[1].k === 'id') this.globals.set(d[1].v, d[0].v);
      }
      return;
    }
    const d = stmt.filter((x) => !(x.k === 'id' && (PRECISION.has(x.v) || GLOBAL_QUALS.has(x.v))));
    if (d.length >= 2 && d[0].k === 'id' && d[1].k === 'id') {
      for (const part of splitTop(d.slice(1))) if (part[0] && part[0].k === 'id') this.globals.set(part[0].v, d[0].v);
    }
  }

  parseParams(tokens) {
    if (!tokens.length || (tokens.length === 1 && tokens[0].v === 'void')) return [];
    return splitTop(tokens).map((part) => {
      let qual = 'in';
      const words = part.filter((x) => !(x.k === 'id' && PRECISION.has(x.v)));
      let k = 0;
      while (words[k] && words[k].k === 'id' && (PARAM_QUALS.has(words[k].v) || words[k].v === 'const' || words[k].v === 'uniform')) {
        if (PARAM_QUALS.has(words[k].v)) qual = words[k].v;
        k++;
      }
      const type = words[k] ? words[k].v : 'float';
      const name = words[k + 1] ? words[k + 1].v : `p${k}`;
      const array = words[k + 2] && words[k + 2].v === '[' ? textOf(words.slice(k + 2)) : '';
      return { qual, type, name, array };
    });
  }

  typer() { return new Typer(this._env, this.diagnostics); }

  expr(tokens, scopes, expected) {
    this._env = this.env(scopes);
    let node;
    try {
      const parser = new Parser(tokens, (n) => this.isType(n));
      node = parser.expression(0);
      if (!parser.done()) throw new Error(`unexpected '${parser.peek().v}'`);
    } catch (error) {
      const original = tokens.length && tokens[0].s != null && this.src != null
        ? this.src.slice(tokens[0].s, tokens[tokens.length - 1].e) : textOf(tokens);
      this.diagnostics.push({ severity: 'high', code: 'SG_PARSE', message: `${error.message}: ${original.slice(0, 160)}` });
      return { text: original, t: null };
    }
    const typer = this.typer();
    const r = typer.visit(node);
    let n = r.n;
    if (expected) {
      if (r.t) n = coerce(n, r.t, expected);
      else if (isIntLiteral(n) && /^(float|vec[234])$/.test(expected)) n = coerce(n, 'int', expected);
    }
    return { text: print(n), t: r.t, node: n };
  }

  declaration(stmt, scopes, depth, global = false) {
    const words = stmt;
    let k = 0;
    const quals = [];
    while (words[k] && words[k].k === 'id' && (PRECISION.has(words[k].v) || words[k].v === 'const' || words[k].v === 'uniform')) quals.push(words[k++].v);
    if (!words[k] || words[k].k !== 'id' || !words[k + 1] || words[k + 1].k !== 'id') return null;
    // `Type name` where Type is not a known type is still a declaration (engine structs from chunks, e.g.
    // StandardVertInput); keywords never start one.
    if (!this.isType(words[k].v)) {
      const after = words[k + 2];
      if (STATEMENT_KEYWORDS.has(words[k].v) || (after && !(after.k === 'op' && ['=', ',', '['].includes(after.v)))) return null;
    }
    const type = words[k].v;
    const scope = scopes[scopes.length - 1];
    const lines = [];
    const pad = '  '.repeat(depth);
    for (const part of splitTop(words.slice(k + 1))) {
      const name = part[0].v;
      let rest = part.slice(1);
      let array = '';
      if (rest[0] && rest[0].v === '[') {
        const c = matchClose(rest, 0, '[', ']');
        array = textOf(rest.slice(0, c + 1));
        rest = rest.slice(c + 1);
      }
      scope.set(name, array ? `${type}${array.replace(/\s/g, '')}` : type);
      if (rest[0] && rest[0].v === '=') {
        const init = rest.slice(1);
        if (init[0] && init[0].v === '{') {
          this.diagnostics.push({ severity: 'high', code: 'SG_INITIALIZER_LIST', message: `HLSL initializer list for ${name} has no GLSL ES 1.00 form` });
        }
        const e = this.expr(init, scopes, array ? null : type);
        if (e.node && e.node.k === 'raw' && e.node.zeroStruct) {
          lines.push(`${pad}${quals.join(' ')}${quals.length ? ' ' : ''}${type} ${name}${array};`);
          const fields = this.structs.get(type);
          if (fields && !global) for (const [f, ft] of fields) {
            const zero = zeroValue(ft);
            if (zero) lines.push(`${pad}${name}.${f} = ${zero};`);
          }
        } else {
          lines.push(`${pad}${quals.join(' ')}${quals.length ? ' ' : ''}${type} ${name}${array} = ${e.text};`);
        }
      } else {
        lines.push(`${pad}${quals.join(' ')}${quals.length ? ' ' : ''}${type} ${name}${array};`);
      }
    }
    return lines;
  }

  /** Rewrite a statement list (tokens between braces). Returns lines. */
  block(tokens, scopes, retType, depth) {
    const lines = [];
    let i = 0;
    const pad = () => '  '.repeat(depth);
    const statement = () => {
      const t = tokens[i];
      if (!t) return;
      if (t.k === 'pp') { lines.push(t.v); i++; return; }
      if (t.k === 'op' && t.v === ';') { i++; return; }
      if (t.k === 'op' && t.v === '[' && tokens[i + 1] && tokens[i + 1].k === 'id' && ATTRIBUTES.has(tokens[i + 1].v)) {
        i = matchClose(tokens, i, '[', ']') + 1;
        return;
      }
      if (t.k === 'op' && t.v === '{') {
        const close = matchClose(tokens, i, '{', '}');
        lines.push(`${pad()}{`);
        lines.push(...this.block(tokens.slice(i + 1, close), [...scopes, new Map()], retType, depth + 1));
        lines.push(`${pad()}}`);
        i = close + 1;
        return;
      }
      if (t.k === 'id' && (t.v === 'if' || t.v === 'while')) {
        const close = matchClose(tokens, i + 1, '(', ')');
        const c = this.expr(tokens.slice(i + 2, close), scopes, 'bool');
        lines.push(`${pad()}${t.v} (${c.text})`);
        i = close + 1;
        sub();
        if (t.v === 'if' && tokens[i] && tokens[i].v === 'else') {
          lines.push(`${pad()}else`);
          i++;
          sub();
        }
        return;
      }
      if (t.k === 'id' && t.v === 'for') {
        const close = matchClose(tokens, i + 1, '(', ')');
        const parts = splitTop(tokens.slice(i + 2, close), ';');
        const inner = [...scopes, new Map()];
        let init = '';
        if (parts[0] && parts[0].length) {
          const d = this.declaration(parts[0], inner, 0);
          init = d ? d.map((x) => x.trim()).join(' ').replace(/;$/, '') : this.expr(parts[0], inner, null).text;
        }
        const cond = parts[1] && parts[1].length ? this.expr(parts[1], inner, 'bool').text : '';
        const step = parts[2] && parts[2].length ? splitTop(parts[2]).map((p) => this.expr(p, inner, null).text).join(', ') : '';
        lines.push(`${pad()}for (${init}; ${cond}; ${step})`);
        i = close + 1;
        const saved = scopes;
        scopes = inner;
        sub();
        scopes = saved;
        return;
      }
      if (t.k === 'id' && t.v === 'do') {
        lines.push(`${pad()}do`);
        i++;
        sub();
        const close = matchClose(tokens, i + 1, '(', ')');
        const c = this.expr(tokens.slice(i + 2, close), scopes, 'bool');
        lines.push(`${pad()}while (${c.text});`);
        i = close + 2;
        return;
      }
      // simple statement up to ';'
      let end = i;
      let d = 0;
      for (; end < tokens.length; end++) {
        const x = tokens[end];
        if (x.k === 'op' && (x.v === '(' || x.v === '[' || x.v === '{')) d++;
        if (x.k === 'op' && (x.v === ')' || x.v === ']' || x.v === '}')) d--;
        if (d === 0 && x.k === 'op' && x.v === ';') break;
      }
      const stmt = tokens.slice(i, end);
      i = end + 1;
      if (!stmt.length) return;
      const head = stmt[0].v;
      if (head === 'return') {
        if (stmt.length === 1) lines.push(`${pad()}return;`);
        else lines.push(`${pad()}return ${this.expr(stmt.slice(1), scopes, retType === 'void' ? null : retType).text};`);
        return;
      }
      if (head === 'break' || head === 'continue' || head === 'discard') { lines.push(`${pad()}${head};`); return; }
      if (head === 'ZERO_INITIALIZE') return;
      const decl = this.declaration(stmt, scopes, depth);
      if (decl) { lines.push(...decl); return; }
      for (const part of splitTop(stmt)) {
        const e = this.expr(part, scopes, null);
        const fix = e.node && e.node.k === 'call' ? e.node.outFix : null;
        if (!fix) { lines.push(`${pad()}${e.text};`); continue; }
        // out/inout arguments of a different type go through exact-type temporaries
        for (const f of fix) {
          lines.push(`${pad()}${f.paramType} ${f.temp}${f.inout ? ` = ${print(coerce(f.arg, f.argType, f.paramType))}` : ''};`);
        }
        lines.push(`${pad()}${e.text};`);
        for (const f of fix) lines.push(`${pad()}${print(f.arg)} = ${print(coerce({ k: 'id', v: f.temp }, f.paramType, f.argType))};`);
      }
    };
    const sub = () => {
      // single statement or block as the body of a control statement
      if (tokens[i] && tokens[i].v === '{') { statement(); return; }
      depth++;
      statement();
      depth--;
    };
    while (i < tokens.length) statement();
    return lines;
  }
}

function zeroValue(type) {
  if (type === 'float') return '0.0';
  if (type === 'int') return '0';
  if (type === 'bool') return 'false';
  if (/^vec[234]$/.test(type)) return `${type}(0.0)`;
  if (/^ivec[234]$/.test(type)) return `${type}(0)`;
  if (/^bvec[234]$/.test(type)) return `${type}(false)`;
  if (/^mat[234]$/.test(type)) return `${type}(0.0)`;
  return null;
}

/** Signatures of every function defined in `code` (name, ret, params). */
function functionSignatures(code) {
  const p = new Program();
  p.collect(code);
  const out = [];
  for (const list of p.functions.values()) out.push(...list);
  return { functions: out, structs: p.structs, globals: p.globals };
}

module.exports = { Program, functionSignatures, textOf, splitTop, matchClose };
