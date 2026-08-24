'use strict';

const fs = require('node:fs');
const {
  isBinarySerializedFile,
  parseBinaryUnityFile,
  binaryDocsToUnityYaml,
} = require('../lib/unity-serialized-file.cjs');

const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const SERIALIZED_EXTENSIONS = new Set([
  '.unity', '.prefab', '.asset', '.mat', '.controller', '.overridecontroller',
  '.anim', '.playable', '.spriteatlas', '.mixer', '.mask', '.physicmaterial',
  '.physicsmaterial2d', '.rendertexture', '.cubemap', '.guiskin', '.preset', '.vfx',
]);
const TEXT_EXTENSIONS = new Set([
  ...SERIALIZED_EXTENSIONS,
  '.cs', '.shader', '.shadergraph', '.compute', '.cginc', '.hlsl', '.glslinc',
  '.asmdef', '.asmref', '.inputactions', '.json', '.txt', '.xml', '.uxml', '.uss',
]);

function readUtf8(filePath, sizeBytes = null) {
  let size = sizeBytes;
  if (!Number.isFinite(size)) {
    try { size = fs.statSync(filePath).size; } catch (_) { return ''; }
  }
  if (size > MAX_TEXT_BYTES) return '';
  try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return ''; }
}

function readAssetEvidence(filePath, extension, sizeBytes) {
  const ext = String(extension || '').toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return { format: 'opaque', complete: true, text: '', error: null };
  }
  if (sizeBytes > MAX_TEXT_BYTES) {
    return {
      format: 'too-large',
      complete: false,
      text: '',
      error: `text evidence exceeds ${MAX_TEXT_BYTES} bytes`,
    };
  }
  if (SERIALIZED_EXTENSIONS.has(ext) && isBinarySerializedFile(filePath)) {
    const parsed = parseBinaryUnityFile(filePath);
    if (!parsed.ok) {
      return { format: 'binary', complete: false, text: '', error: parsed.reason || 'binary parse failed' };
    }
    return {
      format: 'binary',
      complete: true,
      text: binaryDocsToUnityYaml(parsed.docs),
      error: null,
      objectCount: parsed.docs.length,
      externalCount: (parsed.externals || []).length,
    };
  }
  const text = readUtf8(filePath, sizeBytes);
  return {
    format: SERIALIZED_EXTENSIONS.has(ext) ? 'yaml' : 'text',
    complete: text !== '' || sizeBytes === 0,
    text,
    error: text !== '' || sizeBytes === 0 ? null : 'text read failed',
  };
}

module.exports = {
  MAX_TEXT_BYTES,
  SERIALIZED_EXTENSIONS,
  TEXT_EXTENSIONS,
  readUtf8,
  readAssetEvidence,
};
