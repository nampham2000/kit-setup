'use strict';

/**
 * Unity C# to Cocos Creator 3.8.8+ Migration Compiler CLI
 *
 * Produces a static first-pass Cocos Creator TypeScript migration for AI refinement.
 *
 * Usage:
 *   node playable-shared-kit/tools/compiler/unity-cs-compiler.cjs --src <cs_file_or_dir> --out <out_dir> [--dry-run] [--report <path>] [--runtime-only]
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { parseCSharpSource } = require('./csharp-parser.cjs');
const { MigrationRulesEngine } = require('./migration-rules.cjs');
const { CocosEmitter } = require('./cocos-emitter.cjs');
const { WorkspaceIndexer } = require('./workspace-indexer.cjs');
const { SkeletonGenerator } = require('./skeleton-generator.cjs');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    src: '',
    out: 'assets/script',
    dryRun: false,
    report: '',
    verbose: false,
    flatOutput: false,
    runtimeOnly: false,
    emitSkeleton: '',
    workspace: true,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && args[i + 1]) {
      options.src = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
      options.out = args[++i];
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--report' && args[i + 1]) {
      options.report = args[++i];
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    } else if (args[i] === '--flat-output') {
      options.flatOutput = true;
    } else if (args[i] === '--runtime-only') {
      options.runtimeOnly = true;
    } else if (args[i] === '--emit-skeleton' && args[i + 1]) {
      options.emitSkeleton = args[++i];
    } else if (args[i] === '--no-workspace') {
      options.workspace = false;
    }
  }

  return options;
}

function getTypeScriptSyntaxErrors(code, filename) {
  const sourceFile = ts.createSourceFile(
    filename.replace(/\.cs$/i, '.ts'),
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
  return (sourceFile.parseDiagnostics || []).map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (diagnostic.start === undefined) return { code: diagnostic.code, message };
    const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    return {
      code: diagnostic.code,
      line: position.line + 1,
      column: position.character + 1,
      message,
    };
  });
}

function countIrMembers(ir) {
  let count = 0;
  for (const declaration of ir.declarations || []) {
    count += (declaration.fields || []).length;
    count += (declaration.properties || []).length;
    count += (declaration.methods || []).length;
    count += (declaration.constructors || []).length;
    count += (declaration.members || []).length;
  }
  return count;
}

function analyzeMigrationRisks(filePath, source, code, ir, inlineTodoCount) {
  const warnings = [...(ir.todoNotes || [])];
  const addPatternRisk = (id, severity, reason, pattern, target = source) => {
    if (pattern.test(target)) warnings.push({ kind: id, severity, reason });
  };

  if (inlineTodoCount > 0) {
    warnings.push({
      kind: 'generated-todos',
      severity: 'high',
      count: inlineTodoCount,
      reason: 'One or more constructs were emitted as @MIGRATION_TODO placeholders.',
    });
  }
  if (filePath.split(/[\\/]+/).some(segment => segment === 'Editor' || segment.endsWith('.Editor'))) {
    warnings.push({
      kind: 'editor-only',
      severity: 'low',
      reason: 'Unity Editor code is normally excluded from a playable runtime.',
    });
  }

  addPatternRisk('unity-physics', 'medium', 'Unity physics semantics require Cocos collision/physics review.', /\b(?:Physics2D?|Rigidbody2D?|Collider2D?|RaycastHit2D?)\b/);
  addPatternRisk('unity-animation', 'medium', 'Unity Animator/animation or tween semantics require Cocos review.', /\b(?:Animator|AnimationClip|DOTween|DG\.Tweening)\b/);
  addPatternRisk('coroutine', 'medium', 'Coroutine scheduling and yield instructions require lifecycle review.', /\b(?:IEnumerator|StartCoroutine|StopCoroutine|WaitForSeconds|yield\s+return)\b/);
  addPatternRisk('async-runtime', 'medium', 'Task/UniTask cancellation and scheduling require runtime review.', /\b(?:UniTask|Task<|CancellationToken|\bawait\b)\b/);
  addPatternRisk('unsafe-code', 'high', 'Unsafe, fixed, pointer, or stackalloc code cannot be preserved directly.', /\b(?:unsafe|fixed|stackalloc)\b|->/);
  addPatternRisk('unity-editor-api', 'medium', 'UnityEditor APIs do not have a playable runtime equivalent.', /\bUnityEditor\b/);
  addPatternRisk(
    'residual-csharp-collections',
    'medium',
    'Generated code still contains C# collection APIs that AI should convert to JavaScript/TypeScript equivalents.',
    /\.(?:Count|Add|AddRange|Clear|ContainsKey|RemoveAt|TryGetValue)\b/,
    code
  );
  addPatternRisk(
    'residual-unity-api',
    'medium',
    'Generated code still contains Unity-style APIs that need a Cocos mapping.',
    /\b(?:GameObject|Resources|Input|Application|PlayerPrefs|Debug|Object\.(?:Instantiate|Destroy|Find))\b/,
    code
  );

  for (const warning of warnings) {
    if (!warning.severity) {
      warning.severity = warning.kind === 'unsupported-member' ? 'high' : 'medium';
    }
  }
  return warnings;
}

function resolveOutputPath(filePath, outDir, options) {
  if (!options.preserveStructure || !options.sourceRoot) {
    return path.join(outDir, path.basename(filePath).replace(/\.cs$/i, '.ts'));
  }
  let relative = path.relative(options.sourceRoot, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) relative = path.basename(filePath);
  return path.join(outDir, relative.replace(/\.cs$/i, '.ts'));
}

function compileFile(filePath, outDir, dryRun = false, compileOptions = {}) {
  const source = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  const startTime = Date.now();
  const options = {
    preserveStructure: false,
    sourceRoot: '',
    validateSyntax: true,
    ...compileOptions,
  };

  try {
    const ast = parseCSharpSource(source, filename);
    const engine = new MigrationRulesEngine(options.workspaceIndexer);
    const ir = engine.transform(ast);
    const emitter = new CocosEmitter();
    const tsCode = emitter.emit(ir);
    const outPath = resolveOutputPath(filePath, outDir, options);
    const syntaxErrors = options.validateSyntax ? getTypeScriptSyntaxErrors(tsCode, filename) : [];
    const inlineTodoCount = (tsCode.match(/@MIGRATION_TODO/g) || []).length;
    const warnings = analyzeMigrationRisks(filePath, source, tsCode, ir, inlineTodoCount);
    const todoCount = inlineTodoCount + (ir.todoNotes || []).length;
    const constructCount = Math.max(1, (ir.declarations || []).length + countIrMembers(ir));
    const highRiskCount = warnings.filter(warning => warning.severity === 'high').length;
    const mediumRiskCount = warnings.filter(warning => warning.severity === 'medium').length;
    const lowRiskCount = warnings.filter(warning => warning.severity === 'low').length;
    const riskPenalty = highRiskCount * 0.2 + mediumRiskCount * 0.06 + lowRiskCount * 0.01;
    const confidence = Math.max(0.1, Math.min(ir.confidenceScore, 1 - Math.min(0.8, todoCount / (constructCount * 2)) - Math.min(0.5, riskPenalty)));

    if (syntaxErrors.length > 0) {
      return {
        success: false,
        phase: 'typescript-syntax',
        file: filePath,
        outFile: outPath,
        error: `${syntaxErrors.length} TypeScript syntax error(s)`,
        syntaxErrors,
        todoCount,
        warnings,
        confidence,
        code: tsCode,
        durationMs: Date.now() - startTime,
      };
    }

    if (!dryRun) {
      const outputParent = path.dirname(outPath);
      if (!fs.existsSync(outputParent)) {
        fs.mkdirSync(outputParent, { recursive: true });
      }
      fs.writeFileSync(outPath, tsCode, 'utf8');
    }

    const duration = Date.now() - startTime;
    return {
      success: true,
      file: filePath,
      outFile: outPath,
      durationMs: duration,
      declarationsCount: ir.declarations.length,
      membersCount: countIrMembers(ir),
      syntaxValid: true,
      todoCount,
      warnings,
      semanticStatus: warnings.length === 0 ? 'static-pass' : 'needs-ai-refinement',
      confidence,
      code: tsCode,
    };
  } catch (err) {
    return {
      success: false,
      phase: 'csharp-parser-or-emitter',
      file: filePath,
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

const SKIP_DIRECTORIES = new Set(['.git', 'Library', 'Logs', 'obj', 'Temp']);

function collectCsFiles(targetPath) {
  if (!fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);
  if (stat.isFile() && targetPath.endsWith('.cs')) return [targetPath];
  if (!stat.isDirectory()) return [];

  const results = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(targetPath, entry.name);
    if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
      results.push(...collectCsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      results.push(full);
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function isEditorFile(filePath) {
  return filePath.split(/[\\/]+/).some(segment => segment === 'Editor' || segment.endsWith('.Editor'));
}

function detectUnityProjectRoots(files) {
  const roots = new Set();
  for (const file of files) {
    let current = path.dirname(path.resolve(file));
    let assetsRoot = '';
    let packagesRoot = '';
    while (true) {
      const name = path.basename(current).toLowerCase();
      // Prefer the outer Unity Assets ancestor. Third-party packages sometimes
      // contain their own directory literally named "Packages" under Assets.
      if (name === 'assets') assetsRoot = path.dirname(current);
      else if (name === 'packages') packagesRoot = path.dirname(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const detectedRoot = assetsRoot || packagesRoot;
    if (detectedRoot) roots.add(detectedRoot);
  }
  return Array.from(roots).sort((left, right) => left.localeCompare(right));
}

function compactReportResults(results) {
  const warningCatalog = {};
  const compactResults = results.map(result => {
    const { code: _generatedCode, warnings = [], ...compactResult } = result;
    const warningCounts = {};
    for (const warning of warnings) {
      const kind = warning.kind || 'unspecified';
      const severity = warning.severity || 'medium';
      const key = `${severity}:${kind}`;
      warningCounts[key] = (warningCounts[key] || 0) + Math.max(1, warning.count || 1);
      if (!warningCatalog[kind]) warningCatalog[kind] = { severity, descriptions: [] };
      if (warning.reason && warningCatalog[kind].descriptions.length < 3 &&
          !warningCatalog[kind].descriptions.includes(warning.reason)) {
        warningCatalog[kind].descriptions.push(warning.reason);
      }
    }
    if (Object.keys(warningCounts).length > 0) compactResult.warningCounts = warningCounts;
    return compactResult;
  });
  return { compactResults, warningCatalog };
}

function main() {
  const options = parseArgs();
  if (!options.src) {
    console.error('Error: --src <file_or_dir> is required.');
    process.exit(1);
  }

  const discoveredFiles = collectCsFiles(options.src);
  const skippedEditorFiles = options.runtimeOnly ? discoveredFiles.filter(isEditorFile).length : 0;
  const files = options.runtimeOnly ? discoveredFiles.filter(file => !isEditorFile(file)) : discoveredFiles;
  if (files.length === 0) {
    console.error(`No .cs files found at '${options.src}'`);
    process.exit(1);
  }

  console.log(`\n=== Unity C# -> Cocos Creator Migration Compiler ===`);
  console.log(`Files found: ${files.length}`);
  console.log(`Output directory: ${options.out}`);
  console.log(`Dry run: ${options.dryRun ? 'YES' : 'NO'}\n`);
  if (skippedEditorFiles > 0) console.log(`Runtime-only: skipped ${skippedEditorFiles} Editor file(s)\n`);

  const results = [];
  let successCount = 0;
  let failCount = 0;

  const sourceStat = fs.statSync(options.src);
  const sourceRoot = sourceStat.isDirectory() ? path.resolve(options.src) : path.dirname(path.resolve(options.src));
  const unityProjectRoots = detectUnityProjectRoots(files);
  if (unityProjectRoots.length > 1) {
    console.warn(`[WARN] Detected ${unityProjectRoots.length} Unity project roots. Pass one platform/project root as --src to avoid duplicate migration work.`);
  }

  let workspaceIndexer = null;
  if (options.workspace && files.length > 1) {
    if (options.verbose) console.log(`Indexing workspace (${files.length} files)...`);
    workspaceIndexer = new WorkspaceIndexer();
    workspaceIndexer.indexFiles(files);
  }

  const generatedFiles = [];

  for (const f of files) {
    const res = compileFile(f, options.out, options.dryRun, {
      preserveStructure: sourceStat.isDirectory() && !options.flatOutput,
      sourceRoot,
      validateSyntax: true,
      workspaceIndexer,
    });
    results.push(res);
    if (res.success) {
      successCount++;
      if (res.outFile) generatedFiles.push(res.outFile);
      if (options.verbose) {
        console.log(`[PASS] ${path.relative(sourceRoot, f)} -> ${path.relative(options.out, res.outFile)} (${res.durationMs}ms) [Confidence: ${(res.confidence * 100).toFixed(0)}%]`);
      }
    } else {
      failCount++;
      console.error(`[FAIL] ${path.basename(f)}: ${res.error}`);
    }
  }

  if (options.emitSkeleton && generatedFiles.length > 0 && !options.dryRun) {
    const generator = new SkeletonGenerator();
    const skeletonContent = generator.generateFromFiles(generatedFiles);
    const skeletonPath = path.resolve(options.emitSkeleton);
    fs.mkdirSync(path.dirname(skeletonPath), { recursive: true });
    fs.writeFileSync(skeletonPath, skeletonContent, 'utf8');
    console.log(`Skeleton emitted -> ${options.emitSkeleton}`);
  }

  console.log(`\n=== Static Migration Summary ===`);
  console.log(`Total: ${files.length} | TS syntax valid: ${successCount} | Failed: ${failCount}`);
  console.log(`TypeScript syntax valid: ${successCount}/${files.length}`);
  console.log(`Migration TODOs: ${results.reduce((sum, result) => sum + (result.todoCount || 0), 0)}`);
  console.log('Gameplay semantic equivalence: NOT VALIDATED (AI refinement required)');

  if (options.report) {
    const { compactResults: reportResults, warningCatalog } = compactReportResults(results);
    const reportData = {
      timestamp: new Date().toISOString(),
      validationScope: {
        csharpParserAndEmitter: true,
        typescriptSyntax: true,
        gameplaySemanticEquivalence: 'not-validated',
      },
      source: {
        requestedPath: path.resolve(options.src),
        unityProjectRoots,
        multipleUnityProjectsDetected: unityProjectRoots.length > 1,
        runtimeOnly: options.runtimeOnly,
        skippedEditorFiles,
      },
      total: files.length,
      passed: successCount,
      failed: failCount,
      metrics: {
        parserAndEmitterPassed: results.filter(result => result.phase !== 'csharp-parser-or-emitter').length,
        typescriptSyntaxValid: successCount,
        migrationTodos: results.reduce((sum, result) => sum + (result.todoCount || 0), 0),
        highConfidence: results.filter(result => result.success && result.confidence >= 0.9).length,
        mediumConfidence: results.filter(result => result.success && result.confidence >= 0.7 && result.confidence < 0.9).length,
        lowConfidence: results.filter(result => result.success && result.confidence < 0.7).length,
      },
      warningCatalog,
      results: reportResults,
    };
    const reportParent = path.dirname(path.resolve(options.report));
    if (!fs.existsSync(reportParent)) fs.mkdirSync(reportParent, { recursive: true });
    fs.writeFileSync(options.report, JSON.stringify(reportData, null, 2), 'utf8');
    console.log(`Report written to ${options.report}`);
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  compileFile,
  collectCsFiles,
  compactReportResults,
  detectUnityProjectRoots,
  getTypeScriptSyntaxErrors,
};
