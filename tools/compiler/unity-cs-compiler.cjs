'use strict';

/**
 * Unity C# to Cocos Creator 3.8.8+ Migration Compiler CLI
 *
 * Produces a static first-pass Cocos Creator TypeScript migration for AI refinement.
 *
 * Usage:
 *   node playable-shared-kit/tools/compiler/unity-cs-compiler.cjs --src <cs_file_or_dir> --out <out_dir> [--dry-run] [--report <path>] [--runtime-only]
 *
 * The emitted files are type-checked against the Cocos engine's own cc.d.ts before
 * confidence is scored, so a high score means "compiles", not merely "parses".
 * Opt out with --no-typecheck; point at a specific declaration file with
 * --cc-types <path>; dump every diagnostic with --diagnostics <path>. Pass
 * --digest to drop the per-file table from the report and keep only the
 * actionable head, and --chunks <path> to emit per-member refinement payloads
 * instead of whole files.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { parseCSharpSource } = require('./csharp-parser.cjs');
const { MigrationRulesEngine } = require('./migration-rules.cjs');
const { CocosEmitter } = require('./cocos-emitter.cjs');
const { WorkspaceIndexer } = require('./workspace-indexer.cjs');
const { SkeletonGenerator } = require('./skeleton-generator.cjs');
const { TscDiagnosticLoop } = require('./tsc-diagnostic-loop.cjs');
const { AstChunkExtractor } = require('./ast-chunk-extractor.cjs');

/**
 * Confidence >= this value is what the migration spec calls the "bypass AI" band.
 * A file that does not type-check must never reach it, however clean its emit looked.
 */
const BYPASS_CONFIDENCE_THRESHOLD = 0.9;

/** Hard ceiling applied to any file with at least one resolved type error. */
const TYPE_ERROR_CONFIDENCE_CEILING = 0.85;

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
    typecheck: true,
    ccTypes: '',
    diagnostics: '',
    digest: false,
    chunks: '',
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
    } else if (args[i] === '--no-typecheck') {
      options.typecheck = false;
    } else if (args[i] === '--cc-types' && args[i + 1]) {
      options.ccTypes = args[++i];
    } else if (args[i] === '--diagnostics' && args[i + 1]) {
      options.diagnostics = args[++i];
    } else if (args[i] === '--digest') {
      options.digest = true;
    } else if (args[i] === '--chunks' && args[i + 1]) {
      options.chunks = args[++i];
    }
  }

  return options;
}

/**
 * Locate the Cocos engine `cc.d.ts`. Without it every `import { ... } from 'cc'`
 * resolves to `any`, which SUPPRESSES downstream errors (measured: 1425 reported
 * without it vs 1492 with it) — so a type-check run without these declarations
 * understates the problem and must not be reported as a clean pass.
 */
function resolveCcTypeDeclarations(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    return fs.existsSync(resolved)
      ? { path: resolved, source: 'explicit' }
      : { path: '', source: 'explicit-missing', attempted: [resolved] };
  }

  const attempted = [];

  // A Cocos project carries temp/declarations/cc.d.ts, a thin wrapper whose
  // /// <reference> points at the engine build actually used by this project.
  const wrapper = path.resolve(process.cwd(), 'temp/declarations/cc.d.ts');
  attempted.push(wrapper);
  if (fs.existsSync(wrapper)) {
    const referenced = /\/\/\/\s*<reference\s+path=["']([^"']+)["']/.exec(fs.readFileSync(wrapper, 'utf8'));
    if (referenced && fs.existsSync(referenced[1])) {
      return { path: path.resolve(referenced[1]), source: 'project-declarations' };
    }
  }

  const engineSuffix = path.join('resources', 'resources', '3d', 'engine', 'bin', '.declarations', 'cc.d.ts');
  const editorRoots = [
    process.env.COCOS_CREATOR_PATH,
    'C:/ProgramData/cocos/editors/Creator',
    '/Applications/Cocos/Creator',
  ].filter(Boolean);

  const candidates = [];
  for (const root of editorRoots) {
    if (!fs.existsSync(root)) continue;
    // COCOS_CREATOR_PATH may point straight at one editor install.
    const direct = path.join(root, engineSuffix);
    if (fs.existsSync(direct)) candidates.push({ version: '', file: direct });
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, engineSuffix);
      // macOS nests the engine inside the .app bundle.
      const macFile = path.join(root, entry.name, 'Cocos Creator.app', 'Contents', engineSuffix);
      if (fs.existsSync(file)) candidates.push({ version: entry.name, file });
      else if (fs.existsSync(macFile)) candidates.push({ version: entry.name, file: macFile });
    }
  }
  attempted.push(...editorRoots.map(root => path.join(root, '<version>', engineSuffix)));

  if (candidates.length > 0) {
    // Newest editor version wins.
    candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    return { path: path.resolve(candidates[0].file), source: 'cocos-editor-install' };
  }

  return { path: '', source: 'not-found', attempted };
}

/**
 * Static-only confidence describes how cleanly the emitter ran, not whether the
 * result compiles. Fold in the resolved type errors so the score answers the
 * question an agent actually asks: can I ship this without reading it?
 *
 * Absolute error count is the dominant term because it tracks how much work a
 * fix is; it is log-scaled so the useful resolution sits at the top of the range
 * (1 error vs 5 matters more than 60 vs 80). Density only nudges, since
 * `constructCount` counts declarations and members - values run small (median 7
 * across BlastShooter's gameplay scripts), so a linear density term would push
 * even a single-error file down into the rewrite band.
 *
 * Guarantees: any file with >= 1 error scores below BYPASS_CONFIDENCE_THRESHOLD,
 * the result is non-increasing in `typeErrorCount`, and `staticConfidence`
 * remains an upper bound.
 */
function applyTypeErrorPenalty(staticConfidence, typeErrorCount, constructCount) {
  if (!typeErrorCount) return staticConfidence;
  const density = typeErrorCount / Math.max(1, constructCount);
  const penalty = Math.min(
    0.8,
    0.085 * (Math.log(1 + typeErrorCount) / Math.LN2) + 0.08 * Math.min(1, density),
  );
  return Math.max(0.05, Math.min(staticConfidence, TYPE_ERROR_CONFIDENCE_CEILING) - penalty);
}

/**
 * Type-check the emitted files as one program so cross-file imports resolve,
 * then fold the result back into each file's confidence score.
 */
function runTypeCheckPass(results, ccTypesPath) {
  const checkable = results.filter(result => result.success && result.outFile && fs.existsSync(result.outFile));
  if (checkable.length === 0) {
    return { status: 'skipped-no-output', totalErrors: 0, cleanFiles: 0, checkedFiles: 0, byCode: {}, errors: [] };
  }

  const startedAt = Date.now();
  const loop = new TscDiagnosticLoop();
  const rootFiles = [ccTypesPath, ...checkable.map(result => path.resolve(result.outFile))];
  const errors = loop.checkFiles(rootFiles, { types: [] });

  const byFile = new Map();
  const byCode = {};
  for (const error of errors) {
    const key = path.resolve(error.file);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(error);
    byCode[error.code] = (byCode[error.code] || 0) + 1;
  }

  let cleanFiles = 0;
  for (const result of checkable) {
    const fileErrors = byFile.get(path.resolve(result.outFile)) || [];
    result.typeErrorCount = fileErrors.length;
    if (fileErrors.length === 0) {
      cleanFiles++;
    } else {
      const codeCounts = {};
      for (const error of fileErrors) codeCounts[error.code] = (codeCounts[error.code] || 0) + 1;
      result.typeErrorCodes = codeCounts;
      result.semanticStatus = 'needs-ai-refinement';
    }
    result.confidence = applyTypeErrorPenalty(
      result.staticConfidence ?? result.confidence,
      fileErrors.length,
      result.constructCount || 1,
    );
  }

  return {
    status: 'checked',
    totalErrors: errors.length,
    cleanFiles,
    checkedFiles: checkable.length,
    byCode,
    errors,
    durationMs: Date.now() - startedAt,
  };
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
    // Emit-quality score only. runTypeCheckPass() folds resolved type errors into
    // `confidence` afterwards; until then the two are deliberately identical.
    const staticConfidence = Math.max(0.1, Math.min(ir.confidenceScore, 1 - Math.min(0.8, todoCount / (constructCount * 2)) - Math.min(0.5, riskPenalty)));
    const confidence = staticConfidence;

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
        staticConfidence,
        constructCount,
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
      staticConfidence,
      constructCount,
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

/**
 * Squeeze one result entry for the report.
 *
 * The report is read by an AI agent, so bytes are the budget. Two things
 * dominated it: absolute source/output paths repeated on every entry (~45% of
 * each), and full-precision confidence floats. Roots are hoisted into `source`
 * once and paths stored relative to them; fields that carry no information when
 * they hold their default are omitted rather than serialised.
 */
/**
 * Emit one refinement payload per BROKEN MEMBER rather than per file.
 *
 * Reading a whole emitted file plus its C# source to fix a handful of members is
 * the dominant token cost of finishing a port (measured on BlastShooter's 82
 * gameplay scripts: ~43k tokens of C# + ~40k of TypeScript). A chunk carries
 * only the member's emitted code, the matching C# lines, and the exact errors
 * inside it.
 */
function writeRefinementChunks(results, typeCheck, chunksPath, maxChunks = 200) {
  const errorLinesByFile = new Map();
  for (const error of typeCheck.errors || []) {
    const key = path.resolve(error.file);
    if (!errorLinesByFile.has(key)) errorLinesByFile.set(key, new Map());
    const lines = errorLinesByFile.get(key);
    if (!lines.has(error.line)) lines.set(error.line, []);
    lines.get(error.line).push(`${error.code}: ${error.message}`);
  }

  const extractor = new AstChunkExtractor();
  const chunks = [];
  for (const result of results) {
    if (!result.success || !result.outFile || !fs.existsSync(result.outFile)) continue;
    const lineMap = errorLinesByFile.get(path.resolve(result.outFile)) || new Map();
    if (lineMap.size === 0 && !result.todoCount) continue;

    let tsCode = '';
    let csharpSource = '';
    try {
      tsCode = fs.readFileSync(result.outFile, 'utf8');
      csharpSource = fs.readFileSync(result.file, 'utf8');
    } catch {
      continue;
    }

    for (const chunk of extractor.extractChunks(tsCode, csharpSource, result.outFile, { errorLines: new Set(lineMap.keys()) })) {
      chunks.push({
        id: chunk.id,
        member: chunk.memberName,
        source: result.file,
        target: result.outFile,
        lines: [chunk.startLine, chunk.endLine],
        trigger: chunk.trigger,
        reason: chunk.reason,
        errors: (chunk.errorLines || []).flatMap(line => (lineMap.get(line) || []).map(message => `L${line} ${message}`)),
        emittedTypeScript: chunk.emittedCode,
        csharpContext: chunk.csharpContext,
      });
      if (chunks.length >= maxChunks) break;
    }
    if (chunks.length >= maxChunks) break;
  }

  chunks.sort((a, b) => b.errors.length - a.errors.length);
  const payload = {
    tool: 'unity-cs-compiler',
    mode: 'ast-scoped-refinement-chunks',
    // Truncation has to be visible: a silently capped list reads as "that is all
    // of them", which is exactly the failure this whole report layer exists to avoid.
    truncated: chunks.length >= maxChunks,
    maxChunks,
    chunks: chunks.length,
    instructions: 'Sửa từng chunk độc lập: đọc csharpContext làm nguồn sự thật, sửa emittedTypeScript cho hết errors, rồi ghi lại đúng dải lines trong target. Không cần đọc cả file.',
    items: chunks,
  };
  const resolved = path.resolve(chunksPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}
`, 'utf8');
  return payload;
}

/**
 * Turn the compile result into concrete next steps. Without this an agent has to
 * infer what to do from a table of numbers, which is how "82/82 valid" got read
 * as "done" in the first place.
 */
function buildCompilerNextActions(typeCheck, results, options) {
  const actions = [];
  if (typeCheck.status !== 'checked') {
    actions.push(`Type-check KHÔNG chạy (${typeCheck.status}) — confidence chỉ phản ánh chất lượng emit, không phải compile được. Đừng đọc typeErrors như là 0.`);
  }
  if (typeCheck.totalErrors > 0) {
    const top = Object.entries(typeCheck.byCode).sort((a, b) => b[1] - a[1]).slice(0, 3);
    actions.push(`${typeCheck.totalErrors} lỗi TypeScript trong ${typeCheck.checkedFiles - typeCheck.cleanFiles}/${typeCheck.checkedFiles} file. Mã nhiều nhất: ${top.map(([c, n]) => `${c}x${n}`).join(', ')}. Sửa theo worstFiles từ trên xuống.`);
    if (!options.diagnostics) {
      actions.push('Chạy lại với --diagnostics <path> để lấy từng lỗi kèm file:line thay vì đọc cả file TS.');
    }
  }
  const failed = results.filter(result => !result.success).length;
  if (failed > 0) actions.push(`${failed} file không parse/emit được — xem các entry có failed:true.`);
  const todos = results.reduce((sum, result) => sum + (result.todoCount || 0), 0);
  if (todos > 0) actions.push(`${todos} @MIGRATION_TODO cần người dịch tay — grep '@MIGRATION_TODO' trong ${options.out}.`);
  if (actions.length === 0) actions.push('Không còn gì phải sửa ở tầng static. Bước tiếp: kiểm tra gameplay semantics bằng mắt.');
  return actions;
}

function compactOneResult(result, sourceRoot, outRoot) {
  const { code: _generatedCode, warnings: _warnings, ...rest } = result;
  const compact = { file: toReportPath(rest.file, sourceRoot) };

  if (rest.outFile) compact.out = toReportPath(rest.outFile, outRoot);
  if (!rest.success) {
    compact.failed = true;
    if (rest.phase) compact.phase = rest.phase;
    if (rest.error) compact.error = rest.error;
    if (rest.syntaxErrors && rest.syntaxErrors.length > 0) {
      compact.syntaxErrors = rest.syntaxErrors.slice(0, 5);
    }
  }
  if (typeof rest.confidence === 'number') compact.confidence = Number(rest.confidence.toFixed(2));
  if (typeof rest.typeErrorCount === 'number') compact.typeErrors = rest.typeErrorCount;
  if (rest.typeErrorCodes) compact.typeErrorCodes = rest.typeErrorCodes;
  if (rest.todoCount) compact.todos = rest.todoCount;
  if (rest.semanticStatus && rest.semanticStatus !== 'static-pass') compact.status = rest.semanticStatus;
  if (rest.membersCount) compact.members = rest.membersCount;
  return compact;
}

function toReportPath(filePath, root) {
  if (!filePath) return filePath;
  const relative = root ? path.relative(root, filePath) : filePath;
  const value = relative && !relative.startsWith('..') ? relative : filePath;
  return value.split(path.sep).join('/');
}

function compactReportResults(results, sourceRoot = '', outRoot = '') {
  const warningCatalog = {};
  const compactResults = results.map(result => {
    const compactResult = compactOneResult(result, sourceRoot, outRoot);
    const warningCounts = {};
    for (const warning of result.warnings || []) {
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
    // Deliberately not named `warnings`: that is the raw array on the input, and
    // reusing the name would make a counts map indistinguishable from it.
    if (Object.keys(warningCounts).length > 0) compactResult.warningCounts = warningCounts;
    return compactResult;
  });
  // Worst first: a reader that stops early still sees the files that matter.
  compactResults.sort((a, b) =>
    (b.typeErrors || 0) - (a.typeErrors || 0) || (a.confidence || 0) - (b.confidence || 0));
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

  let ccTypes = { path: '', source: 'disabled' };
  let typeCheck = { status: 'disabled', totalErrors: 0, cleanFiles: 0, checkedFiles: 0, byCode: {}, errors: [] };
  if (options.typecheck && !options.dryRun) {
    ccTypes = resolveCcTypeDeclarations(options.ccTypes);
    if (ccTypes.path) {
      typeCheck = runTypeCheckPass(results, ccTypes.path);
    } else {
      typeCheck = { ...typeCheck, status: 'unavailable-cc-types' };
      console.warn(`\n[WARN] Cocos 'cc.d.ts' not found - type check SKIPPED, confidence scores are emit-quality only.`);
      console.warn(`[WARN] Open the project in Cocos Creator once to generate temp/declarations/, or pass --cc-types <path to cc.d.ts>.`);
    }
  } else if (options.dryRun && options.typecheck) {
    typeCheck = { ...typeCheck, status: 'skipped-dry-run' };
  }

  console.log(`\n=== Static Migration Summary ===`);
  console.log(`Total: ${files.length} | TS syntax valid: ${successCount} | Failed: ${failCount}`);
  console.log(`TypeScript syntax valid: ${successCount}/${files.length}`);
  if (typeCheck.status === 'checked') {
    console.log(`Type-check vs cc.d.ts: ${typeCheck.cleanFiles}/${typeCheck.checkedFiles} file(s) clean | ${typeCheck.totalErrors} error(s) in ${typeCheck.durationMs}ms`);
    const topCodes = Object.entries(typeCheck.byCode).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topCodes.length > 0) {
      console.log(`Top error codes: ${topCodes.map(([code, count]) => `${code}=${count}`).join(' ')}`);
    }
  } else {
    console.log(`Type-check vs cc.d.ts: NOT RUN (${typeCheck.status})`);
  }
  const bypassCount = results.filter(result => result.success && result.confidence >= BYPASS_CONFIDENCE_THRESHOLD).length;
  console.log(`Confidence >= ${BYPASS_CONFIDENCE_THRESHOLD}: ${bypassCount}/${successCount} file(s) (the "review not required" band)`);
  console.log(`Migration TODOs: ${results.reduce((sum, result) => sum + (result.todoCount || 0), 0)}`);
  console.log('Gameplay semantic equivalence: NOT VALIDATED (AI refinement required)');

  if (options.diagnostics && typeCheck.errors.length > 0) {
    const diagnosticsPath = path.resolve(options.diagnostics);
    fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
    fs.writeFileSync(diagnosticsPath, JSON.stringify({
      ccTypes: ccTypes.path,
      totalErrors: typeCheck.totalErrors,
      byCode: typeCheck.byCode,
      errors: typeCheck.errors.map(error => ({
        code: error.code,
        file: path.relative(path.resolve(options.out), error.file).split(path.sep).join('/'),
        line: error.line,
        col: error.col,
        message: error.message,
      })),
    }, null, 2), 'utf8');
    console.log(`Type diagnostics written to ${options.diagnostics}`);
  }

  if (options.chunks) {
    const chunkPayload = writeRefinementChunks(results, typeCheck, options.chunks);
    console.log(`Refinement chunks: ${chunkPayload.chunks} member(s) -> ${options.chunks}${chunkPayload.truncated ? ' (truncated)' : ''}`);
  }

  if (options.report) {
    const outRoot = path.resolve(options.out);
    const { compactResults: reportResults, warningCatalog } = compactReportResults(results, sourceRoot, outRoot);
    const reportData = {
      timestamp: new Date().toISOString(),
      validationScope: {
        csharpParserAndEmitter: true,
        typescriptSyntax: true,
        // 'checked' is the only value that makes typeErrorCount meaningful; any
        // other value means an absent count is UNKNOWN, not zero.
        typescriptTypes: typeCheck.status,
        ccTypeDeclarations: ccTypes.path || null,
        gameplaySemanticEquivalence: 'not-validated',
      },
      source: {
        // Paths in `results` are relative to these two roots.
        sourceRoot,
        outRoot,
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
        typeCheckStatus: typeCheck.status,
        typeCheckedFiles: typeCheck.checkedFiles,
        typeCleanFiles: typeCheck.cleanFiles,
        typeErrorTotal: typeCheck.totalErrors,
        typeErrorsByCode: typeCheck.byCode,
        migrationTodos: results.reduce((sum, result) => sum + (result.todoCount || 0), 0),
        highConfidence: results.filter(result => result.success && result.confidence >= BYPASS_CONFIDENCE_THRESHOLD).length,
        mediumConfidence: results.filter(result => result.success && result.confidence >= 0.7 && result.confidence < BYPASS_CONFIDENCE_THRESHOLD).length,
        lowConfidence: results.filter(result => result.success && result.confidence < 0.7).length,
      },
      // Read this first: the shortlist an agent needs to start work without
      // paging through every per-file entry.
      worstFiles: reportResults
        .filter(entry => (entry.typeErrors || 0) > 0 || entry.failed)
        .slice(0, 10)
        .map(entry => ({
          file: entry.file,
          typeErrors: entry.typeErrors || 0,
          confidence: entry.confidence,
          topCodes: Object.entries(entry.typeErrorCodes || {})
            .sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([code, count]) => `${code}x${count}`),
        })),
      nextActions: buildCompilerNextActions(typeCheck, results, options),
      warningCatalog,
      ...(options.digest ? {} : { results: reportResults }),
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
  resolveCcTypeDeclarations,
  applyTypeErrorPenalty,
  runTypeCheckPass,
  BYPASS_CONFIDENCE_THRESHOLD,
  TYPE_ERROR_CONFIDENCE_CEILING,
};
