'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadMergedConfigFromFile } = require('../../packages/extensions/json-scriptable-inspector/config-fragments.cjs');

const { stripPngColorProfile } = require('./png-color-profile.cjs');
const { unityTextureAlphaBytes } = require('./texture-alpha.cjs');

const digest = data => crypto.createHash('sha256').update(data).digest('hex');
// v2: raw texels (ignoreIcc), stripped PNG colour chunks and alphaUsage in the cache key.
const TEXTURE_PREPARE_VERSION = 2;

// Explicit texture-only overrides: resizing sliced/UI sprites also requires their
// pixel coordinates and logical dimensions to be remapped, so never infer a cap.
function readTextureImportLimits(cocosRoot) {
  if (!cocosRoot) return {};
  const file = path.join(cocosRoot, 'assets/resources/playable-config.json');
  const config = fs.existsSync(file) ? loadMergedConfigFromFile(file).merged : {};
  return config.custom?.assetImport?.textureMaxSizes || {};
}

function textureImportLimit(relativePath, options) {
  if (!options._textureImportLimits) options._textureImportLimits = readTextureImportLimits(options.cocosRoot);
  const value = options._textureImportLimits[relativePath.replace(/\\/g, '/')];
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 1 || value > 16384) throw Error(`Invalid texture max size: ${relativePath}`);
  return value;
}

function assertTextureOutput(source, destination, cocosRoot) {
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) throw Error('Unity source must remain read-only');
  if (!cocosRoot) return;
  const root = path.resolve(cocosRoot, 'assets');
  if (!path.resolve(destination).startsWith(root + path.sep)) throw Error('Texture output must be inside Cocos assets');
}

function resizedTextureBytes(source, destination, maxSize) {
  // Keep the synchronous porter API while sharp performs the resize in a worker.
  const temporary = destination + `.resize-${process.pid}`;
  try {
    const worker = spawnSync(process.execPath, [__filename, source, temporary, String(maxSize)], {encoding:'utf8',windowsHide:true});
    if (worker.status !== 0) throw Error(worker.stderr || 'Texture resize worker failed');
    return fs.readFileSync(temporary);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function writeAtomically(destination, bytes) {
  const temporary = destination + `.prepare-${process.pid}`;
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  try {fs.writeFileSync(temporary, bytes);fs.renameSync(temporary, destination);}
  finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}

/**
 * Writes the Cocos copy of a Unity texture with Unity's import semantics:
 * optional configured resize, PNG colour-management chunks removed (Unity renders raw
 * texels; browsers would colour-convert them) and the TextureImporter alphaUsage.
 * Compares the prepared bytes with the existing file first, so a repeat port never
 * rewrites (and never makes Cocos reimport) an unchanged texture. The .meta is not touched.
 * Returns {status:'created'|'refreshed'|'unchanged', removedChunks, alphaError}.
 */
function writeUnityTexture(source, destination, {maxSize = 0, cocosRoot = ''} = {}) {
  assertTextureOutput(source, destination, cocosRoot);
  const sourceBytes = fs.readFileSync(source);
  const existed = fs.existsSync(destination);
  const current = existed ? fs.readFileSync(destination) : null;
  // A resize is expensive, so its prepared output is cached by exact input identity.
  const alphaMeta = fs.existsSync(source + '.meta') ? digest(fs.readFileSync(source + '.meta')) : '';
  const cacheFile = maxSize && cocosRoot
    ? path.join(cocosRoot, '.unity/texture-import-cache', digest(path.resolve(destination)) + '.json') : '';
  const cacheKey = {version:TEXTURE_PREPARE_VERSION,sourceHash:digest(sourceBytes),metaHash:alphaMeta,maxSize};
  if (cacheFile && current) {
    let cache;
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    if (cache && Object.entries(cacheKey).every(([key, value]) => cache[key] === value)
        && cache.outputHash === digest(current)) return {status:'unchanged',removedChunks:[],alphaError:''};
  }
  const base = maxSize ? resizedTextureBytes(source, destination, maxSize) : sourceBytes;
  const {bytes: stripped, removed} = stripPngColorProfile(base);
  let prepared = stripped;
  let alphaError = '';
  try { prepared = unityTextureAlphaBytes(source, stripped); } catch (error) { alphaError = String(error); }
  const status = !existed ? 'created' : current.equals(prepared) ? 'unchanged' : 'refreshed';
  if (status !== 'unchanged') writeAtomically(destination, prepared);
  if (cacheFile && !alphaError) {
    fs.mkdirSync(path.dirname(cacheFile), {recursive:true});
    const record = JSON.stringify({...cacheKey,outputHash:digest(prepared)});
    let previous = '';
    try { previous = fs.readFileSync(cacheFile, 'utf8'); } catch {}
    if (previous !== record) fs.writeFileSync(cacheFile, record);
  }
  return {status, removedChunks: removed, alphaError};
}

function copyTextureWithLimit(source, destination, maxSize, cocosRoot) {
  if (!cocosRoot) throw Error('Texture output must be inside Cocos assets');
  const {status, alphaError} = writeUnityTexture(source, destination, {maxSize, cocosRoot});
  if (alphaError) throw Error(alphaError);
  return status === 'created' ? 'copied' : status;
}

async function resizeTexture(source, destination, maxSize) {
  const sharp = require('sharp');
  // Unity ignores embedded colour profiles; decode raw texels instead of converting
  // through the ICC profile (sharp's default) so the resize keeps Unity's colours.
  const metadata = await sharp(source, {ignoreIcc:true}).metadata();
  if (!['png','jpeg','webp'].includes(metadata.format)) throw Error('Texture resize supports PNG/JPEG/WebP only');
  // Preserve alpha and aspect ratio; resizing may not upscale a small source.
  const pipeline = sharp(source, {ignoreIcc:true}).resize({width:maxSize,height:maxSize,fit:'inside',withoutEnlargement:true});
  if (metadata.format === 'png') pipeline.png({compressionLevel:9});
  else if (metadata.format === 'jpeg') pipeline.jpeg({quality:100,chromaSubsampling:'4:4:4'});
  else pipeline.webp({lossless:true});
  const buffer = await pipeline.toBuffer();
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  fs.writeFileSync(destination, buffer);
}

module.exports = {readTextureImportLimits, textureImportLimit, copyTextureWithLimit, writeUnityTexture, TEXTURE_PREPARE_VERSION};
if (require.main === module) {
  const [source,destination,size] = process.argv.slice(2);
  resizeTexture(source,destination,Number(size)).catch(error => {console.error(error);process.exitCode=1;});
}
