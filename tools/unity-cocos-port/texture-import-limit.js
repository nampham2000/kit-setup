'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const digest = data => crypto.createHash('sha256').update(data).digest('hex');

// Explicit texture-only overrides: resizing sliced/UI sprites also requires their
// pixel coordinates and logical dimensions to be remapped, so never infer a cap.
function readTextureImportLimits(cocosRoot) {
  if (!cocosRoot) return {};
  const file = path.join(cocosRoot, 'assets/resources/playable-config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return config.custom?.assetImport?.textureMaxSizes || {};
}

function textureImportLimit(relativePath, options) {
  if (!options._textureImportLimits) options._textureImportLimits = readTextureImportLimits(options.cocosRoot);
  const value = options._textureImportLimits[relativePath.replace(/\\/g, '/')];
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 1 || value > 16384) throw Error(`Invalid texture max size: ${relativePath}`);
  return value;
}

function copyTextureWithLimit(source, destination, maxSize, cocosRoot) {
  if (path.resolve(source) === path.resolve(destination)) throw Error('Unity source must remain read-only');
  const root = path.resolve(cocosRoot, 'assets');
  if (!path.resolve(destination).startsWith(root + path.sep)) throw Error('Texture output must be inside Cocos assets');
  const cacheDir = path.join(cocosRoot, '.unity/texture-import-cache');
  const cacheFile = path.join(cacheDir, digest(path.resolve(destination)) + '.json');
  const sourceHash = digest(fs.readFileSync(source));
  let cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  if (cache?.version === 1 && cache.sourceHash === sourceHash && cache.maxSize === maxSize
      && fs.existsSync(destination) && cache.outputHash === digest(fs.readFileSync(destination))) return 'unchanged';
  const existed = fs.existsSync(destination);
  // Keep the synchronous porter API while sharp performs the resize in a worker.
  const worker = spawnSync(process.execPath, [__filename, source, destination, String(maxSize)], {encoding:'utf8',windowsHide:true});
  if (worker.status !== 0) throw Error(worker.stderr || 'Texture resize worker failed');
  fs.mkdirSync(cacheDir, {recursive:true});
  fs.writeFileSync(cacheFile, JSON.stringify({version:1,sourceHash,maxSize,outputHash:digest(fs.readFileSync(destination))}));
  return existed ? 'refreshed' : 'copied';
}

async function resizeTexture(source, destination, maxSize) {
  const sharp = require('sharp');
  const metadata = await sharp(source).metadata();
  if (!['png','jpeg','webp'].includes(metadata.format)) throw Error('Texture resize supports PNG/JPEG/WebP only');
  // Preserve alpha and aspect ratio; resizing may not upscale a small source.
  const pipeline = sharp(source).resize({width:maxSize,height:maxSize,fit:'inside',withoutEnlargement:true});
  if (metadata.format === 'png') pipeline.png({compressionLevel:9});
  else if (metadata.format === 'jpeg') pipeline.jpeg({quality:100,chromaSubsampling:'4:4:4'});
  else pipeline.webp({lossless:true});
  const buffer = await pipeline.toBuffer();
  const temporary = destination + `.resize-${process.pid}`;
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  try {fs.writeFileSync(temporary, buffer);fs.renameSync(temporary, destination);}
  finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}

module.exports = {readTextureImportLimits, textureImportLimit, copyTextureWithLimit};
if (require.main === module) {
  const [source,destination,size] = process.argv.slice(2);
  resizeTexture(source,destination,Number(size)).catch(error => {console.error(error);process.exitCode=1;});
}
