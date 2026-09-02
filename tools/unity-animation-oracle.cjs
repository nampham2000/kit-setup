#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseUnityAnimationClipForOracle } = require('./unity-cocos-port.cjs');

const USAGE = `Unity Animation Curve Oracle

Usage:
  node playable-shared-kit/tools/unity-animation-oracle.cjs --src <file.anim|directory> [options]

Options:
  --src <path>          Unity .anim file or directory (required; repeatable).
  --unity-root <path>   Unity project root or Assets folder used for portable source paths.
  --out <file>          Atomically write the oracle JSON. Without this flag, print it to stdout.
  --max-clips <n>       Fail when more than n clips are selected. Default: 128.
  --compact             Minified JSON output.
  --help                Show this help.

The oracle reports Cocos-target values after Unity handedness conversion while
retaining exact node path, property, component, key time/value, Hermite tangent,
active-state and loop/wrap data. Run Unity port preflight before using source evidence.
`;

function fail(message, code = 'ANIMATION_ORACLE_ERROR') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const options = { sources: [], unityRoot: '', out: '', maxClips: 128, compact: false, help: false };
  const value = (name, index) => {
    if (!argv[index + 1] || String(argv[index + 1]).startsWith('--')) fail(`Missing value for ${name}`, 'ANIMATION_ORACLE_ARGS');
    return argv[index + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--compact') { options.compact = true; continue; }
    if (arg === '--src') { options.sources.push(value(arg, i)); i += 1; continue; }
    if (arg.startsWith('--src=')) { options.sources.push(arg.slice(6)); continue; }
    if (arg === '--unity-root') { options.unityRoot = value(arg, i); i += 1; continue; }
    if (arg.startsWith('--unity-root=')) { options.unityRoot = arg.slice(13); continue; }
    if (arg === '--out') { options.out = value(arg, i); i += 1; continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice(6); continue; }
    if (arg === '--max-clips') { options.maxClips = Number(value(arg, i)); i += 1; continue; }
    if (arg.startsWith('--max-clips=')) { options.maxClips = Number(arg.slice(12)); continue; }
    fail(`Unknown option: ${arg}`, 'ANIMATION_ORACLE_ARGS');
  }
  if (!Number.isInteger(options.maxClips) || options.maxClips < 1 || options.maxClips > 4096) {
    fail('--max-clips must be an integer in 1..4096', 'ANIMATION_ORACLE_ARGS');
  }
  return options;
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collectAnimFiles(source, limit) {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) fail(`Source not found: ${source}`, 'ANIMATION_ORACLE_SOURCE_MISSING');
  const files = [];
  const visit = current => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`Symlink source is not allowed: ${current}`, 'ANIMATION_ORACLE_SOURCE_BOUNDARY');
    if (stat.isFile()) {
      if (path.extname(current).toLowerCase() === '.anim') files.push(current);
      if (files.length > limit) fail(`Selected more than --max-clips=${limit}`, 'ANIMATION_ORACLE_LIMIT');
      return;
    }
    if (!stat.isDirectory()) return;
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) visit(path.join(current, entry.name));
  };
  visit(resolved);
  if (!files.length) fail(`No .anim files found under: ${source}`, 'ANIMATION_ORACLE_SOURCE_EMPTY');
  return files.sort((a, b) => a.localeCompare(b));
}

function portableSourcePath(file, unityRoot) {
  if (!unityRoot) return path.basename(file);
  const root = fs.realpathSync(path.resolve(unityRoot));
  const target = fs.realpathSync(file);
  if (!contained(root, target)) fail(`Animation escapes --unity-root: ${file}`, 'ANIMATION_ORACLE_SOURCE_BOUNDARY');
  let relative = path.relative(root, target).replace(/\\/g, '/');
  if (path.basename(root).toLowerCase() === 'assets') relative = `Assets/${relative}`;
  return relative;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function yamlSectionHasData(text, key) {
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trimStart();
    if (!trimmed.startsWith(`${key}:`)) continue;
    const inline = trimmed.slice(key.length + 1).trim();
    if (inline === '[]' || inline === '{}' || inline === 'null') return false;
    if (inline) return true;
    const baseIndent = lines[index].length - trimmed.length;
    for (let next = index + 1; next < lines.length; next++) {
      if (!lines[next].trim()) continue;
      const indent = lines[next].match(/^\s*/)[0].length;
      if (indent < baseIndent) return false;
      if (indent === baseIndent && !lines[next].trim().startsWith('- ')) return false;
      return true;
    }
    return false;
  }
  return false;
}

function yamlListEntries(text, key) {
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)([^:]+):\s*(.*)$/.exec(lines[index]);
    if (!match || match[2].trim() !== key) continue;
    const inline = match[3].trim();
    if (inline === '[]' || inline === '{}' || inline === 'null') return [];
    const baseIndent = match[1].length;
    const block = [];
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      if (!line.trim()) {
        if (block.length) block.push(line);
        continue;
      }
      const indent = line.match(/^\s*/)[0].length;
      const trimmed = line.trimStart();
      if (indent < baseIndent || (indent === baseIndent && !trimmed.startsWith('- '))) break;
      block.push(line);
    }
    const first = block.find(line => /^\s*-\s+/.test(line));
    if (!first) return [];
    const itemIndent = first.match(/^\s*/)[0].length;
    const entries = [];
    let current = null;
    for (const line of block) {
      const indent = line.match(/^\s*/)[0].length;
      if (indent === itemIndent && /^\s*-\s+/.test(line)) {
        if (current) entries.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    }
    if (current) entries.push(current);
    return entries;
  }
  return [];
}

function parseYamlScalar(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function parseInlineMap(raw) {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('{') || !value.endsWith('}')) return parseYamlScalar(value);
  const map = {};
  for (const field of value.slice(1, -1).split(',')) {
    const separator = field.indexOf(':');
    if (separator < 0) continue;
    const key = field.slice(0, separator).trim();
    if (!key) continue;
    map[key] = parseYamlScalar(field.slice(separator + 1));
  }
  return map;
}

function readYamlEntryField(lines, key, fallback) {
  const pattern = new RegExp(`^\\s*(?:-\\s*)?${key}\\s*:\\s*(.*)$`);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) return parseYamlScalar(match[1]);
  }
  return fallback;
}

function parseUnityAnimationEvents(text) {
  const entries = yamlListEntries(text, 'm_Events');
  const events = [];
  const errors = [];
  for (let index = 0; index < entries.length; index++) {
    const lines = entries[index];
    const time = Number(readYamlEntryField(lines, 'time', Number.NaN));
    const functionName = String(readYamlEntryField(lines, 'functionName', '') || '');
    if (!Number.isFinite(time) || !functionName) {
      errors.push(`event[${index}] requires a finite time and non-empty functionName`);
      continue;
    }
    const event = {
      time,
      functionName,
      data: String(readYamlEntryField(lines, 'data', '') ?? ''),
      objectReferenceParameter: {},
      floatParameter: Number(readYamlEntryField(lines, 'floatParameter', 0) || 0),
      intParameter: Number(readYamlEntryField(lines, 'intParameter', 0) || 0),
      messageOptions: Number(readYamlEntryField(lines, 'messageOptions', 0) || 0),
    };
    const objectLine = lines.find(line => /^\s*objectReferenceParameter\s*:/.test(line));
    if (objectLine) {
      const raw = objectLine.slice(objectLine.indexOf(':') + 1);
      event.objectReferenceParameter = parseInlineMap(raw);
    }
    events.push(event);
  }
  return { events, errors, sourceEntryCount: entries.length };
}

function bindingInfo(track) {
  const hierarchy = [];
  let component = '';
  let property = '';
  for (const item of track?._binding?.path?._paths || []) {
    if (typeof item === 'string') property = item;
    else if (item?.__type__ === 'cc.animation.HierarchyPath') hierarchy.push(item.path);
    else if (item?.__type__ === 'cc.animation.ComponentPath') component = item.component;
  }
  return { path: hierarchy.join('/'), component, property };
}

function compactRealCurve(curve) {
  const times = curve?._times || [];
  const values = curve?._values || [];
  return times.map((time, index) => {
    const source = values[index];
    if (!source || typeof source !== 'object') return { time, value: Number(source) || 0 };
    const key = { time, value: Number(source.value) || 0 };
    if (source.interpolationMode !== undefined) key.interpolationMode = source.interpolationMode;
    if (source.leftTangent !== undefined) key.inSlope = source.leftTangent;
    if (source.rightTangent !== undefined) key.outSlope = source.rightTangent;
    if (source.tangentWeightMode !== undefined) key.weightedMode = source.tangentWeightMode;
    if (source.leftTangentWeight !== undefined) key.inWeight = source.leftTangentWeight;
    if (source.rightTangentWeight !== undefined) key.outWeight = source.rightTangentWeight;
    return key;
  });
}

function compactObjectCurve(curve) {
  return (curve?._times || []).map((time, index) => ({ time, value: curve._values[index] }));
}

function channelChanged(keys) {
  if (keys.length < 2) return keys.some(key => Math.abs(Number(key.inSlope) || 0) > 1e-9
    || Math.abs(Number(key.outSlope) || 0) > 1e-9);
  const first = keys[0].value;
  return keys.some(key => key.value !== first
    || Math.abs(Number(key.inSlope) || 0) > 1e-9
    || Math.abs(Number(key.outSlope) || 0) > 1e-9);
}

function trackOracle(track) {
  const binding = bindingInfo(track);
  if (track.__type__ === 'cc.animation.ObjectTrack') {
    const keys = compactObjectCurve(track._channel?._curve);
    return { ...binding, type: 'object', animated: channelChanged(keys), keys };
  }
  const names = track.__type__ === 'cc.animation.ColorTrack'
    ? ['r', 'g', 'b', 'a']
    : track.__type__ === 'cc.animation.SizeTrack'
      ? ['width', 'height']
      : ['x', 'y', 'z', 'w'];
  const channels = {};
  const animatedChannels = [];
  for (let index = 0; index < (track._channels || []).length; index++) {
    const keys = compactRealCurve(track._channels[index]?._curve);
    if (!keys.length) continue;
    const name = names[index] || String(index);
    channels[name] = keys;
    if (channelChanged(keys)) animatedChannels.push(name);
  }
  return { ...binding, type: track.__type__, animatedChannels, channels };
}

function buildOracle(files, unityRoot) {
  const diagnostics = [];
  const clips = files.map(file => {
    const source = portableSourcePath(file, unityRoot);
    let incomplete = false;
    const report = (severity, code, target, message, detail = '') => {
      if (severity === 'high') incomplete = true;
      if (diagnostics.length >= 64) return;
      diagnostics.push({ severity, code, source, target, message, detail });
    };
    const reporter = {
      low(code, _file, target, message, detail) {
        const severity = /(?:_SKIPPED|_UNSUPPORTED)$/.test(String(code)) ? 'high' : 'low';
        report(severity, code, target, message, detail || '');
      },
    };
    const clip = parseUnityAnimationClipForOracle(file, reporter);
    if (!clip) fail(`Unable to parse Unity AnimationClip: ${file}`, 'ANIMATION_ORACLE_PARSE_FAILED');
    const raw = fs.readFileSync(file, 'utf8');
    const animationEvents = parseUnityAnimationEvents(raw);
    if (animationEvents.errors.length) {
      report('high', 'ANIMATION_EVENT_PARSE_FAILED', clip._name,
        'Unity animation events could not be represented completely in the portable oracle.',
        animationEvents.errors.join('; '));
    }
    const unsupportedSections = [
      ['m_CompressedRotationCurves', 'ANIMATION_COMPRESSED_ROTATION_CURVE_SKIPPED',
        'Compressed quaternion curves are not represented in the portable oracle.'],
      ['m_PPtrCurves', 'ANIMATION_PPTR_CURVE_SKIPPED',
        'Object-reference curves are not represented in the portable oracle.'],
    ];
    for (const [section, code, message] of unsupportedSections) {
      if (yamlSectionHasData(raw, section)) report('high', code, clip._name, message);
    }
    const tracks = (clip._tracks || []).map(trackOracle)
      .sort((a, b) => `${a.path}\0${a.component}\0${a.property}`.localeCompare(`${b.path}\0${b.component}\0${b.property}`));
    return {
      source,
      sha256: sha256File(file),
      name: clip._name,
      duration: clip._duration,
      sampleRate: clip.sample,
      loop: clip.wrapMode === 2,
      wrapMode: clip.wrapMode,
      completeness: incomplete ? 'partial' : 'complete',
      events: animationEvents.events,
      tracks,
    };
  });
  return {
    schemaVersion: 1,
    kind: 'unity-animation-curve-oracle',
    valueSpace: 'cocos-target',
    coordinateRemap: {
      position: { x: 'x', y: 'y', z: '-z' },
      scale: { x: 'x', y: 'y', z: 'z' },
      eulerAngles: { x: '-x', y: 'y', z: 'z' },
    },
    clipCount: clips.length,
    completeness: clips.every(clip => clip.completeness === 'complete') ? 'complete' : 'partial',
    clips,
    diagnostics,
  };
}

function writeAtomic(file, text) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text, 'utf8');
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  return target;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(USAGE); return null; }
  if (!options.sources.length) fail('Missing --src <file.anim|directory>', 'ANIMATION_ORACLE_ARGS');
  const files = [...new Set(options.sources.flatMap(source => collectAnimFiles(source, options.maxClips)))]
    .sort((a, b) => a.localeCompare(b));
  if (files.length > options.maxClips) {
    fail(`Selected more than --max-clips=${options.maxClips}`, 'ANIMATION_ORACLE_LIMIT');
  }
  const oracle = buildOracle(files, options.unityRoot);
  const text = `${JSON.stringify(oracle, null, options.compact ? 0 : 2)}\n`;
  if (!options.out) {
    process.stdout.write(text);
    if (oracle.completeness !== 'complete') process.exitCode = 2;
    return oracle;
  }
  const target = writeAtomic(options.out, text);
  const receipt = {
    ok: oracle.completeness === 'complete',
    clipCount: oracle.clipCount,
    completeness: oracle.completeness,
    output: path.relative(process.cwd(), target).replace(/\\/g, '/') || path.basename(target),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 2;
  return receipt;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`[unity-animation-oracle] ${error.code || 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildOracle, collectAnimFiles, main, parseArgs, trackOracle, yamlSectionHasData };
