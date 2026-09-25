'use strict';

// Unity deterministic local file identifiers for imported sub-assets.
//
// Since Unity 2019.x the ModelImporter no longer stores `internalIDToNameTable` entries for
// sub-assets; the fileID referenced by prefabs (`m_Mesh: {fileID: <id>, guid: <fbx>}`) is
//   int64( xxHash64( "Type:" + <ClassName> + "->" + <objectName> + <duplicateIndex> ) )
// where duplicateIndex is 0 for the first object of that type/name, 1 for the next, ...
// Verified against a live Unity 6000.3 Editor (AssetDatabase.TryGetGUIDAndLocalFileIdentifier):
//   Type:Mesh->Candy.0010      ->  812695599402130866
//   Type:Mesh->obj_screw_new0  -> -1351841031486281740

const MASK = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

function rotl(x, r) {
  const n = BigInt(r);
  return ((x << n) | (x >> (64n - n))) & MASK;
}

function round(acc, input) {
  acc = (acc + input * P2) & MASK;
  acc = rotl(acc, 31);
  return (acc * P1) & MASK;
}

function mergeRound(acc, value) {
  acc ^= round(0n, value);
  return (acc * P1 + P4) & MASK;
}

function readU64(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function readU32(buffer, offset) {
  return BigInt(buffer.readUInt32LE(offset));
}

/** xxHash64 (seed 0 by default) of a Buffer, returned as an unsigned BigInt. */
function xxHash64(buffer, seed = 0n) {
  const length = buffer.length;
  let offset = 0;
  let hash;
  if (length >= 32) {
    let v1 = (seed + P1 + P2) & MASK;
    let v2 = (seed + P2) & MASK;
    let v3 = seed & MASK;
    let v4 = (seed - P1) & MASK;
    while (offset <= length - 32) {
      v1 = round(v1, readU64(buffer, offset));
      v2 = round(v2, readU64(buffer, offset + 8));
      v3 = round(v3, readU64(buffer, offset + 16));
      v4 = round(v4, readU64(buffer, offset + 24));
      offset += 32;
    }
    hash = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) & MASK;
    hash = mergeRound(hash, v1);
    hash = mergeRound(hash, v2);
    hash = mergeRound(hash, v3);
    hash = mergeRound(hash, v4);
  } else {
    hash = (seed + P5) & MASK;
  }
  hash = (hash + BigInt(length)) & MASK;
  while (offset + 8 <= length) {
    hash ^= round(0n, readU64(buffer, offset));
    hash = (rotl(hash, 27) * P1 + P4) & MASK;
    offset += 8;
  }
  if (offset + 4 <= length) {
    hash ^= (readU32(buffer, offset) * P1) & MASK;
    hash = (rotl(hash, 23) * P2 + P3) & MASK;
    offset += 4;
  }
  while (offset < length) {
    hash ^= (BigInt(buffer[offset]) * P5) & MASK;
    hash = (rotl(hash, 11) * P1) & MASK;
    offset += 1;
  }
  hash ^= hash >> 33n;
  hash = (hash * P2) & MASK;
  hash ^= hash >> 29n;
  hash = (hash * P3) & MASK;
  hash ^= hash >> 32n;
  return hash;
}

/** Signed decimal string of the Unity fileID for `Type:<className>-><name><index>`. */
function unitySubAssetFileId(className, name, index = 0) {
  const unsigned = xxHash64(Buffer.from(`Type:${className}->${name}${index}`, 'utf8'));
  const signed = unsigned >= (1n << 63n) ? unsigned - (1n << 64n) : unsigned;
  return signed.toString();
}

/**
 * Returns the candidate (from `names`) whose deterministic Unity fileID equals `fileId`, trying
 * duplicate indices 0..maxIndex. `names` are imported sub-asset names (e.g. Cocos mesh names).
 * Unity can name an FBX mesh after its node while the file geometry keeps Blender's ".NNN" suffix
 * (Cocos imports `obj_tray_color.001`, Unity hashes `obj_tray_color`), so the suffix-stripped name is
 * also tried; the result still requires an exact 64-bit hash match.
 */
function matchUnitySubAssetName(className, names, fileId, maxIndex = 8) {
  const target = String(fileId);
  for (const name of names) {
    const candidates = [name];
    const stripped = String(name).replace(/\.\d{3}$/, '');
    if (stripped !== name) candidates.push(stripped);
    for (const candidate of candidates) {
      for (let index = 0; index <= maxIndex; index++) {
        if (unitySubAssetFileId(className, candidate, index) === target) return { name, index, unityName: candidate };
      }
    }
  }
  return null;
}

module.exports = { xxHash64, unitySubAssetFileId, matchUnitySubAssetName };
