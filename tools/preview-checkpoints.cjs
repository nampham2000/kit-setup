#!/usr/bin/env node
'use strict';

/**
 * Preview Visual Checkpoint Matrix
 * ================================
 * Chụp nhiều trạng thái/biến thể của cùng một Cocos preview trong các browser
 * session độc lập. Mỗi case có thể chạy setup/eval/gesture riêng, nhờ vậy agent
 * so camera, transform, shader, UI và input cạnh nhau mà không để state của case
 * trước làm bẩn case sau.
 *
 * Tool chỉ nhận URL preview. Nó không tìm hoặc tạo build.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runOne, parseGesture } = require('./verify-runtime.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REEXEC_ENV = 'PLAYABLE_PREVIEW_CHECKPOINTS_WEBSOCKET_REEXEC';

const USAGE = `Preview Visual Checkpoint Matrix

Usage:
  node playable-shared-kit/tools/preview-checkpoints.cjs --config <matrix.json> [options]

Options:
  --config <file>      JSON manifest. Bắt buộc.
  --url <url>          Ghi đè URL preview trong manifest.
  --output <dir>       Ghi đè thư mục output.
  --case <name>        Chỉ chạy một checkpoint (có thể lặp lại).
  --browser <path>     Ghi đè Chrome/Edge executable.
  --json               Xuất JSON compact.
  --help               Hiện trợ giúp.

Manifest:
  {
    "url": "http://127.0.0.1:7456/",
    "outputDir": ".unity/preview-checkpoints/box-axis",
    "seconds": 4,
    "windowSize": "720x1280",
    "previewDevice": "WebpageFullScreen",
    "cases": [
      {
        "name": "baseline",
        "evalBeforeFile": ".unity/checkpoints/baseline-before.js",
        "gesture": "0.3,0.6,0.7,0.6,500,20",
        "gestureKeepPressed": true,
        "evalFile": ".unity/checkpoints/baseline-after.js",
        "requireEvalOk": true,
        "referenceImage": ".unity/references/unity.png"
      }
    ]
  }

Mỗi case reload preview trong browser session riêng. Tool sinh từng PNG,
manifest.json và index.html dạng contact sheet. Ảnh là evidence để con người/agent
đối chiếu; tool không tự tuyên bố pixel parity.`;

function slugify(value) {
  const slug = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug || slug === '.' || slug === '..') throw new Error(`Tên checkpoint không hợp lệ: ${value}`);
  return slug;
}

function normalizeWindowSize(value) {
  const match = /^(\d+)\s*[x,]\s*(\d+)$/i.exec(String(value || '').trim());
  if (!match) throw new Error(`windowSize không hợp lệ: ${value}`);
  return `${match[1]},${match[2]}`;
}

function resolveInsideProject(value, label) {
  const resolved = path.resolve(PROJECT_ROOT, String(value || ''));
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (!value || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} phải nằm trong project: ${value}`);
  }
  const rootReal = fs.realpathSync.native(PROJECT_ROOT);
  let cursor = PROJECT_ROOT;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${label} không được đi qua symlink/junction: ${value}`);
    const real = fs.realpathSync.native(cursor);
    const realRelative = path.relative(rootReal, real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(`${label} realpath thoát khỏi project: ${value}`);
    }
  }
  return resolved;
}

function readExpression(entry, inlineKey, fileKey) {
  if (entry[inlineKey] && entry[fileKey]) {
    throw new Error(`Checkpoint chỉ được dùng một trong ${inlineKey}/${fileKey}`);
  }
  if (entry[fileKey]) {
    const file = resolveInsideProject(entry[fileKey], fileKey);
    if (!fs.existsSync(file)) throw new Error(`Không tìm thấy ${fileKey}: ${entry[fileKey]}`);
    return fs.readFileSync(file, 'utf8');
  }
  return entry[inlineKey] ? String(entry[inlineKey]) : '';
}

function evaluateEvalAssertion(required, value) {
  if (!required) return { required: false, ok: true };
  if (value === undefined || value === null || value === '') {
    return { required: true, ok: false, reason: 'eval returned no value' };
  }
  let payload = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return { required: true, ok: false, reason: `eval result is not JSON: ${error.message}` };
    }
  }
  const ok = payload === true || !!(payload && typeof payload === 'object' && payload.ok === true);
  const reason = ok ? '' : (payload && typeof payload === 'object' && payload.reason
    ? String(payload.reason) : 'eval result must be true or an object with ok=true');
  return { required: true, ok, reason };
}

function validateConfig(config, overrides = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Manifest phải là JSON object');
  const url = overrides.url || config.url;
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error('Preview checkpoint bắt buộc URL http(s); tool không build và không tự tìm build HTML');
  }
  if (!Array.isArray(config.cases) || config.cases.length === 0) throw new Error('Manifest cần cases[] không rỗng');
  if (config.previewDevice !== undefined
    && (typeof config.previewDevice !== 'string' || !config.previewDevice.trim())) {
    throw new Error('previewDevice phải là string không rỗng');
  }
  const seen = new Set();
  const cases = config.cases.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`cases[${index}] phải là object`);
    const name = String(entry.name || '').trim();
    const slug = slugify(name);
    if (entry.requireEvalOk !== undefined && typeof entry.requireEvalOk !== 'boolean') {
      throw new Error(`cases[${index}].requireEvalOk phải là boolean`);
    }
    if (entry.gestureKeepPressed !== undefined && typeof entry.gestureKeepPressed !== 'boolean') {
      throw new Error(`cases[${index}].gestureKeepPressed phải là boolean`);
    }
    if (entry.gestureKeepPressed === true && !entry.gesture) {
      throw new Error(`cases[${index}].gestureKeepPressed cần gesture`);
    }
    if (entry.previewDevice !== undefined
      && (typeof entry.previewDevice !== 'string' || !entry.previewDevice.trim())) {
      throw new Error(`cases[${index}].previewDevice phải là string không rỗng`);
    }
    if (seen.has(slug)) throw new Error(`Checkpoint trùng tên sau normalize: ${name}`);
    seen.add(slug);
    return {
      ...entry,
      name,
      slug,
      evalBeforeExpression: readExpression(entry, 'evalBefore', 'evalBeforeFile'),
      evalExpression: readExpression(entry, 'eval', 'evalFile'),
      parsedGesture: entry.gesture ? parseGesture(entry.gesture) : null,
    };
  });
  const requested = new Set(overrides.cases || []);
  const selected = requested.size
    ? cases.filter(entry => requested.has(entry.name) || requested.has(entry.slug))
    : cases;
  if (requested.size && selected.length !== requested.size) {
    const found = new Set(selected.flatMap(entry => [entry.name, entry.slug]));
    const missing = [...requested].filter(name => !found.has(name));
    throw new Error(`Không tìm thấy checkpoint: ${missing.join(', ')}`);
  }
  return {
    url: String(url),
    outputDir: overrides.output || config.outputDir || '.unity/preview-checkpoints/latest',
    seconds: Math.max(1, Number(config.seconds) || 4),
    minFps: Math.max(0, Number(config.minFps) || 20),
    windowSize: normalizeWindowSize(config.windowSize || '720x1280'),
    previewDevice: typeof config.previewDevice === 'string' ? config.previewDevice.trim() : '',
    browser: overrides.browser || config.browser || undefined,
    cases: selected,
  };
}

function parseArgs(argv) {
  const result = { cases: [], json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    if (arg === '--json') { result.json = true; continue; }
    if (arg === '--config') { result.config = argv[++index]; continue; }
    if (arg.startsWith('--config=')) { result.config = arg.slice('--config='.length); continue; }
    if (arg === '--url') { result.url = argv[++index]; continue; }
    if (arg.startsWith('--url=')) { result.url = arg.slice('--url='.length); continue; }
    if (arg === '--output') { result.output = argv[++index]; continue; }
    if (arg.startsWith('--output=')) { result.output = arg.slice('--output='.length); continue; }
    if (arg === '--browser') { result.browser = argv[++index]; continue; }
    if (arg.startsWith('--browser=')) { result.browser = arg.slice('--browser='.length); continue; }
    if (arg === '--case') { result.cases.push(argv[++index]); continue; }
    if (arg.startsWith('--case=')) { result.cases.push(arg.slice('--case='.length)); continue; }
    throw new Error(`Option không hỗ trợ: ${arg}`);
  }
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function copyReference(caseEntry, caseDir) {
  if (!caseEntry.referenceImage) return null;
  const source = resolveInsideProject(caseEntry.referenceImage, 'referenceImage');
  if (!fs.existsSync(source)) throw new Error(`Không tìm thấy referenceImage: ${caseEntry.referenceImage}`);
  const extension = path.extname(source) || '.png';
  const destination = path.join(caseDir, `reference${extension.toLowerCase()}`);
  fs.copyFileSync(source, destination);
  return path.relative(PROJECT_ROOT, destination).replace(/\\/g, '/');
}

function renderIndex(outputDir, manifest) {
  const cards = manifest.cases.map(entry => {
    const screenshot = entry.screenshot
      ? `<img src="${escapeHtml(path.relative(outputDir, path.resolve(PROJECT_ROOT, entry.screenshot)).replace(/\\/g, '/'))}" alt="${escapeHtml(entry.name)}">`
      : '<div class="missing">missing screenshot</div>';
    const reference = entry.referenceImage
      ? `<img src="${escapeHtml(path.relative(outputDir, path.resolve(PROJECT_ROOT, entry.referenceImage)).replace(/\\/g, '/'))}" alt="reference ${escapeHtml(entry.name)}">`
      : '';
    return `<article><h2>${escapeHtml(entry.name)}</h2><div class="images">${reference}${screenshot}</div><pre>${escapeHtml(JSON.stringify(entry.evidence, null, 2))}</pre></article>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Preview checkpoints</title>
<style>body{margin:0;background:#17191d;color:#eef1f5;font:14px system-ui;padding:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}article{background:#252a31;border-radius:10px;padding:12px}h1,h2{margin:0 0 12px}.images{display:flex;gap:8px;align-items:flex-start}.images img{width:calc(50% - 4px);max-height:640px;object-fit:contain;background:#111}.images img:only-child{width:100%}pre{white-space:pre-wrap;font-size:11px;color:#bfc8d4}.missing{padding:30px;background:#532}</style>
<h1>Preview checkpoint matrix</h1><p>${escapeHtml(manifest.url)}</p><main>${cards}</main>`;
  fs.writeFileSync(path.join(outputDir, 'index.html'), html);
}

function ensureWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return true;
  if (process.env[REEXEC_ENV] === '1') throw new Error(`WebSocket không khả dụng trên ${process.version}`);
  const child = spawnSync(process.execPath, ['--experimental-websocket', __filename, ...process.argv.slice(2)], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, [REEXEC_ENV]: '1' },
  });
  if (child.error) throw child.error;
  process.exitCode = Number.isInteger(child.status) ? child.status : 1;
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.config) throw new Error('--config là bắt buộc');
  const configFile = resolveInsideProject(args.config, 'config');
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  const config = validateConfig(raw, args);
  const outputDir = resolveInsideProject(config.outputDir, 'outputDir');
  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (const caseEntry of config.cases) {
    const caseDir = path.join(outputDir, caseEntry.slug);
    fs.mkdirSync(caseDir, { recursive: true });
    const relativeCaseDir = path.relative(PROJECT_ROOT, caseDir);
    const runtime = await runOne(config.url, {
      browser: config.browser,
      seconds: Number(caseEntry.seconds) || config.seconds,
      minFps: Number(caseEntry.minFps) || config.minFps,
      windowSize: normalizeWindowSize(caseEntry.windowSize || config.windowSize),
      previewDevice: caseEntry.previewDevice || config.previewDevice,
      screenshotDir: relativeCaseDir,
      noScreenshot: false,
      evalBeforeExpression: caseEntry.evalBeforeExpression,
      evalExpression: caseEntry.evalExpression,
      gesture: caseEntry.parsedGesture,
      gestureKeepPressed: caseEntry.gestureKeepPressed === true,
    });
    const referenceImage = copyReference(caseEntry, caseDir);
    const evalAssertion = evaluateEvalAssertion(caseEntry.requireEvalOk === true, runtime.evalResult);
    results.push({
      name: caseEntry.name,
      slug: caseEntry.slug,
      description: caseEntry.description || '',
      screenshot: runtime.screenshot,
      referenceImage,
      ok: runtime.ok && !!runtime.screenshot && !runtime.evalBeforeError && !runtime.evalError
        && !runtime.previewDeviceError && !runtime.previewDeviceRestoreError
        && !runtime.gestureError && evalAssertion.ok,
      evidence: {
        fps: runtime.fps,
        frames: runtime.frames,
        canvasSize: runtime.canvasSize,
        previewDevice: runtime.previewDevice,
        previewDeviceError: runtime.previewDeviceError,
        previewDeviceRestored: runtime.previewDeviceRestored,
        previewDeviceRestoreError: runtime.previewDeviceRestoreError,
        exceptions: runtime.exceptions,
        consoleErrors: runtime.consoleErrors,
        consoleWarnings: runtime.consoleWarnings,
        evalBeforeResult: runtime.evalBeforeResult,
        gesture: runtime.gesture,
        evalResult: runtime.evalResult,
        evalBeforeError: runtime.evalBeforeError,
        gestureError: runtime.gestureError,
        evalError: runtime.evalError,
        evalAssertion,
      },
    });
  }

  const manifest = {
    schemaVersion: 1,
    tool: 'preview-checkpoints',
    generatedAt: new Date().toISOString(),
    url: config.url,
    ok: results.every(entry => entry.ok),
    note: 'Runtime-clean screenshots are visual evidence, not automatic pixel-parity proof.',
    cases: results,
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  renderIndex(outputDir, manifest);
  const output = {
    ...manifest,
    outputDir: path.relative(PROJECT_ROOT, outputDir).replace(/\\/g, '/'),
    manifest: path.relative(PROJECT_ROOT, path.join(outputDir, 'manifest.json')).replace(/\\/g, '/'),
    contactSheet: path.relative(PROJECT_ROOT, path.join(outputDir, 'index.html')).replace(/\\/g, '/'),
  };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`[preview-checkpoints] ${results.filter(entry => entry.ok).length}/${results.length} runtime-clean`);
    for (const entry of results) console.log(`  [${entry.ok ? 'ok' : 'fail'}] ${entry.name}: ${entry.screenshot || 'no screenshot'}`);
    console.log(`  manifest: ${output.manifest}`);
    console.log(`  contact sheet: ${output.contactSheet}`);
  }
  if (!manifest.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    if (ensureWebSocket()) main().catch(error => {
      console.error(`[preview-checkpoints] ERROR: ${error.message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`[preview-checkpoints] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  slugify,
  normalizeWindowSize,
  resolveInsideProject,
  validateConfig,
  parseArgs,
  readExpression,
  evaluateEvalAssertion,
};
