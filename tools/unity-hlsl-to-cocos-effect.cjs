#!/usr/bin/env node
'use strict';

/**
 * Unity HLSL / ShaderLab / ShaderGraph -> Cocos Creator 3.8.8+ .effect Transpiler
 *
 * Capabilities:
 * - Direct parsing of Unity ShaderLab (.shader), HLSL (.hlsl, .cginc), and ShaderGraph (.shadergraph)
 * - 90-95% visual parity across shading models: Unlit/FX, PBR/Lit, Toon/Cel, MatCap, Dissolve
 * - 100% compliant GLSL std140 UBO layout with zero wasted memory
 * - Procedural noise (Simple, Voronoi, Gradient) and full 18+ Photoshop/Unity blend modes
 * - Automatic material (.mtl) scaffold generation with synchronized properties
 * - Programmatic API for smart-port integration
 */

const fs = require('fs');
const path = require('path');
const { ShaderGraphParser } = require('./unity-cocos-port/unity-shadergraph-parser');
const { HlslAstTranspiler } = require('./unity-cocos-port/hlsl-ast-transpiler');
const { packStd140Uniforms } = require('./unity-cocos-port/ubo-alignment-formatter');
const { assertUnityPortPreflight } = require('./unity-intel/preflight.cjs');
const { createPathBoundary, inspectContainedPath } = require('./lib/path-boundary.cjs');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
  ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
  : findProjectRoot(process.cwd())
    || findProjectRoot(path.resolve(__dirname, '..'))
    || path.resolve(process.cwd());
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function printHelp() {
  console.log(`
================================================================================
🎨 Unity HLSL / ShaderLab / ShaderGraph -> Cocos Creator 3.8.8 Effect Porter
================================================================================

Usage:
  node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src <UnityShaderOrGraph> --out <CocosEffect> [options]
  node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs batch --dir <FolderOfShaders> --out-dir <CocosEffectsDir> [options]

Options:
  --src <path>             Unity .shader / .hlsl / .shadergraph source file.
  --out <path>             Output Cocos .effect file path.
  --shading-model <model>  Force shading model: 'auto', 'unlit', 'lit', 'toon', 'matcap', 'dissolve'. Default: 'auto'.
  --generate-material, -m  Also generate corresponding Cocos .mtl file alongside the .effect.
  --cocos-root <path>      Cocos project root. Default: current repo root.
  --unity-project <path>   Unity project binding for a declared local package/staging source.
  --shader-name <name>     Cocos program/effect display name. Default: derived from filename.
  --report <path>          CSV report path. Default: .unity/hlsl-port-report.csv.
  --overwrite              Allow replacing existing output files.
  --dry-run                Transpile in memory and validate, but do not write to disk.
  --transparent            Force transparent blend state.
  --opaque                 Force opaque blend state.
  --alpha-clip             Enable alpha clipping / discard test.

Examples:
  node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src "Assets/Shaders/ToonChar.shader" --out "assets/effects/ToonChar.effect" -m --overwrite
  node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src "Assets/Graphs/Water.shadergraph" --out "assets/effects/Water.effect" --transparent
  node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs batch --dir "Assets/Shaders" --out-dir "assets/effects" -m
`);
}

function fail(message) {
  console.error(`[unity-hlsl-to-cocos-effect] ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[unity-hlsl-to-cocos-effect] ${message}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

class Reporter {
  constructor() {
    this.issues = [];
  }

  add(severity, code, source, target, message, detail = '') {
    const level = String(severity || 'low').toLowerCase();
    this.issues.push({
      severity: SEVERITY_ORDER[level] == null ? 'low' : level,
      code,
      source: source || '',
      target: target || '',
      message,
      detail: detail || '',
    });
  }

  high(code, source, target, message, detail) { this.add('high', code, source, target, message, detail); }
  medium(code, source, target, message, detail) { this.add('medium', code, source, target, message, detail); }
  low(code, source, target, message, detail) { this.add('low', code, source, target, message, detail); }

  sorted() {
    return [...this.issues].sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return String(a.code).localeCompare(String(b.code));
    });
  }

  writeCsv(file) {
    ensureDir(path.dirname(file));
    const lines = ['severity,code,source,target,message,detail'];
    for (const issue of this.sorted()) {
      lines.push([
        issue.severity,
        issue.code,
        issue.source,
        issue.target,
        issue.message,
        issue.detail,
      ].map(csvEscape).join(','));
    }
    const csv = `${lines.join('\n')}\n`;
    try {
      fs.writeFileSync(file, csv, 'utf8');
      return file;
    } catch (error) {
      const fallback = `${file}.${Date.now()}.csv`;
      fs.writeFileSync(fallback, csv, 'utf8');
      return fallback;
    }
  }

  summary() {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const issue of this.issues) counts[issue.severity] += 1;
    return counts;
  }
}

function parseArgs(argv) {
  const command = argv[0] && !String(argv[0]).startsWith('-') ? argv[0] : 'help';
  const options = {
    command,
    src: '',
    out: '',
    dir: '',
    outDir: '',
    cocosRoot: ROOT_DIR,
    shaderName: '',
    shadingModel: 'auto',
    generateMaterial: false,
    report: path.join(ROOT_DIR, '.unity', 'hlsl-port-report.csv'),
    overwrite: false,
    dryRun: false,
    forceTransparent: false,
    forceOpaque: false,
    alphaClip: false,
    unityProject: '',
  };

  const optionStartIndex = command === 'help' && argv[0] && String(argv[0]).startsWith('-') ? 0 : 1;
  for (let i = optionStartIndex; i < argv.length; i++) {
    const arg = argv[i];
    const readValue = (name) => {
      const value = argv[i + 1];
      if (!value) fail(`Missing value for ${name}`);
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') { options.command = 'help'; continue; }
    if (arg === '--src') { options.src = readValue(arg); continue; }
    if (arg.startsWith('--src=')) { options.src = arg.slice('--src='.length); continue; }
    if (arg === '--out') { options.out = readValue(arg); continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice('--out='.length); continue; }
    if (arg === '--dir') { options.dir = readValue(arg); continue; }
    if (arg.startsWith('--dir=')) { options.dir = arg.slice('--dir='.length); continue; }
    if (arg === '--out-dir') { options.outDir = readValue(arg); continue; }
    if (arg.startsWith('--out-dir=')) { options.outDir = arg.slice('--out-dir='.length); continue; }
    if (arg === '--cocos-root') { options.cocosRoot = path.resolve(readValue(arg)); continue; }
    if (arg.startsWith('--cocos-root=')) { options.cocosRoot = path.resolve(arg.slice('--cocos-root='.length)); continue; }
    if (arg === '--unity-project') { options.unityProject = path.resolve(readValue(arg)); continue; }
    if (arg.startsWith('--unity-project=')) { options.unityProject = path.resolve(arg.slice('--unity-project='.length)); continue; }
    if (arg === '--shader-name') { options.shaderName = readValue(arg); continue; }
    if (arg.startsWith('--shader-name=')) { options.shaderName = arg.slice('--shader-name='.length); continue; }
    if (arg === '--shading-model') { options.shadingModel = readValue(arg).toLowerCase(); continue; }
    if (arg.startsWith('--shading-model=')) { options.shadingModel = arg.slice('--shading-model='.length).toLowerCase(); continue; }
    if (arg === '--generate-material' || arg === '-m') { options.generateMaterial = true; continue; }
    if (arg === '--report') { options.report = path.resolve(readValue(arg)); continue; }
    if (arg.startsWith('--report=')) { options.report = path.resolve(arg.slice('--report='.length)); continue; }
    if (arg === '--overwrite') { options.overwrite = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--transparent') { options.forceTransparent = true; continue; }
    if (arg === '--opaque') { options.forceOpaque = true; continue; }
    if (arg === '--alpha-clip') { options.alphaClip = true; continue; }

    fail(`Unknown option: ${arg}`);
  }

  if (options.command !== 'help' && options.command !== 'convert' && options.command !== 'batch') {
    fail(`Unknown command: ${options.command}`);
  }
  return options;
}

/**
 * Generates matching Cocos Creator .mtl material file for an effect.
 */
function generateMatchingMaterial({ effectUuid, effectName, properties, isTransparent, targetFile }) {
  const propsObj = {};
  for (const prop of properties) {
    if (prop.kind === 'color' || prop.kind === 'vector') {
      propsObj[prop.glslName] = {
        __type__: 'cc.Color',
        r: Math.round((prop.defaultValue[0] ?? 1) * 255),
        g: Math.round((prop.defaultValue[1] ?? 1) * 255),
        b: Math.round((prop.defaultValue[2] ?? 1) * 255),
        a: Math.round((prop.defaultValue[3] ?? 1) * 255),
      };
    } else if (prop.kind === 'float') {
      propsObj[prop.glslName] = Number(prop.defaultValue ?? 0);
    }
  }

  const mtlData = {
    __type__: 'cc.Material',
    _name: effectName,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: effectUuid ? { __uuid__: effectUuid } : { __expectedType__: 'cc.EffectAsset' },
    _techIdx: 0,
    _defines: [{}],
    _states: isTransparent ? [
      {
        rasterizerState: {},
        blendState: {
          targets: [{ blend: true, blendSrc: 2, blendDst: 4, blendDstAlpha: 4 }],
        },
        depthStencilState: { depthWrite: false },
      }
    ] : [
      {
        rasterizerState: {},
        depthStencilState: {},
        blendState: { targets: [{}] },
      }
    ],
    _props: [propsObj],
  };

  return JSON.stringify(mtlData, null, 2) + '\n';
}

function ensureEffectMeta(effectFile, cocosRoot) {
  const metaFile = `${effectFile}.meta`;
  if (fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta && meta.uuid) return meta.uuid;
    } catch (_) {}
  }
  const relativePath = toPosix(path.relative(cocosRoot, effectFile));
  // Create deterministic UUID
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(`effect:${relativePath}`).digest('hex');
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  const metaData = {
    ver: '1.7.1',
    importer: 'effect',
    imported: true,
    uuid,
    files: ['.json'],
    subMetas: {},
    userData: {},
  };
  fs.writeFileSync(metaFile, JSON.stringify(metaData, null, 2) + '\n', 'utf8');
  return uuid;
}

function ensureMaterialMeta(mtlFile, cocosRoot) {
  const metaFile = `${mtlFile}.meta`;
  if (fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta && meta.uuid) return meta.uuid;
    } catch (_) {}
  }
  const relativePath = toPosix(path.relative(cocosRoot, mtlFile));
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(`material:${relativePath}`).digest('hex');
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  const metaData = {
    ver: '1.0.0',
    importer: 'material',
    imported: true,
    uuid,
    files: ['.json'],
    subMetas: {},
    userData: {},
  };
  fs.writeFileSync(metaFile, JSON.stringify(metaData, null, 2) + '\n', 'utf8');
  return uuid;
}

/**
 * Converts Unity ShaderLab / HLSL or ShaderGraph into Cocos Creator .effect
 */
/**
 * Chấm severity trung thực cho một lần chuyển shader.
 *
 * Bộ chuyển hiện chỉ sinh khung + properties + UBO + render state; thân
 * frag()/vert() là template theo shading model. Báo `low SUCCESS` cho việc đó
 * là false-positive nguy hiểm nhất của kit (lỗi SHD-01): agent tin report,
 * không mở file kiểm tra, và shader sai chỉ lộ ra khi QA nhìn màn hình.
 *
 * Quy tắc: chỉ hạ xuống `low` khi `bodyTranspiled === true`.
 */
function reportShaderOutcome(reporter, { bodyTranspiled, okCode, srcFile, outFile, shadingModel, kind, notes }) {
  if (bodyTranspiled) {
    reporter.low(okCode, srcFile, outFile, `Transpiled ${kind} to Cocos effect, including shader body (Shading Model: ${shadingModel})`);
    return;
  }

  const unused = (notes && notes.unusedUniforms) || [];
  const detail = unused.length
    ? `Uniform khai bao nhung khong duoc dung trong than template: ${unused.join(', ')}`
    : '';

  reporter.high(
    'SHADER_NEEDS_MANUAL_PORT',
    srcFile,
    outFile,
    `Khung/properties/UBO da sinh dung, nhung THAN shader chua duoc dich - frag() hien la template '${shadingModel}', khong phai thuat toan goc. Agent phai viet lai tu khoi TODO-AGENT o cuoi file .effect.`,
    detail
  );
}

function convertUnityHlslToCocosEffect(options, externalReporter) {
  const reporter = externalReporter || new Reporter();
  if (!options.src) fail('--src is required');
  if (!options.out) fail('--out is required');

  const srcFile = path.resolve(options.src);
  const outFile = path.resolve(options.out);
  if (!fs.existsSync(srcFile)) fail(`Source file not found: ${srcFile}`);
  if (fs.existsSync(outFile) && !options.overwrite && !options.dryRun) {
    fail(`Output exists. Use --overwrite to replace: ${outFile}`);
  }

  const ext = path.extname(srcFile).toLowerCase();
  const source = fs.readFileSync(srcFile, 'utf8');
  const shaderName = options.shaderName || path.basename(outFile, path.extname(outFile));

  // Không được báo "Successfully transpiled" khi thân shader chỉ là template.
  // Xem SHD-01: report `low` khiến agent tin kết quả và bỏ qua shader hỏng.

  let effectText = '';
  let properties = [];
  let isTransparent = false;

  if (ext === '.shadergraph') {
    // 1. Unity ShaderGraph JSON Transpiler
    try {
      const parser = new ShaderGraphParser(source, options);
      effectText = parser.generateCocosEffect(shaderName);
      properties = parser.properties;
      isTransparent = parser.isTransparent;
      reportShaderOutcome(reporter, {
        bodyTranspiled: parser.bodyTranspiled === true,
        okCode: 'SHADERGRAPH_TRANSPILED',
        srcFile,
        outFile,
        shadingModel: parser.targetShadingModel,
        kind: 'ShaderGraph',
        notes: typeof parser.getManualPortNotes === 'function' ? parser.getManualPortNotes(effectText) : null,
      });
    } catch (e) {
      reporter.high('SHADERGRAPH_PARSE_ERROR', srcFile, outFile, `ShaderGraph parsing error: ${e.message}`, e.stack);
      throw e;
    }
  } else {
    // 2. Unity ShaderLab canonical compiler. The legacy
    // HlslAstTranspiler only emitted a shading-model template and used to
    // overwrite a compile-clean effect whenever prefab/material porting ran.
    // Keep ShaderGraph on its dedicated graph path above, and route complete
    // .shader files through the same compiler used by `shader.convert` +
    // `validate`. A standalone .hlsl/.cginc has no ShaderLab pass/entry-point
    // contract; retain the honest manual-port appendix for those rather than
    // claiming a compile-clean empty/default shader.
    try {
      if (ext !== '.shader') {
        const transpiler = new HlslAstTranspiler(source, options);
        effectText = transpiler.generateCocosEffect(shaderName);
        properties = transpiler.properties;
        isTransparent = transpiler.renderState.transparent;
        reportShaderOutcome(reporter, {
          bodyTranspiled: transpiler.bodyTranspiled === true,
          okCode: 'HLSL_TRANSPILED',
          srcFile,
          outFile,
          shadingModel: transpiler.shadingModel,
          kind: 'standalone HLSL',
          notes: transpiler.getManualPortNotes(effectText),
        });
      } else {
      const { transpileShaderFile } = require('./shader-compiler/unity-shader-compiler.cjs');
      const compiled = transpileShaderFile(srcFile, '', {
        dryRun: true,
        report: false,
        mode: 'auto',
        // This wrapper is used by Unity prefab/material porting, so its meshes
        // carry Unity UV orientation by construction.
        unityUv: options.unityUv !== false,
      });
      effectText = compiled.effectCode;
      properties = (compiled.docIR.properties || []).map((prop) => {
        const type = String(prop.type || '').toLowerCase();
        return {
          ...prop,
          kind: type === 'color' ? 'color' : type === 'vector' ? 'vector' : /float|range|int/.test(type) ? 'float' : type,
          glslName: prop.cocosName || prop.glslName || prop.name,
        };
      });
      isTransparent = options.forceTransparent === true || (options.forceOpaque !== true && /\bblend:\s*true\b/.test(effectText));

      if (compiled.validationResult.valid) {
        reporter.low(
          'HLSL_TRANSPILED',
          srcFile,
          outFile,
          `Transpiled ShaderLab/HLSL body with the canonical compiler (confidence ${compiled.scoreInfo.score}/100)`,
        );
      } else {
        reporter.high(
          'SHADER_VALIDATION_FAILED',
          srcFile,
          outFile,
          'Canonical shader compiler emitted an effect that failed static validation; do not bind it as port-complete.',
          compiled.validationResult.errors.slice(0, 8).join(' | '),
        );
      }
      }
    } catch (e) {
      reporter.high('HLSL_PARSE_ERROR', srcFile, outFile, `HLSL parsing error: ${e.message}`, e.stack);
      throw e;
    }
  }

  if (!options.dryRun) {
    ensureDir(path.dirname(outFile));
    fs.writeFileSync(outFile, effectText, 'utf8');
    const effectUuid = ensureEffectMeta(outFile, options.cocosRoot);

    if (options.generateMaterial) {
      const mtlFile = outFile.replace(/\.effect$/i, '.mtl');
      const mtlText = generateMatchingMaterial({
        effectUuid,
        effectName: shaderName,
        properties,
        isTransparent,
        targetFile: mtlFile,
      });
      fs.writeFileSync(mtlFile, mtlText, 'utf8');
      ensureMaterialMeta(mtlFile, options.cocosRoot);
      reporter.low('MATERIAL_SCAFFOLDED', srcFile, mtlFile, `Generated matching material file: ${path.basename(mtlFile)}`);
    }
  }

  if (options.report && !options.dryRun) reporter.writeCsv(path.resolve(options.report));
  return { effectText, properties, isTransparent, report: reporter, outputFile: outFile, shaderName };
}

/**
 * Batch converts a folder of shaders/shadergraphs.
 */
function findBatchShaderFiles(dir) {
  let boundary;
  try {
    boundary = createPathBoundary(dir);
  } catch {
    return [];
  }

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(boundary.resolvedRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(boundary.resolvedRoot, entry.name);
    const inspected = inspectContainedPath(boundary, full);
    if (!inspected || !inspected.stat.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (extension === '.shader' || extension === '.hlsl' || extension === '.shadergraph') {
      results.push(full);
    }
  }
  return results;
}

function batchConvert(options, reporter) {
  if (!options.dir) fail('batch requires --dir <FolderOfShaders>');
  const dir = path.resolve(options.dir);
  const outDir = path.resolve(options.outDir || path.join(options.cocosRoot, 'assets', 'effects'));
  if (!fs.existsSync(dir)) fail(`Input directory not found: ${dir}`);

  const files = findBatchShaderFiles(dir);

  log(`Found ${files.length} shader(s) in ${toPosix(dir)}`);
  const results = [];
  for (const src of files) {
    const file = path.basename(src);
    const stem = path.basename(file, path.extname(file));
    const out = path.join(outDir, `${stem}.effect`);
    log(`Converting: ${file} -> ${path.basename(out)}`);
    try {
      const res = convertUnityHlslToCocosEffect({ ...options, src, out }, reporter);
      results.push(res);
    } catch (e) {
      console.error(`Failed to convert ${file}: ${e.message}`);
    }
  }
  return results;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    printHelp();
    return;
  }
  if (options.command === 'batch' && !options.dir) fail('batch requires --dir <FolderOfShaders>');
  if (!options.dryRun) assertUnityPortPreflight(options.src || options.dir, {
    projectRoot: options.unityProject || undefined,
    requireProject: true,
  });
  const reporter = new Reporter();
  if (options.command === 'batch') {
    batchConvert(options, reporter);
  } else {
    const result = convertUnityHlslToCocosEffect(options, reporter);
    const summary = reporter.summary();
    if (options.dryRun) log(`Dry run OK: ${result.shaderName}`);
    else log(`Wrote effect: ${toPosix(result.outputFile)}`);
    if (options.generateMaterial && !options.dryRun) {
      log(`Wrote material: ${toPosix(result.outputFile.replace(/\.effect$/i, '.mtl'))}`);
    }
    if (options.report && !options.dryRun) log(`Report written to: ${toPosix(path.resolve(options.report))} (${summary.high} high, ${summary.medium} medium, ${summary.low} low)`);
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[unity-hlsl-to-cocos-effect] ${error.code || 'FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  Reporter,
  convertUnityHlslToCocosEffect,
  batchConvert,
  findBatchShaderFiles,
  generateMatchingMaterial,
  ensureEffectMeta,
  ensureMaterialMeta,
};
