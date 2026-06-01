#!/usr/bin/env node
'use strict';

/**
 * Unity HLSL/ShaderLab -> Cocos Creator .effect baseline converter.
 *
 * Intent:
 * - Standalone CLI script today.
 * - Require-able module later from the main Unity -> Cocos porting tool.
 * - Converts common Unity unlit/transparent/custom-FX shader patterns into a
 *   Cocos effect skeleton, then reports unsupported macros/features for manual fix.
 *
 * This is intentionally conservative. It does not try to reproduce Unity URP/HDRP
 * lighting 1:1. It focuses on: Properties, render states, common HLSL syntax,
 * texture sampling, alpha, clip/discard, UV transform, and a valid Cocos wrapper.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function printHelp() {
  console.log(`
Unity HLSL/ShaderLab -> Cocos .effect Converter

Usage:
  node tools/unity-hlsl-to-cocos-effect.cjs convert --src <UnityShaderOrHlsl> --out <CocosEffect> [options]

Options:
  --src <path>             Unity .shader/.hlsl/.cginc source file.
  --out <path>             Output Cocos .effect file.
  --cocos-root <path>      Cocos project root. Default: parent folder of this script.
  --shader-name <name>     Cocos program/effect display name. Default: derived from --out/--src.
  --report <path>          CSV report path. Default: .unity/hlsl-port-report.csv.
  --overwrite              Allow replacing an existing output .effect.
  --dry-run                Convert and validate in memory, but do not write output.
  --transparent            Force transparent blend state.
  --opaque                 Force opaque blend state.
  --alpha-clip             Add alpha clip threshold support.

Examples:
  node tools/unity-hlsl-to-cocos-effect.cjs convert --src "Assets/Shaders/Fx.shader" --out "assets/effects/fx.effect" --overwrite
  node tools/unity-hlsl-to-cocos-effect.cjs convert --src "Assets/Shaders/MatCap.shader" --out "assets/effects/matcap.effect" --transparent --report .unity/matcap-report.csv
`);
}

function fail(message) {
  console.error(`[unity-hlsl-to-cocos-effect] ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[unity-hlsl-to-cocos-effect] ${message}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

class Reporter {
  constructor() {
    this.issues = [];
  }

  add(severity, code, source, target, message, detail = '') {
    const level = String(severity || 'low').toLowerCase();
    this.issues.push({
      severity: SEVERITY_ORDER[level] == null ? 'low' : level,
      code,
      source: source || '',
      target: target || '',
      message,
      detail: detail || '',
    });
  }

  high(code, source, target, message, detail) { this.add('high', code, source, target, message, detail); }
  medium(code, source, target, message, detail) { this.add('medium', code, source, target, message, detail); }
  low(code, source, target, message, detail) { this.add('low', code, source, target, message, detail); }

  sorted() {
    return [...this.issues].sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return String(a.code).localeCompare(String(b.code));
    });
  }

  writeCsv(file) {
    ensureDir(path.dirname(file));
    const lines = ['severity,code,source,target,message,detail'];
    for (const issue of this.sorted()) {
      lines.push([
        issue.severity,
        issue.code,
        issue.source,
        issue.target,
        issue.message,
        issue.detail,
      ].map(csvEscape).join(','));
    }
    const csv = `${lines.join('\n')}\n`;
    const writeAtomically = (target) => {
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, csv, 'utf8');
      fs.renameSync(tmp, target);
    };

    try {
      writeAtomically(file);
      return file;
    } catch (error) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fallback = `${file.replace(/\.csv$/i, '')}.${stamp}.csv`;
      writeAtomically(fallback);
      console.warn(`[unity-hlsl-to-cocos-effect] WARN: Report file is locked (${error.code || error.message}). Wrote fallback report: ${fallback}`);
      return fallback;
    }
  }

  summary() {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const issue of this.issues) counts[issue.severity] += 1;
    return counts;
  }
}

function parseArgs(argv) {
  const command = argv[0] && !String(argv[0]).startsWith('-') ? argv[0] : 'help';
  const options = {
    command,
    src: '',
    out: '',
    cocosRoot: ROOT_DIR,
    shaderName: '',
    report: path.join(ROOT_DIR, '.unity', 'hlsl-port-report.csv'),
    overwrite: false,
    dryRun: false,
    forceTransparent: false,
    forceOpaque: false,
    alphaClip: false,
  };

  const optionStartIndex = command === 'help' && argv[0] && String(argv[0]).startsWith('-') ? 0 : 1;
  for (let i = optionStartIndex; i < argv.length; i++) {
    const arg = argv[i];
    const readValue = (name) => {
      const value = argv[i + 1];
      if (!value) fail(`Missing value for ${name}`);
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') { options.command = 'help'; continue; }
    if (arg === '--src') { options.src = readValue(arg); continue; }
    if (arg.startsWith('--src=')) { options.src = arg.slice('--src='.length); continue; }
    if (arg === '--out') { options.out = readValue(arg); continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice('--out='.length); continue; }
    if (arg === '--cocos-root') { options.cocosRoot = path.resolve(readValue(arg)); continue; }
    if (arg.startsWith('--cocos-root=')) { options.cocosRoot = path.resolve(arg.slice('--cocos-root='.length)); continue; }
    if (arg === '--shader-name') { options.shaderName = readValue(arg); continue; }
    if (arg.startsWith('--shader-name=')) { options.shaderName = arg.slice('--shader-name='.length); continue; }
    if (arg === '--report') { options.report = path.resolve(readValue(arg)); continue; }
    if (arg.startsWith('--report=')) { options.report = path.resolve(arg.slice('--report='.length)); continue; }
    if (arg === '--overwrite') { options.overwrite = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--transparent') { options.forceTransparent = true; continue; }
    if (arg === '--opaque') { options.forceOpaque = true; continue; }
    if (arg === '--alpha-clip') { options.alphaClip = true; continue; }

    fail(`Unknown option: ${arg}`);
  }

  if (options.command !== 'help' && options.command !== 'convert') fail(`Unknown command: ${options.command}`);
  return options;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLineComment(line) {
  const index = line.indexOf('//');
  return index >= 0 ? line.slice(0, index) : line;
}

function extractBraceBlockAfterKeyword(source, keyword) {
  const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
  const match = pattern.exec(source);
  if (!match) return '';
  const open = source.indexOf('{', match.index + match[0].length);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

function toLowerCamel(unityName, fallback = 'value') {
  let text = String(unityName || fallback).trim();
  text = text.replace(/^_+/, '');
  const compact = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const aliases = {
    maintex: 'mainTexture',
    maintexture: 'mainTexture',
    basemap: 'mainTexture',
    basetex: 'mainTexture',
    albedomap: 'mainTexture',
    bumpmap: 'normalTexture',
    normalmap: 'normalTexture',
    matcap: 'matcapTexture',
    matcaptex: 'matcapTexture',
    matcaptexture: 'matcapTexture',
    maskmap: 'maskTexture',
    noisemap: 'noiseTexture',
    dissolvemap: 'dissolveTexture',
    color: 'baseColor',
    basecolor: 'baseColor',
    tint: 'baseColor',
    alphaclip: 'alphaClipThreshold',
    cutoff: 'alphaClipThreshold',
  };
  if (aliases[compact]) return aliases[compact];

  const parts = text.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (!parts.length) return fallback;
  const [first, ...rest] = parts;
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('')}`;
}

function uniqueName(base, used) {
  let candidate = base || 'value';
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function parseNumberList(value) {
  const matches = String(value || '').match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  return matches ? matches.map(Number) : [];
}

function parseShaderLabPropertyLine(rawLine) {
  let line = stripLineComment(rawLine).trim();
  if (!line) return null;
  line = line.replace(/^(?:\[[^\]]+\]\s*)+/, '').trim();
  const nameMatch = /^([A-Za-z_]\w*)\s*\(/.exec(line);
  if (!nameMatch) return null;
  const unityName = nameMatch[1];
  const firstQuote = line.indexOf('"', nameMatch[0].length - 1);
  const secondQuote = firstQuote >= 0 ? line.indexOf('"', firstQuote + 1) : -1;
  if (firstQuote < 0 || secondQuote < 0) return null;
  const displayName = line.slice(firstQuote + 1, secondQuote);
  const equals = line.indexOf('=', secondQuote + 1);
  if (equals < 0) return null;
  const lastParen = line.lastIndexOf(')', equals);
  const comma = line.indexOf(',', secondQuote + 1);
  if (comma < 0 || lastParen < 0 || comma > lastParen) return null;
  const type = line.slice(comma + 1, lastParen).trim();
  const rawDefault = line.slice(equals + 1).replace(/\{.*$/, '').trim();
  return { unityName, displayName, type, rawDefault };
}

function propertyKind(type) {
  const lower = String(type || '').toLowerCase();
  if (/\b(2d|cube|3d)\b/.test(lower)) return 'texture';
  if (lower.includes('color')) return 'color';
  if (lower.includes('vector')) return 'vector';
  if (lower.includes('range') || lower.includes('float') || lower.includes('int')) return 'float';
  return 'float';
}

function parsePropertyDefault(prop) {
  const kind = propertyKind(prop.type);
  if (kind === 'texture') {
    const match = /"([^"]+)"/.exec(prop.rawDefault);
    const value = (match ? match[1] : 'white').toLowerCase();
    if (value.includes('normal') || value.includes('bump')) return 'normal';
    if (value.includes('black')) return 'black';
    if (value.includes('gray') || value.includes('grey')) return 'grey';
    return 'white';
  }
  const values = parseNumberList(prop.rawDefault);
  if (kind === 'color' || kind === 'vector') {
    while (values.length < 4) values.push(kind === 'color' ? 1 : 0);
    return values.slice(0, 4);
  }
  return values.length ? values[0] : 0;
}

function parseUnityProperties(source, reporter, sourceFile) {
  const block = extractBraceBlockAfterKeyword(source, 'Properties');
  const props = [];
  const used = new Set();
  if (block) {
    for (const line of block.split(/\r?\n/)) {
      const parsed = parseShaderLabPropertyLine(line);
      if (!parsed) continue;
      const kind = propertyKind(parsed.type);
      const glslName = uniqueName(toLowerCamel(parsed.unityName), used);
      props.push({
        ...parsed,
        kind,
        glslName,
        defaultValue: parsePropertyDefault(parsed),
      });
    }
  }

  if (!props.some((prop) => prop.kind === 'texture')) {
    props.push({
      unityName: '_MainTex',
      displayName: 'Main Texture',
      type: '2D',
      rawDefault: '"white" {}',
      kind: 'texture',
      glslName: uniqueName('mainTexture', used),
      defaultValue: 'white',
    });
    reporter.low('PROPERTY_FALLBACK_MAIN_TEXTURE', sourceFile, 'mainTexture', 'No Unity texture property found; generated mainTexture fallback');
  }
  if (!props.some((prop) => prop.kind === 'color' && prop.glslName === 'baseColor')) {
    props.push({
      unityName: '_Color',
      displayName: 'Base Color',
      type: 'Color',
      rawDefault: '(1,1,1,1)',
      kind: 'color',
      glslName: uniqueName('baseColor', used),
      defaultValue: [1, 1, 1, 1],
    });
  }
  if (!props.some((prop) => prop.kind === 'float' && /alpha|opacity/i.test(prop.glslName))) {
    props.push({
      unityName: '_Alpha',
      displayName: 'Alpha',
      type: 'Range(0, 1)',
      rawDefault: '1',
      kind: 'float',
      glslName: uniqueName('alpha', used),
      defaultValue: 1,
    });
  }
  return props;
}

function normalizeBlendFactor(value) {
  const key = String(value || '').trim().toLowerCase();
  const map = {
    zero: 'zero',
    one: 'one',
    srccolor: 'src_color',
    oneminussrccolor: 'one_minus_src_color',
    dstcolor: 'dst_color',
    oneminusdstcolor: 'one_minus_dst_color',
    srcalpha: 'src_alpha',
    oneminussrcalpha: 'one_minus_src_alpha',
    dstalpha: 'dst_alpha',
    oneminusdstalpha: 'one_minus_dst_alpha',
  };
  return map[key] || key || 'one';
}

function parseRenderState(source, options) {
  const state = {
    transparent: false,
    alphaClip: !!options.alphaClip,
    blend: false,
    blendSrc: 'src_alpha',
    blendDst: 'one_minus_src_alpha',
    blendSrcAlpha: 'one',
    blendDstAlpha: 'one_minus_src_alpha',
    depthTest: true,
    depthWrite: true,
    cullMode: 'back',
  };

  if (/Queue\s*=\s*"?Transparent/i.test(source) || /RenderType\s*=\s*"?Transparent/i.test(source)) {
    state.transparent = true;
  }
  if (/Queue\s*=\s*"?AlphaTest/i.test(source) || /AlphaTest/i.test(source)) {
    state.alphaClip = true;
  }

  const blendLine = /^\s*Blend\s+([^\r\n]+)/im.exec(source);
  if (blendLine) {
    const parts = blendLine[1].trim().split(/\s+/).filter((part) => part !== ',');
    if (parts.length >= 2 && !/^off$/i.test(parts[0])) {
      state.blend = true;
      state.transparent = true;
      state.blendSrc = normalizeBlendFactor(parts[0]);
      state.blendDst = normalizeBlendFactor(parts[1]);
      if (parts.length >= 4) {
        state.blendSrcAlpha = normalizeBlendFactor(parts[2]);
        state.blendDstAlpha = normalizeBlendFactor(parts[3]);
      }
    }
  }

  const zwrite = /^\s*ZWrite\s+(On|Off|True|False|0|1)/im.exec(source);
  if (zwrite) state.depthWrite = /^(on|true|1)$/i.test(zwrite[1]);
  const ztest = /^\s*ZTest\s+(Off|Always|Never|Less|LEqual|Equal|GEqual|Greater|NotEqual)/im.exec(source);
  if (ztest && /^off$/i.test(ztest[1])) state.depthTest = false;
  const cull = /^\s*Cull\s+(Back|Front|Off|None)/im.exec(source);
  if (cull) state.cullMode = /^front$/i.test(cull[1]) ? 'front' : /^back$/i.test(cull[1]) ? 'back' : 'none';

  if (options.forceTransparent) {
    state.transparent = true;
    state.blend = true;
    state.depthWrite = false;
  }
  if (options.forceOpaque) {
    state.transparent = false;
    state.blend = false;
    state.depthWrite = true;
  }
  if (state.transparent) {
    state.blend = true;
    state.depthWrite = false;
  }
  return state;
}

function extractProgramBlock(source) {
  const blockRegex = /(?:CGPROGRAM|HLSLPROGRAM)([\s\S]*?)(?:ENDCG|ENDHLSL)/ig;
  let best = '';
  let match;
  while ((match = blockRegex.exec(source))) {
    const block = match[1];
    if (!best || /#\s*pragma\s+fragment/i.test(block)) best = block;
  }
  return best || source;
}

function parsePragma(program, type) {
  const re = new RegExp(`#\\s*pragma\\s+${type}\\s+([A-Za-z_]\\w*)`, 'i');
  const match = re.exec(program);
  return match ? match[1] : '';
}

function findFunctionBody(program, functionName) {
  if (!functionName) return '';
  const re = new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`, 'm');
  const match = re.exec(program);
  if (!match) return '';
  const brace = program.indexOf('{', match.index);
  if (brace < 0) return '';
  let depth = 0;
  for (let i = brace; i < program.length; i++) {
    const ch = program[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return program.slice(brace + 1, i).trim();
    }
  }
  return '';
}

function detectUnsupportedFeatures(program, reporter, sourceFile) {
  const checks = [
    { code: 'UNITY_LIGHTING_MACRO', pattern: /\b(UnityGI|UNITY_LIGHT|LIGHT_ATTENUATION|GetMainLight|AdditionalLight|SHADOW_ATTENUATION)\b/i, message: 'Unity lighting/shadow macro detected; generated effect is unlit approximation' },
    { code: 'UNITY_SURFACE_SHADER', pattern: /#\s*pragma\s+surface\b/i, message: 'Unity Surface Shader detected; no 1:1 Cocos conversion is attempted' },
    { code: 'UNITY_GRABPASS', pattern: /\bGrabPass\b/i, message: 'GrabPass/screen copy detected; requires Cocos render texture/post-process rewrite' },
    { code: 'UNITY_TESSELLATION', pattern: /\b(tessellate|hull|domain)\b/i, message: 'Tessellation stages detected; skipped by this converter' },
    { code: 'UNITY_GEOMETRY_SHADER', pattern: /#\s*pragma\s+geometry\b/i, message: 'Geometry shader stage detected; skipped by this converter' },
    { code: 'UNITY_INCLUDE_DEPENDENCY', pattern: /#\s*include\b/i, message: 'Unity include detected; converter only maps common symbols and does not inline include files' },
    { code: 'UNITY_CUSTOM_TEXTURE_MACRO', pattern: /\b(TEXTURE2D|SAMPLER|TEXTURECUBE|SAMPLE_TEXTURECUBE)\b/i, message: 'Texture macro detected; common SAMPLE_TEXTURE2D is mapped, other variants may need manual fix' },
  ];
  for (const check of checks) {
    if (check.pattern.test(program)) reporter.medium(check.code, sourceFile, '', check.message);
  }
}

function replaceFunctionCall1(code, name, replacement) {
  let out = code;
  const needle = `${name}(`;
  let index = out.indexOf(needle);
  while (index >= 0) {
    const start = index + needle.length;
    let depth = 1;
    let end = start;
    for (; end < out.length; end++) {
      const ch = out[end];
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    const arg = out.slice(start, end);
    out = `${out.slice(0, index)}${replacement(arg)}${out.slice(end + 1)}`;
    index = out.indexOf(needle, index + 1);
  }
  return out;
}

function splitTopLevelArgs(value) {
  const args = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
}

function convertCommonHlslSyntax(body, props, reporter, sourceFile) {
  let code = body || '';

  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  code = code.replace(/^\s*#.*$/gm, '');
  code = code.replace(/\b(fixed|half|real|float)([234])x([234])\b/g, (m, t, r, c) => (r === c ? `mat${r}` : `mat${c}x${r}`));
  code = code.replace(/\b(fixed|half|real|float)([234])\b/g, 'vec$2');
  code = code.replace(/\b(fixed|half|real)\b/g, 'float');
  code = code.replace(/\bbool([234])\b/g, 'bvec$1');
  code = code.replace(/\bint([234])\b/g, 'ivec$1');
  code = code.replace(/\btex2Dlod\s*\(\s*([A-Za-z_]\w*)\s*,\s*vec4\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)\s*\)/g, 'texture($1, $2)');
  code = code.replace(/\btex2D\s*\(\s*([A-Za-z_]\w*)\s*,\s*([^\)]+)\)/g, 'texture($1, $2)');
  code = code.replace(/\bUNITY_SAMPLE_TEX2D\s*\(\s*([A-Za-z_]\w*)\s*,\s*([^\)]+)\)/g, 'texture($1, $2)');
  code = code.replace(/\bSAMPLE_TEXTURE2D\s*\(([^\)]*)\)/g, (match, argsText) => {
    const args = splitTopLevelArgs(argsText);
    if (args.length >= 3) return `texture(${args[0]}, ${args[2]})`;
    return match;
  });
  code = code.replace(/\bTRANSFORM_TEX\s*\(([^\)]*)\)/g, (match, argsText) => {
    const args = splitTopLevelArgs(argsText);
    if (args.length >= 2) {
      const texName = args[1].trim();
      const mapped = mapUnityIdentifier(texName, props);
      return `((${args[0]}) * ${mapped}_ST.xy + ${mapped}_ST.zw)`;
    }
    return match;
  });
  code = code.replace(/\blerp\s*\(/g, 'mix(');
  code = code.replace(/\bfrac\s*\(/g, 'fract(');
  code = code.replace(/\bfmod\s*\(/g, 'mod(');
  code = code.replace(/\bddx\s*\(/g, 'dFdx(');
  code = code.replace(/\bddy\s*\(/g, 'dFdy(');
  code = code.replace(/\batan2\s*\(/g, 'atan(');
  code = replaceFunctionCall1(code, 'saturate', (arg) => `clamp(${arg}, 0.0, 1.0)`);
  code = code.replace(/\bclip\s*\(([^;]+)\)\s*;/g, 'if (($1) < 0.0) discard;');

  // Common Unity input struct names -> Cocos varyings used by generated vertex shader.
  code = code.replace(/\b(?:i|IN|input|fragInput)\.uv(?:0)?\b/g, 'uv');
  code = code.replace(/\b(?:i|IN|input|fragInput)\.texcoord\b/g, 'uv');
  code = code.replace(/\b(?:i|IN|input|fragInput)\.texCoord\b/g, 'uv');
  code = code.replace(/\b(?:i|IN|input|fragInput)\.color\b/g, 'v_color');
  code = code.replace(/\b(?:i|IN|input|fragInput)\.vertexColor\b/g, 'v_color');
  code = code.replace(/\b_Time\.y\b/g, 'cc_time.x');
  code = code.replace(/\b_Time\b/g, 'cc_time');
  code = code.replace(/\b_ScreenParams\b/g, 'cc_screenSize');

  // Remove common Unity instance/fog macros that are side-effect only for many FX shaders.
  code = code.replace(/\bUNITY_SETUP_INSTANCE_ID\s*\([^;]*\)\s*;/g, '');
  code = code.replace(/\bUNITY_TRANSFER_INSTANCE_ID\s*\([^;]*\)\s*;/g, '');
  code = code.replace(/\bUNITY_INITIALIZE_OUTPUT\s*\([^;]*\)\s*;/g, '');
  code = code.replace(/\bUNITY_APPLY_FOG\s*\([^;]*\)\s*;/g, '');

  for (const prop of props) {
    const unity = prop.unityName;
    if (!unity) continue;
    code = code.replace(new RegExp(`\\b${escapeRegExp(unity)}_ST\\b`, 'g'), `${prop.glslName}_ST`);
    code = code.replace(new RegExp(`\\b${escapeRegExp(unity)}\\b`, 'g'), prop.glslName);
  }

  if (/\b(UnityObjectToClipPos|mul\s*\(|UNITY_MATRIX|ObjSpace|WorldSpace|GetMainLight)\b/.test(code)) {
    reporter.medium('FRAGMENT_UNRESOLVED_UNITY_SYMBOL', sourceFile, '', 'Converted fragment still contains Unity transform/lighting symbols; manual rewrite may be needed');
  }
  if (/\btex2D|SAMPLE_TEXTURE|UNITY_|fixed[234]?|half[234]?\b/.test(code)) {
    reporter.medium('FRAGMENT_PARTIAL_HLSL_LEFTOVER', sourceFile, '', 'Converted fragment still contains HLSL/Unity-like symbols');
  }

  return code.trim();
}

function mapUnityIdentifier(identifier, props) {
  const prop = props.find((item) => item.unityName === identifier || item.glslName === identifier);
  return prop ? prop.glslName : toLowerCamel(identifier);
}

function inferFragmentBody(program, props, reporter, sourceFile) {
  const fragmentName = parsePragma(program, 'fragment') || 'frag';
  const rawBody = findFunctionBody(program, fragmentName);
  if (!rawBody) {
    reporter.medium('FRAGMENT_ENTRY_NOT_FOUND', sourceFile, fragmentName, 'Could not find Unity fragment entry; generated fallback unlit texture fragment');
    return fallbackFragmentBody(props);
  }

  const converted = convertCommonHlslSyntax(rawBody, props, reporter, sourceFile);
  if (!/\breturn\b/.test(converted)) {
    reporter.medium('FRAGMENT_NO_RETURN', sourceFile, fragmentName, 'Converted fragment has no return statement; appended fallback return');
    return `${converted}\n  return texture(${firstTextureName(props)}, uv) * ${firstColorName(props)} * v_color;`;
  }
  return converted;
}

function firstTextureName(props) {
  return (props.find((prop) => prop.kind === 'texture') || {}).glslName || 'mainTexture';
}

function firstColorName(props) {
  return (props.find((prop) => prop.kind === 'color') || {}).glslName || 'baseColor';
}

function firstAlphaName(props) {
  return (props.find((prop) => prop.kind === 'float' && /alpha|opacity/i.test(prop.glslName)) || {}).glslName || 'alpha';
}

function fallbackFragmentBody(props) {
  const texName = firstTextureName(props);
  const colorName = firstColorName(props);
  const alphaName = firstAlphaName(props);
  return `vec4 col = texture(${texName}, uv * ${texName}_ST.xy + ${texName}_ST.zw) * ${colorName} * v_color;\n  col.a *= ${alphaName};\n  return col;`;
}

function createUniformLayout(props) {
  const vectors = [];
  const floats = [];
  const texST = [];
  for (const prop of props) {
    if (prop.kind === 'texture') {
      texST.push(prop);
    } else if (prop.kind === 'color' || prop.kind === 'vector') {
      vectors.push(prop);
    } else {
      floats.push(prop);
    }
  }

  const aliases = [];
  vectors.forEach((prop, index) => {
    prop.uniform = `u_vec${index}`;
    aliases.push(`  vec4 ${prop.glslName} = ${prop.uniform};`);
  });
  floats.forEach((prop, index) => {
    const bucket = Math.floor(index / 4);
    const lane = ['x', 'y', 'z', 'w'][index % 4];
    prop.uniform = `u_params${bucket}`;
    prop.uniformLane = lane;
    aliases.push(`  float ${prop.glslName} = ${prop.uniform}.${lane};`);
  });
  texST.forEach((prop, index) => {
    prop.stUniform = `u_texST${index}`;
    aliases.push(`  vec4 ${prop.glslName}_ST = ${prop.stUniform};`);
  });

  const uniformLines = [];
  if (vectors.length || floats.length || texST.length) {
    uniformLines.push('uniform UnityParams {');
    vectors.forEach((prop) => uniformLines.push(`  vec4 ${prop.uniform};`));
    const floatBuckets = Math.max(0, Math.ceil(floats.length / 4));
    for (let i = 0; i < floatBuckets; i++) uniformLines.push(`  vec4 u_params${i};`);
    texST.forEach((prop) => uniformLines.push(`  vec4 ${prop.stUniform};`));
    uniformLines.push('};');
  }

  return { uniformLines, aliases, vectors, floats, texST };
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => Number.isFinite(item) ? Number(item.toFixed(6)) : 0).join(', ')}]`;
  if (typeof value === 'number') return Number(value.toFixed(6));
  return value == null ? '' : String(value);
}

function generatePropertiesYaml(props) {
  const lines = [];
  for (const prop of props) {
    if (prop.kind === 'texture') {
      lines.push(`        ${prop.glslName}: { value: ${prop.defaultValue || 'white'}, editor: { displayName: ${JSON.stringify(prop.displayName || prop.glslName)} } }`);
      lines.push(`        ${prop.glslName}ST: { value: [1, 1, 0, 0], target: ${prop.stUniform}, editor: { displayName: ${JSON.stringify(`${prop.displayName || prop.glslName} ST`)} } }`);
      continue;
    }
    if (prop.kind === 'color' || prop.kind === 'vector') {
      lines.push(`        ${prop.glslName}: { value: ${yamlValue(prop.defaultValue)}, target: ${prop.uniform}, editor: { displayName: ${JSON.stringify(prop.displayName || prop.glslName)} } }`);
      continue;
    }
    lines.push(`        ${prop.glslName}: { value: ${yamlValue(prop.defaultValue)}, target: ${prop.uniform}.${prop.uniformLane}, editor: { displayName: ${JSON.stringify(prop.displayName || prop.glslName)} } }`);
  }
  return lines.join('\n');
}

function generateBlendYaml(state) {
  if (!state.blend) return '';
  return `
      blendState:
        targets:
        - blend: true
          blendSrc: ${state.blendSrc}
          blendDst: ${state.blendDst}
          blendSrcAlpha: ${state.blendSrcAlpha}
          blendDstAlpha: ${state.blendDstAlpha}`;
}

function indentBody(body, spaces) {
  const pad = ' '.repeat(spaces);
  return String(body || '').split(/\r?\n/).map((line) => `${pad}${line.trimEnd()}`).join('\n');
}

function generateCocosEffect({ shaderName, props, renderState, fragmentBody }) {
  const layout = createUniformLayout(props);
  const textureUniforms = props
    .filter((prop) => prop.kind === 'texture')
    .map((prop) => `uniform sampler2D ${prop.glslName};`)
    .join('\n');
  const propertyYaml = generatePropertiesYaml(props);
  const aliases = layout.aliases.join('\n');
  const alphaClipThreshold = props.find((prop) => /alphaclip|cutoff|threshold/i.test(prop.glslName));
  const alphaClipLine = renderState.alphaClip
    ? `\n  if (col.a < ${alphaClipThreshold ? alphaClipThreshold.glslName : '0.5'}) discard;`
    : '';
  const finalBody = renderState.alphaClip && /return\s+([^;]+);\s*$/.test(fragmentBody)
    ? fragmentBody.replace(/return\s+([^;]+);\s*$/, `vec4 col = $1;${alphaClipLine}\n  return col;`)
    : fragmentBody;

  return `CCEffect %{\n  techniques:\n  - name: ${renderState.transparent ? 'transparent' : 'opaque'}\n    passes:\n    - vert: unity-port-vs:vert\n      frag: unity-port-fs:frag\n      rasterizerState:\n        cullMode: ${renderState.cullMode}\n      depthStencilState:\n        depthTest: ${renderState.depthTest ? 'true' : 'false'}\n        depthWrite: ${renderState.depthWrite ? 'true' : 'false'}${generateBlendYaml(renderState)}\n      properties:\n${propertyYaml}\n}%\n\nCCProgram unity-port-vs %{\n  precision highp float;\n  #include <cc-global>\n  #include <cc-local>\n\n  in vec3 a_position;\n  in vec2 a_texCoord;\n  in vec4 a_color;\n\n  out vec2 v_uv;\n  out vec4 v_color;\n\n  vec4 vert () {\n    v_uv = a_texCoord;\n    v_color = a_color;\n    return cc_matProj * cc_matView * cc_matWorld * vec4(a_position, 1.0);\n  }\n}%\n\nCCProgram unity-port-fs %{\n  precision highp float;\n  #include <cc-global>\n\n  in vec2 v_uv;\n  in vec4 v_color;\n\n${textureUniforms ? indentBody(textureUniforms, 2) + '\n' : ''}${layout.uniformLines.length ? indentBody(layout.uniformLines.join('\n'), 2) + '\n' : ''}\n  vec4 frag () {\n    vec2 uv = v_uv;\n${aliases ? `${aliases}\n` : ''}${indentBody(finalBody, 4)}\n  }\n}%\n`;
}

function validateEffect(effectText, reporter, sourceFile, targetFile) {
  const required = ['CCEffect', 'CCProgram', 'vec4 vert', 'vec4 frag'];
  for (const token of required) {
    if (!effectText.includes(token)) reporter.high('EFFECT_VALIDATE_MISSING_TOKEN', sourceFile, targetFile, `Generated effect is missing token: ${token}`);
  }
  if (/\breturn\s*;/.test(effectText)) reporter.high('EFFECT_VALIDATE_VOID_RETURN', sourceFile, targetFile, 'Generated fragment contains a void return');
}

function convertUnityHlslToCocosEffect(options, externalReporter) {
  const reporter = externalReporter || new Reporter();
  if (!options.src) fail('--src is required');
  if (!options.out) fail('--out is required');

  const srcFile = path.resolve(options.src);
  const outFile = path.resolve(options.out);
  if (!fs.existsSync(srcFile)) fail(`Source file not found: ${srcFile}`);
  if (fs.existsSync(outFile) && !options.overwrite && !options.dryRun) fail(`Output exists. Use --overwrite to replace: ${outFile}`);

  const source = fs.readFileSync(srcFile, 'utf8');
  const shaderName = options.shaderName || path.basename(outFile || srcFile, path.extname(outFile || srcFile));
  const props = parseUnityProperties(source, reporter, srcFile);
  const renderState = parseRenderState(source, options);
  const program = extractProgramBlock(source);
  detectUnsupportedFeatures(program, reporter, srcFile);
  const fragmentBody = inferFragmentBody(program, props, reporter, srcFile);
  const effectText = generateCocosEffect({ shaderName, props, renderState, fragmentBody });
  validateEffect(effectText, reporter, srcFile, outFile);

  if (!options.dryRun) {
    ensureDir(path.dirname(outFile));
    fs.writeFileSync(outFile, effectText, 'utf8');
  }

  if (options.report) reporter.writeCsv(path.resolve(options.report));
  return { effectText, props, renderState, report: reporter, outputFile: outFile, shaderName };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    printHelp();
    return;
  }
  const reporter = new Reporter();
  const result = convertUnityHlslToCocosEffect(options, reporter);
  const summary = reporter.summary();
  if (options.dryRun) log(`Dry run OK: ${result.shaderName}`);
  else log(`Wrote: ${toPosix(result.outputFile)}`);
  if (options.report) log(`Report: ${toPosix(path.resolve(options.report))} (${summary.high} high, ${summary.medium} medium, ${summary.low} low)`);
}

if (require.main === module) main();

module.exports = {
  Reporter,
  convertUnityHlslToCocosEffect,
  parseUnityProperties,
  parseRenderState,
  extractProgramBlock,
  inferFragmentBody,
  convertCommonHlslSyntax,
  generateCocosEffect,
};
