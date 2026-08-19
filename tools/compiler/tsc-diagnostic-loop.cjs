'use strict';

/**
 * Automated TypeScript Diagnostic Feedback Loop (Self-Healing Compiler)
 *
 * Runs static TypeScript diagnostic verification, packages structured error
 * contexts for targeted AI repair, tracks retry cycles (max 3), and flags
 * stubborn errors with `@MANUAL_REVIEW_REQUIRED`.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

class TscDiagnosticLoop {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.history = new Map(); // errorKey -> count
  }

  checkFiles(filePaths, compilerOptions = {}) {
    const options = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      experimentalDecorators: true,
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      ...compilerOptions,
    };

    const host = ts.createCompilerHost(options);
    const program = ts.createProgram(filePaths, options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const errors = [];
    for (const diag of diagnostics) {
      if (diag.category === ts.DiagnosticCategory.Error) {
        let file = '';
        let line = 0;
        let col = 0;
        if (diag.file && diag.start !== undefined) {
          file = diag.file.fileName;
          const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
          line = pos.line + 1;
          col = pos.character + 1;
        }
        const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        errors.push({
          code: `TS${diag.code}`,
          file,
          line,
          col,
          message,
        });
      }
    }

    return errors;
  }

  packageRepairPrompt(error, sourceCode = '') {
    const lines = sourceCode ? sourceCode.split('\n') : [];
    const contextStart = Math.max(0, error.line - 5);
    const contextEnd = Math.min(lines.length, error.line + 5);
    const snippet = lines.slice(contextStart, contextEnd).join('\n');

    return [
      `// === TypeScript Diagnostic Repair Target ===`,
      `// File: ${path.basename(error.file)} (Line ${error.line}, Column ${error.col})`,
      `// Error: [${error.code}] ${error.message}`,
      `// Source Code Context:`,
      snippet ? `/*\n${snippet}\n*/` : '(Source code unavailable)',
      '',
      `// Instruction: Fix this TypeScript compiler error strictly following Cocos Creator 3.8.8+ API and Zero-GC rules.`,
    ].join('\n');
  }

  markManualReview(filePath, line, errorCode, reason) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const targetIdx = Math.max(0, line - 1);
    lines.splice(targetIdx, 0, `// @MANUAL_REVIEW_REQUIRED [${errorCode}]: ${reason}`);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { files: [], dir: '', maxRetries: 3, json: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) options.dir = args[++i];
    else if (args[i] === '--max-retries' && args[i + 1]) options.maxRetries = parseInt(args[++i], 10) || 3;
    else if (args[i] === '--json') options.json = true;
    else if (!args[i].startsWith('--')) options.files.push(args[i]);
  }
  return options;
}

function collectTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const options = parseArgs();
  let files = options.files;
  if (options.dir) {
    files = collectTsFiles(options.dir);
  }

  if (files.length === 0) {
    console.log('Usage: node tsc-diagnostic-loop.cjs <files...> [--dir <directory>] [--json]');
    return;
  }

  const loop = new TscDiagnosticLoop({ maxRetries: options.maxRetries });
  const errors = loop.checkFiles(files);

  if (options.json) {
    console.log(JSON.stringify({ total: files.length, errorCount: errors.length, errors }, null, 2));
  } else {
    console.log(`\n=== TypeScript Diagnostic Verification ===`);
    console.log(`Files scanned: ${files.length}`);
    console.log(`Errors found: ${errors.length}\n`);

    for (const err of errors) {
      console.log(`[${err.code}] ${path.basename(err.file)}:${err.line}:${err.col} - ${err.message}`);
    }
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  TscDiagnosticLoop,
};
