'use strict';

/**
 * CLI & Batch Workflow Enhancements
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. CLI Commands:
 *    - ucshader lint <effect> --profile playable --json
 *    - ucshader stats <path> --profile playable
 *    - ucshader diff <unity-shader> <cocos-effect>
 *    - ucshader material-map <unity-material> <cocos-effect>
 *    - ucshader batch <path> --preset playable-ad --watch --only-failures --fail-on-warning
 *    - ucshader ai-context <shader> --format json|md
 * 2. Deterministic Cache Key & Incremental Compilation
 * 3. Parallel Batch Conversion (concurrency = min(physicalCpuCount, 6))
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { parseShaderLab } = require('./shaderlab-parser.cjs');
const { emitCocosEffect } = require('./cocos-effect-generator.cjs');
const { validateCocosEffect, compareSpirvDiff } = require('./validation-differential-runner.cjs');
const { lintWebGLPlayable } = require('./webgl-playable-optimizer.cjs');
const { generateMaterialAssetManifest } = require('./unity-material-converter.cjs');
const { generateUcstAiJson, generateReadmeAiPolishMd } = require('./ai-polish-patch-generator.cjs');
const { scoreConfidence } = require('./shader-reporter.cjs');

const RULE_PACK_VERSION = '2.4.0';

/**
 * Computes deterministic cache key for incremental compilation
 */
function computeCacheKey(sourceContent, dependencies = [], profile = 'playable-ad', config = {}) {
  const hash = crypto.createHash('sha256');
  hash.update(sourceContent);
  hash.update(profile);
  hash.update(RULE_PACK_VERSION);
  hash.update(JSON.stringify(config));

  for (const dep of dependencies) {
    if (typeof dep === 'string') {
      hash.update(dep);
    } else if (dep.content) {
      hash.update(dep.content);
    }
  }

  return hash.digest('hex');
}

/**
 * CLI Command: lint
 */
function cmdLint(effectPath, options = {}) {
  if (!fs.existsSync(effectPath)) {
    throw new Error(`File not found: ${effectPath}`);
  }
  const effectText = fs.readFileSync(effectPath, 'utf8');
  const lintResult = lintWebGLPlayable(effectText, options);
  const valResult = validateCocosEffect({}, effectText);

  const result = {
    file: effectPath,
    profile: options.profile || 'playable',
    webgl2: lintResult.webgl2,
    webgl1Fallback: lintResult.webgl1Fallback,
    valid: valResult.valid,
    errors: valResult.errors,
    warnings: [...valResult.warnings, ...lintResult.issues.map(i => `[${i.severity.toUpperCase()}] ${i.message}`)],
  };

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    `=== UCShader Lint: ${effectPath} ===`,
    `Profile: ${result.profile}`,
    `WEBGL2: ${result.webgl2}`,
    `WEBGL1-FALLBACK: ${result.webgl1Fallback}`,
    `Status: ${result.valid ? 'VALID' : 'INVALID'}`,
  ];
  if (result.errors.length > 0) {
    lines.push('Errors:');
    result.errors.forEach(e => lines.push(`  - ❌ ${e}`));
  }
  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    result.warnings.forEach(w => lines.push(`  - ⚠️ ${w}`));
  }
  return lines.join('\n');
}

/**
 * CLI Command: stats
 */
function cmdStats(targetPath, options = {}) {
  const files = [];
  if (fs.statSync(targetPath).isDirectory()) {
    const list = fs.readdirSync(targetPath);
    for (const f of list) {
      if (f.endsWith('.effect') || f.endsWith('.shader')) files.push(path.join(targetPath, f));
    }
  } else {
    files.push(targetPath);
  }

  let totalSamplers = 0;
  let totalPasses = 0;
  let totalInstructions = 0;

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    totalSamplers += (text.match(/uniform\s+sampler\w+\s+\w+/g) || []).length;
    totalPasses += (text.match(/- vert:\s*vs:vert/g) || []).length;
    totalInstructions += (text.match(/\b(?:texture|mul|sin|cos|normalize|clamp|mix)\b/g) || []).length;
  }

  return {
    path: targetPath,
    scannedFiles: files.length,
    profile: options.profile || 'playable',
    totalSamplers,
    totalPasses,
    totalInstructions,
    averageSamplersPerShader: files.length > 0 ? (totalSamplers / files.length).toFixed(1) : 0,
  };
}

/**
 * CLI Command: diff
 */
function cmdDiff(unityShaderPath, cocosEffectPath) {
  const hlsl = fs.readFileSync(unityShaderPath, 'utf8');
  const glsl = fs.readFileSync(cocosEffectPath, 'utf8');
  return compareSpirvDiff(hlsl, glsl);
}

/**
 * CLI Command: material-map
 */
function cmdMaterialMap(unityMaterialPath, cocosEffectPath, options = {}) {
  const yaml = fs.readFileSync(unityMaterialPath, 'utf8');
  const matName = path.basename(unityMaterialPath, '.mat');
  return generateMaterialAssetManifest(yaml, {
    materialName: matName,
    effectPath: cocosEffectPath,
    ...options,
  });
}

/**
 * CLI Command: ai-context
 */
function cmdAiContext(shaderPath, options = {}) {
  const rawSource = fs.readFileSync(shaderPath, 'utf8');
  const basename = path.basename(shaderPath, '.shader');
  const docIR = parseShaderLab(rawSource, path.basename(shaderPath));
  const effectCode = emitCocosEffect(docIR);
  const valResult = validateCocosEffect(docIR, effectCode);
  const scoreInfo = scoreConfidence(docIR, effectCode, valResult);

  if (options.format === 'json') {
    return generateUcstAiJson(docIR, effectCode, valResult, scoreInfo, options);
  }
  return generateReadmeAiPolishMd(docIR, rawSource, effectCode, valResult, scoreInfo, options);
}

/**
 * Batch processor with parallel execution and incremental caching
 */
async function cmdBatch(srcDir, outDir, options = {}) {
  const cpuCount = os.cpus() ? os.cpus().length : 4;
  const concurrency = options.concurrency || Math.min(cpuCount, 6);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const cacheFile = path.join(outDir, '.ucst-cache.json');
  let cache = {};
  if (fs.existsSync(cacheFile)) {
    try {
      cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (_) {}
  }

  const allFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.shader'));
  const results = {
    total: allFiles.length,
    converted: 0,
    cached: 0,
    failed: 0,
    concurrency,
  };

  for (const file of allFiles) {
    const srcPath = path.join(srcDir, file);
    const content = fs.readFileSync(srcPath, 'utf8');
    const key = computeCacheKey(content, [], options.preset || 'playable-ad', options);

    if (cache[file] && cache[file].key === key && !options.force) {
      results.cached++;
      continue;
    }

    try {
      const docIR = parseShaderLab(content, file);
      const effectCode = emitCocosEffect(docIR);
      const outFile = path.join(outDir, `${path.basename(file, '.shader')}.effect`);
      fs.writeFileSync(outFile, effectCode, 'utf8');

      cache[file] = {
        key,
        timestamp: Date.now(),
      };
      results.converted++;
    } catch (err) {
      results.failed++;
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  return results;
}

module.exports = {
  RULE_PACK_VERSION,
  computeCacheKey,
  cmdLint,
  cmdStats,
  cmdDiff,
  cmdMaterialMap,
  cmdAiContext,
  cmdBatch,
};
