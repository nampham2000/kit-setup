'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertEffectPropertyBindings } = require('../shader-compiler/effect-property-bindings.cjs');
const { assertEffectCompilesSync } = require('../shader-compiler/effect-compile-gate.cjs');

// Windows: the Cocos Editor (AssetDB, library/ importer caches) briefly holds files open, and a
// rename onto them fails with EPERM/EBUSY/EACCES; a whole porter batch then failed on one prefab.
// Retry the atomic rename for a bounded time; other errors, or a lock that persists, still throw.
const TRANSIENT_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);
function renameWithRetry(from, to, { attempts = 12, rename = fs.renameSync, wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return rename(from, to); } catch (error) {
      if (!TRANSIENT_RENAME.has(error?.code) || attempt >= attempts) throw error;
      wait(Math.min(1000, 25 * 2 ** attempt));
    }
  }
}

/** Publish complete content once; temporary bytes never enter the Assets tree. */
function writeGeneratedAssetText(file, content, options) {
  const destination = path.resolve(file), project = path.resolve(options.cocosRoot);
  if (!destination.startsWith(project + path.sep)) throw new Error('Generated asset must remain within its Cocos project');
  if (/\.effect$/i.test(destination)) {
    assertEffectPropertyBindings(content);
    // Real editor expansion + GLSL ES 1.00/3.00 compile: an effect Cocos would reject (EFX2406) is never published.
    assertEffectCompilesSync(content, destination);
  }
  if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === content) return false;
  // Same project volume prevents EXDEV when the system TEMP is on C: and the
  // Cocos checkout is on D:. Rename prevents the Editor reading half-written JSON.
  const staging = path.join(project, '.ai', 'asset-write-staging');
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(staging, `${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {encoding:'utf8', flag:'wx'});
    renameWithRetry(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  // This is publication only. AssetDB registration and live import gates still
  // need to finish before a prefab/scene is opened; .meta is not an import receipt.
  return true;
}
module.exports = { writeGeneratedAssetText, renameWithRetry };
