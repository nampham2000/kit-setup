'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Pure Node.js PNG Reader and Writer with zero external dependencies.
 * Supports decoding 8-bit RGBA and RGB PNGs, and encoding 8-bit RGBA PNGs.
 */

// CRC-32 table for PNG chunk checksums
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCrc(buf, offset, length) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < length; i++) {
    crc = CRC_TABLE[(crc ^ buf[offset + i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Decode a PNG buffer into raw RGBA pixels.
 */
function decodePng(buffer) {
  // Check PNG signature
  if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
    throw new Error('Invalid PNG signature');
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6; // 6 = RGBA, 2 = RGB, 0 = Grayscale
  const idatChunks = [];

  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const dataOffset = pos + 8;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataOffset);
      height = buffer.readUInt32BE(dataOffset + 4);
      bitDepth = buffer[dataOffset + 8];
      colorType = buffer[dataOffset + 9];
      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataOffset, dataOffset + length));
    } else if (type === 'IEND') {
      break;
    }

    pos += 12 + length;
  }

  const compressedData = Buffer.concat(idatChunks);
  const decompressed = zlib.inflateSync(compressedData);

  let channels = 4;
  if (colorType === 6) channels = 4; // RGBA
  else if (colorType === 2) channels = 3; // RGB
  else if (colorType === 0) channels = 1; // Grayscale
  else if (colorType === 4) channels = 2; // Grayscale + Alpha
  else {
    throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  const rawRgba = Buffer.alloc(width * height * 4);
  const rowBytes = width * channels;
  let srcPos = 0;
  let prevRow = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y++) {
    const filter = decompressed[srcPos++];
    const currentRow = Buffer.alloc(rowBytes);

    for (let i = 0; i < rowBytes; i++) {
      const byte = decompressed[srcPos++];
      let left = i >= channels ? currentRow[i - channels] : 0;
      let up = prevRow[i];
      let upLeft = i >= channels ? prevRow[i - channels] : 0;
      let val = 0;

      if (filter === 0) { // None
        val = byte;
      } else if (filter === 1) { // Sub
        val = (byte + left) & 0xFF;
      } else if (filter === 2) { // Up
        val = (byte + up) & 0xFF;
      } else if (filter === 3) { // Average
        val = (byte + Math.floor((left + up) / 2)) & 0xFF;
      } else if (filter === 4) { // Paeth
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        let pr = left;
        if (pb < pa && pb < pc) pr = up;
        else if (pc < pa) pr = upLeft;
        val = (byte + pr) & 0xFF;
      } else {
        val = byte;
      }

      currentRow[i] = val;
    }

    // Convert row to RGBA
    const dstRowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const dstPixel = dstRowOffset + x * 4;
      const srcPixel = x * channels;

      if (channels === 4) {
        rawRgba[dstPixel] = currentRow[srcPixel];         // R
        rawRgba[dstPixel + 1] = currentRow[srcPixel + 1]; // G
        rawRgba[dstPixel + 2] = currentRow[srcPixel + 2]; // B
        rawRgba[dstPixel + 3] = currentRow[srcPixel + 3]; // A
      } else if (channels === 3) {
        rawRgba[dstPixel] = currentRow[srcPixel];         // R
        rawRgba[dstPixel + 1] = currentRow[srcPixel + 1]; // G
        rawRgba[dstPixel + 2] = currentRow[srcPixel + 2]; // B
        rawRgba[dstPixel + 3] = 255;                      // A
      } else if (channels === 1) {
        const v = currentRow[srcPixel];
        rawRgba[dstPixel] = v;
        rawRgba[dstPixel + 1] = v;
        rawRgba[dstPixel + 2] = v;
        rawRgba[dstPixel + 3] = 255;
      } else if (channels === 2) {
        const v = currentRow[srcPixel];
        rawRgba[dstPixel] = v;
        rawRgba[dstPixel + 1] = v;
        rawRgba[dstPixel + 2] = v;
        rawRgba[dstPixel + 3] = currentRow[srcPixel + 1];
      }
    }

    prevRow = currentRow;
  }

  return { width, height, data: rawRgba };
}

/**
 * Encode raw RGBA pixels into a PNG buffer.
 */
function encodePng(width, height, rgbaBuffer) {
  const rowBytes = width * 4;
  const filteredData = Buffer.alloc(height * (rowBytes + 1));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    filteredData[rowOffset] = 0; // Filter 0: None
    rgbaBuffer.copy(filteredData, rowOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const compressedData = zlib.deflateSync(filteredData, { level: 9 });

  // PNG Header
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = createPngChunk('IHDR', ihdr);

  // IDAT Chunk
  const idatChunk = createPngChunk('IDAT', compressedData);

  // IEND Chunk
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = calculateCrc(chunk, 4, 4 + len);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

/**
 * Packs Unity PBR textures into Cocos Standard ORM Map:
 *   - Red (R)   = Ambient Occlusion (AO)
 *   - Green (G) = Roughness (1.0 - Smoothness)
 *   - Blue (B)  = Metallic
 *   - Alpha (A) = 255
 */
function packPbrOrmTexture(options) {
  const {
    metallicGlossPath,
    occlusionPath,
    roughnessPath,
    defaultMetallic = 0.0,
    defaultRoughness = 0.5,
    defaultOcclusion = 1.0,
    outputPath,
  } = options;

  let metallicImg = null;
  let occlusionImg = null;
  let roughnessImg = null;

  if (metallicGlossPath && fs.existsSync(metallicGlossPath)) {
    try {
      metallicImg = decodePng(fs.readFileSync(metallicGlossPath));
    } catch (e) {}
  }

  if (occlusionPath && fs.existsSync(occlusionPath)) {
    try {
      occlusionImg = decodePng(fs.readFileSync(occlusionPath));
    } catch (e) {}
  }

  if (roughnessPath && fs.existsSync(roughnessPath)) {
    try {
      roughnessImg = decodePng(fs.readFileSync(roughnessPath));
    } catch (e) {}
  }

  const width = metallicImg?.width || occlusionImg?.width || roughnessImg?.width || 256;
  const height = metallicImg?.height || occlusionImg?.height || roughnessImg?.height || 256;

  const ormBuffer = Buffer.alloc(width * height * 4);

  const defMetallicByte = Math.round(Math.max(0, Math.min(1, defaultMetallic)) * 255);
  const defRoughnessByte = Math.round(Math.max(0, Math.min(1, defaultRoughness)) * 255);
  const defOcclusionByte = Math.round(Math.max(0, Math.min(1, defaultOcclusion)) * 255);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // 1. Occlusion (R channel in Cocos ORM)
      let ao = defOcclusionByte;
      if (occlusionImg) {
        const ox = Math.floor((x / width) * occlusionImg.width);
        const oy = Math.floor((y / height) * occlusionImg.height);
        const oIdx = (oy * occlusionImg.width + ox) * 4;
        // Occlusion is usually in G channel or R channel of AO map
        ao = occlusionImg.data[oIdx + 1] !== undefined ? occlusionImg.data[oIdx + 1] : occlusionImg.data[oIdx];
      }

      // 2. Roughness (G channel in Cocos ORM)
      let roughness = defRoughnessByte;
      if (roughnessImg) {
        const rx = Math.floor((x / width) * roughnessImg.width);
        const ry = Math.floor((y / height) * roughnessImg.height);
        const rIdx = (ry * roughnessImg.width + rx) * 4;
        roughness = roughnessImg.data[rIdx];
      } else if (metallicImg) {
        const mx = Math.floor((x / width) * metallicImg.width);
        const my = Math.floor((y / height) * metallicImg.height);
        const mIdx = (my * metallicImg.width + mx) * 4;
        // Unity MetallicGlossMap stores Smoothness in Alpha channel. Roughness = 255 - Smoothness
        const smoothness = metallicImg.data[mIdx + 3];
        roughness = 255 - smoothness;
      }

      // 3. Metallic (B channel in Cocos ORM)
      let metallic = defMetallicByte;
      if (metallicImg) {
        const mx = Math.floor((x / width) * metallicImg.width);
        const my = Math.floor((y / height) * metallicImg.height);
        const mIdx = (my * metallicImg.width + mx) * 4;
        // Unity Metallic is in R channel
        metallic = metallicImg.data[mIdx];
      }

      ormBuffer[idx] = ao;           // R: AO
      ormBuffer[idx + 1] = roughness; // G: Roughness
      ormBuffer[idx + 2] = metallic;  // B: Metallic
      ormBuffer[idx + 3] = 255;       // A: 255
    }
  }

  const encodedPng = encodePng(width, height, ormBuffer);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, encodedPng);
  }

  return {
    width,
    height,
    buffer: encodedPng,
  };
}

module.exports = {
  decodePng,
  encodePng,
  packPbrOrmTexture,
};
