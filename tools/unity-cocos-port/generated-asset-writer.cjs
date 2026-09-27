'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertEffectPropertyBindings } = require('../shader-compiler/effect-property-bindings.cjs');

/** Publish complete content once; temporary bytes never enter the Assets tree. */
function writeGeneratedAssetText(file, content, options) {
  const destination = path.resolve(file), project = path.resolve(options.cocosRoot);
  if (!destination.startsWith(project + path.sep)) throw new Error('Generated asset must remain within its Cocos project');
  if (/\.effect$/i.test(destination)) assertEffectPropertyBindings(content);
  if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === content) return false;
  // Same project volume prevents EXDEV when the system TEMP is on C: and the
  // Cocos checkout is on D:. Rename prevents the Editor reading half-written JSON.
  const staging = path.join(project, '.ai', 'asset-write-staging');
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(staging, `${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {encoding:'utf8', flag:'wx'});
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  // This is publication only. AssetDB registration and live import gates still
  // need to finish before a prefab/scene is opened; .meta is not an import receipt.
  return true;
}
module.exports = { writeGeneratedAssetText };
