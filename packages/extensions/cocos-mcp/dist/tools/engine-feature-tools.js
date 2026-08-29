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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLWZlYXR1cmUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZW5naW5lLWZlYXR1cmUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsbUNBQW9DO0FBQ3BDLDJCQUFvQztBQUNwQywyQ0FBNkI7QUFFN0IsTUFBTSxnQkFBZ0IsR0FBRztJQUNyQixpQkFBaUI7SUFDakIsZ0JBQWdCO0lBQ2hCLGNBQWM7SUFDZCxlQUFlO0NBQ1QsQ0FBQztBQUlYLFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDckIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUM7QUFFRCxLQUFLLFVBQVUsV0FBVyxDQUFJLE9BQW1CLEVBQUUsU0FBaUIsRUFBRSxLQUFhO0lBQy9FLElBQUksS0FBZ0QsQ0FBQztJQUNyRCxJQUFJLENBQUM7UUFDRCxPQUFPLE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQztZQUN0QixPQUFPO1lBQ1AsSUFBSSxPQUFPLENBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLEVBQUU7Z0JBQ2hDLEtBQUssR0FBRyxVQUFVLENBQUMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxvQkFBb0IsU0FBUyxJQUFJLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQ3RHLENBQUMsQ0FBQztTQUNMLENBQUMsQ0FBQztJQUNQLENBQUM7WUFBUyxDQUFDO1FBQ1AsSUFBSSxLQUFLO1lBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25DLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxLQUFLLENBQUksS0FBUTtJQUN0QixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQzdDLENBQUM7QUFFRCxTQUFTLGdCQUFnQixDQUFDLEtBQWM7SUFDcEMsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksc0JBQXNCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzNFLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxPQUFZOztJQUM5QixNQUFNLEdBQUcsR0FBRyxDQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxlQUFlLEtBQUksZUFBZSxDQUFDO0lBQ3hELE1BQU0sTUFBTSxHQUFHLE1BQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLE9BQU8sMENBQUcsR0FBRyxDQUFDLENBQUM7SUFDdkMsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN4QyxNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3hFLENBQUM7SUFDRCxNQUFNLENBQUMsS0FBSyxLQUFaLE1BQU0sQ0FBQyxLQUFLLEdBQUssRUFBRSxFQUFDO0lBQ3BCLE1BQU0sQ0FBQyxjQUFjLEtBQXJCLE1BQU0sQ0FBQyxjQUFjLEdBQUssRUFBRSxFQUFDO0lBQzdCLE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUM7QUFFRCxTQUFTLFFBQVEsQ0FBQyxPQUFZOztJQUMxQixNQUFNLEdBQUcsR0FBRyxDQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxlQUFlLEtBQUksZUFBZSxDQUFDO0lBQ3hELE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNyQyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQztJQUNqQyxPQUFPO1FBQ0gsU0FBUyxFQUFFLEdBQUc7UUFDZCxjQUFjLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNsRCxjQUFjLEVBQUUsQ0FBQSxNQUFBLEtBQUssQ0FBQyxPQUFPLDBDQUFFLE9BQU8sS0FBSSxJQUFJO1FBQzlDLE9BQU8sRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLFdBQUMsT0FBQSxDQUFBLE1BQUEsS0FBSyxDQUFDLElBQUksQ0FBQywwQ0FBRSxNQUFNLE1BQUssSUFBSSxDQUFBLEVBQUEsQ0FBQyxDQUFDLElBQUksRUFBRTtLQUNwRixDQUFDO0FBQ04sQ0FBQztBQVdELFNBQVMsZ0JBQWdCLENBQUMsT0FBOEIsRUFBRSxPQUFpQixFQUFFLGNBQStCO0lBQ3hHLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ3JDLElBQUksT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQzNFLE9BQU8sQ0FBQyxjQUFjLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDeEUsQ0FBQztBQUVELE1BQWEsa0JBQWtCO0lBQzNCLFFBQVE7UUFDSixPQUFPO1lBQ0g7Z0JBQ0ksSUFBSSxFQUFFLGNBQWM7Z0JBQ3BCLFdBQVcsRUFBRSw4RUFBOEU7Z0JBQzNGLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTthQUNsRDtZQUNEO2dCQUNJLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLFdBQVcsRUFBRSxzU0FBc1M7Z0JBQ25ULFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1IsT0FBTyxFQUFFOzRCQUNMLElBQUksRUFBRSxPQUFPOzRCQUNiLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLHNCQUFzQixFQUFFOzRCQUMxRCxRQUFRLEVBQUUsRUFBRTs0QkFDWixPQUFPLEVBQUUsRUFBRTt5QkFDZDt3QkFDRCxjQUFjLEVBQUU7NEJBQ1osSUFBSSxFQUFFLFFBQVE7NEJBQ2QsSUFBSSxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQzt5QkFDOUI7d0JBQ0QsTUFBTSxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO3dCQUMxQyxTQUFTLEVBQUUsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFO3FCQUNsRjtpQkFDSjthQUNKO1NBQ0osQ0FBQztJQUNOLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQWdCLEVBQUUsSUFBUztRQUNyQyxJQUFJLFFBQVEsS0FBSyxjQUFjO1lBQUUsT0FBTyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDM0QsSUFBSSxRQUFRLEtBQUssaUJBQWlCO1lBQUUsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMzRSxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsK0JBQStCLFFBQVEsRUFBRSxFQUFFLENBQUM7SUFDaEYsQ0FBQztJQUVPLEtBQUssQ0FBQyxXQUFXO1FBQ3JCLE1BQU0sVUFBVSxHQUFTLE1BQWMsQ0FBQyxPQUFPLENBQUM7UUFDaEQsSUFBSSxDQUFDLENBQUEsVUFBVSxhQUFWLFVBQVUsdUJBQVYsVUFBVSxDQUFFLFVBQVUsQ0FBQTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztRQUN6RixNQUFNLE9BQU8sR0FBRyxNQUFNLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ2pFLElBQUksQ0FBQyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsQ0FBQyxDQUFDO1FBQ3pGLE9BQU8sT0FBTyxDQUFDO0lBQ25CLENBQUM7SUFFTyxLQUFLLENBQUMsV0FBVztRQUNyQixJQUFJLENBQUM7WUFDRCxPQUFPO2dCQUNILE9BQU8sRUFBRSxJQUFJO2dCQUNiLElBQUksa0NBQ0csUUFBUSxDQUFDLE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQ3JDLGNBQWMsRUFBRSxNQUFNLElBQUksQ0FBQywwQkFBMEIsRUFBRSxHQUMxRDthQUNKLENBQUM7UUFDTixDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNsQixPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsQ0FBQSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsT0FBTyxLQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3RFLENBQUM7SUFDTCxDQUFDO0lBRU8sS0FBSyxDQUFDLDBCQUEwQjs7UUFDcEMsTUFBTSxNQUFNLEdBQUcsZ0VBQWdFLENBQUM7UUFDaEYsTUFBTSxhQUFhLEdBQUcsTUFBQyxNQUFjLENBQUMsT0FBTywwQ0FBRSxNQUFNLENBQUM7UUFDdEQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ2pCLE9BQU87Z0JBQ0gsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLGVBQWUsRUFBRSxJQUFJO2dCQUNyQixtQkFBbUIsRUFBRSxJQUFJO2dCQUN6QixNQUFNO2dCQUNOLEtBQUssRUFBRSxzQ0FBc0M7YUFDaEQsQ0FBQztRQUNOLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxhQUFhLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztRQUN4SCxJQUFJLENBQUM7WUFDRCxNQUFNLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQztnQkFDbEMsYUFBRSxDQUFDLFFBQVEsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDO2dCQUNsQyxhQUFFLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQzthQUN6QixDQUFDLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQy9CLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7WUFDbkMsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUEsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLE1BQU0sS0FBSSxFQUFFLENBQUMsRUFBRSxDQUFDO2dCQUN0RCxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7b0JBQUUsU0FBUztnQkFDbEQsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQWdDLENBQUMsRUFBRSxDQUFDO29CQUNsRSxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7d0JBQUUsU0FBUztvQkFDeEMsTUFBTSxNQUFNLEdBQUcsd0JBQXdCLENBQUM7b0JBQ3hDLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7d0JBQUUsUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO2dCQUMzRSxDQUFDO1lBQ0wsQ0FBQztZQUNELE9BQU87Z0JBQ0gsU0FBUyxFQUFFLElBQUk7Z0JBQ2YsUUFBUSxFQUFFLENBQUMsR0FBRyxRQUFRLENBQUMsQ0FBQyxJQUFJLEVBQUU7Z0JBQzlCLGVBQWUsRUFBRSxJQUFBLG1CQUFVLEVBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7Z0JBQy9ELG1CQUFtQixFQUFFLElBQUksQ0FBQyxPQUFPO2dCQUNqQyxNQUFNO2FBQ1QsQ0FBQztRQUNOLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ2xCLE9BQU87Z0JBQ0gsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLGVBQWUsRUFBRSxJQUFJO2dCQUNyQixtQkFBbUIsRUFBRSxJQUFJO2dCQUN6QixNQUFNO2dCQUNOLEtBQUssRUFBRSxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxPQUFPLEtBQUksTUFBTSxDQUFDLEtBQUssQ0FBQzthQUN6QyxDQUFDO1FBQ04sQ0FBQztJQUNMLENBQUM7SUFFTyxlQUFlOztRQUNuQixNQUFNLGFBQWEsR0FBRyxNQUFDLE1BQWMsQ0FBQyxPQUFPLDBDQUFFLE1BQU0sQ0FBQztRQUN0RCxPQUFPLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsV0FBVyxFQUFFLGlDQUFpQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUMzRyxDQUFDO0lBRU8sS0FBSyxDQUFDLGVBQWU7UUFDekIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBQ3BDLElBQUksQ0FBQyxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFDdkIsSUFBSSxDQUFDO1lBQ0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sYUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUN2RCxDQUFDO1FBQUMsV0FBTSxDQUFDO1lBQ0wsT0FBTyxJQUFJLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7SUFFTyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBVTtRQUNyQyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlGQUFpRixDQUFDLENBQUM7UUFDOUcsTUFBTSxhQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUN4RCxNQUFNLGFBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDNUUsQ0FBQztJQUVPLEtBQUssQ0FBQyxnQkFBZ0I7UUFDMUIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBQ3BDLElBQUksSUFBSTtZQUFFLE1BQU0sYUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDM0QsQ0FBQztJQUVPLEtBQUssQ0FBQyxzQkFBc0IsQ0FDaEMsT0FBaUIsRUFDakIsY0FBMEMsRUFDMUMsU0FBaUI7UUFFakIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztRQUN4QyxJQUFJLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1FBQ3RELE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLGNBQWMsQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxRQUFRLEVBQUUsQ0FBQztZQUNsRixNQUFNLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQixPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQztRQUN0RCxDQUFDO1FBQ0QsT0FBTyxPQUFPLENBQUM7SUFDbkIsQ0FBQztJQUVPLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxTQUFpQjs7UUFDaEQsTUFBTSxVQUFVLEdBQVMsTUFBYyxDQUFDLE9BQU8sQ0FBQztRQUNoRCxJQUFJLFdBQVcsR0FBa0IsSUFBSSxDQUFDO1FBQ3RDLElBQUksa0JBQWtCLEdBQUcsQ0FBQyxDQUFDO1FBQzNCLElBQUksQ0FBQztZQUNELE1BQU0sVUFBVSxHQUFRLE1BQU0sV0FBVyxDQUNyQyxVQUFVLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxZQUFZLENBQUMsRUFDMUMsS0FBSyxFQUNMLG1CQUFtQixDQUN0QixDQUFDO1lBQ0YsTUFBTSxVQUFVLEdBQUcsVUFBVSxhQUFWLFVBQVUsdUJBQVYsVUFBVSxDQUFFLElBQUksQ0FBQztZQUNwQyxJQUFJLE9BQU8sVUFBVSxLQUFLLFFBQVEsSUFBSSxVQUFVLEVBQUUsQ0FBQztnQkFDL0MsV0FBVyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFNBQVMsQ0FBQyxDQUFDO2dCQUN2RSxrQkFBa0IsR0FBRyxDQUFBLE1BQUEsQ0FBQyxNQUFNLGFBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLDBDQUFFLE9BQU8sS0FBSSxDQUFDLENBQUM7WUFDdEYsQ0FBQztRQUNMLENBQUM7UUFBQyxXQUFNLENBQUM7WUFDTCx5RUFBeUU7UUFDN0UsQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLE1BQUMsTUFBYyxDQUFDLE9BQU8sMENBQUUsSUFBSSxDQUFDO1FBQ2xELE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQzlGLE1BQU0sb0JBQW9CLEdBQUcsVUFBVTtZQUNuQyxDQUFDLENBQUMsQ0FBQyxDQUFBLE1BQUEsQ0FBQyxNQUFNLGFBQUUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLDBDQUFFLElBQUksS0FBSSxDQUFDLENBQUM7WUFDNUQsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNSLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUM3QixJQUFJLGNBQWMsR0FBRyxLQUFLLENBQUM7UUFDM0IsSUFBSSxZQUFZLEdBQVEsSUFBSSxDQUFDO1FBRTdCLHFFQUFxRTtRQUNyRSxzRUFBc0U7UUFDdEUseUVBQXlFO1FBQ3pFLEtBQUssVUFBVSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUM3QyxHQUFHLEVBQUUsR0FBRyxjQUFjLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUNoQyxDQUFDLEtBQVUsRUFBRSxFQUFFLEdBQUcsY0FBYyxHQUFHLElBQUksQ0FBQyxDQUFDLFlBQVksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQ25FLENBQUM7UUFFRixNQUFNLFFBQVEsR0FBRyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQ3ZDLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFFBQVEsRUFBRSxDQUFDO1lBQzNCLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2QsTUFBTSxJQUFJLEdBQUcsTUFBTSxhQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDMUQsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLE9BQU8sR0FBRyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLFNBQVMsR0FBRyxJQUFJLEVBQUUsQ0FBQztvQkFDaEYsT0FBTzt3QkFDSCxTQUFTLEVBQUUsSUFBSTt3QkFDZixNQUFNLEVBQUUsc0JBQXNCO3dCQUM5QixVQUFVLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVM7d0JBQ2xDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxPQUFPO3dCQUMvQixjQUFjO3FCQUNqQixDQUFDO2dCQUNOLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxVQUFVLEVBQUUsQ0FBQztnQkFDYixJQUFJLENBQUM7b0JBQ0QsTUFBTSxHQUFHLEdBQUcsTUFBTSxhQUFFLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO29CQUMxQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsb0JBQW9CLEVBQUUsQ0FBQzt3QkFDcEMsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQzt3QkFDckUsSUFBSSx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQzs0QkFDMUMsT0FBTztnQ0FDSCxTQUFTLEVBQUUsSUFBSTtnQ0FDZixNQUFNLEVBQUUsYUFBYTtnQ0FDckIsVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxTQUFTO2dDQUNsQyxjQUFjOzZCQUNqQixDQUFDO3dCQUNOLENBQUM7b0JBQ0wsQ0FBQztnQkFDTCxDQUFDO2dCQUFDLFdBQU0sQ0FBQztvQkFDTCwwREFBMEQ7Z0JBQzlELENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxjQUFjLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pDLE1BQU0sWUFBWSxDQUFDO1lBQ3ZCLENBQUM7WUFDRCxNQUFNLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNyQixDQUFDO1FBQ0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsU0FBUyxJQUFJLENBQUMsQ0FBQztJQUNuRixDQUFDO0lBRU8sS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFTOzs7UUFDbEMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxTQUFTLEdBQWMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUM3RSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3JDLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSw0REFBNEQsRUFBRSxDQUFDO1lBQ25HLENBQUM7WUFDRCxNQUFNLE9BQU8sR0FBYSxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsU0FBcUIsQ0FBQyxDQUFDLENBQUM7WUFDOUQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGNBQTRDLENBQUM7WUFDekUsSUFBSSxjQUFjLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDL0QsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLGdDQUFnQyxjQUFjLEVBQUUsRUFBRSxDQUFDO1lBQ3ZGLENBQUM7WUFFRCxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUMvQyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUM7WUFDdkMsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBQ2xDLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNsQyxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBUyxNQUFNLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQzdELHFFQUFxRTtZQUNyRSxxRUFBcUU7WUFDckUscUVBQXFFO1lBQ3JFLE1BQU0sWUFBWSxHQUFHLElBQUksR0FBRyxDQUFTLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3RFLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO1lBQ3JGLElBQUksY0FBYyxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUN4QixPQUFPO29CQUNILE9BQU8sRUFBRSxLQUFLO29CQUNkLEtBQUssRUFBRSxpREFBaUQsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtvQkFDbkYsSUFBSSxFQUFFLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsd0JBQXdCLEVBQUUsTUFBTSxFQUFFO2lCQUN0RSxDQUFDO1lBQ04sQ0FBQztZQUNELElBQUksY0FBYyxJQUFJLENBQUMsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hGLE9BQU87b0JBQ0gsT0FBTyxFQUFFLEtBQUs7b0JBQ2QsS0FBSyxFQUFFLDZFQUE2RSxjQUFjLEVBQUU7b0JBQ3BHLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLHlCQUF5QixFQUFFLE1BQU0sRUFBRTtpQkFDdkUsQ0FBQztZQUNOLENBQUM7WUFDRCxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUM7WUFFcEIsS0FBSyxNQUFNLFVBQVUsSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDL0IsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sS0FBSyxJQUFJLEVBQUUsQ0FBQztvQkFDM0MsTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO29CQUN2QyxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7b0JBQzNCLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7b0JBQ3hCLE9BQU8sR0FBRyxJQUFJLENBQUM7Z0JBQ25CLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxjQUFjLEVBQUUsQ0FBQztnQkFDakIsTUFBQSxNQUFNLENBQUMsS0FBSyxFQUFDLE9BQU8sUUFBUCxPQUFPLEdBQUssRUFBRSxFQUFDO2dCQUM1QixJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxLQUFLLGNBQWMsRUFBRSxDQUFDO29CQUMxRixNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO29CQUNuQyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsY0FBYyxDQUFDO29CQUM5QyxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELEtBQUssTUFBTSxPQUFPLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztvQkFDckMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO3dCQUFFLFNBQVM7b0JBQ3pDLE1BQU0sUUFBUSxHQUFHLE9BQU8sS0FBSyxjQUFjLENBQUM7b0JBQzVDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7d0JBQzVDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQzt3QkFDeEMsT0FBTyxHQUFHLElBQUksQ0FBQztvQkFDbkIsQ0FBQztvQkFDRCxJQUFJLFFBQVE7d0JBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7d0JBQzlCLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ2pDLENBQUM7WUFDTCxDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3BDLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUM7Z0JBQUUsT0FBTyxHQUFHLElBQUksQ0FBQztZQUN0RixNQUFNLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQztZQUVoQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLEtBQUssQ0FBQztZQUM5QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDckYsTUFBTSxVQUFVLEdBQVMsTUFBYyxDQUFDLE9BQU8sQ0FBQztZQUVoRCxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNWLElBQUksQ0FBQyxDQUFBLFVBQVUsYUFBVixVQUFVLHVCQUFWLFVBQVUsQ0FBRSxVQUFVLENBQUE7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO2dCQUN6RixNQUFNLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztZQUMzRCxDQUFDO1lBRUQsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakQsTUFBTSxLQUFLLEdBQUcsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQ3hDLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztZQUMvRSxJQUFJLGNBQWMsSUFBSSxLQUFLLENBQUMsY0FBYyxLQUFLLGNBQWMsRUFBRSxDQUFDO2dCQUM1RCxPQUFPLENBQUMsSUFBSSxDQUFDLG1CQUFtQixjQUFjLEVBQUUsQ0FBQyxDQUFDO1lBQ3RELENBQUM7WUFDRCxJQUFJLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakIsT0FBTztvQkFDSCxPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsMkNBQTJDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7b0JBQ3RFLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUU7aUJBQ3BELENBQUM7WUFDTixDQUFDO1lBRUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQztZQUM5RCxNQUFNLFNBQVMsR0FBRyxJQUFBLG1CQUFVLEVBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3pELE9BQU8sRUFBRSxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFO2dCQUM1QixjQUFjLEVBQUUsY0FBYyxJQUFJLElBQUk7Z0JBQ3RDLGNBQWMsRUFBRSxLQUFLLENBQUMsY0FBYztnQkFDcEMsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO2FBQzdCLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNsQixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUU3QyxJQUFJLGdCQUFnQixDQUFDLGFBQWEsRUFBRSxPQUFPLEVBQUUsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDM0QsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztnQkFDOUIsT0FBTztvQkFDSCxPQUFPLEVBQUUsSUFBSTtvQkFDYixPQUFPLEVBQUUsOEVBQThFO29CQUN2RixJQUFJLEVBQUU7d0JBQ0YsUUFBUSxFQUFFLElBQUk7d0JBQ2QsTUFBTSxFQUFFLFVBQVU7d0JBQ2xCLE9BQU87d0JBQ1AsTUFBTTt3QkFDTixLQUFLO3dCQUNMLGFBQWE7d0JBQ2IsWUFBWSxFQUFFLGFBQWE7d0JBQzNCLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVEsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSTtxQkFDckY7aUJBQ0osQ0FBQztZQUNOLENBQUM7WUFFRCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ25CLE9BQU87b0JBQ0gsT0FBTyxFQUFFLElBQUk7b0JBQ2IsT0FBTyxFQUFFLGtGQUFrRjtvQkFDM0YsSUFBSSxFQUFFO3dCQUNGLFFBQVEsRUFBRSxLQUFLO3dCQUNmLE1BQU0sRUFBRSxrQ0FBa0M7d0JBQzFDLE9BQU87d0JBQ1AsTUFBTTt3QkFDTixLQUFLO3dCQUNMLGFBQWE7cUJBQ2hCO2lCQUNKLENBQUM7WUFDTixDQUFDO1lBRUQsNEVBQTRFO1lBQzVFLHNFQUFzRTtZQUN0RSw0RUFBNEU7WUFDNUUscUVBQXFFO1lBQ3JFLE1BQU0sZUFBZSxHQUFHLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLFNBQVMsTUFBSyxTQUFTO21CQUNqRCxDQUFDLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLE1BQU0sTUFBSyxrQkFBa0IsSUFBSSxDQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxNQUFNLE1BQUssMkJBQTJCLENBQUMsQ0FBQztZQUNuRyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUNsQixPQUFPO29CQUNILE9BQU8sRUFBRSxJQUFJO29CQUNiLE9BQU8sRUFBRSx5S0FBeUs7b0JBQ2xMLElBQUksRUFBRTt3QkFDRixRQUFRLEVBQUUsS0FBSzt3QkFDZixNQUFNLEVBQUUsa0JBQWtCO3dCQUMxQixPQUFPO3dCQUNQLE1BQU07d0JBQ04sS0FBSzt3QkFDTCxhQUFhO3dCQUNiLFdBQVcsa0NBQU8sT0FBTyxLQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsdUJBQXVCLEVBQUUsSUFBSSxHQUFFO3FCQUM5RTtpQkFDSixDQUFDO1lBQ04sQ0FBQztZQUVELG1FQUFtRTtZQUNuRSxJQUFJLGFBQWEsR0FBRyxLQUFLLENBQUM7WUFDMUIsSUFBSSxDQUFDO2dCQUNELE1BQU0sV0FBVyxHQUFRLE1BQU0sV0FBVyxDQUNyQyxNQUFjLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLEVBQ3ZELEtBQUssRUFDTCxtQkFBbUIsQ0FDdEIsQ0FBQztnQkFDRixhQUFhLEdBQUcsT0FBTyxDQUFDLE1BQUEsV0FBVyxhQUFYLFdBQVcsdUJBQVgsV0FBVyxDQUFFLEtBQUssbUNBQUksV0FBVyxDQUFDLENBQUM7Z0JBQzNELElBQUksYUFBYSxFQUFFLENBQUM7b0JBQ2hCLE1BQU0sV0FBVyxDQUNaLE1BQWMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUMsRUFDdEQsS0FBSyxFQUNMLG1DQUFtQyxDQUN0QyxDQUFDO2dCQUNOLENBQUM7WUFDTCxDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFDbEIsT0FBTztvQkFDSCxPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsa0dBQWtHLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUU7b0JBQzFJLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLDZCQUE2QixFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBRTtpQkFDMUcsQ0FBQztZQUNOLENBQUM7WUFFRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNwQyxJQUFJLGFBQWtCLENBQUM7WUFDdkIsSUFBSSxDQUFDO2dCQUNELGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUMvRCxDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFDbEIsT0FBTztvQkFDSCxPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsK0NBQStDLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUU7b0JBQ3ZGLElBQUksRUFBRTt3QkFDRixRQUFRLEVBQUUsS0FBSzt3QkFDZixNQUFNLEVBQUUsdUJBQXVCO3dCQUMvQixPQUFPO3dCQUNQLE1BQU07d0JBQ04sS0FBSzt3QkFDTCxhQUFhO3dCQUNiLGVBQWUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsZ0JBQWdCO3FCQUNqRDtpQkFDSixDQUFDO1lBQ04sQ0FBQztZQUVELE1BQU0sV0FBVyxHQUFHO2dCQUNoQixPQUFPLEVBQUUsQ0FBQztnQkFDVixTQUFTO2dCQUNULE1BQU0sRUFBRSxrQkFBa0I7Z0JBQzFCLFFBQVEsRUFBRSxDQUFDO2dCQUNYLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtnQkFDbkMsUUFBUSxFQUFFLEVBQUUsT0FBTyxFQUFFLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxjQUFjLEVBQUUsY0FBYyxJQUFJLElBQUksRUFBRTtnQkFDbEYsTUFBTTtnQkFDTixLQUFLO2dCQUNMLGFBQWE7Z0JBQ2IsYUFBYTtnQkFDYixlQUFlLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLGdCQUFnQjtnQkFDOUMsYUFBYTthQUNoQixDQUFDO1lBQ0YsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLENBQUM7WUFFekMsT0FBTztnQkFDSCxPQUFPLEVBQUUsSUFBSTtnQkFDYixPQUFPLEVBQUUsc0xBQXNMO2dCQUMvTCxJQUFJLEVBQUU7b0JBQ0YsUUFBUSxFQUFFLEtBQUs7b0JBQ2YsTUFBTSxFQUFFLGtCQUFrQjtvQkFDMUIsT0FBTztvQkFDUCxNQUFNO29CQUNOLEtBQUs7b0JBQ0wsYUFBYTtvQkFDYixXQUFXLEVBQUU7d0JBQ1QsU0FBUzt3QkFDVCxRQUFRLEVBQUUsV0FBVyxDQUFDLFFBQVE7d0JBQzlCLGFBQWEsRUFBRSxXQUFXLENBQUMsYUFBYTt3QkFDeEMsZUFBZSxFQUFFLFdBQVcsQ0FBQyxlQUFlO3dCQUM1QyxhQUFhO3dCQUNiLHVCQUF1QixFQUFFLElBQUk7d0JBQzdCLGlCQUFpQixFQUFFLElBQUk7cUJBQzFCO2lCQUNKO2FBQ0osQ0FBQztRQUNOLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ2xCLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxPQUFPLEtBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDdEUsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQXhkRCxnREF3ZEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUb29sRGVmaW5pdGlvbiwgVG9vbEV4ZWN1dG9yLCBUb29sUmVzcG9uc2UgfSBmcm9tICcuLi90eXBlcyc7XHJcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xyXG5pbXBvcnQgeyBwcm9taXNlcyBhcyBmcyB9IGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuXHJcbmNvbnN0IFBIWVNJQ1NfQkFDS0VORFMgPSBbXHJcbiAgICAncGh5c2ljcy1idWlsdGluJyxcclxuICAgICdwaHlzaWNzLWNhbm5vbicsXHJcbiAgICAncGh5c2ljcy1hbW1vJyxcclxuICAgICdwaHlzaWNzLXBoeXN4J1xyXG5dIGFzIGNvbnN0O1xyXG5cclxudHlwZSBQaHlzaWNzQmFja2VuZCA9IHR5cGVvZiBQSFlTSUNTX0JBQ0tFTkRTW251bWJlcl07XHJcblxyXG5mdW5jdGlvbiBzbGVlcChtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gd2l0aFRpbWVvdXQ8VD4ocHJvbWlzZTogUHJvbWlzZTxUPiwgdGltZW91dE1zOiBudW1iZXIsIGxhYmVsOiBzdHJpbmcpOiBQcm9taXNlPFQ+IHtcclxuICAgIGxldCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWQ7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLnJhY2UoW1xyXG4gICAgICAgICAgICBwcm9taXNlLFxyXG4gICAgICAgICAgICBuZXcgUHJvbWlzZTxUPigoX3Jlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlamVjdChuZXcgRXJyb3IoYCR7bGFiZWx9IHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRNc31tc2ApKSwgdGltZW91dE1zKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICBdKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgaWYgKHRpbWVyKSBjbGVhclRpbWVvdXQodGltZXIpO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBjbG9uZTxUPih2YWx1ZTogVCk6IFQge1xyXG4gICAgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodmFsdWUpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRGZWF0dXJlTmFtZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIHN0cmluZyB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiAvXlthLXowLTldW2EtejAtOS1dKiQvLnRlc3QodmFsdWUpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhY3RpdmVDb25maWcocHJvZmlsZTogYW55KTogYW55IHtcclxuICAgIGNvbnN0IGtleSA9IHByb2ZpbGU/Lmdsb2JhbENvbmZpZ0tleSB8fCAnZGVmYXVsdENvbmZpZyc7XHJcbiAgICBjb25zdCBjb25maWcgPSBwcm9maWxlPy5jb25maWdzPy5ba2V5XTtcclxuICAgIGlmICghY29uZmlnIHx8IHR5cGVvZiBjb25maWcgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbmdpbmUgZmVhdHVyZSBwcm9maWxlIGlzIG1pc3NpbmcgY29uZmlncy4ke2tleX1gKTtcclxuICAgIH1cclxuICAgIGNvbmZpZy5jYWNoZSB8fD0ge307XHJcbiAgICBjb25maWcuaW5jbHVkZU1vZHVsZXMgfHw9IFtdO1xyXG4gICAgcmV0dXJuIGNvbmZpZztcclxufVxyXG5cclxuZnVuY3Rpb24gc25hcHNob3QocHJvZmlsZTogYW55KTogYW55IHtcclxuICAgIGNvbnN0IGtleSA9IHByb2ZpbGU/Lmdsb2JhbENvbmZpZ0tleSB8fCAnZGVmYXVsdENvbmZpZyc7XHJcbiAgICBjb25zdCBjb25maWcgPSBhY3RpdmVDb25maWcocHJvZmlsZSk7XHJcbiAgICBjb25zdCBjYWNoZSA9IGNvbmZpZy5jYWNoZSB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgY29uZmlnS2V5OiBrZXksXHJcbiAgICAgICAgaW5jbHVkZU1vZHVsZXM6IFsuLi4oY29uZmlnLmluY2x1ZGVNb2R1bGVzIHx8IFtdKV0sXHJcbiAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IGNhY2hlLnBoeXNpY3M/Ll9vcHRpb24gfHwgbnVsbCxcclxuICAgICAgICBlbmFibGVkOiBPYmplY3Qua2V5cyhjYWNoZSkuZmlsdGVyKChuYW1lKSA9PiBjYWNoZVtuYW1lXT8uX3ZhbHVlID09PSB0cnVlKS5zb3J0KClcclxuICAgIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBBcHBsaWVkRmVhdHVyZVJlY2VpcHQge1xyXG4gICAgYXZhaWxhYmxlOiBib29sZWFuO1xyXG4gICAgZmVhdHVyZXM6IHN0cmluZ1tdO1xyXG4gICAgaW1wb3J0TWFwU2hhMjU2OiBzdHJpbmcgfCBudWxsO1xyXG4gICAgaW1wb3J0TWFwTW9kaWZpZWRNczogbnVtYmVyIHwgbnVsbDtcclxuICAgIHNvdXJjZTogc3RyaW5nO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFwcGxpZWRTYXRpc2ZpZXMocmVjZWlwdDogQXBwbGllZEZlYXR1cmVSZWNlaXB0LCBtb2R1bGVzOiBzdHJpbmdbXSwgcGh5c2ljc0JhY2tlbmQ/OiBQaHlzaWNzQmFja2VuZCk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKCFyZWNlaXB0LmF2YWlsYWJsZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKG1vZHVsZXMuc29tZSgobmFtZSkgPT4gIXJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMobmFtZSkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gIXBoeXNpY3NCYWNrZW5kIHx8IHJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMocGh5c2ljc0JhY2tlbmQpO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgRW5naW5lRmVhdHVyZVRvb2xzIGltcGxlbWVudHMgVG9vbEV4ZWN1dG9yIHtcclxuICAgIGdldFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdnZXRfZmVhdHVyZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZWFkIHRoZSBhY3RpdmUgQ29jb3MgRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlIGFuZCBzZWxlY3RlZCBwaHlzaWNzIGJhY2tlbmQuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdlbnN1cmVfZmVhdHVyZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdFbmFibGUgcmVxdWlyZWQgRmVhdHVyZSBDcm9wcGluZyBtb2R1bGVzIHRocm91Z2ggRWRpdG9yLlByb2ZpbGUgYW5kIHJlYnVpbGQgdGhlIGNyb3BwZWQgZW5naW5lLiBXaGVuIGRhdGEuc3RhdHVzIGlzIHJlc3RhcnQtcmVxdWlyZWQsIHJlc3RhcnQgdGhlIGV4YWN0IHByb2plY3QgZnJvbSBhbiBleHRlcm5hbCBzdXBlcnZpc29yIGFuZCBjYWxsIGdldF9mZWF0dXJlcyBhZ2FpbjsgZGF0YS5jb21wbGV0ZSBpcyB0cnVlIG9ubHkgYWZ0ZXIgdGhlIGFjdGl2ZSBwcmV2aWV3IGltcG9ydCBtYXAgaXMgdmVyaWZpZWQuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2R1bGVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycsIHBhdHRlcm46ICdeW2EtejAtOV1bYS16MC05LV0qJCcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heEl0ZW1zOiA2NCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IFtdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVudW06IFsuLi5QSFlTSUNTX0JBQ0tFTkRTXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWxvYWQ6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiB0cnVlIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVvdXRNczogeyB0eXBlOiAnaW50ZWdlcicsIG1pbmltdW06IDEwMDAsIG1heGltdW06IDMwMDAwMCwgZGVmYXVsdDogMjQwMDAwIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGV4ZWN1dGUodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICBpZiAodG9vbE5hbWUgPT09ICdnZXRfZmVhdHVyZXMnKSByZXR1cm4gdGhpcy5nZXRGZWF0dXJlcygpO1xyXG4gICAgICAgIGlmICh0b29sTmFtZSA9PT0gJ2Vuc3VyZV9mZWF0dXJlcycpIHJldHVybiB0aGlzLmVuc3VyZUZlYXR1cmVzKGFyZ3MgfHwge30pO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFVua25vd24gZW5naW5lRmVhdHVyZSB0b29sOiAke3Rvb2xOYW1lfWAgfTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHJlYWRQcm9maWxlKCk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XHJcbiAgICAgICAgaWYgKCFwcm9maWxlQXBpPy5nZXRQcm9qZWN0KSB0aHJvdyBuZXcgRXJyb3IoJ0VkaXRvci5Qcm9maWxlLmdldFByb2plY3QgaXMgdW5hdmFpbGFibGUnKTtcclxuICAgICAgICBjb25zdCBwcm9maWxlID0gYXdhaXQgcHJvZmlsZUFwaS5nZXRQcm9qZWN0KCdlbmdpbmUnLCAnbW9kdWxlcycpO1xyXG4gICAgICAgIGlmICghcHJvZmlsZSkgdGhyb3cgbmV3IEVycm9yKCdDb2NvcyByZXR1cm5lZCBhbiBlbXB0eSBlbmdpbmUgRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlJyk7XHJcbiAgICAgICAgcmV0dXJuIHByb2ZpbGU7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBnZXRGZWF0dXJlcygpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLnNuYXBzaG90KGF3YWl0IHRoaXMucmVhZFByb2ZpbGUoKSksXHJcbiAgICAgICAgICAgICAgICAgICAgYXBwbGllZFByZXZpZXc6IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTogUHJvbWlzZTxBcHBsaWVkRmVhdHVyZVJlY2VpcHQ+IHtcclxuICAgICAgICBjb25zdCBzb3VyY2UgPSAndGVtcC9wcm9ncmFtbWluZy9wYWNrZXItZHJpdmVyL3RhcmdldHMvcHJldmlldy9pbXBvcnQtbWFwLmpzb24nO1xyXG4gICAgICAgIGNvbnN0IHByb2plY3RUbXBEaXIgPSAoRWRpdG9yIGFzIGFueSkuUHJvamVjdD8udG1wRGlyO1xyXG4gICAgICAgIGlmICghcHJvamVjdFRtcERpcikge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVzOiBbXSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogbnVsbCxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBzb3VyY2UsXHJcbiAgICAgICAgICAgICAgICBlcnJvcjogJ0VkaXRvci5Qcm9qZWN0LnRtcERpciBpcyB1bmF2YWlsYWJsZSdcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGltcG9ydE1hcFBhdGggPSBwYXRoLmpvaW4ocHJvamVjdFRtcERpciwgJ3Byb2dyYW1taW5nJywgJ3BhY2tlci1kcml2ZXInLCAndGFyZ2V0cycsICdwcmV2aWV3JywgJ2ltcG9ydC1tYXAuanNvbicpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IFtyYXcsIHN0YXRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICAgICAgICAgICAgZnMucmVhZEZpbGUoaW1wb3J0TWFwUGF0aCwgJ3V0ZjgnKSxcclxuICAgICAgICAgICAgICAgIGZzLnN0YXQoaW1wb3J0TWFwUGF0aClcclxuICAgICAgICAgICAgXSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcclxuICAgICAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBzY29wZSBvZiBPYmplY3QudmFsdWVzKHBhcnNlZD8uc2NvcGVzIHx8IHt9KSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzY29wZSB8fCB0eXBlb2Ygc2NvcGUgIT09ICdvYmplY3QnKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgT2JqZWN0LnZhbHVlcyhzY29wZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJlZml4ID0gJ2NjZTovaW50ZXJuYWwveC9jYy1mdS8nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKHByZWZpeCkpIGZlYXR1cmVzLmFkZCh2YWx1ZS5zbGljZShwcmVmaXgubGVuZ3RoKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVzOiBbLi4uZmVhdHVyZXNdLnNvcnQoKSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHJhdykuZGlnZXN0KCdoZXgnKSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IHN0YXQubXRpbWVNcyxcclxuICAgICAgICAgICAgICAgIHNvdXJjZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlczogW10sXHJcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBTaGEyNTY6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBNb2RpZmllZE1zOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgc291cmNlLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcilcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB0cmFuc2FjdGlvblBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdFRtcERpciA9IChFZGl0b3IgYXMgYW55KS5Qcm9qZWN0Py50bXBEaXI7XHJcbiAgICAgICAgcmV0dXJuIHByb2plY3RUbXBEaXIgPyBwYXRoLmpvaW4ocHJvamVjdFRtcERpciwgJ2NvY29zLW1jcCcsICdlbmdpbmUtZmVhdHVyZS10cmFuc2FjdGlvbi5qc29uJykgOiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcmVhZFRyYW5zYWN0aW9uKCk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xyXG4gICAgICAgIGlmICghZmlsZSkgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYXdhaXQgZnMucmVhZEZpbGUoZmlsZSwgJ3V0ZjgnKSk7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHdyaXRlVHJhbnNhY3Rpb24odmFsdWU6IGFueSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xyXG4gICAgICAgIGlmICghZmlsZSkgdGhyb3cgbmV3IEVycm9yKCdFZGl0b3IuUHJvamVjdC50bXBEaXIgaXMgdW5hdmFpbGFibGUgZm9yIHRoZSBlbmdpbmUgZmVhdHVyZSB0cmFuc2FjdGlvbiByZWNlaXB0Jyk7XHJcbiAgICAgICAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJuYW1lKGZpbGUpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZSwgYCR7SlNPTi5zdHJpbmdpZnkodmFsdWUsIG51bGwsIDIpfVxcbmAsICd1dGY4Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBjbGVhclRyYW5zYWN0aW9uKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xyXG4gICAgICAgIGlmIChmaWxlKSBhd2FpdCBmcy51bmxpbmsoZmlsZSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JBcHBsaWVkRmVhdHVyZXMoXHJcbiAgICAgICAgbW9kdWxlczogc3RyaW5nW10sXHJcbiAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IFBoeXNpY3NCYWNrZW5kIHwgdW5kZWZpbmVkLFxyXG4gICAgICAgIHRpbWVvdXRNczogbnVtYmVyXHJcbiAgICApOiBQcm9taXNlPEFwcGxpZWRGZWF0dXJlUmVjZWlwdD4ge1xyXG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHRpbWVvdXRNcztcclxuICAgICAgICBsZXQgcmVjZWlwdCA9IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTtcclxuICAgICAgICB3aGlsZSAoIWFwcGxpZWRTYXRpc2ZpZXMocmVjZWlwdCwgbW9kdWxlcywgcGh5c2ljc0JhY2tlbmQpICYmIERhdGUubm93KCkgPCBkZWFkbGluZSkge1xyXG4gICAgICAgICAgICBhd2FpdCBzbGVlcCg1MDApO1xyXG4gICAgICAgICAgICByZWNlaXB0ID0gYXdhaXQgdGhpcy5yZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcmVjZWlwdDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHJlYnVpbGRFbmdpbmVBbmRXYWl0KHRpbWVvdXRNczogbnVtYmVyKTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBjb25zdCBtZXNzYWdlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZTtcclxuICAgICAgICBsZXQgdmVyc2lvbkZpbGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xyXG4gICAgICAgIGxldCB2ZXJzaW9uTXRpbWVCZWZvcmUgPSAwO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVuZ2luZUluZm86IGFueSA9IGF3YWl0IHdpdGhUaW1lb3V0KFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZUFwaS5yZXF1ZXN0KCdlbmdpbmUnLCAncXVlcnktaW5mbycpLFxyXG4gICAgICAgICAgICAgICAgMTAwMDAsXHJcbiAgICAgICAgICAgICAgICAnZW5naW5lIGluZm8gcXVlcnknXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIGNvbnN0IGVuZ2luZVBhdGggPSBlbmdpbmVJbmZvPy5wYXRoO1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIGVuZ2luZVBhdGggPT09ICdzdHJpbmcnICYmIGVuZ2luZVBhdGgpIHtcclxuICAgICAgICAgICAgICAgIHZlcnNpb25GaWxlID0gcGF0aC5qb2luKGVuZ2luZVBhdGgsICdiaW4nLCAnLmNhY2hlJywgJ2RldicsICdWRVJTSU9OJyk7XHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uTXRpbWVCZWZvcmUgPSAoYXdhaXQgZnMuc3RhdCh2ZXJzaW9uRmlsZSkuY2F0Y2goKCkgPT4gbnVsbCkpPy5tdGltZU1zIHx8IDA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgLy8gVGhlIGJvdW5kZWQgcHJvamVjdCBsb2cgcmVjZWlwdCBiZWxvdyByZW1haW5zIGF2YWlsYWJsZSBhcyBhIGZhbGxiYWNrLlxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgcHJvamVjdFBhdGggPSAoRWRpdG9yIGFzIGFueSkuUHJvamVjdD8ucGF0aDtcclxuICAgICAgICBjb25zdCBwcm9qZWN0TG9nID0gcHJvamVjdFBhdGggPyBwYXRoLmpvaW4ocHJvamVjdFBhdGgsICd0ZW1wJywgJ2xvZ3MnLCAncHJvamVjdC5sb2cnKSA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdExvZ1NpemVCZWZvcmUgPSBwcm9qZWN0TG9nXHJcbiAgICAgICAgICAgID8gKChhd2FpdCBmcy5zdGF0KHByb2plY3RMb2cpLmNhdGNoKCgpID0+IG51bGwpKT8uc2l6ZSB8fCAwKVxyXG4gICAgICAgICAgICA6IDA7XHJcbiAgICAgICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICBsZXQgcmVxdWVzdFNldHRsZWQgPSBmYWxzZTtcclxuICAgICAgICBsZXQgcmVxdWVzdEVycm9yOiBhbnkgPSBudWxsO1xyXG5cclxuICAgICAgICAvLyBDb2NvcyAzLjguOCBjYW4gZmluaXNoIFF1aWNrIENvbXBpbGUgYnV0IGxlYXZlIHRoZSBtZXNzYWdlIHJlcXVlc3RcclxuICAgICAgICAvLyB1bnJlc29sdmVkIHdoaWxlIHRoZSBlbmdpbmUgY29uc3VtZXIgaXMgYmVpbmcgcmVwbGFjZWQuIE9ic2VydmUgdGhlXHJcbiAgICAgICAgLy8gY29tcGlsZXIncyBvd24gVkVSU0lPTi9sb2cgcmVjZWlwdCBpbnN0ZWFkIG9mIGhhbmdpbmcgdGhlIE1DUCByZXF1ZXN0LlxyXG4gICAgICAgIHZvaWQgbWVzc2FnZUFwaS5yZXF1ZXN0KCdlbmdpbmUnLCAncmVidWlsZCcpLnRoZW4oXHJcbiAgICAgICAgICAgICgpID0+IHsgcmVxdWVzdFNldHRsZWQgPSB0cnVlOyB9LFxyXG4gICAgICAgICAgICAoZXJyb3I6IGFueSkgPT4geyByZXF1ZXN0U2V0dGxlZCA9IHRydWU7IHJlcXVlc3RFcnJvciA9IGVycm9yOyB9XHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgY29uc3QgZGVhZGxpbmUgPSBzdGFydGVkQXQgKyB0aW1lb3V0TXM7XHJcbiAgICAgICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xyXG4gICAgICAgICAgICBpZiAodmVyc2lvbkZpbGUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmcy5zdGF0KHZlcnNpb25GaWxlKS5jYXRjaCgoKSA9PiBudWxsKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdGF0ICYmIHN0YXQubXRpbWVNcyA+IHZlcnNpb25NdGltZUJlZm9yZSAmJiBzdGF0Lm10aW1lTXMgPj0gc3RhcnRlZEF0IC0gMTAwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiAnZW5naW5lLWNhY2hlLXZlcnNpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uTW9kaWZpZWRNczogc3RhdC5tdGltZU1zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXF1ZXN0U2V0dGxlZFxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChwcm9qZWN0TG9nKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxvZyA9IGF3YWl0IGZzLnJlYWRGaWxlKHByb2plY3RMb2cpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsb2cubGVuZ3RoID4gcHJvamVjdExvZ1NpemVCZWZvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYXBwZW5kZWQgPSBsb2cuc3ViYXJyYXkocHJvamVjdExvZ1NpemVCZWZvcmUpLnRvU3RyaW5nKCd1dGY4Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgvUXVpY2sgQ29tcGlsZTpcXHMqXFxkK21zLy50ZXN0KGFwcGVuZGVkKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiAncHJvamVjdC1sb2cnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWVzdFNldHRsZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBLZWVwIHBvbGxpbmcgdGhlIGVuZ2luZSBWRVJTSU9OIHJlY2VpcHQgd2hlbiBhdmFpbGFibGUuXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChyZXF1ZXN0U2V0dGxlZCAmJiByZXF1ZXN0RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IHJlcXVlc3RFcnJvcjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBhd2FpdCBzbGVlcCgyNTApO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvY29zIGVuZ2luZSBmZWF0dXJlIHJlYnVpbGQgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBlbnN1cmVGZWF0dXJlcyhhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlcXVlc3RlZDogdW5rbm93bltdID0gQXJyYXkuaXNBcnJheShhcmdzLm1vZHVsZXMpID8gYXJncy5tb2R1bGVzIDogW107XHJcbiAgICAgICAgICAgIGlmICghcmVxdWVzdGVkLmV2ZXJ5KHZhbGlkRmVhdHVyZU5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdFdmVyeSByZXF1ZXN0ZWQgbW9kdWxlIG11c3QgYmUgYSB2YWxpZCBDb2NvcyBmZWF0dXJlIG5hbWUuJyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXM6IHN0cmluZ1tdID0gWy4uLm5ldyBTZXQocmVxdWVzdGVkIGFzIHN0cmluZ1tdKV07XHJcbiAgICAgICAgICAgIGNvbnN0IHBoeXNpY3NCYWNrZW5kID0gYXJncy5waHlzaWNzQmFja2VuZCBhcyBQaHlzaWNzQmFja2VuZCB8IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgaWYgKHBoeXNpY3NCYWNrZW5kICYmICFQSFlTSUNTX0JBQ0tFTkRTLmluY2x1ZGVzKHBoeXNpY3NCYWNrZW5kKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgcGh5c2ljcyBiYWNrZW5kOiAke3BoeXNpY3NCYWNrZW5kfWAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgYmVmb3JlUHJvZmlsZSA9IGF3YWl0IHRoaXMucmVhZFByb2ZpbGUoKTtcclxuICAgICAgICAgICAgY29uc3QgYmVmb3JlID0gc25hcHNob3QoYmVmb3JlUHJvZmlsZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBjbG9uZShiZWZvcmVQcm9maWxlKTtcclxuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYWN0aXZlQ29uZmlnKG5leHQpO1xyXG4gICAgICAgICAgICBjb25zdCBpbmNsdWRlID0gbmV3IFNldDxzdHJpbmc+KGNvbmZpZy5pbmNsdWRlTW9kdWxlcyB8fCBbXSk7XHJcbiAgICAgICAgICAgIC8vIEEgbW9kdWxlIGlzIHdyaXRhYmxlIG9ubHkgd2hlbiB0aGUgY3VycmVudCBDcmVhdG9yIHByb2ZpbGUgZXhwb3Nlc1xyXG4gICAgICAgICAgICAvLyBpdHMgY2FjaGUgcmVjb3JkLiBpbmNsdWRlTW9kdWxlcyBpcyBzZWxlY3Rpb24gc3RhdGUsIG5vdCBhIHNjaGVtYTtcclxuICAgICAgICAgICAgLy8gdHJ1c3RpbmcgYW4gb3JwaGFuIGluY2x1ZGUgZW50cnkgd291bGQgZGVyZWZlcmVuY2UvaW5zZXJ0IGJsaW5kbHkuXHJcbiAgICAgICAgICAgIGNvbnN0IGtub3duTW9kdWxlcyA9IG5ldyBTZXQ8c3RyaW5nPihPYmplY3Qua2V5cyhjb25maWcuY2FjaGUgfHwge30pKTtcclxuICAgICAgICAgICAgY29uc3QgdW5rbm93bk1vZHVsZXMgPSBtb2R1bGVzLmZpbHRlcigobW9kdWxlTmFtZSkgPT4gIWtub3duTW9kdWxlcy5oYXMobW9kdWxlTmFtZSkpO1xyXG4gICAgICAgICAgICBpZiAodW5rbm93bk1vZHVsZXMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgUmVmdXNpbmcgdG8gYWRkIHVua25vd24gQ29jb3MgZW5naW5lIG1vZHVsZXM6ICR7dW5rbm93bk1vZHVsZXMuam9pbignLCAnKX1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHsgY29tcGxldGU6IGZhbHNlLCBzdGF0dXM6ICd1bmtub3duLWZlYXR1cmUtbW9kdWxlJywgYmVmb3JlIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHBoeXNpY3NCYWNrZW5kICYmICgha25vd25Nb2R1bGVzLmhhcygncGh5c2ljcycpIHx8ICFrbm93bk1vZHVsZXMuaGFzKHBoeXNpY3NCYWNrZW5kKSkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBQaHlzaWNzIGZlYXR1cmUvYmFja2VuZCBpcyBub3QgYXZhaWxhYmxlIGluIHRoaXMgQ29jb3MgcHJvZmlsZTogcGh5c2ljcyArICR7cGh5c2ljc0JhY2tlbmR9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAndW5rbm93bi1waHlzaWNzLWJhY2tlbmQnLCBiZWZvcmUgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xyXG5cclxuICAgICAgICAgICAgZm9yIChjb25zdCBtb2R1bGVOYW1lIG9mIG1vZHVsZXMpIHtcclxuICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGVbbW9kdWxlTmFtZV0uX3ZhbHVlICE9PSB0cnVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlW21vZHVsZU5hbWVdLl92YWx1ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoIWluY2x1ZGUuaGFzKG1vZHVsZU5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5jbHVkZS5hZGQobW9kdWxlTmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlLnBoeXNpY3MgfHw9IHt9O1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZS5waHlzaWNzLl92YWx1ZSAhPT0gdHJ1ZSB8fCBjb25maWcuY2FjaGUucGh5c2ljcy5fb3B0aW9uICE9PSBwaHlzaWNzQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZS5waHlzaWNzLl92YWx1ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlLnBoeXNpY3MuX29wdGlvbiA9IHBoeXNpY3NCYWNrZW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIFBIWVNJQ1NfQkFDS0VORFMpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWtub3duTW9kdWxlcy5oYXMoYmFja2VuZCkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gYmFja2VuZCA9PT0gcGh5c2ljc0JhY2tlbmQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgIT09IHNlbGVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgPSBzZWxlY3RlZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgaW5jbHVkZS5hZGQoYmFja2VuZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpbmNsdWRlLmRlbGV0ZShiYWNrZW5kKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3Qgb3JkZXJlZCA9IFsuLi5pbmNsdWRlXS5zb3J0KCk7XHJcbiAgICAgICAgICAgIGlmIChKU09OLnN0cmluZ2lmeShvcmRlcmVkKSAhPT0gSlNPTi5zdHJpbmdpZnkoY29uZmlnLmluY2x1ZGVNb2R1bGVzKSkgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIGNvbmZpZy5pbmNsdWRlTW9kdWxlcyA9IG9yZGVyZWQ7XHJcblxyXG4gICAgICAgICAgICBjb25zdCByZWxvYWRSZXF1ZXN0ZWQgPSBhcmdzLnJlbG9hZCAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVvdXRNcyA9IE1hdGgubWluKDMwMDAwMCwgTWF0aC5tYXgoMTAwMCwgTnVtYmVyKGFyZ3MudGltZW91dE1zKSB8fCAyNDAwMDApKTtcclxuICAgICAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XHJcblxyXG4gICAgICAgICAgICBpZiAoY2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFwcm9maWxlQXBpPy5zZXRQcm9qZWN0KSB0aHJvdyBuZXcgRXJyb3IoJ0VkaXRvci5Qcm9maWxlLnNldFByb2plY3QgaXMgdW5hdmFpbGFibGUnKTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHByb2ZpbGVBcGkuc2V0UHJvamVjdCgnZW5naW5lJywgJ21vZHVsZXMnLCBuZXh0KTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgdmVyaWZpZWRQcm9maWxlID0gYXdhaXQgdGhpcy5yZWFkUHJvZmlsZSgpO1xyXG4gICAgICAgICAgICBjb25zdCBhZnRlciA9IHNuYXBzaG90KHZlcmlmaWVkUHJvZmlsZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1pc3NpbmcgPSBtb2R1bGVzLmZpbHRlcigobmFtZSkgPT4gIWFmdGVyLmluY2x1ZGVNb2R1bGVzLmluY2x1ZGVzKG5hbWUpKTtcclxuICAgICAgICAgICAgaWYgKHBoeXNpY3NCYWNrZW5kICYmIGFmdGVyLnBoeXNpY3NCYWNrZW5kICE9PSBwaHlzaWNzQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgbWlzc2luZy5wdXNoKGBwaHlzaWNzIGJhY2tlbmQgJHtwaHlzaWNzQmFja2VuZH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWlzc2luZy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGZWF0dXJlIENyb3BwaW5nIHdyaXRlIGRpZCBub3QgcGVyc2lzdDogJHttaXNzaW5nLmpvaW4oJywgJyl9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgY2hhbmdlZCwgYmVmb3JlLCBhZnRlciB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBhcHBsaWVkQmVmb3JlID0gYXdhaXQgdGhpcy5yZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpO1xyXG4gICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICAgICAgbW9kdWxlczogWy4uLm1vZHVsZXNdLnNvcnQoKSxcclxuICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kOiBwaHlzaWNzQmFja2VuZCB8fCBudWxsLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZU1vZHVsZXM6IGFmdGVyLmluY2x1ZGVNb2R1bGVzLFxyXG4gICAgICAgICAgICAgICAgY29uZmlnS2V5OiBhZnRlci5jb25maWdLZXlcclxuICAgICAgICAgICAgfSkpLmRpZ2VzdCgnaGV4Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBlbmRpbmcgPSBhd2FpdCB0aGlzLnJlYWRUcmFuc2FjdGlvbigpO1xyXG5cclxuICAgICAgICAgICAgaWYgKGFwcGxpZWRTYXRpc2ZpZXMoYXBwbGllZEJlZm9yZSwgbW9kdWxlcywgcGh5c2ljc0JhY2tlbmQpKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNsZWFyVHJhbnNhY3Rpb24oKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiAnRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlIGFuZCB0aGUgYWN0aXZlIHByZXZpZXcgaW1wb3J0IG1hcCBhcmUgc3luY2hyb25pemVkLicsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAndmVyaWZpZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQWZ0ZXI6IGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiBwZW5kaW5nID8geyByZWNvdmVyZWQ6IHRydWUsIGF0dGVtcHRzOiBwZW5kaW5nLmF0dGVtcHRzIHx8IDEgfSA6IG51bGxcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoIXJlbG9hZFJlcXVlc3RlZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUgaXMgcGVyc2lzdGVkLCBidXQgZW5naW5lIHJlbG9hZCB3YXMgZXhwbGljaXRseSBza2lwcGVkLicsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ3Byb2ZpbGUtcGVyc2lzdGVkLXJlbG9hZC1za2lwcGVkJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEEgQ29jb3MgcHJvY2VzcyBjYW5ub3QgcmVsaWFibHkgYWNrbm93bGVkZ2UgdGhlIFJQQyB0aGF0IGRlc3Ryb3lzIGl0cyBvd25cclxuICAgICAgICAgICAgLy8gTUNQIHRyYW5zcG9ydC4gS2VlcCByZWxhdW5jaCBvdXRzaWRlIHRoaXMgZXh0ZW5zaW9uOiB0aGUgc2hhcmVkLWtpdFxyXG4gICAgICAgICAgICAvLyBzdXBlcnZpc29yIGNhbiB2ZXJpZnkgZXhhY3QgcHJvamVjdC9QSUQgb3duZXJzaGlwLCByZXN0YXJ0IGl0LCByZWNvbm5lY3QsXHJcbiAgICAgICAgICAgIC8vIGFuZCB0aGVuIHByb3ZlIHRoYXQgdGhlIHJlZ2VuZXJhdGVkIHByZXZpZXcgaW1wb3J0IG1hcCBpcyBjdXJyZW50LlxyXG4gICAgICAgICAgICBjb25zdCBtYXRjaGluZ1BlbmRpbmcgPSBwZW5kaW5nPy5zaWduYXR1cmUgPT09IHNpZ25hdHVyZVxyXG4gICAgICAgICAgICAgICAgJiYgKHBlbmRpbmc/LnN0YXR1cyA9PT0gJ3Jlc3RhcnQtcmVxdWlyZWQnIHx8IHBlbmRpbmc/LnN0YXR1cyA9PT0gJ2VkaXRvci1yZWxhdW5jaC1zY2hlZHVsZWQnKTtcclxuICAgICAgICAgICAgaWYgKG1hdGNoaW5nUGVuZGluZykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdGZWF0dXJlIENyb3BwaW5nIGlzIHBlcnNpc3RlZCBhbmQgcmVidWlsdCwgYnV0IHRoZSBhY3RpdmUgcHJldmlldyBpbXBvcnQgbWFwIGlzIHN0aWxsIHN0YWxlLiBSZXN0YXJ0IHRoaXMgZXhhY3QgQ29jb3MgcHJvamVjdCBleHRlcm5hbGx5LCB0aGVuIGNhbGwgZ2V0X2ZlYXR1cmVzIGFnYWluLicsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ3Jlc3RhcnQtcmVxdWlyZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2FjdGlvbjogeyAuLi5wZW5kaW5nLCByZWNvdmVyZWQ6IHRydWUsIGV4dGVybmFsUmVzdGFydFJlcXVpcmVkOiB0cnVlIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBQcm90ZWN0IHVuc2F2ZWQgc2NlbmUgd29yayBiZWZvcmUgc2NoZWR1bGluZyBhbiBFZGl0b3IgcmVsYXVuY2guXHJcbiAgICAgICAgICAgIGxldCBzY2VuZVdhc0RpcnR5ID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXJ0eVJlc3VsdDogYW55ID0gYXdhaXQgd2l0aFRpbWVvdXQoXHJcbiAgICAgICAgICAgICAgICAgICAgKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktZGlydHknKSxcclxuICAgICAgICAgICAgICAgICAgICAxMDAwMCxcclxuICAgICAgICAgICAgICAgICAgICAnc2NlbmUgZGlydHkgcXVlcnknXHJcbiAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgc2NlbmVXYXNEaXJ0eSA9IEJvb2xlYW4oZGlydHlSZXN1bHQ/LmRpcnR5ID8/IGRpcnR5UmVzdWx0KTtcclxuICAgICAgICAgICAgICAgIGlmIChzY2VuZVdhc0RpcnR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgd2l0aFRpbWVvdXQoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIChFZGl0b3IgYXMgYW55KS5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NhdmUtc2NlbmUnKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgMzAwMDAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdzY2VuZSBzYXZlIGJlZm9yZSBFZGl0b3IgcmVsYXVuY2gnXHJcbiAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYFJlZnVzaW5nIHRvIHJlbGF1bmNoIENvY29zIEVkaXRvciBiZWNhdXNlIHRoZSBjdXJyZW50IHNjZW5lIGNvdWxkIG5vdCBiZSBzYWZlbHkgY2hlY2tlZC9zYXZlZDogJHtlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIHN0YXR1czogJ3NjZW5lLXNhdmUtcHJlZmxpZ2h0LWZhaWxlZCcsIGNoYW5nZWQsIGJlZm9yZSwgYWZ0ZXIsIGFwcGxpZWRCZWZvcmUgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgcmVidWlsZFN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgIGxldCBlbmdpbmVSZWJ1aWxkOiBhbnk7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkID0gYXdhaXQgdGhpcy5yZWJ1aWxkRW5naW5lQW5kV2FpdCh0aW1lb3V0TXMpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgQ29jb3MgY291bGQgbm90IHJlYnVpbGQgdGhlIGNyb3BwZWQgZW5naW5lOiAke2Vycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcil9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnZW5naW5lLXJlYnVpbGQtZmFpbGVkJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZE1zOiBEYXRlLm5vdygpIC0gcmVidWlsZFN0YXJ0ZWRBdFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uID0ge1xyXG4gICAgICAgICAgICAgICAgdmVyc2lvbjogMSxcclxuICAgICAgICAgICAgICAgIHNpZ25hdHVyZSxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3Jlc3RhcnQtcmVxdWlyZWQnLFxyXG4gICAgICAgICAgICAgICAgYXR0ZW1wdHM6IDEsXHJcbiAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgICAgICAgIGV4cGVjdGVkOiB7IG1vZHVsZXM6IFsuLi5tb2R1bGVzXS5zb3J0KCksIHBoeXNpY3NCYWNrZW5kOiBwaHlzaWNzQmFja2VuZCB8fCBudWxsIH0sXHJcbiAgICAgICAgICAgICAgICBiZWZvcmUsXHJcbiAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkLFxyXG4gICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZE1zOiBEYXRlLm5vdygpIC0gcmVidWlsZFN0YXJ0ZWRBdCxcclxuICAgICAgICAgICAgICAgIHNjZW5lV2FzRGlydHlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy53cml0ZVRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ZlYXR1cmUgQ3JvcHBpbmcgcHJvZmlsZSBpcyBwZXJzaXN0ZWQgYW5kIHRoZSBjcm9wcGVkIGVuZ2luZSBpcyByZWJ1aWx0LiBSZXN0YXJ0IHRoaXMgZXhhY3QgQ29jb3MgcHJvamVjdCBleHRlcm5hbGx5LCB0aGVuIGNhbGwgZ2V0X2ZlYXR1cmVzIHRvIG9idGFpbiB0aGUgZmluYWwgaW1wb3J0LW1hcCByZWNlaXB0LicsXHJcbiAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29tcGxldGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ3Jlc3RhcnQtcmVxdWlyZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQsXHJcbiAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgIGFmdGVyLFxyXG4gICAgICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNhY3Rpb246IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2lnbmF0dXJlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRlbXB0czogdHJhbnNhY3Rpb24uYXR0ZW1wdHMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGQ6IHRyYW5zYWN0aW9uLmVuZ2luZVJlYnVpbGQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGRNczogdHJhbnNhY3Rpb24uZW5naW5lUmVidWlsZE1zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzY2VuZVdhc0RpcnR5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBleHRlcm5hbFJlc3RhcnRSZXF1aXJlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVjb25uZWN0UmVxdWlyZWQ6IHRydWVcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcikgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuIl19