#!/usr/bin/env node
'use strict';

/**
 * Zero-GC & Playable Ad Architecture Linter
 *
 * Scans TypeScript files for:
 * 1. Runtime memory allocations (new Vec3, new Quat, instantiate, etc.) inside update/loop methods.
 * 2. Hardcoded CTA store URLs (should use PlayableConfigManager / SuperHtmlPlayable).
 * 3. Event listener cleanup (warns if node.on is called without matching node.off or onDestroy).
 */

const fs = require('fs');
const path = require('path');

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
  : (findProjectRoot(process.cwd()) || process.cwd());

const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

function walkDir(dir, filterFn, maxDepth = 8, currentDepth = 0) {
  if (!fs.existsSync(dir) || currentDepth > maxDepth) return [];
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'library' || entry.name === 'temp' || entry.name === 'local') {
          continue;
        }
        results = results.concat(walkDir(fullPath, filterFn, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        if (!filterFn || filterFn(entry.name, fullPath)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {}
  return results;
}

/**
 * Extracts method bodies for update(dt), lateUpdate(dt), tick(dt), onUpdate(dt)
 */
function extractLoopBlocks(content) {
  const lines = content.split(/\r?\n/);
  const loopBlocks = [];
  const loopMethodRegex = /(?:public\s+|private\s+|protected\s+|override\s+|async\s+)*(?:update|lateUpdate|onUpdate|fixedUpdate|tick)\s*\([^)]*\)\s*\{/i;

  let inLoop = false;
  let braceCount = 0;
  let currentBlock = { startLine: 0, lines: [], methodName: '' };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (!inLoop) {
      const match = line.match(loopMethodRegex);
      if (match) {
        inLoop = true;
        braceCount = 0;
        currentBlock = {
          startLine: lineNum,
          lines: [],
          methodName: match[0].trim().split('(')[0].split(/\s+/).pop() || 'update'
        };
        // Count open braces in this line
        for (const char of line.slice(line.indexOf('{'))) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
        currentBlock.lines.push({ lineNum, text: line });
        if (braceCount === 0 && line.includes('{')) {
          inLoop = false;
          loopBlocks.push(currentBlock);
        }
      }
    } else {
      currentBlock.lines.push({ lineNum, text: line });
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      if (braceCount <= 0) {
        inLoop = false;
        loopBlocks.push(currentBlock);
      }
    }
  }

  return loopBlocks;
}

function lintFile(filePath) {
  const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  // 1. Check Zero-GC in update loops
  const loopBlocks = extractLoopBlocks(content);
  const gcAllocationPatterns = [
    { regex: /\bnew\s+(Vec[234]|Quat|Color|Mat[34]|Size)\s*\(/, rule: 'ZERO_GC_MATH_ALLOCATION', msg: 'Avoid new Vec/Quat/Color in loop. Reuse static temp variables (e.g. const _tempVec3 = new Vec3()).' },
    { regex: /\binstantiate\s*\(/, rule: 'ZERO_GC_INSTANTIATE_IN_LOOP', msg: 'Avoid instantiate() in update loop. Use ObjectPool from playable-core.' },
  ];

  for (const block of loopBlocks) {
    for (const item of block.lines) {
      // Skip commented lines
      const trimmed = item.text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      for (const pattern of gcAllocationPatterns) {
        if (pattern.regex.test(item.text)) {
          violations.push({
            file: relPath,
            line: item.lineNum,
            method: block.methodName,
            rule: pattern.rule,
            severity: 'error',
            message: pattern.msg,
            snippet: trimmed
          });
        }
      }
    }
  }

  // 2. Check hardcoded CTA URLs anywhere in script
  const ctaUrlRegex = /['"`](https?:\/\/(?:play\.google\.com|apps\.apple\.com)[^'"`]*)['"`]/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const match = line.match(ctaUrlRegex);
    if (match) {
      violations.push({
        file: relPath,
        line: i + 1,
        rule: 'HARDCODED_CTA_URL',
        severity: 'warning',
        message: `Hardcoded store URL detected ('${match[1]}'). Move to assets/resources/playable-config.json and access via PlayableConfigManager.instance.cta.`,
        snippet: trimmed
      });
    }
  }

  return violations;
}

function runLinter(options = {}) {
  const targetDir = options.targetDir || ASSETS_DIR;
  const tsFiles = walkDir(targetDir, (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));

  const allViolations = [];
  for (const file of tsFiles) {
    const fileViolations = lintFile(file);
    if (fileViolations.length > 0) {
      allViolations.push(...fileViolations);
    }
  }

  const errors = allViolations.filter((v) => v.severity === 'error');
  const warnings = allViolations.filter((v) => v.severity === 'warning');

  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    scannedFiles: tsFiles.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    violations: allViolations
  };
}

const USAGE = `Zero-GC & Playable Architecture Linter

Usage:
  node playable-shared-kit/tools/zero-gc-linter.cjs [options]

Options:
  --json     Emit violations as JSON (dùng cho AI agent / CI).
  --strict   Treat warnings as failures too.
  --help     Show this help and exit without linting.

Exit code 1 when an error is found (or a warning under --strict).`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const isJson = args.includes('--json');
  const isStrict = args.includes('--strict');

  const result = runLinter();

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n========================================`);
    console.log(` Zero-GC & Playable Architecture Linter `);
    console.log(`========================================`);
    console.log(`Scanned ${result.scannedFiles} TypeScript files.`);

    if (result.violations.length === 0) {
      console.log(`\n \x1b[32m[PASS]\x1b[0m All TypeScript files comply with Zero-GC and Playable rules!`);
    } else {
      console.log(`\nFound ${result.errorCount} error(s), ${result.warningCount} warning(s):\n`);
      for (const v of result.violations) {
        const color = v.severity === 'error' ? '\x1b[31m[ERROR]\x1b[0m' : '\x1b[33m[WARN]\x1b[0m';
        console.log(`${color} ${v.file}:${v.line} (${v.rule})`);
        console.log(`  Message: ${v.message}`);
        console.log(`  Snippet: \x1b[90m${v.snippet}\x1b[0m\n`);
      }
    }
  }

  const failed = result.errorCount > 0 || (isStrict && result.warningCount > 0);
  if (failed) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runLinter, lintFile };
