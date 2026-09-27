'use strict';

// Cocos Creator 3.8.x resolves "intrinsic flag" features (marionette -> MARIONETTE,
// procedural-animation, spine-3.8/spine-4.2, vendor-google) through cc.config.json
// `moduleOverrides` that are baked into ONE preview import map inside the editor install:
//   <engine>/bin/.cache/dev/preview/import-map.json
// The preview page loads that file directly (/scripting/engine/bin/.cache/dev/preview/import-map.json).
// Every Cocos project opened from the same install rewrites it with its own features when its
// editor starts or recompiles the engine, so a project whose profile enables marionette can
// silently run a preview where `cc.animation.AnimationController` does not exist. The project
// temp import map carries no cc-fu unit for these features, so this shared file is the only
// runtime evidence of what the preview actually loads.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PREVIEW_IMPORT_MAP = ['bin', '.cache', 'dev', 'preview', 'import-map.json'];
const SHARED_SOURCE_LABEL = 'cocos-install:bin/.cache/dev/preview/import-map.json';

function moduleSuffix(file) {
  return `/${String(file).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.ts$/, '.js')}`;
}

function lookupImport(imports, file) {
  const suffix = moduleSuffix(file);
  for (const [key, value] of Object.entries(imports)) {
    if (key.endsWith(suffix)) return typeof value === 'string' ? value : null;
  }
  return undefined;
}

function overrideApplied(imports, from, to) {
  const target = lookupImport(imports, from);
  return typeof target === 'string' && target.endsWith(moduleSuffix(to));
}

/**
 * Evaluate which intrinsic-flag features are active in an engine preview import map.
 * Only the two literal test shapes Cocos uses for intrinsic flags are evaluated:
 * `!context.buildTimeConstants.FLAG` (stub applied when the feature is off) and
 * `context.buildTimeConstants.FLAG` (override applied when the feature is on).
 */
function evaluateIntrinsicFeatures(ccConfig, importMap) {
  const imports = importMap && typeof importMap.imports === 'object' && importMap.imports ? importMap.imports : {};
  const overrides = Array.isArray(ccConfig && ccConfig.moduleOverrides) ? ccConfig.moduleOverrides : [];
  const features = {};
  const flags = {};
  for (const [feature, definition] of Object.entries((ccConfig && ccConfig.features) || {})) {
    const intrinsic = definition && typeof definition.intrinsicFlags === 'object' ? definition.intrinsicFlags : null;
    if (!intrinsic) continue;
    let active;
    for (const flag of Object.keys(intrinsic)) {
      for (const entry of overrides) {
        const test = String((entry && entry.test) || '').replace(/\s+/g, '');
        const negative = test === `!context.buildTimeConstants.${flag}`;
        const positive = test === `context.buildTimeConstants.${flag}`;
        if (!negative && !positive) continue;
        const pairs = Object.entries((entry && entry.overrides) || {});
        if (!pairs.length) continue;
        const flagActive = negative
          ? pairs.every(([from, to]) => !overrideApplied(imports, from, to))
          : pairs.every(([from, to]) => overrideApplied(imports, from, to));
        flags[flag] = flags[flag] === undefined ? flagActive : flags[flag] && flagActive;
        active = active === undefined ? flagActive : active && flagActive;
      }
    }
    if (active !== undefined) features[feature] = active;
  }
  return { features, flags };
}

function isEngineRoot(dir) {
  return typeof dir === 'string' && dir.length > 0 && fs.existsSync(path.join(dir, 'cc.config.json'));
}

function engineRootFromCreatorPath(candidate) {
  if (!candidate) return null;
  const base = /\.(exe|app)$/i.test(candidate) ? path.dirname(candidate) : candidate;
  const options = [
    path.join(base, 'resources', 'resources', '3d', 'engine'),
    path.join(base, 'Contents', 'Resources', 'resources', '3d', 'engine'),
    path.join(base, 'CocosCreator.app', 'Contents', 'Resources', 'resources', '3d', 'engine'),
    base,
  ];
  return options.find(isEngineRoot) || null;
}

function projectCreatorVersion(projectRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const version = manifest && manifest.creator && manifest.creator.version;
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch (_) {
    return null;
  }
}

/**
 * Locate the engine used by this project's editor. `options.engineRoot === false/null` disables
 * the lookup (tests, non-editor contexts). Order: explicit option, COCOS_ENGINE_ROOT, the
 * COCOS_CREATOR_PATH install, then the standard Dashboard install for package.json creator.version.
 */
function resolveCocosEngineRoot(projectRoot, options = {}) {
  if (options.engineRoot === false || options.engineRoot === null) return null;
  if (typeof options.engineRoot === 'string') return isEngineRoot(options.engineRoot) ? options.engineRoot : null;
  const env = options.env || process.env;
  if (env.COCOS_ENGINE_ROOT && isEngineRoot(env.COCOS_ENGINE_ROOT)) return env.COCOS_ENGINE_ROOT;
  const version = projectCreatorVersion(projectRoot);
  if (!version) return null;
  const candidates = [];
  if (env.COCOS_CREATOR_PATH) {
    candidates.push(env.COCOS_CREATOR_PATH, path.join(env.COCOS_CREATOR_PATH, version));
  }
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    candidates.push(`C:/ProgramData/cocos/editors/Creator/${version}`);
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'CocosDashboard', 'resources', '.editors', 'Creator', version));
  } else if (platform === 'darwin') {
    candidates.push(`/Applications/Cocos/Creator/${version}`);
  }
  for (const candidate of candidates) {
    const root = engineRootFromCreatorPath(candidate);
    if (root && root.replace(/\\/g, '/').includes(`/${version}/`)) return root;
  }
  return null;
}

/** Read the shared engine preview import map and evaluate intrinsic-flag features. */
function readSharedPreviewIntrinsics(engineRoot) {
  const unavailable = (error) => ({
    available: false, source: SHARED_SOURCE_LABEL, features: {}, flags: {},
    sha256: null, modifiedMs: null, error,
  });
  if (!engineRoot) return unavailable('Cocos engine root is not resolved (set COCOS_ENGINE_ROOT or package.json creator.version).');
  try {
    const ccConfig = JSON.parse(fs.readFileSync(path.join(engineRoot, 'cc.config.json'), 'utf8'));
    const file = path.join(engineRoot, ...PREVIEW_IMPORT_MAP);
    const bytes = fs.readFileSync(file);
    const evaluated = evaluateIntrinsicFeatures(ccConfig, JSON.parse(bytes.toString('utf8')));
    return {
      available: Object.keys(evaluated.features).length > 0,
      source: SHARED_SOURCE_LABEL,
      shared: true,
      features: evaluated.features,
      flags: evaluated.flags,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      modifiedMs: fs.statSync(file).mtimeMs,
      error: Object.keys(evaluated.features).length ? undefined : 'cc.config.json declares no evaluable intrinsic-flag overrides',
    };
  } catch (error) {
    return unavailable(error.message);
  }
}

module.exports = {
  SHARED_SOURCE_LABEL,
  evaluateIntrinsicFeatures,
  readSharedPreviewIntrinsics,
  resolveCocosEngineRoot,
};
