'use strict';

/**
 * Independent regression oracle for the Unity C# migration compiler.
 *
 * A parser pass is intentionally reported separately from TypeScript syntax
 * validity and structural retention. This prevents a no-throw parse/emit from
 * being presented as a successful compilation.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { parseCSharpSource } = require('./csharp-parser.cjs');
const { MigrationRulesEngine } = require('./migration-rules.cjs');
const { CocosEmitter } = require('./cocos-emitter.cjs');

const PROJECTS = [
  ['BlashShooter', 'E:/Working/Unity/Puzzle/BlashShooter'],
  ['BlossomQuest', 'E:/Working/Unity/Puzzle/BlossomQuest'],
  ['BounceMerge', 'E:/Working/Unity/Puzzle/BounceMerge'],
  ['CandyPopSort', 'E:/Working/Unity/Puzzle/CandyPopSort'],
  ['CatBlockSlidePuzzle', 'E:/Working/Unity/Puzzle/CatBlockSlidePuzzle'],
  ['DominoHoleDropPuzzle', 'E:/Working/Unity/Puzzle/DominoHoleDropPuzzle'],
  ['GrillFever', 'E:/Working/Unity/Puzzle/GrillFever'],
  ['HexaThrowBlockSort', 'E:/Working/Unity/Puzzle/HexaThrowBlockSort'],
  ['PictureBlock', 'E:/Working/Unity/Puzzle/PictureBlock'],
  ['ScrewOutFactory', 'E:/Working/Unity/Puzzle/ScrewOutFactory'],
  ['TapeTap', 'E:/Working/Unity/Puzzle/TapeTap'],
  ['TileFood', 'E:/Working/Unity/Puzzle/TileFood'],
  ['TileHoleMaster', 'E:/Working/Unity/Puzzle/TileHoleMaster'],
  ['HoleScrum4', 'D:/_Projects/Unity/HoleScrum4'],
  ['MarbleSort', 'D:/_Projects/Unity/MarbleSort'],
  ['MyCozyHome', 'D:/_Projects/Unity/MyCozyHome'],
  ['SmashFest', 'D:/_Projects/Unity/SmashFest'],
  ['Tank3d', 'D:/_Projects/Unity/Tank3d'],
];

const SKIP_DIRECTORIES = new Set(['.git', 'Library', 'Logs', 'obj', 'Temp']);
const TYPE_DECLARATION_KINDS = new Set([
  'ClassDeclaration',
  'StructDeclaration',
  'EnumDeclaration',
  'InterfaceDeclaration',
  'DelegateDeclaration',
]);

function parseArgs(argv) {
  const options = { project: '', json: false, report: '', samples: 20 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) options.project = argv[++i];
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--report' && argv[i + 1]) options.report = argv[++i];
    else if (argv[i] === '--samples' && argv[i + 1]) options.samples = Math.max(0, Number(argv[++i]) || 0);
  }
  return options;
}

function collectCsFiles(root) {
  const results = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      results.push({ scanError: `${current}: ${error.message}` });
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) pending.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.cs')) results.push({ file: fullPath });
    }
  }
  return results.sort((left, right) => String(left.file || left.scanError).localeCompare(String(right.file || right.scanError)));
}

function getAstDeclarations(ast) {
  const roots = [
    ...(ast.classes || []),
    ...(ast.structs || []),
    ...(ast.enums || []),
    ...(ast.interfaces || []),
    ...(ast.delegates || []),
  ];
  for (const namespace of ast.namespaces || []) {
    roots.push(
      ...(namespace.classes || []),
      ...(namespace.structs || []),
      ...(namespace.enums || []),
      ...(namespace.interfaces || []),
      ...(namespace.delegates || [])
    );
  }
  const declarations = [];
  const visit = declaration => {
    declarations.push(declaration);
    for (const member of declaration.members || []) {
      if (TYPE_DECLARATION_KINDS.has(member.kind)) visit(member);
    }
  };
  roots.forEach(visit);
  return declarations;
}

function countSourceMembers(declarations) {
  let count = 0;
  for (const declaration of declarations) {
    for (const member of declaration.members || []) {
      if (TYPE_DECLARATION_KINDS.has(member.kind)) continue;
      count += member.kind === 'FieldDeclaration' ? (member.declarations || []).length : 1;
    }
  }
  return count;
}

function incrementCount(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
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

function formatDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${pos.line + 1}:${pos.character + 1} ${message}`;
}

function getSyntaxErrors(code, filename) {
  const sourceFile = ts.createSourceFile(
    filename.replace(/\.cs$/i, '.ts'),
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
  return (sourceFile.parseDiagnostics || []).map(diagnostic => ({
    code: diagnostic.code,
    message: formatDiagnostic(diagnostic),
  }));
}

function isEditorFile(file) {
  return file.split(/[\\/]+/).some(segment => segment === 'Editor' || segment.endsWith('.Editor'));
}

function addSample(samples, limit, value) {
  if (samples.length < limit) samples.push(value);
}

function auditProject(name, root, options) {
  const startedAt = Date.now();
  const entries = collectCsFiles(root);
  const files = entries.filter(entry => entry.file).map(entry => entry.file);
  const scanErrors = entries.filter(entry => entry.scanError).map(entry => entry.scanError);
  const basenameOwners = new Map();
  for (const file of files) {
    const basename = path.basename(file).toLowerCase();
    if (!basenameOwners.has(basename)) basenameOwners.set(basename, []);
    basenameOwners.get(basename).push(file);
  }
  const collisions = Array.from(basenameOwners.entries())
    .filter(([, owners]) => owners.length > 1)
    .map(([basename, owners]) => ({ basename, count: owners.length, files: owners.slice(0, options.samples) }));

  const summary = {
    name,
    root,
    files: files.length,
    editorFiles: files.filter(isEditorFile).length,
    scanErrors: scanErrors.length,
    parserPassed: 0,
    parserFailed: 0,
    emitterPassed: 0,
    emitterFailed: 0,
    syntaxValid: 0,
    syntaxInvalid: 0,
    filesWithTodos: 0,
    todoCount: 0,
    syntaxDiagnosticCounts: {},
    sourceDeclarations: 0,
    retainedDeclarations: 0,
    sourceMembers: 0,
    retainedMembers: 0,
    sourceMemberKinds: {},
    retainedMemberKinds: {},
    unsupportedMemberKinds: {},
    declarationlessSourceFiles: 0,
    basenameCollisions: collisions.length,
    collidingFiles: collisions.reduce((sum, item) => sum + item.count, 0),
    durationMs: 0,
    rates: {},
    samples: {
      scanErrors: scanErrors.slice(0, options.samples),
      parserErrors: [],
      emitterErrors: [],
      syntaxErrors: [],
      declarationless: [],
      collisions: collisions.slice(0, options.samples),
    },
  };

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parseCSharpSource(source, path.basename(file));
      summary.parserPassed++;
    } catch (error) {
      summary.parserFailed++;
      addSample(summary.samples.parserErrors, options.samples, { file, error: error.message });
      continue;
    }

    const sourceDeclarations = getAstDeclarations(ast);
    const sourceMemberCount = countSourceMembers(sourceDeclarations);
    summary.sourceDeclarations += sourceDeclarations.length;
    summary.sourceMembers += sourceMemberCount;
    for (const declaration of sourceDeclarations) {
      for (const member of declaration.members || []) {
        if (TYPE_DECLARATION_KINDS.has(member.kind)) continue;
        incrementCount(
          summary.sourceMemberKinds,
          member.kind || 'UnknownMember',
          member.kind === 'FieldDeclaration' ? (member.declarations || []).length : 1
        );
      }
    }
    if (sourceDeclarations.length === 0 && /\b(class|struct|interface|enum|delegate|record)\b/.test(source)) {
      summary.declarationlessSourceFiles++;
      addSample(summary.samples.declarationless, options.samples, file);
    }

    let ir;
    let code;
    try {
      ir = new MigrationRulesEngine().transform(ast);
      code = new CocosEmitter().emit(ir);
      summary.emitterPassed++;
    } catch (error) {
      summary.emitterFailed++;
      addSample(summary.samples.emitterErrors, options.samples, { file, error: error.message });
      continue;
    }

    summary.retainedDeclarations += (ir.declarations || []).length;
    summary.retainedMembers += countIrMembers(ir);
    for (const declaration of ir.declarations || []) {
      incrementCount(summary.retainedMemberKinds, 'fields', (declaration.fields || []).length);
      incrementCount(summary.retainedMemberKinds, 'properties', (declaration.properties || []).length);
      incrementCount(summary.retainedMemberKinds, 'methods', (declaration.methods || []).length);
      incrementCount(summary.retainedMemberKinds, 'constructors', (declaration.constructors || []).length);
      incrementCount(summary.retainedMemberKinds, 'members', (declaration.members || []).length);
    }
    for (const note of ir.todoNotes || []) {
      if (note.kind === 'unsupported-member') {
        incrementCount(summary.unsupportedMemberKinds, note.memberKind || 'UnknownMember');
      }
    }
    const todos = code.match(/@MIGRATION_TODO/g) || [];
    if (todos.length > 0) summary.filesWithTodos++;
    summary.todoCount += todos.length;

    const syntaxErrors = getSyntaxErrors(code, path.basename(file));
    if (syntaxErrors.length === 0) summary.syntaxValid++;
    else {
      summary.syntaxInvalid++;
      for (const error of syntaxErrors) {
        const key = `TS${error.code}`;
        summary.syntaxDiagnosticCounts[key] = (summary.syntaxDiagnosticCounts[key] || 0) + 1;
      }
      addSample(summary.samples.syntaxErrors, options.samples, { file, errors: syntaxErrors.slice(0, 5) });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  summary.rates = {
    parser: files.length ? summary.parserPassed / files.length : 0,
    emitter: files.length ? summary.emitterPassed / files.length : 0,
    syntax: files.length ? summary.syntaxValid / files.length : 0,
    declarationRetention: summary.sourceDeclarations ? summary.retainedDeclarations / summary.sourceDeclarations : 1,
    memberRetention: summary.sourceMembers ? summary.retainedMembers / summary.sourceMembers : 1,
  };
  return summary;
}

function printHuman(summary) {
  const pct = value => `${(value * 100).toFixed(2)}%`;
  console.log(`\n=== ${summary.name} ===`);
  console.log(`Files: ${summary.files} (${summary.editorFiles} editor-only)`);
  console.log(`Parser pass: ${summary.parserPassed}/${summary.files} (${pct(summary.rates.parser)})`);
  console.log(`Emitter pass: ${summary.emitterPassed}/${summary.files} (${pct(summary.rates.emitter)})`);
  console.log(`TS syntax valid: ${summary.syntaxValid}/${summary.files} (${pct(summary.rates.syntax)})`);
  console.log(`Declaration retention: ${summary.retainedDeclarations}/${summary.sourceDeclarations} (${pct(summary.rates.declarationRetention)})`);
  console.log(`Member retention: ${summary.retainedMembers}/${summary.sourceMembers} (${pct(summary.rates.memberRetention)})`);
  console.log(`TODOs: ${summary.todoCount} in ${summary.filesWithTodos} files`);
  console.log(`Syntax diagnostic counts: ${JSON.stringify(summary.syntaxDiagnosticCounts)}`);
  console.log(`Flattened-output collisions: ${summary.basenameCollisions} basenames / ${summary.collidingFiles} files`);
  console.log(`Duration: ${(summary.durationMs / 1000).toFixed(2)}s`);
  for (const [kind, samples] of Object.entries(summary.samples)) {
    if (samples.length > 0) console.log(`${kind}: ${JSON.stringify(samples, null, 2)}`);
  }
}

function aggregateSummaries(summaries) {
  const sum = key => summaries.reduce((total, summary) => total + (summary[key] || 0), 0);
  const aggregate = {
    projects: summaries.length,
    files: sum('files'),
    editorFiles: sum('editorFiles'),
    parserPassed: sum('parserPassed'),
    parserFailed: sum('parserFailed'),
    emitterPassed: sum('emitterPassed'),
    emitterFailed: sum('emitterFailed'),
    syntaxValid: sum('syntaxValid'),
    syntaxInvalid: sum('syntaxInvalid'),
    sourceDeclarations: sum('sourceDeclarations'),
    retainedDeclarations: sum('retainedDeclarations'),
    sourceMembers: sum('sourceMembers'),
    retainedMembers: sum('retainedMembers'),
    todoCount: sum('todoCount'),
    filesWithTodos: sum('filesWithTodos'),
    basenameCollisions: sum('basenameCollisions'),
    collidingFiles: sum('collidingFiles'),
    durationMs: sum('durationMs'),
  };
  aggregate.rates = {
    parser: aggregate.files ? aggregate.parserPassed / aggregate.files : 0,
    emitter: aggregate.files ? aggregate.emitterPassed / aggregate.files : 0,
    syntax: aggregate.files ? aggregate.syntaxValid / aggregate.files : 0,
    declarationRetention: aggregate.sourceDeclarations ? aggregate.retainedDeclarations / aggregate.sourceDeclarations : 1,
    memberRetention: aggregate.sourceMembers ? aggregate.retainedMembers / aggregate.sourceMembers : 1,
  };
  aggregate.sourceMemberKinds = {};
  aggregate.retainedMemberKinds = {};
  aggregate.unsupportedMemberKinds = {};
  for (const summary of summaries) {
    for (const [kind, count] of Object.entries(summary.sourceMemberKinds || {})) {
      incrementCount(aggregate.sourceMemberKinds, kind, count);
    }
    for (const [kind, count] of Object.entries(summary.retainedMemberKinds || {})) {
      incrementCount(aggregate.retainedMemberKinds, kind, count);
    }
    for (const [kind, count] of Object.entries(summary.unsupportedMemberKinds || {})) {
      incrementCount(aggregate.unsupportedMemberKinds, kind, count);
    }
  }
  return aggregate;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = options.project
    ? PROJECTS.filter(([name]) => name.toLowerCase() === options.project.toLowerCase())
    : PROJECTS;
  if (selected.length === 0) {
    console.error(`Unknown project '${options.project}'.`);
    process.exitCode = 1;
    return;
  }
  const summaries = selected.map(([name, root]) => auditProject(name, root, options));
  const reportData = {
    generatedAt: new Date().toISOString(),
    validationScope: {
      csharpParser: true,
      migrationEmitter: true,
      typescriptSyntax: true,
      declarationAndMemberRetention: true,
      gameplaySemanticEquivalence: 'not-validated',
    },
    aggregate: aggregateSummaries(summaries),
    projects: summaries,
  };
  if (options.report) {
    const reportPath = path.resolve(options.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf8');
  }
  if (options.json) console.log(JSON.stringify(reportData, null, 2));
  else summaries.forEach(printHuman);
  if (summaries.some(summary => summary.parserFailed || summary.emitterFailed || summary.syntaxInvalid || summary.scanErrors)) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { PROJECTS, aggregateSummaries, auditProject, collectCsFiles };
