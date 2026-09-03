#!/usr/bin/env node
'use strict';


// Bỏ escape ANSI khi output bị pipe (tiết kiệm token cho AI agent).
require('./lib/auto-strip-ansi.cjs');
/**
 * Playable Ads Resource Allocation Stats & Optimization Tool
 *
 * Capabilities:
 * 1. Resource Allocation & Size Breakdown:
 *    - FBX / 3D Models, Textures/Sprites, Audio, Engine Code, Gameplay Scripts, Scenes, Prefabs, Materials, Fonts.
 *    - Comparison against major Playable Ad Network budgets (Google, AppLovin, Unity, IronSource, TikTok, Mintegral, Facebook).
 * 2. Oversized Texture vs Node Transform Warning:
 *    - Cross-references Scenes and Prefabs to find UI / Sprite / Mesh nodes.
 *    - Calculates rendered display size (contentSize * scale) vs raw texture dimensions.
 *    - Flags high-resolution textures rendered on tiny nodes (e.g. 512x512 on 64x128 = 32x wasted resolution).
 *    - Calculates optimal target size and potential KB savings.
 * 3. Exact & Perceptual Texture Similarity Detection (>= 90%):
 *    - Exact SHA-256 duplicate detection.
 *    - Pure Node.js PNG decompressor & dHash / aHash perceptual image similarity engine (zero C++ native dependencies).
 *    - Flags near-identical assets (>= 90% match).
 * 4. Deep-Dive Optimization Diagnostics:
 *    - FBX Embedded Textures/Materials vs External Material Overrides.
 *    - FBX Unused Animation Clips.
 *    - High-bitrate / Stereo / WAV Audio downsample opportunities.
 *    - Opaque 32-bit PNGs without transparency (can convert to JPG / 24-bit).
 *    - Unused Engine Modules enabled in engine.json.
 *    - Dead / Unreferenced Assets detection.
 *    - Playable Health Score (0-100) and Top Quick-Win Recommendations with copy-paste commands.
 * 5. Multi-format Output:
 *    - Rich ANSI Terminal CLI.
 *    - Machine-readable JSON (--json).
 *    - Self-contained interactive HTML Report (--html [path]).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { inspectFontFile } = require('./resource-stats/font-inspector.cjs');
const { charactersForEntry, DEFAULT_MAX_BYTES } = require('./font-subsetter.cjs');
const { auditResourceBoundary } = require('./resource-boundary.cjs');

// ==========================================
// CLI ARGUMENTS & CONFIGURATION
// ==========================================

function parseArgs(argv) {
  const options = {
    help: false,
    doctor: false,
    json: false,
    html: false,
    htmlPath: 'temp/resource-stats-report.html',
    projectRoot: '',
    minSimilarity: 90, // percent
    minWasteRatio: 2.0, // multiplier
    verbose: false,
    scope: 'all', // 'all', 'assets', 'scenes'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--doctor') options.doctor = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    else if (arg === '--html') {
      options.html = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        options.htmlPath = argv[++i];
      }
    } else if (arg.startsWith('--html=')) {
      options.html = true;
      options.htmlPath = arg.substring(7);
    } else if (arg === '--min-similarity') {
      options.minSimilarity = parseFloat(argv[++i]) || 90;
    } else if (arg.startsWith('--min-similarity=')) {
      options.minSimilarity = parseFloat(arg.substring(17)) || 90;
    } else if (arg === '--min-waste') {
      options.minWasteRatio = parseFloat(argv[++i]) || 2.0;
    } else if (arg.startsWith('--min-waste=')) {
      options.minWasteRatio = parseFloat(arg.substring(12)) || 2.0;
    } else if (arg === '--project-root') {
      options.projectRoot = argv[++i] || '';
    } else if (arg === '--scope') {
      options.scope = argv[++i] || 'all';
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Playable Ads Resource Allocation Stats & Optimization Tool

Usage:
  node playable-shared-kit/tools/resource-stats.cjs [options]

Options:
  --json                 Output full analysis as machine-readable JSON.
  --html [path]          Generate standalone visual HTML dashboard (default: temp/resource-stats-report.html).
  --min-similarity <pct> Minimum perceptual image similarity percentage to flag (default: 90).
  --min-waste <ratio>    Minimum texture area waste ratio to flag (default: 2.0).
  --doctor               Verify environment, asset database, and module dependencies.
  --project-root <path>  Specify Cocos project root (default: auto-detect).
  --verbose, -v          Show detailed per-file debug inspection logs.
  --help, -h             Show help message.

Examples:
  node playable-shared-kit/tools/resource-stats.cjs
  node playable-shared-kit/tools/resource-stats.cjs --html
  node playable-shared-kit/tools/resource-stats.cjs --json > report.json
  node playable-shared-kit/tools/resource-stats.cjs --min-similarity 85 --min-waste 1.5
`);
}

// ==========================================
// HELPERS & PATH RESOLUTION
// ==========================================

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'assets')) &&
      fs.existsSync(path.join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// ==========================================
// 1. PURE NODE.JS PNG PARSER & PERCEPTUAL HASH (dHash/aHash)
// ==========================================

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer) {
  try {
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
      return null;
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 8;
    let colorType = 6; // RGBA
    const idatChunks = [];
    let palette = null;
    let trns = null;

    while (offset < buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      offset += 12 + length; // length + type (4) + data (length) + crc (4)

      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
      } else if (type === 'PLTE') {
        palette = data;
      } else if (type === 'tRNS') {
        trns = data;
      } else if (type === 'IDAT') {
        idatChunks.push(data);
      } else if (type === 'IEND') {
        break;
      }
    }

    if (!width || !height || idatChunks.length === 0) {
      return null;
    }

    const compressed = Buffer.concat(idatChunks);
    const uncompressed = zlib.inflateSync(compressed);

    // Calculate bytes per pixel
    let bpp = 4;
    if (colorType === 0) bpp = 1; // Grayscale
    else if (colorType === 2) bpp = 3; // RGB
    else if (colorType === 3) bpp = 1; // Indexed
    else if (colorType === 4) bpp = 2; // Grayscale + Alpha
    else if (colorType === 6) bpp = 4; // RGBA

    if (bitDepth !== 8) {
      // Return metadata only if non-8-bit
      return { width, height, bitDepth, colorType, isOpaque: true, pixels: null };
    }

    const rowBytes = width * bpp;
    const stride = rowBytes + 1; // 1 byte filter type per scanline
    const rgba = Buffer.alloc(width * height * 4);
    let prevRow = Buffer.alloc(rowBytes);
    let currentRow = Buffer.alloc(rowBytes);
    let hasTransparent = false;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * stride;
      if (rowOffset >= uncompressed.length) break;
      const filter = uncompressed[rowOffset];
      const srcRow = uncompressed.subarray(rowOffset + 1, rowOffset + 1 + rowBytes);

      // Reconstruct scanline filter
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? currentRow[i - bpp] : 0;
        const up = prevRow[i];
        const upLeft = i >= bpp ? prevRow[i - bpp] : 0;
        const byte = srcRow[i] || 0;

        let val = byte;
        if (filter === 1) { // Sub
          val = (byte + left) & 0xff;
        } else if (filter === 2) { // Up
          val = (byte + up) & 0xff;
        } else if (filter === 3) { // Average
          val = (byte + Math.floor((left + up) / 2)) & 0xff;
        } else if (filter === 4) { // Paeth
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          let pr = left;
          if (pb < pa && pb <= pc) pr = up;
          else if (pc < pa && pc < pb) pr = upLeft;
          val = (byte + pr) & 0xff;
        }
        currentRow[i] = val;
      }

      // Convert scanline to standard 32-bit RGBA
      for (let x = 0; x < width; x++) {
        const dstIdx = (y * width + x) * 4;
        let r = 0, g = 0, b = 0, a = 255;

        if (colorType === 6) { // RGBA
          r = currentRow[x * 4];
          g = currentRow[x * 4 + 1];
          b = currentRow[x * 4 + 2];
          a = currentRow[x * 4 + 3];
        } else if (colorType === 2) { // RGB
          r = currentRow[x * 3];
          g = currentRow[x * 3 + 1];
          b = currentRow[x * 3 + 2];
        } else if (colorType === 3) { // Indexed / Palette
          const pIdx = currentRow[x];
          if (palette && pIdx * 3 + 2 < palette.length) {
            r = palette[pIdx * 3];
            g = palette[pIdx * 3 + 1];
            b = palette[pIdx * 3 + 2];
          }
          if (trns && pIdx < trns.length) {
            a = trns[pIdx];
          }
        } else if (colorType === 0) { // Grayscale
          r = g = b = currentRow[x];
        } else if (colorType === 4) { // Grayscale + Alpha
          r = g = b = currentRow[x * 2];
          a = currentRow[x * 2 + 1];
        }

        if (a < 250) hasTransparent = true;

        rgba[dstIdx] = r;
        rgba[dstIdx + 1] = g;
        rgba[dstIdx + 2] = b;
        rgba[dstIdx + 3] = a;
      }

      const temp = prevRow;
      prevRow = Buffer.from(currentRow);
      currentRow = temp;
    }

    return {
      width,
      height,
      bitDepth,
      colorType,
      isOpaque: !hasTransparent,
      rgba,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Computes high-precision 32x32 Structural SSIM profile, alpha silhouette mask,
 * bounding content aspect ratio, coverage, and average color.
 */
function computeImageHashes(rgba, srcW, srcH) {
  if (!rgba || srcW <= 0 || srcH <= 0) {
    return {
      dHash: '',
      aHash: '',
      dHashBits: '',
      aHashBits: '',
      dHash2D: '',
      avgLum: 0,
      isSolid: false,
      avgR: 0,
      avgG: 0,
      avgB: 0,
      avgA: 0,
      coverage: 0,
      contentAspectRatio: 1.0,
      aspectRatio: 1.0,
      grid32: null,
      alphaMask32: null,
      mean: 0,
      variance: 0,
    };
  }

  const N = 32;
  const numPixels = N * N;
  const grid32 = new Float32Array(numPixels);
  const alphaMask32 = new Uint8Array(numPixels);

  let minX = srcW, maxX = 0, minY = srcH, maxY = 0;
  let rSum = 0, gSum = 0, bSum = 0, aSum = 0, opaqueCount = 0;
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0, minA = 255, maxA = 0;

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const idx = (y * srcW + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const a = rgba[idx + 3];

      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minG = Math.min(minG, g); maxG = Math.max(maxG, g);
      minB = Math.min(minB, b); maxB = Math.max(maxB, b);
      minA = Math.min(minA, a); maxA = Math.max(maxA, a);

      if (a > 15) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        rSum += r;
        gSum += g;
        bSum += b;
        aSum += a;
        opaqueCount++;
      }
    }
  }

  const isSolid = (maxR - minR < 5) && (maxG - minG < 5) && (maxB - minB < 5) && (maxA - minA < 5);
  const avgR = opaqueCount > 0 ? rSum / opaqueCount : 0;
  const avgG = opaqueCount > 0 ? gSum / opaqueCount : 0;
  const avgB = opaqueCount > 0 ? bSum / opaqueCount : 0;
  const avgA = opaqueCount > 0 ? aSum / opaqueCount : 0;

  const contentW = maxX >= minX ? (maxX - minX + 1) : 0;
  const contentH = maxY >= minY ? (maxY - minY + 1) : 0;
  const contentAspectRatio = contentH > 0 ? Number((contentW / contentH).toFixed(3)) : 1.0;
  const coverage = (srcW * srcH) > 0 ? Number((opaqueCount / (srcW * srcH)).toFixed(3)) : 0;

  let totalIntensity = 0;
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      const srcX = Math.min(srcW - 1, Math.floor((tx / N) * srcW));
      const srcY = Math.min(srcH - 1, Math.floor((ty / N) * srcH));
      const idx = (srcY * srcW + srcX) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const a = rgba[idx + 3];

      const lum = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255);
      const cellIdx = ty * N + tx;
      grid32[cellIdx] = lum;
      totalIntensity += lum;
      alphaMask32[cellIdx] = a > 40 ? 1 : 0;
    }
  }

  const mean = totalIntensity / numPixels;
  let variance = 0;
  for (let i = 0; i < numPixels; i++) {
    const d = grid32[i] - mean;
    variance += d * d;
  }
  variance /= numPixels;

  const avgLum = Math.round(0.299 * avgR + 0.587 * avgG + 0.114 * avgB);

  return {
    dHash: bitsToHex(String(Math.round(mean))),
    aHash: '',
    dHashBits: 'valid',
    dHash2D: 'valid',
    avgLum,
    isSolid,
    avgR: Math.round(avgR),
    avgG: Math.round(avgG),
    avgB: Math.round(avgB),
    avgA: Math.round(avgA),
    coverage,
    contentAspectRatio,
    aspectRatio: Number((srcW / srcH).toFixed(3)),
    grid32,
    alphaMask32,
    mean,
    variance,
  };
}

function bitsToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.substring(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}

function calculateTextureSimilarity(texA, texB) {
  if (!texA.grid32 || !texB.grid32) return 0;

  // 1. Solid vs non-solid check
  if (texA.isSolid !== texB.isSolid) return 0;
  if (texA.isSolid && texB.isSolid) {
    const colorDist = Math.hypot(
      (texA.avgR || 0) - (texB.avgR || 0),
      (texA.avgG || 0) - (texB.avgG || 0),
      (texA.avgB || 0) - (texB.avgB || 0),
      (texA.avgA || 0) - (texB.avgA || 0)
    ) / (Math.sqrt(4) * 255);
    return Number((Math.max(0, 1 - colorDist) * 100).toFixed(1));
  }

  // 2. Content Bounding Box Aspect Ratio Match
  const arA = texA.contentAspectRatio || texA.aspectRatio || 1.0;
  const arB = texB.contentAspectRatio || texB.aspectRatio || 1.0;
  const arMin = Math.min(arA, arB);
  const arMax = Math.max(arA, arB);
  if (arMax > 0 && (arMin / arMax) < 0.80) return 0;

  // 3. Alpha Coverage Match
  const covA = texA.coverage !== undefined ? texA.coverage : 0.5;
  const covB = texB.coverage !== undefined ? texB.coverage : 0.5;
  const covMin = Math.min(covA, covB);
  const covMax = Math.max(covA, covB);
  if (covMax > 0 && (covMin / covMax) < 0.70) return 0;

  // 4. Alpha Silhouette IoU (Intersection over Union)
  const N = 32 * 32;
  let inter = 0, un = 0;
  for (let i = 0; i < N; i++) {
    const a = texA.alphaMask32[i];
    const b = texB.alphaMask32[i];
    if (a && b) inter++;
    if (a || b) un++;
  }
  const iou = un > 0 ? (inter / un) : 1.0;
  if (iou < 0.85) return 0; // Distinct silhouette contours (e.g. 5-pt star vs round flare)

  // 5. Structural SSIM
  let cov = 0;
  for (let i = 0; i < N; i++) {
    cov += (texA.grid32[i] - texA.mean) * (texB.grid32[i] - texB.mean);
  }
  cov /= N;

  const c1 = 6.5025; // (0.01 * 255)^2
  const c2 = 58.5225; // (0.03 * 255)^2
  const ssim = ((2 * texA.mean * texB.mean + c1) * (2 * cov + c2)) /
               ((texA.mean * texA.mean + texB.mean * texB.mean + c1) * (texA.variance + texB.variance + c2));

  // 6. Color Distance in normalized RGB space
  const colorDist = Math.hypot(
    (texA.avgR || 0) - (texB.avgR || 0),
    (texA.avgG || 0) - (texB.avgG || 0),
    (texA.avgB || 0) - (texB.avgB || 0)
  ) / (Math.sqrt(3) * 255);
  const colorSim = Math.max(0, 1 - colorDist);

  // Combined score: high structural similarity (SSIM >= 92% and IoU >= 85%)
  // captures texture duplicates and color palette variants (blue/orange/red)
  const finalScore = Math.max(0, ssim) * iou * (0.80 + 0.20 * colorSim) * 100;
  return Number(Math.max(0, Math.min(100, finalScore)).toFixed(1));
}

// Fallback image dimension reader for JPEG, WebP, etc.
function readImageHeader(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_MAGIC)) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        format: 'PNG',
      };
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) { // SOF0 or SOF2
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
            format: 'JPEG',
          };
        }
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  }
  return null;
}

// ==========================================
// 2. FBX BINARY INSPECTOR (Models & Textures)
// ==========================================

const FBX_MAGIC = Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'binary');

function parseFbxDetails(filePath, buffer) {
  const result = {
    isFbxBinary: false,
    embeddedTextures: [],
    embeddedMaterials: [],
    animationClips: [],
    meshCount: 0,
    triangleCount: 0,
    vertexCount: 0,
    hasEmbeddedBloat: false,
  };

  if (!buffer || buffer.length < FBX_MAGIC.length || !buffer.subarray(0, FBX_MAGIC.length).equals(FBX_MAGIC)) {
    return result;
  }

  result.isFbxBinary = true;
  const version = buffer.readUInt32LE(FBX_MAGIC.length);
  const wide = version >= 7500;
  const headerSize = wide ? 25 : 13;

  function readHeader(offset) {
    if (wide) {
      return {
        end: Number(buffer.readBigUInt64LE(offset)),
        count: Number(buffer.readBigUInt64LE(offset + 8)),
        propLength: Number(buffer.readBigUInt64LE(offset + 16)),
        nameLength: buffer[offset + 24],
      };
    }
    return {
      end: buffer.readUInt32LE(offset),
      count: buffer.readUInt32LE(offset + 4),
      propLength: buffer.readUInt32LE(offset + 8),
      nameLength: buffer[offset + 12],
    };
  }

  function readProperty(offset) {
    const code = String.fromCharCode(buffer[offset]);
    offset += 1;
    let value = null;
    let nextOffset = offset;

    if (code === 'Y') { value = buffer.readInt16LE(offset); nextOffset += 2; }
    else if (code === 'C') { value = buffer[offset] !== 0; nextOffset += 1; }
    else if (code === 'I') { value = buffer.readInt32LE(offset); nextOffset += 4; }
    else if (code === 'F') { value = buffer.readFloatLE(offset); nextOffset += 4; }
    else if (code === 'D') { value = buffer.readDoubleLE(offset); nextOffset += 8; }
    else if (code === 'L') { value = Number(buffer.readBigInt64LE(offset)); nextOffset += 8; }
    else if (code === 'S' || code === 'R') {
      const size = buffer.readUInt32LE(offset);
      nextOffset += 4;
      const payload = buffer.subarray(nextOffset, nextOffset + size);
      nextOffset += size;
      value = code === 'S' ? payload.toString('utf8') : payload;
    } else if ('fdlibc'.includes(code)) {
      const compressedLength = buffer.readUInt32LE(offset + 8);
      nextOffset += 12 + compressedLength;
    }
    return { value, nextOffset };
  }

  function parseNode(offset) {
    if (offset + headerSize > buffer.length) return null;
    const header = readHeader(offset);
    if (header.end === 0) return { name: '', nextOffset: offset + headerSize };

    let cursor = offset + headerSize;
    const name = buffer.subarray(cursor, cursor + header.nameLength).toString('utf8');
    cursor += header.nameLength;

    const props = [];
    for (let i = 0; i < header.count; i++) {
      const parsed = readProperty(cursor);
      props.push(parsed.value);
      cursor = parsed.nextOffset;
    }

    const children = [];
    while (cursor < header.end) {
      const child = parseNode(cursor);
      if (!child || !child.name) {
        cursor += headerSize;
        break;
      }
      children.push(child);
      cursor = child.nextOffset;
    }

    return { name, props, children, nextOffset: header.end };
  }

  try {
    let offset = FBX_MAGIC.length + 4;
    while (offset < buffer.length) {
      const node = parseNode(offset);
      if (!node || !node.name) break;
      offset = node.nextOffset;

      if (node.name === 'Objects') {
        for (const obj of node.children) {
          if (obj.name === 'Texture' || obj.name === 'Video') {
            const texName = obj.props[1] ? String(obj.props[1]).split('\x00\x01')[0] : 'Texture';
            result.embeddedTextures.push(texName);
          } else if (obj.name === 'Material') {
            const matName = obj.props[1] ? String(obj.props[1]).split('\x00\x01')[0] : 'Material';
            result.embeddedMaterials.push(matName);
          } else if (obj.name === 'Geometry') {
            result.meshCount++;
          } else if (obj.name === 'AnimationStack' || obj.name === 'AnimationLayer') {
            const clipName = obj.props[1] ? String(obj.props[1]).split('\x00\x01')[0] : 'AnimClip';
            if (!result.animationClips.includes(clipName)) {
              result.animationClips.push(clipName);
            }
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal parse error on truncated FBX
  }

  result.hasEmbeddedBloat = result.embeddedTextures.length > 0;
  return result;
}

// ==========================================
// 3. AUDIO HEADER & SPECIFICATION PARSER
// ==========================================

function parseAudioDetails(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  const info = {
    format: ext.replace('.', '').toUpperCase(),
    sampleRate: 0,
    channels: 0,
    channelLabel: 'Unknown',
    bitrateKbps: 0,
    durationSec: 0,
    isUncompressed: false,
    needsOptimization: false,
    reason: [],
  };

  if (ext === '.wav') {
    info.isUncompressed = true;
    info.needsOptimization = true;
    info.reason.push('Uncompressed WAV format (should convert to MP3 or OGG)');
    if (buffer.length >= 44 && buffer.subarray(0, 4).toString() === 'RIFF') {
      info.channels = buffer.readUInt16LE(22);
      info.sampleRate = buffer.readUInt32LE(24);
      const byteRate = buffer.readUInt32LE(28);
      info.bitrateKbps = Math.round((byteRate * 8) / 1000);
      const dataSize = buffer.length - 44;
      info.durationSec = byteRate > 0 ? Number((dataSize / byteRate).toFixed(1)) : 0;
      info.channelLabel = info.channels === 1 ? 'Mono' : 'Stereo';
    }
  } else if (ext === '.mp3') {
    // Basic MP3 header parse (MPEG 1/2 Layer III)
    let offset = 0;
    // Skip ID3v2 tag
    if (buffer.length > 10 && buffer.subarray(0, 3).toString() === 'ID3') {
      const tagSize = (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
      offset = 10 + tagSize;
    }

    // Find MPEG sync word 0xFFE / 0xFFF
    for (let i = offset; i < Math.min(buffer.length - 4, offset + 4096); i++) {
      if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
        const versionBits = (buffer[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        const layerBits = (buffer[i + 1] >> 1) & 0x03; // 1 = Layer3
        const bitrateIdx = (buffer[i + 2] >> 4) & 0x0f;
        const sampleRateIdx = (buffer[i + 2] >> 2) & 0x03;
        const channelMode = (buffer[i + 3] >> 6) & 0x03; // 3 = Single channel (Mono)

        const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
        const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
        const sampleRatesMPEG1 = [44100, 48000, 32000];
        const sampleRatesMPEG2 = [22050, 24000, 16000];

        if (versionBits === 3) {
          info.sampleRate = sampleRatesMPEG1[sampleRateIdx] || 44100;
          info.bitrateKbps = mpeg1Bitrates[bitrateIdx] || 128;
        } else {
          info.sampleRate = sampleRatesMPEG2[sampleRateIdx] || 22050;
          info.bitrateKbps = mpeg2Bitrates[bitrateIdx] || 64;
        }

        info.channels = channelMode === 3 ? 1 : 2;
        info.channelLabel = info.channels === 1 ? 'Mono' : 'Stereo';
        if (info.bitrateKbps > 0) {
          info.durationSec = Number(((buffer.length * 8) / (info.bitrateKbps * 1000)).toFixed(1));
        }
        break;
      }
    }
  } else if (ext === '.ogg') {
    info.format = 'OGG';
    info.channelLabel = 'Vorbis';
  }

  // Playable audio recommendations
  if (info.isUncompressed) {
    info.needsOptimization = true;
    info.reason.push('Uncompressed WAV format (should convert to MP3/OGG)');
  }
  if (info.bitrateKbps > 64) {
    info.needsOptimization = true;
    info.reason.push(`High bitrate (${info.bitrateKbps}kbps > 64kbps for playables)`);
  }
  if (info.sampleRate > 32000 && info.bitrateKbps > 64) {
    info.needsOptimization = true;
    info.reason.push(`High sample rate (${info.sampleRate}Hz > 32000Hz)`);
  }

  return info;
}

// ==========================================
// 4. MAIN PROJECT SCANNER & ASSET AUDITOR
// ==========================================

class PlayableResourceStats {
  constructor(projectRoot, options) {
    this.projectRoot = path.resolve(projectRoot);
    this.options = options;
    this.assetsDir = path.join(this.projectRoot, 'assets');
    this.settingsDir = path.join(this.projectRoot, 'settings');
    this.buildAssetsDir = path.join(this.projectRoot, 'build', 'web-mobile', 'assets');
    this.superHtmlDir = path.join(this.projectRoot, 'build', 'super-html');

    this.uuidMap = new Map(); // uuid -> asset metadata
    this.pathMap = new Map(); // posixPath -> asset metadata
    this.spriteFrameMap = new Map(); // spriteFrame uuid -> texture info
    this.uuidToBuildMap = new Map(); // uuid / subUuid -> { path, relPath, size, ext, bundle }
    this.referencedAssetUuids = new Set();
    this.usedFontCharacters = new Set();
    this.systemFontFamilies = new Set();
    this.runtimeFontPaths = new Set();
    this.fontRequiredCharactersByPath = new Map();
    this.resourceCatalogPathMap = new Map();

    this.buildInfo = {
      hasBuild: false,
      buildDir: this.buildAssetsDir,
      totalBuildSize: 0,
      superHtmlArtifacts: [],
    };

    this.stats = {
      totalSize: 0,
      totalBuildSize: 0,
      totalBuildAssetSize: 0,
      totalBuildWithEngine: 0,
      hasBuildData: false,
      categories: {
        models: { label: '3D Models (FBX/GLTF -> .bin)', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
        textures: { label: 'Textures & Images (WebP/PNG)', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
        audio: { label: 'Audio Assets (SFX & BGM)', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
        scripts: { label: 'Gameplay Scripts (TS -> Bundle JS)', size: 0, buildSize: 0, count: 0, usedCount: 0, loc: 0, files: [] },
        sharedCore: { label: 'Shared Core & SDK', size: 0, buildSize: 0, count: 0, usedCount: 0, loc: 0, files: [] },
        scenes: { label: 'Scenes & Prefabs (Compiled JSON)', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
        materials: { label: 'Materials & Effects', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
        fonts: { label: 'Fonts (TTF/BMFont)', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
        engine: { label: 'Cocos Engine Runtime', size: 0, buildSize: 0, count: 1, modules: [] },
        other: { label: 'Configs & Other Assets', size: 0, buildSize: 0, count: 0, usedCount: 0, files: [] },
      },
      oversizedTextures: [],
      exactDuplicates: [],
      perceptualDuplicates: [],
      fbxDiagnostics: [],
      audioDiagnostics: [],
      fontDiagnostics: [],
      fontBudgetViolations: [],
      fontUsage: { usedAssetFonts: 0, multilingualAssetFonts: 0, overBudgetAssetFonts: 0, systemFontFamilies: [] },
      resourceBoundary: null,
      engineDiagnostics: {
        enabledModules: [],
        unusedModules: [],
        estimatedEngineSize: 0,
      },
      quickWins: [],
      healthScore: 100,
    };
  }

  scanAll() {
    this.indexBuildOutput();
    this.scanMetaFiles();
    this.scanAssetFiles();
    this.scanResourceBoundary();
    this.scanEngineSettings();
    this.scanScenesAndPrefabs();
    this.scanRuntimeFontUsage();
    this.analyzeFonts();
    this.analyzeTextureDuplication();
    this.analyzeFbxModels();
    this.finalizeBuildStats();
    this.computeQuickWinsAndHealth();
    return this.stats;
  }

  indexBuildOutput() {
    if (fs.existsSync(this.buildAssetsDir)) {
      this.buildInfo.hasBuild = true;

      const scanDir = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            const size = stat.size;
            const ext = path.extname(entry.name).toLowerCase();
            const base = entry.name;
            const dotIdx = base.lastIndexOf('.');
            const uuidPart = dotIdx > 0 ? base.substring(0, dotIdx) : base;

            this.uuidToBuildMap.set(uuidPart, {
              path: fullPath,
              relPath: toPosix(path.relative(this.projectRoot, fullPath)),
              size,
              ext,
            });
          }
        }
      };

      scanDir(this.buildAssetsDir);

      // Check main script bundle in web-mobile/assets/main/index.js
      const mainBundleJs = path.join(this.buildAssetsDir, 'main', 'index.js');
      if (fs.existsSync(mainBundleJs)) {
        this.stats.categories.scripts.buildSize = fs.statSync(mainBundleJs).size;
      }

      // Check import packs in main
      const mainImportDir = path.join(this.buildAssetsDir, 'main', 'import');
      if (fs.existsSync(mainImportDir)) {
        let packsSize = 0;
        const scanPacks = (d) => {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) scanPacks(p);
            else if (f.name.endsWith('.json')) packsSize += fs.statSync(p).size;
          }
        };
        scanPacks(mainImportDir);
        this.stats.categories.scenes.buildSize = packsSize;
      }

      // Check Cocos engine runtime in web-mobile/cocos-js
      const engineDir = path.join(this.projectRoot, 'build', 'web-mobile', 'cocos-js');
      if (fs.existsSync(engineDir)) {
        let engineSize = 0;
        for (const f of fs.readdirSync(engineDir)) {
          engineSize += fs.statSync(path.join(engineDir, f)).size;
        }
        this.stats.categories.engine.size = engineSize;
        this.stats.categories.engine.buildSize = engineSize;
      }
    }

    // Check build/super-html for single-file HTML & zip outputs
    if (fs.existsSync(this.superHtmlDir)) {
      const channelMap = new Map();
      const artifacts = [];
      const scanSuperHtml = (dir, depth = 0) => {
        if (depth > 2) return;
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) {
            scanSuperHtml(p, depth + 1);
          } else if (f.name.endsWith('.html') || f.name.endsWith('.zip')) {
            const size = fs.statSync(p).size;
            const channel = path.basename(path.dirname(p)).toLowerCase();
            const item = { channel, name: f.name, path: p, size, sizeFormatted: formatBytes(size), ext: path.extname(f.name) };
            artifacts.push(item);
            if (!channelMap.has(channel) || f.name.endsWith('.zip')) {
              channelMap.set(channel, item);
            }
          }
        }
      };
      scanSuperHtml(this.superHtmlDir);
      this.buildInfo.superHtmlArtifacts = artifacts;
      this.buildInfo.channelArtifacts = channelMap;
    }
  }

  scanMetaFiles() {
    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.meta')) {
          try {
            const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            const assetPath = fullPath.slice(0, -5); // remove .meta
            const relPath = toPosix(path.relative(this.projectRoot, assetPath));
            const metaInfo = {
              uuid: content.uuid,
              importer: content.importer,
              subMetas: content.subMetas || {},
              userData: content.userData || {},
              relPath,
              fullPath: assetPath,
            };

            this.uuidMap.set(content.uuid, metaInfo);
            this.pathMap.set(relPath, metaInfo);

            // Index subMetas (SpriteFrames, Textures, Meshes)
            for (const [subKey, subData] of Object.entries(metaInfo.subMetas)) {
              if (subData.uuid) {
                this.uuidMap.set(subData.uuid, {
                  ...subData,
                  parentUuid: content.uuid,
                  parentPath: relPath,
                });

                if (subData.importer === 'sprite-frame') {
                  const assetSize = fs.existsSync(assetPath) ? fs.statSync(assetPath).size : 0;
                  this.spriteFrameMap.set(subData.uuid, {
                    spriteFrameUuid: subData.uuid,
                    parentUuid: content.uuid,
                    relPath,
                    size: assetSize,
                    name: subData.displayName || subData.name || path.basename(relPath),
                    rawWidth: subData.userData?.rawWidth || subData.userData?.width || 0,
                    rawHeight: subData.userData?.rawHeight || subData.userData?.height || 0,
                    trimWidth: subData.userData?.width || 0,
                    trimHeight: subData.userData?.height || 0,
                    isTrimmed: subData.userData?.trimThreshold !== undefined,
                  });
                }
              }
            }
          } catch (e) {
            // ignore corrupt meta
          }
        }
      }
    };

    scanDir(this.assetsDir);
  }

  scanAssetFiles() {
    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && !entry.name.endsWith('.meta')) {
          this.processAssetFile(fullPath);
        }
      }
    };

    scanDir(this.assetsDir);

    // Also scan shared-kit packages for code size
    const sharedPackagesDir = path.join(this.projectRoot, 'playable-shared-kit', 'packages');
    if (fs.existsSync(sharedPackagesDir)) {
      this.scanSharedCode(sharedPackagesDir);
    }
  }

  processAssetFile(fullPath) {
    const relPath = toPosix(path.relative(this.projectRoot, fullPath));
    const ext = path.extname(fullPath).toLowerCase();
    const stat = fs.statSync(fullPath);
    const size = stat.size;
    this.stats.totalSize += size;

    const meta = this.pathMap.get(relPath);
    const uuid = meta ? meta.uuid : null;
    const subMetas = meta ? (meta.subMetas || {}) : {};

    let buildSize = 0;
    let isPackaged = false;
    let buildExt = '';

    if (uuid && this.uuidToBuildMap.has(uuid)) {
      const bFile = this.uuidToBuildMap.get(uuid);
      buildSize += bFile.size;
      isPackaged = true;
      buildExt = bFile.ext;
    }

    for (const subKey of Object.keys(subMetas)) {
      const subUuid = subMetas[subKey].uuid;
      if (subUuid && this.uuidToBuildMap.has(subUuid)) {
        const bFile = this.uuidToBuildMap.get(subUuid);
        buildSize += bFile.size;
        isPackaged = true;
        if (!buildExt) buildExt = bFile.ext;
      }
    }

    const fileRecord = {
      relPath,
      name: path.basename(fullPath),
      size,
      rawSize: size,
      buildSize: isPackaged ? buildSize : 0,
      isPackaged,
      buildExt,
      sizeFormatted: formatBytes(size),
      buildSizeFormatted: isPackaged ? formatBytes(buildSize) : 'Excluded',
      ext,
    };

    let catKey = 'other';
    // 1. Models
    if (['.fbx', '.gltf', '.glb', '.obj'].includes(ext)) {
      catKey = 'models';
    }
    // 2. Textures
    else if (['.png', '.jpg', '.jpeg', '.webp', '.tga', '.pvr'].includes(ext)) {
      catKey = 'textures';
      const buffer = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      fileRecord.sha256 = sha256;

      if (ext === '.png') {
        const decoded = decodePng(buffer);
        if (decoded) {
          fileRecord.width = decoded.width;
          fileRecord.height = decoded.height;
          fileRecord.isOpaque = decoded.isOpaque;
          if (decoded.rgba) {
            const hashes = computeImageHashes(decoded.rgba, decoded.width, decoded.height);
            fileRecord.dHash = hashes.dHash;
            fileRecord.aHash = hashes.aHash;
            fileRecord.dHashBits = hashes.dHashBits;
            fileRecord.avgLum = hashes.avgLum;
            fileRecord.isSolid = hashes.isSolid;
            fileRecord.avgR = hashes.avgR;
            fileRecord.avgG = hashes.avgG;
            fileRecord.avgB = hashes.avgB;
            fileRecord.avgA = hashes.avgA;
            fileRecord.coverage = hashes.coverage;
            fileRecord.contentAspectRatio = hashes.contentAspectRatio;
            fileRecord.aspectRatio = hashes.aspectRatio;
            fileRecord.grid32 = hashes.grid32;
            fileRecord.alphaMask32 = hashes.alphaMask32;
            fileRecord.mean = hashes.mean;
            fileRecord.variance = hashes.variance;
          }
        }
      } else {
        const header = readImageHeader(fullPath, buffer);
        if (header) {
          fileRecord.width = header.width;
          fileRecord.height = header.height;
        }
      }
    }
    // 3. Audio
    else if (['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext)) {
      catKey = 'audio';
      const buffer = fs.readFileSync(fullPath);
      const audioInfo = parseAudioDetails(fullPath, buffer);
      fileRecord.audioInfo = audioInfo;

      if (audioInfo.needsOptimization) {
        this.stats.audioDiagnostics.push({
          relPath,
          size,
          sizeFormatted: formatBytes(size),
          audioInfo,
          estimatedSavings: audioInfo.isUncompressed ? Math.round(size * 0.8) : Math.round(size * 0.35),
        });
      }
    }
    // 4. Scripts
    else if (['.ts', '.js'].includes(ext)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      fileRecord.loc = lines;
      catKey = relPath.includes('/shared/') ? 'sharedCore' : 'scripts';
    }
    // 5. Scenes & Prefabs
    else if (['.scene', '.prefab'].includes(ext)) {
      catKey = 'scenes';
    }
    // 6. Materials & Effects
    else if (['.mat', '.mtl', '.effect', '.chunk'].includes(ext)) {
      catKey = 'materials';
    }
    // 7. Fonts
    else if (['.ttf', '.fnt', '.otf', '.woff'].includes(ext)) {
      catKey = 'fonts';
    }

    const cat = this.stats.categories[catKey];
    cat.size += size;
    cat.count++;
    if (fileRecord.loc) cat.loc = (cat.loc || 0) + fileRecord.loc;
    cat.files.push(fileRecord);
    if (isPackaged) {
      cat.buildSize = (cat.buildSize || 0) + buildSize;
      cat.usedCount = (cat.usedCount || 0) + 1;
    }
  }

  scanSharedCode(dir) {
    const scan = (d) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (['node_modules', 'dist', 'bin', 'build', '.git', 'coverage'].includes(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          const lines = content.split('\n').length;
          const size = fs.statSync(full).size;
          const relPath = toPosix(path.relative(this.projectRoot, full));
          this.stats.categories.sharedCore.files.push({
            relPath,
            name: entry.name,
            size,
            sizeFormatted: formatBytes(size),
            loc: lines,
          });
          this.stats.categories.sharedCore.size += size;
          this.stats.categories.sharedCore.count++;
          this.stats.categories.sharedCore.loc += lines;
        }
      }
    };
    scan(dir);
  }

  // ==========================================
  // 5. SETTINGS & ENGINE AUDIT
  // ==========================================

  scanEngineSettings() {
    const engineConfigPath = path.join(this.settingsDir, 'v2', 'packages', 'engine.json');
    let enabledModules = [];
    let customEngine = false;

    if (fs.existsSync(engineConfigPath)) {
      try {
        const engineData = JSON.parse(fs.readFileSync(engineConfigPath, 'utf8'));
        enabledModules = engineData.modules || [];
        customEngine = engineData.useCustomEngine || false;
      } catch (e) {}
    }

    const estimatedEngineSize = Math.max(800 * 1024, enabledModules.length * 90 * 1024);

    this.stats.engineDiagnostics = {
      enabledModules,
      unusedModules: [],
      estimatedEngineSize,
      customEngine,
    };
    this.stats.categories.engine.modules = enabledModules;
    if (!this.stats.categories.engine.buildSize) {
      this.stats.categories.engine.size = estimatedEngineSize;
      this.stats.categories.engine.buildSize = estimatedEngineSize;
    }
  }

  // ==========================================
  // 6. SCENE / PREFAB OVERSIZED TEXTURE DETECTION
  // ==========================================

  scanScenesAndPrefabs() {
    const sceneFiles = [
      ...this.stats.categories.scenes.files,
    ];

    for (const fileRecord of sceneFiles) {
      const fullPath = path.join(this.projectRoot, fileRecord.relPath);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const objects = JSON.parse(content);
        if (!Array.isArray(objects)) continue;

        this.collectFontUsage(objects);
        this.inspectSceneObjects(fileRecord.relPath, objects);
      } catch (e) {
        // non JSON or parse failure
      }
    }
  }

  collectFontUsage(value) {
    const visit = (item) => {
      if (!item || typeof item !== 'object') return;
      if (typeof item.__uuid__ === 'string') this.referencedAssetUuids.add(item.__uuid__);
      if (item.__type__ === 'cc.Label' || item.__type__ === 'cc.RichText') {
        const fontUuid = item._font?.__uuid__;
        if (fontUuid) this.referencedAssetUuids.add(fontUuid);
        const fontFamily = String(item._fontFamily || '').trim();
        if (!fontUuid && fontFamily) this.systemFontFamilies.add(fontFamily);
        for (const character of String(item._string || '')) this.usedFontCharacters.add(character);
      }
      if (Array.isArray(item)) {
        for (const child of item) visit(child);
      } else {
        for (const child of Object.values(item)) visit(child);
      }
    };
    visit(value);
  }

  resolveRuntimeFontPath(value) {
    const input = String(value || '').trim().replace(/\\/g, '/').replace(/^db:\/\//, '');
    if (!input) return '';
    const catalogPath = this.resourceCatalogPathMap.get(input);
    if (catalogPath && this.pathMap.has(catalogPath)) return catalogPath;
    const base = input.startsWith('assets/') ? input : `assets/resources/${input}`;
    const candidates = path.extname(base)
      ? [base]
      : ['.ttf', '.otf', '.woff', '.fnt'].map((ext) => `${base}${ext}`);
    return candidates.find((candidate) => this.pathMap.has(candidate)) || '';
  }

  scanResourceBoundary() {
    const manifest = path.join(this.projectRoot, 'tools', 'resource-boundary.json');
    if (!fs.existsSync(manifest)) return;
    try {
      const report = auditResourceBoundary(this.projectRoot, 'tools/resource-boundary.json');
      for (const entry of report.entries || []) {
        this.resourceCatalogPathMap.set(entry.key, entry.asset);
        if (entry.type === 'cc.TTFFont') this.runtimeFontPaths.add(entry.asset);
      }
      this.stats.resourceBoundary = {
        status: report.status,
        manifestSha256: report.manifestSha256,
        dynamicRootCount: report.dynamicRootCount,
        dynamicFileCount: report.dynamicFileCount,
        staticCatalogEntryCount: report.staticCatalogEntryCount,
        misplacedStaticCount: report.misplacedStatic.length,
        unclassifiedCount: report.unclassified.length,
        catalog: report.catalog,
        moveStates: report.moveStates,
        errors: report.errors,
      };
    } catch (error) {
      this.stats.resourceBoundary = { status: 'FAIL', errors: [error.message] };
    }
  }

  scanRuntimeFontUsage() {
    const configPath = path.join(this.projectRoot, 'assets', 'resources', 'playable-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
        const visit = (value, key = '') => {
          if (typeof value === 'string' && /font/i.test(key)) {
            const relPath = this.resolveRuntimeFontPath(value);
            if (relPath) this.runtimeFontPaths.add(relPath);
          } else if (Array.isArray(value)) {
            for (const child of value) visit(child, key);
          } else if (value && typeof value === 'object') {
            for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
          }
        };
        visit(config);
      } catch (_) { /* malformed gameplay config is handled by config verification */ }
    }

    const subsetManifestPath = path.join(this.projectRoot, 'tools', 'font-subsets.json');
    if (!fs.existsSync(subsetManifestPath)) return;
    try {
      const manifest = JSON.parse(fs.readFileSync(subsetManifestPath, 'utf8').replace(/^\uFEFF/, ''));
      for (const entry of manifest.fonts || []) {
        const relPath = String(entry.output || '').replace(/\\/g, '/');
        if (!this.pathMap.has(relPath)) continue;
        this.runtimeFontPaths.add(relPath);
        this.fontRequiredCharactersByPath.set(relPath, charactersForEntry(entry));
      }
    } catch (_) { /* font subset verification reports the actionable schema error */ }
  }

  analyzeFonts() {
    const sceneRequiredCharacters = [...this.usedFontCharacters].join('');
    let usedAssetFonts = 0;
    for (const fontFile of this.stats.categories.fonts.files) {
      const meta = this.pathMap.get(fontFile.relPath);
      const isUsed = this.buildInfo.hasBuild
        ? Boolean(fontFile.isPackaged)
        : Boolean((meta?.uuid && this.referencedAssetUuids.has(meta.uuid)) || this.runtimeFontPaths.has(fontFile.relPath));
      fontFile.isUsed = isUsed;
      if (!isUsed) continue;
      usedAssetFonts += 1;
      const requiredCharacters = this.fontRequiredCharactersByPath.get(fontFile.relPath) || sceneRequiredCharacters;
      const fullPath = path.join(this.projectRoot, fontFile.relPath);
      const inspection = inspectFontFile(fullPath, requiredCharacters);
      fontFile.fontInfo = inspection;
      if (fontFile.size > DEFAULT_MAX_BYTES) {
        this.stats.fontBudgetViolations.push({
          relPath: fontFile.relPath,
          size: fontFile.size,
          sizeFormatted: formatBytes(fontFile.size),
          maxBytes: DEFAULT_MAX_BYTES,
          maxBytesFormatted: formatBytes(DEFAULT_MAX_BYTES),
          excessBytes: fontFile.size - DEFAULT_MAX_BYTES,
          excessBytesFormatted: formatBytes(fontFile.size - DEFAULT_MAX_BYTES),
        });
      }
      if (!inspection.multilingual) continue;
      const estimatedSavings = inspection.excessRatio == null
        ? 0
        : Math.max(0, Math.round((fontFile.isPackaged ? (fontFile.buildSize || fontFile.size) : fontFile.size) * inspection.excessRatio * 0.75));
      this.stats.fontDiagnostics.push({
        relPath: fontFile.relPath,
        size: fontFile.size,
        sizeFormatted: formatBytes(fontFile.size),
        buildSize: fontFile.buildSize || 0,
        buildSizeFormatted: formatBytes(fontFile.buildSize || 0),
        isPackaged: fontFile.isPackaged,
        glyphCount: inspection.glyphCount,
        scripts: inspection.scripts,
        requiredCharacterCount: inspection.requiredCharacterCount,
        inventoryResolved: inspection.requiredCharacterCount > 0,
        requiredGlyphs: inspection.requiredGlyphs,
        excessGlyphs: inspection.excessGlyphs,
        excessRatio: inspection.excessRatio,
        estimatedSavings,
        estimatedSavingsFormatted: formatBytes(estimatedSavings),
        reason: inspection.reason,
        error: inspection.error,
      });
    }
    this.stats.fontUsage = {
      usedAssetFonts,
      multilingualAssetFonts: this.stats.fontDiagnostics.length,
      overBudgetAssetFonts: this.stats.fontBudgetViolations.length,
      systemFontFamilies: [...this.systemFontFamilies].sort(),
      detectedCharacters: this.usedFontCharacters.size,
    };
  }

  inspectSceneObjects(scenePath, objects) {
    const nodeMap = new Map();
    const spriteComponents = [];

    objects.forEach((obj, index) => {
      if (!obj) return;
      if (obj.__type__ === 'cc.Node') {
        nodeMap.set(index, {
          name: obj._name || `Node_${index}`,
          parentIndex: obj._parent ? obj._parent.__id__ : null,
          scale: obj._scale ? { x: obj._scale.x || 1, y: obj._scale.y || 1, z: obj._scale.z || 1 } : { x: 1, y: 1, z: 1 },
          uiTransform: null,
        });
      } else if (obj.__type__ === 'cc.UITransform') {
        const nodeIdx = obj.node ? obj.node.__id__ : null;
        if (nodeIdx !== null && nodeMap.has(nodeIdx)) {
          nodeMap.get(nodeIdx).uiTransform = {
            width: obj._contentSize ? obj._contentSize.width : 100,
            height: obj._contentSize ? obj._contentSize.height : 100,
            anchorX: obj._anchorPoint ? obj._anchorPoint.x : 0.5,
            anchorY: obj._anchorPoint ? obj._anchorPoint.y : 0.5,
          };
        }
      } else if (obj.__type__ === 'cc.Sprite') {
        spriteComponents.push({
          index,
          nodeIndex: obj.node ? obj.node.__id__ : null,
          spriteFrame: obj._spriteFrame ? obj._spriteFrame.__uuid__ : null,
          type: obj._type || 0, // 0 = SIMPLE, 1 = SLICED, 2 = TILED, 3 = FILLED
          sizeMode: obj._sizeMode || 0,
        });
      }
    });

    const getNodePath = (idx) => {
      const pathArr = [];
      let cur = idx;
      while (cur !== null && nodeMap.has(cur)) {
        const n = nodeMap.get(cur);
        pathArr.unshift(n.name);
        cur = n.parentIndex;
      }
      return pathArr.join('/');
    };

    const getGlobalScale = (idx) => {
      let scaleX = 1;
      let scaleY = 1;
      let cur = idx;
      while (cur !== null && nodeMap.has(cur)) {
        const n = nodeMap.get(cur);
        scaleX *= Math.abs(n.scale.x);
        scaleY *= Math.abs(n.scale.y);
        cur = n.parentIndex;
      }
      return { x: scaleX, y: scaleY };
    };

    for (const sprite of spriteComponents) {
      if (!sprite.spriteFrame) continue;
      const sfInfo = this.spriteFrameMap.get(sprite.spriteFrame);
      if (!sfInfo) continue;

      const node = nodeMap.get(sprite.nodeIndex);
      if (!node || !node.uiTransform) continue;

      const gScale = getGlobalScale(sprite.nodeIndex);
      const displayW = Math.round(node.uiTransform.width * gScale.x);
      const displayH = Math.round(node.uiTransform.height * gScale.y);

      const rawW = sfInfo.rawWidth || 1;
      const rawH = sfInfo.rawHeight || 1;

      if (displayW <= 0 || displayH <= 0) continue;

      const SPRITE_TYPE_NAMES = ['Simple', 'Sliced', 'Tiled', 'Filled'];
      const spriteType = SPRITE_TYPE_NAMES[sprite.type] || 'Simple';

      if (sprite.type === 1) {
        continue;
      }

      const displayArea = displayW * displayH;
      const rawArea = rawW * rawH;
      const wasteRatio = rawArea / displayArea;

      if (wasteRatio >= this.options.minWasteRatio && rawW > 64 && rawH > 64) {
        const targetW = Math.min(rawW, Math.max(16, Math.ceil((displayW * 1.5) / 16) * 16));
        const targetH = Math.min(rawH, Math.max(16, Math.ceil((displayH * 1.5) / 16) * 16));
        const texFile = this.stats.categories.textures.files.find((f) => f.relPath === sfInfo.relPath);
        const hasBuild = this.buildInfo?.hasBuild;
        const isPackaged = hasBuild && texFile ? texFile.isPackaged : true;
        const effectiveSize = hasBuild ? (isPackaged ? (texFile?.buildSize || sfInfo.size) : 0) : (sfInfo.size || (rawArea * 0.5));
        const estimatedSavings = Math.round((1 - (targetW * targetH) / rawArea) * effectiveSize);

        this.stats.oversizedTextures.push({
          sceneOrPrefab: scenePath,
          nodePath: getNodePath(sprite.nodeIndex),
          texturePath: sfInfo.relPath,
          spriteFrameUuid: sprite.spriteFrame,
          spriteType,
          rawResolution: `${rawW}x${rawH}`,
          displaySize: `${displayW}x${displayH}`,
          wasteRatio: Number(wasteRatio.toFixed(2)),
          recommendedResolution: `${targetW}x${targetH}`,
          estimatedSavings: Math.max(0, estimatedSavings),
          severity: wasteRatio >= 4.0 ? 'CRITICAL' : 'WARN',
          originalSize: sfInfo.size || 0,
          buildSize: texFile?.buildSize || 0,
          isPackaged,
        });
      }
    }

    // Sort oversized textures by actual build savings descending (packaged in build first)
    this.stats.oversizedTextures.sort((a, b) => {
      if (a.isPackaged !== b.isPackaged) return b.isPackaged ? 1 : -1;
      return b.estimatedSavings - a.estimatedSavings;
    });
  }

  // ==========================================
  // 6. ADVANCED DUPLICATE & PERCEPTUAL SIMILARITY
  // ==========================================

  analyzeTextureDuplication() {
    const textures = this.stats.categories.textures.files;
    const shaMap = new Map();

    // 1. Exact Duplicates by SHA-256
    for (const tex of textures) {
      if (!tex.sha256) continue;
      if (!shaMap.has(tex.sha256)) shaMap.set(tex.sha256, []);
      shaMap.get(tex.sha256).push(tex);
    }

    for (const [sha, list] of shaMap.entries()) {
      if (list.length > 1) {
        const totalWastedBytes = list.slice(1).reduce((acc, cur) => {
          const sz = this.buildInfo?.hasBuild ? (cur.isPackaged ? (cur.buildSize || 0) : 0) : cur.size;
          return acc + sz;
        }, 0);
        this.stats.exactDuplicates.push({
          sha256: sha,
          files: list.map((f) => ({
            relPath: f.relPath,
            size: f.size,
            sizeFormatted: formatBytes(f.size),
            buildSize: f.buildSize || 0,
            buildSizeFormatted: formatBytes(f.buildSize || 0),
            isPackaged: f.isPackaged,
          })),
          wastedBytes: totalWastedBytes,
          wastedFormatted: formatBytes(totalWastedBytes),
        });
      }
    }

    // 2. Perceptual Similarity Clustering (SSIM + Silhouette IoU >= minSimilarity)
    const testedPairs = new Set();
    const adj = new Map();
    const texMap = new Map();

    for (let i = 0; i < textures.length; i++) {
      const texA = textures[i];
      if (!texA.grid32) continue;
      texMap.set(texA.relPath, texA);

      for (let j = i + 1; j < textures.length; j++) {
        const texB = textures[j];
        if (!texB.grid32) continue;
        if (texA.sha256 && texA.sha256 === texB.sha256) continue; // skip exact byte duplicates
        texMap.set(texB.relPath, texB);

        const pairKey = `${texA.relPath}<->${texB.relPath}`;
        if (testedPairs.has(pairKey)) continue;
        testedPairs.add(pairKey);

        const similarity = calculateTextureSimilarity(texA, texB);

        if (similarity >= this.options.minSimilarity) {
          if (!adj.has(texA.relPath)) adj.set(texA.relPath, []);
          if (!adj.has(texB.relPath)) adj.set(texB.relPath, []);
          adj.get(texA.relPath).push({ neighbor: texB.relPath, similarity });
          adj.get(texB.relPath).push({ neighbor: texA.relPath, similarity });
        }
      }
    }

    // Extract Connected Clusters
    const visited = new Set();
    let clusterIdx = 1;

    for (const nodePath of adj.keys()) {
      if (visited.has(nodePath)) continue;
      const clusterMembers = [];
      const queue = [nodePath];
      visited.add(nodePath);
      const sims = [];

      while (queue.length > 0) {
        const curPath = queue.shift();
        clusterMembers.push(curPath);
        for (const edge of adj.get(curPath) || []) {
          sims.push(edge.similarity);
          if (!visited.has(edge.neighbor)) {
            visited.add(edge.neighbor);
            queue.push(edge.neighbor);
          }
        }
      }

      if (clusterMembers.length > 1) {
        // Sort members: packaged in build first, then largest size
        const memberObjs = clusterMembers
          .map((p) => texMap.get(p))
          .filter(Boolean)
          .sort((a, b) => {
            if (a.isPackaged !== b.isPackaged) return b.isPackaged ? 1 : -1;
            const aSz = this.buildInfo?.hasBuild ? (a.buildSize || 0) : a.size;
            const bSz = this.buildInfo?.hasBuild ? (b.buildSize || 0) : b.size;
            return bSz - aSz;
          });

        const totalWasted = memberObjs.slice(1).reduce((acc, cur) => {
          const sz = this.buildInfo?.hasBuild ? (cur.isPackaged ? (cur.buildSize || 0) : 0) : cur.size;
          return acc + sz;
        }, 0);

        const avgSim = sims.length > 0 ? Number((sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(1)) : this.options.minSimilarity;

        this.stats.perceptualDuplicates.push({
          groupId: clusterIdx++,
          avgSimilarity: avgSim,
          files: memberObjs.map((f, idx) => ({
            relPath: f.relPath,
            size: f.size,
            sizeFormatted: formatBytes(f.size),
            buildSize: f.buildSize || 0,
            buildSizeFormatted: formatBytes(f.buildSize || 0),
            isPackaged: f.isPackaged,
            res: `${f.width}x${f.height}`,
            isMaster: idx === 0,
          })),
          estimatedSavings: totalWasted,
          estimatedSavingsFormatted: formatBytes(totalWasted),
        });
      }
    }
  }

  // ==========================================
  // 7. FBX EMBEDDED VS EXTERNAL OVERRIDE & POLYGON COUNTS
  // ==========================================

  analyzeFbxModels() {
    // Map of mesh subMeta UUID -> FBX file record
    const meshToFbxMap = new Map();
    for (const fbxFile of this.stats.categories.models.files) {
      const meta = this.pathMap.get(fbxFile.relPath);
      let totalTriangles = 0;
      let totalVertices = 0;

      if (meta && meta.subMetas) {
        for (const [subKey, subData] of Object.entries(meta.subMetas)) {
          if (subData.importer === 'gltf-mesh' || subData.importer === 'mesh') {
            meshToFbxMap.set(subData.uuid, fbxFile);
            if (subData.userData?.triangleCount) totalTriangles += subData.userData.triangleCount;
            if (subData.userData?.vertexCount) totalVertices += subData.userData.vertexCount;
          }
        }
      }
      fbxFile.triangleCount = totalTriangles;
      fbxFile.vertexCount = totalVertices;
    }

    // Inspect scene/prefab MeshRenderers to check for external material overrides
    const fbxOverridesMap = new Map();
    for (const sceneItem of this.stats.categories.scenes.files) {
      const fullPath = path.join(this.projectRoot, sceneItem.relPath);
      try {
        const objects = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (Array.isArray(objects)) {
          for (const obj of objects) {
            if (obj && obj.__type__ === 'cc.MeshRenderer' && obj._mesh && obj._mesh.__uuid__) {
              const meshUuid = obj._mesh.__uuid__;
              const fbxFile = meshToFbxMap.get(meshUuid);
              if (fbxFile) {
                if (!fbxOverridesMap.has(fbxFile.relPath)) {
                  fbxOverridesMap.set(fbxFile.relPath, { count: 0, externalMats: new Set() });
                }
                const record = fbxOverridesMap.get(fbxFile.relPath);
                record.count++;
                if (Array.isArray(obj._materials)) {
                  for (const mat of obj._materials) {
                    if (mat && mat.__uuid__) record.externalMats.add(mat.__uuid__);
                  }
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    for (const fbxFile of this.stats.categories.models.files) {
      const fullPath = path.join(this.projectRoot, fbxFile.relPath);
      try {
        const buffer = fs.readFileSync(fullPath);
        const fbxDetails = parseFbxDetails(fullPath, buffer);

        // Check companion .meta
        const metaPath = `${fullPath}.meta`;
        let hasEmbeddedInMeta = false;
        if (fs.existsSync(metaPath)) {
          const metaContent = fs.readFileSync(metaPath, 'utf8');
          if (metaContent.includes('gltf-embeded-image') || metaContent.includes('"importer": "texture"')) {
            hasEmbeddedInMeta = true;
          }
        }

        const hasEmbeddedTextures = fbxDetails.embeddedTextures.length > 0 || hasEmbeddedInMeta;

        if (hasEmbeddedTextures) {
          const effectiveSize = (this.buildInfo?.hasBuild && fbxFile.isPackaged) ? (fbxFile.buildSize || 0) : fbxFile.size;
          const estimatedSavings = Math.round(effectiveSize * 0.4); // typical ~40-70% savings
          const overrideInfo = fbxOverridesMap.get(fbxFile.relPath);
          this.stats.fbxDiagnostics.push({
            relPath: fbxFile.relPath,
            size: fbxFile.size,
            sizeFormatted: formatBytes(fbxFile.size),
            buildSize: fbxFile.buildSize || 0,
            buildSizeFormatted: formatBytes(fbxFile.buildSize || 0),
            isPackaged: fbxFile.isPackaged,
            embeddedTextures: fbxDetails.embeddedTextures,
            embeddedMaterials: fbxDetails.embeddedMaterials,
            meshCount: fbxFile.triangleCount > 0 ? `${fbxDetails.meshCount || 1} meshes (${fbxFile.triangleCount.toLocaleString()} tris)` : `${fbxDetails.meshCount} meshes`,
            animationClips: fbxDetails.animationClips,
            hasExternalOverride: overrideInfo ? overrideInfo.externalMats.size > 0 : false,
            externalMaterialsCount: overrideInfo ? overrideInfo.externalMats.size : 0,
            estimatedSavings,
            fixCommand: `node playable-shared-kit/tools/strip-fbx-textures.cjs --write "${fbxFile.relPath}"`,
          });
        }
      } catch (e) {
        // non fatal
      }
    }
  }

  finalizeBuildStats() {
    this.stats.buildInfo = this.buildInfo;
    if (!this.buildInfo.hasBuild) {
      this.stats.hasBuildData = false;
      this.stats.totalBuildSize = 0;
      return;
    }

    this.stats.hasBuildData = true;
    let totalBuildAssets = 0;
    for (const [key, cat] of Object.entries(this.stats.categories)) {
      if (key === 'engine') continue;
      totalBuildAssets += (cat.buildSize || 0);
    }
    this.stats.totalBuildAssetSize = totalBuildAssets;
    this.stats.totalBuildWithEngine = totalBuildAssets + (this.stats.categories.engine.buildSize || 0);
    this.stats.totalBuildSize = totalBuildAssets;
  }

  computeQuickWinsAndHealth() {
    let score = 100;
    const wins = [];

    // Win 1: FBX Embedded Texture Strip
    if (this.stats.fbxDiagnostics.length > 0) {
      const totalFbxSavings = this.stats.fbxDiagnostics.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(25, Math.ceil(totalFbxSavings / (50 * 1024)) * 5);
      wins.push({
        title: `Strip Embedded Textures from ${this.stats.fbxDiagnostics.length} FBX Model(s)`,
        category: 'Models',
        potentialSavingsBytes: totalFbxSavings,
        potentialSavingsFormatted: formatBytes(totalFbxSavings),
        impact: 'High',
        action: `node playable-shared-kit/tools/strip-fbx-textures.cjs --write ${this.stats.fbxDiagnostics.map((f) => `"${f.relPath}"`).join(' ')}`,
        explanation: 'FBX models contain embedded texture binary data that is overridden by external materials or never rendered directly.',
      });
    }

    // Win 2: Oversized Textures Downscale
    const activeOversized = this.stats.hasBuildData
      ? this.stats.oversizedTextures.filter((t) => t.isPackaged && t.estimatedSavings > 0)
      : this.stats.oversizedTextures;
    if (activeOversized.length > 0) {
      const criticalOversized = activeOversized.filter((t) => t.severity === 'CRITICAL');
      const totalOversizedSavings = activeOversized.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(25, criticalOversized.length * 8);
      const title = this.stats.hasBuildData
        ? `Downscale ${activeOversized.length} Oversized Texture(s) in Build (>= ${this.options.minWasteRatio}x waste ratio)`
        : `Downscale ${this.stats.oversizedTextures.length} Oversized Textures (>= ${this.options.minWasteRatio}x waste ratio)`;
      wins.push({
        title,
        category: 'Textures',
        potentialSavingsBytes: totalOversizedSavings,
        potentialSavingsFormatted: formatBytes(totalOversizedSavings),
        impact: criticalOversized.length > 0 ? 'Critical' : 'Medium',
        action: 'Resize source image dimensions in graphics editor or adjust Cocos SpriteFrame packable settings.',
        explanation: 'Textures have significantly higher resolution than their rendered UI node size, causing wasted payload and GPU memory in exported build.',
      });
    }

    // Win 3: Audio Downsample / Optimization
    if (this.stats.audioDiagnostics.length > 0) {
      const totalAudioSavings = this.stats.audioDiagnostics.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(20, Math.ceil(totalAudioSavings / (30 * 1024)) * 5);
      wins.push({
        title: `Optimize ${this.stats.audioDiagnostics.length} Audio File(s) to MP3 quality 30 while preserving channels`,
        category: 'Audio',
        potentialSavingsBytes: totalAudioSavings,
        potentialSavingsFormatted: formatBytes(totalAudioSavings),
        impact: 'Medium',
        action: 'npm run sound:optimize -- --write',
        explanation: 'Audio assets have high sample rates, high bitrates, or uncompressed WAV payloads. The portable profile converts to 32kbps MP3 and preserves each source mono/stereo channel count.',
      });
    }

    if (this.stats.fontBudgetViolations.length > 0) {
      const totalFontExcess = this.stats.fontBudgetViolations.reduce((sum, item) => sum + item.excessBytes, 0);
      score -= Math.min(20, this.stats.fontBudgetViolations.length * 10);
      wins.push({
        title: `Bring ${this.stats.fontBudgetViolations.length} Active Font(s) Under the 100 KiB Hard Limit`,
        category: 'Fonts',
        potentialSavingsBytes: totalFontExcess,
        potentialSavingsFormatted: formatBytes(totalFontExcess),
        impact: 'High',
        action: 'npm run font:subset -- --config tools/font-subsets.json --unity-project <UnityProjectRoot> --write',
        explanation: 'Active playable TTF assets target 80 KiB and must not exceed 100 KiB. Generate a source-bound Basic Latin subset, then verify glyph coverage and the exact text ROI.',
      });
    }

    // Informational: used multilingual fonts are usually much larger than the
    // small character set needed by a single-language playable.
    const actionableFontDiagnostics = this.stats.fontDiagnostics.filter((item) => item.inventoryResolved);
    if (actionableFontDiagnostics.length > 0) {
      const totalFontSavings = actionableFontDiagnostics.reduce((sum, item) => sum + item.estimatedSavings, 0);
      wins.push({
        title: `Subset ${actionableFontDiagnostics.length} Used Multilingual Font(s) to Playable Characters`,
        category: 'Fonts',
        potentialSavingsBytes: totalFontSavings,
        potentialSavingsFormatted: formatBytes(totalFontSavings),
        impact: 'Low',
        action: 'Review the Font Diagnostics section and generate a project-specific subset before replacing the source font.',
        explanation: 'These fonts are referenced by the game and include script ranges beyond Basic Latin. A single-language playable can often retain only the characters actually shown by its labels.',
      });
    }

    // Win 4: Duplicate Texture Consolidation
    const totalExactDupFiles = this.stats.exactDuplicates.reduce((acc, c) => acc + c.files.length, 0);
    const totalPerceptualFiles = this.stats.perceptualDuplicates.reduce((acc, c) => acc + c.files.length, 0);
    const totalDupFiles = totalExactDupFiles + totalPerceptualFiles;

    if (this.stats.exactDuplicates.length > 0 || this.stats.perceptualDuplicates.length > 0) {
      const dupSavings = this.stats.exactDuplicates.reduce((acc, c) => acc + c.wastedBytes, 0)
        + this.stats.perceptualDuplicates.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(15, this.stats.exactDuplicates.length * 5 + this.stats.perceptualDuplicates.length * 3);
      wins.push({
        title: `Consolidate ${this.stats.exactDuplicates.length + this.stats.perceptualDuplicates.length} Duplicate / Color Variant Texture Group(s) (${totalDupFiles} textures)`,
        category: 'Textures',
        potentialSavingsBytes: dupSavings,
        potentialSavingsFormatted: formatBytes(dupSavings),
        impact: 'Medium',
        action: 'Wire duplicate / color variant SpriteFrames to a single shared master texture file or shader tinting.',
        explanation: 'Identical or >=90% visually similar texture groups exist across multiple paths, wasting bundle bytes.',
      });
    }

    // Win 5: Unused Engine Modules Check
    if (this.stats.engineDiagnostics.enabledModules.length > 8) {
      wins.push({
        title: 'Prune Unused Cocos Engine Modules in engine.json',
        category: 'Engine',
        potentialSavingsBytes: 250 * 1024,
        potentialSavingsFormatted: '~250 KB',
        impact: 'Medium',
        action: 'Edit settings/v2/packages/engine.json or Cocos Project Settings -> Feature Cropping.',
        explanation: 'Disabling unused 3D Physics or Skeletal Animation modules reduces Cocos engine JS bundle size significantly.',
      });
    }

    // Sort Quick Wins by savings
    wins.sort((a, b) => b.potentialSavingsBytes - a.potentialSavingsBytes);

    this.stats.quickWins = wins;
    this.stats.healthScore = Math.max(10, Math.min(100, score));
  }
}

// ==========================================
// 9. TERMINAL CLI REPORT RENDERER
// ==========================================

function renderCliReport(stats, options) {
  const colors = {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      gray: '\x1b[90m',
    };

    const b = colors.bold;
    const d = colors.dim;
    const g = colors.green;
    const y = colors.yellow;
    const r = colors.red;
    const cy = colors.cyan;
    const gr = colors.gray;

    const totalRawSize = stats.totalSize;
    const hasBuild = stats.hasBuildData;
    const totalBuildAssetSize = stats.totalBuildAssetSize || 0;
    const totalBuildWithEngine = stats.totalBuildWithEngine || 0;

    console.log('\n' + '='.repeat(84));
    console.log(`${b}${cy}🚀 COCOS PLAYABLE ADS - RESOURCE ALLOCATION & BUILD MAPPING REPORT${colors.reset}`);
    console.log('='.repeat(84));

    // Health Score
    let scoreColor = g;
    if (stats.healthScore < 65) scoreColor = r;
    else if (stats.healthScore < 85) scoreColor = y;

    console.log(`\n${b}📊 PLAYABLE HEALTH SCORE: ${scoreColor}${stats.healthScore}/100${colors.reset}`);
    console.log(`  • Raw Source Assets (assets/):         ${formatBytes(totalRawSize).padStart(8)}`);
    if (hasBuild) {
      const reduction = totalRawSize > 0 ? (((totalRawSize - totalBuildAssetSize) / totalRawSize) * 100).toFixed(1) : '0';
      console.log(`  • Exported Build Assets (UUID Mapped):   ${g}${b}${formatBytes(totalBuildAssetSize).padStart(8)}${colors.reset} (-${reduction}% reduction via bin & compression)`);
      console.log(`  • Estimated Web Bundle (with Engine JS): ${b}${formatBytes(totalBuildWithEngine).padStart(8)}${colors.reset}`);
    }
    if ((stats.buildInfo?.packagedSize || 0) > 0) {
      console.log(`  • Packaged Output (${stats.buildInfo.packagedHtmlName}): ${formatBytes(stats.buildInfo.packagedSize)}`);
    }

    // Network Compliance Table
    const NETWORKS = [
      { name: 'Mintegral (Zip)', channel: 'mintegral', limitMB: 5.0 },
      { name: 'Google Ads', channel: 'google', limitMB: 5.0 },
      { name: 'AppLovin', channel: 'applovin', limitMB: 5.0 },
      { name: 'Unity Ads', channel: 'unity', limitMB: 5.0 },
      { name: 'TikTok (Zip)', channel: 'tiktok', limitMB: 5.0 },
      { name: 'Bigo Ads (Zip)', channel: 'bigo', limitMB: 5.0 },
      { name: 'Pangle (Zip)', channel: 'pangle', limitMB: 5.0 },
      { name: 'Liftoff', channel: 'liftoff', limitMB: 5.0 },
      { name: 'IronSource', channel: 'ironsource2025', limitMB: 2.0 },
      { name: 'Facebook Ads', channel: 'facebook', limitMB: 2.0 },
    ];

    const evalSize = hasBuild ? totalBuildWithEngine : totalRawSize;
    const evalLabel = hasBuild ? 'Channel Output / Build Bundle' : 'Raw Source Assets';

    console.log(`\n${b}🌐 AD NETWORK BUDGET STATUS (Evaluated on ${evalLabel}):${colors.reset}`);
    for (const net of NETWORKS) {
      const channelItem = stats.buildInfo?.channelArtifacts?.get(net.channel);
      const targetSize = channelItem ? channelItem.size : evalSize;
      const limitBytes = net.limitMB * 1024 * 1024;
      const isOk = targetSize <= limitBytes;
      const statusIcon = isOk ? `${g}✔ PASS${colors.reset}` : `${r}✖ EXCEEDED${colors.reset}`;
      const pct = ((targetSize / limitBytes) * 100).toFixed(1);
      const sizeFormatted = channelItem ? channelItem.sizeFormatted : formatBytes(targetSize);
      console.log(`  • ${net.name.padEnd(22)} Max: ${net.limitMB}MB | Size: ${sizeFormatted.padStart(8)} | Usage: ${pct.padStart(5)}% | ${statusIcon}`);
    }

    // Category Breakdown Table
    console.log(`\n${b}📦 RESOURCE ALLOCATION & EXPORTED BUILD MAPPING:${colors.reset}`);
    console.log(`  ${'-'.repeat(80)}`);
    console.log(`  ${'CATEGORY'.padEnd(30)} ${'RAW -> BUILD'.padEnd(16)} ${'RAW SIZE'.padStart(10)} ${'BUILD SIZE'.padStart(12)} ${'RATIO'.padStart(8)}`);
    console.log(`  ${'-'.repeat(80)}`);

    for (const [key, cat] of Object.entries(stats.categories)) {
      if (key === 'engine') continue;
      const rawCount = cat.count || 0;
      const usedCount = cat.usedCount !== undefined ? cat.usedCount : (cat.files ? cat.files.filter((f) => f.isPackaged).length : rawCount);
      const countStr = hasBuild ? `${rawCount} -> ${usedCount}` : `${rawCount}`;
      const rawSz = formatBytes(cat.size || 0);
      const buildSz = hasBuild ? (key === 'materials' && (cat.buildSize || 0) === 0 ? 'in-bundle' : (key === 'core' ? 'in-bundle' : (key === 'scripts' ? '1 bundle' : formatBytes(cat.buildSize || 0)))) : '-';
      const ratio = cat.size > 0 && hasBuild ? (((cat.size - (cat.buildSize || 0)) / cat.size) * 100).toFixed(1) : '0';
      const ratioStr = hasBuild ? ((cat.buildSize || 0) <= cat.size ? `-${ratio}%` : `+${Math.abs(ratio)}%`) : '-';

      console.log(`  ${cat.label.padEnd(30)} ${countStr.padEnd(16)} ${rawSz.padStart(10)} ${buildSz.padStart(12)} ${ratioStr.padStart(8)}`);
    }
    console.log(`  ${'-'.repeat(80)}`);
    const totalAssetsRatio = totalRawSize > 0 && hasBuild ? (((totalRawSize - totalBuildAssetSize) / totalRawSize) * 100).toFixed(1) : '0.0';
    console.log(`  ${b}${'TOTAL ASSET FOOTPRINT'.padEnd(30)} ${''.padEnd(16)} ${formatBytes(totalRawSize).padStart(10)} ${(hasBuild ? formatBytes(totalBuildAssetSize) : '-').padStart(12)} ${(hasBuild ? `-${totalAssetsRatio}%` : '-').padStart(8)}${colors.reset}`);
    if (hasBuild && stats.categories.engine.buildSize) {
      console.log(`  ${gr}${'Cocos Engine JS Runtime'.padEnd(30)} ${'1 runtime'.padEnd(16)} ${'-'.padStart(10)} ${formatBytes(stats.categories.engine.buildSize).padStart(12)} ${''.padStart(8)}${colors.reset}`);
      console.log(`  ${b}${cy}${'TOTAL WEB BUNDLE PAYLOAD'.padEnd(30)} ${''.padEnd(16)} ${formatBytes(totalRawSize + stats.categories.engine.buildSize).padStart(10)} ${formatBytes(totalBuildWithEngine).padStart(12)} ${`-${totalAssetsRatio}%`.padStart(8)}${colors.reset}`);
    }

    if (stats.resourceBoundary) {
      const boundary = stats.resourceBoundary;
      const boundaryColor = boundary.status === 'PASS' ? g : r;
      console.log(`\n${b}🧭 RESOURCES DYNAMIC-ROOT BOUNDARY:${colors.reset}`);
      console.log(`  ${boundaryColor}${b}${boundary.status}${colors.reset} | ${boundary.dynamicRootCount || 0} dynamic roots / ${boundary.dynamicFileCount || 0} files | ${boundary.staticCatalogEntryCount || 0} serialized static dependencies`);
      console.log(`  Catalog: ${boundary.catalog?.prefab || 'unresolved'} (${boundary.catalog?.status || 'missing'})`);
      if (boundary.status !== 'PASS') {
        for (const error of (boundary.errors || []).slice(0, 8)) console.log(`  ${r}• ${error}${colors.reset}`);
        console.log(`  ${cy}Run: npm run ai:resources:boundary -- --verify${colors.reset}`);
      }
    }

    // SECTION: Oversized Textures vs Node Transforms
    if (stats.oversizedTextures.length > 0) {
      const packagedCount = stats.oversizedTextures.filter((t) => t.isPackaged).length;
      const excludedCount = stats.oversizedTextures.length - packagedCount;
      const titleSuffix = stats.hasBuildData ? ` (${packagedCount} in build, ${excludedCount} excluded)` : ` (${stats.oversizedTextures.length} found)`;

      console.log(`\n${b}⚠️  OVERSIZED TEXTURES VS NODE TRANSFORMS${titleSuffix}:${colors.reset}`);
      console.log(`  ${d}Textures with resolution significantly larger than their rendered UI node contentSize * scale.${colors.reset}`);
      console.log(`  ${'-'.repeat(74)}`);

      stats.oversizedTextures.slice(0, 10).forEach((item, idx) => {
        const sevTag = item.severity === 'CRITICAL' ? `${r}[CRITICAL ${item.wasteRatio}x]${colors.reset}` : `${y}[WARN ${item.wasteRatio}x]${colors.reset}`;
        console.log(`  ${idx + 1}. ${sevTag} ${b}${path.basename(item.texturePath)}${colors.reset} in ${cy}${item.sceneOrPrefab}${colors.reset}`);
        console.log(`     Node: ${item.nodePath} (${item.spriteType})`);
        if (stats.hasBuildData) {
          if (item.isPackaged) {
            console.log(`     Exported Texture: ${item.rawResolution} (${formatBytes(item.buildSize)} WebP) [Raw: ${formatBytes(item.originalSize)}] -> Display Size: ${item.displaySize}`);
            console.log(`     ${g}→ Recommended: ${item.recommendedResolution} (Save ~${formatBytes(item.estimatedSavings)} in exported build)${colors.reset}`);
          } else {
            console.log(`     Source Texture: ${item.rawResolution} (${formatBytes(item.originalSize)}) [Excluded from build] -> Display Size: ${item.displaySize}`);
            console.log(`     ${d}→ Recommended: ${item.recommendedResolution} (Already excluded from build, 0 B in build)${colors.reset}`);
          }
        } else {
          console.log(`     Raw Texture: ${item.rawResolution} (${formatBytes(item.originalSize)}) -> Display Size: ${item.displaySize}`);
          console.log(`     ${g}→ Recommended: ${item.recommendedResolution} (Save ~${formatBytes(item.estimatedSavings)})${colors.reset}`);
        }
      });
      if (stats.oversizedTextures.length > 10) {
        console.log(`  ${d}... and ${stats.oversizedTextures.length - 10} more. Run with --html to inspect full list.${colors.reset}`);
      }
    }

    // SECTION: Duplicate & Perceptual Similarities
    if (stats.exactDuplicates.length > 0 || stats.perceptualDuplicates.length > 0) {
      console.log(`\n${b}🔍 DUPLICATE & PERCEPTUALLY SIMILAR TEXTURES:${colors.reset}`);
      if (stats.exactDuplicates.length > 0) {
        console.log(`  ${r}• Exact Byte Duplicates (100% SHA-256 match):${colors.reset}`);
        stats.exactDuplicates.forEach((dup, i) => {
          const wastedStr = stats.hasBuildData ? `${formatBytes(dup.wastedBytes)} in build` : formatBytes(dup.wastedBytes);
          console.log(`    [Group ${i + 1}] Wasted: ${wastedStr}`);
          dup.files.forEach((f) => {
            const szStr = stats.hasBuildData ? (f.isPackaged ? `build: ${f.buildSizeFormatted}` : `raw: ${f.sizeFormatted} [Excluded]`) : f.sizeFormatted;
            console.log(`      - ${f.relPath} (${szStr})`);
          });
        });
      }

      if (stats.perceptualDuplicates.length > 0) {
        console.log(`  ${y}• Visually Similar Texture Groups (>= ${options.minSimilarity}% match via Structural SSIM & Silhouette IoU):${colors.reset}`);
        stats.perceptualDuplicates.slice(0, 8).forEach((group, i) => {
          const saveStr = stats.hasBuildData ? `Save ~${group.estimatedSavingsFormatted} in build` : `Save ~${group.estimatedSavingsFormatted}`;
          console.log(`    [Group ${group.groupId || (i + 1)}] ${group.files.length} textures | Avg Similarity: ${b}${y}${group.avgSimilarity}%${colors.reset} (${saveStr})`);
          group.files.forEach((f) => {
            const szStr = stats.hasBuildData ? (f.isPackaged ? `build: ${f.buildSizeFormatted}` : `raw: ${f.sizeFormatted} [Excluded]`) : f.sizeFormatted;
            const masterTag = f.isMaster ? ` ${g}[Master]${colors.reset}` : '';
            console.log(`      - ${f.relPath} (${f.res}, ${szStr})${masterTag}`);
          });
        });
      }
    }

  // SECTION: FBX Deep Diagnostics
  if (stats.fbxDiagnostics.length > 0) {
    console.log(`\n${b}🧊 FBX EMBEDDED ASSET DIAGNOSTICS:${colors.reset}`);
    stats.fbxDiagnostics.forEach((fbx, i) => {
      const fbxSizeStr = stats.hasBuildData ? (fbx.isPackaged ? `Build: ${fbx.buildSizeFormatted} | Raw: ${fbx.sizeFormatted}` : `Raw: ${fbx.sizeFormatted} [Excluded]`) : fbx.sizeFormatted;
      console.log(`  ${i + 1}. ${b}${fbx.relPath}${colors.reset} (${fbxSizeStr})`);
      console.log(`     Embedded Textures: ${fbx.embeddedTextures.join(', ') || 'None'}`);
      console.log(`     ${g}→ Quick Fix: ${fbx.fixCommand}${colors.reset}`);
    });
  }

  // SECTION: Audio Diagnostics
  if (stats.audioDiagnostics.length > 0) {
    console.log(`\n${b}🎵 AUDIO OPTIMIZATION OPPORTUNITIES:${colors.reset}`);
    stats.audioDiagnostics.forEach((a, i) => {
      const aSizeStr = stats.hasBuildData ? (a.isPackaged ? `Build: ${a.buildSizeFormatted} | Raw: ${a.sizeFormatted}` : a.sizeFormatted) : a.sizeFormatted;
      console.log(`  ${i + 1}. ${b}${a.relPath}${colors.reset} (${aSizeStr}) - ${a.audioInfo.format} ${a.audioInfo.sampleRate}Hz ${a.audioInfo.channelLabel}`);
      console.log(`     ${y}Issue: ${a.audioInfo.reason.join('; ')}${colors.reset}`);
    });
    console.log(`  ${g}→ Run: npm run sound:optimize -- --write${colors.reset}`);
  }

  // SECTION: Used multilingual fonts
  if (stats.fontDiagnostics.length > 0 || stats.fontBudgetViolations.length > 0 || stats.fontUsage.systemFontFamilies.length > 0) {
    console.log(`\n${b}🔤 FONT LANGUAGE-COVERAGE DIAGNOSTICS:${colors.reset}`);
    console.log(`  ${d}Fonts referenced by scenes/prefabs, playable config, subset manifest, or the current build are reported.${colors.reset}`);
    for (const [index, font] of stats.fontBudgetViolations.entries()) {
      console.log(`  ${index + 1}. ${r}${b}OVER BUDGET${colors.reset} ${font.relPath}: ${font.sizeFormatted} > ${font.maxBytesFormatted}`);
      console.log(`     ${y}Run the source-bound font subset workflow; do not replace the family without a visual oracle.${colors.reset}`);
    }
    for (const [index, font] of stats.fontDiagnostics.entries()) {
      const ratio = font.excessRatio == null ? 'unknown' : `${Math.round(font.excessRatio * 100)}%`;
      console.log(`  ${index + 1}. ${b}${font.relPath}${colors.reset} (${font.sizeFormatted})`);
      console.log(`     Scripts: ${font.scripts.join(', ')} | Glyphs: ${font.glyphCount.toLocaleString()} | estimated excess: ${ratio}`);
      if (font.inventoryResolved) {
        console.log(`     ${y}Used multilingual font: consider subsetting to ${font.requiredCharacterCount} detected playable character(s).${colors.reset}`);
      } else {
        console.log(`     ${y}Character inventory unresolved: add a source-bound font subset manifest before optimizing this font.${colors.reset}`);
      }
      if (font.error) console.log(`     ${y}Inspection note: ${font.error}${colors.reset}`);
    }
    if (stats.fontUsage.systemFontFamilies.length > 0) {
      console.log(`  ${d}System font families (not bundled font assets): ${stats.fontUsage.systemFontFamilies.join(', ')}${colors.reset}`);
    }
  }

  // SECTION: Top Quick Wins
  if (stats.quickWins.length > 0) {
    console.log(`\n${b}${g}🎯 TOP QUICK WINS (HIGHEST SIZE REDUCTION IMPACT):${colors.reset}`);
    stats.quickWins.slice(0, 5).forEach((win, i) => {
      const saveLabel = stats.hasBuildData ? `Est. Build Savings: ${g}${b}${win.potentialSavingsFormatted}${colors.reset}` : `Est. Savings: ${g}${b}${win.potentialSavingsFormatted}${colors.reset}`;
      console.log(`\n  ${b}${i + 1}. [${win.category}] ${win.title}${colors.reset}`);
      console.log(`     ${saveLabel} | Impact: ${win.impact}`);
      console.log(`     ${d}${win.explanation}${colors.reset}`);
      if (win.action.startsWith('npm ') || win.action.startsWith('node ')) {
        console.log(`     ${cy}Run: ${win.action}${colors.reset}`);
      }
    });
  }

  console.log('\n' + '='.repeat(78) + '\n');
}

// ==========================================
// 10. INTERACTIVE HTML REPORT GENERATOR
// ==========================================

function generateHtmlReport(stats, options, outputPath) {
  const totalRawSize = stats.totalSize;
  const totalWithEngine = totalRawSize + stats.engineDiagnostics.estimatedEngineSize;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cocos Playable Resource Allocation & Size Optimization Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --accent: #818cf8;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }
    .container { max-width: 1280px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 2rem;
    }
    h1 { font-size: 1.75rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 0.5rem; }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
    }
    .card-title { font-size: 0.875rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .card-value { font-size: 2rem; font-weight: 700; color: var(--text); }
    .card-subtitle { font-size: 0.875rem; color: var(--text-muted); margin-top: 0.25rem; }
    
    .score-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 4.5rem;
      height: 4.5rem;
      border-radius: 50%;
      font-size: 1.75rem;
      font-weight: 800;
      border: 4px solid currentColor;
    }
    .score-green { color: var(--success); }
    .score-yellow { color: var(--warning); }
    .score-red { color: var(--danger); }

    /* Tables */
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
    th { padding: 0.75rem 1rem; background: rgba(0,0,0,0.2); color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--card-border); }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--card-border); }
    tr:hover td { background: rgba(255,255,255,0.02); }

    .tag {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .tag-critical { background: rgba(248, 113, 113, 0.2); color: var(--danger); }
    .tag-warn { background: rgba(251, 191, 36, 0.2); color: var(--warning); }
    .tag-pass { background: rgba(52, 211, 153, 0.2); color: var(--success); }

    .quick-win-item {
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .quick-win-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .quick-win-title { font-weight: 600; font-size: 1rem; color: var(--text); }
    .quick-win-savings { color: var(--success); font-weight: 700; font-size: 0.9rem; }
    .cmd-box {
      background: #090d16;
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--primary);
      margin-top: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .copy-btn {
      background: #334155;
      border: none;
      color: #fff;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .copy-btn:hover { background: #475569; }

    .progress-bar-container { background: #334155; border-radius: 999px; height: 8px; width: 100%; overflow: hidden; margin-top: 0.5rem; }
    .progress-bar { height: 100%; border-radius: 999px; }

    section { margin-bottom: 2.5rem; }
    h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🚀 Cocos Playable Resource Stats & Optimizer</h1>
        <div class="subtitle">Detailed breakdown of 3D models, textures, audio, engine modules, and UI transform scaling</div>
      </div>
      <div>
        <div class="score-badge ${stats.healthScore >= 85 ? 'score-green' : (stats.healthScore >= 65 ? 'score-yellow' : 'score-red')}">
          ${stats.healthScore}
        </div>
      </div>
    </header>

    <!-- Top KPI Cards -->
    <div class="grid">
      <div class="card">
        <div class="card-title">Raw Source Assets</div>
        <div class="card-value">${formatBytes(totalRawSize)}</div>
        <div class="card-subtitle">Full uncompressed project assets</div>
      </div>
      <div class="card">
        <div class="card-title">Exported Build Assets</div>
        <div class="card-value" style="color: var(--success);">${formatBytes(stats.totalBuildAssetSize || totalRawSize)}</div>
        <div class="card-subtitle">With Engine: ~${formatBytes(stats.totalBuildWithEngine || totalWithEngine)}</div>
      </div>
      <div class="card">
        <div class="card-title">Oversized Textures</div>
        <div class="card-value" style="color: ${stats.oversizedTextures.length > 0 ? 'var(--warning)' : 'var(--success)'};">
          ${stats.oversizedTextures.length}
        </div>
        <div class="card-subtitle">>= ${options.minWasteRatio}x display area waste</div>
      </div>
      <div class="card">
        <div class="card-title">Duplicate Textures</div>
        <div class="card-value" style="color: ${(stats.exactDuplicates.length + stats.perceptualDuplicates.length) > 0 ? 'var(--warning)' : 'var(--success)'};">
          ${stats.exactDuplicates.length + stats.perceptualDuplicates.length}
        </div>
        <div class="card-subtitle">${stats.exactDuplicates.length} exact, ${stats.perceptualDuplicates.length} visually similar</div>
      </div>
    </div>

    <!-- Quick Wins -->
    <section>
      <h2>🎯 Recommended Quick Wins (Highest ROI)</h2>
      <div class="card">
        ${stats.quickWins.map((win) => `
          <div class="quick-win-item">
            <div class="quick-win-header">
              <div class="quick-win-title">[${win.category}] ${win.title}</div>
              <div class="quick-win-savings">Save ~${win.potentialSavingsFormatted}</div>
            </div>
            <div style="font-size: 0.875rem; color: var(--text-muted);">${win.explanation}</div>
            ${win.action.startsWith('npm ') || win.action.startsWith('node ') ? `
              <div class="cmd-box">
                <code>${win.action}</code>
                <button class="copy-btn" onclick="navigator.clipboard.writeText('${win.action.replace(/'/g, "\\'")}')">Copy</button>
              </div>
            ` : `<div style="font-size: 0.85rem; color: var(--primary); margin-top: 0.5rem;">💡 ${win.action}</div>`}
          </div>
        `).join('')}
      </div>
    </section>

    <!-- Resource Allocation Table -->
    <section>
      <h2>📦 Resource Allocation & Exported Build Mapping</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Count (Raw -> In-Build)</th>
              <th>Raw Source Size</th>
              <th>Exported Build Size</th>
              <th>Savings / Ratio</th>
              <th>Build Share</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(stats.categories).filter(([k]) => k !== 'engine').map(([key, cat]) => {
              const rawSz = cat.size || 0;
              const buildSz = cat.buildSize || 0;
              const rawCount = cat.count || 0;
              const usedCount = cat.usedCount !== undefined ? cat.usedCount : (cat.files ? cat.files.filter(f => f.isPackaged).length : rawCount);
              const ratio = rawSz > 0 && stats.hasBuildData ? (((rawSz - buildSz) / rawSz) * 100).toFixed(1) : 0;
              const ratioStr = stats.hasBuildData ? (buildSz <= rawSz ? `-${ratio}%` : `+${Math.abs(ratio)}%`) : '-';
              const buildSharePct = stats.totalBuildAssetSize > 0 ? ((buildSz / stats.totalBuildAssetSize) * 100).toFixed(1) : 0;
              const buildSzFormatted = stats.hasBuildData ? (key === 'materials' && buildSz === 0 ? 'in-pack' : formatBytes(buildSz)) : '-';

              return `
                <tr>
                  <td><strong>${cat.label}</strong></td>
                  <td>${rawCount} -> ${usedCount}</td>
                  <td>${formatBytes(rawSz)}</td>
                  <td><strong style="color: var(--success);">${buildSzFormatted}</strong></td>
                  <td><span class="tag ${buildSz < rawSz ? 'tag-pass' : 'tag-warn'}">${ratioStr}</span></td>
                  <td style="width: 200px;">
                    <div class="progress-bar-container">
                      <div class="progress-bar" style="width: ${buildSharePct}%; background: var(--primary);"></div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Ad Network Compliance & Channel Artifacts -->
    <section>
      <h2>🌐 Ad Network Budget Compliance & Channel Artifacts</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Ad Network</th>
              <th>Channel Package / Artifact</th>
              <th>Network Limit</th>
              <th>Package Size</th>
              <th>Budget Usage</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${[
              { name: 'Mintegral (Zip)', channel: 'mintegral', limitMB: 5.0 },
              { name: 'Google Ads', channel: 'google', limitMB: 5.0 },
              { name: 'AppLovin', channel: 'applovin', limitMB: 5.0 },
              { name: 'Unity Ads', channel: 'unity', limitMB: 5.0 },
              { name: 'TikTok (Zip)', channel: 'tiktok', limitMB: 5.0 },
              { name: 'Bigo Ads (Zip)', channel: 'bigo', limitMB: 5.0 },
              { name: 'Pangle (Zip)', channel: 'pangle', limitMB: 5.0 },
              { name: 'Liftoff', channel: 'liftoff', limitMB: 5.0 },
              { name: 'IronSource', channel: 'ironsource2025', limitMB: 2.0 },
              { name: 'Facebook Ads', channel: 'facebook', limitMB: 2.0 },
            ].map((net) => {
              const channelItem = stats.buildInfo?.channelArtifacts?.get(net.channel);
              const targetSize = channelItem ? channelItem.size : (stats.totalBuildWithEngine || totalWithEngine);
              const limitBytes = net.limitMB * 1024 * 1024;
              const isOk = targetSize <= limitBytes;
              const pct = ((targetSize / limitBytes) * 100).toFixed(1);
              const artName = channelItem ? channelItem.name : (stats.hasBuildData ? 'web-mobile bundle' : 'raw source assets');

              return `
                <tr>
                  <td><strong>${net.name}</strong></td>
                  <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-muted);">${artName}</td>
                  <td>${net.limitMB} MB</td>
                  <td><strong>${formatBytes(targetSize)}</strong></td>
                  <td>${pct}%</td>
                  <td><span class="tag ${isOk ? 'tag-pass' : 'tag-critical'}">${isOk ? '✔ PASS' : '✖ EXCEEDED'}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Oversized Textures vs Node Transforms -->
    <section>
      <h2>⚠️ Oversized Textures vs Rendered Node Transforms</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Texture & Scene</th>
              <th>Node Hierarchy</th>
              <th>Raw Resolution</th>
              <th>Rendered Display Size</th>
              <th>Waste Ratio</th>
              <th>Recommended Size</th>
              <th>Est. Build Savings</th>
            </tr>
          </thead>
          <tbody>
            ${stats.oversizedTextures.length === 0 ? `
              <tr><td colspan="7" style="text-align: center; color: var(--success); padding: 2rem;">✔ All textures match their node transformations efficiently!</td></tr>
            ` : stats.oversizedTextures.map((item) => `
              <tr>
                <td>
                  <strong>${path.basename(item.texturePath)}</strong>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${item.sceneOrPrefab}</div>
                </td>
                <td style="font-family: monospace; font-size: 0.8rem;">${item.nodePath} (${item.spriteType})</td>
                <td>${item.rawResolution}</td>
                <td>${item.displaySize}</td>
                <td><span class="tag ${item.severity === 'CRITICAL' ? 'tag-critical' : 'tag-warn'}">${item.wasteRatio}x</span></td>
                <td style="color: var(--success); font-weight: 600;">${item.recommendedResolution}</td>
                <td style="color: var(--success);">~${formatBytes(item.estimatedSavings)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Duplicate & Perceptual Similarities -->
    <section>
      <h2>🔍 Duplicate & Perceptually Similar Texture Groups (>= ${options.minSimilarity}%)</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Group Type</th>
              <th>Group Members</th>
              <th>Count</th>
              <th>Avg Similarity</th>
              <th>Est. Build Savings</th>
            </tr>
          </thead>
          <tbody>
            ${stats.exactDuplicates.map((dup, i) => `
              <tr>
                <td><span class="tag tag-critical">100% Exact [Group ${i + 1}]</span></td>
                <td>
                  ${dup.files.map((f, idx) => `
                    <div style="font-family: monospace; font-size: 0.8rem; margin-bottom: 2px;">
                      ${idx === 0 ? '<strong style="color: var(--primary);">' : ''}${f.relPath}${idx === 0 ? ' [Master]</strong>' : ''}
                      <span style="color: var(--text-muted);">(${f.isPackaged ? `build: ${f.buildSizeFormatted}` : `raw: ${f.sizeFormatted} [Excluded]`})</span>
                    </div>
                  `).join('')}
                </td>
                <td>${dup.files.length} files</td>
                <td>100.0%</td>
                <td style="color: var(--success); font-weight: bold;">~${dup.wastedFormatted}</td>
              </tr>
            `).join('')}
            ${stats.perceptualDuplicates.map((group) => `
              <tr>
                <td><span class="tag tag-warn">Visual Group ${group.groupId}</span></td>
                <td>
                  ${group.files.map((f, idx) => `
                    <div style="font-family: monospace; font-size: 0.8rem; margin-bottom: 2px;">
                      ${idx === 0 ? '<strong style="color: var(--primary);">' : ''}${f.relPath}${idx === 0 ? ' [Master]</strong>' : ''}
                      <span style="color: var(--text-muted);">(${f.res}, ${f.isPackaged ? `build: ${f.buildSizeFormatted}` : `raw: ${f.sizeFormatted} [Excluded]`})</span>
                    </div>
                  `).join('')}
                </td>
                <td>${group.files.length} textures</td>
                <td><strong>${group.avgSimilarity}%</strong></td>
                <td style="color: var(--success); font-weight: bold;">~${group.estimatedSavingsFormatted}</td>
              </tr>
            `).join('')}
            ${stats.exactDuplicates.length === 0 && stats.perceptualDuplicates.length === 0 ? `
              <tr><td colspan="5" style="text-align: center; color: var(--success); padding: 2rem;">✔ No duplicate or near-identical textures detected!</td></tr>
            ` : ''}
          </tbody>
        </table>
      </div>
    </section>

    <!-- FBX Diagnostics -->
    <section>
      <h2>🧊 FBX Embedded Textures & Materials</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>FBX Model Path</th>
              <th>File Size</th>
              <th>Embedded Textures</th>
              <th>Meshes / Clips</th>
              <th>Quick Strip Action</th>
            </tr>
          </thead>
          <tbody>
            ${stats.fbxDiagnostics.length === 0 ? `
              <tr><td colspan="5" style="text-align: center; color: var(--success); padding: 2rem;">✔ All FBX models are cleanly stripped with zero embedded texture bloat!</td></tr>
            ` : stats.fbxDiagnostics.map((fbx) => `
              <tr>
                <td><strong>${fbx.relPath}</strong></td>
                <td>${fbx.sizeFormatted}</td>
                <td style="color: var(--warning);">${fbx.embeddedTextures.join(', ') || 'Embedded in meta'}</td>
                <td>${fbx.meshCount} meshes, ${fbx.animationClips.length} clips</td>
                <td>
                  <div class="cmd-box" style="margin: 0;">
                    <code>${fbx.fixCommand}</code>
                    <button class="copy-btn" onclick="navigator.clipboard.writeText('${fbx.fixCommand.replace(/'/g, "\\'")}')">Copy</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Used multilingual font diagnostics -->
    <section>
      <h2>🔤 Used Font Language Coverage</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Used Font Asset</th>
              <th>Scripts</th>
              <th>Glyphs</th>
              <th>Detected Playable Characters</th>
              <th>Est. Subset Opportunity</th>
            </tr>
          </thead>
          <tbody>
            ${stats.fontDiagnostics.length === 0 ? `
              <tr><td colspan="5" style="text-align: center; color: var(--success); padding: 2rem;">✔ No used bundled font with multilingual coverage was detected.</td></tr>
            ` : stats.fontDiagnostics.map((font) => `
              <tr>
                <td><strong>${font.relPath}</strong><div style="color: var(--text-muted); font-size: 0.75rem;">${font.sizeFormatted}</div></td>
                <td>${font.scripts.join(', ')}</td>
                <td>${font.glyphCount.toLocaleString()}</td>
                <td>${font.requiredCharacterCount}</td>
                <td style="color: var(--warning);">${font.excessRatio == null ? 'Inspect manually' : `${Math.round(font.excessRatio * 100)}% glyphs outside detected label set (~${font.estimatedSavingsFormatted})`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${stats.fontUsage.systemFontFamilies.length > 0 ? `<div class="subtitle" style="margin-top: 0.75rem;">System fonts (not bundled): ${stats.fontUsage.systemFontFamilies.join(', ')}</div>` : ''}
    </section>

  </div>
</body>
</html>`;

  const outDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(path.resolve(outputPath), html, 'utf8');
}

// ==========================================
// 11. MAIN ENTRY POINT
// ==========================================

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const projectRoot = options.projectRoot || findProjectRoot(process.cwd()) || process.cwd();

  if (options.doctor) {
    console.log(`[resource-stats] Running doctor checks on ${projectRoot}...`);
    const hasAssets = fs.existsSync(path.join(projectRoot, 'assets'));
    const hasSettings = fs.existsSync(path.join(projectRoot, 'settings'));
    const hasSharedKit = fs.existsSync(path.join(projectRoot, 'playable-shared-kit'));

    console.log(`  • Assets directory: ${hasAssets ? colors.green + 'OK' : colors.red + 'MISSING'}${colors.reset}`);
    console.log(`  • Settings directory: ${hasSettings ? colors.green + 'OK' : colors.yellow + 'OPTIONAL'}${colors.reset}`);
    console.log(`  • Shared kit directory: ${hasSharedKit ? colors.green + 'OK' : colors.red + 'MISSING'}${colors.reset}`);
    console.log(`[resource-stats] Doctor checks complete.`);
    process.exit(0);
  }

  const auditor = new PlayableResourceStats(projectRoot, options);
  const stats = auditor.scanAll();

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    renderCliReport(stats, options);
  }

  if (options.html) {
    generateHtmlReport(stats, options, options.htmlPath);
    console.log(`[resource-stats] ✨ HTML Report generated at: ${colors.green}${path.resolve(options.htmlPath)}${colors.reset}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  PlayableResourceStats,
  decodePng,
  computeImageHashes,
  calculateTextureSimilarity,
  parseFbxDetails,
  parseAudioDetails,
  renderCliReport,
};
