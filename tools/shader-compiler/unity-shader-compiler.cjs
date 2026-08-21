#!/usr/bin/env node
'use strict';

/**
 * Unity HLSL / ShaderLab -> Cocos Creator 3.8.8+ GLSL Effect Transpiler (UCShaderTranspiler)
 *
 * Core Compiler CLI & Programmatic API
 *
 * Usage:
 *   node unity-shader-compiler.cjs convert --src <UnityShader> --out <CocosEffect> [options]
 *   node unity-shader-compiler.cjs convert-mat --src <UnityMat> --out <CocosMtl> [options]
 *   node unity-shader-compiler.cjs scan <UnityDirectory> [options]
 *   node unity-shader-compiler.cjs inspect <UnityShader>
 *   node unity-shader-compiler.cjs batch --dir <UnityShadersDir> --out-dir <CocosEffectsDir> [options]
 *   node unity-shader-compiler.cjs validate <CocosEffect>
 *   node unity-shader-compiler.cjs doctor
 */

const fs = require('fs');
const path = require('path');
const { parseShaderLab } = require('./shaderlab-parser.cjs');
const { analyzeHlslProgram } = require('./hlsl-ast-parser.cjs');
const { UnityIncludeResolver } = require('./unity-include-resolver.cjs');
const { emitCocosEffect, emitCocosMaterial } = require('./cocos-effect-generator.cjs');
const { validateCceffectStructure, lintPlayableShader } = require('./shader-validator.cjs');
const {
  scoreConfidence,
  generateMarkdownReport,
  generateJsonReport,
  generateAiPolishContext,
} = require('./shader-reporter.cjs');
const {
  generateUcstAiJson,
  generateStructuredPatch,
  generateReadmeAiPolishMd,
} = require('./ai-polish-patch-generator.cjs');
const { probeNativeBackends } = require('./native-backends.cjs');
const { convertMatFile, convertUnityMatToCocosMtl } = require('./unity-material-converter.cjs');
const { generateVariantManifest } = require('./shader-variant-manager.cjs');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function findShadersInDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findShadersInDir(full));
    } else if (/\.(shader|hlsl|cginc)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Transpiles a single Unity shader file to Cocos Creator .effect
 */
function transpileShaderFile(srcPath, outPath, options = {}) {
  const source = fs.readFileSync(srcPath, 'utf8');
  const srcDir = path.dirname(srcPath);

  // 1. Resolve includes
  const includeResolver = new UnityIncludeResolver({
    searchRoots: [srcDir, ...(options.searchRoots || [])],
  });

  // 2. Parse ShaderLab
  const docIR = parseShaderLab(source, srcPath);

  // 3. Analyze HLSL in passes
  for (const subShader of docIR.subShaders) {
    for (const pass of subShader.passes) {
      analyzeHlslProgram(pass.program);
    }
  }

  // 4. Emit Cocos .effect
  // `--mode auto` picks the backend (spec section 28). A shader that hands a
  // SurfaceData to UniversalFragmentPBR, or declares `#pragma surface`, is
  // asking for the engine's PBR pipeline: the unlit path cannot express it and
  // would emit a fragment body referencing URP library structs that do not
  // exist in Cocos. Detecting it here means a caller does not have to know
  // which dialect the shader was written in.
  const emitOptions = { ...options };
  if (!emitOptions.mode || emitOptions.mode === 'auto') {
    const allHlslForMode = docIR.subShaders
      .map(s => s.passes.map(p => (p.program && p.program.rawHlsl) || '').join('\n'))
      .join('\n');
    if (/\bUniversalFragmentPBR\b/.test(allHlslForMode) ||
        /#pragma\s+surface\b/i.test(allHlslForMode)) {
      emitOptions.mode = 'surface-pbr';
      emitOptions.autoSelectedMode = true;
    }
  }
  const effectCode = emitCocosEffect(docIR, emitOptions);

  // 5. Validate generated effect
  const validationResult = validateCceffectStructure(effectCode);
  const lintResult = lintPlayableShader(docIR, effectCode);
  for (const issue of (lintResult.issues || [])) {
    validationResult.warnings.push(`[${issue.severity.toUpperCase()}] ${issue.message}`);
  }

  // Surface-pbr channels the emitter could not map (tangent-space normals,
  // engine-supplied GI) decide whether the port matches Unity. They must reach
  // the caller, not just sit in the docIR.
  for (const d of (docIR.surfaceDiagnostics || [])) {
    const line = `[${d.code}] ${d.message}`;
    if (d.severity === 'high') validationResult.errors.push(line);
    else validationResult.warnings.push(line);
  }
  if (validationResult.errors.length > 0) validationResult.valid = false;

  // 6. Score Confidence & Variant Manifest
  const scoreInfo = scoreConfidence(docIR, effectCode, validationResult);
  const allHlsl = docIR.subShaders.map(s => s.passes.map(p => p.program.rawHlsl).join('\n')).join('\n');
  const variantInfo = generateVariantManifest(docIR.shaderName, allHlsl, options);

  // 7. Write outputs if not dryRun
  if (!options.dryRun && outPath) {
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, effectCode, 'utf8');

    // Material generation
    if (options.generateMaterial || options.m) {
      const mtlPath = outPath.replace(/\.effect$/i, '.mtl');
      const relEffectUuid = path.basename(outPath).replace(/\.effect$/i, '');
      const mtlContent = emitCocosMaterial(docIR, relEffectUuid);
      fs.writeFileSync(mtlPath, mtlContent, 'utf8');
    }

    // Report generation
    if (options.report) {
      const baseOut = outPath.replace(/\.effect$/i, '');
      const mdReport = generateMarkdownReport(docIR, effectCode, validationResult, scoreInfo, variantInfo);
      const jsonReport = generateJsonReport(docIR, effectCode, validationResult, scoreInfo, variantInfo);
      fs.writeFileSync(`${baseOut}.report.md`, mdReport, 'utf8');
      fs.writeFileSync(`${baseOut}.report.json`, jsonReport, 'utf8');
      fs.writeFileSync(`${baseOut}.shader-variants.json`, JSON.stringify(variantInfo.manifest, null, 2), 'utf8');

      const ucstAi = generateUcstAiJson(docIR, effectCode, validationResult, scoreInfo, options);
      fs.writeFileSync(`${baseOut}.ucst-ai.json`, JSON.stringify(ucstAi, null, 2), 'utf8');

      const patch = generateStructuredPatch(docIR, effectCode);
      fs.writeFileSync(`${baseOut}.patch.json`, JSON.stringify(patch, null, 2), 'utf8');

      if (scoreInfo.score < 90 || validationResult.errors.length > 0) {
        const polishContext = generateReadmeAiPolishMd(docIR, source, effectCode, validationResult, scoreInfo, options);
        fs.writeFileSync(`${baseOut}.ai-polish.md`, polishContext, 'utf8');
      }
    }
  }

  return {
    docIR,
    effectCode,
    validationResult,
    scoreInfo,
    variantInfo,
    mode: emitOptions.mode || 'auto',
    autoSelectedMode: Boolean(emitOptions.autoSelectedMode),
  };
}

// ============================================================================
// CLI Commands
// ============================================================================

function cmdDoctor() {
  console.log('=== UCShaderTranspiler Doctor ===');
  const backends = probeNativeBackends();
  console.log(`DXC Available:        ${backends.dxc.available ? '✅ YES (' + backends.dxc.path + ')' : '❌ NO'}`);
  console.log(`SPIRV-Cross Available:${backends.spirvCross.available ? '✅ YES (' + backends.spirvCross.path + ')' : '❌ NO'}`);
  console.log(`spirv-val Available:  ${backends.spirvVal.available ? '✅ YES (' + backends.spirvVal.path + ')' : '❌ NO'}`);
  console.log(`Built-in AST Lowerer: ✅ ACTIVE (Universal Node.js Fallback)`);
  console.log('\nReady for Unity HLSL / ShaderLab -> Cocos Creator 3.8.8 transpilation.');
}

function cmdScan(dir) {
  console.log(`Scanning '${dir}' for Unity shaders...`);
  const shaders = findShadersInDir(dir);
  console.log(`Found ${shaders.length} shader files:\n`);

  const summary = {
    Unlit: 0,
    Toon: 0,
    PBR: 0,
    MatCap: 0,
    Dissolve: 0,
    Custom: 0,
  };

  for (const s of shaders) {
    try {
      const content = fs.readFileSync(s, 'utf8');
      const doc = parseShaderLab(content, s);
      summary[doc.family] = (summary[doc.family] || 0) + 1;
      console.log(`  - [${doc.family.padEnd(8)}] ${doc.shaderName || path.basename(s)} (${s})`);
    } catch (e) {
      console.log(`  - [ERROR   ] ${path.basename(s)}: ${e.message}`);
    }
  }

  console.log('\n=== Summary by Shader Family ===');
  for (const [k, v] of Object.entries(summary)) {
    if (v > 0) console.log(`  ${k.padEnd(10)}: ${v}`);
  }
}

function cmdInspect(srcPath) {
  if (!fs.existsSync(srcPath)) {
    console.error(`File not found: ${srcPath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(srcPath, 'utf8');
  const doc = parseShaderLab(content, srcPath);

  console.log(`=== ShaderLab Document: ${doc.shaderName} ===`);
  console.log(`Family:       ${doc.family}`);
  console.log(`Source File:  ${doc.sourceFile}`);
  console.log(`Properties:   ${doc.properties.length}`);
  for (const p of doc.properties) {
    console.log(`  - ${p.name.padEnd(20)} (${p.type}) -> ${p.cocosName} (${p.cocosType})`);
  }
  console.log(`SubShaders:   ${doc.subShaders.length}`);
  for (let i = 0; i < doc.subShaders.length; i++) {
    const sub = doc.subShaders[i];
    console.log(`  SubShader #${i + 1}: ${sub.passes.length} Passes`);
    for (let j = 0; j < sub.passes.length; j++) {
      const p = sub.passes[j];
      console.log(`    Pass #${j + 1} (${p.name}): Vert=${p.program.vertexEntry}, Frag=${p.program.fragmentEntry}, Cull=${p.renderState.cull}, ZWrite=${p.renderState.zWrite}`);
    }
  }
}

function cmdConvert(options) {
  if (!options.src) {
    console.error('Error: --src <UnityShader> is required.');
    process.exit(1);
  }
  if (!options.out) {
    console.error('Error: --out <CocosEffect> is required.');
    process.exit(1);
  }

  console.log(`Transpiling: ${options.src} -> ${options.out}`);
  const result = transpileShaderFile(options.src, options.out, options);

  console.log(`\n✅ Converted: ${result.docIR.shaderName} -> ${options.out}`);
  if (result.docIR.surfaceIntentStyle) {
    // Say which backend ran and why: surface-pbr and unlit produce completely
    // different files, and `auto` may have chosen for the caller.
    console.log(`   Mode:       surface-pbr (${result.docIR.surfaceIntentStyle} PBR intent${result.mode === 'surface-pbr' && result.autoSelectedMode ? ', auto-selected' : ''})`);
  }
  console.log(`   Confidence: ${result.scoreInfo.score}/100 (Grade ${result.scoreInfo.grade})`);
  console.log(`   Validation: ${result.validationResult.valid ? 'PASS' : 'FAIL'}`);

  if (result.validationResult.errors.length > 0) {
    console.log('   Errors:');
    for (const e of result.validationResult.errors) console.log(`     - ❌ ${e}`);
  }
  if (result.validationResult.warnings.length > 0) {
    console.log('   Warnings:');
    for (const w of result.validationResult.warnings) console.log(`     - ⚠️ ${w}`);
  }
}

function cmdConvertMat(options) {
  if (!options.src) {
    console.error('Error: --src <UnityMaterial.mat> is required.');
    process.exit(1);
  }
  if (!options.out) {
    console.error('Error: --out <CocosMaterial.mtl> is required.');
    process.exit(1);
  }

  console.log(`Converting Material: ${options.src} -> ${options.out}`);
  const matResult = convertMatFile(options.src, options.out, options);
  console.log(`✅ Converted material to ${options.out}`);
  console.log(`   Properties: ${matResult.propertyCount}`);
  for (const w of matResult.warnings) console.log(`   ⚠️  ${w}`);
}

function cmdBatch(options) {
  const dir = options.dir || '.';
  const outDir = options.outDir || 'assets/effects';
  const shaders = findShadersInDir(dir).filter(f => f.endsWith('.shader'));

  console.log(`Batch converting ${shaders.length} shaders from '${dir}' to '${outDir}'...`);
  ensureDir(outDir);

  let successCount = 0;
  for (const src of shaders) {
    const rel = path.relative(dir, src);
    const out = path.join(outDir, rel.replace(/\.shader$/i, '.effect'));
    try {
      transpileShaderFile(src, out, options);
      successCount++;
      console.log(`  [✓] ${rel} -> ${out}`);
    } catch (err) {
      console.error(`  [✗] Failed ${rel}: ${err.message}`);
    }
  }
  console.log(`\nBatch conversion finished: ${successCount}/${shaders.length} converted.`);
}

function cmdValidate(effectPath) {
  if (!fs.existsSync(effectPath)) {
    console.error(`Effect file not found: ${effectPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(effectPath, 'utf8');
  const res = validateCceffectStructure(text);
  console.log(`Validation for '${effectPath}': ${res.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (res.errors.length > 0) {
    console.log('Errors:');
    for (const e of res.errors) console.log(`  - ❌ ${e}`);
  }
  if (res.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of res.warnings) console.log(`  - ⚠️ ${w}`);
  }
  // Exit code 5 = validation failure (spec section 65), so CI and agent verify
  // gates can branch on the result instead of scraping stdout.
  if (!res.valid) process.exitCode = 5;
}

/**
 * `chain` -- prefab -> materials -> shaders + textures, converted in one pass.
 *
 * Output is deliberately terse. The point of this command is that a caller
 * (human or agent) never has to read the prefab YAML, the .mat YAML, or the
 * per-shader reports to know what to do next; everything actionable is on
 * screen and everything else is on disk.
 */
function cmdChain(options) {
  const { resolveChain } = require('./prefab-shader-chain.cjs');
  const { analyzeEffect } = require('./glsl-static-analyzer.cjs');
  const { convertMatFile } = require('./unity-material-converter.cjs');

  if (!options.src) {
    console.error('Error: --src <Prefab.prefab> is required.');
    process.exit(2);
  }
  if (!options.unityRoot) {
    console.error('Error: --unity-root <UnityProject/Assets> is required (needed to resolve GUIDs).');
    process.exit(2);
  }

  const chain = resolveChain(options.src, options.unityRoot, options);
  const outDir = options.outDir;
  const blocking = [];
  const effectByShader = new Map();

  if (outDir) {
    const effectsDir = path.join(outDir, 'effects');
    const materialsDir = path.join(outDir, 'materials');
    for (const sh of chain.shaders) {
      const dest = path.join(effectsDir, `${sh.name}.effect`);
      try {
        const res = transpileShaderFile(sh.path, dest, { ...options, report: true });
        const analysis = analyzeEffect(fs.readFileSync(dest, 'utf8'));
        effectByShader.set(sh.path, dest);
        sh.effect = dest;
        sh.score = res.scoreInfo.score;
        sh.grade = res.scoreInfo.grade;
        sh.clean = analysis.ok;
        // surface-pbr and unlit produce structurally different effects, and a
        // PBR shader is routed automatically -- say which one ran.
        sh.mode = res.mode;
        sh.intentStyle = res.docIR.surfaceIntentStyle || null;
        for (const e of analysis.errors) {
          blocking.push(`${path.basename(dest)} ${e.program || ''}:${e.line || '-'} [${e.code}] ${e.message}`);
        }
      } catch (err) {
        sh.error = err.message;
        blocking.push(`${sh.name}.shader FAILED TO TRANSPILE: ${err.message}`);
      }
    }
    for (const mat of chain.materials) {
      if (mat.shaderIsBuiltin) continue;
      const dest = path.join(materialsDir, `${mat.name}.mtl`);
      try {
        const res = convertMatFile(mat.path, dest, {
          ...options,
          effectPath: mat.shader ? effectByShader.get(mat.shader) : undefined,
        });
        mat.mtl = dest;
        mat.propertyCount = res.propertyCount;
      } catch (err) {
        mat.error = err.message;
        blocking.push(`${mat.name}.mat FAILED: ${err.message}`);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ ...chain, blocking }, null, 2));
    if (blocking.length) process.exitCode = 5;
    return;
  }

  const rel = (p) => path.relative(options.unityRoot, p).replace(/\\/g, '/');
  console.log(`\n=== Shader chain: ${path.basename(chain.prefab)} ===`);
  console.log(`guid index      ${chain.indexSize} assets${chain.fromCache ? ' (cached)' : ''}`);
  console.log(`materials       ${chain.materials.length}${chain.materials.length ? '  ' + chain.materials.map(m => m.name).join(', ') : ''}`);

  for (const sh of chain.shaders) {
    const mode = sh.mode === 'surface-pbr'
      ? `surface-pbr/${sh.intentStyle || 'pbr'}`
      : 'unlit';
    const status = sh.effect
      ? `${mode}, ${sh.clean ? 'compile-clean' : 'NEEDS WORK'}, score ${sh.score} (${sh.grade})`
      : 'not converted (no --out-dir)';
    console.log(`shader          ${sh.name}  [used by ${sh.usedByMaterials} material(s)]  ${status}`);
  }
  const builtinMats = chain.materials.filter(m => m.shaderIsBuiltin);
  if (builtinMats.length) {
    console.log(`builtin shaders ${builtinMats.length} material(s) use a Unity built-in/package shader with no .shader on disk:`);
    console.log(`                ${builtinMats.map(m => m.name).join(', ')}  -> rewrite by hand or map to a Cocos builtin effect`);
  }

  console.log(`textures        ${chain.textures.length}${chain.textures.length ? '  (import these into Cocos)' : ''}`);
  for (const t of chain.textures) console.log(`                ${rel(t)}`);
  if (chain.meshes.length) {
    console.log(`meshes          ${chain.meshes.length}`);
    for (const m of chain.meshes) console.log(`                ${rel(m)}`);
  }
  if (chain.unresolved.length) {
    console.log(`unresolved      ${chain.unresolved.length} GUID(s) not found under --unity-root (built-in assets or a missing package)`);
  }

  if (outDir) {
    const wroteEffects = chain.shaders.filter(s => s.effect).length;
    const wroteMtl = chain.materials.filter(m => m.mtl).length;
    console.log(`\nwrote           ${wroteEffects} .effect, ${wroteMtl} .mtl -> ${outDir}`);
  }

  if (blocking.length) {
    console.log(`\nBLOCKING (${blocking.length}) -- these will not compile or link as emitted:`);
    for (const b of blocking) console.log(`  ❌ ${b}`);
    process.exitCode = 5;
  } else if (outDir) {
    console.log('\n✅ every generated effect is compile-clean.');
  }

  if (outDir && chain.materials.some(m => m.mtl)) {
    // _effectAsset needs the UUID Cocos assigns on import, which does not exist
    // until the editor has seen the .effect. Saying so beats a silent fallback.
    console.log('\nnext: import the effects in Cocos Creator, then re-run convert-mat with');
    console.log('      --effect-uuid <uuid from the generated .effect.meta> to bind each material.');
  }
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  const options = {
    src: '',
    out: '',
    dir: '',
    outDir: '',
    report: true,
    generateMaterial: false,
    m: false,
    dryRun: false,
    mode: 'auto',
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--src' && args[i + 1]) options.src = args[++i];
    else if (arg === '--out' && args[i + 1]) options.out = args[++i];
    else if (arg === '--dir' && args[i + 1]) options.dir = args[++i];
    else if (arg === '--out-dir' && args[i + 1]) options.outDir = args[++i];
    else if (arg === '--mode' && args[i + 1]) options.mode = args[++i];
    else if (arg === '--report') options.report = true;
    else if (arg === '--no-report') options.report = false;
    else if (arg === '--generate-material' || arg === '-m') options.generateMaterial = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--unity-uv') options.unityUv = true;
    // convert-mat: bind the material to its effect. --effect-uuid fills
    // _effectAsset; --effect additionally filters out properties the effect
    // does not declare.
    else if (arg === '--effect-uuid' && args[i + 1]) options.effectUuid = args[++i];
    else if (arg === '--effect' && args[i + 1]) options.effectPath = args[++i];
    // chain: GUID resolution needs the Unity Assets root.
    else if (arg === '--unity-root' && args[i + 1]) options.unityRoot = args[++i];
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-cache') options.noCache = true;
  }

  // Handle positionals
  if (command === 'scan') {
    cmdScan(args[1] || options.dir || '.');
  } else if (command === 'inspect') {
    cmdInspect(args[1] || options.src);
  } else if (command === 'convert') {
    options.src = options.src || args[1];
    cmdConvert(options);
  } else if (command === 'convert-mat') {
    options.src = options.src || args[1];
    cmdConvertMat(options);
  } else if (command === 'batch') {
    options.dir = options.dir || args[1];
    cmdBatch(options);
  } else if (command === 'validate') {
    cmdValidate(args[1] || options.out);
  } else if (command === 'chain') {
    options.src = options.src || args[1];
    cmdChain(options);
  } else if (command === 'doctor') {
    cmdDoctor();
  } else {
    console.log(`
UCShaderTranspiler - Unity HLSL/ShaderLab -> Cocos Creator 3.8.8 GLSL Effect Transpiler

Usage:
  node unity-shader-compiler.cjs chain --src <Prefab> --unity-root <Assets> [--out-dir <dir>] [--json] [--no-cache]
  node unity-shader-compiler.cjs convert --src <Shader> --out <Effect> [-m] [--mode auto|unlit|surface-pbr] [--unity-uv] [--report|--no-report] [--dry-run]

  --unity-uv  Lấy mẫu texture theo quy ước UV của Unity (gốc dưới-trái) bằng texU().
              Bật khi shader chạy trên hình học mang UV từ Unity. Mặc định TẮT vì
              bật lên sẽ đổi hình của mọi effect đã sinh trước đó.
  node unity-shader-compiler.cjs convert-mat --src <UnityMat> --out <CocosMtl> [--effect <Effect>] [--effect-uuid <uuid>]
  node unity-shader-compiler.cjs scan <UnityDir>
  node unity-shader-compiler.cjs inspect <Shader>
  node unity-shader-compiler.cjs batch --dir <ShadersDir> --out-dir <EffectsDir> [-m]
  node unity-shader-compiler.cjs validate <Effect>
  node unity-shader-compiler.cjs doctor

'chain' is the entry point for "port this prefab and whatever it renders with":
it walks prefab -> materials -> shader + textures, converts each, and prints
only what still needs a decision.
    `);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  transpileShaderFile,
  findShadersInDir,
  convertMatFile,
  convertUnityMatToCocosMtl,
};
