#!/usr/bin/env node
'use strict';


// Bỏ escape ANSI khi output bị pipe (tiết kiệm token cho AI agent).
require('./lib/auto-strip-ansi.cjs');
/**
 * Headless Verification Suite for Cocos Creator Playable Ads
 *
 * Runs comprehensive automated checks without opening the Cocos Editor:
 * 1. TypeScript compilation (tsc --noEmit)
 * 2. Zero-GC & Architecture Linter
 * 3. Scriptable Config schema & presence
 * 4. Config-to-Asset binding verification (audio, textures)
 * 5. Cocos .meta file integrity
 * 6. Build size budget estimation
 * 7. Cocos asset import status (the only check that proves the editor accepted an asset)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runLinter } = require('./zero-gc-linter.cjs');
const { run: runAssetImportCheck } = require('./verify-assets.cjs');

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
const RESOURCES_DIR = path.join(ASSETS_DIR, 'resources');
const CONFIG_FILE = path.join(RESOURCES_DIR, 'playable-config.json');

function checkTypeScript() {
  const result = { name: 'TypeScript Compilation', status: 'PASS', errors: [], details: '' };
  try {
    const tscCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const proc = spawnSync(tscCmd, ['tsc', '--noEmit', '--skipLibCheck'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      shell: true
    });

    if (proc.status !== 0) {
      result.status = 'FAIL';
      const output = (proc.stdout || '') + (proc.stderr || '');
      const lines = output.split(/\r?\n/).filter((l) => l.includes('error TS'));
      result.errors = lines.slice(0, 10);
      result.details = `${lines.length} compiler error(s) found.`;
    } else {
      result.details = 'TypeScript compilation clean (0 errors).';
    }
  } catch (err) {
    result.status = 'WARN';
    result.details = `Could not run tsc: ${err.message}`;
  }
  return result;
}

function checkZeroGC() {
  const lintResult = runLinter();
  const result = {
    name: 'Zero-GC & Playable Rules',
    status: lintResult.errorCount === 0 ? 'PASS' : 'FAIL',
    errors: lintResult.violations.filter((v) => v.severity === 'error').map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`),
    warnings: lintResult.violations.filter((v) => v.severity === 'warning').map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`),
    details: `Scanned ${lintResult.scannedFiles} files: ${lintResult.errorCount} error(s), ${lintResult.warningCount} warning(s).`
  };
  return result;
}

function checkConfigIntegrity() {
  const result = { name: 'Config Schema Integrity', status: 'PASS', errors: [], warnings: [], details: '' };
  if (!fs.existsSync(CONFIG_FILE)) {
    result.status = 'FAIL';
    result.errors.push('Missing assets/resources/playable-config.json');
    return result;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const requiredSections = ['cta', 'audio', 'gameplay', 'camera'];
    for (const sec of requiredSections) {
      if (!raw[sec] || typeof raw[sec] !== 'object') {
        result.status = 'FAIL';
        result.errors.push(`Missing or invalid required section '${sec}' in playable-config.json`);
      }
    }

    if (result.status === 'PASS') {
      result.details = `Config valid with sections: ${Object.keys(raw).join(', ')}`;
    }
  } catch (err) {
    result.status = 'FAIL';
    result.errors.push(`JSON syntax error: ${err.message}`);
  }
  return result;
}

function checkAssetBindings() {
  const result = { name: 'Config Asset Bindings', status: 'PASS', errors: [], warnings: [], details: '' };
  if (!fs.existsSync(CONFIG_FILE)) return result;

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw.audio) {
      const audioKeys = ['bgmSoundPath', 'clickSoundPath', 'successSoundPath', 'winSoundPath'];
      for (const key of audioKeys) {
        const soundPath = raw.audio[key];
        if (soundPath && typeof soundPath === 'string') {
          const exts = ['.mp3', '.ogg', '.wav', '.m4a'];
          const exists = exts.some((ext) => fs.existsSync(path.join(RESOURCES_DIR, `${soundPath}${ext}`)) || fs.existsSync(path.join(RESOURCES_DIR, soundPath)));
          if (!exists) {
            result.warnings.push(`Config audio path '${soundPath}' not found under assets/resources/`);
          }
        }
      }
    }

    if (result.warnings.length > 0) {
      result.details = `${result.warnings.length} unverified asset path(s).`;
    } else {
      result.details = 'All configured asset paths resolved on disk.';
    }
  } catch (err) {
    result.status = 'WARN';
    result.details = `Could not verify assets: ${err.message}`;
  }
  return result;
}

function checkMetaIntegrity() {
  const result = { name: 'Meta Files Integrity', status: 'PASS', errors: [], warnings: [], details: '' };
  if (!fs.existsSync(ASSETS_DIR)) return result;

  function walk(dir) {
    let files = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push({ path: fullPath, isDir: true });
          files = files.concat(walk(fullPath));
        } else {
          files.push({ path: fullPath, isDir: false });
        }
      }
    } catch {}
    return files;
  }

  const allItems = walk(ASSETS_DIR);
  let missingMetaCount = 0;
  let danglingMetaCount = 0;

  for (const item of allItems) {
    if (item.path.endsWith('.d.ts') || item.path.includes('.DS_Store')) continue;
    if (item.path.endsWith('.meta')) {
      const targetPath = item.path.slice(0, -5);
      if (!fs.existsSync(targetPath)) {
        danglingMetaCount++;
        result.warnings.push(`Dangling meta file: ${path.relative(ROOT_DIR, item.path)}`);
      }
    } else {
      const metaPath = `${item.path}.meta`;
      if (!fs.existsSync(metaPath)) {
        missingMetaCount++;
        result.warnings.push(`Missing meta file for: ${path.relative(ROOT_DIR, item.path)}`);
      }
    }
  }

  if (missingMetaCount > 0 || danglingMetaCount > 0) {
    result.details = `${missingMetaCount} missing meta, ${danglingMetaCount} dangling meta found.`;
  } else {
    result.details = `All ${allItems.length} asset entries have valid .meta pairs.`;
  }

  return result;
}

/**
 * Cocos ghi `"imported": false` vào .meta khi importer từ chối asset. Không có
 * check nào khác thấy được điều này: tsc/lint/build đều xanh, playable vẫn trắng.
 */
function checkAssetImport() {
  const report = runAssetImportCheck();
  return {
    name: 'Asset Import Status',
    status: report.status,
    errors: report.errors,
    warnings: report.warnings,
    details: report.details,
  };
}

function checkBuildSize() {
  const result = { name: 'Playable Bundle Size', status: 'PASS', errors: [], warnings: [], details: '' };
  const buildDir = path.join(ROOT_DIR, 'build');
  if (!fs.existsSync(buildDir)) {
    result.details = 'No build/ output folder yet (run npm run build).';
    return result;
  }

  function findHtmlFiles(dir) {
    let htmls = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) htmls = htmls.concat(findHtmlFiles(full));
        else if (entry.name.endsWith('.html')) htmls.push(full);
      }
    } catch {}
    return htmls;
  }

  const htmlFiles = findHtmlFiles(buildDir);
  if (htmlFiles.length === 0) {
    result.details = 'No .html builds found in build/.';
    return result;
  }

  const MAX_SIZE_MB = 6.0;
  const WARN_SIZE_MB = 3.5;

  for (const html of htmlFiles) {
    const stats = fs.statSync(html);
    const sizeMb = Math.round((stats.size / (1024 * 1024)) * 100) / 100;
    const rel = path.relative(ROOT_DIR, html).replace(/\\/g, '/');

    // Skip uncompressed common builds from strict max threshold
    if (rel.includes('/common/')) {
      if (sizeMb > 12.0) {
        result.warnings.push(`Common build ${rel} is ${sizeMb}MB.`);
      }
      continue;
    }

    if (sizeMb > MAX_SIZE_MB) {
      result.status = 'FAIL';
      result.errors.push(`Build ${rel} is ${sizeMb}MB (Exceeds ${MAX_SIZE_MB}MB limit!)`);
    } else if (sizeMb > WARN_SIZE_MB) {
      result.warnings.push(`Build ${rel} is ${sizeMb}MB (Exceeds recommended ${WARN_SIZE_MB}MB limit)`);
    }
  }

  if (result.status === 'PASS') {
    result.details = `Checked ${htmlFiles.length} HTML build(s).`;
  }
  return result;
}

function runVerificationSuite() {
  const checks = [
    checkTypeScript(),
    checkZeroGC(),
    checkConfigIntegrity(),
    checkAssetBindings(),
    checkMetaIntegrity(),
    checkAssetImport(),
    checkBuildSize()
  ];

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const totalErrors = checks.reduce((acc, c) => acc + (c.errors ? c.errors.length : 0), 0);
  const totalWarnings = checks.reduce((acc, c) => acc + (c.warnings ? c.warnings.length : 0), 0);

  return {
    status: hasFail ? 'FAIL' : 'PASS',
    totalChecks: checks.length,
    passedChecks: checks.filter((c) => c.status === 'PASS').length,
    totalErrors,
    totalWarnings,
    checks
  };
}

const USAGE = `Cocos Creator Playable Ads Headless Verifier

Usage:
  node playable-shared-kit/tools/headless-verifier.cjs [options]

Options:
  --json    Emit the full report as JSON (dùng cho AI agent / CI).
  --help    Show this help and exit without running any check.

Checks: TypeScript compilation, Zero-GC rules, config schema, config asset
bindings, .meta integrity, playable bundle size.
Exit code 1 when any check fails.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const isJson = args.includes('--json');

  const report = runVerificationSuite();

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n======================================================`);
    console.log(` Cocos Creator Playable Ads Headless Verifier `);
    console.log(`======================================================`);
    console.log(`Result: ${report.status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} (${report.passedChecks}/${report.totalChecks} checks passed)\n`);

    for (const check of report.checks) {
      const badge = check.status === 'PASS'
        ? '\x1b[32m[PASS]\x1b[0m'
        : (check.status === 'FAIL' ? '\x1b[31m[FAIL]\x1b[0m' : '\x1b[33m[WARN]\x1b[0m');

      console.log(`${badge} ${check.name}: ${check.details}`);
      if (check.errors && check.errors.length > 0) {
        for (const err of check.errors.slice(0, 5)) {
          console.log(`    \x1b[31m- ${err}\x1b[0m`);
        }
      }
      if (check.warnings && check.warnings.length > 0) {
        for (const warn of check.warnings.slice(0, 3)) {
          console.log(`    \x1b[33m- ${warn}\x1b[0m`);
        }
      }
    }
    console.log(`\n======================================================\n`);
  }

  if (report.status === 'FAIL') {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runVerificationSuite };
