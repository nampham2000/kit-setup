'use strict';

const fs = require('fs');
const crypto = require('crypto');

class UnityCocosPortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnityCocosPortError';
  }
}

function fail(message) {
  throw new UnityCocosPortError(message);
}

function log(message) {
  console.log(`[unity-cocos-port] ${message}`);
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function randomUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableUuid(seed) {
  const bytes = crypto.createHash('sha1').update(String(seed || 'asset')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function compressUuid(uuid) {
  const compact = String(uuid || '').replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return String(uuid || '');

  // Cocos keeps the first five hex characters verbatim, then base64-encodes
  // the remaining 27 nibbles. Padding the odd nibble for Buffer and trimming
  // the extra base64 character reproduces Editor class IDs exactly.
  const head = compact.slice(0, 5);
  const rest = compact.slice(5);
  const evenRest = rest.length % 2 === 0 ? rest : `${rest}0`;
  let encoded = Buffer.from(evenRest, 'hex').toString('base64').replace(/=+$/g, '');
  if (rest.length % 2 !== 0) encoded = encoded.slice(0, -1);
  return head + encoded;
}

function randomLocalId() {
  return compressUuid(randomUuid());
}

function stableSubAssetId(seed, usedIds = new Set()) {
  let attempt = 0;
  while (attempt < 1000) {
    const input = attempt ? `${seed}:${attempt}` : String(seed || 'asset');
    const id = crypto.createHash('sha1').update(input).digest('hex').slice(0, 5);
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
    attempt += 1;
  }
  return randomUuid().replace(/-/g, '').slice(0, 5);
}

/**
 * Copies a Unity asset into the Cocos project, replacing an existing copy whose bytes
 * no longer match. Skipping the overwrite silently keeps stale art in the playable
 * whenever the Unity source is re-exported, and the reference still resolves so nothing
 * reports it. Returns 'created' | 'refreshed' | 'unchanged' | '' (source missing).
 */
function copyAssetIfChanged(sourceFile, destFile) {
  if (!sourceFile || !destFile || !fs.existsSync(sourceFile)) return '';
  if (!fs.existsSync(destFile)) {
    fs.copyFileSync(sourceFile, destFile);
    return 'created';
  }
  const source = fs.statSync(sourceFile);
  const dest = fs.statSync(destFile);
  if (source.size === dest.size) {
    const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
    if (hash(sourceFile) === hash(destFile)) return 'unchanged';
  }
  fs.copyFileSync(sourceFile, destFile);
  return 'refreshed';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function vec2(x = 0, y = 0) {
  return { __type__: 'cc.Vec2', x, y };
}

function vec3(x = 0, y = 0, z = 0) {
  return { __type__: 'cc.Vec3', x, y, z };
}

function quat(x = 0, y = 0, z = 0, w = 1) {
  return { __type__: 'cc.Quat', x, y, z, w };
}

function color(r = 255, g = 255, b = 255, a = 255) {
  return { __type__: 'cc.Color', r, g, b, a };
}

function rect(x = 0, y = 0, width = 1, height = 1) {
  return { __type__: 'cc.Rect', x, y, width, height };
}

function size(width = 0, height = 0) {
  return { __type__: 'cc.Size', width, height };
}

function cocosRef(id) {
  return { __id__: Number(id) };
}

function cocosUuid(uuid, expectedType) {
  if (!uuid) return null;
  return expectedType ? { __uuid__: uuid, __expectedType__: expectedType } : { __uuid__: uuid };
}

function convertPosition(value) {
  return vec3(Number(value?.x || 0), Number(value?.y || 0), Number(-(value?.z || 0)));
}

function convertScale(value) {
  return vec3(Number(value?.x ?? 1), Number(value?.y ?? 1), Number(value?.z ?? 1));
}

function convertRotation(value) {
  return quat(Number(-(value?.x || 0)), Number(-(value?.y || 0)), Number(value?.z || 0), Number(value?.w ?? 1));
}

function convertEuler(value) {
  return vec3(Number(-(value?.x || 0)), Number(value?.y || 0), Number(-(value?.z || 0)));
}

function unityColorToCocos(value, alphaOverride = null) {
  const source = value || {};
  const alpha = alphaOverride == null ? source.a : alphaOverride;
  return color(
    Math.max(0, Math.min(255, Math.round(Number(source.r ?? 1) * 255))),
    Math.max(0, Math.min(255, Math.round(Number(source.g ?? 1) * 255))),
    Math.max(0, Math.min(255, Math.round(Number(source.b ?? 1) * 255))),
    Math.max(0, Math.min(255, Math.round(Number(alpha ?? 1) * 255)))
  );
}

function findFiles(root, predicate) {
  const results = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = require('path').join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
      } else if (!predicate || predicate(file)) {
        results.push(file);
      }
    }
  };
  walk(root);
  return results;
}

function unityNumber(value, fallback = 0) {
  const text = String(value ?? '').trim();
  if (/^-?Infinity$/i.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeAssetDisplayName(value, fallback = 'asset') {
  const cleaned = String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_');
  return cleaned || fallback;
}

function sanitizeFileId(value) {
  return String(value || 'node')
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'node';
}

module.exports = {
  UnityCocosPortError,
  fail,
  log,
  toPosix,
  normalizeKey,
  randomUuid,
  stableUuid,
  compressUuid,
  randomLocalId,
  stableSubAssetId,
  ensureDir,
  copyAssetIfChanged,
  readJsonIfExists,
  csvEscape,
  escapeRegex,
  vec2,
  vec3,
  quat,
  color,
  rect,
  size,
  cocosRef,
  cocosUuid,
  convertPosition,
  convertScale,
  convertRotation,
  convertEuler,
  unityColorToCocos,
  findFiles,
  unityNumber,
  finiteNumber,
  sanitizeAssetDisplayName,
  sanitizeFileId,
};
