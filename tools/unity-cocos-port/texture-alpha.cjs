'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { decodePng } = require('../resource-stats.cjs');

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
function encodeRgba(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=6;
  const scan = Buffer.alloc(height*(width*4+1));
  const pixels=Buffer.from(rgba);
  for(let y=0;y<height;y++) pixels.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
function unityAlphaUsage(source) {
  if (!fs.existsSync(source+'.meta')) return 1;
  return Number(fs.readFileSync(source+'.meta','utf8').match(/^\s*alphaUsage:\s*(\d+)/m)?.[1] ?? 1);
}
// Pure transform so callers can compare the prepared bytes with the Cocos copy before
// writing; returns the input Buffer itself when Unity keeps the source alpha.
function unityTextureAlphaBytes(source, bytes) {
  const mode = unityAlphaUsage(source);
  if (mode === 1) return bytes;
  if (mode === 0 && bytes[0] === 0xff && bytes[1] === 0xd8) return bytes; // JPEG is already opaque.
  if (bytes.length<29 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || ![8,16].includes(bytes[24]) || bytes[28]!==0) {
    throw Error('Unity alpha import requires a non-interlaced 8/16-bit PNG or a live Unity texture export: '+source);
  }
  const image=decodePng(bytes);
  if(!image)throw Error('Cannot decode texture for Unity alpha import: '+source);
  const data=image.rgba;
  for(let i=0;i<data.length;i+=4) data[i+3]=mode===0?255:Math.round(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114);
  const output=encodeRgba(image.width,image.height,data);
  return output.equals(bytes) ? bytes : output;
}
function applyUnityTextureAlpha(source, destination) {
  if (unityAlphaUsage(source) === 1) return false;
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) {
    throw Error('Unity alpha conversion must not overwrite its source texture');
  }
  const bytes=fs.readFileSync(destination);
  const output=unityTextureAlphaBytes(source, bytes);
  if(output===bytes)return false;
  fs.writeFileSync(destination,output);
  return true;
}
module.exports={applyUnityTextureAlpha,unityTextureAlphaBytes,encodeRgba};
