#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NORMALIZER_SCRIPT = path.join(__dirname, 'fbx-normalizer', 'blender-fbx-normalize.py');

function blenderCandidates(explicit = '') {
  const home = os.homedir();
  return [
    explicit,
    process.env.BLENDER_PATH || '',
    process.platform === 'win32' ? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe' : '',
    process.platform === 'win32' ? 'D:\\Tools\\Blender 5.2\\blender.exe' : '',
    process.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : '',
    process.platform === 'linux' ? '/usr/bin/blender' : '',
    process.platform === 'linux' ? '/usr/local/bin/blender' : '',
    path.join(home, 'blender', process.platform === 'win32' ? 'blender.exe' : 'blender'),
  ].filter(Boolean);
}

function resolveBlender(explicit = '') {
  return blenderCandidates(explicit).find((candidate) => fs.existsSync(candidate)) || '';
}

function isFbxFile(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 64) return false;
  const header = Buffer.alloc(23);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  const text = header.toString('ascii');
  return text.startsWith('Kaydara FBX Binary') || text.startsWith('; FBX') || text.includes('FBX');
}

function parseReceipt(output) {
  const line = String(output || '').split(/\r?\n/).find((entry) => entry.startsWith('FBX_NORMALIZE_RESULT='));
  if (!line) return null;
  try { return JSON.parse(line.slice('FBX_NORMALIZE_RESULT='.length)); } catch { return null; }
}

function normalizeFbx(source, destination, options = {}) {
  const src = path.resolve(source);
  const out = path.resolve(destination);
  if (path.extname(src).toLowerCase() !== '.fbx' || path.extname(out).toLowerCase() !== '.fbx') {
    throw new Error('FBX normalizer accepts only .fbx source and destination files.');
  }
  if (!isFbxFile(src)) throw new Error(`Source is not a readable FBX file: ${src}`);

  const blender = resolveBlender(options.blender);
  if (!blender) throw new Error('Blender 4.2+ or 5.x is required for the FBX-to-FBX normalization fallback. Set BLENDER_PATH when installed elsewhere.');
  if (options.dryRun) return { ok: true, dryRun: true, blender, source: src, destination: out, format: 'fbx' };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const samePath = src.toLowerCase() === out.toLowerCase();
  const temporary = samePath
    ? path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.${Date.now()}.normalized.fbx`)
    : out;
  const mode = options.mode || 'preserve';
  if (!['preserve', 'static'].includes(mode)) throw new Error("FBX normalization mode must be 'preserve' or 'static'.");
  const preserveAnchors = Array.isArray(options.preserveAnchors) ? options.preserveAnchors : [];
  if (preserveAnchors.some((name) => !name) || new Set(preserveAnchors).size !== preserveAnchors.length) {
    throw new Error('--preserve-anchor values must be non-empty and unique.');
  }
  if (preserveAnchors.length > 0 && mode !== 'static') {
    throw new Error('--preserve-anchor is valid only with --mode static.');
  }
  const run = spawnSync(blender, [
    '--background', '--factory-startup', '--python', NORMALIZER_SCRIPT,
    '--', src, temporary, mode, JSON.stringify(preserveAnchors),
  ], {
    cwd: path.dirname(src),
    encoding: 'utf8',
    windowsHide: true,
    timeout: Math.max(30_000, Number(options.timeoutMs) || 180_000),
    maxBuffer: 2 * 1024 * 1024,
  });
  const combined = `${run.stdout || ''}\n${run.stderr || ''}`;
  if (run.status !== 0 || !isFbxFile(temporary)) {
    if (temporary !== out && fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw new Error(`Blender FBX normalization failed (exit ${run.status ?? 'unknown'}): ${combined.trim().split(/\r?\n/).slice(-12).join(' | ')}`);
  }
  const receipt = parseReceipt(combined) || {};
  if (samePath) fs.renameSync(temporary, out);
  return {
    ok: true,
    dryRun: false,
    blender,
    source: src,
    destination: out,
    bytes: fs.statSync(out).size,
    format: 'fbx',
    mode,
    scene: receipt.scene || null,
    preservedAnchors: receipt.preservedAnchors || [],
  };
}

function parseArgs(argv) {
  const options = { source: '', destination: '', blender: '', mode: 'preserve', preserveAnchors: [], dryRun: false, verify: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--src') options.source = argv[++i] || '';
    else if (arg === '--out') options.destination = argv[++i] || '';
    else if (arg === '--blender') options.blender = argv[++i] || '';
    else if (arg === '--mode') options.mode = argv[++i] || '';
    else if (arg === '--preserve-anchor') options.preserveAnchors.push(argv[++i] || '');
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node tools/fbx-normalizer.cjs --src <Unity.fbx> --out <Cocos.fbx> [options]',
    '',
    'Normalizes FBX to FBX when Cocos Creator rejects the original Unity FBX.',
    'No glTF or GLB file is produced.',
    '',
    'Options:',
    '  --blender <path>  Explicit Blender executable (otherwise BLENDER_PATH/common locations).',
    '  --mode <value>    preserve (default) or static. Static removes armature data only when runtime does not use it.',
    '  --preserve-anchor <name>  In static mode, bake local-Y scale into a morph target plus anchor node (repeatable).',
    '  --dry-run         Validate inputs and dependency without writing.',
    '  --verify          Verify the destination is a readable FBX.',
    '  --json            Machine-readable output.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return 0; }
  if (!options.source || !options.destination) throw new Error('--src and --out are required.');
  if (options.verify) {
    const result = { ok: isFbxFile(path.resolve(options.destination)), destination: path.resolve(options.destination), format: 'fbx' };
    if (options.json) console.log(JSON.stringify(result, null, 2)); else console.log(result.ok ? '[ok] FBX output is readable.' : '[fail] FBX output is missing or invalid.');
    return result.ok ? 0 : 1;
  }
  const result = normalizeFbx(options.source, options.destination, options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`[ok] FBX normalized to FBX: ${result.destination}${result.scene ? ` (${result.scene.meshes} mesh, ${result.scene.vertices} vertices)` : ''}`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`[fbx-normalizer] ${error?.message || error}`); process.exitCode = 1; }
}

module.exports = { blenderCandidates, resolveBlender, isFbxFile, parseReceipt, normalizeFbx, parseArgs, main };
