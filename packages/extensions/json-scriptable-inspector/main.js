'use strict';
const fs = require('fs');
const path = require('path');
const {
  FRAGMENTS_KEY,
  loadMergedConfigFromFile,
  saveMergedConfigToFile,
  writeJsonAtomic,
} = require('./config-fragments.cjs');

function readCompositeFile(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!manifest?.[FRAGMENTS_KEY]) {
    return { manifest, merged: manifest, entries: [], resourcesRoot: null };
  }
  return loadMergedConfigFromFile(file);
}

function writeCompositeFile(file, mergedConfig) {
  return saveMergedConfigToFile(file, mergedConfig);
}

async function resolveAssetInfo(uuid) {
  let assetInfo = null;
  if (uuid) {
    try {
      assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
    } catch (e) {
      // fallback to current selection
    }
  }
  if (!assetInfo && typeof Editor !== 'undefined' && Editor.Selection) {
    try {
      const lastSelected = Editor.Selection.getLastSelected?.('asset');
      if (lastSelected) {
        assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', lastSelected);
      }
    } catch (e) {
      // handled by caller
    }
  }
  return assetInfo;
}

module.exports = {
  load() {
    console.log('[json-scriptable-inspector] Extension loaded.');
  },

  unload() {
    console.log('[json-scriptable-inspector] Extension unloaded.');
  },

  methods: {
    /**
     * Read raw JSON file content by Asset UUID or path.
     */
    async readJsonAsset(uuid) {
      try {
        const assetInfo = await resolveAssetInfo(uuid);

        if (assetInfo && assetInfo.file && fs.existsSync(assetInfo.file)) {
          const composite = readCompositeFile(assetInfo.file);
          return {
            success: true,
            content: JSON.stringify(composite.merged, null, 2),
            file: assetInfo.file,
            url: assetInfo.url,
            name: assetInfo.name,
            uuid: assetInfo.uuid || uuid,
            fragmented: composite.entries.length > 0,
            fragmentCount: composite.entries.length,
            fragmentSources: composite.entries.map(entry => ({
              target: entry.target,
              resourcePath: entry.resourcePath,
            })),
          };
        }

        return { success: false, error: 'Asset file not found' };
      } catch (err) {
        console.error('[json-scriptable-inspector] Error reading asset:', err);
        return { success: false, error: err.message };
      }
    },

    /**
     * Save updated JSON content to disk and reimport into AssetDB.
     */
    async saveJsonAsset(uuid, jsonString) {
      try {
        let targetUuid = uuid;
        const assetInfo = await resolveAssetInfo(uuid);
        if (assetInfo?.uuid) targetUuid = assetInfo.uuid;

        if (assetInfo && assetInfo.file) {
          const mergedConfig = JSON.parse(jsonString);
          const writeResult = writeCompositeFile(assetInfo.file, mergedConfig);
          try {
            await Editor.Message.request('asset-db', 'reimport-asset', assetInfo.uuid || targetUuid);
          } catch (e) {
            // The AssetDB watcher still observes the atomic file replacements.
          }
          if (writeResult.resourcesRoot) {
            for (const file of writeResult.files.slice(1)) {
              const relative = path.relative(writeResult.resourcesRoot, file).replace(/\\/g, '/');
              try {
                await Editor.Message.request('asset-db', 'refresh-asset', `db://assets/resources/${relative}`);
              } catch (e) {
                // The AssetDB watcher is the fallback on older editor versions.
              }
            }
          }
          console.log(`[json-scriptable-inspector] Saved merged JSON config to ${writeResult.files.length} file(s).`);
          return {
            success: true,
            file: assetInfo.file,
            files: writeResult.files,
            fragmentCount: writeResult.fragmentCount,
            uuid: assetInfo.uuid || targetUuid,
          };
        }

        // Fallback: save-asset via AssetDB message if UUID exists
        if (targetUuid) {
          try {
            await Editor.Message.request('asset-db', 'save-asset', targetUuid, jsonString);
            return { success: true, uuid: targetUuid };
          } catch (saveErr) {
            return { success: false, error: saveErr.message };
          }
        }

        return { success: false, error: 'Could not resolve target asset UUID or file path.' };
      } catch (err) {
        console.error('[json-scriptable-inspector] Failed to save JSON asset:', err);
        return { success: false, error: err.message };
      }
    },
  },
};

module.exports.__test = {
  readCompositeFile,
  writeCompositeFile,
  writeJsonAtomic,
};
