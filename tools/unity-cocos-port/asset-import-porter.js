'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyAssetIfChanged, ensureDir, randomUuid, toPosix } = require('./core-utils');
const { exportUnityMeshAssetToGltf } = require('./unity-mesh-fbx-exporter');

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
    return '';
  }

  function convertFbxToGlb(unityAsset, converter, options, reporter, severity = 'medium') {
    const dest = path.join(options.cocosRoot, 'assets', 'unity_imported', unityAsset.relativePath).replace(/\.fbx$/i, '.glb');
    if (options.dryRun) {
      reporter.add(severity, 'FBX_FALLBACK_SKIPPED_DRY_RUN', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'FBX fallback would run during a real port; dry-run did not create files or launch a converter');
      return '';
    }
    ensureDir(path.dirname(dest));
    ensureDirectoryMetas(path.dirname(dest), path.join(options.cocosRoot, 'assets'));
    if (fs.existsSync(dest)) {
      ensureAssetMeta(dest, 'model');
      reporter.add(severity, 'FBX_FALLBACK_EXISTS', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Existing GLB fallback found; refresh/import is required before it can be wired');
      return dest;
    }

    const isAssimp = /assimp(?:\.exe)?$/i.test(path.basename(converter));
    const args = isAssimp ? ['export', unityAsset.path, dest] : ['-i', unityAsset.path, '-o', dest];
    const result = spawnSync(converter, args, { encoding: 'utf8' });
    if (result.status !== 0) {
      reporter.add(severity, 'FBX_FALLBACK_FAILED', unityAsset.relativePath, converter, 'FBX fallback conversion failed', `${result.stderr || result.stdout || ''}`.trim());
      return '';
    }
    ensureAssetMeta(dest, 'model');
    reporter.add(severity, 'FBX_FALLBACK_CREATED', unityAsset.relativePath, toPosix(path.relative(options.cocosRoot, dest)), 'Created GLB fallback; refresh/import is required before it can be wired');
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

    let copiedDest = '';
    if (options.copyAssets || autoCopy) {
      copiedDest = copyUnityAssetToCocos(meshAsset, options, reporter, 'model', severity, { deferNeedsImportReport: true, meshNameHint });
      const resolved = waitForImportedModelAsset(copiedDest, options, meshNameHint);
      if (resolved) {
        if (resolved.pendingImport) {
          reporter.low('MODEL_SUBASSETS_PREPARED', meshAsset.relativePath, resolved.source, 'Model asset was copied with stable Cocos mesh sub-asset ids; refresh/import is still required');
        } else {
          reporter.low('MODEL_SUBASSETS_READY', meshAsset.relativePath, resolved.source, 'Model mesh/material sub-assets became available during the current port pass');
        }
        return { pendingImport: Boolean(resolved.pendingImport), detail: resolved.source, resolved };
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
        const fallbackDest = importedUnityAssetPath(meshAsset, options).replace(/\.fbx$/i, '.glb');
        reporter.add(severity, 'FBX_FALLBACK_SKIPPED_DRY_RUN', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, fallbackDest)), 'FBX fallback would run during a real port; dry-run did not create files or launch a converter');
        return { pendingImport: Boolean(copiedDest), detail: copiedDest ? toPosix(path.relative(options.cocosRoot, copiedDest)) : '', resolved: null };
      }
      const converter = findCommand(['FBX2glTF', 'FBX2glTF.exe', 'assimp', 'assimp.exe']);
      if (converter) {
        const convertedDest = convertFbxToGlb(meshAsset, converter, options, reporter, severity);
        const resolved = waitForImportedModelAsset(convertedDest || copiedDest, options, meshNameHint);
        if (resolved) {
          reporter.low('MODEL_SUBASSETS_READY', meshAsset.relativePath, resolved.source, 'Model mesh/material sub-assets became available during the current port pass');
          return { pendingImport: false, detail: resolved.source, resolved };
        }
        return { pendingImport: Boolean(convertedDest || copiedDest), detail: toPosix(path.relative(options.cocosRoot, convertedDest || copiedDest || '')), resolved: null };
      }
      reporter.add(severity, 'FBX_CONVERTER_MISSING', meshAsset.relativePath, '', 'FBX import failed/missing and no FBX2glTF/assimp command was found');
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
