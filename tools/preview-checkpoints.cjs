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
    "postActionSeconds": 2,
    "windowSize": "720x1280",
    "previewDevice": "WebpageFullScreen",
    "cases": [
      {
        "name": "baseline",
        "evalBeforeFile": ".unity/checkpoints/baseline-before.js",
        "gesture": "0.3,0.6,0.7,0.6,500,20",
        "gestureHoldBeforeMoveMs": 300,
        "gestureKeepPressed": true,
        "postActionSeconds": 3,
        "requireEvalBeforeOk": true,
        "requiredEvalBeforeMetrics": {
          "actionStarted": { "min": 0, "max": 0 }
        },
        "evalFile": ".unity/checkpoints/baseline-after.js",
        "requireEvalOk": true,
        "requiredTrace": ["roll", "pre-attach", "snap", "feedback"],
        "requiredEvalMetrics": {
          "positionError": { "max": 0.02 },
          "directionDot": { "min": 0.97 }
        },
        "screenshotRegion": { "x": 0.45, "y": 0.1, "width": 0.1, "height": 0.08 },
        "screenshotMetricOptions": { "brightLuminanceThreshold": 210 },
        "requiredScreenshotMetrics": {
          "brightPixelRatio": { "min": 0.16, "max": 0.32 }
        },
        "referenceImage": ".unity/references/unity.png",
        "referenceRegion": { "x": 0, "y": 0, "width": 1, "height": 1 },
        "requiredReferenceMetrics": {
          "foregroundRgbSimilarity": { "min": 0.90 },
          "foregroundIou": { "min": 0.80 }
        },
        "referenceMetricOptions": { "autoTrimForeground": true, "backgroundDistanceThreshold": 24 }
      }
    ]
  }

Mỗi case reload preview trong browser session riêng. Tool sinh từng PNG,
manifest.json và index.html dạng contact sheet. Khi khai báo
requiredReferenceMetrics, tool crop/resize reference về đúng ROI candidate và
fail-closed theo metric; nếu không khai báo thì reference chỉ là contact sheet.`;

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

function parseEvalPayload(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function normalizeEvalMetricContract(value, label = 'requiredEvalMetrics') {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} phải là object metric -> {min|max}`);
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 32) throw new Error(`${label} phải có 1-32 metric`);
  const normalized = {};
  for (const [metric, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(metric)
      || metric.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new Error(`${label} có metric path không hợp lệ: ${metric}`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${label}.${metric} phải là {min|max}`);
    }
    const hasMin = raw.min !== undefined;
    const hasMax = raw.max !== undefined;
    if (!hasMin && !hasMax) throw new Error(`${label}.${metric} cần min hoặc max`);
    const min = hasMin ? Number(raw.min) : undefined;
    const max = hasMax ? Number(raw.max) : undefined;
    if ((hasMin && !Number.isFinite(min)) || (hasMax && !Number.isFinite(max))
      || (hasMin && hasMax && min > max)) {
      throw new Error(`${label}.${metric} có range không hợp lệ`);
    }
    normalized[metric] = { ...(hasMin ? { min } : {}), ...(hasMax ? { max } : {}) };
  }
  return normalized;
}

function readEvalMetric(payload, metric) {
  let value = payload;
  for (const part of metric.split('.')) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

/** Verify declared numeric oracle output instead of trusting a bare {ok:true}. */
function evaluateMetricAssertion(requiredMetrics, value) {
  const entries = Object.entries(requiredMetrics || {});
  if (entries.length === 0) return { required: false, ok: true };
  const payload = parseEvalPayload(value);
  if (!payload || typeof payload !== 'object') {
    return { required: true, ok: false, reason: 'eval result must be an object containing required metrics' };
  }
  const metrics = [];
  for (const [metric, range] of entries) {
    const actual = readEvalMetric(payload, metric);
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      return { required: true, ok: false, reason: `missing or non-finite eval metric: ${metric}`, metrics };
    }
    if (range.min !== undefined && actual < range.min) {
      return { required: true, ok: false, reason: `${metric}=${actual} is below min ${range.min}`, metrics };
    }
    if (range.max !== undefined && actual > range.max) {
      return { required: true, ok: false, reason: `${metric}=${actual} exceeds max ${range.max}`, metrics };
    }
    metrics.push({ metric, actual, ...range });
  }
  return { required: true, ok: true, metrics };
}

const SUPPORTED_SCREENSHOT_METRICS = new Set([
  'meanLuminance', 'brightPixelRatio', 'meanRed', 'meanGreen', 'meanBlue',
]);

const SUPPORTED_REFERENCE_METRICS = new Set([
  'rgbSimilarity', 'luminanceSimilarity', 'meanAbsoluteError', 'rmse', 'meanLuminanceDelta',
  'foregroundRgbSimilarity', 'foregroundLuminanceSimilarity', 'foregroundMeanLuminanceDelta',
  'foregroundIou',
]);

function normalizeScreenshotRegion(value, label = 'screenshotRegion') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} phải là object normalized {x,y,width,height}`);
  }
  const region = Object.fromEntries(['x', 'y', 'width', 'height']
    .map(key => [key, Number(value[key])]));
  if (Object.values(region).some(number => !Number.isFinite(number))
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error(`${label} phải nằm trọn trong normalized image bounds 0-1`);
  }
  return region;
}

function calculateScreenshotMetrics(data, channels, brightLuminanceThreshold = 220) {
  if (!data || !Number.isInteger(channels) || channels < 3 || data.length < channels
    || data.length % channels !== 0) {
    throw new Error('raw screenshot pixels/channels không hợp lệ');
  }
  const count = data.length / channels;
  let red = 0;
  let green = 0;
  let blue = 0;
  let luminance = 0;
  let bright = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    red += r;
    green += g;
    blue += b;
    luminance += y;
    if (y >= brightLuminanceThreshold) bright++;
  }
  return {
    meanLuminance: luminance / count,
    brightPixelRatio: bright / count,
    meanRed: red / count,
    meanGreen: green / count,
    meanBlue: blue / count,
  };
}

async function evaluateScreenshotMetricAssertion(requiredMetrics, screenshot, region, options = {}) {
  if (!requiredMetrics || Object.keys(requiredMetrics).length === 0) {
    return { required: false, ok: true };
  }
  if (!screenshot) return { required: true, ok: false, reason: 'screenshot missing' };
  let sharp;
  try { sharp = require('sharp'); } catch (_) {
    return { required: true, ok: false, reason: 'sharp is required for screenshot metric assertions' };
  }
  const screenshotFile = resolveInsideProject(screenshot, 'screenshot');
  if (!fs.existsSync(screenshotFile)) {
    return { required: true, ok: false, reason: `screenshot not found: ${screenshot}` };
  }
  try {
    const metadata = await sharp(screenshotFile).metadata();
    if (!metadata.width || !metadata.height) throw new Error('missing image dimensions');
    const left = Math.min(metadata.width - 1, Math.round(metadata.width * region.x));
    const top = Math.min(metadata.height - 1, Math.round(metadata.height * region.y));
    const width = Math.max(1, Math.min(metadata.width - left, Math.round(metadata.width * region.width)));
    const height = Math.max(1, Math.min(metadata.height - top, Math.round(metadata.height * region.height)));
    const threshold = options.brightLuminanceThreshold;
    const raw = await sharp(screenshotFile).extract({ left, top, width, height })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const measured = calculateScreenshotMetrics(raw.data, raw.info.channels, threshold);
    const assertion = evaluateMetricAssertion(requiredMetrics, measured);
    return {
      ...assertion,
      measured,
      region: { normalized: region, pixels: { left, top, width, height } },
      brightLuminanceThreshold: threshold,
      imageSize: { width: metadata.width, height: metadata.height },
    };
  } catch (error) {
    return { required: true, ok: false, reason: `screenshot metric failed: ${error.message}` };
  }
}

function colorDistance(data, offset, color) {
  const dr = data[offset] - color[0];
  const dg = data[offset + 1] - color[1];
  const db = data[offset + 2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function estimateCornerBackground(data, width, height, channels = 3) {
  const offsets = [0, (width - 1) * channels, (height - 1) * width * channels,
    ((height * width) - 1) * channels];
  return [0, 1, 2].map(channel => offsets.reduce((sum, offset) => sum + data[offset + channel], 0) / 4);
}

function findForegroundBounds(data, width, height, channels = 3, threshold = 24) {
  const background = estimateCornerBackground(data, width, height, channels);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      if (colorDistance(data, offset, background) <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    background,
  };
}

function calculateReferenceMetrics(candidate, reference, channels = 3, options = {}) {
  if (!Buffer.isBuffer(candidate) || !Buffer.isBuffer(reference)
    || candidate.length !== reference.length || candidate.length < channels
    || !Number.isInteger(channels) || channels < 3 || candidate.length % channels !== 0) {
    throw new Error('candidate/reference pixels must have identical RGB dimensions');
  }
  const pixelCount = candidate.length / channels;
  let absolute = 0;
  let squared = 0;
  let luminanceAbsolute = 0;
  let candidateLuminance = 0;
  let referenceLuminance = 0;
  let foregroundAbsolute = 0;
  let foregroundLuminanceAbsolute = 0;
  let foregroundIntersection = 0;
  let foregroundUnion = 0;
  let candidateForegroundLuminance = 0;
  let referenceForegroundLuminance = 0;
  let candidateForegroundCount = 0;
  let referenceForegroundCount = 0;
  const foregroundThreshold = Number(options.backgroundDistanceThreshold) || 24;
  const candidateBackground = options.candidateBackground || [0, 0, 0];
  const referenceBackground = options.referenceBackground || [0, 0, 0];
  for (let offset = 0; offset < candidate.length; offset += channels) {
    const cr = candidate[offset];
    const cg = candidate[offset + 1];
    const cb = candidate[offset + 2];
    const rr = reference[offset];
    const rg = reference[offset + 1];
    const rb = reference[offset + 2];
    const dr = cr - rr;
    const dg = cg - rg;
    const db = cb - rb;
    absolute += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
    squared += dr * dr + dg * dg + db * db;
    const cy = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
    const ry = 0.2126 * rr + 0.7152 * rg + 0.0722 * rb;
    candidateLuminance += cy;
    referenceLuminance += ry;
    luminanceAbsolute += Math.abs(cy - ry);
    const candidateForeground = colorDistance(candidate, offset, candidateBackground) > foregroundThreshold;
    const referenceForeground = colorDistance(reference, offset, referenceBackground) > foregroundThreshold;
    if (candidateForeground) {
      candidateForegroundCount++;
      candidateForegroundLuminance += cy;
    }
    if (referenceForeground) {
      referenceForegroundCount++;
      referenceForegroundLuminance += ry;
    }
    if (candidateForeground || referenceForeground) foregroundUnion++;
    if (candidateForeground && referenceForeground) {
      foregroundIntersection++;
      foregroundAbsolute += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      foregroundLuminanceAbsolute += Math.abs(cy - ry);
    }
  }
  const channelCount = pixelCount * 3;
  const meanAbsoluteError = absolute / channelCount;
  const luminanceMae = luminanceAbsolute / pixelCount;
  return {
    rgbSimilarity: Math.max(0, 1 - meanAbsoluteError / 255),
    luminanceSimilarity: Math.max(0, 1 - luminanceMae / 255),
    meanAbsoluteError,
    rmse: Math.sqrt(squared / channelCount),
    meanLuminanceDelta: Math.abs(candidateLuminance - referenceLuminance) / pixelCount,
    foregroundRgbSimilarity: foregroundIntersection > 0
      ? Math.max(0, 1 - foregroundAbsolute / (foregroundIntersection * 3 * 255)) : 0,
    foregroundLuminanceSimilarity: foregroundIntersection > 0
      ? Math.max(0, 1 - foregroundLuminanceAbsolute / (foregroundIntersection * 255)) : 0,
    foregroundMeanLuminanceDelta: candidateForegroundCount > 0 && referenceForegroundCount > 0
      ? Math.abs(candidateForegroundLuminance / candidateForegroundCount
        - referenceForegroundLuminance / referenceForegroundCount) : 255,
    foregroundIou: foregroundUnion > 0 ? foregroundIntersection / foregroundUnion : 0,
  };
}

function regionPixels(metadata, region) {
  const left = Math.min(metadata.width - 1, Math.round(metadata.width * region.x));
  const top = Math.min(metadata.height - 1, Math.round(metadata.height * region.y));
  const width = Math.max(1, Math.min(metadata.width - left, Math.round(metadata.width * region.width)));
  const height = Math.max(1, Math.min(metadata.height - top, Math.round(metadata.height * region.height)));
  return { left, top, width, height };
}

async function evaluateReferenceMetricAssertion(requiredMetrics, screenshot, referenceImage,
  screenshotRegion, referenceRegion, options = {}) {
  if (!requiredMetrics || Object.keys(requiredMetrics).length === 0) {
    return { required: false, ok: true };
  }
  if (!screenshot || !referenceImage) {
    return { required: true, ok: false, reason: 'candidate screenshot or Unity reference is missing' };
  }
  let sharp;
  try { sharp = require('sharp'); } catch (_) {
    return { required: true, ok: false, reason: 'sharp is required for reference metric assertions' };
  }
  try {
    const candidateFile = resolveInsideProject(screenshot, 'screenshot');
    const referenceFile = resolveInsideProject(referenceImage, 'referenceImage');
    if (!fs.existsSync(candidateFile) || !fs.existsSync(referenceFile)) {
      throw new Error('candidate screenshot or reference image not found');
    }
    const [candidateMeta, referenceMeta] = await Promise.all([
      sharp(candidateFile).metadata(), sharp(referenceFile).metadata(),
    ]);
    if (!candidateMeta.width || !candidateMeta.height || !referenceMeta.width || !referenceMeta.height) {
      throw new Error('missing candidate/reference image dimensions');
    }
    const candidatePixels = regionPixels(candidateMeta, screenshotRegion);
    const referencePixels = regionPixels(referenceMeta, referenceRegion);
    const [candidateInitial, referenceInitial] = await Promise.all([
      sharp(candidateFile).extract(candidatePixels).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(referenceFile).extract(referencePixels).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true }),
    ]);
    let candidateTrim = {
      left: 0, top: 0, width: candidateInitial.info.width, height: candidateInitial.info.height,
      background: estimateCornerBackground(candidateInitial.data,
        candidateInitial.info.width, candidateInitial.info.height, candidateInitial.info.channels),
    };
    let referenceTrim = {
      left: 0, top: 0, width: referenceInitial.info.width, height: referenceInitial.info.height,
      background: estimateCornerBackground(referenceInitial.data,
        referenceInitial.info.width, referenceInitial.info.height, referenceInitial.info.channels),
    };
    if (options.autoTrimForeground === true) {
      candidateTrim = findForegroundBounds(candidateInitial.data, candidateInitial.info.width,
        candidateInitial.info.height, candidateInitial.info.channels, options.backgroundDistanceThreshold);
      referenceTrim = findForegroundBounds(referenceInitial.data, referenceInitial.info.width,
        referenceInitial.info.height, referenceInitial.info.channels, options.backgroundDistanceThreshold);
      if (!candidateTrim || !referenceTrim) throw new Error('autoTrimForeground could not find both objects');
    }
    const [candidateRaw, referenceRaw] = await Promise.all([
      sharp(candidateInitial.data, { raw: candidateInitial.info })
        .extract({ left: candidateTrim.left, top: candidateTrim.top,
          width: candidateTrim.width, height: candidateTrim.height })
        .raw().toBuffer(),
      sharp(referenceInitial.data, { raw: referenceInitial.info })
        .extract({ left: referenceTrim.left, top: referenceTrim.top,
          width: referenceTrim.width, height: referenceTrim.height })
        .resize(candidateTrim.width, candidateTrim.height, { fit: 'fill' })
        .raw().toBuffer(),
    ]);
    const measured = calculateReferenceMetrics(candidateRaw, referenceRaw, 3, {
      candidateBackground: candidateTrim.background,
      referenceBackground: referenceTrim.background,
      backgroundDistanceThreshold: options.backgroundDistanceThreshold,
    });
    const assertion = evaluateMetricAssertion(requiredMetrics, measured);
    return {
      ...assertion,
      measured,
      candidateRegion: { normalized: screenshotRegion, pixels: candidatePixels },
      referenceRegion: { normalized: referenceRegion, pixels: referencePixels },
      trim: { candidate: candidateTrim, reference: referenceTrim,
        autoTrimForeground: options.autoTrimForeground === true },
      comparisonSize: { width: candidateTrim.width, height: candidateTrim.height },
    };
  } catch (error) {
    return { required: true, ok: false, reason: `reference metric failed: ${error.message}` };
  }
}

/**
 * Verify an ordered runtime animation/callback trace as a subsequence. Extra
 * diagnostic phases are allowed, but every required milestone must appear in
 * source order and carry a finite monotonic timestamp.
 */
function evaluateTraceAssertion(requiredTrace, value) {
  if (!requiredTrace || requiredTrace.length === 0) return { required: false, ok: true };
  const payload = parseEvalPayload(value);
  const trace = payload && typeof payload === 'object'
    ? (Array.isArray(payload.trace) ? payload.trace : payload.animationTrace) : null;
  if (!Array.isArray(trace)) {
    return { required: true, ok: false, reason: 'eval result must contain trace[] or animationTrace[]' };
  }
  const normalized = [];
  for (let index = 0; index < trace.length; index++) {
    const entry = trace[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.phase !== 'string' || !entry.phase.trim()
      || !Number.isFinite(entry.atMs)) {
      return { required: true, ok: false, reason: `trace[${index}] must contain phase and finite atMs` };
    }
    normalized.push({ phase: entry.phase.trim(), atMs: Number(entry.atMs) });
  }
  let cursor = -1;
  let previousTime = -Infinity;
  const matched = [];
  for (const phase of requiredTrace) {
    let found = -1;
    for (let index = cursor + 1; index < normalized.length; index++) {
      if (normalized[index].phase === phase) { found = index; break; }
    }
    if (found < 0) {
      return { required: true, ok: false, reason: `missing or out-of-order phase: ${phase}`, matched };
    }
    const entry = normalized[found];
    if (entry.atMs < previousTime) {
      return { required: true, ok: false, reason: `non-monotonic timestamp at phase: ${phase}`, matched };
    }
    cursor = found;
    previousTime = entry.atMs;
    matched.push({ phase, atMs: entry.atMs });
  }
  return { required: true, ok: true, matched };
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
  if (config.postActionSeconds !== undefined
    && (!Number.isFinite(Number(config.postActionSeconds))
      || Number(config.postActionSeconds) < 0 || Number(config.postActionSeconds) > 60)) {
    throw new Error('postActionSeconds phải nằm trong 0-60 giây');
  }
  const seen = new Set();
  const cases = config.cases.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`cases[${index}] phải là object`);
    const name = String(entry.name || '').trim();
    const slug = slugify(name);
    if (entry.requireEvalOk !== undefined && typeof entry.requireEvalOk !== 'boolean') {
      throw new Error(`cases[${index}].requireEvalOk phải là boolean`);
    }
    if (entry.requireEvalBeforeOk !== undefined && typeof entry.requireEvalBeforeOk !== 'boolean') {
      throw new Error(`cases[${index}].requireEvalBeforeOk phải là boolean`);
    }
    if (entry.requireEvalBeforeOk === true && !entry.evalBefore && !entry.evalBeforeFile) {
      throw new Error(`cases[${index}].requireEvalBeforeOk cần evalBefore/evalBeforeFile`);
    }
    if (entry.requiredTrace !== undefined) {
      if (!Array.isArray(entry.requiredTrace) || entry.requiredTrace.length < 2 || entry.requiredTrace.length > 32
        || entry.requiredTrace.some(phase => typeof phase !== 'string' || !phase.trim())
        || new Set(entry.requiredTrace.map(phase => phase.trim())).size !== entry.requiredTrace.length) {
        throw new Error(`cases[${index}].requiredTrace phải có 2-32 phase string unique`);
      }
      if (entry.requireEvalOk !== true || (!entry.eval && !entry.evalFile)) {
        throw new Error(`cases[${index}].requiredTrace cần requireEvalOk=true và eval/evalFile`);
      }
    }
    const requiredEvalMetrics = normalizeEvalMetricContract(entry.requiredEvalMetrics,
      `cases[${index}].requiredEvalMetrics`);
    if (Object.keys(requiredEvalMetrics).length > 0
      && (entry.requireEvalOk !== true || (!entry.eval && !entry.evalFile))) {
      throw new Error(`cases[${index}].requiredEvalMetrics cần requireEvalOk=true và eval/evalFile`);
    }
    const requiredEvalBeforeMetrics = normalizeEvalMetricContract(entry.requiredEvalBeforeMetrics,
      `cases[${index}].requiredEvalBeforeMetrics`);
    if (Object.keys(requiredEvalBeforeMetrics).length > 0
      && (entry.requireEvalBeforeOk !== true || (!entry.evalBefore && !entry.evalBeforeFile))) {
      throw new Error(`cases[${index}].requiredEvalBeforeMetrics cần requireEvalBeforeOk=true và evalBefore/evalBeforeFile`);
    }
    const requiredScreenshotMetrics = normalizeEvalMetricContract(entry.requiredScreenshotMetrics,
      `cases[${index}].requiredScreenshotMetrics`);
    for (const metric of Object.keys(requiredScreenshotMetrics)) {
      if (!SUPPORTED_SCREENSHOT_METRICS.has(metric)) {
        throw new Error(`cases[${index}].requiredScreenshotMetrics không hỗ trợ metric: ${metric}`);
      }
    }
    const hasScreenshotMetrics = Object.keys(requiredScreenshotMetrics).length > 0;
    const requiredReferenceMetrics = normalizeEvalMetricContract(entry.requiredReferenceMetrics,
      `cases[${index}].requiredReferenceMetrics`);
    for (const metric of Object.keys(requiredReferenceMetrics)) {
      if (!SUPPORTED_REFERENCE_METRICS.has(metric)) {
        throw new Error(`cases[${index}].requiredReferenceMetrics không hỗ trợ metric: ${metric}`);
      }
    }
    const hasReferenceMetrics = Object.keys(requiredReferenceMetrics).length > 0;
    if ((hasScreenshotMetrics || hasReferenceMetrics) && entry.screenshotRegion === undefined) {
      throw new Error(`cases[${index}] visual metrics cần screenshotRegion`);
    }
    if (!hasScreenshotMetrics && !hasReferenceMetrics && entry.screenshotRegion !== undefined) {
      throw new Error(`cases[${index}].screenshotRegion cần screenshot/reference metrics`);
    }
    if (hasReferenceMetrics && !entry.referenceImage) {
      throw new Error(`cases[${index}].requiredReferenceMetrics cần referenceImage`);
    }
    const screenshotRegion = (hasScreenshotMetrics || hasReferenceMetrics)
      ? normalizeScreenshotRegion(entry.screenshotRegion, `cases[${index}].screenshotRegion`) : null;
    const referenceRegion = hasReferenceMetrics
      ? normalizeScreenshotRegion(entry.referenceRegion || { x: 0, y: 0, width: 1, height: 1 },
        `cases[${index}].referenceRegion`) : null;
    if (entry.referenceMetricOptions?.autoTrimForeground !== undefined
      && typeof entry.referenceMetricOptions.autoTrimForeground !== 'boolean') {
      throw new Error(`cases[${index}].referenceMetricOptions.autoTrimForeground phải là boolean`);
    }
    const backgroundDistanceThreshold = entry.referenceMetricOptions?.backgroundDistanceThreshold === undefined
      ? 24 : Number(entry.referenceMetricOptions.backgroundDistanceThreshold);
    if (!Number.isFinite(backgroundDistanceThreshold)
      || backgroundDistanceThreshold < 1 || backgroundDistanceThreshold > 441) {
      throw new Error(`cases[${index}].referenceMetricOptions.backgroundDistanceThreshold phải nằm trong 1-441`);
    }
    const brightLuminanceThreshold = entry.screenshotMetricOptions?.brightLuminanceThreshold === undefined
      ? 220 : Number(entry.screenshotMetricOptions.brightLuminanceThreshold);
    if (!Number.isFinite(brightLuminanceThreshold)
      || brightLuminanceThreshold < 0 || brightLuminanceThreshold > 255) {
      throw new Error(`cases[${index}].screenshotMetricOptions.brightLuminanceThreshold phải nằm trong 0-255`);
    }
    if (entry.gestureKeepPressed !== undefined && typeof entry.gestureKeepPressed !== 'boolean') {
      throw new Error(`cases[${index}].gestureKeepPressed phải là boolean`);
    }
    if (entry.gestures !== undefined
      && (!Array.isArray(entry.gestures) || entry.gestures.length < 2 || entry.gestures.length > 8
        || entry.gestures.some(gesture => typeof gesture !== 'string' || !gesture.trim()))) {
      throw new Error(`cases[${index}].gestures phải có 2-8 gesture string`);
    }
    if (entry.gesture && entry.gestures) {
      throw new Error(`cases[${index}] không được dùng đồng thời gesture và gestures`);
    }
    if (entry.gestureKeepPressed === true && !entry.gesture) {
      throw new Error(`cases[${index}].gestureKeepPressed cần gesture`);
    }
    if (entry.gestureHoldBeforeMoveMs !== undefined
      && (!Number.isFinite(Number(entry.gestureHoldBeforeMoveMs))
        || Number(entry.gestureHoldBeforeMoveMs) < 0 || Number(entry.gestureHoldBeforeMoveMs) > 5000)) {
      throw new Error(`cases[${index}].gestureHoldBeforeMoveMs phải nằm trong 0-5000 ms`);
    }
    if (Number(entry.gestureHoldBeforeMoveMs) > 0 && !entry.gesture) {
      throw new Error(`cases[${index}].gestureHoldBeforeMoveMs cần gesture`);
    }
    if (entry.gestureGapMs !== undefined
      && (!Number.isFinite(Number(entry.gestureGapMs))
        || Number(entry.gestureGapMs) < 0 || Number(entry.gestureGapMs) > 5000)) {
      throw new Error(`cases[${index}].gestureGapMs phải nằm trong 0-5000 ms`);
    }
    if (entry.gestureGapMs !== undefined && !entry.gestures) {
      throw new Error(`cases[${index}].gestureGapMs cần gestures`);
    }
    if (entry.previewDevice !== undefined
      && (typeof entry.previewDevice !== 'string' || !entry.previewDevice.trim())) {
      throw new Error(`cases[${index}].previewDevice phải là string không rỗng`);
    }
    if (entry.postActionSeconds !== undefined
      && (!Number.isFinite(Number(entry.postActionSeconds))
        || Number(entry.postActionSeconds) < 0 || Number(entry.postActionSeconds) > 60)) {
      throw new Error(`cases[${index}].postActionSeconds phải nằm trong 0-60 giây`);
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
      parsedGestures: entry.gestures ? entry.gestures.map(gesture => parseGesture(gesture)) : [],
      gestureGapMs: entry.gestureGapMs === undefined ? 0 : Number(entry.gestureGapMs),
      gestureHoldBeforeMoveMs: entry.gestureHoldBeforeMoveMs === undefined
        ? 0 : Number(entry.gestureHoldBeforeMoveMs),
      requiredTrace: entry.requiredTrace ? entry.requiredTrace.map(phase => phase.trim()) : [],
      requiredEvalMetrics,
      requiredEvalBeforeMetrics,
      requiredScreenshotMetrics,
      requiredReferenceMetrics,
      screenshotRegion,
      referenceRegion,
      referenceMetricOptions: {
        autoTrimForeground: entry.referenceMetricOptions?.autoTrimForeground === true,
        backgroundDistanceThreshold,
      },
      screenshotMetricOptions: { brightLuminanceThreshold },
      postActionSeconds: entry.postActionSeconds === undefined
        ? undefined : Number(entry.postActionSeconds),
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
    postActionSeconds: Math.max(0, Math.min(60, Number(config.postActionSeconds) || 0)),
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
      postActionSeconds: caseEntry.postActionSeconds === undefined
        ? config.postActionSeconds : caseEntry.postActionSeconds,
      minFps: Number(caseEntry.minFps) || config.minFps,
      windowSize: normalizeWindowSize(caseEntry.windowSize || config.windowSize),
      previewDevice: caseEntry.previewDevice || config.previewDevice,
      screenshotDir: relativeCaseDir,
      noScreenshot: false,
      evalBeforeExpression: caseEntry.evalBeforeExpression,
      evalExpression: caseEntry.evalExpression,
      gesture: caseEntry.parsedGesture,
      gestures: caseEntry.parsedGestures,
      gestureGapMs: caseEntry.gestureGapMs,
      gestureHoldBeforeMoveMs: caseEntry.gestureHoldBeforeMoveMs,
      gestureKeepPressed: caseEntry.gestureKeepPressed === true,
    });
    const referenceImage = copyReference(caseEntry, caseDir);
    const evalBeforeAssertion = evaluateEvalAssertion(caseEntry.requireEvalBeforeOk === true,
      runtime.evalBeforeResult);
    const metricBeforeAssertion = evaluateMetricAssertion(caseEntry.requiredEvalBeforeMetrics,
      runtime.evalBeforeResult);
    const evalAssertion = evaluateEvalAssertion(caseEntry.requireEvalOk === true, runtime.evalResult);
    const traceAssertion = evaluateTraceAssertion(caseEntry.requiredTrace, runtime.evalResult);
    const metricAssertion = evaluateMetricAssertion(caseEntry.requiredEvalMetrics, runtime.evalResult);
    const screenshotMetricAssertion = await evaluateScreenshotMetricAssertion(
      caseEntry.requiredScreenshotMetrics, runtime.screenshot, caseEntry.screenshotRegion,
      caseEntry.screenshotMetricOptions);
    const referenceMetricAssertion = await evaluateReferenceMetricAssertion(
      caseEntry.requiredReferenceMetrics, runtime.screenshot, referenceImage,
      caseEntry.screenshotRegion, caseEntry.referenceRegion, caseEntry.referenceMetricOptions);
    results.push({
      name: caseEntry.name,
      slug: caseEntry.slug,
      description: caseEntry.description || '',
      screenshot: runtime.screenshot,
      referenceImage,
      ok: runtime.ok && !!runtime.screenshot && !runtime.evalBeforeError && !runtime.evalError
        && !runtime.previewDeviceError && !runtime.previewDeviceRestoreError
        && !runtime.gestureError && evalBeforeAssertion.ok && metricBeforeAssertion.ok
        && evalAssertion.ok && traceAssertion.ok && metricAssertion.ok && screenshotMetricAssertion.ok
        && referenceMetricAssertion.ok,
      evidence: {
        fps: runtime.fps,
        frames: runtime.frames,
        observationSeconds: runtime.observationSeconds,
        postActionSeconds: caseEntry.postActionSeconds === undefined
          ? config.postActionSeconds : caseEntry.postActionSeconds,
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
        gestures: runtime.gestures,
        gestureGapMs: runtime.gestureGapMs,
        evalResult: runtime.evalResult,
        evalBeforeError: runtime.evalBeforeError,
        gestureError: runtime.gestureError,
        evalError: runtime.evalError,
        evalBeforeAssertion,
        metricBeforeAssertion,
        evalAssertion,
        traceAssertion,
        metricAssertion,
        screenshotMetricAssertion,
        referenceMetricAssertion,
      },
    });
  }

  const manifest = {
    schemaVersion: 1,
    tool: 'preview-checkpoints',
    generatedAt: new Date().toISOString(),
    url: config.url,
    ok: results.every(entry => entry.ok),
    note: 'Runtime-clean screenshots prove visual parity only when an explicit reference metric contract passes.',
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
  evaluateTraceAssertion,
  normalizeEvalMetricContract,
  evaluateMetricAssertion,
  normalizeScreenshotRegion,
  calculateScreenshotMetrics,
  evaluateScreenshotMetricAssertion,
  calculateReferenceMetrics,
  evaluateReferenceMetricAssertion,
  findForegroundBounds,
};
