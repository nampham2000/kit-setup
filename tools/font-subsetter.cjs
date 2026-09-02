#!/usr/bin/env node
'use strict';

require('./lib/auto-strip-ansi.cjs');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectFontBuffer } = require('./resource-stats/font-inspector.cjs');

const DEFAULT_CONFIG = 'tools/font-subsets.json';
const DEFAULT_TARGET_BYTES = 80 * 1024;
const DEFAULT_MAX_BYTES = 100 * 1024;
const DEFAULT_PRESERVE_NAME_IDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 16, 17]);
const BASIC_LATIN = Array.from({ length: 0x7f - 0x20 }, (_, index) => String.fromCodePoint(0x20 + index)).join('');

const USAGE = `Portable Font Subsetter

Usage:
  npm run font:subset -- --config tools/font-subsets.json --unity-project <UnityProjectRoot>
  npm run font:subset -- --config tools/font-subsets.json --unity-project <UnityProjectRoot> --write
  npm run font:subset -- --config tools/font-subsets.json --unity-project <UnityProjectRoot> --check
  npm run font:subset -- --config tools/font-subsets.json --verify

Options:
  --config <path>          Project-relative manifest (default: tools/font-subsets.json).
  --project-root <path>    Cocos project root (default: current directory).
  --unity-project <path>   Unity project root for source.root="unity" entries.
  --write                  Generate and atomically replace changed subset outputs.
  --check                  Read-only byte comparison against freshly generated subsets.
  --verify                 Read-only size, SHA-256 and glyph-coverage verification.
  --json                   Emit JSON.
  --help                   Print this usage without reading project files.

Manifest rules:
  - Paths are relative to their declared root; absolute paths are rejected.
  - preset="basic-latin" keeps printable U+0020-U+007E.
  - targetBytes defaults to 80 KiB; maxBytes defaults to a hard 100 KiB gate.
  - source.sha256 binds generation to the original source font.
  - expectedOutputSha256 makes --verify/--check fail on output drift.
  - The Cocos .meta file is never edited; --write verifies its hash is unchanged.`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const options = {
    mode: 'audit',
    config: DEFAULT_CONFIG,
    projectRoot: process.cwd(),
    unityProject: '',
    json: false,
    help: false,
  };
  let explicitMode = '';
  const takeValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--config') options.config = takeValue(index++, arg);
    else if (arg === '--project-root') options.projectRoot = takeValue(index++, arg);
    else if (arg === '--unity-project') options.unityProject = takeValue(index++, arg);
    else if (['--write', '--check', '--verify'].includes(arg)) {
      const mode = arg.slice(2);
      if (explicitMode && explicitMode !== mode) throw new Error(`Conflicting modes: --${explicitMode} and ${arg}.`);
      explicitMode = mode;
      options.mode = mode;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function resolveWithin(root, relativePath, label) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel || path.isAbsolute(rel)) throw new Error(`${label} must be a non-empty relative path.`);
  const base = path.resolve(root);
  const resolved = path.resolve(base, rel);
  const prefix = `${base}${path.sep}`;
  if (resolved !== base && !resolved.startsWith(prefix)) throw new Error(`${label} escapes its declared root: ${rel}`);
  return resolved;
}

function uniqueCharacters(value) {
  return [...new Set(Array.from(String(value || ''))) ].join('');
}

function charactersForEntry(entry) {
  let characters = '';
  if (entry.preset === 'basic-latin') characters += BASIC_LATIN;
  else if (entry.preset) throw new Error(`${entry.id}: unsupported preset ${JSON.stringify(entry.preset)}.`);
  for (const text of entry.requiredTexts || []) characters += String(text);
  characters += String(entry.extraCharacters || '');
  const result = uniqueCharacters(characters);
  if (!result) throw new Error(`${entry.id}: no characters were declared.`);
  return result;
}

function readManifest(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const configPath = resolveWithin(projectRoot, options.config, '--config');
  const manifest = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.schemaVersion !== 1) throw new Error('Font subset manifest schemaVersion must be 1.');
  if (!Array.isArray(manifest.fonts) || manifest.fonts.length === 0) throw new Error('Font subset manifest requires a non-empty fonts array.');
  const ids = new Set();
  for (const entry of manifest.fonts) {
    if (!entry || typeof entry !== 'object' || !String(entry.id || '').trim()) throw new Error('Every font subset entry requires an id.');
    if (ids.has(entry.id)) throw new Error(`Duplicate font subset id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.source || typeof entry.source !== 'object') throw new Error(`${entry.id}: source is required.`);
    if (!['project', 'unity'].includes(entry.source.root)) throw new Error(`${entry.id}: source.root must be "project" or "unity".`);
    if (!entry.output) throw new Error(`${entry.id}: output is required.`);
    charactersForEntry(entry);
  }
  return { projectRoot, configPath, manifest };
}

function resolveSource(entry, context, requireSource) {
  const root = entry.source.root === 'unity'
    ? (context.unityRoot || '')
    : context.projectRoot;
  if (!root) {
    if (!requireSource) return null;
    throw new Error(`${entry.id}: --unity-project is required to generate this subset.`);
  }
  return resolveWithin(root, entry.source.path, `${entry.id}.source.path`);
}

function inspectCandidate(entry, buffer, characters) {
  const targetBytes = Number(entry.targetBytes || DEFAULT_TARGET_BYTES);
  const maxBytes = Number(entry.maxBytes || DEFAULT_MAX_BYTES);
  if (!Number.isInteger(targetBytes) || targetBytes <= 0) throw new Error(`${entry.id}: targetBytes must be a positive integer.`);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes < targetBytes) throw new Error(`${entry.id}: maxBytes must be an integer >= targetBytes.`);
  const inspection = inspectFontBuffer(buffer, characters, { ext: '.ttf' });
  const missingGlyphs = inspection.requiredCharacterCount - inspection.requiredGlyphs;
  const errors = [];
  if (buffer.length > maxBytes) errors.push(`size ${buffer.length} exceeds hard max ${maxBytes}`);
  if (inspection.error) errors.push(inspection.error);
  if (missingGlyphs > 0) errors.push(`${missingGlyphs} declared glyph(s) are missing`);
  return {
    size: buffer.length,
    targetBytes,
    maxBytes,
    withinTarget: buffer.length <= targetBytes,
    withinMax: buffer.length <= maxBytes,
    sha256: sha256(buffer),
    glyphCount: inspection.glyphCount,
    requiredCharacterCount: inspection.requiredCharacterCount,
    requiredGlyphs: inspection.requiredGlyphs,
    scripts: inspection.scripts,
    errors,
  };
}

function loadSubsetFont(dependencies = {}) {
  if (dependencies.subsetFont) return dependencies.subsetFont;
  try {
    return require('subset-font');
  } catch (error) {
    const wrapped = new Error('Missing dependency subset-font. Run npm ci on a clean checkout before --write or --check.');
    wrapped.cause = error;
    throw wrapped;
  }
}

async function generateEntry(entry, context, dependencies) {
  const sourcePath = resolveSource(entry, context, true);
  const source = fs.readFileSync(sourcePath);
  const sourceHash = sha256(source);
  if (entry.source.sha256 && sourceHash !== String(entry.source.sha256).toLowerCase()) {
    throw new Error(`${entry.id}: source SHA-256 mismatch (${sourceHash}).`);
  }
  const characters = charactersForEntry(entry);
  const subsetFont = loadSubsetFont(dependencies);
  const buffer = await subsetFont(source, characters, {
    targetFormat: 'sfnt',
    preserveNameIds: Array.isArray(entry.preserveNameIds) ? entry.preserveNameIds : DEFAULT_PRESERVE_NAME_IDS,
    noHinting: entry.noHinting === true,
    ...(Array.isArray(entry.keepFeatures) ? { keepFeatures: entry.keepFeatures } : {}),
    ...(Array.isArray(entry.dropTables) ? { dropTables: entry.dropTables } : {}),
  });
  const candidate = Buffer.from(buffer);
  const inspection = inspectCandidate(entry, candidate, characters);
  if (inspection.errors.length) throw new Error(`${entry.id}: invalid generated subset: ${inspection.errors.join('; ')}.`);
  if (entry.expectedOutputSha256 && inspection.sha256 !== String(entry.expectedOutputSha256).toLowerCase()) {
    throw new Error(`${entry.id}: generated output SHA-256 drift (${inspection.sha256}).`);
  }
  return { sourcePath, sourceHash, characters, candidate, inspection };
}

function verifyOutput(entry, context) {
  const outputPath = resolveWithin(context.projectRoot, entry.output, `${entry.id}.output`);
  if (!fs.existsSync(outputPath)) throw new Error(`${entry.id}: output does not exist: ${entry.output}`);
  const buffer = fs.readFileSync(outputPath);
  const characters = charactersForEntry(entry);
  const inspection = inspectCandidate(entry, buffer, characters);
  if (entry.expectedOutputSha256 && inspection.sha256 !== String(entry.expectedOutputSha256).toLowerCase()) {
    inspection.errors.push(`output SHA-256 mismatch (${inspection.sha256})`);
  }
  return { outputPath, characters, inspection };
}

function atomicWrite(outputPath, buffer) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.font-subset-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, outputPath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

async function run(options, dependencies = {}) {
  const { projectRoot, configPath, manifest } = readManifest(options);
  const context = {
    projectRoot,
    unityRoot: options.unityProject ? path.resolve(options.unityProject) : '',
  };
  const results = [];
  for (const entry of manifest.fonts) {
    const outputPath = resolveWithin(projectRoot, entry.output, `${entry.id}.output`);
    const metaPath = `${outputPath}.meta`;
    const metaHashBefore = fs.existsSync(metaPath) ? sha256(fs.readFileSync(metaPath)) : null;
    try {
      if (options.mode === 'verify') {
        const verified = verifyOutput(entry, context);
        results.push({
          id: entry.id,
          status: verified.inspection.errors.length ? 'failed' : 'verified',
          output: entry.output,
          ...verified.inspection,
        });
        continue;
      }

      const generated = await generateEntry(entry, context, dependencies);
      const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : null;
      const identical = Boolean(current && current.equals(generated.candidate));
      if (options.mode === 'check' && !identical) {
        results.push({ id: entry.id, status: 'stale', output: entry.output, ...generated.inspection });
        continue;
      }
      if (options.mode === 'write' && !identical) atomicWrite(outputPath, generated.candidate);
      const metaHashAfter = fs.existsSync(metaPath) ? sha256(fs.readFileSync(metaPath)) : null;
      if (metaHashBefore !== metaHashAfter) throw new Error(`${entry.id}: Cocos .meta changed during font subsetting.`);
      results.push({
        id: entry.id,
        status: options.mode === 'write' ? (identical ? 'unchanged' : 'written') : (identical ? 'current' : 'would-write'),
        source: entry.source.path,
        sourceSha256: generated.sourceHash,
        output: entry.output,
        metaPreserved: metaHashBefore === metaHashAfter,
        ...generated.inspection,
      });
    } catch (error) {
      results.push({ id: entry.id, status: 'failed', output: entry.output, errors: [error.message] });
    }
  }
  const failureStatuses = new Set(['failed', 'stale']);
  const ok = results.every((result) => !failureStatuses.has(result.status) && (!result.errors || result.errors.length === 0));
  return {
    ok,
    mode: options.mode,
    config: path.relative(projectRoot, configPath).replace(/\\/g, '/'),
    targetBytes: DEFAULT_TARGET_BYTES,
    maxBytes: DEFAULT_MAX_BYTES,
    results,
  };
}

function printReport(report, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  console.log(`[font-subsetter] ${report.ok ? 'PASS' : 'FAIL'} (${report.mode})`);
  if (report.error) console.log(`  - ${report.error}`);
  for (const item of report.results || []) {
    const size = Number.isFinite(item.size) ? `${(item.size / 1024).toFixed(1)} KiB` : 'n/a';
    console.log(`  ${item.id}: ${item.status}, ${size}, glyphs ${item.requiredGlyphs ?? 0}/${item.requiredCharacterCount ?? 0}`);
    for (const error of item.errors || []) console.log(`    - ${error}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[font-subsetter] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const report = await run(options);
    printReport(report, options.json);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    const report = { ok: false, mode: options.mode, error: error.message };
    printReport(report, options.json);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  BASIC_LATIN,
  DEFAULT_MAX_BYTES,
  DEFAULT_TARGET_BYTES,
  charactersForEntry,
  inspectCandidate,
  parseArgs,
  run,
};
