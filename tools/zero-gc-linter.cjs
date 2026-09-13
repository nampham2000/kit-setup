#!/usr/bin/env node
'use strict';


// Bỏ escape ANSI khi output bị pipe (tiết kiệm token cho AI agent).
require('./lib/auto-strip-ansi.cjs');
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
const ts = require('typescript');
const { lintCocosComponentModules } = require('./cocos-component-module-linter.cjs');

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

  // 3. resources.load('x') yêu cầu x nằm dưới assets/resources/
  violations.push(...lintResourcePaths(relPath, lines));

  // 4. Cocos 3.8.2+ moved Label outline/shadow state onto Label itself.
  // Keeping the legacy Components emits a warning for every property write and
  // leaves new ports depending on compatibility proxies that may disappear.
  violations.push(...lintDeprecatedCocosLabelEffects(relPath, filePath, content));

  return violations;
}

const DEPRECATED_LABEL_EFFECT_EXPORTS = new Set(['LabelOutline', 'LabelShadow']);

function lintDeprecatedCocosLabelEffects(relPath, filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const ccNamespaces = new Set();

  const addViolation = (node, exportName) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push({
      file: relPath,
      line,
      rule: 'DEPRECATED_COCOS_LABEL_EFFECT_COMPONENT',
      severity: 'error',
      message: `${exportName} is deprecated in Cocos Creator 3.8.2+. Configure Label.enableOutline/outlineColor/outlineWidth or Label.enableShadow/shadowColor/shadowOffset/shadowBlur directly instead.`,
      snippet: sourceFile.text.slice(node.getStart(sourceFile), node.getEnd()).trim(),
    });
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== 'cc'
      || !statement.importClause?.namedBindings) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(bindings)) {
      ccNamespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const exportName = (element.propertyName || element.name).text;
      if (DEPRECATED_LABEL_EFFECT_EXPORTS.has(exportName)) {
        addViolation(element, exportName);
      }
    }
  }

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && ccNamespaces.has(node.expression.text)
      && DEPRECATED_LABEL_EFFECT_EXPORTS.has(node.name.text)) {
      addViolation(node, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return violations;
}

/** Hậu tố sub-asset mà Cocos thêm vào đường dẫn khi load (foo.png -> foo/texture). */
const SUBASSET_SUFFIXES = new Set(['texture', 'spriteFrame', 'mesh', 'skeleton', 'material', 'animation']);

const RESOURCE_LOAD_RE = /\bresources\s*\.\s*(load|loadDir|preload|preloadDir)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`$]+)\2/g;

/**
 * Asset chỉ được nạp bằng chuỗi lúc runtime phải nằm dưới assets/resources/.
 * Ở nơi khác trong assets/, builder loại nó khỏi bundle vì không scene/prefab nào
 * tham chiếu — build vẫn exit 0 và playable ra màn hình trắng.
 */
function lintResourcePaths(relPath, lines) {
  const violations = [];
  const resourcesDir = path.join(ROOT_DIR, 'assets', 'resources');
  if (!fs.existsSync(resourcesDir)) return violations;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    RESOURCE_LOAD_RE.lastIndex = 0;
    let m;
    while ((m = RESOURCE_LOAD_RE.exec(lines[i]))) {
      const assetPath = m[3];
      if (resolvesUnderResources(resourcesDir, assetPath)) continue;
      violations.push({
        file: relPath,
        line: i + 1,
        rule: 'RESOURCE_PATH_NOT_FOUND',
        severity: 'error',
        message: `resources.${m[1]}('${assetPath}') không khớp file nào dưới assets/resources/. Asset nạp bằng chuỗi phải nằm trong resources/, nếu không builder sẽ loại khỏi bundle (build vẫn thành công, runtime trắng màn hình).`,
        snippet: trimmed,
      });
    }
  }
  return violations;
}

function resolvesUnderResources(resourcesDir, assetPath) {
  const candidates = [assetPath];
  const parts = assetPath.split('/');
  if (parts.length > 1 && SUBASSET_SUFFIXES.has(parts[parts.length - 1])) {
    candidates.push(parts.slice(0, -1).join('/'));
  }
  for (const candidate of candidates) {
    const full = path.join(resourcesDir, candidate);
    if (fs.existsSync(full)) return true;              // thư mục, hoặc file đúng tên
    const dir = path.dirname(full);
    const base = path.basename(full);
    let entries;
    try { entries = fs.readdirSync(dir); } catch (e) { continue; }
    // Cocos bỏ phần mở rộng trong đường dẫn resources.
    if (entries.some((n) => n === base || n.startsWith(base + '.'))) return true;
  }
  return false;
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
  allViolations.push(...lintCocosComponentModules(tsFiles, { projectRoot: ROOT_DIR }));

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
