'use strict';

/**
 * Pure JavaScript Zero-Dependency QR Code Generator
 * Generates QR code matrix, ANSI terminal blocks, SVG, and Data URIs.
 * Supports Byte Mode encoding (UTF-8/ASCII) with Reed-Solomon Error Correction.
 */

// Galois Field (256) Tables & Arithmetic
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x >= 256) x ^= 0x11d; // Generator polynomial x^8 + x^4 + x^3 + x^2 + 1
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const nextPoly = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gfMul(poly[j], EXP_TABLE[i]);
      nextPoly[j + 1] ^= poly[j];
    }
    poly = nextPoly;
  }
  return poly;
}

function rsComputeRemainder(data, ecCount) {
  const genPoly = rsGeneratorPoly(ecCount);
  const remainder = new Array(ecCount).fill(0);

  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        remainder[j] ^= gfMul(genPoly[j + 1], factor);
      }
    }
  }
  return remainder;
}

// QR Code Specifications for Versions 1 to 14 (Byte mode, Error Correction Level L and M)
const VERSION_SPECS = {
  // Level L (7% recovery)
  L: [
    null,
    { ver: 1, totalCw: 26, ecCw: 7, dataCw: 19, blocks: [{ count: 1, data: 19, total: 26 }] },
    { ver: 2, totalCw: 44, ecCw: 10, dataCw: 34, blocks: [{ count: 1, data: 34, total: 44 }] },
    { ver: 3, totalCw: 70, ecCw: 15, dataCw: 55, blocks: [{ count: 1, data: 55, total: 70 }] },
    { ver: 4, totalCw: 100, ecCw: 20, dataCw: 80, blocks: [{ count: 1, data: 80, total: 100 }] },
    { ver: 5, totalCw: 134, ecCw: 26, dataCw: 108, blocks: [{ count: 1, data: 108, total: 134 }] },
    { ver: 6, totalCw: 172, ecCw: 36, dataCw: 136, blocks: [{ count: 2, data: 68, total: 86 }] },
    { ver: 7, totalCw: 196, ecCw: 40, dataCw: 156, blocks: [{ count: 2, data: 78, total: 98 }] },
    { ver: 8, totalCw: 242, ecCw: 48, dataCw: 194, blocks: [{ count: 2, data: 97, total: 121 }] },
    { ver: 9, totalCw: 292, ecCw: 60, dataCw: 232, blocks: [{ count: 2, data: 116, total: 146 }] },
    { ver: 10, totalCw: 346, ecCw: 72, dataCw: 274, blocks: [{ count: 2, data: 68, total: 86 }, { count: 2, data: 69, total: 87 }] },
    { ver: 11, totalCw: 404, ecCw: 80, dataCw: 324, blocks: [{ count: 4, data: 81, total: 101 }] },
    { ver: 12, totalCw: 466, ecCw: 96, dataCw: 370, blocks: [{ count: 2, data: 92, total: 116 }, { count: 2, data: 93, total: 117 }] },
    { ver: 13, totalCw: 532, ecCw: 104, dataCw: 428, blocks: [{ count: 4, data: 107, total: 133 }] },
    { ver: 14, totalCw: 581, ecCw: 120, dataCw: 461, blocks: [{ count: 3, data: 115, total: 145 }, { count: 1, data: 116, total: 146 }] },
  ],
  // Level M (15% recovery - Default)
  M: [
    null,
    { ver: 1, totalCw: 26, ecCw: 10, dataCw: 16, blocks: [{ count: 1, data: 16, total: 26 }] },
    { ver: 2, totalCw: 44, ecCw: 16, dataCw: 28, blocks: [{ count: 1, data: 28, total: 44 }] },
    { ver: 3, totalCw: 70, ecCw: 26, dataCw: 44, blocks: [{ count: 1, data: 44, total: 70 }] },
    { ver: 4, totalCw: 100, ecCw: 36, dataCw: 64, blocks: [{ count: 2, data: 32, total: 50 }] },
    { ver: 5, totalCw: 134, ecCw: 48, dataCw: 86, blocks: [{ count: 2, data: 43, total: 67 }] },
    { ver: 6, totalCw: 172, ecCw: 64, dataCw: 108, blocks: [{ count: 4, data: 27, total: 43 }] },
    { ver: 7, totalCw: 196, ecCw: 72, dataCw: 124, blocks: [{ count: 4, data: 31, total: 49 }] },
    { ver: 8, totalCw: 242, ecCw: 88, dataCw: 154, blocks: [{ count: 2, data: 38, total: 60 }, { count: 2, data: 39, total: 61 }] },
    { ver: 9, totalCw: 292, ecCw: 110, dataCw: 182, blocks: [{ count: 3, data: 36, total: 58 }, { count: 2, data: 37, total: 59 }] },
    { ver: 10, totalCw: 346, ecCw: 130, dataCw: 216, blocks: [{ count: 4, data: 43, total: 69 }, { count: 1, data: 44, total: 70 }] },
    { ver: 11, totalCw: 404, ecCw: 150, dataCw: 254, blocks: [{ count: 1, data: 50, total: 79 }, { count: 4, data: 51, total: 80 }] },
    { ver: 12, totalCw: 466, ecCw: 176, dataCw: 290, blocks: [{ count: 6, data: 36, total: 58 }, { count: 2, data: 37, total: 59 }] },
    { ver: 13, totalCw: 532, ecCw: 198, dataCw: 334, blocks: [{ count: 8, data: 37, total: 59 }, { count: 4, data: 38, total: 60 }] },
    { ver: 14, totalCw: 581, ecCw: 216, dataCw: 365, blocks: [{ count: 4, data: 40, total: 64 }, { count: 5, data: 41, total: 65 }] },
  ]
};

// Alignment Pattern Center Positions
const ALIGNMENT_PATTERN_POS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
];

// Format Info Masks (15 bits) for EC Level M & Mask Patterns 0-7
const FORMAT_INFO_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0
];
const FORMAT_INFO_L = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976
];

class BitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }

  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
    }
    this.length++;
  }

  getBytes() {
    return this.buffer;
  }
}

function encodeData(text, ecLevel = 'M') {
  const utf8Bytes = Buffer.from(text, 'utf8');
  const dataLen = utf8Bytes.length;

  // Find minimum version that fits data
  const specList = VERSION_SPECS[ecLevel] || VERSION_SPECS.M;
  let spec = null;
  for (let v = 1; v < specList.length; v++) {
    const s = specList[v];
    if (!s) continue;
    const charCountBits = s.ver < 10 ? 8 : 16;
    const requiredBits = 4 + charCountBits + (dataLen * 8);
    const capacityBits = s.dataCw * 8;
    if (requiredBits <= capacityBits) {
      spec = s;
      break;
    }
  }

  if (!spec) {
    throw new Error(`Data too large for QR generator (length: ${dataLen} bytes). Max supported URL length is ~350 chars.`);
  }

  const bb = new BitBuffer();
  // Byte mode indicator: 0100
  bb.put(0x04, 4);
  // Character count indicator
  const charCountBits = spec.ver < 10 ? 8 : 16;
  bb.put(dataLen, charCountBits);
  // Payload
  for (let i = 0; i < dataLen; i++) {
    bb.put(utf8Bytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const capacityBits = spec.dataCw * 8;
  const termBits = Math.min(4, capacityBits - bb.length);
  bb.put(0, termBits);

  // Pad to byte boundary
  if (bb.length % 8 !== 0) {
    bb.put(0, 8 - (bb.length % 8));
  }

  // Pad bytes: 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < capacityBits) {
    bb.put(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const rawBytes = bb.getBytes();

  // Divide into blocks & compute Reed-Solomon EC
  const dataBlocks = [];
  const ecBlocks = [];
  let byteOffset = 0;

  for (const blockInfo of spec.blocks) {
    const ecPerBlock = Math.floor(spec.ecCw / spec.blocks.reduce((acc, b) => acc + b.count, 0));
    for (let c = 0; c < blockInfo.count; c++) {
      const dataBlock = rawBytes.slice(byteOffset, byteOffset + blockInfo.data);
      byteOffset += blockInfo.data;
      const ecRemainder = rsComputeRemainder(dataBlock, ecPerBlock);
      dataBlocks.push(dataBlock);
      ecBlocks.push(ecRemainder);
    }
  }

  // Interleave data codewords
  const finalCodewords = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      if (i < dataBlocks[b].length) {
        finalCodewords.push(dataBlocks[b][i]);
      }
    }
  }

  // Interleave error correction codewords
  const maxEcLen = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEcLen; i++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      if (i < ecBlocks[b].length) {
        finalCodewords.push(ecBlocks[b][i]);
      }
    }
  }

  return { spec, codewords: finalCodewords };
}

function createMatrix(version) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  function setModule(r, c, val, isReserved = true) {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val ? 1 : 0;
      if (isReserved) reserved[r][c] = true;
    }
  }

  // 1. Finder Patterns (7x7) + Separators (1 module white)
  const finderPositions = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0]
  ];

  for (const [row, col] of finderPositions) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const tr = row + r;
        const tc = col + c;
        if (tr < 0 || tr >= size || tc < 0 || tc >= size) continue;

        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBlack = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          setModule(tr, tc, isBlack, true);
        } else {
          setModule(tr, tc, false, true); // White separator
        }
      }
    }
  }

  // 2. Alignment Patterns
  const alignPos = ALIGNMENT_PATTERN_POS[version] || [];
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      const ar = alignPos[i];
      const ac = alignPos[j];

      // Skip finder pattern collisions
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === alignPos[alignPos.length - 1]) || (ar === alignPos[alignPos.length - 1] && ac === 6)) {
        continue;
      }
      if (reserved[ar][ac]) continue;

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isBlack = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
          setModule(ar + r, ac + c, isBlack, true);
        }
      }
    }
  }

  // 3. Timing Patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0, true);
  }

  // 4. Dark Module
  setModule(4 * version + 9, 8, true, true);

  // 5. Reserve Format Information Area
  for (let i = 0; i <= 8; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = true;
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = true;
  }

  return { size, matrix, reserved };
}

// Mask evaluation formulas
function getMaskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyFormatInfo(matrix, size, ecLevel, maskPattern) {
  const formatInfo = (ecLevel === 'L' ? FORMAT_INFO_L : FORMAT_INFO_M)[maskPattern];

  // 15 bits
  for (let i = 0; i < 15; i++) {
    const bit = ((formatInfo >>> (14 - i)) & 1) === 1;

    // Top-left vertical
    if (i < 6) {
      matrix[i][8] = bit ? 1 : 0;
    } else if (i === 6) {
      matrix[7][8] = bit ? 1 : 0;
    } else if (i === 7) {
      matrix[8][8] = bit ? 1 : 0;
    } else if (i === 8) {
      matrix[8][7] = bit ? 1 : 0;
    } else {
      matrix[8][14 - i] = bit ? 1 : 0;
    }

    // Top-right and bottom-left
    if (i < 8) {
      matrix[8][size - 1 - i] = bit ? 1 : 0;
    } else {
      matrix[size - 15 + i][8] = bit ? 1 : 0;
    }
  }
}

function generateQRMatrix(text, ecLevel = 'M', maskPattern = 2) {
  const { spec, codewords } = encodeData(text, ecLevel);
  const { size, matrix, reserved } = createMatrix(spec.ver);

  // Place data bits in 2-column zig-zag traversal
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  let right = size - 1;
  while (right > 0) {
    if (right === 6) right--; // Skip vertical timing column

    for (let vert = 0; vert < size; vert++) {
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        const row = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;

        if (!reserved[row][col]) {
          let bit = false;
          if (bitIndex < totalBits) {
            const byte = codewords[Math.floor(bitIndex / 8)];
            bit = ((byte >>> (7 - (bitIndex % 8))) & 1) === 1;
            bitIndex++;
          }

          // Apply Mask
          if (getMaskBit(maskPattern, row, col)) {
            bit = !bit;
          }
          matrix[row][col] = bit ? 1 : 0;
        }
      }
    }
    right -= 2;
  }

  applyFormatInfo(matrix, size, ecLevel, maskPattern);
  return { size, matrix, version: spec.ver };
}

/**
 * Generate high-contrast Unicode half-block QR string for ANSI Terminals.
 * Uses top/bottom half block characters (▀, ▄, █, ' ') to fit 2 rows per console line.
 */
function toTerminalString(text, options = {}) {
  const ecLevel = options.ecLevel || 'M';
  const quietZone = options.quietZone !== undefined ? options.quietZone : 2;
  const { size, matrix } = generateQRMatrix(text, ecLevel);

  const fullSize = size + quietZone * 2;
  const fullMatrix = Array.from({ length: fullSize }, (_, r) =>
    Array.from({ length: fullSize }, (_, c) => {
      const mr = r - quietZone;
      const mc = c - quietZone;
      if (mr >= 0 && mr < size && mc >= 0 && mc < size) {
        return matrix[mr][mc] === 1;
      }
      return false;
    })
  );

  const lines = [];
  // White background, black foreground ANSI or reverse blocks
  for (let r = 0; r < fullSize; r += 2) {
    let line = '';
    for (let c = 0; c < fullSize; c++) {
      const top = fullMatrix[r][c];
      const bottom = (r + 1 < fullSize) ? fullMatrix[r + 1][c] : false;

      // Half-block mapping
      if (top && bottom) {
        line += '█';
      } else if (top && !bottom) {
        line += '▀';
      } else if (!top && bottom) {
        line += '▄';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Generate an SVG string of the QR code
 */
function toSvg(text, options = {}) {
  const ecLevel = options.ecLevel || 'M';
  const quietZone = options.quietZone !== undefined ? options.quietZone : 2;
  const moduleSize = options.moduleSize || 8;
  const color = options.color || '#000000';
  const bgColor = options.bgColor || '#ffffff';

  const { size, matrix } = generateQRMatrix(text, ecLevel);
  const totalModules = size + quietZone * 2;
  const totalPx = totalModules * moduleSize;

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) {
        const x = (c + quietZone) * moduleSize;
        const y = (r + quietZone) * moduleSize;
        rects += `<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}" fill="${color}"/>`;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${totalPx} ${totalPx}" width="${totalPx}" height="${totalPx}">
  <rect width="100%" height="100%" fill="${bgColor}"/>
  ${rects}
</svg>`;
}

/**
 * Generate a Base64 SVG Data URI
 */
function toDataUri(text, options = {}) {
  const svg = toSvg(text, options);
  const base64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

module.exports = {
  generateQRMatrix,
  toTerminalString,
  toSvg,
  toDataUri
};
