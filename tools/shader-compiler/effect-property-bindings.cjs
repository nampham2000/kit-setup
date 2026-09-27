'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseUnityMeta } = require('../lib/unity-yaml.cjs');

// Declaration-only fallback for Creator's particle ABI. Other engine chunks
// require --chunk-root or a resolver; unresolved includes remain unverified.
const PARTICLE_COMMON = 'uniform Constants { vec4 mainTiling_Offset; vec4 frameTile_velLenScale; vec4 scale; vec4 nodeRotation; };';
const FALLBACK_CHUNKS = new Map([
  ['builtin/internal/particle-common', PARTICLE_COMMON],
  ['builtin/uniforms/cc-global', ''], ['builtin/uniforms/cc-local', ''],
  ['common/math/transform', ''], ['common/color/gamma', ''],
]);
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');

/** Parse the machine-generated CCEffect subset, including anchors and merges. */
function parseEffectHeader(yaml) {
  const lines = yaml.split(/\r?\n/);
  const anchors = new Map();
  const clean = lines.map(line => line.replace(/(:\s*)&[\w-]+\s*/, '$1'));
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)(?:-\s*)?[\w-]+:\s*&([\w-]+)\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length;
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].match(/^ */)[0].length > indent)) end++;
    const block = ['value: ' + match[3], ...clean.slice(i + 1, end).map(l => l.slice(indent))].join('\n');
    anchors.set(match[2], parseUnityMeta(block).value);
  }
  const nonempty = clean.filter(l => l.trim() && !l.trimStart().startsWith('#'));
  const indent = Math.min(...nonempty.map(l => l.match(/^ */)[0].length));
  const header = parseUnityMeta(clean.map(l => l.slice(indent)).join('\n'));
  const resolve = (value, visiting = new Set()) => {
    if (typeof value === 'string' && /^\*[\w-]+$/.test(value)) {
      const name = value.slice(1);
      if (!anchors.has(name) || visiting.has(name)) throw new Error('Unresolved or cyclic CCEffect anchor: ' + name);
      return resolve(anchors.get(name), new Set([...visiting, name]));
    }
    if (Array.isArray(value)) return value.map(v => resolve(v, visiting));
    if (!value || typeof value !== 'object') return value;
    const merge = value['<<'] ? resolve(value['<<'], visiting) : {};
    const result = Array.isArray(merge) ? Object.assign({}, ...merge.slice().reverse()) : { ...merge };
    for (const [key, child] of Object.entries(value)) if (key !== '<<') result[key] = resolve(child, visiting);
    return result;
  };
  return resolve(header);
}

function createEffectChunkResolver(programs, options = {}) {
  const resolved = new Map();
  return name => {
    if (programs.has(name)) return programs.get(name);
    if (resolved.has(name)) return resolved.get(name);
    let text = options.chunkResolver?.(name);
    if (text == null && options.chunkRoot) {
      const root = path.resolve(options.chunkRoot), file = path.resolve(root, name + '.chunk');
      if (file.startsWith(root + path.sep) && fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
    }
    if (text == null) text = FALLBACK_CHUNKS.get(name);
    resolved.set(name, text); return text;
  };
}
function checkEffectPropertyBindings(effectText, options = {}) {
  const errors = [], warnings = [], checked = [];
  const yaml = /CCEffect\s*%\{([\s\S]*?)\}%/.exec(effectText)?.[1];
  if (!yaml) return { errors, warnings, checked, complete: false };
  let header;
  try { header = parseEffectHeader(yaml); }
  catch (error) { return { errors, warnings: ['[PROPERTY_BINDINGS_UNVERIFIED] ' + error.message], checked, complete: false }; }
  if (!Array.isArray(header.techniques)) return { errors, warnings: ['[PROPERTY_BINDINGS_UNVERIFIED] Unsupported CCEffect techniques shape'], checked, complete: false };
  const programs = new Map([...effectText.matchAll(/CCProgram\s+([\w-]+)\s*%\{([\s\S]*?)\}%/g)].map(m => [m[1], m[2]]));
  const chunk = createEffectChunkResolver(programs, options);
  function collect(name, uniforms, unresolved, visited) {
    if (visited.has(name)) return;
    visited.add(name);
    const text = chunk(name);
    if (text == null) { unresolved.add(name); return; }
    const code = stripComments(text);
    for (const block of code.matchAll(/\buniform\s+\w+\s*\{([^}]*)\}/g)) {
      for (const member of block[1].matchAll(/\b(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*(?:\[[^\]]+\])?\s*;/g)) uniforms.set(member[2], member[1]);
    }
    for (const uniform of code.matchAll(/\buniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*(?:\[[^\]]+\])?\s*;/g)) uniforms.set(uniform[2], uniform[1]);
    for (const include of code.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)) collect(include[1], uniforms, unresolved, visited);
  }
  function stageBlocks(name, stage, visited = new Set()) {
    if(visited.has(name))return '';visited.add(name);
    const raw=chunk(name);if(raw==null)return '';
    return stripComments(raw).replace(/#\s*include\s*[<"]([^>"]+)[>"]/g,(_,include)=>stageBlocks(include,stage,visited));
  }
  function blockPrecisions(name,stage) {
    const defaults={float:stage==='vert'?'highp':null,int:stage==='vert'?'highp':'mediump'},blocks=new Map();
    const code=stageBlocks(name,stage);
    for(const token of code.matchAll(/\bprecision\s+(lowp|mediump|highp)\s+(float|int)\s*;|\buniform\s+(\w+)\s*\{([^}]*)\}/g)){
      if(token[1]){defaults[token[2]]=token[1];continue;}
      const members=new Map();
      for(const m of token[4].matchAll(/\b(?:(lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*(?:\[[^\]]+\])?\s*;/g)){
        const scalar=/^(?:float|vec[234]|mat[234](?:x[234])?)$/.test(m[2])?'float':/^(?:int|uint|[iu]vec[234])$/.test(m[2])?'int':null;
        if(scalar)members.set(m[3],m[1]||defaults[scalar]);
      }
      // Conditional duplicate block declarations need the actual preprocessor.
      blocks.set(token[3],blocks.has(token[3])?null:members);
    }
    return blocks;
  }
  let complete = true;
  for (const [ti, technique] of header.techniques.entries()) {
    const passes = technique.passes || [];
    for (const [pi, pass] of passes.entries()) {
      const uniforms = new Map(), unresolved = new Set();
      for (const stage of ['vert', 'frag']) if (pass[stage]) collect(String(pass[stage]).split(':')[0], uniforms, unresolved, new Set());
      const vertex=blockPrecisions(String(pass.vert||'').split(':')[0],'vert'),fragment=blockPrecisions(String(pass.frag||'').split(':')[0],'frag');
      for(const [block,members]of vertex){
        if(!fragment.has(block))continue;
        const other=fragment.get(block);
        if(!members||!other){warnings.push(`[STAGE_PRECISION_UNVERIFIED] technique ${ti} pass ${pi}: conditional duplicate block '${block}' requires live variant compilation.`);complete=false;continue;}
        for(const [member,precision]of members){
          if(!other.has(member))continue;
          const second=other.get(member);
          if(!precision||!second){warnings.push(`[STAGE_PRECISION_UNVERIFIED] technique ${ti} pass ${pi}: '${block}.${member}' needs explicit precision or a default float precision.`);complete=false;}
          else if(precision!==second)errors.push(`[EFFECT_STAGE_PRECISION_MISMATCH] technique ${ti} pass ${pi}: '${block}.${member}' is ${precision} in vertex and ${second} in fragment. WebGL cannot link this uniform block; declare matching member precision in both stages.`);
        }
      }
      // propertyIndex is local to the technique, never to the whole effect.
      const owner = pass.propertyIndex == null ? pass : passes[Number(pass.propertyIndex)];
      if (pass.propertyIndex != null && (!Number.isInteger(Number(pass.propertyIndex)) || !owner)) {
        errors.push(`[EFFECT_PROPERTY_INDEX_INVALID] technique ${ti} pass ${pi}: propertyIndex '${pass.propertyIndex}' does not identify a pass in this technique.`);
        continue;
      }
      const properties = owner?.properties || {};
      if (typeof properties !== 'object' || Array.isArray(properties)) {
        warnings.push(`[PROPERTY_BINDINGS_UNVERIFIED] technique ${ti} pass ${pi}: unsupported properties`); complete = false; continue;
      }
      for (const [name, property] of Object.entries(properties)) {
        const target = String(property?.target || name), base = target.split(/[.\[]/)[0];
        if (uniforms.has(base)) { checked.push({ technique: ti, pass: pi, property: name, target }); continue; }
        if (unresolved.size) {
          warnings.push(`[PROPERTY_BINDINGS_UNVERIFIED] technique ${ti} pass ${pi}: '${name}' targets '${target}', but includes are unresolved: ${[...unresolved].join(', ')}`); complete = false;
        } else errors.push(`[EFX3302_PROPERTY_UNIFORM_MISSING] technique ${ti} pass ${pi}: property '${name}' targets '${target}' with no matching uniform in its selected vertex/fragment programs. Remove the orphan property or declare the intended uniform; a uniform in another pass does not bind this pass.`);
      }
    }
  }
  return { errors, warnings, checked, complete };
}
function assertEffectPropertyBindings(text, options = {}) {
  const result = checkEffectPropertyBindings(text, options);
  if (result.errors.length) throw Object.assign(new Error(result.errors.join('\n')), { code: /^\[([^\]]+)\]/.exec(result.errors[0])?.[1]||'EFFECT_BINDING_INVALID' });
  return result;
}
module.exports = { checkEffectPropertyBindings, parseEffectHeader, createEffectChunkResolver, assertEffectPropertyBindings };
