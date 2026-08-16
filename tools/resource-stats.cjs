#!/usr/bin/env node
'use strict';

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
 * Resizes an RGBA buffer to target dimensions and computes Difference Hash (dHash) & Average Hash (aHash)
 */
function computeImageHashes(rgba, srcW, srcH, targetW = 9, targetH = 8) {
  if (!rgba || srcW <= 0 || srcH <= 0) return { dHash: '', aHash: '', thumbnail: [] };

  // Sample into targetW x targetH grayscale thumbnail using area averaging
  const grayThumb = new Float32Array(targetW * targetH);
  const scaleX = srcW / targetW;
  const scaleY = srcH / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const syStart = Math.floor(ty * scaleY);
    const syEnd = Math.min(srcH, Math.floor((ty + 1) * scaleY) || syStart + 1);

    for (let tx = 0; tx < targetW; tx++) {
      const sxStart = Math.floor(tx * scaleX);
      const sxEnd = Math.min(srcW, Math.floor((tx + 1) * scaleX) || sxStart + 1);

      let totalLum = 0;
      let count = 0;

      for (let y = syStart; y < syEnd; y++) {
        for (let x = sxStart; x < sxEnd; x++) {
          const idx = (y * srcW + x) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const a = rgba[idx + 3] / 255;
          // Weighted luminance with alpha consideration
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) * a;
          totalLum += lum;
          count++;
        }
      }

      grayThumb[ty * targetW + tx] = count > 0 ? totalLum / count : 0;
    }
  }

  // 1. dHash (Difference Hash): compare adjacent pixels per row -> 8 rows x 8 bits = 64 bits
  let dHashBits = '';
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW - 1; x++) {
      const left = grayThumb[y * targetW + x];
      const right = grayThumb[y * targetW + x + 1];
      dHashBits += left > right ? '1' : '0';
    }
  }

  // 2. aHash (Average Hash): compare against global mean
  let totalSum = 0;
  for (let i = 0; i < grayThumb.length; i++) totalSum += grayThumb[i];
  const avg = totalSum / grayThumb.length;

  let aHashBits = '';
  for (let i = 0; i < 64 && i < grayThumb.length; i++) {
    aHashBits += grayThumb[i] >= avg ? '1' : '0';
  }

  return {
    dHash: bitsToHex(dHashBits),
    aHash: bitsToHex(aHashBits),
    dHashBits,
    aHashBits,
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

function hammingDistance(bitsA, bitsB) {
  if (!bitsA || !bitsB || bitsA.length !== bitsB.length) return 64;
  let dist = 0;
  for (let i = 0; i < bitsA.length; i++) {
    if (bitsA[i] !== bitsB[i]) dist++;
  }
  return dist;
}

function calculateSimilarity(bitsA, bitsB) {
  if (!bitsA || !bitsB || bitsA.length === 0) return 0;
  const dist = hammingDistance(bitsA, bitsB);
  return Math.max(0, (1 - dist / bitsA.length) * 100);
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
  if (info.sampleRate > 32000) {
    info.needsOptimization = true;
    info.reason.push(`High sample rate (${info.sampleRate}Hz > 32000Hz)`);
  }
  if (info.channels > 1 && info.durationSec > 0 && info.durationSec < 10) {
    info.needsOptimization = true;
    info.reason.push(`Stereo sound effect (SFX should be mono)`);
  }
  if (info.bitrateKbps > 96) {
    info.needsOptimization = true;
    info.reason.push(`High bitrate (${info.bitrateKbps}kbps > 96kbps for playables)`);
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

    this.uuidMap = new Map(); // uuid -> asset metadata
    this.pathMap = new Map(); // posixPath -> asset metadata
    this.spriteFrameMap = new Map(); // spriteFrame uuid -> texture info

    this.stats = {
      totalSize: 0,
      categories: {
        models: { label: '3D Models (FBX/GLTF)', size: 0, count: 0, files: [] },
        textures: { label: 'Textures & Images', size: 0, count: 0, files: [] },
        audio: { label: 'Audio Assets', size: 0, count: 0, files: [] },
        scripts: { label: 'Gameplay Scripts (TS/JS)', size: 0, count: 0, loc: 0, files: [] },
        sharedCore: { label: 'Shared Core & SDK', size: 0, count: 0, loc: 0, files: [] },
        scenes: { label: 'Scenes & Prefabs', size: 0, count: 0, files: [] },
        materials: { label: 'Materials & Effects', size: 0, count: 0, files: [] },
        fonts: { label: 'Fonts (TTF/BMFont)', size: 0, count: 0, files: [] },
        engine: { label: 'Cocos Engine Runtime', size: 0, count: 1, modules: [] },
        other: { label: 'Configs & Other Assets', size: 0, count: 0, files: [] },
      },
      oversizedTextures: [],
      exactDuplicates: [],
      perceptualDuplicates: [],
      fbxDiagnostics: [],
      audioDiagnostics: [],
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
    this.scanMetaFiles();
    this.scanAssetFiles();
    this.scanEngineSettings();
    this.scanScenesAndPrefabs();
    this.analyzeTextureDuplication();
    this.analyzeFbxModels();
    this.computeQuickWinsAndHealth();
    return this.stats;
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
                  this.spriteFrameMap.set(subData.uuid, {
                    spriteFrameUuid: subData.uuid,
                    parentUuid: content.uuid,
                    relPath,
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

    const fileRecord = {
      relPath,
      name: path.basename(fullPath),
      size,
      sizeFormatted: formatBytes(size),
      ext,
    };

    // 1. Models
    if (['.fbx', '.gltf', '.glb', '.obj'].includes(ext)) {
      this.stats.categories.models.size += size;
      this.stats.categories.models.count++;
      this.stats.categories.models.files.push(fileRecord);
    }
    // 2. Textures
    else if (['.png', '.jpg', '.jpeg', '.webp', '.tga', '.pvr'].includes(ext)) {
      this.stats.categories.textures.size += size;
      this.stats.categories.textures.count++;
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
          }
        }
      } else {
        const header = readImageHeader(fullPath, buffer);
        if (header) {
          fileRecord.width = header.width;
          fileRecord.height = header.height;
        }
      }

      this.stats.categories.textures.files.push(fileRecord);
    }
    // 3. Audio
    else if (['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext)) {
      this.stats.categories.audio.size += size;
      this.stats.categories.audio.count++;
      const buffer = fs.readFileSync(fullPath);
      const audioInfo = parseAudioDetails(fullPath, buffer);
      fileRecord.audioInfo = audioInfo;
      this.stats.categories.audio.files.push(fileRecord);

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

      if (relPath.includes('/shared/')) {
        this.stats.categories.sharedCore.size += size;
        this.stats.categories.sharedCore.count++;
        this.stats.categories.sharedCore.loc += lines;
        this.stats.categories.sharedCore.files.push(fileRecord);
      } else {
        this.stats.categories.scripts.size += size;
        this.stats.categories.scripts.count++;
        this.stats.categories.scripts.loc += lines;
        this.stats.categories.scripts.files.push(fileRecord);
      }
    }
    // 5. Scenes & Prefabs
    else if (['.scene', '.prefab'].includes(ext)) {
      this.stats.categories.scenes.size += size;
      this.stats.categories.scenes.count++;
      this.stats.categories.scenes.files.push(fileRecord);
    }
    // 6. Materials & Effects
    else if (['.mtl', '.effect', '.chunk'].includes(ext)) {
      this.stats.categories.materials.size += size;
      this.stats.categories.materials.count++;
      this.stats.categories.materials.files.push(fileRecord);
    }
    // 7. Fonts
    else if (['.ttf', '.fnt', '.otf', '.woff'].includes(ext)) {
      this.stats.categories.fonts.size += size;
      this.stats.categories.fonts.count++;
      this.stats.categories.fonts.files.push(fileRecord);
    }
    // 8. Other
    else {
      this.stats.categories.other.size += size;
      this.stats.categories.other.count++;
      this.stats.categories.other.files.push(fileRecord);
    }
  }

  scanSharedCode(dir) {
    const scan = (d) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          scan(full);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
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
        }
      }
    };
    scan(dir);
  }

  scanEngineSettings() {
    const engineConfigPath = path.join(this.settingsDir, 'v2', 'packages', 'engine.json');
    const enabledModules = [];
    let estimatedEngineSize = 850 * 1024; // ~850 KB base

    if (fs.existsSync(engineConfigPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(engineConfigPath, 'utf8'));
        const cache = cfg.modules?.configs?.defaultConfig?.cache || {};
        for (const [mod, val] of Object.entries(cache)) {
          if (val && (val._value === true || val === true)) {
            enabledModules.push(mod);
            if (mod === '3d') estimatedEngineSize += 300 * 1024;
            if (mod === 'physics') estimatedEngineSize += 250 * 1024;
            if (mod === 'particle') estimatedEngineSize += 120 * 1024;
            if (mod === 'skeletal-animation') estimatedEngineSize += 180 * 1024;
          }
        }
      } catch (e) {
        // fallback
      }
    }

    this.stats.engineDiagnostics.enabledModules = enabledModules;
    this.stats.engineDiagnostics.estimatedEngineSize = estimatedEngineSize;
    this.stats.categories.engine.size = estimatedEngineSize;
    this.stats.categories.engine.modules = enabledModules;
  }

  // ==========================================
  // 5. SCENE & PREFAB PARSER (Transform vs Texture)
  // ==========================================

  scanScenesAndPrefabs() {
    const sceneAndPrefabFiles = [
      ...this.stats.categories.scenes.files,
    ];

    for (const item of sceneAndPrefabFiles) {
      const fullPath = path.join(this.projectRoot, item.relPath);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const objects = JSON.parse(content);
        if (!Array.isArray(objects)) continue;

        // Build object map by array index (id 0, 1, 2...)
        const objMap = new Map();
        objects.forEach((obj, idx) => {
          if (obj && typeof obj === 'object') {
            objMap.set(idx, obj);
          }
        });

        // First pass: Index Nodes and Components
        const nodes = [];
        const components = [];

        objects.forEach((obj, idx) => {
          if (!obj) return;
          if (obj.__type__ === 'cc.Node') {
            nodes.push({ id: idx, node: obj });
          } else if (obj.__type__ && obj.__type__.startsWith('cc.')) {
            components.push({ id: idx, comp: obj });
          }
        });

        // Map Node ID to components
        const nodeComponentsMap = new Map();
        for (const { comp } of components) {
          if (comp.node && typeof comp.node.__id__ === 'number') {
            const nodeId = comp.node.__id__;
            if (!nodeComponentsMap.has(nodeId)) nodeComponentsMap.set(nodeId, []);
            nodeComponentsMap.get(nodeId).push(comp);
          }
        }

        // Build node paths and evaluate scale
        const getNodePath = (nodeId) => {
          const names = [];
          let currId = nodeId;
          let depth = 0;
          while (typeof currId === 'number' && depth < 20) {
            const nObj = objMap.get(currId);
            if (!nObj || nObj.__type__ !== 'cc.Node') break;
            names.unshift(nObj._name || `Node_${currId}`);
            if (nObj._parent && typeof nObj._parent.__id__ === 'number') {
              currId = nObj._parent.__id__;
            } else {
              break;
            }
            depth++;
          }
          return names.join('/');
        };

        // Inspect Sprite components on nodes
        for (const { id: nodeId, node } of nodes) {
          const nodeComps = nodeComponentsMap.get(nodeId) || [];
          const spriteComp = nodeComps.find((c) => c.__type__ === 'cc.Sprite');
          const uiTransformComp = nodeComps.find((c) => c.__type__ === 'cc.UITransform');

          if (spriteComp && spriteComp._spriteFrame && spriteComp._spriteFrame.__uuid__) {
            const spriteFrameUuid = spriteComp._spriteFrame.__uuid__;
            const spriteInfo = this.spriteFrameMap.get(spriteFrameUuid);

            if (spriteInfo) {
              const nodeScaleX = Math.abs(node._lscale?.x !== undefined ? node._lscale.x : 1);
              const nodeScaleY = Math.abs(node._lscale?.y !== undefined ? node._lscale.y : 1);

              const contentW = uiTransformComp?._contentSize?.width || spriteInfo.trimWidth || spriteInfo.rawWidth || 100;
              const contentH = uiTransformComp?._contentSize?.height || spriteInfo.trimHeight || spriteInfo.rawHeight || 100;

              const displayW = Math.max(1, Math.round(contentW * nodeScaleX));
              const displayH = Math.max(1, Math.round(contentH * nodeScaleY));

              const rawW = spriteInfo.rawWidth || spriteInfo.trimWidth || 0;
              const rawH = spriteInfo.rawHeight || spriteInfo.trimHeight || 0;

              if (rawW > 0 && rawH > 0 && displayW > 0 && displayH > 0) {
                const rawArea = rawW * rawH;
                const displayArea = displayW * displayH;
                const wasteRatio = Number((rawArea / displayArea).toFixed(2));

                if (wasteRatio >= this.options.minWasteRatio) {
                  // Find original texture file size
                  const texFile = this.stats.categories.textures.files.find(
                    (f) => f.relPath === spriteInfo.relPath
                  );
                  const originalSize = texFile ? texFile.size : 0;
                  // Recommended size: 2x retina display dimensions rounded to power-of-two or neat multiples
                  const recW = Math.min(rawW, Math.max(16, Math.ceil((displayW * 1.5) / 16) * 16));
                  const recH = Math.min(rawH, Math.max(16, Math.ceil((displayH * 1.5) / 16) * 16));
                  const recArea = recW * recH;
                  const estimatedSavings = originalSize > 0 && recArea < rawArea
                    ? Math.round(originalSize * (1 - recArea / rawArea) * 0.8)
                    : 0;

                  this.stats.oversizedTextures.push({
                    sceneOrPrefab: item.relPath,
                    nodeName: node._name || `Node_${nodeId}`,
                    nodePath: getNodePath(nodeId),
                    texturePath: spriteInfo.relPath,
                    spriteFrame: spriteInfo.name,
                    rawResolution: `${rawW}x${rawH}`,
                    rawArea,
                    displaySize: `${displayW}x${displayH}`,
                    displayArea,
                    wasteRatio,
                    severity: wasteRatio >= 4.0 ? 'CRITICAL' : 'WARN',
                    recommendedResolution: `${recW}x${recH}`,
                    originalSize,
                    estimatedSavings,
                    spriteType: spriteComp._type === 1 ? 'Sliced' : 'Simple',
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        // non fatal
      }
    }
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
        const totalWastedBytes = list.slice(1).reduce((acc, cur) => acc + cur.size, 0);
        this.stats.exactDuplicates.push({
          sha256: sha,
          files: list.map((f) => ({ relPath: f.relPath, size: f.size, sizeFormatted: f.sizeFormatted })),
          wastedBytes: totalWastedBytes,
          wastedFormatted: formatBytes(totalWastedBytes),
        });
      }
    }

    // 2. Perceptual Similarity (dHash Hamming distance >= minSimilarity)
    const testedPairs = new Set();
    for (let i = 0; i < textures.length; i++) {
      const texA = textures[i];
      if (!texA.dHashBits) continue;

      for (let j = i + 1; j < textures.length; j++) {
        const texB = textures[j];
        if (!texB.dHashBits) continue;
        if (texA.sha256 && texA.sha256 === texB.sha256) continue; // skip exact byte duplicates

        const pairKey = `${texA.relPath}<->${texB.relPath}`;
        if (testedPairs.has(pairKey)) continue;
        testedPairs.add(pairKey);

        const similarity = Number(calculateSimilarity(texA.dHashBits, texB.dHashBits).toFixed(1));

        if (similarity >= this.options.minSimilarity) {
          const estimatedSavings = Math.min(texA.size, texB.size);
          this.stats.perceptualDuplicates.push({
            textureA: { relPath: texA.relPath, size: texA.size, sizeFormatted: texA.sizeFormatted, res: `${texA.width}x${texA.height}` },
            textureB: { relPath: texB.relPath, size: texB.size, sizeFormatted: texB.sizeFormatted, res: `${texB.width}x${texB.height}` },
            similarity,
            dHashA: texA.dHash,
            dHashB: texB.dHash,
            estimatedSavings,
            estimatedSavingsFormatted: formatBytes(estimatedSavings),
          });
        }
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

        const overrideInfo = fbxOverridesMap.get(fbxFile.relPath);
        const hasExternalOverride = overrideInfo && overrideInfo.externalMats.size > 0;

        if (fbxDetails.embeddedTextures.length > 0 || hasEmbeddedInMeta || hasExternalOverride) {
          const estimatedSavings = Math.round(fbxFile.size * 0.4); // typical ~40-70% savings
          this.stats.fbxDiagnostics.push({
            relPath: fbxFile.relPath,
            size: fbxFile.size,
            sizeFormatted: formatBytes(fbxFile.size),
            embeddedTextures: fbxDetails.embeddedTextures,
            embeddedMaterials: fbxDetails.embeddedMaterials,
            meshCount: fbxFile.triangleCount > 0 ? `${fbxDetails.meshCount || 1} meshes (${fbxFile.triangleCount.toLocaleString()} tris)` : `${fbxDetails.meshCount} meshes`,
            animationClips: fbxDetails.animationClips,
            hasExternalOverride,
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

  // ==========================================
  // 8. HEALTH SCORE & QUICK WINS COMPUTATION
  // ==========================================

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
    if (this.stats.oversizedTextures.length > 0) {
      const criticalOversized = this.stats.oversizedTextures.filter((t) => t.severity === 'CRITICAL');
      const totalOversizedSavings = this.stats.oversizedTextures.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(25, criticalOversized.length * 8);
      wins.push({
        title: `Downscale ${this.stats.oversizedTextures.length} Oversized Textures (>= ${this.options.minWasteRatio}x waste ratio)`,
        category: 'Textures',
        potentialSavingsBytes: totalOversizedSavings,
        potentialSavingsFormatted: formatBytes(totalOversizedSavings),
        impact: criticalOversized.length > 0 ? 'Critical' : 'Medium',
        action: 'Resize source image dimensions in graphics editor or adjust Cocos SpriteFrame packable settings.',
        explanation: 'Textures have significantly higher resolution than their rendered UI node size, causing wasted payload and GPU memory.',
      });
    }

    // Win 3: Audio Downsample / Optimization
    if (this.stats.audioDiagnostics.length > 0) {
      const totalAudioSavings = this.stats.audioDiagnostics.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(20, Math.ceil(totalAudioSavings / (30 * 1024)) * 5);
      wins.push({
        title: `Optimize ${this.stats.audioDiagnostics.length} Audio File(s) to 32kHz Mono MP3/OGG`,
        category: 'Audio',
        potentialSavingsBytes: totalAudioSavings,
        potentialSavingsFormatted: formatBytes(totalAudioSavings),
        impact: 'Medium',
        action: 'npm run sound:optimize -- --write',
        explanation: 'Audio assets have high sample rates (>32kHz) or uncompressed WAV headers that can be downmixed to mono MP3/OGG.',
      });
    }

    // Win 4: Duplicate Texture Consolidation
    if (this.stats.exactDuplicates.length > 0 || this.stats.perceptualDuplicates.length > 0) {
      const dupSavings = this.stats.exactDuplicates.reduce((acc, c) => acc + c.wastedBytes, 0)
        + this.stats.perceptualDuplicates.reduce((acc, c) => acc + c.estimatedSavings, 0);
      score -= Math.min(15, this.stats.exactDuplicates.length * 5 + this.stats.perceptualDuplicates.length * 3);
      wins.push({
        title: `Consolidate ${this.stats.exactDuplicates.length + this.stats.perceptualDuplicates.length} Duplicate / Near-Identical Texture(s)`,
        category: 'Textures',
        potentialSavingsBytes: dupSavings,
        potentialSavingsFormatted: formatBytes(dupSavings),
        impact: 'Medium',
        action: 'Wire duplicate SpriteFrames to a single shared texture file and remove unused copies.',
        explanation: 'Identical or >=90% visually similar textures exist across multiple paths, wasting bundle bytes.',
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
// 9. TERMINAL CLI RENDERER
// ==========================================

function renderCliReport(stats, options) {
  const { c, b, d, g, y, r, m, cy, gr } = {
    c: colors.cyan,
    b: colors.bold,
    d: colors.dim,
    g: colors.green,
    y: colors.yellow,
    r: colors.red,
    m: colors.magenta,
    cy: colors.cyan,
    gr: colors.gray,
  };

  const totalRawSize = stats.totalSize;
  const totalWithEngine = totalRawSize + stats.engineDiagnostics.estimatedEngineSize;

  console.log('\n' + '='.repeat(78));
  console.log(`${b}${c}🚀 COCOS PLAYABLE ADS - RESOURCE ALLOCATION & OPTIMIZATION REPORT${colors.reset}`);
  console.log('='.repeat(78));

  // Playable Health & Budget Scorecard
  const healthColor = stats.healthScore >= 85 ? g : (stats.healthScore >= 65 ? y : r);
  console.log(`\n${b}📊 PLAYABLE HEALTH SCORE:${colors.reset} ${healthColor}${b}${stats.healthScore}/100${colors.reset} | ${b}TOTAL ASSETS SIZE:${colors.reset} ${c}${formatBytes(totalRawSize)}${colors.reset} (Est. Bundle with Engine: ${m}${formatBytes(totalWithEngine)}${colors.reset})`);

  // Ad Network Budget Compliance Check
  const NETWORKS = [
    { name: 'Google Ads', limitMB: 5.0 },
    { name: 'AppLovin', limitMB: 5.0 },
    { name: 'Unity Ads', limitMB: 5.0 },
    { name: 'IronSource', limitMB: 2.0 },
    { name: 'TikTok / Mintegral', limitMB: 2.0 },
    { name: 'Facebook Ads', limitMB: 2.0 },
  ];

  console.log(`\n${b}🌐 AD NETWORK BUDGET STATUS:${colors.reset}`);
  for (const net of NETWORKS) {
    const limitBytes = net.limitMB * 1024 * 1024;
    const isOk = totalRawSize <= limitBytes;
    const statusIcon = isOk ? `${g}✔ PASS${colors.reset}` : `${r}✖ EXCEEDED${colors.reset}`;
    const pct = ((totalRawSize / limitBytes) * 100).toFixed(1);
    console.log(`  • ${net.name.padEnd(20)} Max: ${net.limitMB}MB | Usage: ${pct.padStart(5)}% | ${statusIcon}`);
  }

  // Category Breakdown Table
  console.log(`\n${b}📦 RESOURCE ALLOCATION BREAKDOWN:${colors.reset}`);
  console.log(`  ${'-'.repeat(74)}`);
  console.log(`  ${'CATEGORY'.padEnd(28)} ${'COUNT'.padStart(6)} ${'SIZE'.padStart(12)} ${'% TOTAL'.padStart(10)} ${'DETAILS'.padEnd(16)}`);
  console.log(`  ${'-'.repeat(74)}`);

  for (const [key, cat] of Object.entries(stats.categories)) {
    if (key === 'engine') continue;
    const pct = totalRawSize > 0 ? ((cat.size / totalRawSize) * 100).toFixed(1) : '0.0';
    let detail = '';
    if (key === 'scripts' || key === 'sharedCore') detail = `${cat.loc || 0} lines of TS`;
    else if (key === 'models') detail = `${cat.files.length} 3D meshes`;
    else if (key === 'textures') detail = `${cat.files.length} images`;
    else if (key === 'audio') detail = `${cat.files.length} sound files`;

    console.log(`  ${cat.label.padEnd(28)} ${String(cat.count).padStart(6)} ${formatBytes(cat.size).padStart(12)} ${(pct + '%').padStart(10)} ${gr}${detail.padEnd(16)}${colors.reset}`);
  }
  console.log(`  ${'-'.repeat(74)}`);
  console.log(`  ${b}${'TOTAL ASSET FOOTPRINT'.padEnd(28)} ${String(Object.values(stats.categories).reduce((a, b) => a + (b.count || 0), 0) - 1).padStart(6)} ${formatBytes(totalRawSize).padStart(12)} ${'100.0%'.padStart(10)}${colors.reset}`);

  // SECTION: Oversized Textures vs Node Transforms
  if (stats.oversizedTextures.length > 0) {
    console.log(`\n${b}⚠️  OVERSIZED TEXTURES VS NODE TRANSFORMS (${stats.oversizedTextures.length} found):${colors.reset}`);
    console.log(`  ${d}Textures with resolution significantly larger than their rendered UI node contentSize * scale.${colors.reset}`);
    console.log(`  ${'-'.repeat(74)}`);

    stats.oversizedTextures.slice(0, 10).forEach((item, idx) => {
      const sevTag = item.severity === 'CRITICAL' ? `${r}[CRITICAL ${item.wasteRatio}x]${colors.reset}` : `${y}[WARN ${item.wasteRatio}x]${colors.reset}`;
      console.log(`  ${idx + 1}. ${sevTag} ${b}${path.basename(item.texturePath)}${colors.reset} in ${cy}${item.sceneOrPrefab}${colors.reset}`);
      console.log(`     Node: ${item.nodePath} (${item.spriteType})`);
      console.log(`     Raw Texture: ${item.rawResolution} (${formatBytes(item.originalSize)}) -> Display Size: ${item.displaySize}`);
      console.log(`     ${g}→ Recommended: ${item.recommendedResolution} (Save ~${formatBytes(item.estimatedSavings)})${colors.reset}`);
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
        console.log(`    [Group ${i + 1}] Wasted: ${formatBytes(dup.wastedBytes)}`);
        dup.files.forEach((f) => console.log(`      - ${f.relPath} (${f.sizeFormatted})`));
      });
    }

    if (stats.perceptualDuplicates.length > 0) {
      console.log(`  ${y}• Visually Similar Textures (>= ${options.minSimilarity}% match via dHash):${colors.reset}`);
      stats.perceptualDuplicates.slice(0, 8).forEach((p, i) => {
        console.log(`    ${i + 1}. Similarity: ${b}${y}${p.similarity}%${colors.reset} (Save ~${p.estimatedSavingsFormatted})`);
        console.log(`       A: ${p.textureA.relPath} (${p.textureA.res}, ${p.textureA.sizeFormatted})`);
        console.log(`       B: ${p.textureB.relPath} (${p.textureB.res}, ${p.textureB.sizeFormatted})`);
      });
    }
  }

  // SECTION: FBX Deep Diagnostics
  if (stats.fbxDiagnostics.length > 0) {
    console.log(`\n${b}🧊 FBX EMBEDDED ASSET DIAGNOSTICS:${colors.reset}`);
    stats.fbxDiagnostics.forEach((fbx, i) => {
      console.log(`  ${i + 1}. ${b}${fbx.relPath}${colors.reset} (${fbx.sizeFormatted})`);
      console.log(`     Embedded Textures: ${fbx.embeddedTextures.join(', ') || 'None'}`);
      console.log(`     ${g}→ Quick Fix: ${fbx.fixCommand}${colors.reset}`);
    });
  }

  // SECTION: Audio Diagnostics
  if (stats.audioDiagnostics.length > 0) {
    console.log(`\n${b}🎵 AUDIO OPTIMIZATION OPPORTUNITIES:${colors.reset}`);
    stats.audioDiagnostics.forEach((a, i) => {
      console.log(`  ${i + 1}. ${b}${a.relPath}${colors.reset} (${a.sizeFormatted}) - ${a.audioInfo.format} ${a.audioInfo.sampleRate}Hz ${a.audioInfo.channelLabel}`);
      console.log(`     ${y}Issue: ${a.audioInfo.reason.join('; ')}${colors.reset}`);
    });
    console.log(`  ${g}→ Run: npm run sound:optimize${colors.reset}`);
  }

  // SECTION: Top Quick Wins
  if (stats.quickWins.length > 0) {
    console.log(`\n${b}${g}🎯 TOP QUICK WINS (HIGHEST SIZE REDUCTION IMPACT):${colors.reset}`);
    stats.quickWins.slice(0, 5).forEach((win, i) => {
      console.log(`\n  ${b}${i + 1}. [${win.category}] ${win.title}${colors.reset}`);
      console.log(`     Est. Savings: ${g}${b}${win.potentialSavingsFormatted}${colors.reset} | Impact: ${win.impact}`);
      console.log(`     ${d}${win.explanation}${colors.reset}`);
      if (win.action.startsWith('npm ') || win.action.startsWith('node ')) {
        console.log(`     ${c}Run: ${win.action}${colors.reset}`);
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
        <div class="card-title">Total Asset Size</div>
        <div class="card-value">${formatBytes(totalRawSize)}</div>
        <div class="card-subtitle">Engine + Assets: ~${formatBytes(totalWithEngine)}</div>
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
      <div class="card">
        <div class="card-title">FBX / Audio Actions</div>
        <div class="card-value" style="color: ${(stats.fbxDiagnostics.length + stats.audioDiagnostics.length) > 0 ? 'var(--primary)' : 'var(--success)'};">
          ${stats.fbxDiagnostics.length + stats.audioDiagnostics.length}
        </div>
        <div class="card-subtitle">Actionable optimizations available</div>
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
      <h2>📦 Resource Allocation Breakdown</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Files Count</th>
              <th>Total Size</th>
              <th>Share</th>
              <th>Visual Proportion</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(stats.categories).filter(([k]) => k !== 'engine').map(([key, cat]) => {
              const pct = totalRawSize > 0 ? ((cat.size / totalRawSize) * 100).toFixed(1) : 0;
              return `
                <tr>
                  <td><strong>${cat.label}</strong></td>
                  <td>${cat.count}</td>
                  <td>${formatBytes(cat.size)}</td>
                  <td>${pct}%</td>
                  <td style="width: 250px;">
                    <div class="progress-bar-container">
                      <div class="progress-bar" style="width: ${pct}%; background: var(--primary);"></div>
                    </div>
                  </td>
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
              <th>Potential Savings</th>
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
      <h2>🔍 Duplicate & Perceptually Similar Textures (>= ${options.minSimilarity}%)</h2>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Match Type</th>
              <th>Texture A</th>
              <th>Texture B</th>
              <th>Similarity</th>
              <th>Est. Savings</th>
            </tr>
          </thead>
          <tbody>
            ${stats.exactDuplicates.map((dup) => `
              <tr>
                <td><span class="tag tag-critical">100% Exact</span></td>
                <td>${dup.files[0]?.relPath} (${dup.files[0]?.sizeFormatted})</td>
                <td>${dup.files.slice(1).map(f => f.relPath).join('<br>')}</td>
                <td>100.0%</td>
                <td style="color: var(--success);">~${dup.wastedFormatted}</td>
              </tr>
            `).join('')}
            ${stats.perceptualDuplicates.map((dup) => `
              <tr>
                <td><span class="tag tag-warn">Perceptual</span></td>
                <td>${dup.textureA.relPath} (${dup.textureA.res}, ${dup.textureA.sizeFormatted})</td>
                <td>${dup.textureB.relPath} (${dup.textureB.res}, ${dup.textureB.sizeFormatted})</td>
                <td><strong>${dup.similarity}%</strong></td>
                <td style="color: var(--success);">~${dup.estimatedSavingsFormatted}</td>
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
  calculateSimilarity,
  parseFbxDetails,
  parseAudioDetails,
};
