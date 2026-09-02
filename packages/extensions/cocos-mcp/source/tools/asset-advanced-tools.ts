import { ToolDefinition, ToolResponse, ToolExecutor } from '../types';
import { getTextureCompressionPolicy } from '../texture-compression-policy';
import { getModelImportPolicy } from '../model-import-policy';

export class AssetAdvancedTools implements ToolExecutor {
    getTools(): ToolDefinition[] {
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

    async execute(toolName: string, args: any): Promise<ToolResponse> {
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

    private async saveAssetMeta(urlOrUUID: string, content: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'save-asset-meta', urlOrUUID, content).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        uuid: result?.uuid,
                        url: result?.url,
                        message: 'Asset meta saved successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async generateAvailableUrl(url: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'generate-available-url', url).then((availableUrl: string) => {
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
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryAssetDbReady(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'query-ready').then((ready: boolean) => {
                resolve({
                    success: true,
                    data: {
                        ready: ready,
                        message: ready ? 'Asset database is ready' : 'Asset database is not ready'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async openAssetExternal(urlOrUUID: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'open-asset', urlOrUUID).then(() => {
                resolve({
                    success: true,
                    message: 'Asset opened with external program'
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async batchImportAssets(args: any): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                if (!fs.existsSync(args.sourceDirectory)) {
                    resolve({ success: false, error: 'Source directory does not exist' });
                    return;
                }

                const files = this.getFilesFromDirectory(
                    args.sourceDirectory, 
                    args.fileFilter || [], 
                    args.recursive || false
                );

                const importResults: any[] = [];
                let successCount = 0;
                let errorCount = 0;

                for (const filePath of files) {
                    try {
                        const fileName = path.basename(filePath);
                        const targetPath = `${args.targetDirectory}/${fileName}`;
                        
                        const result = await Editor.Message.request('asset-db', 'import-asset', 
                            filePath, targetPath, { 
                                overwrite: args.overwrite || false,
                                rename: !(args.overwrite || false)
                            });
                        
                        importResults.push({
                            source: filePath,
                            target: targetPath,
                            success: true,
                            uuid: result?.uuid
                        });
                        successCount++;
                    } catch (err: any) {
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
            } catch (err: any) {
                resolve({ success: false, error: err.message });
            }
        });
    }

    private getFilesFromDirectory(dirPath: string, fileFilter: string[], recursive: boolean): string[] {
        const fs = require('fs');
        const path = require('path');
        const files: string[] = [];

        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isFile()) {
                if (fileFilter.length === 0 || fileFilter.some(ext => item.toLowerCase().endsWith(ext.toLowerCase()))) {
                    files.push(fullPath);
                }
            } else if (stat.isDirectory() && recursive) {
                files.push(...this.getFilesFromDirectory(fullPath, fileFilter, recursive));
            }
        }
        
        return files;
    }

    private async batchDeleteAssets(urls: string[]): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                const deleteResults: any[] = [];
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
                    } catch (err: any) {
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
            } catch (err: any) {
                resolve({ success: false, error: err.message });
            }
        });
    }

    private async validateAssetReferences(directory: string = 'db://assets'): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                // Get all assets in directory
                const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
                
                const brokenReferences: any[] = [];
                const validReferences: any[] = [];

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
                    } catch (err) {
                        brokenReferences.push({
                            url: asset.url,
                            uuid: asset.uuid,
                            name: asset.name,
                            error: (err as Error).message
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
            } catch (err: any) {
                resolve({ success: false, error: err.message });
            }
        });
    }

    private async getAssetDependencies(urlOrUUID: string, direction: string = 'dependencies'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            // Note: This would require scene analysis or additional APIs not available in current documentation
            resolve({
                success: false,
                error: 'Asset dependency analysis requires additional APIs not available in current Cocos Creator MCP implementation. Consider using the Editor UI for dependency analysis.'
            });
        });
    }

    private async getUnusedAssets(directory: string = 'db://assets', excludeDirectories: string[] = []): Promise<ToolResponse> {
        return new Promise((resolve) => {
            // Note: This would require comprehensive project analysis
            resolve({
                success: false,
                error: 'Unused asset detection requires comprehensive project analysis not available in current Cocos Creator MCP implementation. Consider using the Editor UI or third-party tools for unused asset detection.'
            });
        });
    }

    private async enforceTextureCompressionPolicy(args: any): Promise<ToolResponse> {
        try {
            const report = await getTextureCompressionPolicy().enforceAll({
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
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    }

    private async enforceFbxImportPolicy(args: any): Promise<ToolResponse> {
        try {
            const report = await getModelImportPolicy().enforceAll({
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
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    }

    private async validateEffectImport(args: any): Promise<ToolResponse> {
        const effectUrl = String(args.effectUrl || '');
        const materialUrls = Array.isArray(args.materialUrls)
            ? args.materialUrls.map((url: unknown) => String(url)) : [];
        if (!/^db:\/\/assets\/.+\.effect$/i.test(effectUrl)) {
            return { success: false, error: 'effectUrl must be a db://assets/*.effect URL' };
        }
        if (materialUrls.length > 32 || materialUrls.some((url: string) => !/^db:\/\/assets\/.+\.mtl$/i.test(url))) {
            return { success: false, error: 'materialUrls must contain at most 32 db://assets/*.mtl URLs' };
        }

        const fs = require('fs');
        const path = require('path');
        const projectPath = (Editor as any)?.Project?.path || process.cwd();
        const logPath = path.join(projectPath, 'temp', 'logs', 'project.log');
        let logOffset = 0;
        try { logOffset = fs.statSync(logPath).size; } catch (_) { /* log is optional evidence */ }

        const targets = [
            { url: effectUrl, expectedType: 'cc.EffectAsset', expectedImporter: 'effect' },
            ...materialUrls.map((url: string) => ({
                url, expectedType: 'cc.Material', expectedImporter: 'material',
            })),
        ];
        const assets: any[] = [];
        for (const target of targets) {
            try {
                await Editor.Message.request('asset-db', 'reimport-asset', target.url);
                const info: any = await Editor.Message.request('asset-db', 'query-asset-info', target.url);
                const type = String(info?.type || '');
                let meta: any = info?.meta || null;
                let metaSource = 'query-asset-info';
                if (!meta?.importer) {
                    meta = await Editor.Message.request(
                        'asset-db',
                        'query-asset-meta',
                        info?.uuid || target.url,
                    );
                    metaSource = 'query-asset-meta';
                }
                const importer = String(meta?.importer || '');
                const imported = meta?.imported;
                const typeOk = type === target.expectedType;
                const importerOk = importer === target.expectedImporter && imported !== false;
                assets.push({
                    url: target.url,
                    uuid: info?.uuid || null,
                    type,
                    importer,
                    imported: imported === undefined ? null : Boolean(imported),
                    metaSource,
                    typeOk,
                    importerOk,
                    ok: Boolean(info && typeOk && importerOk),
                });
            } catch (error: any) {
                assets.push({ url: target.url, ok: false, error: error?.message || String(error) });
            }
        }

        const shaderErrors: string[] = [];
        try {
            const currentSize = fs.statSync(logPath).size;
            const start = currentSize >= logOffset ? logOffset : 0;
            const length = Math.min(Math.max(0, currentSize - start), 256 * 1024);
            if (length > 0) {
                const buffer = Buffer.alloc(length);
                const descriptor = fs.openSync(logPath, 'r');
                try { fs.readSync(descriptor, buffer, 0, length, start); }
                finally { fs.closeSync(descriptor); }
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
                        if (shaderErrors.length >= 20) break;
                    }
                }
            }
        } catch (_) { /* missing/rotated log is reported, not silently treated as proof */ }

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

    private async exportAssetManifest(directory: string = 'db://assets', format: string = 'json', includeMetadata: boolean = true): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
                
                const manifest: any[] = [];

                for (const asset of assets) {
                    const manifestEntry: any = {
                        name: asset.name,
                        url: asset.url,
                        uuid: asset.uuid,
                        type: asset.type,
                        size: (asset as any).size || 0,
                        isDirectory: asset.isDirectory || false
                    };

                    if (includeMetadata) {
                        try {
                            const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url);
                            if (assetInfo && assetInfo.meta) {
                                manifestEntry.meta = assetInfo.meta;
                            }
                        } catch (err) {
                            // Skip metadata if not available
                        }
                    }

                    manifest.push(manifestEntry);
                }

                let exportData: string;
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
            } catch (err: any) {
                resolve({ success: false, error: err.message });
            }
        });
    }

    private convertToCSV(data: any[]): string {
        if (data.length === 0) return '';
        
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

    private convertToXML(data: any[]): string {
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
