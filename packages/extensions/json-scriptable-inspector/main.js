'use strict';
const fs = require('fs');
const path = require('path');

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
        let assetInfo = null;

        // 1. Try querying by provided UUID
        if (uuid) {
          try {
            assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
          } catch (e) {
            // ignore
          }
        }

        // 2. Try querying by Editor.Selection
        if (!assetInfo && typeof Editor !== 'undefined' && Editor.Selection) {
          try {
            const lastSel = Editor.Selection.getLastSelected ? Editor.Selection.getLastSelected('asset') : null;
            if (lastSel) {
              assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', lastSel);
            }
          } catch (e) {
            // ignore
          }
        }

        if (assetInfo && assetInfo.file && fs.existsSync(assetInfo.file)) {
          const content = fs.readFileSync(assetInfo.file, 'utf8');
          return {
            success: true,
            content,
            file: assetInfo.file,
            url: assetInfo.url,
            name: assetInfo.name,
            uuid: assetInfo.uuid || uuid,
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
        let assetInfo = null;
        let targetUuid = uuid;

        // 1. Try querying by provided UUID
        if (uuid) {
          try {
            assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
          } catch (e) {
            // ignore
          }
        }

        // 2. Try querying by Selection
        if (!assetInfo && typeof Editor !== 'undefined' && Editor.Selection) {
          try {
            const lastSel = Editor.Selection.getLastSelected ? Editor.Selection.getLastSelected('asset') : null;
            if (lastSel) {
              targetUuid = lastSel;
              assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', lastSel);
            }
          } catch (e) {
            // ignore
          }
        }

        // Direct file write + reimport
        if (assetInfo && assetInfo.file) {
          fs.writeFileSync(assetInfo.file, jsonString, 'utf8');
          try {
            await Editor.Message.request('asset-db', 'reimport-asset', assetInfo.uuid || targetUuid);
          } catch (e) {
            // fallback
          }
          console.log(`[json-scriptable-inspector] Saved JSON asset to file: ${assetInfo.file}`);
          return { success: true, file: assetInfo.file, uuid: assetInfo.uuid || targetUuid };
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
