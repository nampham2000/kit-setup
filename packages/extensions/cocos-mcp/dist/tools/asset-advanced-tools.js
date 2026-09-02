"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetAdvancedTools = void 0;
const texture_compression_policy_1 = require("../texture-compression-policy");
const model_import_policy_1 = require("../model-import-policy");
class AssetAdvancedTools {
    getTools() {
        return [
            {
                name: 'save_asset_meta',
                description: 'Save asset meta information',
                inputSchema: {
                    type: 'object',
                    properties: {
                        urlOrUUID: {
                            type: 'string',
                            description: 'Asset URL or UUID'
                        },
                        content: {
                            type: 'string',
                            description: 'Asset meta serialized content string'
                        }
                    },
                    required: ['urlOrUUID', 'content']
                }
            },
            {
                name: 'generate_available_url',
                description: 'Generate an available URL based on input URL',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'Asset URL to generate available URL for'
                        }
                    },
                    required: ['url']
                }
            },
            {
                name: 'query_asset_db_ready',
                description: 'Check if asset database is ready',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'open_asset_external',
                description: 'Open asset with external program',
                inputSchema: {
                    type: 'object',
                    properties: {
                        urlOrUUID: {
                            type: 'string',
                            description: 'Asset URL or UUID to open'
                        }
                    },
                    required: ['urlOrUUID']
                }
            },
            {
                name: 'batch_import_assets',
                description: 'Import multiple assets in batch',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceDirectory: {
                            type: 'string',
                            description: 'Source directory path'
                        },
                        targetDirectory: {
                            type: 'string',
                            description: 'Target directory URL'
                        },
                        fileFilter: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'File extensions to include (e.g., [".png", ".jpg"])',
                            default: []
                        },
                        recursive: {
                            type: 'boolean',
                            description: 'Include subdirectories',
                            default: false
                        },
                        overwrite: {
                            type: 'boolean',
                            description: 'Overwrite existing files',
                            default: false
                        }
                    },
                    required: ['sourceDirectory', 'targetDirectory']
                }
            },
            {
                name: 'batch_delete_assets',
                description: 'Delete multiple assets in batch',
                inputSchema: {
                    type: 'object',
                    properties: {
                        urls: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Array of asset URLs to delete'
                        }
                    },
                    required: ['urls']
                }
            },
            {
                name: 'validate_asset_references',
                description: 'Validate asset references and find broken links',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: {
                            type: 'string',
                            description: 'Directory to validate (default: entire project)',
                            default: 'db://assets'
                        }
                    }
                }
            },
            {
                name: 'get_asset_dependencies',
                description: 'Get asset dependency tree',
                inputSchema: {
                    type: 'object',
                    properties: {
                        urlOrUUID: {
                            type: 'string',
                            description: 'Asset URL or UUID'
                        },
                        direction: {
                            type: 'string',
                            description: 'Dependency direction',
                            enum: ['dependents', 'dependencies', 'both'],
                            default: 'dependencies'
                        }
                    },
                    required: ['urlOrUUID']
                }
            },
            {
                name: 'get_unused_assets',
                description: 'Find unused assets in project',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: {
                            type: 'string',
                            description: 'Directory to scan (default: entire project)',
                            default: 'db://assets'
                        },
                        excludeDirectories: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Directories to exclude from scan',
                            default: []
                        }
                    }
                }
            },
            {
                name: 'compress_textures',
                description: 'Apply the portable PlayableTransparent compressed-texture preset to PNG/JPG/JPEG assets',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: {
                            type: 'string',
                            description: 'Directory containing textures',
                            default: 'db://assets'
                        },
                        format: {
                            type: 'string',
                            description: 'Compression format',
                            enum: ['auto', 'jpg', 'png', 'webp'],
                            default: 'auto'
                        },
                        quality: {
                            type: 'number',
                            description: 'WebP quality (1-100; legacy 0.1-1.0 values are converted to percent)',
                            minimum: 0.1,
                            maximum: 100,
                            default: 50
                        },
                        presetName: {
                            type: 'string',
                            description: 'Existing preset display name, or fallback preset name',
                            default: 'PlayableTransparent'
                        },
                        presetId: {
                            type: 'string',
                            description: 'Preferred stable preset ID when the preset must be created'
                        },
                        dryRun: {
                            type: 'boolean',
                            description: 'Report changes without saving builder profile or image importer metadata',
                            default: false
                        }
                    }
                }
            },
            {
                name: 'enforce_texture_compression_policy',
                description: 'Ensure PlayableTransparent WebP preset exists and assign it to every PNG/JPG/JPEG through Cocos Asset DB',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string', default: 'db://assets' },
                        presetName: { type: 'string', default: 'PlayableTransparent' },
                        presetId: { type: 'string', description: 'Preferred stable preset ID used only when creating the fallback preset' },
                        quality: { type: 'number', minimum: 1, maximum: 100, default: 50 },
                        dryRun: { type: 'boolean', default: false }
                    }
                }
            },
            {
                name: 'enforce_fbx_import_policy',
                description: 'Apply the portable playable Mesh Optimize, Mesh Simplify, Mesh Cluster, and Mesh Compress settings to every FBX through Cocos Asset DB',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string', default: 'db://assets' },
                        dryRun: { type: 'boolean', default: false }
                    }
                }
            },
            {
                name: 'validate_effect_import',
                description: 'Reimport a Cocos effect and its materials, verify exact AssetDB types/importers, and fail on new shader/effect syntax errors',
                inputSchema: {
                    type: 'object',
                    properties: {
                        effectUrl: {
                            type: 'string',
                            description: 'Effect asset URL (db://assets/.../*.effect)'
                        },
                        materialUrls: {
                            type: 'array',
                            maxItems: 32,
                            items: { type: 'string' },
                            description: 'Bounded material asset URLs to reimport and verify'
                        }
                    },
                    required: ['effectUrl']
                }
            },
            {
                name: 'export_asset_manifest',
                description: 'Export asset manifest/inventory',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: {
                            type: 'string',
                            description: 'Directory to export manifest for',
                            default: 'db://assets'
                        },
                        format: {
                            type: 'string',
                            description: 'Export format',
                            enum: ['json', 'csv', 'xml'],
                            default: 'json'
                        },
                        includeMetadata: {
                            type: 'boolean',
                            description: 'Include asset metadata',
                            default: true
                        }
                    }
                }
            }
        ];
    }
    async execute(toolName, args) {
        switch (toolName) {
            case 'save_asset_meta':
                return await this.saveAssetMeta(args.urlOrUUID, args.content);
            case 'generate_available_url':
                return await this.generateAvailableUrl(args.url);
            case 'query_asset_db_ready':
                return await this.queryAssetDbReady();
            case 'open_asset_external':
                return await this.openAssetExternal(args.urlOrUUID);
            case 'batch_import_assets':
                return await this.batchImportAssets(args);
            case 'batch_delete_assets':
                return await this.batchDeleteAssets(args.urls);
            case 'validate_asset_references':
                return await this.validateAssetReferences(args.directory);
            case 'get_asset_dependencies':
                return await this.getAssetDependencies(args.urlOrUUID, args.direction);
            case 'get_unused_assets':
                return await this.getUnusedAssets(args.directory, args.excludeDirectories);
            case 'compress_textures':
                return await this.enforceTextureCompressionPolicy(args || {});
            case 'enforce_texture_compression_policy':
                return await this.enforceTextureCompressionPolicy(args || {});
            case 'enforce_fbx_import_policy':
                return await this.enforceFbxImportPolicy(args || {});
            case 'validate_effect_import':
                return await this.validateEffectImport(args || {});
            case 'export_asset_manifest':
                return await this.exportAssetManifest(args.directory, args.format, args.includeMetadata);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
    async saveAssetMeta(urlOrUUID, content) {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'save-asset-meta', urlOrUUID, content).then((result) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result === null || result === void 0 ? void 0 : result.uuid,
                        url: result === null || result === void 0 ? void 0 : result.url,
                        message: 'Asset meta saved successfully'
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async generateAvailableUrl(url) {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'generate-available-url', url).then((availableUrl) => {
                resolve({
                    success: true,
                    data: {
                        originalUrl: url,
                        availableUrl: availableUrl,
                        message: availableUrl === url ?
                            'URL is available' :
                            'Generated new available URL'
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async queryAssetDbReady() {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'query-ready').then((ready) => {
                resolve({
                    success: true,
                    data: {
                        ready: ready,
                        message: ready ? 'Asset database is ready' : 'Asset database is not ready'
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async openAssetExternal(urlOrUUID) {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'open-asset', urlOrUUID).then(() => {
                resolve({
                    success: true,
                    message: 'Asset opened with external program'
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async batchImportAssets(args) {
        return new Promise(async (resolve) => {
            try {
                const fs = require('fs');
                const path = require('path');
                if (!fs.existsSync(args.sourceDirectory)) {
                    resolve({ success: false, error: 'Source directory does not exist' });
                    return;
                }
                const files = this.getFilesFromDirectory(args.sourceDirectory, args.fileFilter || [], args.recursive || false);
                const importResults = [];
                let successCount = 0;
                let errorCount = 0;
                for (const filePath of files) {
                    try {
                        const fileName = path.basename(filePath);
                        const targetPath = `${args.targetDirectory}/${fileName}`;
                        const result = await Editor.Message.request('asset-db', 'import-asset', filePath, targetPath, {
                            overwrite: args.overwrite || false,
                            rename: !(args.overwrite || false)
                        });
                        importResults.push({
                            source: filePath,
                            target: targetPath,
                            success: true,
                            uuid: result === null || result === void 0 ? void 0 : result.uuid
                        });
                        successCount++;
                    }
                    catch (err) {
                        importResults.push({
                            source: filePath,
                            success: false,
                            error: err.message
                        });
                        errorCount++;
                    }
                }
                resolve({
                    success: true,
                    data: {
                        totalFiles: files.length,
                        successCount: successCount,
                        errorCount: errorCount,
                        results: importResults,
                        message: `Batch import completed: ${successCount} success, ${errorCount} errors`
                    }
                });
            }
            catch (err) {
                resolve({ success: false, error: err.message });
            }
        });
    }
    getFilesFromDirectory(dirPath, fileFilter, recursive) {
        const fs = require('fs');
        const path = require('path');
        const files = [];
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
                if (fileFilter.length === 0 || fileFilter.some(ext => item.toLowerCase().endsWith(ext.toLowerCase()))) {
                    files.push(fullPath);
                }
            }
            else if (stat.isDirectory() && recursive) {
                files.push(...this.getFilesFromDirectory(fullPath, fileFilter, recursive));
            }
        }
        return files;
    }
    async batchDeleteAssets(urls) {
        return new Promise(async (resolve) => {
            try {
                const deleteResults = [];
                let successCount = 0;
                let errorCount = 0;
                for (const url of urls) {
                    try {
                        await Editor.Message.request('asset-db', 'delete-asset', url);
                        deleteResults.push({
                            url: url,
                            success: true
                        });
                        successCount++;
                    }
                    catch (err) {
                        deleteResults.push({
                            url: url,
                            success: false,
                            error: err.message
                        });
                        errorCount++;
                    }
                }
                resolve({
                    success: true,
                    data: {
                        totalAssets: urls.length,
                        successCount: successCount,
                        errorCount: errorCount,
                        results: deleteResults,
                        message: `Batch delete completed: ${successCount} success, ${errorCount} errors`
                    }
                });
            }
            catch (err) {
                resolve({ success: false, error: err.message });
            }
        });
    }
    async validateAssetReferences(directory = 'db://assets') {
        return new Promise(async (resolve) => {
            try {
                // Get all assets in directory
                const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
                const brokenReferences = [];
                const validReferences = [];
                for (const asset of assets) {
                    try {
                        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url);
                        if (assetInfo) {
                            validReferences.push({
                                url: asset.url,
                                uuid: asset.uuid,
                                name: asset.name
                            });
                        }
                    }
                    catch (err) {
                        brokenReferences.push({
                            url: asset.url,
                            uuid: asset.uuid,
                            name: asset.name,
                            error: err.message
                        });
                    }
                }
                resolve({
                    success: true,
                    data: {
                        directory: directory,
                        totalAssets: assets.length,
                        validReferences: validReferences.length,
                        brokenReferences: brokenReferences.length,
                        brokenAssets: brokenReferences,
                        message: `Validation completed: ${brokenReferences.length} broken references found`
                    }
                });
            }
            catch (err) {
                resolve({ success: false, error: err.message });
            }
        });
    }
    async getAssetDependencies(urlOrUUID, direction = 'dependencies') {
        return new Promise((resolve) => {
            // Note: This would require scene analysis or additional APIs not available in current documentation
            resolve({
                success: false,
                error: 'Asset dependency analysis requires additional APIs not available in current Cocos Creator MCP implementation. Consider using the Editor UI for dependency analysis.'
            });
        });
    }
    async getUnusedAssets(directory = 'db://assets', excludeDirectories = []) {
        return new Promise((resolve) => {
            // Note: This would require comprehensive project analysis
            resolve({
                success: false,
                error: 'Unused asset detection requires comprehensive project analysis not available in current Cocos Creator MCP implementation. Consider using the Editor UI or third-party tools for unused asset detection.'
            });
        });
    }
    async enforceTextureCompressionPolicy(args) {
        try {
            const report = await (0, texture_compression_policy_1.getTextureCompressionPolicy)().enforceAll({
                directory: args.directory,
                presetName: args.presetName,
                presetId: args.presetId,
                quality: args.quality,
                dryRun: args.dryRun,
            });
            return {
                success: report.complete,
                message: report.complete
                    ? `Texture compression policy applied to ${report.eligible} eligible asset(s).`
                    : `Texture compression policy failed for ${report.failed} asset(s).`,
                data: report,
                error: report.complete ? undefined : `${report.failed} eligible texture(s) could not be configured`,
            };
        }
        catch (error) {
            return { success: false, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
    }
    async enforceFbxImportPolicy(args) {
        try {
            const report = await (0, model_import_policy_1.getModelImportPolicy)().enforceAll({
                directory: args.directory,
                dryRun: args.dryRun,
            });
            return {
                success: report.complete,
                message: report.complete
                    ? `FBX import policy applied to ${report.eligible} eligible asset(s).`
                    : `FBX import policy failed for ${report.failed} asset(s).`,
                data: report,
                error: report.complete ? undefined : `${report.failed} eligible FBX model(s) could not be configured`,
            };
        }
        catch (error) {
            return { success: false, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
    }
    async validateEffectImport(args) {
        var _a;
        const effectUrl = String(args.effectUrl || '');
        const materialUrls = Array.isArray(args.materialUrls)
            ? args.materialUrls.map((url) => String(url)) : [];
        if (!/^db:\/\/assets\/.+\.effect$/i.test(effectUrl)) {
            return { success: false, error: 'effectUrl must be a db://assets/*.effect URL' };
        }
        if (materialUrls.length > 32 || materialUrls.some((url) => !/^db:\/\/assets\/.+\.mtl$/i.test(url))) {
            return { success: false, error: 'materialUrls must contain at most 32 db://assets/*.mtl URLs' };
        }
        const fs = require('fs');
        const path = require('path');
        const projectPath = ((_a = Editor === null || Editor === void 0 ? void 0 : Editor.Project) === null || _a === void 0 ? void 0 : _a.path) || process.cwd();
        const logPath = path.join(projectPath, 'temp', 'logs', 'project.log');
        let logOffset = 0;
        try {
            logOffset = fs.statSync(logPath).size;
        }
        catch (_) { /* log is optional evidence */ }
        const targets = [
            { url: effectUrl, expectedType: 'cc.EffectAsset', expectedImporter: 'effect' },
            ...materialUrls.map((url) => ({
                url, expectedType: 'cc.Material', expectedImporter: 'material',
            })),
        ];
        const assets = [];
        for (const target of targets) {
            try {
                await Editor.Message.request('asset-db', 'reimport-asset', target.url);
                const info = await Editor.Message.request('asset-db', 'query-asset-info', target.url);
                const type = String((info === null || info === void 0 ? void 0 : info.type) || '');
                let meta = (info === null || info === void 0 ? void 0 : info.meta) || null;
                let metaSource = 'query-asset-info';
                if (!(meta === null || meta === void 0 ? void 0 : meta.importer)) {
                    meta = await Editor.Message.request('asset-db', 'query-asset-meta', (info === null || info === void 0 ? void 0 : info.uuid) || target.url);
                    metaSource = 'query-asset-meta';
                }
                const importer = String((meta === null || meta === void 0 ? void 0 : meta.importer) || '');
                const imported = meta === null || meta === void 0 ? void 0 : meta.imported;
                const typeOk = type === target.expectedType;
                const importerOk = importer === target.expectedImporter && imported !== false;
                assets.push({
                    url: target.url,
                    uuid: (info === null || info === void 0 ? void 0 : info.uuid) || null,
                    type,
                    importer,
                    imported: imported === undefined ? null : Boolean(imported),
                    metaSource,
                    typeOk,
                    importerOk,
                    ok: Boolean(info && typeOk && importerOk),
                });
            }
            catch (error) {
                assets.push({ url: target.url, ok: false, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) });
            }
        }
        const shaderErrors = [];
        try {
            const currentSize = fs.statSync(logPath).size;
            const start = currentSize >= logOffset ? logOffset : 0;
            const length = Math.min(Math.max(0, currentSize - start), 256 * 1024);
            if (length > 0) {
                const buffer = Buffer.alloc(length);
                const descriptor = fs.openSync(logPath, 'r');
                try {
                    fs.readSync(descriptor, buffer, 0, length, start);
                }
                finally {
                    fs.closeSync(descriptor);
                }
                const shaderDiagnosticPatterns = [
                    /\bEFX\d+\b/i,
                    /\b(?:shader|glsl|ccprogram)\b.{0,240}\b(?:error|failed?|invalid|syntax|undeclared|compilation failed)\b/i,
                    /\b(?:error|failed?|invalid|syntax|undeclared|compilation failed)\b.{0,240}\b(?:shader|glsl|ccprogram)\b/i,
                    /\b(?:cceffect|effect|\.effect)\b.{0,240}\b(?:compile|compilation|parse|parsing|syntax)\b.{0,120}\b(?:error|failed?|invalid)\b/i,
                    /\b(?:error|failed?|invalid)\b.{0,120}\b(?:compile|compilation|parse|parsing|syntax)\b.{0,240}\b(?:cceffect|effect|\.effect)\b/i,
                ];
                for (const line of buffer.toString('utf8').split(/\r?\n/)) {
                    if (shaderDiagnosticPatterns.some(pattern => pattern.test(line))) {
                        shaderErrors.push(line.slice(0, 600));
                        if (shaderErrors.length >= 20)
                            break;
                    }
                }
            }
        }
        catch (_) { /* missing/rotated log is reported, not silently treated as proof */ }
        const assetTypesOk = assets.length === targets.length && assets.every(asset => asset.ok);
        const logChecked = fs.existsSync(logPath);
        const complete = assetTypesOk && logChecked && shaderErrors.length === 0;
        return {
            success: complete,
            message: complete
                ? `Effect import gate passed for ${targets.length} asset(s).`
                : 'Effect import gate failed; inspect asset/importer evidence and new shader errors.',
            data: {
                complete,
                scope: {
                    cocosAssetDbReimport: 'checked',
                    assetTypesAndImporters: assetTypesOk ? 'passed' : 'failed',
                    newProjectLogShaderErrors: logChecked ? (shaderErrors.length ? 'failed' : 'passed') : 'unverified',
                    runtimeVariant: 'unverified',
                    unityVisualParity: 'unverified',
                },
                assets,
                logChecked,
                shaderErrors,
            },
            error: complete ? undefined : 'Cocos effect import acceptance is incomplete',
        };
    }
    async exportAssetManifest(directory = 'db://assets', format = 'json', includeMetadata = true) {
        return new Promise(async (resolve) => {
            try {
                const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
                const manifest = [];
                for (const asset of assets) {
                    const manifestEntry = {
                        name: asset.name,
                        url: asset.url,
                        uuid: asset.uuid,
                        type: asset.type,
                        size: asset.size || 0,
                        isDirectory: asset.isDirectory || false
                    };
                    if (includeMetadata) {
                        try {
                            const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url);
                            if (assetInfo && assetInfo.meta) {
                                manifestEntry.meta = assetInfo.meta;
                            }
                        }
                        catch (err) {
                            // Skip metadata if not available
                        }
                    }
                    manifest.push(manifestEntry);
                }
                let exportData;
                switch (format) {
                    case 'json':
                        exportData = JSON.stringify(manifest, null, 2);
                        break;
                    case 'csv':
                        exportData = this.convertToCSV(manifest);
                        break;
                    case 'xml':
                        exportData = this.convertToXML(manifest);
                        break;
                    default:
                        exportData = JSON.stringify(manifest, null, 2);
                }
                resolve({
                    success: true,
                    data: {
                        directory: directory,
                        format: format,
                        assetCount: manifest.length,
                        includeMetadata: includeMetadata,
                        manifest: exportData,
                        message: `Asset manifest exported with ${manifest.length} assets`
                    }
                });
            }
            catch (err) {
                resolve({ success: false, error: err.message });
            }
        });
    }
    convertToCSV(data) {
        if (data.length === 0)
            return '';
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];
        for (const row of data) {
            const values = headers.map(header => {
                const value = row[header];
                return typeof value === 'object' ? JSON.stringify(value) : String(value);
            });
            csvRows.push(values.join(','));
        }
        return csvRows.join('\n');
    }
    convertToXML(data) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<assets>\n';
        for (const item of data) {
            xml += '  <asset>\n';
            for (const [key, value] of Object.entries(item)) {
                const xmlValue = typeof value === 'object' ?
                    JSON.stringify(value) :
                    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                xml += `    <${key}>${xmlValue}</${key}>\n`;
            }
            xml += '  </asset>\n';
        }
        xml += '</assets>';
        return xml;
    }
}
exports.AssetAdvancedTools = AssetAdvancedTools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXNzZXQtYWR2YW5jZWQtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvYXNzZXQtYWR2YW5jZWQtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOEVBQTRFO0FBQzVFLGdFQUE4RDtBQUU5RCxNQUFhLGtCQUFrQjtJQUMzQixRQUFRO1FBQ0osT0FBTztZQUNIO2dCQUNJLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLFdBQVcsRUFBRSw2QkFBNkI7Z0JBQzFDLFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1IsU0FBUyxFQUFFOzRCQUNQLElBQUksRUFBRSxRQUFROzRCQUNkLFdBQVcsRUFBRSxtQkFBbUI7eUJBQ25DO3dCQUNELE9BQU8sRUFBRTs0QkFDTCxJQUFJLEVBQUUsUUFBUTs0QkFDZCxXQUFXLEVBQUUsc0NBQXNDO3lCQUN0RDtxQkFDSjtvQkFDRCxRQUFRLEVBQUUsQ0FBQyxXQUFXLEVBQUUsU0FBUyxDQUFDO2lCQUNyQzthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHdCQUF3QjtnQkFDOUIsV0FBVyxFQUFFLDhDQUE4QztnQkFDM0QsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRTt3QkFDUixHQUFHLEVBQUU7NEJBQ0QsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLHlDQUF5Qzt5QkFDekQ7cUJBQ0o7b0JBQ0QsUUFBUSxFQUFFLENBQUMsS0FBSyxDQUFDO2lCQUNwQjthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHNCQUFzQjtnQkFDNUIsV0FBVyxFQUFFLGtDQUFrQztnQkFDL0MsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxFQUFFO2lCQUNqQjthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHFCQUFxQjtnQkFDM0IsV0FBVyxFQUFFLGtD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QU8sT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5QixDQUFDO0lBRU8sWUFBWSxDQUFDLElBQVc7UUFDNUIsSUFBSSxHQUFHLEdBQUcsb0RBQW9ELENBQUM7UUFFL0QsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN0QixHQUFHLElBQUksYUFBYSxDQUFDO1lBQ3JCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQzlDLE1BQU0sUUFBUSxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDO29CQUN4QyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7b0JBQ3ZCLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDckYsR0FBRyxJQUFJLFFBQVEsR0FBRyxJQUFJLFFBQVEsS0FBSyxHQUFHLEtBQUssQ0FBQztZQUNoRCxDQUFDO1lBQ0QsR0FBRyxJQUFJLGNBQWMsQ0FBQztRQUMxQixDQUFDO1FBRUQsR0FBRyxJQUFJLFdBQVcsQ0FBQztRQUNuQixPQUFPLEdBQUcsQ0FBQztJQUNmLENBQUM7Q0FDSjtBQWx6QkQsZ0RBa3pCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFRvb2xEZWZpbml0aW9uLCBUb29sUmVzcG9uc2UsIFRvb2xFeGVjdXRvciB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGdldFRleHR1cmVDb21wcmVzc2lvblBvbGljeSB9IGZyb20gJy4uL3RleHR1cmUtY29tcHJlc3Npb24tcG9saWN5JztcbmltcG9ydCB7IGdldE1vZGVsSW1wb3J0UG9saWN5IH0gZnJvbSAnLi4vbW9kZWwtaW1wb3J0LXBvbGljeSc7XG5cclxuZXhwb3J0IGNsYXNzIEFzc2V0QWR2YW5jZWRUb29scyBpbXBsZW1lbnRzIFRvb2xFeGVjdXRvciB7XHJcbiAgICBnZXRUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcclxuICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnc2F2ZV9hc3NldF9tZXRhJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU2F2ZSBhc3NldCBtZXRhIGluZm9ybWF0aW9uJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmxPclVVSUQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBc3NldCBVUkwgb3IgVVVJRCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0Fzc2V0IG1ldGEgc2VyaWFsaXplZCBjb250ZW50IHN0cmluZydcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsndXJsT3JVVUlEJywgJ2NvbnRlbnQnXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2VuZXJhdGVfYXZhaWxhYmxlX3VybCcsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0dlbmVyYXRlIGFuIGF2YWlsYWJsZSBVUkwgYmFzZWQgb24gaW5wdXQgVVJMJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBc3NldCBVUkwgdG8gZ2VuZXJhdGUgYXZhaWxhYmxlIFVSTCBmb3InXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3VybCddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdxdWVyeV9hc3NldF9kYl9yZWFkeScsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NoZWNrIGlmIGFzc2V0IGRhdGFiYXNlIGlzIHJlYWR5JyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge31cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ29wZW5fYXNzZXRfZXh0ZXJuYWwnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdPcGVuIGFzc2V0IHdpdGggZXh0ZXJuYWwgcHJvZ3JhbScsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsT3JVVUlEOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXNzZXQgVVJMIG9yIFVVSUQgdG8gb3BlbidcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsndXJsT3JVVUlEJ11cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2JhdGNoX2ltcG9ydF9hc3NldHMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdJbXBvcnQgbXVsdGlwbGUgYXNzZXRzIGluIGJhdGNoJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2VEaXJlY3Rvcnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTb3VyY2UgZGlyZWN0b3J5IHBhdGgnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldERpcmVjdG9yeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1RhcmdldCBkaXJlY3RvcnkgVVJMJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlRmlsdGVyOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRmlsZSBleHRlbnNpb25zIHRvIGluY2x1ZGUgKGUuZy4sIFtcIi5wbmdcIiwgXCIuanBnXCJdKScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiBbXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWN1cnNpdmU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSW5jbHVkZSBzdWJkaXJlY3RvcmllcycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiBmYWxzZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvdmVyd3JpdGU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnT3ZlcndyaXRlIGV4aXN0aW5nIGZpbGVzJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3NvdXJjZURpcmVjdG9yeScsICd0YXJnZXREaXJlY3RvcnknXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnYmF0Y2hfZGVsZXRlX2Fzc2V0cycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBtdWx0aXBsZSBhc3NldHMgaW4gYmF0Y2gnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybHM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBcnJheSBvZiBhc3NldCBVUkxzIHRvIGRlbGV0ZSdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsndXJscyddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICd2YWxpZGF0ZV9hc3NldF9yZWZlcmVuY2VzJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVmFsaWRhdGUgYXNzZXQgcmVmZXJlbmNlcyBhbmQgZmluZCBicm9rZW4gbGlua3MnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpcmVjdG9yeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0RpcmVjdG9yeSB0byB2YWxpZGF0ZSAoZGVmYXVsdDogZW50aXJlIHByb2plY3QpJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cydcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2dldF9hc3NldF9kZXBlbmRlbmNpZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdHZXQgYXNzZXQgZGVwZW5kZW5jeSB0cmVlJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmxPclVVSUQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBc3NldCBVUkwgb3IgVVVJRCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlyZWN0aW9uOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGVwZW5kZW5jeSBkaXJlY3Rpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWydkZXBlbmRlbnRzJywgJ2RlcGVuZGVuY2llcycsICdib3RoJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnZGVwZW5kZW5jaWVzJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1cmxPclVVSUQnXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X3VudXNlZF9hc3NldHMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdGaW5kIHVudXNlZCBhc3NldHMgaW4gcHJvamVjdCcsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlyZWN0b3J5OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGlyZWN0b3J5IHRvIHNjYW4gKGRlZmF1bHQ6IGVudGlyZSBwcm9qZWN0KScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnZGI6Ly9hc3NldHMnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4Y2x1ZGVEaXJlY3Rvcmllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICdzdHJpbmcnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0RpcmVjdG9yaWVzIHRvIGV4Y2x1ZGUgZnJvbSBzY2FuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IFtdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnY29tcHJlc3NfdGV4dHVyZXMnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXBwbHkgdGhlIHBvcnRhYmxlIFBsYXlhYmxlVHJhbnNwYXJlbnQgY29tcHJlc3NlZC10ZXh0dXJlIHByZXNldCB0byBQTkcvSlBHL0pQRUcgYXNzZXRzJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlyZWN0b3J5OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGlyZWN0b3J5IGNvbnRhaW5pbmcgdGV4dHVyZXMnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogJ2RiOi8vYXNzZXRzJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtYXQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb21wcmVzc2lvbiBmb3JtYXQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWydhdXRvJywgJ2pwZycsICdwbmcnLCAnd2VicCddLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogJ2F1dG8nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1YWxpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1dlYlAgcXVhbGl0eSAoMS0xMDA7IGxlZ2FjeSAwLjEtMS4wIHZhbHVlcyBhcmUgY29udmVydGVkIHRvIHBlcmNlbnQpJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtaW5pbXVtOiAwLjEsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4aW11bTogMTAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IDUwXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJlc2V0TmFtZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRXhpc3RpbmcgcHJlc2V0IGRpc3BsYXkgbmFtZSwgb3IgZmFsbGJhY2sgcHJlc2V0IG5hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdQbGF5YWJsZVRyYW5zcGFyZW50J1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHByZXNldElkOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQcmVmZXJyZWQgc3RhYmxlIHByZXNldCBJRCB3aGVuIHRoZSBwcmVzZXQgbXVzdCBiZSBjcmVhdGVkJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRyeVJ1bjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlcG9ydCBjaGFuZ2VzIHdpdGhvdXQgc2F2aW5nIGJ1aWxkZXIgcHJvZmlsZSBvciBpbWFnZSBpbXBvcnRlciBtZXRhZGF0YScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogZmFsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2VuZm9yY2VfdGV4dHVyZV9jb21wcmVzc2lvbl9wb2xpY3knLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRW5zdXJlIFBsYXlhYmxlVHJhbnNwYXJlbnQgV2ViUCBwcmVzZXQgZXhpc3RzIGFuZCBhc3NpZ24gaXQgdG8gZXZlcnkgUE5HL0pQRy9KUEVHIHRocm91Z2ggQ29jb3MgQXNzZXQgREInLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IHsgdHlwZTogJ3N0cmluZycsIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cycgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHByZXNldE5hbWU6IHsgdHlwZTogJ3N0cmluZycsIGRlZmF1bHQ6ICdQbGF5YWJsZVRyYW5zcGFyZW50JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJlc2V0SWQ6IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnUHJlZmVycmVkIHN0YWJsZSBwcmVzZXQgSUQgdXNlZCBvbmx5IHdoZW4gY3JlYXRpbmcgdGhlIGZhbGxiYWNrIHByZXNldCcgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1YWxpdHk6IHsgdHlwZTogJ251bWJlcicsIG1pbmltdW06IDEsIG1heGltdW06IDEwMCwgZGVmYXVsdDogNTAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRyeVJ1bjogeyB0eXBlOiAnYm9vbGVhbicsIGRlZmF1bHQ6IGZhbHNlIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2VuZm9yY2VfZmJ4X2ltcG9ydF9wb2xpY3knLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXBwbHkgdGhlIHBvcnRhYmxlIHBsYXlhYmxlIE1lc2ggT3B0aW1pemUsIE1lc2ggU2ltcGxpZnksIE1lc2ggQ2x1c3RlciwgYW5kIE1lc2ggQ29tcHJlc3Mgc2V0dGluZ3MgdG8gZXZlcnkgRkJYIHRocm91Z2ggQ29jb3MgQXNzZXQgREInLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IHsgdHlwZTogJ3N0cmluZycsIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cycgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRyeVJ1bjogeyB0eXBlOiAnYm9vbGVhbicsIGRlZmF1bHQ6IGZhbHNlIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3ZhbGlkYXRlX2VmZmVjdF9pbXBvcnQnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVpbXBvcnQgYSBDb2NvcyBlZmZlY3QgYW5kIGl0cyBtYXRlcmlhbHMsIHZlcmlmeSBleGFjdCBBc3NldERCIHR5cGVzL2ltcG9ydGVycywgYW5kIGZhaWwgb24gbmV3IHNoYWRlci9lZmZlY3Qgc3ludGF4IGVycm9ycycsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVmZmVjdFVybDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRWZmZWN0IGFzc2V0IFVSTCAoZGI6Ly9hc3NldHMvLi4uLyouZWZmZWN0KSdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbFVybHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heEl0ZW1zOiAzMixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQm91bmRlZCBtYXRlcmlhbCBhc3NldCBVUkxzIHRvIHJlaW1wb3J0IGFuZCB2ZXJpZnknXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ2VmZmVjdFVybCddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdleHBvcnRfYXNzZXRfbWFuaWZlc3QnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdFeHBvcnQgYXNzZXQgbWFuaWZlc3QvaW52ZW50b3J5JyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdEaXJlY3RvcnkgdG8gZXhwb3J0IG1hbmlmZXN0IGZvcicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnZGI6Ly9hc3NldHMnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1hdDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0V4cG9ydCBmb3JtYXQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWydqc29uJywgJ2NzdicsICd4bWwnXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdqc29uJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbmNsdWRlTWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSW5jbHVkZSBhc3NldCBtZXRhZGF0YScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGV4ZWN1dGUodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICBzd2l0Y2ggKHRvb2xOYW1lKSB7XHJcbiAgICAgICAgICAgIGNhc2UgJ3NhdmVfYXNzZXRfbWV0YSc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5zYXZlQXNzZXRNZXRhKGFyZ3MudXJsT3JVVUlELCBhcmdzLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICBjYXNlICdnZW5lcmF0ZV9hdmFpbGFibGVfdXJsJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdlbmVyYXRlQXZhaWxhYmxlVXJsKGFyZ3MudXJsKTtcclxuICAgICAgICAgICAgY2FzZSAncXVlcnlfYXNzZXRfZGJfcmVhZHknOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnlBc3NldERiUmVhZHkoKTtcclxuICAgICAgICAgICAgY2FzZSAnb3Blbl9hc3NldF9leHRlcm5hbCc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcGVuQXNzZXRFeHRlcm5hbChhcmdzLnVybE9yVVVJRCk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2JhdGNoX2ltcG9ydF9hc3NldHMnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYmF0Y2hJbXBvcnRBc3NldHMoYXJncyk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2JhdGNoX2RlbGV0ZV9hc3NldHMnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYmF0Y2hEZWxldGVBc3NldHMoYXJncy51cmxzKTtcclxuICAgICAgICAgICAgY2FzZSAndmFsaWRhdGVfYXNzZXRfcmVmZXJlbmNlcyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy52YWxpZGF0ZUFzc2V0UmVmZXJlbmNlcyhhcmdzLmRpcmVjdG9yeSk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2dldF9hc3NldF9kZXBlbmRlbmNpZXMnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0QXNzZXREZXBlbmRlbmNpZXMoYXJncy51cmxPclVVSUQsIGFyZ3MuZGlyZWN0aW9uKTtcclxuICAgICAgICAgICAgY2FzZSAnZ2V0X3VudXNlZF9hc3NldHMnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0VW51c2VkQXNzZXRzKGFyZ3MuZGlyZWN0b3J5LCBhcmdzLmV4Y2x1ZGVEaXJlY3Rvcmllcyk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2NvbXByZXNzX3RleHR1cmVzJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbmZvcmNlVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KGFyZ3MgfHwge30pO1xuICAgICAgICAgICAgY2FzZSAnZW5mb3JjZV90ZXh0dXJlX2NvbXByZXNzaW9uX3BvbGljeSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5mb3JjZVRleHR1cmVDb21wcmVzc2lvblBvbGljeShhcmdzIHx8IHt9KTtcbiAgICAgICAgICAgIGNhc2UgJ2VuZm9yY2VfZmJ4X2ltcG9ydF9wb2xpY3knOlxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmVuZm9yY2VGYnhJbXBvcnRQb2xpY3koYXJncyB8fCB7fSk7XG4gICAgICAgICAgICBjYXNlICd2YWxpZGF0ZV9lZmZlY3RfaW1wb3J0JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy52YWxpZGF0ZUVmZmVjdEltcG9ydChhcmdzIHx8IHt9KTtcbiAgICAgICAgICAgIGNhc2UgJ2V4cG9ydF9hc3NldF9tYW5pZmVzdCc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5leHBvcnRBc3NldE1hbmlmZXN0KGFyZ3MuZGlyZWN0b3J5LCBhcmdzLmZvcm1hdCwgYXJncy5pbmNsdWRlTWV0YWRhdGEpO1xyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHRvb2w6ICR7dG9vbE5hbWV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgc2F2ZUFzc2V0TWV0YSh1cmxPclVVSUQ6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldC1tZXRhJywgdXJsT3JVVUlELCBjb250ZW50KS50aGVuKChyZXN1bHQ6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHJlc3VsdD8udXVpZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiByZXN1bHQ/LnVybCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0Fzc2V0IG1ldGEgc2F2ZWQgc3VjY2Vzc2Z1bGx5J1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZ2VuZXJhdGVBdmFpbGFibGVVcmwodXJsOiBzdHJpbmcpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdnZW5lcmF0ZS1hdmFpbGFibGUtdXJsJywgdXJsKS50aGVuKChhdmFpbGFibGVVcmw6IHN0cmluZykgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsVXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVVybDogYXZhaWxhYmxlVXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBhdmFpbGFibGVVcmwgPT09IHVybCA/IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ1VSTCBpcyBhdmFpbGFibGUnIDogXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnR2VuZXJhdGVkIG5ldyBhdmFpbGFibGUgVVJMJ1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcXVlcnlBc3NldERiUmVhZHkoKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktcmVhZHknKS50aGVuKChyZWFkeTogYm9vbGVhbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYWR5OiByZWFkeSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogcmVhZHkgPyAnQXNzZXQgZGF0YWJhc2UgaXMgcmVhZHknIDogJ0Fzc2V0IGRhdGFiYXNlIGlzIG5vdCByZWFkeSdcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycjogRXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIG9wZW5Bc3NldEV4dGVybmFsKHVybE9yVVVJRDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnb3Blbi1hc3NldCcsIHVybE9yVVVJRCkudGhlbigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdBc3NldCBvcGVuZWQgd2l0aCBleHRlcm5hbCBwcm9ncmFtJ1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnI6IEVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBiYXRjaEltcG9ydEFzc2V0cyhhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGFyZ3Muc291cmNlRGlyZWN0b3J5KSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdTb3VyY2UgZGlyZWN0b3J5IGRvZXMgbm90IGV4aXN0JyB9KTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSB0aGlzLmdldEZpbGVzRnJvbURpcmVjdG9yeShcclxuICAgICAgICAgICAgICAgICAgICBhcmdzLnNvdXJjZURpcmVjdG9yeSwgXHJcbiAgICAgICAgICAgICAgICAgICAgYXJncy5maWxlRmlsdGVyIHx8IFtdLCBcclxuICAgICAgICAgICAgICAgICAgICBhcmdzLnJlY3Vyc2l2ZSB8fCBmYWxzZVxyXG4gICAgICAgICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRSZXN1bHRzOiBhbnlbXSA9IFtdO1xyXG4gICAgICAgICAgICAgICAgbGV0IHN1Y2Nlc3NDb3VudCA9IDA7XHJcbiAgICAgICAgICAgICAgICBsZXQgZXJyb3JDb3VudCA9IDA7XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBmaWxlcykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBgJHthcmdzLnRhcmdldERpcmVjdG9yeX0vJHtmaWxlTmFtZX1gO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnaW1wb3J0LWFzc2V0JywgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCwgdGFyZ2V0UGF0aCwgeyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvdmVyd3JpdGU6IGFyZ3Mub3ZlcndyaXRlIHx8IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbmFtZTogIShhcmdzLm92ZXJ3cml0ZSB8fCBmYWxzZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW1wb3J0UmVzdWx0cy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZTogZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRhcmdldFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogcmVzdWx0Py51dWlkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbXBvcnRSZXN1bHRzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVyci5tZXNzYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvckNvdW50Kys7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b3RhbEZpbGVzOiBmaWxlcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NDb3VudDogc3VjY2Vzc0NvdW50LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvckNvdW50OiBlcnJvckNvdW50LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzOiBpbXBvcnRSZXN1bHRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgQmF0Y2ggaW1wb3J0IGNvbXBsZXRlZDogJHtzdWNjZXNzQ291bnR9IHN1Y2Nlc3MsICR7ZXJyb3JDb3VudH0gZXJyb3JzYFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldEZpbGVzRnJvbURpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcsIGZpbGVGaWx0ZXI6IHN0cmluZ1tdLCByZWN1cnNpdmU6IGJvb2xlYW4pOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbiAgICAgICAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgICAgIGNvbnN0IGl0ZW1zID0gZnMucmVhZGRpclN5bmMoZGlyUGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aC5qb2luKGRpclBhdGgsIGl0ZW0pO1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZnVsbFBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHN0YXQuaXNGaWxlKCkpIHtcclxuICAgICAgICAgICAgICAgIGlmIChmaWxlRmlsdGVyLmxlbmd0aCA9PT0gMCB8fCBmaWxlRmlsdGVyLnNvbWUoZXh0ID0+IGl0ZW0udG9Mb3dlckNhc2UoKS5lbmRzV2l0aChleHQudG9Mb3dlckNhc2UoKSkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmlsZXMucHVzaChmdWxsUGF0aCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpICYmIHJlY3Vyc2l2ZSkge1xyXG4gICAgICAgICAgICAgICAgZmlsZXMucHVzaCguLi50aGlzLmdldEZpbGVzRnJvbURpcmVjdG9yeShmdWxsUGF0aCwgZmlsZUZpbHRlciwgcmVjdXJzaXZlKSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGZpbGVzO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgYmF0Y2hEZWxldGVBc3NldHModXJsczogc3RyaW5nW10pOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVsZXRlUmVzdWx0czogYW55W10gPSBbXTtcclxuICAgICAgICAgICAgICAgIGxldCBzdWNjZXNzQ291bnQgPSAwO1xyXG4gICAgICAgICAgICAgICAgbGV0IGVycm9yQ291bnQgPSAwO1xyXG5cclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdXJsIG9mIHVybHMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdkZWxldGUtYXNzZXQnLCB1cmwpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGVSZXN1bHRzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGVSZXN1bHRzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnIubWVzc2FnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JDb3VudCsrO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdG90YWxBc3NldHM6IHVybHMubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzQ291bnQ6IHN1Y2Nlc3NDb3VudCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JDb3VudDogZXJyb3JDb3VudCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0czogZGVsZXRlUmVzdWx0cyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogYEJhdGNoIGRlbGV0ZSBjb21wbGV0ZWQ6ICR7c3VjY2Vzc0NvdW50fSBzdWNjZXNzLCAke2Vycm9yQ291bnR9IGVycm9yc2BcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUFzc2V0UmVmZXJlbmNlcyhkaXJlY3Rvcnk6IHN0cmluZyA9ICdkYjovL2Fzc2V0cycpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgLy8gR2V0IGFsbCBhc3NldHMgaW4gZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhc3NldHMgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldHMnLCB7IHBhdHRlcm46IGAke2RpcmVjdG9yeX0vKiovKmAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IGJyb2tlblJlZmVyZW5jZXM6IGFueVtdID0gW107XHJcbiAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFJlZmVyZW5jZXM6IGFueVtdID0gW107XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBhc3NldCBvZiBhc3NldHMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldEluZm8gPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgYXNzZXQudXJsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFzc2V0SW5mbykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRSZWZlcmVuY2VzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYXNzZXQudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IGFzc2V0LnV1aWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXNzZXQubmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJva2VuUmVmZXJlbmNlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYXNzZXQudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogYXNzZXQudXVpZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGFzc2V0Lm5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogKGVyciBhcyBFcnJvcikubWVzc2FnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpcmVjdG9yeTogZGlyZWN0b3J5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b3RhbEFzc2V0czogYXNzZXRzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRSZWZlcmVuY2VzOiB2YWxpZFJlZmVyZW5jZXMubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBicm9rZW5SZWZlcmVuY2VzOiBicm9rZW5SZWZlcmVuY2VzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJva2VuQXNzZXRzOiBicm9rZW5SZWZlcmVuY2VzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgVmFsaWRhdGlvbiBjb21wbGV0ZWQ6ICR7YnJva2VuUmVmZXJlbmNlcy5sZW5ndGh9IGJyb2tlbiByZWZlcmVuY2VzIGZvdW5kYFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdldEFzc2V0RGVwZW5kZW5jaWVzKHVybE9yVVVJRDogc3RyaW5nLCBkaXJlY3Rpb246IHN0cmluZyA9ICdkZXBlbmRlbmNpZXMnKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgLy8gTm90ZTogVGhpcyB3b3VsZCByZXF1aXJlIHNjZW5lIGFuYWx5c2lzIG9yIGFkZGl0aW9uYWwgQVBJcyBub3QgYXZhaWxhYmxlIGluIGN1cnJlbnQgZG9jdW1lbnRhdGlvblxyXG4gICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6ICdBc3NldCBkZXBlbmRlbmN5IGFuYWx5c2lzIHJlcXVpcmVzIGFkZGl0aW9uYWwgQVBJcyBub3QgYXZhaWxhYmxlIGluIGN1cnJlbnQgQ29jb3MgQ3JlYXRvciBNQ1AgaW1wbGVtZW50YXRpb24uIENvbnNpZGVyIHVzaW5nIHRoZSBFZGl0b3IgVUkgZm9yIGRlcGVuZGVuY3kgYW5hbHlzaXMuJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdldFVudXNlZEFzc2V0cyhkaXJlY3Rvcnk6IHN0cmluZyA9ICdkYjovL2Fzc2V0cycsIGV4Y2x1ZGVEaXJlY3Rvcmllczogc3RyaW5nW10gPSBbXSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIC8vIE5vdGU6IFRoaXMgd291bGQgcmVxdWlyZSBjb21wcmVoZW5zaXZlIHByb2plY3QgYW5hbHlzaXNcclxuICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGVycm9yOiAnVW51c2VkIGFzc2V0IGRldGVjdGlvbiByZXF1aXJlcyBjb21wcmVoZW5zaXZlIHByb2plY3QgYW5hbHlzaXMgbm90IGF2YWlsYWJsZSBpbiBjdXJyZW50IENvY29zIENyZWF0b3IgTUNQIGltcGxlbWVudGF0aW9uLiBDb25zaWRlciB1c2luZyB0aGUgRWRpdG9yIFVJIG9yIHRoaXJkLXBhcnR5IHRvb2xzIGZvciB1bnVzZWQgYXNzZXQgZGV0ZWN0aW9uLidcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KGFyZ3M6IGFueSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXBvcnQgPSBhd2FpdCBnZXRUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3koKS5lbmZvcmNlQWxsKHtcbiAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IGFyZ3MuZGlyZWN0b3J5LFxuICAgICAgICAgICAgICAgIHByZXNldE5hbWU6IGFyZ3MucHJlc2V0TmFtZSxcbiAgICAgICAgICAgICAgICBwcmVzZXRJZDogYXJncy5wcmVzZXRJZCxcbiAgICAgICAgICAgICAgICBxdWFsaXR5OiBhcmdzLnF1YWxpdHksXG4gICAgICAgICAgICAgICAgZHJ5UnVuOiBhcmdzLmRyeVJ1bixcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiByZXBvcnQuY29tcGxldGUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogcmVwb3J0LmNvbXBsZXRlXG4gICAgICAgICAgICAgICAgICAgID8gYFRleHR1cmUgY29tcHJlc3Npb24gcG9saWN5IGFwcGxpZWQgdG8gJHtyZXBvcnQuZWxpZ2libGV9IGVsaWdpYmxlIGFzc2V0KHMpLmBcbiAgICAgICAgICAgICAgICAgICAgOiBgVGV4dHVyZSBjb21wcmVzc2lvbiBwb2xpY3kgZmFpbGVkIGZvciAke3JlcG9ydC5mYWlsZWR9IGFzc2V0KHMpLmAsXG4gICAgICAgICAgICAgICAgZGF0YTogcmVwb3J0LFxuICAgICAgICAgICAgICAgIGVycm9yOiByZXBvcnQuY29tcGxldGUgPyB1bmRlZmluZWQgOiBgJHtyZXBvcnQuZmFpbGVkfSBlbGlnaWJsZSB0ZXh0dXJlKHMpIGNvdWxkIG5vdCBiZSBjb25maWd1cmVkYCxcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlRmJ4SW1wb3J0UG9saWN5KGFyZ3M6IGFueSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXBvcnQgPSBhd2FpdCBnZXRNb2RlbEltcG9ydFBvbGljeSgpLmVuZm9yY2VBbGwoe1xuICAgICAgICAgICAgICAgIGRpcmVjdG9yeTogYXJncy5kaXJlY3RvcnksXG4gICAgICAgICAgICAgICAgZHJ5UnVuOiBhcmdzLmRyeVJ1bixcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiByZXBvcnQuY29tcGxldGUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogcmVwb3J0LmNvbXBsZXRlXG4gICAgICAgICAgICAgICAgICAgID8gYEZCWCBpbXBvcnQgcG9saWN5IGFwcGxpZWQgdG8gJHtyZXBvcnQuZWxpZ2libGV9IGVsaWdpYmxlIGFzc2V0KHMpLmBcbiAgICAgICAgICAgICAgICAgICAgOiBgRkJYIGltcG9ydCBwb2xpY3kgZmFpbGVkIGZvciAke3JlcG9ydC5mYWlsZWR9IGFzc2V0KHMpLmAsXG4gICAgICAgICAgICAgICAgZGF0YTogcmVwb3J0LFxuICAgICAgICAgICAgICAgIGVycm9yOiByZXBvcnQuY29tcGxldGUgPyB1bmRlZmluZWQgOiBgJHtyZXBvcnQuZmFpbGVkfSBlbGlnaWJsZSBGQlggbW9kZWwocykgY291bGQgbm90IGJlIGNvbmZpZ3VyZWRgLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlRWZmZWN0SW1wb3J0KGFyZ3M6IGFueSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XG4gICAgICAgIGNvbnN0IGVmZmVjdFVybCA9IFN0cmluZyhhcmdzLmVmZmVjdFVybCB8fCAnJyk7XG4gICAgICAgIGNvbnN0IG1hdGVyaWFsVXJscyA9IEFycmF5LmlzQXJyYXkoYXJncy5tYXRlcmlhbFVybHMpXG4gICAgICAgICAgICA/IGFyZ3MubWF0ZXJpYWxVcmxzLm1hcCgodXJsOiB1bmtub3duKSA9PiBTdHJpbmcodXJsKSkgOiBbXTtcbiAgICAgICAgaWYgKCEvXmRiOlxcL1xcL2Fzc2V0c1xcLy4rXFwuZWZmZWN0JC9pLnRlc3QoZWZmZWN0VXJsKSkge1xuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnZWZmZWN0VXJsIG11c3QgYmUgYSBkYjovL2Fzc2V0cy8qLmVmZmVjdCBVUkwnIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1hdGVyaWFsVXJscy5sZW5ndGggPiAzMiB8fCBtYXRlcmlhbFVybHMuc29tZSgodXJsOiBzdHJpbmcpID0+ICEvXmRiOlxcL1xcL2Fzc2V0c1xcLy4rXFwubXRsJC9pLnRlc3QodXJsKSkpIHtcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ21hdGVyaWFsVXJscyBtdXN0IGNvbnRhaW4gYXQgbW9zdCAzMiBkYjovL2Fzc2V0cy8qLm10bCBVUkxzJyB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xuICAgICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuICAgICAgICBjb25zdCBwcm9qZWN0UGF0aCA9IChFZGl0b3IgYXMgYW55KT8uUHJvamVjdD8ucGF0aCB8fCBwcm9jZXNzLmN3ZCgpO1xuICAgICAgICBjb25zdCBsb2dQYXRoID0gcGF0aC5qb2luKHByb2plY3RQYXRoLCAndGVtcCcsICdsb2dzJywgJ3Byb2plY3QubG9nJyk7XG4gICAgICAgIGxldCBsb2dPZmZzZXQgPSAwO1xuICAgICAgICB0cnkgeyBsb2dPZmZzZXQgPSBmcy5zdGF0U3luYyhsb2dQYXRoKS5zaXplOyB9IGNhdGNoIChfKSB7IC8qIGxvZyBpcyBvcHRpb25hbCBldmlkZW5jZSAqLyB9XG5cbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IFtcbiAgICAgICAgICAgIHsgdXJsOiBlZmZlY3RVcmwsIGV4cGVjdGVkVHlwZTogJ2NjLkVmZmVjdEFzc2V0JywgZXhwZWN0ZWRJbXBvcnRlcjogJ2VmZmVjdCcgfSxcbiAgICAgICAgICAgIC4uLm1hdGVyaWFsVXJscy5tYXAoKHVybDogc3RyaW5nKSA9PiAoe1xuICAgICAgICAgICAgICAgIHVybCwgZXhwZWN0ZWRUeXBlOiAnY2MuTWF0ZXJpYWwnLCBleHBlY3RlZEltcG9ydGVyOiAnbWF0ZXJpYWwnLFxuICAgICAgICAgICAgfSkpLFxuICAgICAgICBdO1xuICAgICAgICBjb25zdCBhc3NldHM6IGFueVtdID0gW107XG4gICAgICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncmVpbXBvcnQtYXNzZXQnLCB0YXJnZXQudXJsKTtcbiAgICAgICAgICAgICAgICBjb25zdCBpbmZvOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdGFyZ2V0LnVybCk7XG4gICAgICAgICAgICAgICAgY29uc3QgdHlwZSA9IFN0cmluZyhpbmZvPy50eXBlIHx8ICcnKTtcbiAgICAgICAgICAgICAgICBsZXQgbWV0YTogYW55ID0gaW5mbz8ubWV0YSB8fCBudWxsO1xuICAgICAgICAgICAgICAgIGxldCBtZXRhU291cmNlID0gJ3F1ZXJ5LWFzc2V0LWluZm8nO1xuICAgICAgICAgICAgICAgIGlmICghbWV0YT8uaW1wb3J0ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoXG4gICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3F1ZXJ5LWFzc2V0LW1ldGEnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW5mbz8udXVpZCB8fCB0YXJnZXQudXJsLFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICBtZXRhU291cmNlID0gJ3F1ZXJ5LWFzc2V0LW1ldGEnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRlciA9IFN0cmluZyhtZXRhPy5pbXBvcnRlciB8fCAnJyk7XG4gICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0ZWQgPSBtZXRhPy5pbXBvcnRlZDtcbiAgICAgICAgICAgICAgICBjb25zdCB0eXBlT2sgPSB0eXBlID09PSB0YXJnZXQuZXhwZWN0ZWRUeXBlO1xuICAgICAgICAgICAgICAgIGNvbnN0IGltcG9ydGVyT2sgPSBpbXBvcnRlciA9PT0gdGFyZ2V0LmV4cGVjdGVkSW1wb3J0ZXIgJiYgaW1wb3J0ZWQgIT09IGZhbHNlO1xuICAgICAgICAgICAgICAgIGFzc2V0cy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgdXJsOiB0YXJnZXQudXJsLFxuICAgICAgICAgICAgICAgICAgICB1dWlkOiBpbmZvPy51dWlkIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydGVyLFxuICAgICAgICAgICAgICAgICAgICBpbXBvcnRlZDogaW1wb3J0ZWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBCb29sZWFuKGltcG9ydGVkKSxcbiAgICAgICAgICAgICAgICAgICAgbWV0YVNvdXJjZSxcbiAgICAgICAgICAgICAgICAgICAgdHlwZU9rLFxuICAgICAgICAgICAgICAgICAgICBpbXBvcnRlck9rLFxuICAgICAgICAgICAgICAgICAgICBvazogQm9vbGVhbihpbmZvICYmIHR5cGVPayAmJiBpbXBvcnRlck9rKSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICBhc3NldHMucHVzaCh7IHVybDogdGFyZ2V0LnVybCwgb2s6IGZhbHNlLCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNoYWRlckVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRTaXplID0gZnMuc3RhdFN5bmMobG9nUGF0aCkuc2l6ZTtcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gY3VycmVudFNpemUgPj0gbG9nT2Zmc2V0ID8gbG9nT2Zmc2V0IDogMDtcbiAgICAgICAgICAgIGNvbnN0IGxlbmd0aCA9IE1hdGgubWluKE1hdGgubWF4KDAsIGN1cnJlbnRTaXplIC0gc3RhcnQpLCAyNTYgKiAxMDI0KTtcbiAgICAgICAgICAgIGlmIChsZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmFsbG9jKGxlbmd0aCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZGVzY3JpcHRvciA9IGZzLm9wZW5TeW5jKGxvZ1BhdGgsICdyJyk7XG4gICAgICAgICAgICAgICAgdHJ5IHsgZnMucmVhZFN5bmMoZGVzY3JpcHRvciwgYnVmZmVyLCAwLCBsZW5ndGgsIHN0YXJ0KTsgfVxuICAgICAgICAgICAgICAgIGZpbmFsbHkgeyBmcy5jbG9zZVN5bmMoZGVzY3JpcHRvcik7IH1cbiAgICAgICAgICAgICAgICBjb25zdCBzaGFkZXJEaWFnbm9zdGljUGF0dGVybnMgPSBbXG4gICAgICAgICAgICAgICAgICAgIC9cXGJFRlhcXGQrXFxiL2ksXG4gICAgICAgICAgICAgICAgICAgIC9cXGIoPzpzaGFkZXJ8Z2xzbHxjY3Byb2dyYW0pXFxiLnswLDI0MH1cXGIoPzplcnJvcnxmYWlsZWQ/fGludmFsaWR8c3ludGF4fHVuZGVjbGFyZWR8Y29tcGlsYXRpb24gZmFpbGVkKVxcYi9pLFxuICAgICAgICAgICAgICAgICAgICAvXFxiKD86ZXJyb3J8ZmFpbGVkP3xpbnZhbGlkfHN5bnRheHx1bmRlY2xhcmVkfGNvbXBpbGF0aW9uIGZhaWxlZClcXGIuezAsMjQwfVxcYig/OnNoYWRlcnxnbHNsfGNjcHJvZ3JhbSlcXGIvaSxcbiAgICAgICAgICAgICAgICAgICAgL1xcYig/OmNjZWZmZWN0fGVmZmVjdHxcXC5lZmZlY3QpXFxiLnswLDI0MH1cXGIoPzpjb21waWxlfGNvbXBpbGF0aW9ufHBhcnNlfHBhcnNpbmd8c3ludGF4KVxcYi57MCwxMjB9XFxiKD86ZXJyb3J8ZmFpbGVkP3xpbnZhbGlkKVxcYi9pLFxuICAgICAgICAgICAgICAgICAgICAvXFxiKD86ZXJyb3J8ZmFpbGVkP3xpbnZhbGlkKVxcYi57MCwxMjB9XFxiKD86Y29tcGlsZXxjb21waWxhdGlvbnxwYXJzZXxwYXJzaW5nfHN5bnRheClcXGIuezAsMjQwfVxcYig/OmNjZWZmZWN0fGVmZmVjdHxcXC5lZmZlY3QpXFxiL2ksXG4gICAgICAgICAgICAgICAgXTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgYnVmZmVyLnRvU3RyaW5nKCd1dGY4Jykuc3BsaXQoL1xccj9cXG4vKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc2hhZGVyRGlhZ25vc3RpY1BhdHRlcm5zLnNvbWUocGF0dGVybiA9PiBwYXR0ZXJuLnRlc3QobGluZSkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzaGFkZXJFcnJvcnMucHVzaChsaW5lLnNsaWNlKDAsIDYwMCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNoYWRlckVycm9ycy5sZW5ndGggPj0gMjApIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChfKSB7IC8qIG1pc3Npbmcvcm90YXRlZCBsb2cgaXMgcmVwb3J0ZWQsIG5vdCBzaWxlbnRseSB0cmVhdGVkIGFzIHByb29mICovIH1cblxuICAgICAgICBjb25zdCBhc3NldFR5cGVzT2sgPSBhc3NldHMubGVuZ3RoID09PSB0YXJnZXRzLmxlbmd0aCAmJiBhc3NldHMuZXZlcnkoYXNzZXQgPT4gYXNzZXQub2spO1xuICAgICAgICBjb25zdCBsb2dDaGVja2VkID0gZnMuZXhpc3RzU3luYyhsb2dQYXRoKTtcbiAgICAgICAgY29uc3QgY29tcGxldGUgPSBhc3NldFR5cGVzT2sgJiYgbG9nQ2hlY2tlZCAmJiBzaGFkZXJFcnJvcnMubGVuZ3RoID09PSAwO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3VjY2VzczogY29tcGxldGUsXG4gICAgICAgICAgICBtZXNzYWdlOiBjb21wbGV0ZVxuICAgICAgICAgICAgICAgID8gYEVmZmVjdCBpbXBvcnQgZ2F0ZSBwYXNzZWQgZm9yICR7dGFyZ2V0cy5sZW5ndGh9IGFzc2V0KHMpLmBcbiAgICAgICAgICAgICAgICA6ICdFZmZlY3QgaW1wb3J0IGdhdGUgZmFpbGVkOyBpbnNwZWN0IGFzc2V0L2ltcG9ydGVyIGV2aWRlbmNlIGFuZCBuZXcgc2hhZGVyIGVycm9ycy4nLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgIGNvbXBsZXRlLFxuICAgICAgICAgICAgICAgIHNjb3BlOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvY29zQXNzZXREYlJlaW1wb3J0OiAnY2hlY2tlZCcsXG4gICAgICAgICAgICAgICAgICAgIGFzc2V0VHlwZXNBbmRJbXBvcnRlcnM6IGFzc2V0VHlwZXNPayA/ICdwYXNzZWQnIDogJ2ZhaWxlZCcsXG4gICAgICAgICAgICAgICAgICAgIG5ld1Byb2plY3RMb2dTaGFkZXJFcnJvcnM6IGxvZ0NoZWNrZWQgPyAoc2hhZGVyRXJyb3JzLmxlbmd0aCA/ICdmYWlsZWQnIDogJ3Bhc3NlZCcpIDogJ3VudmVyaWZpZWQnLFxuICAgICAgICAgICAgICAgICAgICBydW50aW1lVmFyaWFudDogJ3VudmVyaWZpZWQnLFxuICAgICAgICAgICAgICAgICAgICB1bml0eVZpc3VhbFBhcml0eTogJ3VudmVyaWZpZWQnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXNzZXRzLFxuICAgICAgICAgICAgICAgIGxvZ0NoZWNrZWQsXG4gICAgICAgICAgICAgICAgc2hhZGVyRXJyb3JzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGVycm9yOiBjb21wbGV0ZSA/IHVuZGVmaW5lZCA6ICdDb2NvcyBlZmZlY3QgaW1wb3J0IGFjY2VwdGFuY2UgaXMgaW5jb21wbGV0ZScsXG4gICAgICAgIH07XG4gICAgfVxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGV4cG9ydEFzc2V0TWFuaWZlc3QoZGlyZWN0b3J5OiBzdHJpbmcgPSAnZGI6Ly9hc3NldHMnLCBmb3JtYXQ6IHN0cmluZyA9ICdqc29uJywgaW5jbHVkZU1ldGFkYXRhOiBib29sZWFuID0gdHJ1ZSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhc3NldHMgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldHMnLCB7IHBhdHRlcm46IGAke2RpcmVjdG9yeX0vKiovKmAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1hbmlmZXN0OiBhbnlbXSA9IFtdO1xyXG5cclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYXNzZXQgb2YgYXNzZXRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFuaWZlc3RFbnRyeTogYW55ID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBhc3NldC5uYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGFzc2V0LnVybCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogYXNzZXQudXVpZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogYXNzZXQudHlwZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2l6ZTogKGFzc2V0IGFzIGFueSkuc2l6ZSB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpc0RpcmVjdG9yeTogYXNzZXQuaXNEaXJlY3RvcnkgfHwgZmFsc2VcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAoaW5jbHVkZU1ldGFkYXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldEluZm8gPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgYXNzZXQudXJsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhc3NldEluZm8gJiYgYXNzZXRJbmZvLm1ldGEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYW5pZmVzdEVudHJ5Lm1ldGEgPSBhc3NldEluZm8ubWV0YTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBTa2lwIG1ldGFkYXRhIGlmIG5vdCBhdmFpbGFibGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgbWFuaWZlc3QucHVzaChtYW5pZmVzdEVudHJ5KTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBsZXQgZXhwb3J0RGF0YTogc3RyaW5nO1xyXG4gICAgICAgICAgICAgICAgc3dpdGNoIChmb3JtYXQpIHtcclxuICAgICAgICAgICAgICAgICAgICBjYXNlICdqc29uJzpcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0RGF0YSA9IEpTT04uc3RyaW5naWZ5KG1hbmlmZXN0LCBudWxsLCAyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnY3N2JzpcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0RGF0YSA9IHRoaXMuY29udmVydFRvQ1NWKG1hbmlmZXN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAneG1sJzpcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0RGF0YSA9IHRoaXMuY29udmVydFRvWE1MKG1hbmlmZXN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0RGF0YSA9IEpTT04uc3RyaW5naWZ5KG1hbmlmZXN0LCBudWxsLCAyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlyZWN0b3J5OiBkaXJlY3RvcnksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1hdDogZm9ybWF0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhc3NldENvdW50OiBtYW5pZmVzdC5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1ZGVNZXRhZGF0YTogaW5jbHVkZU1ldGFkYXRhLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYW5pZmVzdDogZXhwb3J0RGF0YSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogYEFzc2V0IG1hbmlmZXN0IGV4cG9ydGVkIHdpdGggJHttYW5pZmVzdC5sZW5ndGh9IGFzc2V0c2BcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjb252ZXJ0VG9DU1YoZGF0YTogYW55W10pOiBzdHJpbmcge1xyXG4gICAgICAgIGlmIChkYXRhLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3Qua2V5cyhkYXRhWzBdKTtcclxuICAgICAgICBjb25zdCBjc3ZSb3dzID0gW2hlYWRlcnMuam9pbignLCcpXTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiBkYXRhKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlcyA9IGhlYWRlcnMubWFwKGhlYWRlciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IHJvd1toZWFkZXJdO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgPyBKU09OLnN0cmluZ2lmeSh2YWx1ZSkgOiBTdHJpbmcodmFsdWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY3N2Um93cy5wdXNoKHZhbHVlcy5qb2luKCcsJykpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY3N2Um93cy5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGNvbnZlcnRUb1hNTChkYXRhOiBhbnlbXSk6IHN0cmluZyB7XHJcbiAgICAgICAgbGV0IHhtbCA9ICc8P3htbCB2ZXJzaW9uPVwiMS4wXCIgZW5jb2Rpbmc9XCJVVEYtOFwiPz5cXG48YXNzZXRzPlxcbic7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGRhdGEpIHtcclxuICAgICAgICAgICAgeG1sICs9ICcgIDxhc3NldD5cXG4nO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhpdGVtKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgeG1sVmFsdWUgPSB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnID8gXHJcbiAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogXHJcbiAgICAgICAgICAgICAgICAgICAgU3RyaW5nKHZhbHVlKS5yZXBsYWNlKC8mL2csICcmYW1wOycpLnJlcGxhY2UoLzwvZywgJyZsdDsnKS5yZXBsYWNlKC8+L2csICcmZ3Q7Jyk7XHJcbiAgICAgICAgICAgICAgICB4bWwgKz0gYCAgICA8JHtrZXl9PiR7eG1sVmFsdWV9PC8ke2tleX0+XFxuYDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB4bWwgKz0gJyAgPC9hc3NldD5cXG4nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB4bWwgKz0gJzwvYXNzZXRzPic7XHJcbiAgICAgICAgcmV0dXJuIHhtbDtcclxuICAgIH1cclxufVxuIl19