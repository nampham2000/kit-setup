#!/usr/bin/env node
'use strict';
/**
 * Offline Cocos effect compile gate.
 *
 *   1. Expands every .effect with the installed Cocos Creator effect compiler (shdc-lib from app.asar, engine
 *      chunks, macro tagging, GLSL 300 -> 100 lowering) - the exact importer front half. Its EFX1xxx/2xxx
 *      errors (unresolved include, #elif rules, reserved words, glsl1 parser...) fail the gate.
 *   2. Compiles every vert/frag program with a real GLSL ES compiler (ANGLE in headless Chrome/Edge):
 *        glsl1 in a WebGL1 context  -> the editor's EFX2406/EFX2407 check, same source and macro values;
 *        glsl3 in a WebGL2 context  -> what the playable meets in a WebGL2 browser.
 *      Permutations: `editor` (the importer's macro values), `off` (every boolean macro 0) and, in `full`
 *      mode, each effect-owned boolean macro on by itself (with the macros it depends on).
 *
 * Fails closed: a missing editor, browser or WebGL context is a failure, never a pass.
 *
 * Usage:
 *   node effect-compile-gate.cjs [--project <CocosProjectRoot>] [files-or-dirs...] [--mode editor|basic|full]
 *                                [--json] [--max-diagnostics <n>] [--no-cache]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEffectCompiler, cacheRoot } = require('./cocos-effect-compiler-host.cjs');
const { startWebglCompiler, parseInfoLog } = require('./webgl-glsl-compiler.cjs');

const GATE_VERSION = 1;
const MAX_PERMUTATIONS = 24;

function macroValue(define, mode) {
  switch (define.type) {
    case 'string': return define.options ? define.options[0] : '';
    case 'number': return define.range ? define.range[0] : 0;
    case 'constant': return define.default;
    case 'boolean':
      if (mode === 'editor') return define.default === undefined ? 1 : define.default;
      return 0;
    default: return 1;
  }
}

function defineHeader(values) {
  return Object.entries(values).map(([name, value]) => `#define ${name} ${value}\n`).join('');
}

/** Macro values the editor type check used (shader defines + device constants such as CC_DEVICE_SUPPORT_FLOAT_TEXTURE). */
function editorMacroValues(shader) {
  const values = {};
  const check = shader.editorTypeCheck;
  if (check) {
    for (const line of check.vert.split('\n').slice(1)) {
      const m = /^#define\s+(\w+)\s+(.*)$/.exec(line);
      if (!m) break;
      values[m[1]] = m[2];
    }
  } else {
    for (const d of shader.defines || []) values[d.name] = macroValue(d, 'editor');
  }
  return values;
}

function permutationsFor(shader, mode, ownedMacros) {
  const defines = shader.defines || [];
  const perms = [];
  const editor = editorMacroValues(shader);
  perms.push({ name: 'editor', values: editor });
  if (mode === 'editor') return perms;
  const off = { ...editor };
  for (const d of defines) off[d.name] = macroValue(d, 'off');
  perms.push({ name: 'off', values: off });
  if (mode !== 'full') return perms;
  const byName = new Map(defines.map((d) => [d.name, d]));
  for (const d of defines) {
    if (perms.length >= MAX_PERMUTATIONS) break;
    if (d.type !== 'boolean' || !ownedMacros.has(d.name)) continue;
    const values = { ...off, [d.name]: 1 };
    for (const dep of d.defines || []) {
      const name = String(dep).replace(/^!/, '');
      if (byName.has(name) && byName.get(name).type === 'boolean') values[name] = String(dep).startsWith('!') ? 0 : 1;
    }
    perms.push({ name: `only:${d.name}`, values });
  }
  return perms;
}

function ownedMacroNames(content) {
  const owned = new Set();
  for (const m of content.matchAll(/#\s*(?:if|ifdef|ifndef|elif)\b([^\n]*)/g)) {
    for (const id of m[1].matchAll(/\b([A-Z_][A-Z0-9_]*)\b/g)) if (!/^CC_|^defined$/.test(id[1])) owned.add(id[1]);
  }
  return owned;
}

function lineIndex(text) {
  const map = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    const key = line.trim();
    if (key.length > 6 && !map.has(key)) map.set(key, i + 1);
  });
  return map;
}

function sourceHash(parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(String(p)).update('\0');
  return h.digest('hex');
}

function resultCacheDir() {
  return path.join(path.dirname(cacheRoot()), 'effect-gate-results');
}

function readCachedResult(key) {
  try { return JSON.parse(fs.readFileSync(path.join(resultCacheDir(), `${key}.json`), 'utf8')); } catch (_) { return null; }
}

function writeCachedResult(key, value) {
  try {
    fs.mkdirSync(resultCacheDir(), { recursive: true });
    const file = path.join(resultCacheDir(), `${key}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch (_) { /* cache is an optimisation */ }
}

function stripExtension(file) {
  return path.basename(file).replace(/\.effect$/i, '');
}

/**
 * Check effects. items: [{ file?, name?, content, effectDir?, assetsRoot? }]
 * Returns { ok, compiler, browser, effects: [{ file, name, ok, diagnostics[] }], unavailable? }.
 */
async function checkEffects(items, options = {}) {
  const mode = options.mode || 'basic';
  const maxDiagnostics = options.maxDiagnostics || 40;
  let host;
  try {
    host = loadEffectCompiler({ projectRoot: options.projectRoot, engineRoot: options.engineRoot, env: options.env });
  } catch (error) {
    return { ok: false, unavailable: `effect compiler unavailable: ${error.message}`, effects: [] };
  }
  const prepared = [];
  for (const item of items) {
    const content = item.content != null ? String(item.content) : fs.readFileSync(item.file, 'utf8');
    const name = item.name || stripExtension(item.file || 'effect.effect');
    const effectDir = item.effectDir || (item.file ? path.dirname(path.resolve(item.file)) : null);
    const built = host.build(name, content, { effectDir, assetsRoot: item.assetsRoot || options.assetsRoot || null });
    const chunkText = built.resolvedChunks.map((f) => `${f}\n${fs.readFileSync(f, 'utf8')}`).join('\n');
    const key = sourceHash([GATE_VERSION, path.basename(host.cacheDir), mode, name, content, chunkText]);
    prepared.push({ item, name, content, built, key, file: item.file || null });
  }

  const effects = [];
  const pendingJobs = [];
  const jobMeta = new Map();
  for (const p of prepared) {
    const diagnostics = [];
    for (const message of p.built.errors) {
      diagnostics.push({ severity: 'error', code: (/EFX\d{4}/.exec(message) || ['EFX'])[0], phase: 'expand', message: message.split('↓↓↓↓↓')[0].trim() });
    }
    for (const message of p.built.warnings) {
      diagnostics.push({ severity: 'warning', code: (/EFX\d{4}/.exec(message) || ['EFX'])[0], phase: 'expand', message: message.split('↓↓↓↓↓')[0].trim() });
    }
    const record = { file: p.file, name: p.name, ok: true, diagnostics, cached: false, programs: 0, compiles: 0 };
    effects.push(record);
    if (!p.built.effect) { record.ok = false; continue; }
    const cached = options.noCache ? null : readCachedResult(p.key);
    if (cached && Array.isArray(cached.diagnostics)) {
      record.diagnostics = diagnostics.concat(cached.diagnostics);
      record.programs = cached.programs;
      record.compiles = cached.compiles;
      record.cached = true;
      continue;
    }
    record.compileDiagnostics = [];
    record.cacheKey = p.key;
    const owned = ownedMacroNames(p.content);
    const lines = lineIndex(p.content);
    for (const shader of p.built.effect.shaders) {
      record.programs += 1;
      for (const perm of permutationsFor(shader, mode, owned)) {
        const header = defineHeader(perm.values);
        for (const [api, version, glsl] of [['webgl', '#version 100\n', shader.glsl1], ['webgl2', '#version 300 es\n', shader.glsl3]]) {
          if (!glsl || !glsl.vert || !glsl.frag) continue;
          const id = pendingJobs.length + 1;
          const prefix = version + header;
          const exact = api === 'webgl' && perm.name === 'editor' && shader.editorTypeCheck;
          // The editor links its all-macros-on permutation in WebGL1 (EFX2407); in WebGL2 that permutation can
          // exceed MAX_VERTEX_ATTRIBS with every engine feature on at once, which no runtime pass does.
          const link = api === 'webgl' || perm.name !== 'editor';
          const job = exact
            ? { id, api, vert: shader.editorTypeCheck.vert, frag: shader.editorTypeCheck.frag, link }
            : { id, api, vert: prefix + glsl.vert, frag: prefix + glsl.frag, link };
          pendingJobs.push(job);
          jobMeta.set(id, { record, program: shader.name, permutation: perm.name, api, lines,
            sources: { vert: job.vert.split('\n'), frag: job.frag.split('\n') } });
          record.compiles += 1;
        }
      }
    }
  }

  let compiler = null;
  let browserInfo = null;
  if (pendingJobs.length) {
    try {
      compiler = await startWebglCompiler({ browser: options.browser, env: options.env });
      browserInfo = { browser: compiler.browser, ...compiler.info };
      const results = await compiler.compile(pendingJobs);
      const seen = new Map();
      for (const res of results) {
        const meta = jobMeta.get(res.id);
        const { record } = meta;
        if (res.unavailable) { record.compileDiagnostics.push({ severity: 'error', code: 'GATE', phase: 'compile', api: meta.api, message: res.log }); continue; }
        const stages = [['vert', res.vert], ['frag', res.frag]];
        for (const [stage, out] of stages) {
          if (!out || out.ok && !out.log) continue;
          for (const d of parseInfoLog(out.log)) {
            if (out.ok && d.severity !== 'error') continue;
            const src = meta.sources[stage];
            const srcLine = d.line > 0 ? src[d.line - 1] : undefined;
            const text = srcLine != null ? srcLine.trim() : '';
            const key = `${meta.api}|${meta.program}|${stage}|${d.message}|${text}`;
            if (!seen.has(record)) seen.set(record, new Map());
            const bucket = seen.get(record);
            if (bucket.has(key)) { bucket.get(key).permutations.push(meta.permutation); continue; }
            const diag = {
              severity: d.severity, code: meta.api === 'webgl' ? 'EFX2406' : 'GLSL300', phase: 'compile',
              api: meta.api, program: meta.program, stage, permutations: [meta.permutation],
              line: srcLine != null ? d.line : null,
              effectLine: text ? (meta.lines.get(text) || null) : null,
              source: text || null, message: d.message,
            };
            bucket.set(key, diag);
            record.compileDiagnostics.push(diag);
          }
        }
        if (res.vert && res.vert.ok && res.frag && res.frag.ok && res.link && !res.link.ok) {
          record.compileDiagnostics.push({ severity: 'error', code: meta.api === 'webgl' ? 'EFX2407' : 'GLSL300-LINK', phase: 'link',
            api: meta.api, program: meta.program, permutations: [meta.permutation], message: res.link.log.trim() });
        }
      }
    } catch (error) {
      return { ok: false, unavailable: `WebGL GLSL compiler unavailable: ${error.message}`, effects };
    } finally {
      if (compiler) await compiler.close();
    }
    for (const record of effects) {
      if (!record.compileDiagnostics) continue;
      if (record.cacheKey && !record.compileDiagnostics.some((d) => d.code === 'GATE')) {
        writeCachedResult(record.cacheKey, { diagnostics: record.compileDiagnostics, programs: record.programs, compiles: record.compiles });
      }
      record.diagnostics = record.diagnostics.concat(record.compileDiagnostics);
      delete record.compileDiagnostics;
      delete record.cacheKey;
    }
  }
  for (const record of effects) {
    delete record.compileDiagnostics;
    delete record.cacheKey;
    record.errorCount = record.diagnostics.filter((d) => d.severity === 'error').length;
    record.ok = record.ok && record.errorCount === 0;
    if (record.diagnostics.length > maxDiagnostics) {
      record.truncated = record.diagnostics.length - maxDiagnostics;
      record.diagnostics = record.diagnostics.slice(0, maxDiagnostics);
    }
  }
  return {
    ok: effects.every((e) => e.ok),
    mode,
    compiler: { creator: host.creator.version, engineRoot: host.creator.engineRoot },
    browser: browserInfo,
    effects,
  };
}

/** Convenience: check one in-memory effect (used by generators before writing). */
async function checkEffectSource(content, options = {}) {
  const result = await checkEffects([{ content, name: options.name || 'generated', effectDir: options.effectDir || null,
    assetsRoot: options.assetsRoot || null }], options);
  const effect = result.effects[0] || { ok: false, diagnostics: [] };
  return { ok: result.ok && effect.ok, unavailable: result.unavailable || null, diagnostics: effect.diagnostics, result };
}

function findEffects(target) {
  const out = [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return /\.effect$/i.test(target) ? [path.resolve(target)] : [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(full);
      else if (e.isFile() && /\.effect$/i.test(e.name)) out.push(path.resolve(full));
    }
  })(target);
  return out.sort();
}

function formatDiagnostic(file, d) {
  const where = d.effectLine ? `${file}:${d.effectLine}` : file;
  const scope = d.phase === 'expand' ? 'expand' : `${d.api}/${d.stage || 'link'}${d.program ? ` ${d.program}` : ''} [${(d.permutations || []).slice(0, 3).join(',')}]`;
  const glslLine = d.line ? ` (glsl line ${d.line})` : '';
  return `${where}: ${d.severity} ${d.code} ${scope}${glslLine}: ${d.message}${d.source ? `\n    > ${d.source}` : ''}`;
}

function parseArgs(argv) {
  const options = { targets: [], mode: 'basic', json: false, maxDiagnostics: 40, noCache: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') options.projectRoot = path.resolve(argv[++i]);
    else if (a === '--mode') options.mode = argv[++i];
    else if (a === '--json') options.json = true;
    else if (a === '--no-cache') options.noCache = true;
    else if (a === '--max-diagnostics') options.maxDiagnostics = Number(argv[++i]);
    else if (a === '--engine-root') options.engineRoot = argv[++i];
    else if (a === '--browser') options.browser = argv[++i];
    else if (a === '--help' || a === '-h') options.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else options.targets.push(a);
  }
  if (!['editor', 'basic', 'full'].includes(options.mode)) throw new Error(`--mode must be editor|basic|full`);
  if (!Number.isInteger(options.maxDiagnostics) || options.maxDiagnostics < 1) throw new Error('--max-diagnostics must be a positive integer');
  return options;
}

const USAGE = `Cocos effect compile gate (Creator effect compiler + real GLSL ES 1.00/3.00 compile via WebGL)

Usage:
  node effect-compile-gate.cjs [--project <CocosProjectRoot>] [files-or-dirs...]
       [--mode editor|basic|full] [--json] [--max-diagnostics <n>] [--no-cache] [--engine-root <dir>] [--browser <exe>]

With no files, scans <project>/assets for *.effect. Exit 0 = every effect compiles; 1 = failures; 2 = gate unavailable.`;

async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(error.message); console.error(USAGE); return 2; }
  if (options.help) { console.log(USAGE); return 0; }
  const projectRoot = options.projectRoot || process.cwd();
  const assetsRoot = path.join(projectRoot, 'assets');
  const targets = options.targets.length ? options.targets.map((t) => path.resolve(t)) : [assetsRoot];
  const files = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) { console.error(`not found: ${t}`); return 2; }
    files.push(...findEffects(t));
  }
  const result = files.length
    ? await checkEffects(files.map((file) => ({ file, assetsRoot })), { ...options, projectRoot, assetsRoot })
    : { ok: true, effects: [], mode: options.mode };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.unavailable) console.error(`FAIL (gate unavailable): ${result.unavailable}`);
    for (const e of result.effects) {
      const rel = e.file ? path.relative(projectRoot, e.file).replace(/\\/g, '/') : e.name;
      if (e.ok) continue;
      console.log(`FAIL ${rel} (${e.errorCount} error${e.errorCount === 1 ? '' : 's'})`);
      for (const d of e.diagnostics) if (d.severity === 'error') console.log(`  ${formatDiagnostic(rel, d)}`);
      if (e.truncated) console.log(`  ... ${e.truncated} more`);
    }
    const failed = result.effects.filter((e) => !e.ok).length;
    console.log(`effect compile gate (${result.mode}): ${result.effects.length - failed}/${result.effects.length} effects pass`
      + (result.browser ? ` [${result.browser.webgl ? result.browser.webgl.version : 'no webgl1'}; ${result.browser.webgl2 ? result.browser.webgl2.version : 'no webgl2'}]` : ''));
  }
  if (result.unavailable) return 2;
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(error && error.stack || error); process.exitCode = 2; });
}

module.exports = { checkEffects, checkEffectSource, findEffects, formatDiagnostic, permutationsFor, main, GATE_VERSION };
