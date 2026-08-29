'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyAssetIfChanged, ensureDir, randomUuid, toPosix } = require('./core-utils');
const { exportUnityMeshAssetToGltf } = require('./unity-mesh-fbx-exporter');

const BLENDER_FBX_CONVERTER = path.join(__dirname, 'blender-fbx-to-glb.py');

function fallbackGlbPath(unityAsset, options) {
  return path.join(options.cocosRoot, 'assets', 'unity_imported', unityAsset.relativePath).replace(/\.fbx$/i, '.glb');
}

/**
 * Pending model sub-assets are useful while the Editor is closed because they
 * give generated prefabs deterministic temporary UUIDs.  They must not survive
 * once a converted GLB is ready for a real Cocos import, though: a root meta
 * that already says `imported: true` makes AssetDB trust the placeholder and it
 * registers the GLB as a plain cc.Asset with no mesh children.
 *
 * Only remove a meta that is provably owned by this porter.  A real Cocos meta
 * (or any meta containing a non-placeholder imported sub-asset) is preserved.
 */
function releaseOwnedPendingModelMeta(assetFile) {
  const metaFile = `${assetFile}.meta`;
  if (!fs.existsSync(metaFile)) return false;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch {
    return false;
  }
  if (meta?.importer !== 'gltf') return false;
  const subMetas = Object.values(meta.subMetas || {});
  const ownedPending = subMetas.filter((subMeta) =>
    subMeta?.userData?.unityCocosPortPendingImport === true);
  if (!ownedPending.length) return false;
  const hasRealImportedSubAsset = subMetas.some((subMeta) =>
    subMeta?.imported === true && subMeta?.userData?.unityCocosPortPendingImport !== true);
  if (hasRealImportedSubAsset) return false;
  fs.unlinkSync(metaFile);
  // Touch the model as well as removing its placeholder meta so a running
  // AssetDB watcher sees a fresh import boundary immediately.
  const now = new Date();
  fs.utimesSync(assetFile, now, now);
  return true;
}

function buildFbxConverterInvocation(converter, input, output) {
  const executable = path.basename(converter).toLowerCase();
  if (/^assimp(?:\.exe)?$/.test(executable)) {
    return { backend: 'assimp', args: ['export', input, output] };
  }
  if (/^blender(?:\.exe)?$/.test(executable)) {
    return {
      backend: 'blender',
      args: [
        '--background',
        '--factory-startup',
        '--python', BLENDER_FBX_CONVERTER,
        '--',
        '--input', input,
        '--output', output,
      ],
    };
  }
  return { backend: 'fbx2gltf', args: ['-i', input, '-o', output] };
}

function shouldContinueToFbxFallback(meshAsset, resolved, options) {
  return meshAsset?.ext === '.fbx'
    && Boolean(options?.convertFbxFallback)
    && (!resolved || Boolean(resolved.pendingImport));
}

module.exports = function createAssetImportPorter(deps) {
  const {
    ensureDirectoryMetas,
    ensurePreparedAssetMeta,
    recoverModelMetaFromLibrary,
    waitForImportedModelAsset,
  } = deps;

  function importedUnityAssetPath(unityAsset, options) {
    if (!unityAsset?.relativePath) return '';
    return path.join(options.cocosRoot, 'assets', 'unity_imported', unityAsset.relativePath);
  }

  function ensureAssetMeta(assetFile, kind, config = {}) {
    const prepared = ensurePreparedAssetMeta(assetFile, kind, config);
    if (prepared) return;
    const metaFile = `${assetFile}.meta`;
    if (fs.existsSync(metaFile)) return;
    const ext = path.extname(assetFile).toLowerCase();
    const importer = ext === '.fbx'
      ? 'fbx'
      : ['.gltf', '.glb'].includes(ext)
        ? 'gltf'
      : ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)
        ? 'image'
        : 'asset';
    const meta = {
      ver: importer === 'image' ? '1.0.27' : '2.3.14',
      importer,
      imported: true,
      uuid: randomUuid(),
      files: [],
      subMetas: {},
      userData: {},
    };
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }

  /**
   * Unity's TextureImporter wrap enum -> the Cocos texture userData value.
   * -1 means "not overridden", and Unity's own default is Repeat; Cocos defaults
   * the other way (clamp), so a tiled material silently smears its edge pixels
   * across the surface unless the Unity value is carried over.
   */
  const UNITY_WRAP_MODES = {
    '-1': 'repeat', // not overridden -> Unity default
    0: 'repeat',
    1: 'clamp-to-edge',
    2: 'mirrored-repeat',
    3: 'clamp-to-edge', // MirrorOnce has no Cocos equivalent
  };

  function unityWrapMode(text, axisKey) {
    const axis = text.match(new RegExp(`^\\s*${axisKey}:\\s*(-?\\d+)`, 'm'));
    const all = text.match(/^\s*m_WrapMode:\s*(-?\d+)/m);
    const raw = axis ? axis[1] : (all ? all[1] : '-1');
    return UNITY_WRAP_MODES[raw] || 'repeat';
  }

  function unityTextureImporterConfig(assetFile) {
    const metaFile = `${assetFile}.meta`;
    if (!fs.existsSync(metaFile)) return {};
    const text = fs.readFileSync(metaFile, 'utf8');
    const meshType = text.match(/^\s*spriteMeshType:\s*(\d+)/m);
    return {
      fixAlphaTransparencyArtifacts: /^\s*alphaIsTransparency:\s*1\s*$/m.test(text),
      spriteTrimType: meshType && Number(meshType[1]) === 0 ? 'none' : 'auto',
      wrapModeS: unityWrapMode(text, 'wrapU'),
      wrapModeT: unityWrapMode(text, 'wrapV'),
    };
  }

  function copyUnityAssetToCocos(unityAsset, options, reporter, kind, severity = 'medium', config = {}) {
    const { deferNeedsImportReport = false } = config;
    const dest = path.join(options.cocosRoot, 'assets', 'unity_imported', unityAsset.relativePath);
    if (!fs.existsSync(unityAsset.path)) return '';
    if (options.dryRun) {
      if (fs.existsSync(dest)) return dest;
      reporter.add(severity, 'ASSET_COPY_SKIPPED_DRY_RUN', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Unity asset would be copied to Cocos; dry-run left the filesystem unchanged');
      return '';
    }
    ensureDir(path.dirname(dest));
    ensureDirectoryMetas(path.dirname(dest), path.join(options.cocosRoot, 'assets'));
    const copyResult = copyAssetIfChanged(unityAsset.path, dest);
    if (copyResult === 'refreshed') {
      // The .meta and its uuid are left alone so existing references keep resolving;
      // the editor re-imports on the changed file.
      reporter.low(
        'ASSET_REFRESHED',
        unityAsset.relativePath,
        toPosix(path.relative(options.cocosRoot, dest)),
        'Existing Cocos copy differed from the Unity source and was replaced; refresh/import is required',
      );
    }
    if (kind === 'model') recoverModelMetaFromLibrary(dest, options);
    const importConfig = kind === 'image'
      ? { ...unityTextureImporterConfig(unityAsset.path), ...config }
      : config;
    ensureAssetMeta(dest, kind, importConfig);
    if (kind === 'model') recoverModelMetaFromLibrary(dest, options);
    if (!deferNeedsImportReport) {
      reporter.add(severity, 'ASSET_COPIED_NEEDS_IMPORT', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Unity asset copied to Cocos; refresh/import is required before it can be wired');
    }
    return dest;
  }

  function findCommand(names) {
    const command = process.platform === 'win32' ? 'where' : 'which';
    for (const name of names) {
      const result = spawnSync(command, [name], { encoding: 'utf8' });
      if (result.status === 0) return result.stdout.split(/\r?\n/).find(Boolean) || name;
    }
    if (names.some(name => /^blender(?:\.exe)?$/i.test(name))) {
      const candidates = [];
      if (process.env.BLENDER_PATH) candidates.push(process.env.BLENDER_PATH);
      if (process.platform === 'win32') {
        const roots = [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Blender Foundation'),
          'D:\\Tools',
        ];
        for (const root of roots) {
          if (!root || !fs.existsSync(root)) continue;
          for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^Blender(?:\s|$)/i.test(entry.name)) continue;
            candidates.push(path.join(root, entry.name, 'blender.exe'));
          }
        }
      } else if (process.platform === 'darwin') {
        candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
      } else {
        candidates.push('/usr/bin/blender', '/usr/local/bin/blender');
      }
      const available = candidates.filter(candidate => candidate && fs.existsSync(candidate));
      available.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (available.length) return available[0];
    }
    return '';
  }

  function convertFbxToGlb(unityAsset, converter, options, reporter, severity = 'medium') {
    const dest = fallbackGlbPath(unityAsset, options);
    if (options.dryRun) {
      reporter.add(severity, 'FBX_FALLBACK_SKIPPED_DRY_RUN', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'FBX fallback would run during a real port; dry-run did not create files or launch a converter');
      return '';
    }
    ensureDir(path.dirname(dest));
    ensureDirectoryMetas(path.dirname(dest), path.join(options.cocosRoot, 'assets'));
    if (fs.existsSync(dest)) {
      if (releaseOwnedPendingModelMeta(dest)) {
        reporter.low('FBX_FALLBACK_PENDING_META_RELEASED', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Released a porter-owned placeholder meta so Cocos AssetDB can perform the real GLB import');
      }
      reporter.add(severity, 'FBX_FALLBACK_EXISTS', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Existing GLB fallback found; refresh/import is required before it can be wired');
      return dest;
    }

    const invocation = buildFbxConverterInvocation(converter, unityAsset.path, dest);
    if (invocation.backend === 'blender' && !fs.existsSync(BLENDER_FBX_CONVERTER)) {
      reporter.add(severity, 'FBX_FALLBACK_FAILED', unityAsset.relativePath, converter, 'Bundled Blender FBX fallback script is missing', BLENDER_FBX_CONVERTER);
      return '';
    }
    const result = spawnSync(converter, invocation.args, {
      encoding: 'utf8',
      timeout: 180000,
      windowsHide: true,
    });
    if (result.status !== 0) {
      const detail = `${result.stderr || result.stdout || result.error?.message || ''}`.trim();
      reporter.add(severity, 'FBX_FALLBACK_FAILED', unityAsset.relativePath, converter, `FBX fallback conversion failed (${invocation.backend})`, detail);
      return '';
    }
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
      reporter.add(severity, 'FBX_FALLBACK_FAILED', unityAsset.relativePath, converter, `FBX fallback conversion produced no GLB (${invocation.backend})`);
      return '';
    }
    reporter.add(severity, 'FBX_FALLBACK_CREATED', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), `Created GLB fallback with ${invocation.backend}; refresh/import is required before it can be wired`);
    return dest;
  }

  function extractedUnityMeshGltfPath(unityAsset, options) {
    return importedUnityAssetPath(unityAsset, options).replace(/\.asset$/i, '.gltf');
  }

  function prepareUnityMeshAssetGltf(meshAsset, reporter, options, severity, meshNameHint = '') {
    const dest = extractedUnityMeshGltfPath(meshAsset, options);
    if (!dest || !fs.existsSync(meshAsset.path)) return null;

    if (options.dryRun) {
      reporter.add(severity, 'UNITY_MESH_ASSET_GLTF_EXTRACT_SKIPPED_DRY_RUN', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Unity Mesh .asset would be extracted to glTF; dry-run left the filesystem unchanged');
      return null;
    }

    ensureDir(path.dirname(dest));
    ensureDirectoryMetas(path.dirname(dest), path.join(options.cocosRoot, 'assets'));

    let exported = null;
    try {
      exported = exportUnityMeshAssetToGltf(meshAsset.path, dest);
    } catch (error) {
      reporter.add(severity === 'low' ? 'low' : 'medium', 'UNITY_MESH_ASSET_GLTF_EXTRACT_FAILED', meshAsset.relativePath, '', 'Unity Mesh .asset could not be extracted to glTF', error?.message || String(error));
      return null;
    }

    if (!exported) {
      reporter.add(severity === 'low' ? 'low' : 'medium', 'UNITY_MESH_ASSET_GLTF_EXTRACT_FAILED', meshAsset.relativePath, '', 'Unity Mesh .asset did not contain readable uncompressed mesh data');
      return null;
    }

    const resolvedMeshName = meshNameHint || exported.meshName || meshAsset.stem;
    recoverModelMetaFromLibrary(dest, options);
    ensureAssetMeta(dest, 'model', { meshNameHint: resolvedMeshName });
    recoverModelMetaFromLibrary(dest, options);
    reporter.add(
      severity,
      'UNITY_MESH_ASSET_GLTF_EXTRACTED',
      meshAsset.relativePath,
      toPosix(path.relative(options.cocosRoot, dest)),
      `Unity Mesh .asset was extracted to glTF (${exported.vertexCount} vertices, ${exported.indexCount} indices)`,
      resolvedMeshName,
    );

    const resolved = waitForImportedModelAsset(dest, options, resolvedMeshName);
    return {
      dest,
      meshNameHint: resolvedMeshName,
      resolved,
    };
  }

  function handleMissingModel(meshAsset, reporter, options, config = {}) {
    const { autoCopy = false, severity = 'medium', meshNameHint = '' } = config;
    if (meshAsset?.ext === '.asset' && (options.copyAssets || autoCopy)) {
      const prepared = prepareUnityMeshAssetGltf(meshAsset, reporter, options, severity, meshNameHint || meshAsset.stem);
      if (prepared?.resolved) {
        if (prepared.resolved.pendingImport) {
          reporter.low('MODEL_SUBASSETS_PREPARED', meshAsset.relativePath, prepared.resolved.source, 'Extracted glTF was prepared with stable Cocos mesh sub-asset ids; refresh/import is still required');
        } else {
          reporter.low('MODEL_SUBASSETS_READY', meshAsset.relativePath, prepared.resolved.source, 'Extracted glTF mesh sub-assets became available during the current port pass');
        }
        return { pendingImport: Boolean(prepared.resolved.pendingImport), detail: prepared.resolved.source, resolved: prepared.resolved };
      }
      if (prepared?.dest) {
        reporter.add(severity, 'ASSET_COPIED_NEEDS_IMPORT', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, prepared.dest)), 'Extracted glTF asset awaits Cocos import before mesh sub-assets are available');
        return { pendingImport: true, detail: toPosix(path.relative(options.cocosRoot, prepared.dest)), resolved: null };
      }
    }

    // Prefer an already converted GLB before probing the known-failing FBX
    // importer again. This makes the fallback idempotent and avoids two import
    // timeout probes on every subsequent port pass.
    if (meshAsset?.ext === '.fbx' && options.convertFbxFallback && !options.dryRun) {
      const existingFallback = fallbackGlbPath(meshAsset, options);
      if (fs.existsSync(existingFallback) && fs.statSync(existingFallback).size > 0) {
        if (releaseOwnedPendingModelMeta(existingFallback)) {
          reporter.low('FBX_FALLBACK_PENDING_META_RELEASED', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, existingFallback)), 'Released a porter-owned placeholder meta so Cocos AssetDB can perform the real GLB import');
        }
        const fallbackResolved = waitForImportedModelAsset(existingFallback, options, meshNameHint);
        if (fallbackResolved && !fallbackResolved.pendingImport) {
          reporter.low('MODEL_SUBASSETS_READY', meshAsset.relativePath, fallbackResolved.source, 'Reused an imported GLB fallback; the source FBX importer was not retried');
          return { pendingImport: false, detail: fallbackResolved.source, resolved: fallbackResolved };
        }
        reporter.add(severity, 'MODEL_SUBASSETS_PREPARED', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, existingFallback)), 'Existing GLB fallback still awaits a real Cocos AssetDB import; refresh assets and rerun');
        return { pendingImport: true, detail: toPosix(path.relative(options.cocosRoot, existingFallback)), resolved: fallbackResolved || null };
      }
    }

    let copiedDest = '';
    if (options.copyAssets || autoCopy) {
      copiedDest = copyUnityAssetToCocos(meshAsset, options, reporter, 'model', severity, { deferNeedsImportReport: true, meshNameHint });
      const resolved = waitForImportedModelAsset(copiedDest, options, meshNameHint);
      if (resolved) {
        if (resolved.pendingImport && shouldContinueToFbxFallback(meshAsset, resolved, options)) {
          reporter.medium(
            'FBX_PENDING_IMPORT_FALLBACK',
            meshAsset.relativePath,
            resolved.source,
            'Cocos did not materialize the FBX mesh during the import wait; continuing to the requested converter fallback',
          );
        } else if (resolved.pendingImport) {
          reporter.low('MODEL_SUBASSETS_PREPARED', meshAsset.relativePath, resolved.source, 'Model asset was copied with stable Cocos mesh sub-asset ids; refresh/import is still required');
        } else {
          reporter.low('MODEL_SUBASSETS_READY', meshAsset.relativePath, resolved.source, 'Model mesh/material sub-assets became available during the current port pass');
        }
        if (!shouldContinueToFbxFallback(meshAsset, resolved, options)) {
          return { pendingImport: Boolean(resolved.pendingImport), detail: resolved.source, resolved };
        }
      }
    }

    if (meshAsset.ext !== '.fbx') {
      if (copiedDest) {
        reporter.add(severity, 'ASSET_COPIED_NEEDS_IMPORT', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, copiedDest)), 'Unity asset copied to Cocos; refresh/import is required before it can be wired');
      }
      reporter.add(severity === 'low' ? 'low' : 'high', 'MODEL_UNRESOLVED', meshAsset.relativePath, '', 'Model asset was not found in Cocos assets');
      return { pendingImport: Boolean(copiedDest), detail: copiedDest ? toPosix(path.relative(options.cocosRoot, copiedDest)) : '', resolved: null };
    }

    if (options.convertFbxFallback) {
      if (options.dryRun) {
        const fallbackDest = fallbackGlbPath(meshAsset, options);
        reporter.add(severity, 'FBX_FALLBACK_SKIPPED_DRY_RUN', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, fallbackDest)), 'FBX fallback would run during a real port; dry-run did not create files or launch a converter');
        return { pendingImport: Boolean(copiedDest), detail: copiedDest ? toPosix(path.relative(options.cocosRoot, copiedDest)) : '', resolved: null };
      }
      const converter = findCommand(['FBX2glTF', 'FBX2glTF.exe', 'assimp', 'assimp.exe', 'blender', 'blender.exe']);
      if (converter) {
        const convertedDest = convertFbxToGlb(meshAsset, converter, options, reporter, severity);
        const resolved = waitForImportedModelAsset(convertedDest || copiedDest, options, meshNameHint);
        if (resolved && !resolved.pendingImport) {
          reporter.low('MODEL_SUBASSETS_READY', meshAsset.relativePath, resolved.source, 'Model mesh/material sub-assets became available during the current port pass');
          return { pendingImport: false, detail: resolved.source, resolved };
        }
        if (resolved?.pendingImport) {
          reporter.add(severity, 'MODEL_SUBASSETS_PREPARED', meshAsset.relativePath, resolved.source, 'GLB fallback was created with stable pending mesh ids; refresh Cocos AssetDB and rerun to bind imported sub-assets');
          return { pendingImport: true, detail: resolved.source, resolved };
        }
        return { pendingImport: Boolean(convertedDest || copiedDest), detail: toPosix(path.relative(options.cocosRoot, convertedDest || copiedDest || '')), resolved: null };
      }
      reporter.add(severity, 'FBX_CONVERTER_MISSING', meshAsset.relativePath, '', 'FBX import failed/missing and no FBX2glTF, assimp, or Blender command was found');
      return { pendingImport: Boolean(copiedDest), detail: copiedDest ? toPosix(path.relative(options.cocosRoot, copiedDest)) : '', resolved: null };
    }

    if (copiedDest) {
      reporter.add(severity, 'ASSET_COPIED_NEEDS_IMPORT', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, copiedDest)), 'Unity asset copied to Cocos; refresh/import is required before it can be wired');
      reporter.add(severity, 'FBX_ASSET_COPIED', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, copiedDest)), 'FBX asset was copied into Cocos assets and awaits editor import before mesh sub-assets exist');
      return { pendingImport: true, detail: toPosix(path.relative(options.cocosRoot, copiedDest)), resolved: null };
    }

    reporter.add(severity, 'FBX_FALLBACK_AVAILABLE', meshAsset.relativePath, '', 'No Cocos FBX import found. Re-run with --convert-fbx-fallback to try GLB fallback.');
    return { pendingImport: false, detail: '', resolved: null };
  }

  return {
    importedUnityAssetPath,
    ensureAssetMeta,
    copyUnityAssetToCocos,
    findCommand,
    convertFbxToGlb,
    handleMissingModel,
  };
};

module.exports.buildFbxConverterInvocation = buildFbxConverterInvocation;
module.exports.shouldContinueToFbxFallback = shouldContinueToFbxFallback;
module.exports.releaseOwnedPendingModelMeta = releaseOwnedPendingModelMeta;
module.exports.fallbackGlbPath = fallbackGlbPath;
