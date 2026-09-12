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
        var _a, _b;
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
                const importer = String(((_b = info === null || info === void 0 ? void 0 : info.meta) === null || _b === void 0 ? void 0 : _b.importer) || '');
                const typeOk = type === target.expectedType;
                const importerOk = importer === target.expectedImporter;
                assets.push({
                    url: target.url,
                    uuid: (info === null || info === void 0 ? void 0 : info.uuid) || null,
                    type,
                    importer,
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
                const relevant = /(?:effect|shader|glsl|ccprogram|efx\d*)/i;
                const failure = /(?:error|failed?|invalid|syntax|undeclared|does not exist)/i;
                for (const line of buffer.toString('utf8').split(/\r?\n/)) {
                    if (relevant.test(line) && failure.test(line)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXNzZXQtYWR2YW5jZWQtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvYXNzZXQtYWR2YW5jZWQtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOEVBQTRFO0FBQzVFLGdFQUE4RDtBQUU5RCxNQUFhLGtCQUFrQjtJQUMzQixRQUFRO1FBQ0osT0FBTztZQUNIO2dCQUNJLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLFdBQVcsRUFBRSw2QkFBNkI7Z0JBQzFDLFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1IsU0FBUyxFQUFFOzRCQUNQLElBQUksRUFBRSxRQUFROzRCQUNkLFdBQVcsRUFBRSxtQkFBbUI7eUJBQ25DO3dCQUNELE9BQU8sRUFBRTs0QkFDTCxJQUFJLEVBQUUsUUFBUTs0QkFDZCxXQUFXLEVBQUUsc0NBQXNDO3lCQUN0RDtxQkFDSjtvQkFDRCxRQUFRLEVBQUUsQ0FBQyxXQUFXLEVBQUUsU0FBUyxDQUFDO2lCQUNyQzthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHdCQUF3QjtnQkFDOUIsV0FBVyxFQUFFLDhDQUE4QztnQkFDM0QsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRTt3QkFDUixHQUFHLEVBQUU7NEJBQ0QsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLHlDQUF5Qzt5QkFDekQ7cUJBQ0o7b0JBQ0QsUUFBUSxFQUFFLENBQUMsS0FBSyxDQUFDO2lCQUNwQjthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHNCQUFzQjtnQkFDNUIsV0FBVyxFQUFFLGtDQUFrQztnQkFDL0MsV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxFQUFFO2lCQUNqQjthQUNKO1lBQ0Q7Z0JBQ0ksSUFBSSxFQUFFLHFCQUFxQjtnQkFDM0IsV0FBVyxFQUFFLGtD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O1FBQzFCLENBQUM7UUFFRCxHQUFHLElBQUksV0FBVyxDQUFDO1FBQ25CLE9BQU8sR0FBRyxDQUFDO0lBQ2YsQ0FBQztDQUNKO0FBaHlCRCxnREFneUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVG9vbERlZmluaXRpb24sIFRvb2xSZXNwb25zZSwgVG9vbEV4ZWN1dG9yIH0gZnJvbSAnLi4vdHlwZXMnO1xyXG5pbXBvcnQgeyBnZXRUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3kgfSBmcm9tICcuLi90ZXh0dXJlLWNvbXByZXNzaW9uLXBvbGljeSc7XHJcbmltcG9ydCB7IGdldE1vZGVsSW1wb3J0UG9saWN5IH0gZnJvbSAnLi4vbW9kZWwtaW1wb3J0LXBvbGljeSc7XHJcblxyXG5leHBvcnQgY2xhc3MgQXNzZXRBZHZhbmNlZFRvb2xzIGltcGxlbWVudHMgVG9vbEV4ZWN1dG9yIHtcclxuICAgIGdldFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdzYXZlX2Fzc2V0X21ldGEnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTYXZlIGFzc2V0IG1ldGEgaW5mb3JtYXRpb24nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybE9yVVVJRDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0Fzc2V0IFVSTCBvciBVVUlEJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXNzZXQgbWV0YSBzZXJpYWxpemVkIGNvbnRlbnQgc3RyaW5nJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1cmxPclVVSUQnLCAnY29udGVudCddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdnZW5lcmF0ZV9hdmFpbGFibGVfdXJsJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnR2VuZXJhdGUgYW4gYXZhaWxhYmxlIFVSTCBiYXNlZCBvbiBpbnB1dCBVUkwnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0Fzc2V0IFVSTCB0byBnZW5lcmF0ZSBhdmFpbGFibGUgVVJMIGZvcidcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsndXJsJ11cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ3F1ZXJ5X2Fzc2V0X2RiX3JlYWR5JyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ2hlY2sgaWYgYXNzZXQgZGF0YWJhc2UgaXMgcmVhZHknLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7fVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnb3Blbl9hc3NldF9leHRlcm5hbCcsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ09wZW4gYXNzZXQgd2l0aCBleHRlcm5hbCBwcm9ncmFtJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmxPclVVSUQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBc3NldCBVUkwgb3IgVVVJRCB0byBvcGVuJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1cmxPclVVSUQnXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnYmF0Y2hfaW1wb3J0X2Fzc2V0cycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0ltcG9ydCBtdWx0aXBsZSBhc3NldHMgaW4gYmF0Y2gnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZURpcmVjdG9yeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NvdXJjZSBkaXJlY3RvcnkgcGF0aCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0RGlyZWN0b3J5OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVGFyZ2V0IGRpcmVjdG9yeSBVUkwnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVGaWx0ZXI6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdGaWxlIGV4dGVuc2lvbnMgdG8gaW5jbHVkZSAoZS5nLiwgW1wiLnBuZ1wiLCBcIi5qcGdcIl0pJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IFtdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY3Vyc2l2ZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdJbmNsdWRlIHN1YmRpcmVjdG9yaWVzJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG92ZXJ3cml0ZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdPdmVyd3JpdGUgZXhpc3RpbmcgZmlsZXMnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogZmFsc2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsnc291cmNlRGlyZWN0b3J5JywgJ3RhcmdldERpcmVjdG9yeSddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdiYXRjaF9kZWxldGVfYXNzZXRzJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGVsZXRlIG11bHRpcGxlIGFzc2V0cyBpbiBiYXRjaCcsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICdzdHJpbmcnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FycmF5IG9mIGFzc2V0IFVSTHMgdG8gZGVsZXRlJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1cmxzJ11cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ3ZhbGlkYXRlX2Fzc2V0X3JlZmVyZW5jZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdWYWxpZGF0ZSBhc3NldCByZWZlcmVuY2VzIGFuZCBmaW5kIGJyb2tlbiBsaW5rcycsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlyZWN0b3J5OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGlyZWN0b3J5IHRvIHZhbGlkYXRlIChkZWZhdWx0OiBlbnRpcmUgcHJvamVjdCknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogJ2RiOi8vYXNzZXRzJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X2Fzc2V0X2RlcGVuZGVuY2llcycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0dldCBhc3NldCBkZXBlbmRlbmN5IHRyZWUnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybE9yVVVJRDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0Fzc2V0IFVSTCBvciBVVUlEJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rpb246IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdEZXBlbmRlbmN5IGRpcmVjdGlvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbJ2RlcGVuZGVudHMnLCAnZGVwZW5kZW5jaWVzJywgJ2JvdGgnXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdkZXBlbmRlbmNpZXMnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3VybE9yVVVJRCddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdnZXRfdW51c2VkX2Fzc2V0cycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0ZpbmQgdW51c2VkIGFzc2V0cyBpbiBwcm9qZWN0JyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdEaXJlY3RvcnkgdG8gc2NhbiAoZGVmYXVsdDogZW50aXJlIHByb2plY3QpJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cydcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXhjbHVkZURpcmVjdG9yaWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGlyZWN0b3JpZXMgdG8gZXhjbHVkZSBmcm9tIHNjYW4nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogW11cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2NvbXByZXNzX3RleHR1cmVzJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXBwbHkgdGhlIHBvcnRhYmxlIFBsYXlhYmxlVHJhbnNwYXJlbnQgY29tcHJlc3NlZC10ZXh0dXJlIHByZXNldCB0byBQTkcvSlBHL0pQRUcgYXNzZXRzJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdEaXJlY3RvcnkgY29udGFpbmluZyB0ZXh0dXJlcycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnZGI6Ly9hc3NldHMnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1hdDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbXByZXNzaW9uIGZvcm1hdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbJ2F1dG8nLCAnanBnJywgJ3BuZycsICd3ZWJwJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnYXV0bydcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcXVhbGl0eToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ251bWJlcicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1dlYlAgcXVhbGl0eSAoMS0xMDA7IGxlZ2FjeSAwLjEtMS4wIHZhbHVlcyBhcmUgY29udmVydGVkIHRvIHBlcmNlbnQpJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1pbmltdW06IDAuMSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heGltdW06IDEwMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IDUwXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHByZXNldE5hbWU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdFeGlzdGluZyBwcmVzZXQgZGlzcGxheSBuYW1lLCBvciBmYWxsYmFjayBwcmVzZXQgbmFtZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnUGxheWFibGVUcmFuc3BhcmVudCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJlc2V0SWQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQcmVmZXJyZWQgc3RhYmxlIHByZXNldCBJRCB3aGVuIHRoZSBwcmVzZXQgbXVzdCBiZSBjcmVhdGVkJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkcnlSdW46IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVwb3J0IGNoYW5nZXMgd2l0aG91dCBzYXZpbmcgYnVpbGRlciBwcm9maWxlIG9yIGltYWdlIGltcG9ydGVyIG1ldGFkYXRhJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdlbmZvcmNlX3RleHR1cmVfY29tcHJlc3Npb25fcG9saWN5JyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRW5zdXJlIFBsYXlhYmxlVHJhbnNwYXJlbnQgV2ViUCBwcmVzZXQgZXhpc3RzIGFuZCBhc3NpZ24gaXQgdG8gZXZlcnkgUE5HL0pQRy9KUEVHIHRocm91Z2ggQ29jb3MgQXNzZXQgREInLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpcmVjdG9yeTogeyB0eXBlOiAnc3RyaW5nJywgZGVmYXVsdDogJ2RiOi8vYXNzZXRzJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcmVzZXROYW1lOiB7IHR5cGU6ICdzdHJpbmcnLCBkZWZhdWx0OiAnUGxheWFibGVUcmFuc3BhcmVudCcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJlc2V0SWQ6IHsgdHlwZTogJ3N0cmluZycsIGRlc2NyaXB0aW9uOiAnUHJlZmVycmVkIHN0YWJsZSBwcmVzZXQgSUQgdXNlZCBvbmx5IHdoZW4gY3JlYXRpbmcgdGhlIGZhbGxiYWNrIHByZXNldCcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcXVhbGl0eTogeyB0eXBlOiAnbnVtYmVyJywgbWluaW11bTogMSwgbWF4aW11bTogMTAwLCBkZWZhdWx0OiA1MCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkcnlSdW46IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiBmYWxzZSB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZW5mb3JjZV9mYnhfaW1wb3J0X3BvbGljeScsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FwcGx5IHRoZSBwb3J0YWJsZSBwbGF5YWJsZSBNZXNoIE9wdGltaXplLCBNZXNoIFNpbXBsaWZ5LCBNZXNoIENsdXN0ZXIsIGFuZCBNZXNoIENvbXByZXNzIHNldHRpbmdzIHRvIGV2ZXJ5IEZCWCB0aHJvdWdoIENvY29zIEFzc2V0IERCJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IHsgdHlwZTogJ3N0cmluZycsIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cycgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZHJ5UnVuOiB7IHR5cGU6ICdib29sZWFuJywgZGVmYXVsdDogZmFsc2UgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ3ZhbGlkYXRlX2VmZmVjdF9pbXBvcnQnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZWltcG9ydCBhIENvY29zIGVmZmVjdCBhbmQgaXRzIG1hdGVyaWFscywgdmVyaWZ5IGV4YWN0IEFzc2V0REIgdHlwZXMvaW1wb3J0ZXJzLCBhbmQgZmFpbCBvbiBuZXcgc2hhZGVyL2VmZmVjdCBzeW50YXggZXJyb3JzJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlZmZlY3RVcmw6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdFZmZlY3QgYXNzZXQgVVJMIChkYjovL2Fzc2V0cy8uLi4vKi5lZmZlY3QpJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbFVybHM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXhJdGVtczogMzIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdCb3VuZGVkIG1hdGVyaWFsIGFzc2V0IFVSTHMgdG8gcmVpbXBvcnQgYW5kIHZlcmlmeSdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsnZWZmZWN0VXJsJ11cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2V4cG9ydF9hc3NldF9tYW5pZmVzdCcsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0V4cG9ydCBhc3NldCBtYW5pZmVzdC9pbnZlbnRvcnknLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpcmVjdG9yeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0RpcmVjdG9yeSB0byBleHBvcnQgbWFuaWZlc3QgZm9yJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdkYjovL2Fzc2V0cydcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9ybWF0OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRXhwb3J0IGZvcm1hdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbJ2pzb24nLCAnY3N2JywgJ3htbCddLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogJ2pzb24nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1ZGVNZXRhZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdJbmNsdWRlIGFzc2V0IG1ldGFkYXRhJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHRydWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIF07XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZXhlY3V0ZSh0b29sTmFtZTogc3RyaW5nLCBhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHN3aXRjaCAodG9vbE5hbWUpIHtcclxuICAgICAgICAgICAgY2FzZSAnc2F2ZV9hc3NldF9tZXRhJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnNhdmVBc3NldE1ldGEoYXJncy51cmxPclVVSUQsIGFyZ3MuY29udGVudCk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2dlbmVyYXRlX2F2YWlsYWJsZV91cmwnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2VuZXJhdGVBdmFpbGFibGVVcmwoYXJncy51cmwpO1xyXG4gICAgICAgICAgICBjYXNlICdxdWVyeV9hc3NldF9kYl9yZWFkeSc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeUFzc2V0RGJSZWFkeSgpO1xyXG4gICAgICAgICAgICBjYXNlICdvcGVuX2Fzc2V0X2V4dGVybmFsJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wZW5Bc3NldEV4dGVybmFsKGFyZ3MudXJsT3JVVUlEKTtcclxuICAgICAgICAgICAgY2FzZSAnYmF0Y2hfaW1wb3J0X2Fzc2V0cyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5iYXRjaEltcG9ydEFzc2V0cyhhcmdzKTtcclxuICAgICAgICAgICAgY2FzZSAnYmF0Y2hfZGVsZXRlX2Fzc2V0cyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5iYXRjaERlbGV0ZUFzc2V0cyhhcmdzLnVybHMpO1xyXG4gICAgICAgICAgICBjYXNlICd2YWxpZGF0ZV9hc3NldF9yZWZlcmVuY2VzJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnZhbGlkYXRlQXNzZXRSZWZlcmVuY2VzKGFyZ3MuZGlyZWN0b3J5KTtcclxuICAgICAgICAgICAgY2FzZSAnZ2V0X2Fzc2V0X2RlcGVuZGVuY2llcyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRBc3NldERlcGVuZGVuY2llcyhhcmdzLnVybE9yVVVJRCwgYXJncy5kaXJlY3Rpb24pO1xyXG4gICAgICAgICAgICBjYXNlICdnZXRfdW51c2VkX2Fzc2V0cyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRVbnVzZWRBc3NldHMoYXJncy5kaXJlY3RvcnksIGFyZ3MuZXhjbHVkZURpcmVjdG9yaWVzKTtcclxuICAgICAgICAgICAgY2FzZSAnY29tcHJlc3NfdGV4dHVyZXMnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5mb3JjZVRleHR1cmVDb21wcmVzc2lvblBvbGljeShhcmdzIHx8IHt9KTtcclxuICAgICAgICAgICAgY2FzZSAnZW5mb3JjZV90ZXh0dXJlX2NvbXByZXNzaW9uX3BvbGljeSc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbmZvcmNlVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KGFyZ3MgfHwge30pO1xyXG4gICAgICAgICAgICBjYXNlICdlbmZvcmNlX2ZieF9pbXBvcnRfcG9saWN5JzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmVuZm9yY2VGYnhJbXBvcnRQb2xpY3koYXJncyB8fCB7fSk7XHJcbiAgICAgICAgICAgIGNhc2UgJ3ZhbGlkYXRlX2VmZmVjdF9pbXBvcnQnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudmFsaWRhdGVFZmZlY3RJbXBvcnQoYXJncyB8fCB7fSk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2V4cG9ydF9hc3NldF9tYW5pZmVzdCc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5leHBvcnRBc3NldE1hbmlmZXN0KGFyZ3MuZGlyZWN0b3J5LCBhcmdzLmZvcm1hdCwgYXJncy5pbmNsdWRlTWV0YWRhdGEpO1xyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHRvb2w6ICR7dG9vbE5hbWV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgc2F2ZUFzc2V0TWV0YSh1cmxPclVVSUQ6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldC1tZXRhJywgdXJsT3JVVUlELCBjb250ZW50KS50aGVuKChyZXN1bHQ6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHJlc3VsdD8udXVpZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiByZXN1bHQ/LnVybCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0Fzc2V0IG1ldGEgc2F2ZWQgc3VjY2Vzc2Z1bGx5J1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZ2VuZXJhdGVBdmFpbGFibGVVcmwodXJsOiBzdHJpbmcpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdnZW5lcmF0ZS1hdmFpbGFibGUtdXJsJywgdXJsKS50aGVuKChhdmFpbGFibGVVcmw6IHN0cmluZykgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsVXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVVybDogYXZhaWxhYmxlVXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBhdmFpbGFibGVVcmwgPT09IHVybCA/IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ1VSTCBpcyBhdmFpbGFibGUnIDogXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnR2VuZXJhdGVkIG5ldyBhdmFpbGFibGUgVVJMJ1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcXVlcnlBc3NldERiUmVhZHkoKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktcmVhZHknKS50aGVuKChyZWFkeTogYm9vbGVhbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYWR5OiByZWFkeSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogcmVhZHkgPyAnQXNzZXQgZGF0YWJhc2UgaXMgcmVhZHknIDogJ0Fzc2V0IGRhdGFiYXNlIGlzIG5vdCByZWFkeSdcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycjogRXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIG9wZW5Bc3NldEV4dGVybmFsKHVybE9yVVVJRDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnb3Blbi1hc3NldCcsIHVybE9yVVVJRCkudGhlbigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdBc3NldCBvcGVuZWQgd2l0aCBleHRlcm5hbCBwcm9ncmFtJ1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnI6IEVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBiYXRjaEltcG9ydEFzc2V0cyhhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGFyZ3Muc291cmNlRGlyZWN0b3J5KSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdTb3VyY2UgZGlyZWN0b3J5IGRvZXMgbm90IGV4aXN0JyB9KTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSB0aGlzLmdldEZpbGVzRnJvbURpcmVjdG9yeShcclxuICAgICAgICAgICAgICAgICAgICBhcmdzLnNvdXJjZURpcmVjdG9yeSwgXHJcbiAgICAgICAgICAgICAgICAgICAgYXJncy5maWxlRmlsdGVyIHx8IFtdLCBcclxuICAgICAgICAgICAgICAgICAgICBhcmdzLnJlY3Vyc2l2ZSB8fCBmYWxzZVxyXG4gICAgICAgICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRSZXN1bHRzOiBhbnlbXSA9IFtdO1xyXG4gICAgICAgICAgICAgICAgbGV0IHN1Y2Nlc3NDb3VudCA9IDA7XHJcbiAgICAgICAgICAgICAgICBsZXQgZXJyb3JDb3VudCA9IDA7XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBmaWxlcykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBgJHthcmdzLnRhcmdldERpcmVjdG9yeX0vJHtmaWxlTmFtZX1gO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnaW1wb3J0LWFzc2V0JywgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCwgdGFyZ2V0UGF0aCwgeyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvdmVyd3JpdGU6IGFyZ3Mub3ZlcndyaXRlIHx8IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbmFtZTogIShhcmdzLm92ZXJ3cml0ZSB8fCBmYWxzZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW1wb3J0UmVzdWx0cy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZTogZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRhcmdldFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogcmVzdWx0Py51dWlkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbXBvcnRSZXN1bHRzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVyci5tZXNzYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvckNvdW50Kys7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b3RhbEZpbGVzOiBmaWxlcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NDb3VudDogc3VjY2Vzc0NvdW50LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvckNvdW50OiBlcnJvckNvdW50LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzOiBpbXBvcnRSZXN1bHRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgQmF0Y2ggaW1wb3J0IGNvbXBsZXRlZDogJHtzdWNjZXNzQ291bnR9IHN1Y2Nlc3MsICR7ZXJyb3JDb3VudH0gZXJyb3JzYFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldEZpbGVzRnJvbURpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcsIGZpbGVGaWx0ZXI6IHN0cmluZ1tdLCByZWN1cnNpdmU6IGJvb2xlYW4pOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbiAgICAgICAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgICAgIGNvbnN0IGl0ZW1zID0gZnMucmVhZGRpclN5bmMoZGlyUGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aC5qb2luKGRpclBhdGgsIGl0ZW0pO1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZnVsbFBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHN0YXQuaXNGaWxlKCkpIHtcclxuICAgICAgICAgICAgICAgIGlmIChmaWxlRmlsdGVyLmxlbmd0aCA9PT0gMCB8fCBmaWxlRmlsdGVyLnNvbWUoZXh0ID0+IGl0ZW0udG9Mb3dlckNhc2UoKS5lbmRzV2l0aChleHQudG9Mb3dlckNhc2UoKSkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmlsZXMucHVzaChmdWxsUGF0aCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpICYmIHJlY3Vyc2l2ZSkge1xyXG4gICAgICAgICAgICAgICAgZmlsZXMucHVzaCguLi50aGlzLmdldEZpbGVzRnJvbURpcmVjdG9yeShmdWxsUGF0aCwgZmlsZUZpbHRlciwgcmVjdXJzaXZlKSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGZpbGVzO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgYmF0Y2hEZWxldGVBc3NldHModXJsczogc3RyaW5nW10pOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVsZXRlUmVzdWx0czogYW55W10gPSBbXTtcclxuICAgICAgICAgICAgICAgIGxldCBzdWNjZXNzQ291bnQgPSAwO1xyXG4gICAgICAgICAgICAgICAgbGV0IGVycm9yQ291bnQgPSAwO1xyXG5cclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdXJsIG9mIHVybHMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdkZWxldGUtYXNzZXQnLCB1cmwpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGVSZXN1bHRzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGVSZXN1bHRzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnIubWVzc2FnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JDb3VudCsrO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdG90YWxBc3NldHM6IHVybHMubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzQ291bnQ6IHN1Y2Nlc3NDb3VudCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JDb3VudDogZXJyb3JDb3VudCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0czogZGVsZXRlUmVzdWx0cyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogYEJhdGNoIGRlbGV0ZSBjb21wbGV0ZWQ6ICR7c3VjY2Vzc0NvdW50fSBzdWNjZXNzLCAke2Vycm9yQ291bnR9IGVycm9yc2BcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUFzc2V0UmVmZXJlbmNlcyhkaXJlY3Rvcnk6IHN0cmluZyA9ICdkYjovL2Fzc2V0cycpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgLy8gR2V0IGFsbCBhc3NldHMgaW4gZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhc3NldHMgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldHMnLCB7IHBhdHRlcm46IGAke2RpcmVjdG9yeX0vKiovKmAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IGJyb2tlblJlZmVyZW5jZXM6IGFueVtdID0gW107XHJcbiAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFJlZmVyZW5jZXM6IGFueVtdID0gW107XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBhc3NldCBvZiBhc3NldHMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldEluZm8gPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgYXNzZXQudXJsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFzc2V0SW5mbykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRSZWZlcmVuY2VzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYXNzZXQudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IGFzc2V0LnV1aWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXNzZXQubmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJva2VuUmVmZXJlbmNlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYXNzZXQudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogYXNzZXQudXVpZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGFzc2V0Lm5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogKGVyciBhcyBFcnJvcikubWVzc2FnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpcmVjdG9yeTogZGlyZWN0b3J5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b3RhbEFzc2V0czogYXNzZXRzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRSZWZlcmVuY2VzOiB2YWxpZFJlZmVyZW5jZXMubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBicm9rZW5SZWZlcmVuY2VzOiBicm9rZW5SZWZlcmVuY2VzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYnJva2VuQXNzZXRzOiBicm9rZW5SZWZlcmVuY2VzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgVmFsaWRhdGlvbiBjb21wbGV0ZWQ6ICR7YnJva2VuUmVmZXJlbmNlcy5sZW5ndGh9IGJyb2tlbiByZWZlcmVuY2VzIGZvdW5kYFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdldEFzc2V0RGVwZW5kZW5jaWVzKHVybE9yVVVJRDogc3RyaW5nLCBkaXJlY3Rpb246IHN0cmluZyA9ICdkZXBlbmRlbmNpZXMnKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgLy8gTm90ZTogVGhpcyB3b3VsZCByZXF1aXJlIHNjZW5lIGFuYWx5c2lzIG9yIGFkZGl0aW9uYWwgQVBJcyBub3QgYXZhaWxhYmxlIGluIGN1cnJlbnQgZG9jdW1lbnRhdGlvblxyXG4gICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6ICdBc3NldCBkZXBlbmRlbmN5IGFuYWx5c2lzIHJlcXVpcmVzIGFkZGl0aW9uYWwgQVBJcyBub3QgYXZhaWxhYmxlIGluIGN1cnJlbnQgQ29jb3MgQ3JlYXRvciBNQ1AgaW1wbGVtZW50YXRpb24uIENvbnNpZGVyIHVzaW5nIHRoZSBFZGl0b3IgVUkgZm9yIGRlcGVuZGVuY3kgYW5hbHlzaXMuJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdldFVudXNlZEFzc2V0cyhkaXJlY3Rvcnk6IHN0cmluZyA9ICdkYjovL2Fzc2V0cycsIGV4Y2x1ZGVEaXJlY3Rvcmllczogc3RyaW5nW10gPSBbXSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIC8vIE5vdGU6IFRoaXMgd291bGQgcmVxdWlyZSBjb21wcmVoZW5zaXZlIHByb2plY3QgYW5hbHlzaXNcclxuICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGVycm9yOiAnVW51c2VkIGFzc2V0IGRldGVjdGlvbiByZXF1aXJlcyBjb21wcmVoZW5zaXZlIHByb2plY3QgYW5hbHlzaXMgbm90IGF2YWlsYWJsZSBpbiBjdXJyZW50IENvY29zIENyZWF0b3IgTUNQIGltcGxlbWVudGF0aW9uLiBDb25zaWRlciB1c2luZyB0aGUgRWRpdG9yIFVJIG9yIHRoaXJkLXBhcnR5IHRvb2xzIGZvciB1bnVzZWQgYXNzZXQgZGV0ZWN0aW9uLidcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KGFyZ3M6IGFueSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcmVwb3J0ID0gYXdhaXQgZ2V0VGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KCkuZW5mb3JjZUFsbCh7XHJcbiAgICAgICAgICAgICAgICBkaXJlY3Rvcnk6IGFyZ3MuZGlyZWN0b3J5LFxyXG4gICAgICAgICAgICAgICAgcHJlc2V0TmFtZTogYXJncy5wcmVzZXROYW1lLFxyXG4gICAgICAgICAgICAgICAgcHJlc2V0SWQ6IGFyZ3MucHJlc2V0SWQsXHJcbiAgICAgICAgICAgICAgICBxdWFsaXR5OiBhcmdzLnF1YWxpdHksXHJcbiAgICAgICAgICAgICAgICBkcnlSdW46IGFyZ3MuZHJ5UnVuLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHJlcG9ydC5jb21wbGV0ZSxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHJlcG9ydC5jb21wbGV0ZVxyXG4gICAgICAgICAgICAgICAgICAgID8gYFRleHR1cmUgY29tcHJlc3Npb24gcG9saWN5IGFwcGxpZWQgdG8gJHtyZXBvcnQuZWxpZ2libGV9IGVsaWdpYmxlIGFzc2V0KHMpLmBcclxuICAgICAgICAgICAgICAgICAgICA6IGBUZXh0dXJlIGNvbXByZXNzaW9uIHBvbGljeSBmYWlsZWQgZm9yICR7cmVwb3J0LmZhaWxlZH0gYXNzZXQocykuYCxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHJlcG9ydCxcclxuICAgICAgICAgICAgICAgIGVycm9yOiByZXBvcnQuY29tcGxldGUgPyB1bmRlZmluZWQgOiBgJHtyZXBvcnQuZmFpbGVkfSBlbGlnaWJsZSB0ZXh0dXJlKHMpIGNvdWxkIG5vdCBiZSBjb25maWd1cmVkYCxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGVuZm9yY2VGYnhJbXBvcnRQb2xpY3koYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCByZXBvcnQgPSBhd2FpdCBnZXRNb2RlbEltcG9ydFBvbGljeSgpLmVuZm9yY2VBbGwoe1xyXG4gICAgICAgICAgICAgICAgZGlyZWN0b3J5OiBhcmdzLmRpcmVjdG9yeSxcclxuICAgICAgICAgICAgICAgIGRyeVJ1bjogYXJncy5kcnlSdW4sXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogcmVwb3J0LmNvbXBsZXRlLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogcmVwb3J0LmNvbXBsZXRlXHJcbiAgICAgICAgICAgICAgICAgICAgPyBgRkJYIGltcG9ydCBwb2xpY3kgYXBwbGllZCB0byAke3JlcG9ydC5lbGlnaWJsZX0gZWxpZ2libGUgYXNzZXQocykuYFxyXG4gICAgICAgICAgICAgICAgICAgIDogYEZCWCBpbXBvcnQgcG9saWN5IGZhaWxlZCBmb3IgJHtyZXBvcnQuZmFpbGVkfSBhc3NldChzKS5gLFxyXG4gICAgICAgICAgICAgICAgZGF0YTogcmVwb3J0LFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IHJlcG9ydC5jb21wbGV0ZSA/IHVuZGVmaW5lZCA6IGAke3JlcG9ydC5mYWlsZWR9IGVsaWdpYmxlIEZCWCBtb2RlbChzKSBjb3VsZCBub3QgYmUgY29uZmlndXJlZGAsXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcikgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUVmZmVjdEltcG9ydChhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIGNvbnN0IGVmZmVjdFVybCA9IFN0cmluZyhhcmdzLmVmZmVjdFVybCB8fCAnJyk7XHJcbiAgICAgICAgY29uc3QgbWF0ZXJpYWxVcmxzID0gQXJyYXkuaXNBcnJheShhcmdzLm1hdGVyaWFsVXJscylcclxuICAgICAgICAgICAgPyBhcmdzLm1hdGVyaWFsVXJscy5tYXAoKHVybDogdW5rbm93bikgPT4gU3RyaW5nKHVybCkpIDogW107XHJcbiAgICAgICAgaWYgKCEvXmRiOlxcL1xcL2Fzc2V0c1xcLy4rXFwuZWZmZWN0JC9pLnRlc3QoZWZmZWN0VXJsKSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdlZmZlY3RVcmwgbXVzdCBiZSBhIGRiOi8vYXNzZXRzLyouZWZmZWN0IFVSTCcgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1hdGVyaWFsVXJscy5sZW5ndGggPiAzMiB8fCBtYXRlcmlhbFVybHMuc29tZSgodXJsOiBzdHJpbmcpID0+ICEvXmRiOlxcL1xcL2Fzc2V0c1xcLy4rXFwubXRsJC9pLnRlc3QodXJsKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnbWF0ZXJpYWxVcmxzIG11c3QgY29udGFpbiBhdCBtb3N0IDMyIGRiOi8vYXNzZXRzLyoubXRsIFVSTHMnIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuICAgICAgICBjb25zdCBwcm9qZWN0UGF0aCA9IChFZGl0b3IgYXMgYW55KT8uUHJvamVjdD8ucGF0aCB8fCBwcm9jZXNzLmN3ZCgpO1xyXG4gICAgICAgIGNvbnN0IGxvZ1BhdGggPSBwYXRoLmpvaW4ocHJvamVjdFBhdGgsICd0ZW1wJywgJ2xvZ3MnLCAncHJvamVjdC5sb2cnKTtcclxuICAgICAgICBsZXQgbG9nT2Zmc2V0ID0gMDtcclxuICAgICAgICB0cnkgeyBsb2dPZmZzZXQgPSBmcy5zdGF0U3luYyhsb2dQYXRoKS5zaXplOyB9IGNhdGNoIChfKSB7IC8qIGxvZyBpcyBvcHRpb25hbCBldmlkZW5jZSAqLyB9XHJcblxyXG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSBbXHJcbiAgICAgICAgICAgIHsgdXJsOiBlZmZlY3RVcmwsIGV4cGVjdGVkVHlwZTogJ2NjLkVmZmVjdEFzc2V0JywgZXhwZWN0ZWRJbXBvcnRlcjogJ2VmZmVjdCcgfSxcclxuICAgICAgICAgICAgLi4ubWF0ZXJpYWxVcmxzLm1hcCgodXJsOiBzdHJpbmcpID0+ICh7XHJcbiAgICAgICAgICAgICAgICB1cmwsIGV4cGVjdGVkVHlwZTogJ2NjLk1hdGVyaWFsJywgZXhwZWN0ZWRJbXBvcnRlcjogJ21hdGVyaWFsJyxcclxuICAgICAgICAgICAgfSkpLFxyXG4gICAgICAgIF07XHJcbiAgICAgICAgY29uc3QgYXNzZXRzOiBhbnlbXSA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlaW1wb3J0LWFzc2V0JywgdGFyZ2V0LnVybCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpbmZvOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdGFyZ2V0LnVybCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0eXBlID0gU3RyaW5nKGluZm8/LnR5cGUgfHwgJycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0ZXIgPSBTdHJpbmcoaW5mbz8ubWV0YT8uaW1wb3J0ZXIgfHwgJycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdHlwZU9rID0gdHlwZSA9PT0gdGFyZ2V0LmV4cGVjdGVkVHlwZTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGltcG9ydGVyT2sgPSBpbXBvcnRlciA9PT0gdGFyZ2V0LmV4cGVjdGVkSW1wb3J0ZXI7XHJcbiAgICAgICAgICAgICAgICBhc3NldHMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdXJsOiB0YXJnZXQudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgIHV1aWQ6IGluZm8/LnV1aWQgfHwgbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICB0eXBlLFxyXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydGVyLFxyXG4gICAgICAgICAgICAgICAgICAgIHR5cGVPayxcclxuICAgICAgICAgICAgICAgICAgICBpbXBvcnRlck9rLFxyXG4gICAgICAgICAgICAgICAgICAgIG9rOiBCb29sZWFuKGluZm8gJiYgdHlwZU9rICYmIGltcG9ydGVyT2spLFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIGFzc2V0cy5wdXNoKHsgdXJsOiB0YXJnZXQudXJsLCBvazogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzaGFkZXJFcnJvcnM6IHN0cmluZ1tdID0gW107XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY3VycmVudFNpemUgPSBmcy5zdGF0U3luYyhsb2dQYXRoKS5zaXplO1xyXG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IGN1cnJlbnRTaXplID49IGxvZ09mZnNldCA/IGxvZ09mZnNldCA6IDA7XHJcbiAgICAgICAgICAgIGNvbnN0IGxlbmd0aCA9IE1hdGgubWluKE1hdGgubWF4KDAsIGN1cnJlbnRTaXplIC0gc3RhcnQpLCAyNTYgKiAxMDI0KTtcclxuICAgICAgICAgICAgaWYgKGxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5hbGxvYyhsZW5ndGgpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVzY3JpcHRvciA9IGZzLm9wZW5TeW5jKGxvZ1BhdGgsICdyJyk7XHJcbiAgICAgICAgICAgICAgICB0cnkgeyBmcy5yZWFkU3luYyhkZXNjcmlwdG9yLCBidWZmZXIsIDAsIGxlbmd0aCwgc3RhcnQpOyB9XHJcbiAgICAgICAgICAgICAgICBmaW5hbGx5IHsgZnMuY2xvc2VTeW5jKGRlc2NyaXB0b3IpOyB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCByZWxldmFudCA9IC8oPzplZmZlY3R8c2hhZGVyfGdsc2x8Y2Nwcm9ncmFtfGVmeFxcZCopL2k7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmYWlsdXJlID0gLyg/OmVycm9yfGZhaWxlZD98aW52YWxpZHxzeW50YXh8dW5kZWNsYXJlZHxkb2VzIG5vdCBleGlzdCkvaTtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBidWZmZXIudG9TdHJpbmcoJ3V0ZjgnKS5zcGxpdCgvXFxyP1xcbi8pKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlbGV2YW50LnRlc3QobGluZSkgJiYgZmFpbHVyZS50ZXN0KGxpbmUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoYWRlckVycm9ycy5wdXNoKGxpbmUuc2xpY2UoMCwgNjAwKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzaGFkZXJFcnJvcnMubGVuZ3RoID49IDIwKSBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChfKSB7IC8qIG1pc3Npbmcvcm90YXRlZCBsb2cgaXMgcmVwb3J0ZWQsIG5vdCBzaWxlbnRseSB0cmVhdGVkIGFzIHByb29mICovIH1cclxuXHJcbiAgICAgICAgY29uc3QgYXNzZXRUeXBlc09rID0gYXNzZXRzLmxlbmd0aCA9PT0gdGFyZ2V0cy5sZW5ndGggJiYgYXNzZXRzLmV2ZXJ5KGFzc2V0ID0+IGFzc2V0Lm9rKTtcclxuICAgICAgICBjb25zdCBsb2dDaGVja2VkID0gZnMuZXhpc3RzU3luYyhsb2dQYXRoKTtcclxuICAgICAgICBjb25zdCBjb21wbGV0ZSA9IGFzc2V0VHlwZXNPayAmJiBsb2dDaGVja2VkICYmIHNoYWRlckVycm9ycy5sZW5ndGggPT09IDA7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc3VjY2VzczogY29tcGxldGUsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IGNvbXBsZXRlXHJcbiAgICAgICAgICAgICAgICA/IGBFZmZlY3QgaW1wb3J0IGdhdGUgcGFzc2VkIGZvciAke3RhcmdldHMubGVuZ3RofSBhc3NldChzKS5gXHJcbiAgICAgICAgICAgICAgICA6ICdFZmZlY3QgaW1wb3J0IGdhdGUgZmFpbGVkOyBpbnNwZWN0IGFzc2V0L2ltcG9ydGVyIGV2aWRlbmNlIGFuZCBuZXcgc2hhZGVyIGVycm9ycy4nLFxyXG4gICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICBjb21wbGV0ZSxcclxuICAgICAgICAgICAgICAgIHNjb3BlOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29jb3NBc3NldERiUmVpbXBvcnQ6ICdjaGVja2VkJyxcclxuICAgICAgICAgICAgICAgICAgICBhc3NldFR5cGVzQW5kSW1wb3J0ZXJzOiBhc3NldFR5cGVzT2sgPyAncGFzc2VkJyA6ICdmYWlsZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgIG5ld1Byb2plY3RMb2dTaGFkZXJFcnJvcnM6IGxvZ0NoZWNrZWQgPyAoc2hhZGVyRXJyb3JzLmxlbmd0aCA/ICdmYWlsZWQnIDogJ3Bhc3NlZCcpIDogJ3VudmVyaWZpZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgIHJ1bnRpbWVWYXJpYW50OiAndW52ZXJpZmllZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgdW5pdHlWaXN1YWxQYXJpdHk6ICd1bnZlcmlmaWVkJyxcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBhc3NldHMsXHJcbiAgICAgICAgICAgICAgICBsb2dDaGVja2VkLFxyXG4gICAgICAgICAgICAgICAgc2hhZGVyRXJyb3JzLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBlcnJvcjogY29tcGxldGUgPyB1bmRlZmluZWQgOiAnQ29jb3MgZWZmZWN0IGltcG9ydCBhY2NlcHRhbmNlIGlzIGluY29tcGxldGUnLFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBleHBvcnRBc3NldE1hbmlmZXN0KGRpcmVjdG9yeTogc3RyaW5nID0gJ2RiOi8vYXNzZXRzJywgZm9ybWF0OiBzdHJpbmcgPSAnanNvbicsIGluY2x1ZGVNZXRhZGF0YTogYm9vbGVhbiA9IHRydWUpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRzID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXRzJywgeyBwYXR0ZXJuOiBgJHtkaXJlY3Rvcnl9LyoqLypgIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCBtYW5pZmVzdDogYW55W10gPSBbXTtcclxuXHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGFzc2V0cykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hbmlmZXN0RW50cnk6IGFueSA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXNzZXQubmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBhc3NldC51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IGFzc2V0LnV1aWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IGFzc2V0LnR5cGUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpemU6IChhc3NldCBhcyBhbnkpLnNpemUgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgaXNEaXJlY3Rvcnk6IGFzc2V0LmlzRGlyZWN0b3J5IHx8IGZhbHNlXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluY2x1ZGVNZXRhZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYXNzZXRJbmZvID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIGFzc2V0LnVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYXNzZXRJbmZvICYmIGFzc2V0SW5mby5tZXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFuaWZlc3RFbnRyeS5tZXRhID0gYXNzZXRJbmZvLm1ldGE7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBtZXRhZGF0YSBpZiBub3QgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIG1hbmlmZXN0LnB1c2gobWFuaWZlc3RFbnRyeSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgbGV0IGV4cG9ydERhdGE6IHN0cmluZztcclxuICAgICAgICAgICAgICAgIHN3aXRjaCAoZm9ybWF0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnanNvbic6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydERhdGEgPSBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ2Nzdic6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydERhdGEgPSB0aGlzLmNvbnZlcnRUb0NTVihtYW5pZmVzdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ3htbCc6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydERhdGEgPSB0aGlzLmNvbnZlcnRUb1hNTChtYW5pZmVzdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydERhdGEgPSBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMik7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpcmVjdG9yeTogZGlyZWN0b3J5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtYXQ6IGZvcm1hdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXRDb3VudDogbWFuaWZlc3QubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbmNsdWRlTWV0YWRhdGE6IGluY2x1ZGVNZXRhZGF0YSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFuaWZlc3Q6IGV4cG9ydERhdGEsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBBc3NldCBtYW5pZmVzdCBleHBvcnRlZCB3aXRoICR7bWFuaWZlc3QubGVuZ3RofSBhc3NldHNgXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY29udmVydFRvQ1NWKGRhdGE6IGFueVtdKTogc3RyaW5nIHtcclxuICAgICAgICBpZiAoZGF0YS5sZW5ndGggPT09IDApIHJldHVybiAnJztcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmtleXMoZGF0YVswXSk7XHJcbiAgICAgICAgY29uc3QgY3N2Um93cyA9IFtoZWFkZXJzLmpvaW4oJywnKV07XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgZGF0YSkge1xyXG4gICAgICAgICAgICBjb25zdCB2YWx1ZXMgPSBoZWFkZXJzLm1hcChoZWFkZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSByb3dbaGVhZGVyXTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGNzdlJvd3MucHVzaCh2YWx1ZXMuam9pbignLCcpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGNzdlJvd3Muam9pbignXFxuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjb252ZXJ0VG9YTUwoZGF0YTogYW55W10pOiBzdHJpbmcge1xyXG4gICAgICAgIGxldCB4bWwgPSAnPD94bWwgdmVyc2lvbj1cIjEuMFwiIGVuY29kaW5nPVwiVVRGLThcIj8+XFxuPGFzc2V0cz5cXG4nO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBkYXRhKSB7XHJcbiAgICAgICAgICAgIHhtbCArPSAnICA8YXNzZXQ+XFxuJztcclxuICAgICAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoaXRlbSkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHhtbFZhbHVlID0gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyA/IFxyXG4gICAgICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHZhbHVlKSA6IFxyXG4gICAgICAgICAgICAgICAgICAgIFN0cmluZyh2YWx1ZSkucmVwbGFjZSgvJi9nLCAnJmFtcDsnKS5yZXBsYWNlKC88L2csICcmbHQ7JykucmVwbGFjZSgvPi9nLCAnJmd0OycpO1xyXG4gICAgICAgICAgICAgICAgeG1sICs9IGAgICAgPCR7a2V5fT4ke3htbFZhbHVlfTwvJHtrZXl9PlxcbmA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgeG1sICs9ICcgIDwvYXNzZXQ+XFxuJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgeG1sICs9ICc8L2Fzc2V0cz4nO1xyXG4gICAgICAgIHJldHVybiB4bWw7XHJcbiAgICB9XHJcbn1cclxuIl19