"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineFeatureTools = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const PHYSICS_BACKENDS = [
    'physics-builtin',
    'physics-cannon',
    'physics-ammo',
    'physics-physx'
];
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withTimeout(promise, timeoutMs, label) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function validFeatureName(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
}
function activeConfig(profile) {
    var _a;
    const key = (profile === null || profile === void 0 ? void 0 : profile.globalConfigKey) || 'defaultConfig';
    const config = (_a = profile === null || profile === void 0 ? void 0 : profile.configs) === null || _a === void 0 ? void 0 : _a[key];
    if (!config || typeof config !== 'object') {
        throw new Error(`Engine feature profile is missing configs.${key}`);
    }
    config.cache || (config.cache = {});
    config.includeModules || (config.includeModules = []);
    return config;
}
function snapshot(profile) {
    var _a;
    const key = (profile === null || profile === void 0 ? void 0 : profile.globalConfigKey) || 'defaultConfig';
    const config = activeConfig(profile);
    const cache = config.cache || {};
    return {
        configKey: key,
        includeModules: [...(config.includeModules || [])],
        physicsBackend: ((_a = cache.physics) === null || _a === void 0 ? void 0 : _a._option) || null,
        enabled: Object.keys(cache).filter((name) => { var _a; return ((_a = cache[name]) === null || _a === void 0 ? void 0 : _a._value) === true; }).sort()
    };
}
function appliedSatisfies(receipt, modules, physicsBackend) {
    if (!receipt.available)
        return false;
    if (modules.some((name) => !receipt.features.includes(name)))
        return false;
    return !physicsBackend || receipt.features.includes(physicsBackend);
}
class EngineFeatureTools {
    getTools() {
        return [
            {
                name: 'get_features',
                description: 'Read the active Cocos Feature Cropping profile and selected physics backend.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'ensure_features',
                description: 'Enable required Feature Cropping modules through Editor.Profile and rebuild the cropped engine. When data.status is restart-required, restart the exact project from an external supervisor and call get_features again; data.complete is true only after the active preview import map is verified.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        modules: {
                            type: 'array',
                            items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
                            maxItems: 64,
                            default: []
                        },
                        physicsBackend: {
                            type: 'string',
                            enum: [...PHYSICS_BACKENDS]
                        },
                        reload: { type: 'boolean', default: true },
                        timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000, default: 240000 }
                    }
                }
            }
        ];
    }
    async execute(toolName, args) {
        if (toolName === 'get_features')
            return this.getFeatures();
        if (toolName === 'ensure_features')
            return this.ensureFeatures(args || {});
        return { success: false, error: `Unknown engineFeature tool: ${toolName}` };
    }
    async readProfile() {
        const profileApi = Editor.Profile;
        if (!(profileApi === null || profileApi === void 0 ? void 0 : profileApi.getProject))
            throw new Error('Editor.Profile.getProject is unavailable');
        const profile = await profileApi.getProject('engine', 'modules');
        if (!profile)
            throw new Error('Cocos returned an empty engine Feature Cropping profile');
        return profile;
    }
    async getFeatures() {
        try {
            return {
                success: true,
                data: Object.assign(Object.assign({}, snapshot(await this.readProfile())), { appliedPreview: await this.readAppliedPreviewFeatures() })
            };
        }
        catch (error) {
            return { success: false, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
    }
    async readAppliedPreviewFeatures() {
        var _a;
        const source = 'temp/programming/packer-driver/targets/preview/import-map.json';
        const projectTmpDir = (_a = Editor.Project) === null || _a === void 0 ? void 0 : _a.tmpDir;
        if (!projectTmpDir) {
            return {
                available: false,
                features: [],
                importMapSha256: null,
                importMapModifiedMs: null,
                source,
                error: 'Editor.Project.tmpDir is unavailable'
            };
        }
        const importMapPath = path.join(projectTmpDir, 'programming', 'packer-driver', 'targets', 'preview', 'import-map.json');
        try {
            const [raw, stat] = await Promise.all([
                fs_1.promises.readFile(importMapPath, 'utf8'),
                fs_1.promises.stat(importMapPath)
            ]);
            const parsed = JSON.parse(raw);
            const features = new Set();
            for (const scope of Object.values((parsed === null || parsed === void 0 ? void 0 : parsed.scopes) || {})) {
                if (!scope || typeof scope !== 'object')
                    continue;
                for (const value of Object.values(scope)) {
                    if (typeof value !== 'string')
                        continue;
                    const prefix = 'cce:/internal/x/cc-fu/';
                    if (value.startsWith(prefix))
                        features.add(value.slice(prefix.length));
                }
            }
            return {
                available: true,
                features: [...features].sort(),
                importMapSha256: (0, crypto_1.createHash)('sha256').update(raw).digest('hex'),
                importMapModifiedMs: stat.mtimeMs,
                source
            };
        }
        catch (error) {
            return {
                available: false,
                features: [],
                importMapSha256: null,
                importMapModifiedMs: null,
                source,
                error: (error === null || error === void 0 ? void 0 : error.message) || String(error)
            };
        }
    }
    transactionPath() {
        var _a;
        const projectTmpDir = (_a = Editor.Project) === null || _a === void 0 ? void 0 : _a.tmpDir;
        return projectTmpDir ? path.join(projectTmpDir, 'cocos-mcp', 'engine-feature-transaction.json') : null;
    }
    async readTransaction() {
        const file = this.transactionPath();
        if (!file)
            return null;
        try {
            return JSON.parse(await fs_1.promises.readFile(file, 'utf8'));
        }
        catch (_a) {
            return null;
        }
    }
    async writeTransaction(value) {
        const file = this.transactionPath();
        if (!file)
            throw new Error('Editor.Project.tmpDir is unavailable for the engine feature transaction receipt');
        await fs_1.promises.mkdir(path.dirname(file), { recursive: true });
        await fs_1.promises.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }
    async clearTransaction() {
        const file = this.transactionPath();
        if (file)
            await fs_1.promises.unlink(file).catch(() => undefined);
    }
    async waitForAppliedFeatures(modules, physicsBackend, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        let receipt = await this.readAppliedPreviewFeatures();
        while (!appliedSatisfies(receipt, modules, physicsBackend) && Date.now() < deadline) {
            await sleep(500);
            receipt = await this.readAppliedPreviewFeatures();
        }
        return receipt;
    }
    async rebuildEngineAndWait(timeoutMs) {
        var _a, _b, _c;
        const messageApi = Editor.Message;
        let versionFile = null;
        let versionMtimeBefore = 0;
        try {
            const engineInfo = await withTimeout(messageApi.request('engine', 'query-info'), 10000, 'engine info query');
            const enginePath = engineInfo === null || engineInfo === void 0 ? void 0 : engineInfo.path;
            if (typeof enginePath === 'string' && enginePath) {
                versionFile = path.join(enginePath, 'bin', '.cache', 'dev', 'VERSION');
                versionMtimeBefore = ((_a = (await fs_1.promises.stat(versionFile).catch(() => null))) === null || _a === void 0 ? void 0 : _a.mtimeMs) || 0;
            }
        }
        catch (_d) {
            // The bounded project log receipt below remains available as a fallback.
        }
        const projectPath = (_b = Editor.Project) === null || _b === void 0 ? void 0 : _b.path;
        const projectLog = projectPath ? path.join(projectPath, 'temp', 'logs', 'project.log') : null;
        const projectLogSizeBefore = projectLog
            ? (((_c = (await fs_1.promises.stat(projectLog).catch(() => null))) === null || _c === void 0 ? void 0 : _c.size) || 0)
            : 0;
        const startedAt = Date.now();
        let requestSettled = false;
        let requestError = null;
        // Cocos 3.8.8 can finish Quick Compile but leave the message request
        // unresolved while the engine consumer is being replaced. Observe the
        // compiler's own VERSION/log receipt instead of hanging the MCP request.
        void messageApi.request('engine', 'rebuild').then(() => { requestSettled = true; }, (error) => { requestSettled = true; requestError = error; });
        const deadline = startedAt + timeoutMs;
        while (Date.now() < deadline) {
            if (versionFile) {
                const stat = await fs_1.promises.stat(versionFile).catch(() => null);
                if (stat && stat.mtimeMs > versionMtimeBefore && stat.mtimeMs >= startedAt - 1000) {
                    return {
                        completed: true,
                        source: 'engine-cache-version',
                        durationMs: Date.now() - startedAt,
                        versionModifiedMs: stat.mtimeMs,
                        requestSettled
                    };
                }
            }
            if (projectLog) {
                try {
                    const log = await fs_1.promises.readFile(projectLog);
                    if (log.length > projectLogSizeBefore) {
                        const appended = log.subarray(projectLogSizeBefore).toString('utf8');
                        if (/Quick Compile:\s*\d+ms/.test(appended)) {
                            return {
                                completed: true,
                                source: 'project-log',
                                durationMs: Date.now() - startedAt,
                                requestSettled
                            };
                        }
                    }
                }
                catch (_e) {
                    // Keep polling the engine VERSION receipt when available.
                }
            }
            if (requestSettled && requestError) {
                throw requestError;
            }
            await sleep(250);
        }
        throw new Error(`Cocos engine feature rebuild timed out after ${timeoutMs}ms`);
    }
    async ensureFeatures(args) {
        var _a;
        var _b;
        try {
            const requested = Array.isArray(args.modules) ? args.modules : [];
            if (!requested.every(validFeatureName)) {
                return { success: false, error: 'Every requested module must be a valid Cocos feature name.' };
            }
            const modules = [...new Set(requested)];
            const physicsBackend = args.physicsBackend;
            if (physicsBackend && !PHYSICS_BACKENDS.includes(physicsBackend)) {
                return { success: false, error: `Unsupported physics backend: ${physicsBackend}` };
            }
            const beforeProfile = await this.readProfile();
            const before = snapshot(beforeProfile);
            const next = clone(beforeProfile);
            const config = activeConfig(next);
            const include = new Set(config.includeModules || []);
            // A module is writable only when the current Creator profile exposes
            // its cache record. includeModules is selection state, not a schema;
            // trusting an orphan include entry would dereference/insert blindly.
            const knownModules = new Set(Object.keys(config.cache || {}));
            const unknownModules = modules.filter((moduleName) => !knownModules.has(moduleName));
            if (unknownModules.length) {
                return {
                    success: false,
                    error: `Refusing to add unknown Cocos engine modules: ${unknownModules.join(', ')}`,
                    data: { complete: false, status: 'unknown-feature-module', before }
                };
            }
            if (physicsBackend && (!knownModules.has('physics') || !knownModules.has(physicsBackend))) {
                return {
                    success: false,
                    error: `Physics feature/backend is not available in this Cocos profile: physics + ${physicsBackend}`,
                    data: { complete: false, status: 'unknown-physics-backend', before }
                };
            }
            let changed = false;
            for (const moduleName of modules) {
                if (config.cache[moduleName]._value !== true) {
                    config.cache[moduleName]._value = true;
                    changed = true;
                }
                if (!include.has(moduleName)) {
                    include.add(moduleName);
                    changed = true;
                }
            }
            if (physicsBackend) {
                (_b = config.cache).physics || (_b.physics = {});
                if (config.cache.physics._value !== true || config.cache.physics._option !== physicsBackend) {
                    config.cache.physics._value = true;
                    config.cache.physics._option = physicsBackend;
                    changed = true;
                }
                for (const backend of PHYSICS_BACKENDS) {
                    if (!knownModules.has(backend))
                        continue;
                    const selected = backend === physicsBackend;
                    if (config.cache[backend]._value !== selected) {
                        config.cache[backend]._value = selected;
                        changed = true;
                    }
                    if (selected)
                        include.add(backend);
                    else
                        include.delete(backend);
                }
            }
            const ordered = [...include].sort();
            if (JSON.stringify(ordered) !== JSON.stringify(config.includeModules))
                changed = true;
            config.includeModules = ordered;
            const reloadRequested = args.reload !== false;
            const timeoutMs = Math.min(300000, Math.max(1000, Number(args.timeoutMs) || 240000));
            const profileApi = Editor.Profile;
            if (changed) {
                if (!(profileApi === null || profileApi === void 0 ? void 0 : profileApi.setProject))
                    throw new Error('Editor.Profile.setProject is unavailable');
                await profileApi.setProject('engine', 'modules', next);
            }
            const verifiedProfile = await this.readProfile();
            const after = snapshot(verifiedProfile);
            const missing = modules.filter((name) => !after.includeModules.includes(name));
            if (physicsBackend && after.physicsBackend !== physicsBackend) {
                missing.push(`physics backend ${physicsBackend}`);
            }
            if (missing.length) {
                return {
                    success: false,
                    error: `Feature Cropping write did not persist: ${missing.join(', ')}`,
                    data: { complete: false, changed, before, after }
                };
            }
            const appliedBefore = await this.readAppliedPreviewFeatures();
            const signature = (0, crypto_1.createHash)('sha256').update(JSON.stringify({
                modules: [...modules].sort(),
                physicsBackend: physicsBackend || null,
                includeModules: after.includeModules,
                configKey: after.configKey
            })).digest('hex');
            const pending = await this.readTransaction();
            if (appliedSatisfies(appliedBefore, modules, physicsBackend)) {
                await this.clearTransaction();
                return {
                    success: true,
                    message: 'Feature Cropping profile and the active preview import map are synchronized.',
                    data: {
                        complete: true,
                        status: 'verified',
                        changed,
                        before,
                        after,
                        appliedBefore,
                        appliedAfter: appliedBefore,
                        transaction: pending ? { recovered: true, attempts: pending.attempts || 1 } : null
                    }
                };
            }
            if (!reloadRequested) {
                return {
                    success: true,
                    message: 'Feature Cropping profile is persisted, but engine reload was explicitly skipped.',
                    data: {
                        complete: false,
                        status: 'profile-persisted-reload-skipped',
                        changed,
                        before,
                        after,
                        appliedBefore
                    }
                };
            }
            // A Cocos process cannot reliably acknowledge the RPC that destroys its own
            // MCP transport. Keep relaunch outside this extension: the shared-kit
            // supervisor can verify exact project/PID ownership, restart it, reconnect,
            // and then prove that the regenerated preview import map is current.
            const matchingPending = (pending === null || pending === void 0 ? void 0 : pending.signature) === signature
                && ((pending === null || pending === void 0 ? void 0 : pending.status) === 'restart-required' || (pending === null || pending === void 0 ? void 0 : pending.status) === 'editor-relaunch-scheduled');
            if (matchingPending) {
                return {
                    success: true,
                    message: 'Feature Cropping is persisted and rebuilt, but the active preview import map is still stale. Restart this exact Cocos project externally, then call get_features again.',
                    data: {
                        complete: false,
                        status: 'restart-required',
                        changed,
                        before,
                        after,
                        appliedBefore,
                        transaction: Object.assign(Object.assign({}, pending), { recovered: true, externalRestartRequired: true })
                    }
                };
            }
            // Protect unsaved scene work before scheduling an Editor relaunch.
            let sceneWasDirty = false;
            try {
                const dirtyResult = await withTimeout(Editor.Message.request('scene', 'query-dirty'), 10000, 'scene dirty query');
                sceneWasDirty = Boolean((_a = dirtyResult === null || dirtyResult === void 0 ? void 0 : dirtyResult.dirty) !== null && _a !== void 0 ? _a : dirtyResult);
                if (sceneWasDirty) {
                    await withTimeout(Editor.Message.request('scene', 'save-scene'), 30000, 'scene save before Editor relaunch');
                }
            }
            catch (error) {
                return {
                    success: false,
                    error: `Refusing to relaunch Cocos Editor because the current scene could not be safely checked/saved: ${(error === null || error === void 0 ? void 0 : error.message) || String(error)}`,
                    data: { complete: false, status: 'scene-save-preflight-failed', changed, before, after, appliedBefore }
                };
            }
            const rebuildStartedAt = Date.now();
            let engineRebuild;
            try {
                engineRebuild = await this.rebuildEngineAndWait(timeoutMs);
            }
            catch (error) {
                return {
                    success: false,
                    error: `Cocos could not rebuild the cropped engine: ${(error === null || error === void 0 ? void 0 : error.message) || String(error)}`,
                    data: {
                        complete: false,
                        status: 'engine-rebuild-failed',
                        changed,
                        before,
                        after,
                        appliedBefore,
                        engineRebuildMs: Date.now() - rebuildStartedAt
                    }
                };
            }
            const transaction = {
                version: 1,
                signature,
                status: 'restart-required',
                attempts: 1,
                createdAt: new Date().toISOString(),
                expected: { modules: [...modules].sort(), physicsBackend: physicsBackend || null },
                before,
                after,
                appliedBefore,
                engineRebuild,
                engineRebuildMs: Date.now() - rebuildStartedAt,
                sceneWasDirty
            };
            await this.writeTransaction(transaction);
            return {
                success: true,
                message: 'Feature Cropping profile is persisted and the cropped engine is rebuilt. Restart this exact Cocos project externally, then call get_features to obtain the final import-map receipt.',
                data: {
                    complete: false,
                    status: 'restart-required',
                    changed,
                    before,
                    after,
                    appliedBefore,
                    transaction: {
                        signature,
                        attempts: transaction.attempts,
                        engineRebuild: transaction.engineRebuild,
                        engineRebuildMs: transaction.engineRebuildMs,
                        sceneWasDirty,
                        externalRestartRequired: true,
                        reconnectRequired: true
                    }
                }
            };
        }
        catch (error) {
            return { success: false, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
    }
}
exports.EngineFeatureTools = EngineFeatureTools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLWZlYXR1cmUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZW5naW5lLWZlYXR1cmUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsbUNBQW9DO0FBQ3BDLDJCQUFvQztBQUNwQywyQ0FBNkI7QUFFN0IsTUFBTSxnQkFBZ0IsR0FBRztJQUNyQixpQkFBaUI7SUFDakIsZ0JBQWdCO0lBQ2hCLGNBQWM7SUFDZCxlQUFlO0NBQ1QsQ0FBQztBQUlYLFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDckIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUM7QUFFRCxLQUFLLFVBQVUsV0FBVyxDQUFJLE9BQW1CLEVBQUUsU0FBaUIsRUFBRSxLQUFhO0lBQy9FLElBQUksS0FBZ0QsQ0FBQztJQUNyRCxJQUFJLENBQUM7UUFDRCxPQUFPLE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQztZQUN0QixPQUFPO1lBQ1AsSUFBSSxPQUFPLENBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLEVBQUU7Z0JBQ2hDLEtBQUssR0FBRyxVQUFVLENBQUMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxvQkFBb0IsU0FBUyxJQUFJLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQ3RHLENBQUMsQ0FBQztTQUNMLENBQUMsQ0FBQztJQUNQLENBQUM7WUFBUyxDQUFDO1FBQ1AsSUFBSSxLQUFLO1lBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25DLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxLQUFLLENBQUksS0FBUTtJQUN0QixPQUFPLElBQUksQ0FBQyxLQUFL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QixFQUFFLElBQUk7cUJBQzFCO2lCQUNKO2FBQ0osQ0FBQztRQUNOLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ2xCLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxPQUFPLEtBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDdEUsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQXhkRCxnREF3ZEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUb29sRGVmaW5pdGlvbiwgVG9vbEV4ZWN1dG9yLCBUb29sUmVzcG9uc2UgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IHByb21pc2VzIGFzIGZzIH0gZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuY29uc3QgUEhZU0lDU19CQUNLRU5EUyA9IFtcbiAgICAncGh5c2ljcy1idWlsdGluJyxcbiAgICAncGh5c2ljcy1jYW5ub24nLFxuICAgICdwaHlzaWNzLWFtbW8nLFxuICAgICdwaHlzaWNzLXBoeXN4J1xuXSBhcyBjb25zdDtcblxudHlwZSBQaHlzaWNzQmFja2VuZCA9IHR5cGVvZiBQSFlTSUNTX0JBQ0tFTkRTW251bWJlcl07XG5cbmZ1bmN0aW9uIHNsZWVwKG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gd2l0aFRpbWVvdXQ8VD4ocHJvbWlzZTogUHJvbWlzZTxUPiwgdGltZW91dE1zOiBudW1iZXIsIGxhYmVsOiBzdHJpbmcpOiBQcm9taXNlPFQ+IHtcbiAgICBsZXQgdGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgICAgICAgICAgcHJvbWlzZSxcbiAgICAgICAgICAgIG5ldyBQcm9taXNlPFQ+KChfcmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlamVjdChuZXcgRXJyb3IoYCR7bGFiZWx9IHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRNc31tc2ApKSwgdGltZW91dE1zKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIF0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICAgIGlmICh0aW1lcikgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNsb25lPFQ+KHZhbHVlOiBUKTogVCB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodmFsdWUpKTtcbn1cblxuZnVuY3Rpb24gdmFsaWRGZWF0dXJlTmFtZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIHN0cmluZyB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgL15bYS16MC05XVthLXowLTktXSokLy50ZXN0KHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gYWN0aXZlQ29uZmlnKHByb2ZpbGU6IGFueSk6IGFueSB7XG4gICAgY29uc3Qga2V5ID0gcHJvZmlsZT8uZ2xvYmFsQ29uZmlnS2V5IHx8ICdkZWZhdWx0Q29uZmlnJztcbiAgICBjb25zdCBjb25maWcgPSBwcm9maWxlPy5jb25maWdzPy5ba2V5XTtcbiAgICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVuZ2luZSBmZWF0dXJlIHByb2ZpbGUgaXMgbWlzc2luZyBjb25maWdzLiR7a2V5fWApO1xuICAgIH1cbiAgICBjb25maWcuY2FjaGUgfHw9IHt9O1xuICAgIGNvbmZpZy5pbmNsdWRlTW9kdWxlcyB8fD0gW107XG4gICAgcmV0dXJuIGNvbmZpZztcbn1cblxuZnVuY3Rpb24gc25hcHNob3QocHJvZmlsZTogYW55KTogYW55IHtcbiAgICBjb25zdCBrZXkgPSBwcm9maWxlPy5nbG9iYWxDb25maWdLZXkgfHwgJ2RlZmF1bHRDb25maWcnO1xuICAgIGNvbnN0IGNvbmZpZyA9IGFjdGl2ZUNvbmZpZyhwcm9maWxlKTtcbiAgICBjb25zdCBjYWNoZSA9IGNvbmZpZy5jYWNoZSB8fCB7fTtcbiAgICByZXR1cm4ge1xuICAgICAgICBjb25maWdLZXk6IGtleSxcbiAgICAgICAgaW5jbHVkZU1vZHVsZXM6IFsuLi4oY29uZmlnLmluY2x1ZGVNb2R1bGVzIHx8IFtdKV0sXG4gICAgICAgIHBoeXNpY3NCYWNrZW5kOiBjYWNoZS5waHlzaWNzPy5fb3B0aW9uIHx8IG51bGwsXG4gICAgICAgIGVuYWJsZWQ6IE9iamVjdC5rZXlzKGNhY2hlKS5maWx0ZXIoKG5hbWUpID0+IGNhY2hlW25hbWVdPy5fdmFsdWUgPT09IHRydWUpLnNvcnQoKVxuICAgIH07XG59XG5cbmludGVyZmFjZSBBcHBsaWVkRmVhdHVyZVJlY2VpcHQge1xuICAgIGF2YWlsYWJsZTogYm9vbGVhbjtcbiAgICBmZWF0dXJlczogc3RyaW5nW107XG4gICAgaW1wb3J0TWFwU2hhMjU2OiBzdHJpbmcgfCBudWxsO1xuICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IG51bWJlciB8IG51bGw7XG4gICAgc291cmNlOiBzdHJpbmc7XG4gICAgZXJyb3I/OiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIGFwcGxpZWRTYXRpc2ZpZXMocmVjZWlwdDogQXBwbGllZEZlYXR1cmVSZWNlaXB0LCBtb2R1bGVzOiBzdHJpbmdbXSwgcGh5c2ljc0JhY2tlbmQ/OiBQaHlzaWNzQmFja2VuZCk6IGJvb2xlYW4ge1xuICAgIGlmICghcmVjZWlwdC5hdmFpbGFibGUpIHJldHVybiBmYWxzZTtcbiAgICBpZiAobW9kdWxlcy5zb21lKChuYW1lKSA9PiAhcmVjZWlwdC5mZWF0dXJlcy5pbmNsdWRlcyhuYW1lKSkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gIXBoeXNpY3NCYWNrZW5kIHx8IHJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMocGh5c2ljc0JhY2tlbmQpO1xufVxuXG5leHBvcnQgY2xhc3MgRW5naW5lRmVhdHVyZVRvb2xzIGltcGxlbWVudHMgVG9vbEV4ZWN1dG9yIHtcbiAgICBnZXRUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X2ZlYXR1cmVzJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlYWQgdGhlIGFjdGl2ZSBDb2NvcyBGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUgYW5kIHNlbGVjdGVkIHBoeXNpY3MgYmFja2VuZC4nLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdlbnN1cmVfZmVhdHVyZXMnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRW5hYmxlIHJlcXVpcmVkIEZlYXR1cmUgQ3JvcHBpbmcgbW9kdWxlcyB0aHJvdWdoIEVkaXRvci5Qcm9maWxlIGFuZCByZWJ1aWxkIHRoZSBjcm9wcGVkIGVuZ2luZS4gV2hlbiBkYXRhLnN0YXR1cyBpcyByZXN0YXJ0LXJlcXVpcmVkLCByZXN0YXJ0IHRoZSBleGFjdCBwcm9qZWN0IGZyb20gYW4gZXh0ZXJuYWwgc3VwZXJ2aXNvciBhbmQgY2FsbCBnZXRfZmVhdHVyZXMgYWdhaW47IGRhdGEuY29tcGxldGUgaXMgdHJ1ZSBvbmx5IGFmdGVyIHRoZSBhY3RpdmUgcHJldmlldyBpbXBvcnQgbWFwIGlzIHZlcmlmaWVkLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZHVsZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiAnXlthLXowLTldW2EtejAtOS1dKiQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4SXRlbXM6IDY0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IFtdXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbLi4uUEhZU0lDU19CQUNLRU5EU11cbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICByZWxvYWQ6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB0aW1lb3V0TXM6IHsgdHlwZTogJ2ludGVnZXInLCBtaW5pbXVtOiAxMDAwLCBtYXhpbXVtOiAzMDAwMDAsIGRlZmF1bHQ6IDI0MDAwMCB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIF07XG4gICAgfVxuXG4gICAgYXN5bmMgZXhlY3V0ZSh0b29sTmFtZTogc3RyaW5nLCBhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICBpZiAodG9vbE5hbWUgPT09ICdnZXRfZmVhdHVyZXMnKSByZXR1cm4gdGhpcy5nZXRGZWF0dXJlcygpO1xuICAgICAgICBpZiAodG9vbE5hbWUgPT09ICdlbnN1cmVfZmVhdHVyZXMnKSByZXR1cm4gdGhpcy5lbnN1cmVGZWF0dXJlcyhhcmdzIHx8IHt9KTtcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5rbm93biBlbmdpbmVGZWF0dXJlIHRvb2w6ICR7dG9vbE5hbWV9YCB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVhZFByb2ZpbGUoKTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XG4gICAgICAgIGlmICghcHJvZmlsZUFwaT8uZ2V0UHJvamVjdCkgdGhyb3cgbmV3IEVycm9yKCdFZGl0b3IuUHJvZmlsZS5nZXRQcm9qZWN0IGlzIHVuYXZhaWxhYmxlJyk7XG4gICAgICAgIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCBwcm9maWxlQXBpLmdldFByb2plY3QoJ2VuZ2luZScsICdtb2R1bGVzJyk7XG4gICAgICAgIGlmICghcHJvZmlsZSkgdGhyb3cgbmV3IEVycm9yKCdDb2NvcyByZXR1cm5lZCBhbiBlbXB0eSBlbmdpbmUgRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlJyk7XG4gICAgICAgIHJldHVybiBwcm9maWxlO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgZ2V0RmVhdHVyZXMoKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNuYXBzaG90KGF3YWl0IHRoaXMucmVhZFByb2ZpbGUoKSksXG4gICAgICAgICAgICAgICAgICAgIGFwcGxpZWRQcmV2aWV3OiBhd2FpdCB0aGlzLnJlYWRBcHBsaWVkUHJldmlld0ZlYXR1cmVzKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcikgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTogUHJvbWlzZTxBcHBsaWVkRmVhdHVyZVJlY2VpcHQ+IHtcbiAgICAgICAgY29uc3Qgc291cmNlID0gJ3RlbXAvcHJvZ3JhbW1pbmcvcGFja2VyLWRyaXZlci90YXJnZXRzL3ByZXZpZXcvaW1wb3J0LW1hcC5qc29uJztcbiAgICAgICAgY29uc3QgcHJvamVjdFRtcERpciA9IChFZGl0b3IgYXMgYW55KS5Qcm9qZWN0Py50bXBEaXI7XG4gICAgICAgIGlmICghcHJvamVjdFRtcERpcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBhdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGZlYXR1cmVzOiBbXSxcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBTaGEyNTY6IG51bGwsXG4gICAgICAgICAgICAgICAgaW1wb3J0TWFwTW9kaWZpZWRNczogbnVsbCxcbiAgICAgICAgICAgICAgICBzb3VyY2UsXG4gICAgICAgICAgICAgICAgZXJyb3I6ICdFZGl0b3IuUHJvamVjdC50bXBEaXIgaXMgdW5hdmFpbGFibGUnXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW1wb3J0TWFwUGF0aCA9IHBhdGguam9pbihwcm9qZWN0VG1wRGlyLCAncHJvZ3JhbW1pbmcnLCAncGFja2VyLWRyaXZlcicsICd0YXJnZXRzJywgJ3ByZXZpZXcnLCAnaW1wb3J0LW1hcC5qc29uJyk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBbcmF3LCBzdGF0XSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgICAgICBmcy5yZWFkRmlsZShpbXBvcnRNYXBQYXRoLCAndXRmOCcpLFxuICAgICAgICAgICAgICAgIGZzLnN0YXQoaW1wb3J0TWFwUGF0aClcbiAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xuICAgICAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2NvcGUgb2YgT2JqZWN0LnZhbHVlcyhwYXJzZWQ/LnNjb3BlcyB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNjb3BlIHx8IHR5cGVvZiBzY29wZSAhPT0gJ29iamVjdCcpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgT2JqZWN0LnZhbHVlcyhzY29wZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwcmVmaXggPSAnY2NlOi9pbnRlcm5hbC94L2NjLWZ1Lyc7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKHByZWZpeCkpIGZlYXR1cmVzLmFkZCh2YWx1ZS5zbGljZShwcmVmaXgubGVuZ3RoKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBhdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgICAgICAgZmVhdHVyZXM6IFsuLi5mZWF0dXJlc10uc29ydCgpLFxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHJhdykuZGlnZXN0KCdoZXgnKSxcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBNb2RpZmllZE1zOiBzdGF0Lm10aW1lTXMsXG4gICAgICAgICAgICAgICAgc291cmNlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgZmVhdHVyZXM6IFtdLFxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogbnVsbCxcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBNb2RpZmllZE1zOiBudWxsLFxuICAgICAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgdHJhbnNhY3Rpb25QYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICBjb25zdCBwcm9qZWN0VG1wRGlyID0gKEVkaXRvciBhcyBhbnkpLlByb2plY3Q/LnRtcERpcjtcbiAgICAgICAgcmV0dXJuIHByb2plY3RUbXBEaXIgPyBwYXRoLmpvaW4ocHJvamVjdFRtcERpciwgJ2NvY29zLW1jcCcsICdlbmdpbmUtZmVhdHVyZS10cmFuc2FjdGlvbi5qc29uJykgOiBudWxsO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVhZFRyYW5zYWN0aW9uKCk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy50cmFuc2FjdGlvblBhdGgoKTtcbiAgICAgICAgaWYgKCFmaWxlKSByZXR1cm4gbnVsbDtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGZzLnJlYWRGaWxlKGZpbGUsICd1dGY4JykpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyB3cml0ZVRyYW5zYWN0aW9uKHZhbHVlOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMudHJhbnNhY3Rpb25QYXRoKCk7XG4gICAgICAgIGlmICghZmlsZSkgdGhyb3cgbmV3IEVycm9yKCdFZGl0b3IuUHJvamVjdC50bXBEaXIgaXMgdW5hdmFpbGFibGUgZm9yIHRoZSBlbmdpbmUgZmVhdHVyZSB0cmFuc2FjdGlvbiByZWNlaXB0Jyk7XG4gICAgICAgIGF3YWl0IGZzLm1rZGlyKHBhdGguZGlybmFtZShmaWxlKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlLCBgJHtKU09OLnN0cmluZ2lmeSh2YWx1ZSwgbnVsbCwgMil9XFxuYCwgJ3V0ZjgnKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNsZWFyVHJhbnNhY3Rpb24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xuICAgICAgICBpZiAoZmlsZSkgYXdhaXQgZnMudW5saW5rKGZpbGUpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yQXBwbGllZEZlYXR1cmVzKFxuICAgICAgICBtb2R1bGVzOiBzdHJpbmdbXSxcbiAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IFBoeXNpY3NCYWNrZW5kIHwgdW5kZWZpbmVkLFxuICAgICAgICB0aW1lb3V0TXM6IG51bWJlclxuICAgICk6IFByb21pc2U8QXBwbGllZEZlYXR1cmVSZWNlaXB0PiB7XG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHRpbWVvdXRNcztcbiAgICAgICAgbGV0IHJlY2VpcHQgPSBhd2FpdCB0aGlzLnJlYWRBcHBsaWVkUHJldmlld0ZlYXR1cmVzKCk7XG4gICAgICAgIHdoaWxlICghYXBwbGllZFNhdGlzZmllcyhyZWNlaXB0LCBtb2R1bGVzLCBwaHlzaWNzQmFja2VuZCkgJiYgRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgICAgICAgICBhd2FpdCBzbGVlcCg1MDApO1xuICAgICAgICAgICAgcmVjZWlwdCA9IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVjZWlwdDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHJlYnVpbGRFbmdpbmVBbmRXYWl0KHRpbWVvdXRNczogbnVtYmVyKTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgY29uc3QgbWVzc2FnZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2U7XG4gICAgICAgIGxldCB2ZXJzaW9uRmlsZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGxldCB2ZXJzaW9uTXRpbWVCZWZvcmUgPSAwO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZW5naW5lSW5mbzogYW55ID0gYXdhaXQgd2l0aFRpbWVvdXQoXG4gICAgICAgICAgICAgICAgbWVzc2FnZUFwaS5yZXF1ZXN0KCdlbmdpbmUnLCAncXVlcnktaW5mbycpLFxuICAgICAgICAgICAgICAgIDEwMDAwLFxuICAgICAgICAgICAgICAgICdlbmdpbmUgaW5mbyBxdWVyeSdcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25zdCBlbmdpbmVQYXRoID0gZW5naW5lSW5mbz8ucGF0aDtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZW5naW5lUGF0aCA9PT0gJ3N0cmluZycgJiYgZW5naW5lUGF0aCkge1xuICAgICAgICAgICAgICAgIHZlcnNpb25GaWxlID0gcGF0aC5qb2luKGVuZ2luZVBhdGgsICdiaW4nLCAnLmNhY2hlJywgJ2RldicsICdWRVJTSU9OJyk7XG4gICAgICAgICAgICAgICAgdmVyc2lvbk10aW1lQmVmb3JlID0gKGF3YWl0IGZzLnN0YXQodmVyc2lvbkZpbGUpLmNhdGNoKCgpID0+IG51bGwpKT8ubXRpbWVNcyB8fCAwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFRoZSBib3VuZGVkIHByb2plY3QgbG9nIHJlY2VpcHQgYmVsb3cgcmVtYWlucyBhdmFpbGFibGUgYXMgYSBmYWxsYmFjay5cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb2plY3RQYXRoID0gKEVkaXRvciBhcyBhbnkpLlByb2plY3Q/LnBhdGg7XG4gICAgICAgIGNvbnN0IHByb2plY3RMb2cgPSBwcm9qZWN0UGF0aCA/IHBhdGguam9pbihwcm9qZWN0UGF0aCwgJ3RlbXAnLCAnbG9ncycsICdwcm9qZWN0LmxvZycpIDogbnVsbDtcbiAgICAgICAgY29uc3QgcHJvamVjdExvZ1NpemVCZWZvcmUgPSBwcm9qZWN0TG9nXG4gICAgICAgICAgICA/ICgoYXdhaXQgZnMuc3RhdChwcm9qZWN0TG9nKS5jYXRjaCgoKSA9PiBudWxsKSk/LnNpemUgfHwgMClcbiAgICAgICAgICAgIDogMDtcbiAgICAgICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgbGV0IHJlcXVlc3RTZXR0bGVkID0gZmFsc2U7XG4gICAgICAgIGxldCByZXF1ZXN0RXJyb3I6IGFueSA9IG51bGw7XG5cbiAgICAgICAgLy8gQ29jb3MgMy44LjggY2FuIGZpbmlzaCBRdWljayBDb21waWxlIGJ1dCBsZWF2ZSB0aGUgbWVzc2FnZSByZXF1ZXN0XG4gICAgICAgIC8vIHVucmVzb2x2ZWQgd2hpbGUgdGhlIGVuZ2luZSBjb25zdW1lciBpcyBiZWluZyByZXBsYWNlZC4gT2JzZXJ2ZSB0aGVcbiAgICAgICAgLy8gY29tcGlsZXIncyBvd24gVkVSU0lPTi9sb2cgcmVjZWlwdCBpbnN0ZWFkIG9mIGhhbmdpbmcgdGhlIE1DUCByZXF1ZXN0LlxuICAgICAgICB2b2lkIG1lc3NhZ2VBcGkucmVxdWVzdCgnZW5naW5lJywgJ3JlYnVpbGQnKS50aGVuKFxuICAgICAgICAgICAgKCkgPT4geyByZXF1ZXN0U2V0dGxlZCA9IHRydWU7IH0sXG4gICAgICAgICAgICAoZXJyb3I6IGFueSkgPT4geyByZXF1ZXN0U2V0dGxlZCA9IHRydWU7IHJlcXVlc3RFcnJvciA9IGVycm9yOyB9XG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3QgZGVhZGxpbmUgPSBzdGFydGVkQXQgKyB0aW1lb3V0TXM7XG4gICAgICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgICAgICAgIGlmICh2ZXJzaW9uRmlsZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmcy5zdGF0KHZlcnNpb25GaWxlKS5jYXRjaCgoKSA9PiBudWxsKTtcbiAgICAgICAgICAgICAgICBpZiAoc3RhdCAmJiBzdGF0Lm10aW1lTXMgPiB2ZXJzaW9uTXRpbWVCZWZvcmUgJiYgc3RhdC5tdGltZU1zID49IHN0YXJ0ZWRBdCAtIDEwMDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZTogJ2VuZ2luZS1jYWNoZS12ZXJzaW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXQsXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uTW9kaWZpZWRNczogc3RhdC5tdGltZU1zLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWVzdFNldHRsZWRcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChwcm9qZWN0TG9nKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbG9nID0gYXdhaXQgZnMucmVhZEZpbGUocHJvamVjdExvZyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsb2cubGVuZ3RoID4gcHJvamVjdExvZ1NpemVCZWZvcmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFwcGVuZGVkID0gbG9nLnN1YmFycmF5KHByb2plY3RMb2dTaXplQmVmb3JlKS50b1N0cmluZygndXRmOCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKC9RdWljayBDb21waWxlOlxccypcXGQrbXMvLnRlc3QoYXBwZW5kZWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tcGxldGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzb3VyY2U6ICdwcm9qZWN0LWxvZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3RTZXR0bGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICAgICAgICAvLyBLZWVwIHBvbGxpbmcgdGhlIGVuZ2luZSBWRVJTSU9OIHJlY2VpcHQgd2hlbiBhdmFpbGFibGUuXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocmVxdWVzdFNldHRsZWQgJiYgcmVxdWVzdEVycm9yKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgcmVxdWVzdEVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXdhaXQgc2xlZXAoMjUwKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvY29zIGVuZ2luZSBmZWF0dXJlIHJlYnVpbGQgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBlbnN1cmVGZWF0dXJlcyhhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVxdWVzdGVkOiB1bmtub3duW10gPSBBcnJheS5pc0FycmF5KGFyZ3MubW9kdWxlcykgPyBhcmdzLm1vZHVsZXMgOiBbXTtcbiAgICAgICAgICAgIGlmICghcmVxdWVzdGVkLmV2ZXJ5KHZhbGlkRmVhdHVyZU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnRXZlcnkgcmVxdWVzdGVkIG1vZHVsZSBtdXN0IGJlIGEgdmFsaWQgQ29jb3MgZmVhdHVyZSBuYW1lLicgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXM6IHN0cmluZ1tdID0gWy4uLm5ldyBTZXQocmVxdWVzdGVkIGFzIHN0cmluZ1tdKV07XG4gICAgICAgICAgICBjb25zdCBwaHlzaWNzQmFja2VuZCA9IGFyZ3MucGh5c2ljc0JhY2tlbmQgYXMgUGh5c2ljc0JhY2tlbmQgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAocGh5c2ljc0JhY2tlbmQgJiYgIVBIWVNJQ1NfQkFDS0VORFMuaW5jbHVkZXMocGh5c2ljc0JhY2tlbmQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgcGh5c2ljcyBiYWNrZW5kOiAke3BoeXNpY3NCYWNrZW5kfWAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgYmVmb3JlUHJvZmlsZSA9IGF3YWl0IHRoaXMucmVhZFByb2ZpbGUoKTtcbiAgICAgICAgICAgIGNvbnN0IGJlZm9yZSA9IHNuYXBzaG90KGJlZm9yZVByb2ZpbGUpO1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGNsb25lKGJlZm9yZVByb2ZpbGUpO1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYWN0aXZlQ29uZmlnKG5leHQpO1xuICAgICAgICAgICAgY29uc3QgaW5jbHVkZSA9IG5ldyBTZXQ8c3RyaW5nPihjb25maWcuaW5jbHVkZU1vZHVsZXMgfHwgW10pO1xuICAgICAgICAgICAgLy8gQSBtb2R1bGUgaXMgd3JpdGFibGUgb25seSB3aGVuIHRoZSBjdXJyZW50IENyZWF0b3IgcHJvZmlsZSBleHBvc2VzXG4gICAgICAgICAgICAvLyBpdHMgY2FjaGUgcmVjb3JkLiBpbmNsdWRlTW9kdWxlcyBpcyBzZWxlY3Rpb24gc3RhdGUsIG5vdCBhIHNjaGVtYTtcbiAgICAgICAgICAgIC8vIHRydXN0aW5nIGFuIG9ycGhhbiBpbmNsdWRlIGVudHJ5IHdvdWxkIGRlcmVmZXJlbmNlL2luc2VydCBibGluZGx5LlxuICAgICAgICAgICAgY29uc3Qga25vd25Nb2R1bGVzID0gbmV3IFNldDxzdHJpbmc+KE9iamVjdC5rZXlzKGNvbmZpZy5jYWNoZSB8fCB7fSkpO1xuICAgICAgICAgICAgY29uc3QgdW5rbm93bk1vZHVsZXMgPSBtb2R1bGVzLmZpbHRlcigobW9kdWxlTmFtZSkgPT4gIWtub3duTW9kdWxlcy5oYXMobW9kdWxlTmFtZSkpO1xuICAgICAgICAgICAgaWYgKHVua25vd25Nb2R1bGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYFJlZnVzaW5nIHRvIGFkZCB1bmtub3duIENvY29zIGVuZ2luZSBtb2R1bGVzOiAke3Vua25vd25Nb2R1bGVzLmpvaW4oJywgJyl9YCxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIHN0YXR1czogJ3Vua25vd24tZmVhdHVyZS1tb2R1bGUnLCBiZWZvcmUgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocGh5c2ljc0JhY2tlbmQgJiYgKCFrbm93bk1vZHVsZXMuaGFzKCdwaHlzaWNzJykgfHwgIWtub3duTW9kdWxlcy5oYXMocGh5c2ljc0JhY2tlbmQpKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYFBoeXNpY3MgZmVhdHVyZS9iYWNrZW5kIGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBDb2NvcyBwcm9maWxlOiBwaHlzaWNzICsgJHtwaHlzaWNzQmFja2VuZH1gLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAndW5rbm93bi1waHlzaWNzLWJhY2tlbmQnLCBiZWZvcmUgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1vZHVsZU5hbWUgb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGVbbW9kdWxlTmFtZV0uX3ZhbHVlICE9PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVttb2R1bGVOYW1lXS5fdmFsdWUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFpbmNsdWRlLmhhcyhtb2R1bGVOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICBpbmNsdWRlLmFkZChtb2R1bGVOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocGh5c2ljc0JhY2tlbmQpIHtcbiAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUucGh5c2ljcyB8fD0ge307XG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZS5waHlzaWNzLl92YWx1ZSAhPT0gdHJ1ZSB8fCBjb25maWcuY2FjaGUucGh5c2ljcy5fb3B0aW9uICE9PSBwaHlzaWNzQmFja2VuZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUucGh5c2ljcy5fdmFsdWUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUucGh5c2ljcy5fb3B0aW9uID0gcGh5c2ljc0JhY2tlbmQ7XG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgUEhZU0lDU19CQUNLRU5EUykge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWtub3duTW9kdWxlcy5oYXMoYmFja2VuZCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IGJhY2tlbmQgPT09IHBoeXNpY3NCYWNrZW5kO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmNhY2hlW2JhY2tlbmRdLl92YWx1ZSAhPT0gc2VsZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgPSBzZWxlY3RlZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgaW5jbHVkZS5hZGQoYmFja2VuZCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaW5jbHVkZS5kZWxldGUoYmFja2VuZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBvcmRlcmVkID0gWy4uLmluY2x1ZGVdLnNvcnQoKTtcbiAgICAgICAgICAgIGlmIChKU09OLnN0cmluZ2lmeShvcmRlcmVkKSAhPT0gSlNPTi5zdHJpbmdpZnkoY29uZmlnLmluY2x1ZGVNb2R1bGVzKSkgY2hhbmdlZCA9IHRydWU7XG4gICAgICAgICAgICBjb25maWcuaW5jbHVkZU1vZHVsZXMgPSBvcmRlcmVkO1xuXG4gICAgICAgICAgICBjb25zdCByZWxvYWRSZXF1ZXN0ZWQgPSBhcmdzLnJlbG9hZCAhPT0gZmFsc2U7XG4gICAgICAgICAgICBjb25zdCB0aW1lb3V0TXMgPSBNYXRoLm1pbigzMDAwMDAsIE1hdGgubWF4KDEwMDAsIE51bWJlcihhcmdzLnRpbWVvdXRNcykgfHwgMjQwMDAwKSk7XG4gICAgICAgICAgICBjb25zdCBwcm9maWxlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuUHJvZmlsZTtcblxuICAgICAgICAgICAgaWYgKGNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXByb2ZpbGVBcGk/LnNldFByb2plY3QpIHRocm93IG5ldyBFcnJvcignRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdCBpcyB1bmF2YWlsYWJsZScpO1xuICAgICAgICAgICAgICAgIGF3YWl0IHByb2ZpbGVBcGkuc2V0UHJvamVjdCgnZW5naW5lJywgJ21vZHVsZXMnLCBuZXh0KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgdmVyaWZpZWRQcm9maWxlID0gYXdhaXQgdGhpcy5yZWFkUHJvZmlsZSgpO1xuICAgICAgICAgICAgY29uc3QgYWZ0ZXIgPSBzbmFwc2hvdCh2ZXJpZmllZFByb2ZpbGUpO1xuICAgICAgICAgICAgY29uc3QgbWlzc2luZyA9IG1vZHVsZXMuZmlsdGVyKChuYW1lKSA9PiAhYWZ0ZXIuaW5jbHVkZU1vZHVsZXMuaW5jbHVkZXMobmFtZSkpO1xuICAgICAgICAgICAgaWYgKHBoeXNpY3NCYWNrZW5kICYmIGFmdGVyLnBoeXNpY3NCYWNrZW5kICE9PSBwaHlzaWNzQmFja2VuZCkge1xuICAgICAgICAgICAgICAgIG1pc3NpbmcucHVzaChgcGh5c2ljcyBiYWNrZW5kICR7cGh5c2ljc0JhY2tlbmR9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobWlzc2luZy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGZWF0dXJlIENyb3BwaW5nIHdyaXRlIGRpZCBub3QgcGVyc2lzdDogJHttaXNzaW5nLmpvaW4oJywgJyl9YCxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIGNoYW5nZWQsIGJlZm9yZSwgYWZ0ZXIgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGFwcGxpZWRCZWZvcmUgPSBhd2FpdCB0aGlzLnJlYWRBcHBsaWVkUHJldmlld0ZlYXR1cmVzKCk7XG4gICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIG1vZHVsZXM6IFsuLi5tb2R1bGVzXS5zb3J0KCksXG4gICAgICAgICAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IHBoeXNpY3NCYWNrZW5kIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaW5jbHVkZU1vZHVsZXM6IGFmdGVyLmluY2x1ZGVNb2R1bGVzLFxuICAgICAgICAgICAgICAgIGNvbmZpZ0tleTogYWZ0ZXIuY29uZmlnS2V5XG4gICAgICAgICAgICB9KSkuZGlnZXN0KCdoZXgnKTtcbiAgICAgICAgICAgIGNvbnN0IHBlbmRpbmcgPSBhd2FpdCB0aGlzLnJlYWRUcmFuc2FjdGlvbigpO1xuXG4gICAgICAgICAgICBpZiAoYXBwbGllZFNhdGlzZmllcyhhcHBsaWVkQmVmb3JlLCBtb2R1bGVzLCBwaHlzaWNzQmFja2VuZCkpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNsZWFyVHJhbnNhY3Rpb24oKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiAnRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlIGFuZCB0aGUgYWN0aXZlIHByZXZpZXcgaW1wb3J0IG1hcCBhcmUgc3luY2hyb25pemVkLicsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAndmVyaWZpZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRBZnRlcjogYXBwbGllZEJlZm9yZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiBwZW5kaW5nID8geyByZWNvdmVyZWQ6IHRydWUsIGF0dGVtcHRzOiBwZW5kaW5nLmF0dGVtcHRzIHx8IDEgfSA6IG51bGxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghcmVsb2FkUmVxdWVzdGVkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ZlYXR1cmUgQ3JvcHBpbmcgcHJvZmlsZSBpcyBwZXJzaXN0ZWQsIGJ1dCBlbmdpbmUgcmVsb2FkIHdhcyBleHBsaWNpdGx5IHNraXBwZWQuJyxcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29tcGxldGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAncHJvZmlsZS1wZXJzaXN0ZWQtcmVsb2FkLXNraXBwZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQSBDb2NvcyBwcm9jZXNzIGNhbm5vdCByZWxpYWJseSBhY2tub3dsZWRnZSB0aGUgUlBDIHRoYXQgZGVzdHJveXMgaXRzIG93blxuICAgICAgICAgICAgLy8gTUNQIHRyYW5zcG9ydC4gS2VlcCByZWxhdW5jaCBvdXRzaWRlIHRoaXMgZXh0ZW5zaW9uOiB0aGUgc2hhcmVkLWtpdFxuICAgICAgICAgICAgLy8gc3VwZXJ2aXNvciBjYW4gdmVyaWZ5IGV4YWN0IHByb2plY3QvUElEIG93bmVyc2hpcCwgcmVzdGFydCBpdCwgcmVjb25uZWN0LFxuICAgICAgICAgICAgLy8gYW5kIHRoZW4gcHJvdmUgdGhhdCB0aGUgcmVnZW5lcmF0ZWQgcHJldmlldyBpbXBvcnQgbWFwIGlzIGN1cnJlbnQuXG4gICAgICAgICAgICBjb25zdCBtYXRjaGluZ1BlbmRpbmcgPSBwZW5kaW5nPy5zaWduYXR1cmUgPT09IHNpZ25hdHVyZVxuICAgICAgICAgICAgICAgICYmIChwZW5kaW5nPy5zdGF0dXMgPT09ICdyZXN0YXJ0LXJlcXVpcmVkJyB8fCBwZW5kaW5nPy5zdGF0dXMgPT09ICdlZGl0b3ItcmVsYXVuY2gtc2NoZWR1bGVkJyk7XG4gICAgICAgICAgICBpZiAobWF0Y2hpbmdQZW5kaW5nKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ZlYXR1cmUgQ3JvcHBpbmcgaXMgcGVyc2lzdGVkIGFuZCByZWJ1aWx0LCBidXQgdGhlIGFjdGl2ZSBwcmV2aWV3IGltcG9ydCBtYXAgaXMgc3RpbGwgc3RhbGUuIFJlc3RhcnQgdGhpcyBleGFjdCBDb2NvcyBwcm9qZWN0IGV4dGVybmFsbHksIHRoZW4gY2FsbCBnZXRfZmVhdHVyZXMgYWdhaW4uJyxcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29tcGxldGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAncmVzdGFydC1yZXF1aXJlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNhY3Rpb246IHsgLi4ucGVuZGluZywgcmVjb3ZlcmVkOiB0cnVlLCBleHRlcm5hbFJlc3RhcnRSZXF1aXJlZDogdHJ1ZSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBQcm90ZWN0IHVuc2F2ZWQgc2NlbmUgd29yayBiZWZvcmUgc2NoZWR1bGluZyBhbiBFZGl0b3IgcmVsYXVuY2guXG4gICAgICAgICAgICBsZXQgc2NlbmVXYXNEaXJ0eSA9IGZhbHNlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBkaXJ0eVJlc3VsdDogYW55ID0gYXdhaXQgd2l0aFRpbWVvdXQoXG4gICAgICAgICAgICAgICAgICAgIChFZGl0b3IgYXMgYW55KS5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWRpcnR5JyksXG4gICAgICAgICAgICAgICAgICAgIDEwMDAwLFxuICAgICAgICAgICAgICAgICAgICAnc2NlbmUgZGlydHkgcXVlcnknXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBzY2VuZVdhc0RpcnR5ID0gQm9vbGVhbihkaXJ0eVJlc3VsdD8uZGlydHkgPz8gZGlydHlSZXN1bHQpO1xuICAgICAgICAgICAgICAgIGlmIChzY2VuZVdhc0RpcnR5KSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHdpdGhUaW1lb3V0KFxuICAgICAgICAgICAgICAgICAgICAgICAgKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpLFxuICAgICAgICAgICAgICAgICAgICAgICAgMzAwMDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc2NlbmUgc2F2ZSBiZWZvcmUgRWRpdG9yIHJlbGF1bmNoJ1xuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBSZWZ1c2luZyB0byByZWxhdW5jaCBDb2NvcyBFZGl0b3IgYmVjYXVzZSB0aGUgY3VycmVudCBzY2VuZSBjb3VsZCBub3QgYmUgc2FmZWx5IGNoZWNrZWQvc2F2ZWQ6ICR7ZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAnc2NlbmUtc2F2ZS1wcmVmbGlnaHQtZmFpbGVkJywgY2hhbmdlZCwgYmVmb3JlLCBhZnRlciwgYXBwbGllZEJlZm9yZSB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcmVidWlsZFN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBsZXQgZW5naW5lUmVidWlsZDogYW55O1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkID0gYXdhaXQgdGhpcy5yZWJ1aWxkRW5naW5lQW5kV2FpdCh0aW1lb3V0TXMpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYENvY29zIGNvdWxkIG5vdCByZWJ1aWxkIHRoZSBjcm9wcGVkIGVuZ2luZTogJHtlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2VuZ2luZS1yZWJ1aWxkLWZhaWxlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZE1zOiBEYXRlLm5vdygpIC0gcmVidWlsZFN0YXJ0ZWRBdFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb24gPSB7XG4gICAgICAgICAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgICAgICAgICBzaWduYXR1cmUsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAncmVzdGFydC1yZXF1aXJlZCcsXG4gICAgICAgICAgICAgICAgYXR0ZW1wdHM6IDEsXG4gICAgICAgICAgICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IHsgbW9kdWxlczogWy4uLm1vZHVsZXNdLnNvcnQoKSwgcGh5c2ljc0JhY2tlbmQ6IHBoeXNpY3NCYWNrZW5kIHx8IG51bGwgfSxcbiAgICAgICAgICAgICAgICBiZWZvcmUsXG4gICAgICAgICAgICAgICAgYWZ0ZXIsXG4gICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZSxcbiAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkLFxuICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGRNczogRGF0ZS5ub3coKSAtIHJlYnVpbGRTdGFydGVkQXQsXG4gICAgICAgICAgICAgICAgc2NlbmVXYXNEaXJ0eVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMud3JpdGVUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiAnRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlIGlzIHBlcnNpc3RlZCBhbmQgdGhlIGNyb3BwZWQgZW5naW5lIGlzIHJlYnVpbHQuIFJlc3RhcnQgdGhpcyBleGFjdCBDb2NvcyBwcm9qZWN0IGV4dGVybmFsbHksIHRoZW4gY2FsbCBnZXRfZmVhdHVyZXMgdG8gb2J0YWluIHRoZSBmaW5hbCBpbXBvcnQtbWFwIHJlY2VpcHQuJyxcbiAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAncmVzdGFydC1yZXF1aXJlZCcsXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQsXG4gICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcbiAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXG4gICAgICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzaWduYXR1cmUsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRlbXB0czogdHJhbnNhY3Rpb24uYXR0ZW1wdHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkOiB0cmFuc2FjdGlvbi5lbmdpbmVSZWJ1aWxkLFxuICAgICAgICAgICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZE1zOiB0cmFuc2FjdGlvbi5lbmdpbmVSZWJ1aWxkTXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBzY2VuZVdhc0RpcnR5LFxuICAgICAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxSZXN0YXJ0UmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWNvbm5lY3RSZXF1aXJlZDogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XG4gICAgICAgIH1cbiAgICB9XG59XG4iXX0=