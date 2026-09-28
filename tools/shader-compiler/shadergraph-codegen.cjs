#!/usr/bin/env node
'use strict';
/**
 * Unity ShaderGraph (Unity-generated shader code) -> Cocos Creator 3.8 effects.
 *
 * Input: the text Unity compiles for each graph (ShaderGraphImporter.GetShaderText), dumped read-only with
 *   npm run unity:script -- --project <Unity> --script playable-shared-kit/tools/unity-intel/dump-shadergraph-code.cs
 *     --set OUTPUT_DIR=<dir> --set SEARCH_FOLDERS=Assets/...
 * Output: one self-contained .effect per supported graph. Every effect passes the offline compile gate (editor
 * effect compiler + real GLSL ES 1.00/3.00 compile) BEFORE it is written; a failing effect is reported high and
 * never written. Graphs that are not renderer materials or use unsupported targets get an explicit disposition.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generateEffect } = require('./shadergraph/sg-emit.cjs');
const { checkEffects, assetsRootFor, formatDiagnostic } = require('./effect-compile-gate.cjs');

const USAGE = `Unity ShaderGraph generated code -> Cocos effects (gated by the effect compile gate)

Usage:
  node shadergraph-codegen.cjs --src <file.shader.txt|dir> --out <assets/effects/dir>
       [--prefix sg-] [--unity-project <UnityProjectRoot>] [--color-space gamma|linear] [--vertex-color srgb|linear]
       [--linear-textures a,b] [--srgb-textures a,b] [--latlong-cubes a,b|all] [--overrides <functions.glsl>]
       [--skip "<GraphName>=<reason>"]... [--no-normals] [--report <file.json>] [--json] [--dry-run] [--check]

  --src            Dumped generated code (tools/unity-intel/dump-shadergraph-code.cs) file or directory.
  --out            Cocos effect output directory (inside the project assets/).
  --unity-project  Resolves Custom Function file includes ("Assets/...hlsl").
  --color-space    gamma (default): decode sRGB colour textures + vertex colour, compute linear, re-encode output.
                   linear: pass-through for projects with their own linear pipeline (2D and 3D targets alike).
  --vertex-color   srgb: decode a_color (Unity linear-space SpriteRenderer/Tilemap/SpriteShape colours arrive gamma).
                   linear: use a_color as-is. Default: srgb with --color-space gamma, linear with --color-space linear.
  --latlong-cubes  Cube maps Unity imported from an equirect image: sample the 2D image by direction instead.
  --overrides      GLSL file whose functions replace graph/custom functions of the same name (project hooks).
  --skip           Explicit disposition for a graph the playable does not render (repeatable).
  --check          Read-only: exit 1 when an output is missing or differs from what would be generated.
  --dry-run        Generate + gate in memory, write nothing.

Exit 0 = every graph generated and passed the gate, or has an explicit non-failing disposition.`;

function parseArgs(argv) {
  const o = { src: null, out: null, prefix: 'sg-', colorSpace: 'gamma', linearTextures: [], srgbTextures: [], skips: new Map(), normals: true, json: false, dryRun: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--src') o.src = next();
    else if (a === '--out') o.out = next();
    else if (a === '--prefix') o.prefix = next();
    else if (a === '--unity-project') o.unityProject = next();
    else if (a === '--color-space') o.colorSpace = next();
    else if (a === '--vertex-color') o.vertexColor = next();
    else if (a === '--linear-textures') o.linearTextures = next().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--srgb-textures') o.srgbTextures = next().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--latlong-cubes') { const v = next(); o.latlongCubes = v === 'all' ? 'all' : v.split(',').map((x) => x.trim()).filter(Boolean); }
    else if (a === '--overrides') o.overrides = next();
    else if (a === '--skip') { const v = next(); const k = v.indexOf('='); if (k <= 0) throw new Error('--skip needs <GraphName>=<reason>'); o.skips.set(v.slice(0, k).trim(), v.slice(k + 1).trim()); }
    else if (a === '--no-normals') o.normals = false;
    else if (a === '--report') o.report = next();
    else if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--check') o.check = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (o.help) return o;
  if (!o.src || !o.out) throw new Error('--src and --out are required');
  if (!['gamma', 'linear'].includes(o.colorSpace)) throw new Error('--color-space must be gamma|linear');
  if (o.vertexColor !== undefined && !['srgb', 'linear'].includes(o.vertexColor)) throw new Error('--vertex-color must be srgb|linear');
  if (o.check && o.dryRun) throw new Error('--check and --dry-run are exclusive');
  return o;
}

const slug = (name) => name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function listSources(src) {
  const st = fs.statSync(src);
  if (st.isFile()) return [path.resolve(src)];
  return fs.readdirSync(src).filter((f) => /\.shader(\.txt)?$/i.test(f)).sort().map((f) => path.resolve(src, f));
}

function overrideNames(glsl) {
  return [...String(glsl).matchAll(/^[ \t]*(?:void|float|vec[234]|mat[234]|int|bool)\s+(\w+)\s*\(/gm)].map((m) => m[1]);
}

/** Generate + gate. Returns { results, gate } without writing. */
async function run(input) {
  const options = { prefix: 'sg-', colorSpace: 'gamma', linearTextures: [], srgbTextures: [], skips: new Map(), normals: true, ...input };
  if (!(options.skips instanceof Map)) options.skips = new Map(Object.entries(options.skips));
  // options.sources: [{ name, text }] (in-memory corpus) instead of --src files
  const sources = options.sources || listSources(options.src).map((file) => ({ file, name: path.basename(file).replace(/\.shader(\.txt)?$/i, '') }));
  const overridesText = options.overrides ? fs.readFileSync(options.overrides, 'utf8') : '';
  const overrides = overridesText ? { functions: overridesText, names: [...new Set(overrideNames(overridesText))] } : null;
  const unityRoot = options.unityProject ? path.resolve(options.unityProject) : null;
  const resolveInclude = (inc) => {
    if (!unityRoot) return null;
    const file = path.resolve(unityRoot, inc);
    if (!file.startsWith(unityRoot + path.sep) || !fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
  };
  const outDir = path.resolve(options.out);
  const results = [];
  for (const entry of sources) {
    const file = entry.file || entry.name;
    const base = entry.name;
    if (options.skips.has(base)) {
      results.push({ name: base, source: file, disposition: 'skipped', reason: options.skips.get(base), diagnostics: [] });
      continue;
    }
    let r;
    try {
      r = generateEffect(entry.text != null ? entry.text : fs.readFileSync(entry.file, 'utf8'), {
        name: base, colorSpace: options.colorSpace, vertexColor: options.vertexColor, linearTextures: options.linearTextures, srgbTextures: options.srgbTextures, latlongCubes: options.latlongCubes,
        resolveInclude, overrides, normalsTechnique: options.normals,
      });
    } catch (error) {
      r = { name: base, disposition: 'failed', diagnostics: [{ severity: 'high', code: 'SG_GENERATOR_ERROR', message: error.stack || error.message }] };
    }
    r.source = file;
    if (r.effect) r.output = path.join(outDir, `${options.prefix}${slug(base)}.effect`);
    results.push(r);
  }
  const generated = results.filter((r) => r.effect);
  let gate = { ok: true, effects: [] };
  if (generated.length) {
    const assetsRoot = assetsRootFor(path.join(outDir, 'x.effect'));
    gate = await checkEffects(generated.map((r) => ({ content: r.effect, name: path.basename(r.output, '.effect'), effectDir: outDir, assetsRoot })),
      { mode: 'basic', assetsRoot });
    if (gate.unavailable) {
      for (const r of generated) { r.disposition = 'failed-gate'; r.diagnostics.push({ severity: 'high', code: 'EFFECT_COMPILE_GATE_UNAVAILABLE', message: gate.unavailable }); }
    } else {
      generated.forEach((r, i) => {
        const e = gate.effects[i];
        r.gate = { ok: e.ok, errors: e.errorCount, compiles: e.compiles };
        if (!e.ok) {
          r.disposition = 'failed-gate';
          for (const d of e.diagnostics.filter((x) => x.severity === 'error').slice(0, 12)) {
            r.diagnostics.push({ severity: 'high', code: d.code, message: formatDiagnostic(path.basename(r.output), d) });
          }
        }
      });
    }
  }
  return { results, gate: { browser: gate.browser || null, compiler: gate.compiler || null, unavailable: gate.unavailable || null } };
}

function writeAtomic(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmp, file);
  return true;
}

const FAILING = new Set(['failed', 'failed-gate', 'unsupported-target', 'unsupported-pipeline', 'dump-error']);

async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(`${error.message}\n\n${USAGE}`); return 2; }
  if (options.help) { console.log(USAGE); return 0; }
  const { results, gate } = await run(options);
  let stale = 0;
  for (const r of results) {
    if (!r.effect || r.disposition !== 'generated') continue;
    if (options.check) {
      const current = fs.existsSync(r.output) ? fs.readFileSync(r.output, 'utf8') : null;
      r.upToDate = current === r.effect;
      if (!r.upToDate) stale++;
    } else if (!options.dryRun) {
      r.written = writeAtomic(r.output, r.effect);
    }
  }
  const summary = {
    total: results.length,
    generated: results.filter((r) => r.disposition === 'generated').length,
    skipped: results.filter((r) => r.disposition === 'skipped').length,
    notRenderer: results.filter((r) => r.disposition === 'not-renderer-material').length,
    failing: results.filter((r) => FAILING.has(r.disposition)).length,
    stale,
  };
  const report = {
    tool: 'shadergraph-codegen', options: { colorSpace: options.colorSpace, vertexColor: options.vertexColor || null, prefix: options.prefix, check: options.check, dryRun: options.dryRun },
    gate, summary,
    graphs: results.map((r) => ({
      name: r.name, source: path.basename(r.source || ''), disposition: r.disposition, reason: r.reason || undefined,
      target: r.target || undefined, targetId: r.targetId || undefined, output: r.output ? path.basename(r.output) : undefined,
      written: r.written, upToDate: r.upToDate, gate: r.gate, properties: r.properties, textures: r.textures, diagnostics: r.diagnostics,
    })),
  };
  if (options.report && !options.check) {
    fs.mkdirSync(path.dirname(path.resolve(options.report)), { recursive: true });
    writeAtomic(path.resolve(options.report), `${JSON.stringify(report, null, 1)}\n`);
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const r of results) {
      const high = (r.diagnostics || []).filter((d) => d.severity === 'high');
      const tag = r.disposition === 'generated' ? (options.check ? (r.upToDate ? 'OK  ' : 'STALE') : 'GEN ') : r.disposition.toUpperCase();
      console.log(`${tag} ${r.name}${r.output ? ` -> ${path.basename(r.output)}` : ''}${r.reason ? ` (${r.reason})` : ''}${r.target ? ` [${r.target}]` : ''}`);
      for (const d of high.slice(0, 6)) console.log(`     high ${d.code}: ${d.message.split('\n').join('\n          ')}`);
    }
    console.log(`\n${summary.generated}/${summary.total} generated and gated (${gate.browser && gate.browser.webgl ? 'GLSL ES 1.00 + 3.00' : 'gate'}), ${summary.skipped} skipped, ${summary.notRenderer} not renderer materials, ${summary.failing} failing${options.check ? `, ${stale} stale` : ''}`);
  }
  return summary.failing || stale ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(error && error.stack || error); process.exitCode = 2; });
}

module.exports = { run, main, parseArgs, slug };
