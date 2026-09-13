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
const SPINE_BACKENDS = ['spine-3.8', 'spine-4.2'];
const PHYSICS_2D_BACKENDS = [
    'physics-2d-box2d',
    'physics-2d-box2d-wasm',
    'physics-2d-builtin',
    'physics-2d-box2d-jsb'
];
const OPTION_PARENT_FEATURES = new Set(['spine', 'physics-2d']);
const IMPORT_MAP_SILENT_FEATURES = new Set(['marionette']);
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
    // Cocos 3.8.8 exposes versioned cache IDs such as `spine-4.2`.
    // Dots are accepted only as separators between non-empty, lower-case
    // alphanumeric/hyphen segments; paths, traversal and arbitrary punctuation
    // remain invalid, and the profile cache is still the authority for names.
    return typeof value === 'string'
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(value);
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
    var _a, _b, _c;
    const key = (profile === null || profile === void 0 ? void 0 : profile.globalConfigKey) || 'defaultConfig';
    const config = activeConfig(profile);
    const cache = config.cache || {};
    return {
        configKey: key,
        includeModules: [...(config.includeModules || [])],
        physicsBackend: ((_a = cache.physics) === null || _a === void 0 ? void 0 : _a._option) || null,
        spineBackend: ((_b = cache.spine) === null || _b === void 0 ? void 0 : _b._option) || null,
        physics2dBackend: ((_c = cache['physics-2d']) === null || _c === void 0 ? void 0 : _c._option) || null,
        enabled: Object.keys(cache).filter((name) => { var _a; return ((_a = cache[name]) === null || _a === void 0 ? void 0 : _a._value) === true; }).sort()
    };
}
function profileSelectionIncludes(snapshotValue, moduleName) {
    if (snapshotValue.includeModules.includes(moduleName))
        return true;
    if (!OPTION_PARENT_FEATURES.has(moduleName))
        return false;
    const selected = moduleName === 'spine'
        ? snapshotValue.spineBackend
        : snapshotValue.physics2dBackend;
    return snapshotValue.enabled.includes(moduleName)
        && typeof selected === 'string'
        && snapshotValue.enabled.includes(selected)
        && snapshotValue.includeModules.includes(selected);
}
function appliedFeaturePresent(receipt, moduleName, previewFresh, spineBackend) {
    if (receipt.features.includes(moduleName))
        return true;
    if (IMPORT_MAP_SILENT_FEATURES.has(moduleName))
        return previewFresh;
    if (moduleName === 'physics-2d') {
        return previewFresh && receipt.features.includes('physics-2d-framework');
    }
    return previewFresh
        && SPINE_BACKENDS.includes(moduleName)
        && spineBackend === moduleName
        && receipt.features.includes('spine');
}
function appliedSatisfies(receipt, modules, disabledModules, physicsBackend, spineBackend, physics2dBackend, minimumAppliedModifiedMs) {
    if (!receipt.available)
        return false;
    const previewFresh = Number.isFinite(receipt.importMapModifiedMs)
        && Number.isFinite(minimumAppliedModifiedMs)
        && Number(receipt.importMapModifiedMs) >= Number(minimumAppliedModifiedMs);
    if (modules.some((name) => !appliedFeaturePresent(receipt, name, previewFresh, spineBackend)))
        return false;
    if (disabledModules.some((name) => receipt.features.includes(name)))
        return false;
    if (physicsBackend && !receipt.features.includes(physicsBackend))
        return false;
    if (spineBackend && !appliedFeaturePresent(receipt, spineBackend, previewFresh, spineBackend))
        return false;
    return !physics2dBackend || receipt.features.includes(physics2dBackend);
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
                            items: {
                                type: 'string',
                                pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$'
                            },
                            maxItems: 64,
                            default: []
                        },
                        disabledModules: {
                            type: 'array',
                            description: 'Known Feature Cropping modules that this exact source closure requires to remain disabled.',
                            items: {
                                type: 'string',
                                pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$'
                            },
                            maxItems: 64,
                            default: []
                        },
                        physicsBackend: {
                            type: 'string',
                            enum: [...PHYSICS_BACKENDS]
                        },
                        spineBackend: {
                            type: 'string',
                            enum: [...SPINE_BACKENDS]
                        },
                        physics2dBackend: {
                            type: 'string',
                            enum: [...PHYSICS_2D_BACKENDS]
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
    async readProfileModifiedMs() {
        var _a, _b;
        const projectPath = (_a = Editor.Project) === null || _a === void 0 ? void 0 : _a.path;
        if (!projectPath)
            return null;
        const file = path.join(projectPath, 'settings', 'v2', 'packages', 'engine.json');
        return ((_b = (await fs_1.promises.stat(file).catch(() => null))) === null || _b === void 0 ? void 0 : _b.mtimeMs) || null;
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
    async waitForAppliedFeatures(modules, disabledModules, physicsBackend, spineBackend, physics2dBackend, timeoutMs, minimumAppliedModifiedMs) {
        const deadline = Date.now() + timeoutMs;
        let receipt = await this.readAppliedPreviewFeatures();
        while (!appliedSatisfies(receipt, modules, disabledModules, physicsBackend, spineBackend, physics2dBackend, minimumAppliedModifiedMs) && Date.now() < deadline) {
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
        var _b, _c, _d;
        try {
            const requested = Array.isArray(args.modules) ? args.modules : [];
            const requestedDisabled = Array.isArray(args.disabledModules) ? args.disabledModules : [];
            if (!requested.every(validFeatureName)) {
                return { success: false, error: 'Every requested module must be a valid Cocos feature name.' };
            }
            if (!requestedDisabled.every(validFeatureName)) {
                return { success: false, error: 'Every disabled module must be a valid Cocos feature name.' };
            }
            const moduleSet = new Set(requested);
            const disabledModules = [...new Set(requestedDisabled)];
            const physicsBackend = args.physicsBackend;
            if (physicsBackend && !PHYSICS_BACKENDS.includes(physicsBackend)) {
                return { success: false, error: `Unsupported physics backend: ${physicsBackend}` };
            }
            const requestedSpineBackends = SPINE_BACKENDS.filter((backend) => moduleSet.has(backend));
            const explicitSpineBackend = args.spineBackend;
            if (explicitSpineBackend && !SPINE_BACKENDS.includes(explicitSpineBackend)) {
                return { success: false, error: `Unsupported Spine backend: ${explicitSpineBackend}` };
            }
            if (requestedSpineBackends.length > 1 ||
                explicitSpineBackend && requestedSpineBackends.length === 1 && requestedSpineBackends[0] !== explicitSpineBackend) {
                return { success: false, error: 'Requested Spine feature modules conflict with the selected Spine backend.' };
            }
            const spineBackend = explicitSpineBackend || requestedSpineBackends[0];
            if (spineBackend) {
                moduleSet.add('spine');
                moduleSet.add(spineBackend);
            }
            const requestedPhysics2dBackends = PHYSICS_2D_BACKENDS.filter((backend) => moduleSet.has(backend));
            const explicitPhysics2dBackend = args.physics2dBackend;
            if (explicitPhysics2dBackend && !PHYSICS_2D_BACKENDS.includes(explicitPhysics2dBackend)) {
                return { success: false, error: `Unsupported Physics2D backend: ${explicitPhysics2dBackend}` };
            }
            if (requestedPhysics2dBackends.length > 1 ||
                explicitPhysics2dBackend && requestedPhysics2dBackends.length === 1 &&
                    requestedPhysics2dBackends[0] !== explicitPhysics2dBackend) {
                return { success: false, error: 'Requested Physics2D feature modules conflict with the selected Physics2D backend.' };
            }
            const physics2dBackend = explicitPhysics2dBackend || requestedPhysics2dBackends[0];
            if (physics2dBackend) {
                moduleSet.add('physics-2d');
                moduleSet.add(physics2dBackend);
            }
            const modules = [...moduleSet];
            const overlap = disabledModules.filter((moduleName) => moduleSet.has(moduleName));
            if (overlap.length) {
                return { success: false, error: `Features cannot be both required and disabled: ${overlap.join(', ')}` };
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
            const unknownDisabledModules = disabledModules.filter((moduleName) => !knownModules.has(moduleName));
            if (unknownModules.length || unknownDisabledModules.length) {
                return {
                    success: false,
                    error: `Refusing to mutate unknown Cocos engine modules: ${[...unknownModules, ...unknownDisabledModules].join(', ')}`,
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
            if (spineBackend && (!knownModules.has('spine') || !knownModules.has(spineBackend))) {
                return {
                    success: false,
                    error: `Spine feature/backend is not available in this Cocos profile: spine + ${spineBackend}`,
                    data: { complete: false, status: 'unknown-spine-backend', before }
                };
            }
            if (physics2dBackend && (!knownModules.has('physics-2d') || !knownModules.has(physics2dBackend))) {
                return {
                    success: false,
                    error: `Physics2D feature/backend is not available in this Cocos profile: physics-2d + ${physics2dBackend}`,
                    data: { complete: false, status: 'unknown-physics-2d-backend', before }
                };
            }
            let changed = false;
            for (const moduleName of modules) {
                if (config.cache[moduleName]._value !== true) {
                    config.cache[moduleName]._value = true;
                    changed = true;
                }
                if (!OPTION_PARENT_FEATURES.has(moduleName) && !include.has(moduleName)) {
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
            for (const moduleName of disabledModules) {
                if (config.cache[moduleName]._value !== false) {
                    config.cache[moduleName]._value = false;
                    changed = true;
                }
                if (include.delete(moduleName))
                    changed = true;
            }
            if (spineBackend) {
                (_c = config.cache).spine || (_c.spine = {});
                if (config.cache.spine._value !== true || config.cache.spine._option !== spineBackend) {
                    config.cache.spine._value = true;
                    config.cache.spine._option = spineBackend;
                    changed = true;
                }
                for (const backend of SPINE_BACKENDS) {
                    if (!knownModules.has(backend))
                        continue;
                    const selected = backend === spineBackend;
                    if (config.cache[backend]._value !== selected) {
                        config.cache[backend]._value = selected;
                        changed = true;
                    }
                    if (selected)
                        include.add(backend);
                    else
                        include.delete(backend);
                }
                include.delete('spine');
            }
            if (physics2dBackend) {
                (_d = config.cache)['physics-2d'] || (_d['physics-2d'] = {});
                if (config.cache['physics-2d']._value !== true ||
                    config.cache['physics-2d']._option !== physics2dBackend) {
                    config.cache['physics-2d']._value = true;
                    config.cache['physics-2d']._option = physics2dBackend;
                    changed = true;
                }
                for (const backend of PHYSICS_2D_BACKENDS) {
                    if (!knownModules.has(backend))
                        continue;
                    const selected = backend === physics2dBackend;
                    if (config.cache[backend]._value !== selected) {
                        config.cache[backend]._value = selected;
                        changed = true;
                    }
                    if (selected)
                        include.add(backend);
                    else
                        include.delete(backend);
                }
                include.delete('physics-2d');
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
            const missing = modules.filter((name) => !profileSelectionIncludes(after, name));
            const unexpected = disabledModules.filter((name) => after.includeModules.includes(name) || after.enabled.includes(name));
            if (physicsBackend && after.physicsBackend !== physicsBackend) {
                missing.push(`physics backend ${physicsBackend}`);
            }
            if (spineBackend && after.spineBackend !== spineBackend) {
                missing.push(`Spine backend ${spineBackend}`);
            }
            if (physics2dBackend && after.physics2dBackend !== physics2dBackend) {
                missing.push(`Physics2D backend ${physics2dBackend}`);
            }
            if (missing.length || unexpected.length) {
                return {
                    success: false,
                    error: `Feature Cropping write did not persist: ${[
                        ...missing,
                        ...unexpected.map(name => `disabled ${name}`)
                    ].join(', ')}`,
                    data: { complete: false, changed, before, after }
                };
            }
            const appliedBefore = await this.readAppliedPreviewFeatures();
            const profileModifiedMs = await this.readProfileModifiedMs();
            const signature = (0, crypto_1.createHash)('sha256').update(JSON.stringify({
                modules: [...modules].sort(),
                disabledModules: [...disabledModules].sort(),
                physicsBackend: physicsBackend || null,
                spineBackend: spineBackend || null,
                physics2dBackend: physics2dBackend || null,
                includeModules: after.includeModules,
                configKey: after.configKey
            })).digest('hex');
            const pending = await this.readTransaction();
            if (!changed && appliedSatisfies(appliedBefore, modules, disabledModules, physicsBackend, spineBackend, physics2dBackend, profileModifiedMs)) {
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
                expected: {
                    modules: [...modules].sort(),
                    disabledModules: [...disabledModules].sort(),
                    physicsBackend: physicsBackend || null,
                    spineBackend: spineBackend || null,
                    physics2dBackend: physics2dBackend || null
                },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLWZlYXR1cmUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZW5naW5lLWZlYXR1cmUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsbUNBQW9DO0FBQ3BDLDJCQUFvQztBQUNwQywyQ0FBNkI7QUFFN0IsTUFBTSxnQkFBZ0IsR0FBRztJQUNyQixpQkFBaUI7SUFDakIsZ0JBQWdCO0lBQ2hCLGNBQWM7SUFDZCxlQUFlO0NBQ1QsQ0FBQztBQUlYLE1BQU0sY0FBYyxHQUFHLENBQUMsV0FBVyxFQUFFLFdBQVcsQ0FBVSxDQUFDO0FBRzNELE1BQU0sbUJBQW1CLEdBQUc7SUFDeEIsa0JBQWtCO0lBQ2xCLHVCQUF1QjtJQUN2QixvQkFBb0I7SUFDcEIsc0JBQXNCO0NBQ2hCLENBQUM7QUFHWCxNQUFNLHNCQUFzQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUM7QUFDaEUsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7QUFFM0QsU0FBUyxLQUFLLENBQUMsRUFBVTtJQUNyQixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQztBQUVELEtBQUssVUFBVSxXQUFXLENBQUksT0FBbUIsRUFBRSxTQUFpQixFQUFFLEtBQWE7SUFDL0UsSUFBSSxLQUFnRCxDQUFDO0lBQ3JELElBQUksQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQ3RCLE9BQU87WUFDUCxJQUFJLE9BQU8sQ0FBSSxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsRUFBRTtnQkFDaEMsS0FBSyxHQUFHLFVBQVUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLG9CQUFvQixTQUFTLElBQUksQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFDdEcsQ0FBQyxDQUFDO1NBQ0wsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztZQUFTLENBQUM7UUFDUCxJQUFJLEtBQUs7WUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbkMsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLEtBQUssQ0FBSSxLQUFRO0lBQ3RCLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDN0MsQ0FBQztBQUVELFNBQVMsZ0JBQWdCLENBQUMsS0FBYztJQUNwQywrREFBK0Q7SUFDL0QscUVBQXFFO0lBQ3JFLDJFQUEyRTtJQUMzRSwwRUFBMEU7SUFDMUUsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRO1dBQ3pCLHlFQUF5RSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqRyxDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsT0FBWTs7SUFDOUIsTUFBTSxHQUFHLEdBQUcsQ0FBQSxPQUFPLGFBQVAsT0FBTyx1QkFBUCxPQUFPLENBQUUsZUFBZSxLQUFJLGVBQWUsQ0FBQztJQUN4RCxNQUFNLE1BQU0sR0FBRyxNQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxPQUFPLDBDQUFHLEdBQUcsQ0FBQyxDQUFDO0lBQ3ZDLElBQUksQ0FBQyxNQUFNLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4RSxDQUFDO0lBQ0QsTUFBTSxDQUFDLEtBQUssS0FBWixNQUFNLENBQUMsS0FBSyxHQUFLLEVBQUUsRUFBQztJQUNwQixNQUFNLENBQUMsY0FBYyxLQUFyQixNQUFNLENBQUMsY0FBYyxHQUFLLEVBQUUsRUFBQztJQUM3QixPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQsU0FBUyxRQUFRLENBQUMsT0FBWTs7SUFDMUIsTUFBTSxHQUFHLEdBQUcsQ0FBQSxPQUFPLGFBQVAsT0FBTyx1QkFBUCxPQUFPLENBQUUsZUFBZSxLQUFJLGVBQWUsQ0FBQztJQUN4RCxNQUFNLE1BQU0sR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDckMsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUM7SUFDakMsT0FBTztRQUNILFNBQVMsRUFBRSxHQUFHO1FBQ2QsY0FBYyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDLENBQUM7UUFDbEQsY0FBYyxFQUFFLENBQUEsTUFBQSxLQUFLLENBQUMsT0FBTywwQ0FBRSxPQUFPLEtBQUksSUFBSTtRQUM5QyxZQUFZLEVBQUUsQ0FBQSxNQUFBLEtBQUssQ0FBQyxLQUFLLDBDQUFFLE9BQU8sS0FBSSxJQUFJO1FBQzFDLGdCQUFnQixFQUFFLENBQUEsTUFBQSxLQUFLLENBQUMsWUFBWSxDQUFDLDBDQUFFLE9BQU8sS0FBSSxJQUFJO1FBQ3RELE9BQU8sRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLFdBQUMsT0FBQSxDQUFBLE1BQUEsS0FBSyxDQUFDLElBQUksQ0FBQywwQ0FBRSxNQUFNLE1BQUssSUFBSSxDQUFBLEVBQUEsQ0FBQyxDQUFDLElBQUksRUFBRTtLQUNwRixDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsd0JBQXdCLENBQUMsYUFBa0IsRUFBRSxVQUFrQjtJQUNwRSxJQUFJLGFBQWEsQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQztRQUFFLE9BQU8sSUFBSSxDQUFDO0lBQ25FLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDMUQsTUFBTSxRQUFRLEdBQUcsVUFBVSxLQUFLLE9BQU87UUFDbkMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxZQUFZO1FBQzVCLENBQUMsQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUM7SUFDckMsT0FBTyxhQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7V0FDMUMsT0FBTyxRQUFRLEtBQUssUUFBUTtXQUM1QixhQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7V0FDeEMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDM0QsQ0FBQztBQUVELFNBQVMscUJBQXFCLENBQzFCLE9BQThCLEVBQzlCLFVBQWtCLEVBQ2xCLFlBQXFCLEVBQ3JCLFlBQTJCO0lBRTNCLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUM7SUFDdkQsSUFBSSwwQkFBMEIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO1FBQUUsT0FBTyxZQUFZLENBQUM7SUFDcEUsSUFBSSxVQUFVLEtBQUssWUFBWSxFQUFFLENBQUM7UUFDOUIsT0FBTyxZQUFZLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsc0JBQXNCLENBQUMsQ0FBQztJQUM3RSxDQUFDO0lBQ0QsT0FBTyxZQUFZO1dBQ1osY0FBYyxDQUFDLFFBQVEsQ0FBQyxVQUEwQixDQUFDO1dBQ25ELFlBQVksS0FBSyxVQUFVO1dBQzNCLE9BQU8sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzlDLENBQUM7QUFXRCxTQUFTLGdCQUFnQixDQUNyQixPQUE4QixFQUM5QixPQUFpQixFQUNqQixlQUF5QixFQUN6QixjQUErQixFQUMvQixZQUEyQixFQUMzQixnQkFBbUMsRUFDbkMsd0JBQXdDO0lBRXhDLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ3JDLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDO1dBQzFELE1BQU0sQ0FBQyxRQUFRLENBQUMsd0JBQXdCLENBQUM7V0FDekMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO0lBQy9FLElBQUksT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxZQUFZLENBQUMsQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQzVHLElBQUksZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUNsRixJQUFJLGNBQWMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQy9FLElBQUksWUFBWSxJQUFJLENBQUMscUJBQXFCLENBQUMsT0FBTyxFQUFFLFlBQVksRUFBRSxZQUFZLEVBQUUsWUFBWSxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDNUcsT0FBTyxDQUFDLGdCQUFnQixJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFDNUUsQ0FBQztBQUVELE1BQWEsa0JBQWtCO0lBQzNCLFFBQVE7UUFDSixPQUFPO1lBQ0g7Z0JBQ0ksSUFBSSxFQUFFLGNBQWM7Z0JBQ3BCLFdBQVcsRUFBRSw4RUFBOEU7Z0JBQzNGLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTthQUNsRDtZQUNEO2dCQUNJLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLFdBQVcsRUFBRSxzU0FBc1M7Z0JBQ25ULFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1IsT0FBTyxFQUFFOzRCQUNMLElBQUksRUFBRSxPQUFPOzRCQUNiLEtBQUssRUFBRTtnQ0FDSCxJQUFJLEVBQUUsUUFBUTtnQ0FDZCxPQUFPLEVBQUUsMEVBQTBFOzZCQUN0Rjs0QkFDRCxRQUFRLEVBQUUsRUFBRTs0QkFDWixPQUFPLEVBQUUsRUFBRTt5QkFDZDt3QkFDRCxlQUFlLEVBQUU7NEJBQ2IsSUFBSSxFQUFFLE9BQU87NEJBQ2IsV0FBVyxFQUFFLDRGQUE0Rjs0QkFDekcsS0FBSyxFQUFFO2dDQUNILElBQUksRUFBRSxRQUFRO2dDQUNkLE9BQU8sRUFBRSwwRUFBMEU7NkJBQ3RGOzRCQUNELFFBQVEsRUFBRSxFQUFFOzRCQUNaLE9BQU8sRUFBRSxFQUFFO3lCQUNkO3dCQUNELGNBQWMsRUFBRTs0QkFDWixJQUFJLEVBQUUsUUFBUTs0QkFDZCxJQUFJLEVBQUUsQ0FBQyxHQUFHLGdCQUFnQixDQUFDO3lCQUM5Qjt3QkFDRCxZQUFZLEVBQUU7NEJBQ1YsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsSUFBSSxFQUFFLENBQUMsR0FBRyxjQUFjLENBQUM7eUJBQzVCO3dCQUNELGdCQUFnQixFQUFFOzRCQUNkLElBQUksRUFBRSxRQUFROzRCQUNkLElBQUksRUFBRSxDQUFDLEdBQUcsbUJBQW1CLENBQUM7eUJBQ2pDO3dCQUNELE1BQU0sRUFBRSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRTt3QkFDMUMsU0FBUyxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRTtxQkFDbEY7aUJBQ0o7YUFDSjtTQUNKLENBQUM7SUFDTixDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFnQixFQUFFLElBQVM7UUFDckMsSUFBSSxRQUFRLEtBQUssY0FBYztZQUFFLE9BQU8sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzNELElBQUksUUFBUSxLQUFLLGlCQUFpQjtZQUFFLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDLENBQUM7UUFDM0UsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLCtCQUErQixRQUFRLEVBQUUsRUFBRSxDQUFDO0lBQ2hGLENBQUM7SUFFTyxLQUFLLENBQUMsV0FBVztRQUNyQixNQUFNLFVBQVUsR0FBUyxNQUFjLENBQUMsT0FBTyxDQUFDO1FBQ2hELElBQUksQ0FBQyxDQUFBLFVBQVUsYUFBVixVQUFVLHVCQUFWLFVBQVUsQ0FBRSxVQUFVLENBQUE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUM7UUFDekYsTUFBTSxPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUNqRSxJQUFJLENBQUMsT0FBTztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseURBQXlELENBQUMsQ0FBQztRQUN6RixPQUFPLE9BQU8sQ0FBQztJQUNuQixDQUFDO0lBRU8sS0FBSyxDQUFDLFdBQVc7UUFDckIsSUFBSSxDQUFDO1lBQ0QsT0FBTztnQkFDSCxPQUFPLEVBQUUsSUFBSTtnQkFDYixJQUFJLGtDQUNHLFFBQVEsQ0FBQyxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUNyQyxjQUFjLEVBQUUsTUFBTSxJQUFJLENBQUMsMEJBQTBCLEVBQUUsR0FDMUQ7YUFDSixDQUFDO1FBQ04sQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDbEIsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN0RSxDQUFDO0lBQ0wsQ0FBQztJQUVPLEtBQUssQ0FBQywwQkFBMEI7O1FBQ3BDLE1BQU0sTUFBTSxHQUFHLGdFQUFnRSxDQUFDO1FBQ2hGLE1BQU0sYUFBYSxHQUFHLE1BQUMsTUFBYyxDQUFDLE9BQU8sMENBQUUsTUFBTSxDQUFDO1FBQ3RELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNqQixPQUFPO2dCQUNILFNBQVMsRUFBRSxLQUFLO2dCQUNoQixRQUFRLEVBQUUsRUFBRTtnQkFDWixlQUFlLEVBQUUsSUFBSTtnQkFDckIsbUJBQW1CLEVBQUUsSUFBSTtnQkFDekIsTUFBTTtnQkFDTixLQUFLLEVBQUUsc0NBQXNDO2FBQ2hELENBQUM7UUFDTixDQUFDO1FBRUQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsYUFBYSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixDQUFDLENBQUM7UUFDeEgsSUFBSSxDQUFDO1lBQ0QsTUFBTSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUM7Z0JBQ2xDLGFBQUUsQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQztnQkFDbEMsYUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUM7YUFDekIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUMvQixNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1lBQ25DLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBLE1BQU0sYUFBTixNQUFNLHVCQUFOLE1BQU0sQ0FBRSxNQUFNLEtBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQztnQkFDdEQsSUFBSSxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO29CQUFFLFNBQVM7Z0JBQ2xELEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFnQyxDQUFDLEVBQUUsQ0FBQztvQkFDbEUsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO3dCQUFFLFNBQVM7b0JBQ3hDLE1BQU0sTUFBTSxHQUFHLHdCQUF3QixDQUFDO29CQUN4QyxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDO3dCQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztnQkFDM0UsQ0FBQztZQUNMLENBQUM7WUFDRCxPQUFPO2dCQUNILFNBQVMsRUFBRSxJQUFJO2dCQUNmLFFBQVEsRUFBRSxDQUFDLEdBQUcsUUFBUSxDQUFDLENBQUMsSUFBSSxFQUFFO2dCQUM5QixlQUFlLEVBQUUsSUFBQSxtQkFBVSxFQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDO2dCQUMvRCxtQkFBbUIsRUFBRSxJQUFJLENBQUMsT0FBTztnQkFDakMsTUFBTTthQUNULENBQUM7UUFDTixDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNsQixPQUFPO2dCQUNILFNBQVMsRUFBRSxLQUFLO2dCQUNoQixRQUFRLEVBQUUsRUFBRTtnQkFDWixlQUFlLEVBQUUsSUFBSTtnQkFDckIsbUJBQW1CLEVBQUUsSUFBSTtnQkFDekIsTUFBTTtnQkFDTixLQUFLLEVBQUUsQ0FBQSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsT0FBTyxLQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUM7YUFDekMsQ0FBQztRQUNOLENBQUM7SUFDTCxDQUFDO0lBRU8sS0FBSyxDQUFDLHFCQUFxQjs7UUFDL0IsTUFBTSxXQUFXLEdBQUcsTUFBQyxNQUFjLENBQUMsT0FBTywwQ0FBRSxJQUFJLENBQUM7UUFDbEQsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFPLElBQUksQ0FBQztRQUM5QixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxhQUFhLENBQUMsQ0FBQztRQUNqRixPQUFPLENBQUEsTUFBQSxDQUFDLE1BQU0sYUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsMENBQUUsT0FBTyxLQUFJLElBQUksQ0FBQztJQUNwRSxDQUFDO0lBRU8sZUFBZTs7UUFDbkIsTUFBTSxhQUFhLEdBQUcsTUFBQyxNQUFjLENBQUMsT0FBTywwQ0FBRSxNQUFNLENBQUM7UUFDdEQsT0FBTyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLFdBQVcsRUFBRSxpQ0FBaUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDM0csQ0FBQztJQUVPLEtBQUssQ0FBQyxlQUFlO1FBQ3pCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsSUFBSTtZQUFFLE9BQU8sSUFBSSxDQUFDO1FBQ3ZCLElBQUksQ0FBQztZQUNELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLGFBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQztRQUFDLFdBQU0sQ0FBQztZQUNMLE9BQU8sSUFBSSxDQUFDO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0lBRU8sS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQVU7UUFDckMsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBQ3BDLElBQUksQ0FBQyxJQUFJO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpRkFBaUYsQ0FBQyxDQUFDO1FBQzlHLE1BQU0sYUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDeEQsTUFBTSxhQUFFLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQzVFLENBQUM7SUFFTyxLQUFLLENBQUMsZ0JBQWdCO1FBQzFCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNwQyxJQUFJLElBQUk7WUFBRSxNQUFNLGFBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQzNELENBQUM7SUFFTyxLQUFLLENBQUMsc0JBQXNCLENBQ2hDLE9BQWlCLEVBQ2pCLGVBQXlCLEVBQ3pCLGNBQTBDLEVBQzFDLFlBQXNDLEVBQ3RDLGdCQUE4QyxFQUM5QyxTQUFpQixFQUNqQix3QkFBd0M7UUFFeEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztRQUN4QyxJQUFJLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1FBQ3RELE9BQU8sQ0FBQyxnQkFBZ0IsQ0FDcEIsT0FBTyxFQUNQLE9BQU8sRUFDUCxlQUFlLEVBQ2YsY0FBYyxFQUNkLFlBQVksRUFDWixnQkFBZ0IsRUFDaEIsd0JBQXdCLENBQzNCLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFFBQVEsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2pCLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1FBQ3RELENBQUM7UUFDRCxPQUFPLE9BQU8sQ0FBQztJQUNuQixDQUFDO0lBRU8sS0FBSyxDQUFDLG9CQUFvQixDQUFDLFNBQWlCOztRQUNoRCxNQUFNLFVBQVUsR0FBUyxNQUFjLENBQUMsT0FBTyxDQUFDO1FBQ2hELElBQUksV0FBVyxHQUFrQixJQUFJLENBQUM7UUFDdEMsSUFBSSxrQkFBa0IsR0FBRyxDQUFDLENBQUM7UUFDM0IsSUFBSSxDQUFDO1lBQ0QsTUFBTSxVQUFVLEdBQVEsTUFBTSxXQUFXLENBQ3JDLFVBQVUsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLFlBQVksQ0FBQyxFQUMxQyxLQUFLLEVBQ0wsbUJBQW1CLENBQ3RCLENBQUM7WUFDRixNQUFNLFVBQVUsR0FBRyxVQUFVLGFBQVYsVUFBVSx1QkFBVixVQUFVLENBQUUsSUFBSSxDQUFDO1lBQ3BDLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUMvQyxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsU0FBUyxDQUFDLENBQUM7Z0JBQ3ZFLGtCQUFrQixHQUFHLENBQUEsTUFBQSxDQUFDLE1BQU0sYUFBRSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsMENBQUUsT0FBTyxLQUFJLENBQUMsQ0FBQztZQUN0RixDQUFDO1FBQ0wsQ0FBQztRQUFDLFdBQU0sQ0FBQztZQUNMLHlFQUF5RTtRQUM3RSxDQUFDO1FBRUQsTUFBTSxXQUFXLEdBQUcsTUFBQyxNQUFjLENBQUMsT0FBTywwQ0FBRSxJQUFJLENBQUM7UUFDbEQsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7UUFDOUYsTUFBTSxvQkFBb0IsR0FBRyxVQUFVO1lBQ25DLENBQUMsQ0FBQyxDQUFDLENBQUEsTUFBQSxDQUFDLE1BQU0sYUFBRSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsMENBQUUsSUFBSSxLQUFJLENBQUMsQ0FBQztZQUM1RCxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ1IsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzdCLElBQUksY0FBYyxHQUFHLEtBQUssQ0FBQztRQUMzQixJQUFJLFlBQVksR0FBUSxJQUFJLENBQUM7UUFFN0IscUVBQXFFO1FBQ3JFLHNFQUFzRTtRQUN0RSx5RUFBeUU7UUFDekUsS0FBSyxVQUFVLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQzdDLEdBQUcsRUFBRSxHQUFHLGNBQWMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQ2hDLENBQUMsS0FBVSxFQUFFLEVBQUUsR0FBRyxjQUFjLEdBQUcsSUFBSSxDQUFDLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FDbkUsQ0FBQztRQUVGLE1BQU0sUUFBUSxHQUFHLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDdkMsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsUUFBUSxFQUFFLENBQUM7WUFDM0IsSUFBSSxXQUFXLEVBQUUsQ0FBQztnQkFDZCxNQUFNLElBQUksR0FBRyxNQUFNLGFBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMxRCxJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsT0FBTyxHQUFHLGtCQUFrQixJQUFJLElBQUksQ0FBQyxPQUFPLElBQUksU0FBUyxHQUFHLElBQUksRUFBRSxDQUFDO29CQUNoRixPQUFPO3dCQUNILFNBQVMsRUFBRSxJQUFJO3dCQUNmLE1BQU0sRUFBRSxzQkFBc0I7d0JBQzlCLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUzt3QkFDbEMsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLE9BQU87d0JBQy9CLGNBQWM7cUJBQ2pCLENBQUM7Z0JBQ04sQ0FBQztZQUNMLENBQUM7WUFFRCxJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUNiLElBQUksQ0FBQztvQkFDRCxNQUFNLEdBQUcsR0FBRyxNQUFNLGFBQUUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUM7b0JBQzFDLElBQUksR0FBRyxDQUFDLE1BQU0sR0FBRyxvQkFBb0IsRUFBRSxDQUFDO3dCQUNwQyxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLG9CQUFvQixDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO3dCQUNyRSxJQUFJLHdCQUF3QixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDOzRCQUMxQyxPQUFPO2dDQUNILFNBQVMsRUFBRSxJQUFJO2dDQUNmLE1BQU0sRUFBRSxhQUFhO2dDQUNyQixVQUFVLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVM7Z0NBQ2xDLGNBQWM7NkJBQ2pCLENBQUM7d0JBQ04sQ0FBQztvQkFDTCxDQUFDO2dCQUNMLENBQUM7Z0JBQUMsV0FBTSxDQUFDO29CQUNMLDBEQUEwRDtnQkFDOUQsQ0FBQztZQUNMLENBQUM7WUFFRCxJQUFJLGNBQWMsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxZQUFZLENBQUM7WUFDdkIsQ0FBQztZQUNELE1BQU0sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLENBQUM7UUFDRCxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxTQUFTLElBQUksQ0FBQyxDQUFDO0lBQ25GLENBQUM7SUFFTyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQVM7OztRQUNsQyxJQUFJLENBQUM7WUFDRCxNQUFNLFNBQVMsR0FBYyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQzdFLE1BQU0saUJBQWlCLEdBQWMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNyRyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3JDLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSw0REFBNEQsRUFBRSxDQUFDO1lBQ25HLENBQUM7WUFDRCxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztnQkFDN0MsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLDJEQUEyRCxFQUFFLENBQUM7WUFDbEcsQ0FBQztZQUNELE1BQU0sU0FBUyxHQUFHLElBQUksR0FBRyxDQUFDLFNBQXFCLENBQUMsQ0FBQztZQUNqRCxNQUFNLGVBQWUsR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsaUJBQTZCLENBQUMsQ0FBQyxDQUFDO1lBQ3BFLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxjQUE0QyxDQUFDO1lBQ3pFLElBQUksY0FBYyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7Z0JBQy9ELE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxnQ0FBZ0MsY0FBYyxFQUFFLEVBQUUsQ0FBQztZQUN2RixDQUFDO1lBQ0QsTUFBTSxzQkFBc0IsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDMUYsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsWUFBd0MsQ0FBQztZQUMzRSxJQUFJLG9CQUFvQixJQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3pFLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSw4QkFBOEIsb0JBQW9CLEVBQUUsRUFBRSxDQUFDO1lBQzNGLENBQUM7WUFDRCxJQUFJLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUNqQyxvQkFBb0IsSUFBSSxzQkFBc0IsQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxLQUFLLG9CQUFvQixFQUFFLENBQUM7Z0JBQ3BILE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSwyRUFBMkUsRUFBRSxDQUFDO1lBQ2xILENBQUM7WUFDRCxNQUFNLFlBQVksR0FBRyxvQkFBb0IsSUFBSSxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN2RSxJQUFJLFlBQVksRUFBRSxDQUFDO2dCQUNmLFNBQVMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ3ZCLFNBQVMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDaEMsQ0FBQztZQUNELE1BQU0sMEJBQTBCLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDbkcsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsZ0JBQWdELENBQUM7WUFDdkYsSUFBSSx3QkFBd0IsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RGLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxrQ0FBa0Msd0JBQXdCLEVBQUUsRUFBRSxDQUFDO1lBQ25HLENBQUM7WUFDRCxJQUFJLDBCQUEwQixDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUNyQyx3QkFBd0IsSUFBSSwwQkFBMEIsQ0FBQyxNQUFNLEtBQUssQ0FBQztvQkFDbkUsMEJBQTBCLENBQUMsQ0FBQyxDQUFDLEtBQUssd0JBQXdCLEVBQUUsQ0FBQztnQkFDN0QsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLG1GQUFtRixFQUFFLENBQUM7WUFDMUgsQ0FBQztZQUNELE1BQU0sZ0JBQWdCLEdBQUcsd0JBQXdCLElBQUksMEJBQTBCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbkYsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNuQixTQUFTLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUM1QixTQUFTLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFDcEMsQ0FBQztZQUNELE1BQU0sT0FBTyxHQUFhLENBQUMsR0FBRyxTQUFTLENBQUMsQ0FBQztZQUN6QyxNQUFNLE9BQU8sR0FBRyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7WUFDbEYsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2pCLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxrREFBa0QsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDN0csQ0FBQztZQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQy9DLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUN2QyxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUM7WUFDbEMsTUFBTSxNQUFNLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2xDLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFTLE1BQU0sQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDLENBQUM7WUFDN0QscUVBQXFFO1lBQ3JFLHFFQUFxRTtZQUNyRSxxRUFBcUU7WUFDckUsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLENBQVMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDdEUsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7WUFDckYsTUFBTSxzQkFBc0IsR0FBRyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztZQUNyRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLElBQUksc0JBQXNCLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ3pELE9BQU87b0JBQ0gsT0FBTyxFQUFFLEtBQUs7b0JBQ2QsS0FBSyxFQUFFLG9EQUFvRCxDQUFDLEdBQUcsY0FBYyxFQUFFLEdBQUcsc0JBQXNCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7b0JBQ3RILElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLHdCQUF3QixFQUFFLE1BQU0sRUFBRTtpQkFDdEUsQ0FBQztZQUNOLENBQUM7WUFDRCxJQUFJLGNBQWMsSUFBSSxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUN4RixPQUFPO29CQUNILE9BQU8sRUFBRSxLQUFLO29CQUNkLEtBQUssRUFBRSw2RUFBNkUsY0FBYyxFQUFFO29CQUNwRyxJQUFJLEVBQUUsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSx5QkFBeUIsRUFBRSxNQUFNLEVBQUU7aUJBQ3ZFLENBQUM7WUFDTixDQUFDO1lBQ0QsSUFBSSxZQUFZLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDbEYsT0FBTztvQkFDSCxPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUseUVBQXlFLFlBQVksRUFBRTtvQkFDOUYsSUFBSSxFQUFFLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsdUJBQXVCLEVBQUUsTUFBTSxFQUFFO2lCQUNyRSxDQUFDO1lBQ04sQ0FBQztZQUNELElBQUksZ0JBQWdCLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUMvRixPQUFPO29CQUNILE9BQU8sRUFBRSxLQUFLO29CQUNkLEtBQUssRUFBRSxrRkFBa0YsZ0JBQWdCLEVBQUU7b0JBQzNHLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLDRCQUE0QixFQUFFLE1BQU0sRUFBRTtpQkFDMUUsQ0FBQztZQUNOLENBQUM7WUFDRCxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUM7WUFFcEIsS0FBSyxNQUFNLFVBQVUsSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDL0IsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sS0FBSyxJQUFJLEVBQUUsQ0FBQztvQkFDM0MsTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO29CQUN2QyxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7b0JBQ3RFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7b0JBQ3hCLE9BQU8sR0FBRyxJQUFJLENBQUM7Z0JBQ25CLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxjQUFjLEVBQUUsQ0FBQztnQkFDakIsTUFBQSxNQUFNLENBQUMsS0FBSyxFQUFDLE9BQU8sUUFBUCxPQUFPLEdBQUssRUFBRSxFQUFDO2dCQUM1QixJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxLQUFLLGNBQWMsRUFBRSxDQUFDO29CQUMxRixNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO29CQUNuQyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsY0FBYyxDQUFDO29CQUM5QyxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELEtBQUssTUFBTSxPQUFPLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztvQkFDckMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO3dCQUFFLFNBQVM7b0JBQ3pDLE1BQU0sUUFBUSxHQUFHLE9BQU8sS0FBSyxjQUFjLENBQUM7b0JBQzVDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7d0JBQzVDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQzt3QkFDeEMsT0FBTyxHQUFHLElBQUksQ0FBQztvQkFDbkIsQ0FBQztvQkFDRCxJQUFJLFFBQVE7d0JBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7d0JBQzlCLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ2pDLENBQUM7WUFDTCxDQUFDO1lBQ0QsS0FBSyxNQUFNLFVBQVUsSUFBSSxlQUFlLEVBQUUsQ0FBQztnQkFDdkMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sS0FBSyxLQUFLLEVBQUUsQ0FBQztvQkFDNUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDO29CQUN4QyxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELElBQUksT0FBTyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUM7b0JBQUUsT0FBTyxHQUFHLElBQUksQ0FBQztZQUNuRCxDQUFDO1lBRUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDZixNQUFBLE1BQU0sQ0FBQyxLQUFLLEVBQUMsS0FBSyxRQUFMLEtBQUssR0FBSyxFQUFFLEVBQUM7Z0JBQzFCLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxLQUFLLElBQUksSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLEtBQUssWUFBWSxFQUFFLENBQUM7b0JBQ3BGLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7b0JBQ2pDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sR0FBRyxZQUFZLENBQUM7b0JBQzFDLE9BQU8sR0FBRyxJQUFJLENBQUM7Z0JBQ25CLENBQUM7Z0JBQ0QsS0FBSyxNQUFNLE9BQU8sSUFBSSxjQUFjLEVBQUUsQ0FBQztvQkFDbkMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO3dCQUFFLFNBQVM7b0JBQ3pDLE1BQU0sUUFBUSxHQUFHLE9BQU8sS0FBSyxZQUFZLENBQUM7b0JBQzFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7d0JBQzVDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQzt3QkFDeEMsT0FBTyxHQUFHLElBQUksQ0FBQztvQkFDbkIsQ0FBQztvQkFDRCxJQUFJLFFBQVE7d0JBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7d0JBQzlCLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ2pDLENBQUM7Z0JBQ0QsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUM1QixDQUFDO1lBRUQsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNuQixNQUFBLE1BQU0sQ0FBQyxLQUFLLEVBQUMsWUFBWSxTQUFaLFlBQVksSUFBTSxFQUFFLEVBQUM7Z0JBQ2xDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxNQUFNLEtBQUssSUFBSTtvQkFDMUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxPQUFPLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztvQkFDMUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO29CQUN6QyxNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLE9BQU8sR0FBRyxnQkFBZ0IsQ0FBQztvQkFDdEQsT0FBTyxHQUFHLElBQUksQ0FBQztnQkFDbkIsQ0FBQztnQkFDRCxLQUFLLE1BQU0sT0FBTyxJQUFJLG1CQUFtQixFQUFFLENBQUM7b0JBQ3hDLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQzt3QkFBRSxTQUFTO29CQUN6QyxNQUFNLFFBQVEsR0FBRyxPQUFPLEtBQUssZ0JBQWdCLENBQUM7b0JBQzlDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7d0JBQzVDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQzt3QkFDeEMsT0FBTyxHQUFHLElBQUksQ0FBQztvQkFDbkIsQ0FBQztvQkFDRCxJQUFJLFFBQVE7d0JBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7d0JBQzlCLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ2pDLENBQUM7Z0JBQ0QsT0FBTyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUNqQyxDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3BDLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUM7Z0JBQUUsT0FBTyxHQUFHLElBQUksQ0FBQztZQUN0RixNQUFNLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQztZQUVoQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLEtBQUssQ0FBQztZQUM5QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDckYsTUFBTSxVQUFVLEdBQVMsTUFBYyxDQUFDLE9BQU8sQ0FBQztZQUVoRCxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNWLElBQUksQ0FBQyxDQUFBLFVBQVUsYUFBVixVQUFVLHVCQUFWLFVBQVUsQ0FBRSxVQUFVLENBQUE7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO2dCQUN6RixNQUFNLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztZQUMzRCxDQUFDO1lBRUQsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakQsTUFBTSxLQUFLLEdBQUcsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQ3hDLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDakYsTUFBTSxVQUFVLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQy9DLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDekUsSUFBSSxjQUFjLElBQUksS0FBSyxDQUFDLGNBQWMsS0FBSyxjQUFjLEVBQUUsQ0FBQztnQkFDNUQsT0FBTyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsY0FBYyxFQUFFLENBQUMsQ0FBQztZQUN0RCxDQUFDO1lBQ0QsSUFBSSxZQUFZLElBQUksS0FBSyxDQUFDLFlBQVksS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDdEQsT0FBTyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsWUFBWSxFQUFFLENBQUMsQ0FBQztZQUNsRCxDQUFDO1lBQ0QsSUFBSSxnQkFBZ0IsSUFBSSxLQUFLLENBQUMsZ0JBQWdCLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztnQkFDbEUsT0FBTyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO1lBQzFELENBQUM7WUFDRCxJQUFJLE9BQU8sQ0FBQyxNQUFNLElBQUksVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUN0QyxPQUFPO29CQUNILE9BQU8sRUFBRSxLQUFLO29CQUNkLEtBQUssRUFBRSwyQ0FBMkM7d0JBQzlDLEdBQUcsT0FBTzt3QkFDVixHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO3FCQUNoRCxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtvQkFDZCxJQUFJLEVBQUUsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFO2lCQUNwRCxDQUFDO1lBQ04sQ0FBQztZQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUM7WUFDOUQsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQzdELE1BQU0sU0FBUyxHQUFHLElBQUEsbUJBQVUsRUFBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDekQsT0FBTyxFQUFFLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUU7Z0JBQzVCLGVBQWUsRUFBRSxDQUFDLEdBQUcsZUFBZSxDQUFDLENBQUMsSUFBSSxFQUFFO2dCQUM1QyxjQUFjLEVBQUUsY0FBYyxJQUFJLElBQUk7Z0JBQ3RDLFlBQVksRUFBRSxZQUFZLElBQUksSUFBSTtnQkFDbEMsZ0JBQWdCLEVBQUUsZ0JBQWdCLElBQUksSUFBSTtnQkFDMUMsY0FBYyxFQUFFLEtBQUssQ0FBQyxjQUFjO2dCQUNwQyxTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7YUFDN0IsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2xCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBRTdDLElBQUksQ0FBQyxPQUFPLElBQUksZ0JBQWdCLENBQzVCLGFBQWEsRUFDYixPQUFPLEVBQ1AsZUFBZSxFQUNmLGNBQWMsRUFDZCxZQUFZLEVBQ1osZ0JBQWdCLEVBQ2hCLGlCQUFpQixDQUNwQixFQUFFLENBQUM7Z0JBQ0EsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztnQkFDOUIsT0FBTztvQkFDSCxPQUFPLEVBQUUsSUFBSTtvQkFDYixPQUFPLEVBQUUsOEVBQThFO29CQUN2RixJQUFJLEVBQUU7d0JBQ0YsUUFBUSxFQUFFLElBQUk7d0JBQ2QsTUFBTSxFQUFFLFVBQVU7d0JBQ2xCLE9BQU87d0JBQ1AsTUFBTTt3QkFDTixLQUFLO3dCQUNMLGFBQWE7d0JBQ2IsWUFBWSxFQUFFLGFBQWE7d0JBQzNCLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVEsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSTtxQkFDckY7aUJBQ0osQ0FBQztZQUNOLENBQUM7WUFFRCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ25CLE9BQU87b0JBQ0gsT0FBTyxFQUFFLElBQUk7b0JBQ2IsT0FBTyxFQUFFLGtGQUFrRjtvQkFDM0YsSUFBSSxFQUFFO3dCQUNGLFFBQVEsRUFBRSxLQUFLO3dCQUNmLE1BQU0sRUFBRSxrQ0FBa0M7d0JBQzFDLE9BQU87d0JBQ1AsTUFBTTt3QkFDTixLQUFLO3dCQUNMLGFBQWE7cUJBQ2hCO2lCQUNKLENBQUM7WUFDTixDQUFDO1lBRUQsNEVBQTRFO1lBQzVFLHNFQUFzRTtZQUN0RSw0RUFBNEU7WUFDNUUscUVBQXFFO1lBQ3JFLE1BQU0sZUFBZSxHQUFHLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLFNBQVMsTUFBSyxTQUFTO21CQUNqRCxDQUFDLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLE1BQU0sTUFBSyxrQkFBa0IsSUFBSSxDQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxNQUFNLE1BQUssMkJBQTJCLENBQUMsQ0FBQztZQUNuRyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUNsQixPQUFPO29CQUNILE9BQU8sRUFBRSxJQUFJO29CQUNiLE9BQU8sRUFBRSx5S0FBeUs7b0JBQ2xMLElBQUksRUFBRTt3QkFDRixRQUFRLEVBQUUsS0FBSzt3QkFDZixNQUFNLEVBQUUsa0JBQWtCO3dCQUMxQixPQUFPO3dCQUNQLE1BQU07d0JBQ04sS0FBSzt3QkFDTCxhQUFhO3dCQUNiLFdBQVcsa0NBQU8sT0FBTyxLQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsdUJBQXVCLEVBQUUsSUFBSSxHQUFFO3FCQUM5RTtpQkFDSixDQUFDO1lBQ04sQ0FBQztZQUVELG1FQUFtRTtZQUNuRSxJQUFJLGFBQWEsR0FBRyxLQUFLLENBQUM7WUFDMUIsSUFBSSxDQUFDO2dCQUNELE1BQU0sV0FBVyxHQUFRLE1BQU0sV0FBVyxDQUNyQyxNQUFjLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLEVBQ3ZELEtBQUssRUFDTCxtQkFBbUIsQ0FDdEIsQ0FBQztnQkFDRixhQUFhLEdBQUcsT0FBTyxDQUFDLE1BQUEsV0FBVyxhQUFYLFdBQVcsdUJBQVgsV0FBVyxDQUFFLEtBQUssbUNBQUksV0FBVyxDQUFDLENBQUM7Z0JBQzNELElBQUksYUFBYSxFQUFFLENBQUM7b0JBQ2hCLE1BQU0sV0FBVyxDQUNaLE1BQWMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUMsRUFDdEQsS0FBSyxFQUNMLG1DQUFtQyxDQUN0QyxDQUFDO2dCQUNOLENBQUM7WUFDTCxDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFDbEIsT0FBTztvQkFDSCxPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsa0dBQWtHLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUU7b0JBQzFJLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLDZCQUE2QixFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBRTtpQkFDMUcsQ0FBQztZQUNOLENBQUM7WUFFRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNwQyxJQUFJLGFBQWtCLENBQUM7WUFDdkIsSUFBSSxDQUFDO2dCQUNELGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUMvRCxDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFDbEIsT0FBTztvQkFDSCxPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsK0NBQStDLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUU7b0JBQ3ZGLElBQUksRUFBRTt3QkFDRixRQUFRLEVBQUUsS0FBSzt3QkFDZixNQUFNLEVBQUUsdUJBQXVCO3dCQUMvQixPQUFPO3dCQUNQLE1BQU07d0JBQ04sS0FBSzt3QkFDTCxhQUFhO3dCQUNiLGVBQWUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsZ0JBQWdCO3FCQUNqRDtpQkFDSixDQUFDO1lBQ04sQ0FBQztZQUVELE1BQU0sV0FBVyxHQUFHO2dCQUNoQixPQUFPLEVBQUUsQ0FBQztnQkFDVixTQUFTO2dCQUNULE1BQU0sRUFBRSxrQkFBa0I7Z0JBQzFCLFFBQVEsRUFBRSxDQUFDO2dCQUNYLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtnQkFDbkMsUUFBUSxFQUFFO29CQUNOLE9BQU8sRUFBRSxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFO29CQUM1QixlQUFlLEVBQUUsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxDQUFDLElBQUksRUFBRTtvQkFDNUMsY0FBYyxFQUFFLGNBQWMsSUFBSSxJQUFJO29CQUN0QyxZQUFZLEVBQUUsWUFBWSxJQUFJLElBQUk7b0JBQ2xDLGdCQUFnQixFQUFFLGdCQUFnQixJQUFJLElBQUk7aUJBQzdDO2dCQUNELE1BQU07Z0JBQ04sS0FBSztnQkFDTCxhQUFhO2dCQUNiLGFBQWE7Z0JBQ2IsZUFBZSxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxnQkFBZ0I7Z0JBQzlDLGFBQWE7YUFDaEIsQ0FBQztZQUNGLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBRXpDLE9BQU87Z0JBQ0gsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLHNMQUFzTDtnQkFDL0wsSUFBSSxFQUFFO29CQUNGLFFBQVEsRUFBRSxLQUFLO29CQUNmLE1BQU0sRUFBRSxrQkFBa0I7b0JBQzFCLE9BQU87b0JBQ1AsTUFBTTtvQkFDTixLQUFLO29CQUNMLGFBQWE7b0JBQ2IsV0FBVyxFQUFFO3dCQUNULFNBQVM7d0JBQ1QsUUFBUSxFQUFFLFdBQVcsQ0FBQyxRQUFRO3dCQUM5QixhQUFhLEVBQUUsV0FBVyxDQUFDLGFBQWE7d0JBQ3hDLGVBQWUsRUFBRSxXQUFXLENBQUMsZUFBZTt3QkFDNUMsYUFBYTt3QkFDYix1QkFBdUIsRUFBRSxJQUFJO3dCQUM3QixpQkFBaUIsRUFBRSxJQUFJO3FCQUMxQjtpQkFDSjthQUNKLENBQUM7UUFDTixDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNsQixPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsQ0FBQSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsT0FBTyxLQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3RFLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFub0JELGdEQW1vQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUb29sRGVmaW5pdGlvbiwgVG9vbEV4ZWN1dG9yLCBUb29sUmVzcG9uc2UgfSBmcm9tICcuLi90eXBlcyc7XHJcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xyXG5pbXBvcnQgeyBwcm9taXNlcyBhcyBmcyB9IGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuXHJcbmNvbnN0IFBIWVNJQ1NfQkFDS0VORFMgPSBbXHJcbiAgICAncGh5c2ljcy1idWlsdGluJyxcclxuICAgICdwaHlzaWNzLWNhbm5vbicsXHJcbiAgICAncGh5c2ljcy1hbW1vJyxcclxuICAgICdwaHlzaWNzLXBoeXN4J1xyXG5dIGFzIGNvbnN0O1xyXG5cclxudHlwZSBQaHlzaWNzQmFja2VuZCA9IHR5cGVvZiBQSFlTSUNTX0JBQ0tFTkRTW251bWJlcl07XHJcblxyXG5jb25zdCBTUElORV9CQUNLRU5EUyA9IFsnc3BpbmUtMy44JywgJ3NwaW5lLTQuMiddIGFzIGNvbnN0O1xyXG50eXBlIFNwaW5lQmFja2VuZCA9IHR5cGVvZiBTUElORV9CQUNLRU5EU1tudW1iZXJdO1xyXG5cclxuY29uc3QgUEhZU0lDU18yRF9CQUNLRU5EUyA9IFtcclxuICAgICdwaHlzaWNzLTJkLWJveDJkJyxcclxuICAgICdwaHlzaWNzLTJkLWJveDJkLXdhc20nLFxyXG4gICAgJ3BoeXNpY3MtMmQtYnVpbHRpbicsXHJcbiAgICAncGh5c2ljcy0yZC1ib3gyZC1qc2InXHJcbl0gYXMgY29uc3Q7XHJcbnR5cGUgUGh5c2ljczJkQmFja2VuZCA9IHR5cGVvZiBQSFlTSUNTXzJEX0JBQ0tFTkRTW251bWJlcl07XHJcblxyXG5jb25zdCBPUFRJT05fUEFSRU5UX0ZFQVRVUkVTID0gbmV3IFNldChbJ3NwaW5lJywgJ3BoeXNpY3MtMmQnXSk7XHJcbmNvbnN0IElNUE9SVF9NQVBfU0lMRU5UX0ZFQVRVUkVTID0gbmV3IFNldChbJ21hcmlvbmV0dGUnXSk7XHJcblxyXG5mdW5jdGlvbiBzbGVlcChtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gd2l0aFRpbWVvdXQ8VD4ocHJvbWlzZTogUHJvbWlzZTxUPiwgdGltZW91dE1zOiBudW1iZXIsIGxhYmVsOiBzdHJpbmcpOiBQcm9taXNlPFQ+IHtcclxuICAgIGxldCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWQ7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLnJhY2UoW1xyXG4gICAgICAgICAgICBwcm9taXNlLFxyXG4gICAgICAgICAgICBuZXcgUHJvbWlzZTxUPigoX3Jlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlamVjdChuZXcgRXJyb3IoYCR7bGFiZWx9IHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRNc31tc2ApKSwgdGltZW91dE1zKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICBdKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgaWYgKHRpbWVyKSBjbGVhclRpbWVvdXQodGltZXIpO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBjbG9uZTxUPih2YWx1ZTogVCk6IFQge1xyXG4gICAgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodmFsdWUpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRGZWF0dXJlTmFtZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIHN0cmluZyB7XHJcbiAgICAvLyBDb2NvcyAzLjguOCBleHBvc2VzIHZlcnNpb25lZCBjYWNoZSBJRHMgc3VjaCBhcyBgc3BpbmUtNC4yYC5cclxuICAgIC8vIERvdHMgYXJlIGFjY2VwdGVkIG9ubHkgYXMgc2VwYXJhdG9ycyBiZXR3ZWVuIG5vbi1lbXB0eSwgbG93ZXItY2FzZVxyXG4gICAgLy8gYWxwaGFudW1lcmljL2h5cGhlbiBzZWdtZW50czsgcGF0aHMsIHRyYXZlcnNhbCBhbmQgYXJiaXRyYXJ5IHB1bmN0dWF0aW9uXHJcbiAgICAvLyByZW1haW4gaW52YWxpZCwgYW5kIHRoZSBwcm9maWxlIGNhY2hlIGlzIHN0aWxsIHRoZSBhdXRob3JpdHkgZm9yIG5hbWVzLlxyXG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZydcclxuICAgICAgICAmJiAvXlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT8oPzpcXC5bYS16MC05XSg/OlthLXowLTktXSpbYS16MC05XSk/KSokLy50ZXN0KHZhbHVlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYWN0aXZlQ29uZmlnKHByb2ZpbGU6IGFueSk6IGFueSB7XHJcbiAgICBjb25zdCBrZXkgPSBwcm9maWxlPy5nbG9iYWxDb25maWdLZXkgfHwgJ2RlZmF1bHRDb25maWcnO1xyXG4gICAgY29uc3QgY29uZmlnID0gcHJvZmlsZT8uY29uZmlncz8uW2tleV07XHJcbiAgICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRW5naW5lIGZlYXR1cmUgcHJvZmlsZSBpcyBtaXNzaW5nIGNvbmZpZ3MuJHtrZXl9YCk7XHJcbiAgICB9XHJcbiAgICBjb25maWcuY2FjaGUgfHw9IHt9O1xyXG4gICAgY29uZmlnLmluY2x1ZGVNb2R1bGVzIHx8PSBbXTtcclxuICAgIHJldHVybiBjb25maWc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNuYXBzaG90KHByb2ZpbGU6IGFueSk6IGFueSB7XHJcbiAgICBjb25zdCBrZXkgPSBwcm9maWxlPy5nbG9iYWxDb25maWdLZXkgfHwgJ2RlZmF1bHRDb25maWcnO1xyXG4gICAgY29uc3QgY29uZmlnID0gYWN0aXZlQ29uZmlnKHByb2ZpbGUpO1xyXG4gICAgY29uc3QgY2FjaGUgPSBjb25maWcuY2FjaGUgfHwge307XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGNvbmZpZ0tleToga2V5LFxyXG4gICAgICAgIGluY2x1ZGVNb2R1bGVzOiBbLi4uKGNvbmZpZy5pbmNsdWRlTW9kdWxlcyB8fCBbXSldLFxyXG4gICAgICAgIHBoeXNpY3NCYWNrZW5kOiBjYWNoZS5waHlzaWNzPy5fb3B0aW9uIHx8IG51bGwsXHJcbiAgICAgICAgc3BpbmVCYWNrZW5kOiBjYWNoZS5zcGluZT8uX29wdGlvbiB8fCBudWxsLFxyXG4gICAgICAgIHBoeXNpY3MyZEJhY2tlbmQ6IGNhY2hlWydwaHlzaWNzLTJkJ10/Ll9vcHRpb24gfHwgbnVsbCxcclxuICAgICAgICBlbmFibGVkOiBPYmplY3Qua2V5cyhjYWNoZSkuZmlsdGVyKChuYW1lKSA9PiBjYWNoZVtuYW1lXT8uX3ZhbHVlID09PSB0cnVlKS5zb3J0KClcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHByb2ZpbGVTZWxlY3Rpb25JbmNsdWRlcyhzbmFwc2hvdFZhbHVlOiBhbnksIG1vZHVsZU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKHNuYXBzaG90VmFsdWUuaW5jbHVkZU1vZHVsZXMuaW5jbHVkZXMobW9kdWxlTmFtZSkpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCFPUFRJT05fUEFSRU5UX0ZFQVRVUkVTLmhhcyhtb2R1bGVOYW1lKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBtb2R1bGVOYW1lID09PSAnc3BpbmUnXHJcbiAgICAgICAgPyBzbmFwc2hvdFZhbHVlLnNwaW5lQmFja2VuZFxyXG4gICAgICAgIDogc25hcHNob3RWYWx1ZS5waHlzaWNzMmRCYWNrZW5kO1xyXG4gICAgcmV0dXJuIHNuYXBzaG90VmFsdWUuZW5hYmxlZC5pbmNsdWRlcyhtb2R1bGVOYW1lKVxyXG4gICAgICAgICYmIHR5cGVvZiBzZWxlY3RlZCA9PT0gJ3N0cmluZydcclxuICAgICAgICAmJiBzbmFwc2hvdFZhbHVlLmVuYWJsZWQuaW5jbHVkZXMoc2VsZWN0ZWQpXHJcbiAgICAgICAgJiYgc25hcHNob3RWYWx1ZS5pbmNsdWRlTW9kdWxlcy5pbmNsdWRlcyhzZWxlY3RlZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFwcGxpZWRGZWF0dXJlUHJlc2VudChcclxuICAgIHJlY2VpcHQ6IEFwcGxpZWRGZWF0dXJlUmVjZWlwdCxcclxuICAgIG1vZHVsZU5hbWU6IHN0cmluZyxcclxuICAgIHByZXZpZXdGcmVzaDogYm9vbGVhbixcclxuICAgIHNwaW5lQmFja2VuZD86IFNwaW5lQmFja2VuZFxyXG4pOiBib29sZWFuIHtcclxuICAgIGlmIChyZWNlaXB0LmZlYXR1cmVzLmluY2x1ZGVzKG1vZHVsZU5hbWUpKSByZXR1cm4gdHJ1ZTtcclxuICAgIGlmIChJTVBPUlRfTUFQX1NJTEVOVF9GRUFUVVJFUy5oYXMobW9kdWxlTmFtZSkpIHJldHVybiBwcmV2aWV3RnJlc2g7XHJcbiAgICBpZiAobW9kdWxlTmFtZSA9PT0gJ3BoeXNpY3MtMmQnKSB7XHJcbiAgICAgICAgcmV0dXJuIHByZXZpZXdGcmVzaCAmJiByZWNlaXB0LmZlYXR1cmVzLmluY2x1ZGVzKCdwaHlzaWNzLTJkLWZyYW1ld29yaycpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHByZXZpZXdGcmVzaFxyXG4gICAgICAgICYmIFNQSU5FX0JBQ0tFTkRTLmluY2x1ZGVzKG1vZHVsZU5hbWUgYXMgU3BpbmVCYWNrZW5kKVxyXG4gICAgICAgICYmIHNwaW5lQmFja2VuZCA9PT0gbW9kdWxlTmFtZVxyXG4gICAgICAgICYmIHJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMoJ3NwaW5lJyk7XHJcbn1cclxuXHJcbmludGVyZmFjZSBBcHBsaWVkRmVhdHVyZVJlY2VpcHQge1xyXG4gICAgYXZhaWxhYmxlOiBib29sZWFuO1xyXG4gICAgZmVhdHVyZXM6IHN0cmluZ1tdO1xyXG4gICAgaW1wb3J0TWFwU2hhMjU2OiBzdHJpbmcgfCBudWxsO1xyXG4gICAgaW1wb3J0TWFwTW9kaWZpZWRNczogbnVtYmVyIHwgbnVsbDtcclxuICAgIHNvdXJjZTogc3RyaW5nO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFwcGxpZWRTYXRpc2ZpZXMoXHJcbiAgICByZWNlaXB0OiBBcHBsaWVkRmVhdHVyZVJlY2VpcHQsXHJcbiAgICBtb2R1bGVzOiBzdHJpbmdbXSxcclxuICAgIGRpc2FibGVkTW9kdWxlczogc3RyaW5nW10sXHJcbiAgICBwaHlzaWNzQmFja2VuZD86IFBoeXNpY3NCYWNrZW5kLFxyXG4gICAgc3BpbmVCYWNrZW5kPzogU3BpbmVCYWNrZW5kLFxyXG4gICAgcGh5c2ljczJkQmFja2VuZD86IFBoeXNpY3MyZEJhY2tlbmQsXHJcbiAgICBtaW5pbXVtQXBwbGllZE1vZGlmaWVkTXM/OiBudW1iZXIgfCBudWxsXHJcbik6IGJvb2xlYW4ge1xyXG4gICAgaWYgKCFyZWNlaXB0LmF2YWlsYWJsZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgY29uc3QgcHJldmlld0ZyZXNoID0gTnVtYmVyLmlzRmluaXRlKHJlY2VpcHQuaW1wb3J0TWFwTW9kaWZpZWRNcylcclxuICAgICAgICAmJiBOdW1iZXIuaXNGaW5pdGUobWluaW11bUFwcGxpZWRNb2RpZmllZE1zKVxyXG4gICAgICAgICYmIE51bWJlcihyZWNlaXB0LmltcG9ydE1hcE1vZGlmaWVkTXMpID49IE51bWJlcihtaW5pbXVtQXBwbGllZE1vZGlmaWVkTXMpO1xyXG4gICAgaWYgKG1vZHVsZXMuc29tZSgobmFtZSkgPT4gIWFwcGxpZWRGZWF0dXJlUHJlc2VudChyZWNlaXB0LCBuYW1lLCBwcmV2aWV3RnJlc2gsIHNwaW5lQmFja2VuZCkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoZGlzYWJsZWRNb2R1bGVzLnNvbWUoKG5hbWUpID0+IHJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMobmFtZSkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAocGh5c2ljc0JhY2tlbmQgJiYgIXJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMocGh5c2ljc0JhY2tlbmQpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoc3BpbmVCYWNrZW5kICYmICFhcHBsaWVkRmVhdHVyZVByZXNlbnQocmVjZWlwdCwgc3BpbmVCYWNrZW5kLCBwcmV2aWV3RnJlc2gsIHNwaW5lQmFja2VuZCkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiAhcGh5c2ljczJkQmFja2VuZCB8fCByZWNlaXB0LmZlYXR1cmVzLmluY2x1ZGVzKHBoeXNpY3MyZEJhY2tlbmQpO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgRW5naW5lRmVhdHVyZVRvb2xzIGltcGxlbWVudHMgVG9vbEV4ZWN1dG9yIHtcclxuICAgIGdldFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdnZXRfZmVhdHVyZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZWFkIHRoZSBhY3RpdmUgQ29jb3MgRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlIGFuZCBzZWxlY3RlZCBwaHlzaWNzIGJhY2tlbmQuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6ICdvYmplY3QnLCBwcm9wZXJ0aWVzOiB7fSB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdlbnN1cmVfZmVhdHVyZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdFbmFibGUgcmVxdWlyZWQgRmVhdHVyZSBDcm9wcGluZyBtb2R1bGVzIHRocm91Z2ggRWRpdG9yLlByb2ZpbGUgYW5kIHJlYnVpbGQgdGhlIGNyb3BwZWQgZW5naW5lLiBXaGVuIGRhdGEuc3RhdHVzIGlzIHJlc3RhcnQtcmVxdWlyZWQsIHJlc3RhcnQgdGhlIGV4YWN0IHByb2plY3QgZnJvbSBhbiBleHRlcm5hbCBzdXBlcnZpc29yIGFuZCBjYWxsIGdldF9mZWF0dXJlcyBhZ2FpbjsgZGF0YS5jb21wbGV0ZSBpcyB0cnVlIG9ubHkgYWZ0ZXIgdGhlIGFjdGl2ZSBwcmV2aWV3IGltcG9ydCBtYXAgaXMgdmVyaWZpZWQuJyxcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2R1bGVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXR0ZXJuOiAnXlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT8oPzpcXFxcLlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT8pKiQnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4SXRlbXM6IDY0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogW11cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZWRNb2R1bGVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdLbm93biBGZWF0dXJlIENyb3BwaW5nIG1vZHVsZXMgdGhhdCB0aGlzIGV4YWN0IHNvdXJjZSBjbG9zdXJlIHJlcXVpcmVzIHRvIHJlbWFpbiBkaXNhYmxlZC4nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXR0ZXJuOiAnXlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT8oPzpcXFxcLlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT8pKiQnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4SXRlbXM6IDY0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogW11cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWy4uLlBIWVNJQ1NfQkFDS0VORFNdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNwaW5lQmFja2VuZDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbLi4uU1BJTkVfQkFDS0VORFNdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBoeXNpY3MyZEJhY2tlbmQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWy4uLlBIWVNJQ1NfMkRfQkFDS0VORFNdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlbG9hZDogeyB0eXBlOiAnYm9vbGVhbicsIGRlZmF1bHQ6IHRydWUgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGltZW91dE1zOiB7IHR5cGU6ICdpbnRlZ2VyJywgbWluaW11bTogMTAwMCwgbWF4aW11bTogMzAwMDAwLCBkZWZhdWx0OiAyNDAwMDAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIF07XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZXhlY3V0ZSh0b29sTmFtZTogc3RyaW5nLCBhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIGlmICh0b29sTmFtZSA9PT0gJ2dldF9mZWF0dXJlcycpIHJldHVybiB0aGlzLmdldEZlYXR1cmVzKCk7XHJcbiAgICAgICAgaWYgKHRvb2xOYW1lID09PSAnZW5zdXJlX2ZlYXR1cmVzJykgcmV0dXJuIHRoaXMuZW5zdXJlRmVhdHVyZXMoYXJncyB8fCB7fSk7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5rbm93biBlbmdpbmVGZWF0dXJlIHRvb2w6ICR7dG9vbE5hbWV9YCB9O1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcmVhZFByb2ZpbGUoKTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBjb25zdCBwcm9maWxlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuUHJvZmlsZTtcclxuICAgICAgICBpZiAoIXByb2ZpbGVBcGk/LmdldFByb2plY3QpIHRocm93IG5ldyBFcnJvcignRWRpdG9yLlByb2ZpbGUuZ2V0UHJvamVjdCBpcyB1bmF2YWlsYWJsZScpO1xyXG4gICAgICAgIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCBwcm9maWxlQXBpLmdldFByb2plY3QoJ2VuZ2luZScsICdtb2R1bGVzJyk7XHJcbiAgICAgICAgaWYgKCFwcm9maWxlKSB0aHJvdyBuZXcgRXJyb3IoJ0NvY29zIHJldHVybmVkIGFuIGVtcHR5IGVuZ2luZSBGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUnKTtcclxuICAgICAgICByZXR1cm4gcHJvZmlsZTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdldEZlYXR1cmVzKCk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgLi4uc25hcHNob3QoYXdhaXQgdGhpcy5yZWFkUHJvZmlsZSgpKSxcclxuICAgICAgICAgICAgICAgICAgICBhcHBsaWVkUHJldmlldzogYXdhaXQgdGhpcy5yZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcikgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyByZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpOiBQcm9taXNlPEFwcGxpZWRGZWF0dXJlUmVjZWlwdD4ge1xyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9ICd0ZW1wL3Byb2dyYW1taW5nL3BhY2tlci1kcml2ZXIvdGFyZ2V0cy9wcmV2aWV3L2ltcG9ydC1tYXAuanNvbic7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdFRtcERpciA9IChFZGl0b3IgYXMgYW55KS5Qcm9qZWN0Py50bXBEaXI7XHJcbiAgICAgICAgaWYgKCFwcm9qZWN0VG1wRGlyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBhdmFpbGFibGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXM6IFtdLFxyXG4gICAgICAgICAgICAgICAgaW1wb3J0TWFwU2hhMjU2OiBudWxsLFxyXG4gICAgICAgICAgICAgICAgaW1wb3J0TWFwTW9kaWZpZWRNczogbnVsbCxcclxuICAgICAgICAgICAgICAgIHNvdXJjZSxcclxuICAgICAgICAgICAgICAgIGVycm9yOiAnRWRpdG9yLlByb2plY3QudG1wRGlyIGlzIHVuYXZhaWxhYmxlJ1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaW1wb3J0TWFwUGF0aCA9IHBhdGguam9pbihwcm9qZWN0VG1wRGlyLCAncHJvZ3JhbW1pbmcnLCAncGFja2VyLWRyaXZlcicsICd0YXJnZXRzJywgJ3ByZXZpZXcnLCAnaW1wb3J0LW1hcC5qc29uJyk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgW3Jhdywgc3RhdF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICAgICAgICAgICAgICBmcy5yZWFkRmlsZShpbXBvcnRNYXBQYXRoLCAndXRmOCcpLFxyXG4gICAgICAgICAgICAgICAgZnMuc3RhdChpbXBvcnRNYXBQYXRoKVxyXG4gICAgICAgICAgICBdKTtcclxuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xyXG4gICAgICAgICAgICBjb25zdCBmZWF0dXJlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHNjb3BlIG9mIE9iamVjdC52YWx1ZXMocGFyc2VkPy5zY29wZXMgfHwge30pKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXNjb3BlIHx8IHR5cGVvZiBzY29wZSAhPT0gJ29iamVjdCcpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiBPYmplY3QudmFsdWVzKHNjb3BlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwcmVmaXggPSAnY2NlOi9pbnRlcm5hbC94L2NjLWZ1Lyc7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgocHJlZml4KSkgZmVhdHVyZXMuYWRkKHZhbHVlLnNsaWNlKHByZWZpeC5sZW5ndGgpKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXM6IFsuLi5mZWF0dXJlc10uc29ydCgpLFxyXG4gICAgICAgICAgICAgICAgaW1wb3J0TWFwU2hhMjU2OiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocmF3KS5kaWdlc3QoJ2hleCcpLFxyXG4gICAgICAgICAgICAgICAgaW1wb3J0TWFwTW9kaWZpZWRNczogc3RhdC5tdGltZU1zLFxyXG4gICAgICAgICAgICAgICAgc291cmNlXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVzOiBbXSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogbnVsbCxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBzb3VyY2UsXHJcbiAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHJlYWRQcm9maWxlTW9kaWZpZWRNcygpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcclxuICAgICAgICBjb25zdCBwcm9qZWN0UGF0aCA9IChFZGl0b3IgYXMgYW55KS5Qcm9qZWN0Py5wYXRoO1xyXG4gICAgICAgIGlmICghcHJvamVjdFBhdGgpIHJldHVybiBudWxsO1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSBwYXRoLmpvaW4ocHJvamVjdFBhdGgsICdzZXR0aW5ncycsICd2MicsICdwYWNrYWdlcycsICdlbmdpbmUuanNvbicpO1xyXG4gICAgICAgIHJldHVybiAoYXdhaXQgZnMuc3RhdChmaWxlKS5jYXRjaCgoKSA9PiBudWxsKSk/Lm10aW1lTXMgfHwgbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHRyYW5zYWN0aW9uUGF0aCgpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgICAgICBjb25zdCBwcm9qZWN0VG1wRGlyID0gKEVkaXRvciBhcyBhbnkpLlByb2plY3Q/LnRtcERpcjtcclxuICAgICAgICByZXR1cm4gcHJvamVjdFRtcERpciA/IHBhdGguam9pbihwcm9qZWN0VG1wRGlyLCAnY29jb3MtbWNwJywgJ2VuZ2luZS1mZWF0dXJlLXRyYW5zYWN0aW9uLmpzb24nKSA6IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyByZWFkVHJhbnNhY3Rpb24oKTogUHJvbWlzZTxhbnkgfCBudWxsPiB7XHJcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMudHJhbnNhY3Rpb25QYXRoKCk7XHJcbiAgICAgICAgaWYgKCFmaWxlKSByZXR1cm4gbnVsbDtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShhd2FpdCBmcy5yZWFkRmlsZShmaWxlLCAndXRmOCcpKTtcclxuICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgd3JpdGVUcmFuc2FjdGlvbih2YWx1ZTogYW55KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMudHJhbnNhY3Rpb25QYXRoKCk7XHJcbiAgICAgICAgaWYgKCFmaWxlKSB0aHJvdyBuZXcgRXJyb3IoJ0VkaXRvci5Qcm9qZWN0LnRtcERpciBpcyB1bmF2YWlsYWJsZSBmb3IgdGhlIGVuZ2luZSBmZWF0dXJlIHRyYW5zYWN0aW9uIHJlY2VpcHQnKTtcclxuICAgICAgICBhd2FpdCBmcy5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZSksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlLCBgJHtKU09OLnN0cmluZ2lmeSh2YWx1ZSwgbnVsbCwgMil9XFxuYCwgJ3V0ZjgnKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGNsZWFyVHJhbnNhY3Rpb24oKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMudHJhbnNhY3Rpb25QYXRoKCk7XHJcbiAgICAgICAgaWYgKGZpbGUpIGF3YWl0IGZzLnVubGluayhmaWxlKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgd2FpdEZvckFwcGxpZWRGZWF0dXJlcyhcclxuICAgICAgICBtb2R1bGVzOiBzdHJpbmdbXSxcclxuICAgICAgICBkaXNhYmxlZE1vZHVsZXM6IHN0cmluZ1tdLFxyXG4gICAgICAgIHBoeXNpY3NCYWNrZW5kOiBQaHlzaWNzQmFja2VuZCB8IHVuZGVmaW5lZCxcclxuICAgICAgICBzcGluZUJhY2tlbmQ6IFNwaW5lQmFja2VuZCB8IHVuZGVmaW5lZCxcclxuICAgICAgICBwaHlzaWNzMmRCYWNrZW5kOiBQaHlzaWNzMmRCYWNrZW5kIHwgdW5kZWZpbmVkLFxyXG4gICAgICAgIHRpbWVvdXRNczogbnVtYmVyLFxyXG4gICAgICAgIG1pbmltdW1BcHBsaWVkTW9kaWZpZWRNcz86IG51bWJlciB8IG51bGxcclxuICAgICk6IFByb21pc2U8QXBwbGllZEZlYXR1cmVSZWNlaXB0PiB7XHJcbiAgICAgICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgdGltZW91dE1zO1xyXG4gICAgICAgIGxldCByZWNlaXB0ID0gYXdhaXQgdGhpcy5yZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpO1xyXG4gICAgICAgIHdoaWxlICghYXBwbGllZFNhdGlzZmllcyhcclxuICAgICAgICAgICAgcmVjZWlwdCxcclxuICAgICAgICAgICAgbW9kdWxlcyxcclxuICAgICAgICAgICAgZGlzYWJsZWRNb2R1bGVzLFxyXG4gICAgICAgICAgICBwaHlzaWNzQmFja2VuZCxcclxuICAgICAgICAgICAgc3BpbmVCYWNrZW5kLFxyXG4gICAgICAgICAgICBwaHlzaWNzMmRCYWNrZW5kLFxyXG4gICAgICAgICAgICBtaW5pbXVtQXBwbGllZE1vZGlmaWVkTXNcclxuICAgICAgICApICYmIERhdGUubm93KCkgPCBkZWFkbGluZSkge1xyXG4gICAgICAgICAgICBhd2FpdCBzbGVlcCg1MDApO1xyXG4gICAgICAgICAgICByZWNlaXB0ID0gYXdhaXQgdGhpcy5yZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcmVjZWlwdDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHJlYnVpbGRFbmdpbmVBbmRXYWl0KHRpbWVvdXRNczogbnVtYmVyKTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBjb25zdCBtZXNzYWdlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZTtcclxuICAgICAgICBsZXQgdmVyc2lvbkZpbGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xyXG4gICAgICAgIGxldCB2ZXJzaW9uTXRpbWVCZWZvcmUgPSAwO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVuZ2luZUluZm86IGFueSA9IGF3YWl0IHdpdGhUaW1lb3V0KFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZUFwaS5yZXF1ZXN0KCdlbmdpbmUnLCAncXVlcnktaW5mbycpLFxyXG4gICAgICAgICAgICAgICAgMTAwMDAsXHJcbiAgICAgICAgICAgICAgICAnZW5naW5lIGluZm8gcXVlcnknXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIGNvbnN0IGVuZ2luZVBhdGggPSBlbmdpbmVJbmZvPy5wYXRoO1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIGVuZ2luZVBhdGggPT09ICdzdHJpbmcnICYmIGVuZ2luZVBhdGgpIHtcclxuICAgICAgICAgICAgICAgIHZlcnNpb25GaWxlID0gcGF0aC5qb2luKGVuZ2luZVBhdGgsICdiaW4nLCAnLmNhY2hlJywgJ2RldicsICdWRVJTSU9OJyk7XHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uTXRpbWVCZWZvcmUgPSAoYXdhaXQgZnMuc3RhdCh2ZXJzaW9uRmlsZSkuY2F0Y2goKCkgPT4gbnVsbCkpPy5tdGltZU1zIHx8IDA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgLy8gVGhlIGJvdW5kZWQgcHJvamVjdCBsb2cgcmVjZWlwdCBiZWxvdyByZW1haW5zIGF2YWlsYWJsZSBhcyBhIGZhbGxiYWNrLlxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgcHJvamVjdFBhdGggPSAoRWRpdG9yIGFzIGFueSkuUHJvamVjdD8ucGF0aDtcclxuICAgICAgICBjb25zdCBwcm9qZWN0TG9nID0gcHJvamVjdFBhdGggPyBwYXRoLmpvaW4ocHJvamVjdFBhdGgsICd0ZW1wJywgJ2xvZ3MnLCAncHJvamVjdC5sb2cnKSA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdExvZ1NpemVCZWZvcmUgPSBwcm9qZWN0TG9nXHJcbiAgICAgICAgICAgID8gKChhd2FpdCBmcy5zdGF0KHByb2plY3RMb2cpLmNhdGNoKCgpID0+IG51bGwpKT8uc2l6ZSB8fCAwKVxyXG4gICAgICAgICAgICA6IDA7XHJcbiAgICAgICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICBsZXQgcmVxdWVzdFNldHRsZWQgPSBmYWxzZTtcclxuICAgICAgICBsZXQgcmVxdWVzdEVycm9yOiBhbnkgPSBudWxsO1xyXG5cclxuICAgICAgICAvLyBDb2NvcyAzLjguOCBjYW4gZmluaXNoIFF1aWNrIENvbXBpbGUgYnV0IGxlYXZlIHRoZSBtZXNzYWdlIHJlcXVlc3RcclxuICAgICAgICAvLyB1bnJlc29sdmVkIHdoaWxlIHRoZSBlbmdpbmUgY29uc3VtZXIgaXMgYmVpbmcgcmVwbGFjZWQuIE9ic2VydmUgdGhlXHJcbiAgICAgICAgLy8gY29tcGlsZXIncyBvd24gVkVSU0lPTi9sb2cgcmVjZWlwdCBpbnN0ZWFkIG9mIGhhbmdpbmcgdGhlIE1DUCByZXF1ZXN0LlxyXG4gICAgICAgIHZvaWQgbWVzc2FnZUFwaS5yZXF1ZXN0KCdlbmdpbmUnLCAncmVidWlsZCcpLnRoZW4oXHJcbiAgICAgICAgICAgICgpID0+IHsgcmVxdWVzdFNldHRsZWQgPSB0cnVlOyB9LFxyXG4gICAgICAgICAgICAoZXJyb3I6IGFueSkgPT4geyByZXF1ZXN0U2V0dGxlZCA9IHRydWU7IHJlcXVlc3RFcnJvciA9IGVycm9yOyB9XHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgY29uc3QgZGVhZGxpbmUgPSBzdGFydGVkQXQgKyB0aW1lb3V0TXM7XHJcbiAgICAgICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xyXG4gICAgICAgICAgICBpZiAodmVyc2lvbkZpbGUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmcy5zdGF0KHZlcnNpb25GaWxlKS5jYXRjaCgoKSA9PiBudWxsKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdGF0ICYmIHN0YXQubXRpbWVNcyA+IHZlcnNpb25NdGltZUJlZm9yZSAmJiBzdGF0Lm10aW1lTXMgPj0gc3RhcnRlZEF0IC0gMTAwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiAnZW5naW5lLWNhY2hlLXZlcnNpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uTW9kaWZpZWRNczogc3RhdC5tdGltZU1zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXF1ZXN0U2V0dGxlZFxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChwcm9qZWN0TG9nKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxvZyA9IGF3YWl0IGZzLnJlYWRGaWxlKHByb2plY3RMb2cpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsb2cubGVuZ3RoID4gcHJvamVjdExvZ1NpemVCZWZvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYXBwZW5kZWQgPSBsb2cuc3ViYXJyYXkocHJvamVjdExvZ1NpemVCZWZvcmUpLnRvU3RyaW5nKCd1dGY4Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgvUXVpY2sgQ29tcGlsZTpcXHMqXFxkK21zLy50ZXN0KGFwcGVuZGVkKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc291cmNlOiAncHJvamVjdC1sb2cnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWVzdFNldHRsZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBLZWVwIHBvbGxpbmcgdGhlIGVuZ2luZSBWRVJTSU9OIHJlY2VpcHQgd2hlbiBhdmFpbGFibGUuXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChyZXF1ZXN0U2V0dGxlZCAmJiByZXF1ZXN0RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IHJlcXVlc3RFcnJvcjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBhd2FpdCBzbGVlcCgyNTApO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvY29zIGVuZ2luZSBmZWF0dXJlIHJlYnVpbGQgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBlbnN1cmVGZWF0dXJlcyhhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlcXVlc3RlZDogdW5rbm93bltdID0gQXJyYXkuaXNBcnJheShhcmdzLm1vZHVsZXMpID8gYXJncy5tb2R1bGVzIDogW107XHJcbiAgICAgICAgICAgIGNvbnN0IHJlcXVlc3RlZERpc2FibGVkOiB1bmtub3duW10gPSBBcnJheS5pc0FycmF5KGFyZ3MuZGlzYWJsZWRNb2R1bGVzKSA/IGFyZ3MuZGlzYWJsZWRNb2R1bGVzIDogW107XHJcbiAgICAgICAgICAgIGlmICghcmVxdWVzdGVkLmV2ZXJ5KHZhbGlkRmVhdHVyZU5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdFdmVyeSByZXF1ZXN0ZWQgbW9kdWxlIG11c3QgYmUgYSB2YWxpZCBDb2NvcyBmZWF0dXJlIG5hbWUuJyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghcmVxdWVzdGVkRGlzYWJsZWQuZXZlcnkodmFsaWRGZWF0dXJlTmFtZSkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0V2ZXJ5IGRpc2FibGVkIG1vZHVsZSBtdXN0IGJlIGEgdmFsaWQgQ29jb3MgZmVhdHVyZSBuYW1lLicgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCBtb2R1bGVTZXQgPSBuZXcgU2V0KHJlcXVlc3RlZCBhcyBzdHJpbmdbXSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGRpc2FibGVkTW9kdWxlcyA9IFsuLi5uZXcgU2V0KHJlcXVlc3RlZERpc2FibGVkIGFzIHN0cmluZ1tdKV07XHJcbiAgICAgICAgICAgIGNvbnN0IHBoeXNpY3NCYWNrZW5kID0gYXJncy5waHlzaWNzQmFja2VuZCBhcyBQaHlzaWNzQmFja2VuZCB8IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgaWYgKHBoeXNpY3NCYWNrZW5kICYmICFQSFlTSUNTX0JBQ0tFTkRTLmluY2x1ZGVzKHBoeXNpY3NCYWNrZW5kKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgcGh5c2ljcyBiYWNrZW5kOiAke3BoeXNpY3NCYWNrZW5kfWAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCByZXF1ZXN0ZWRTcGluZUJhY2tlbmRzID0gU1BJTkVfQkFDS0VORFMuZmlsdGVyKChiYWNrZW5kKSA9PiBtb2R1bGVTZXQuaGFzKGJhY2tlbmQpKTtcclxuICAgICAgICAgICAgY29uc3QgZXhwbGljaXRTcGluZUJhY2tlbmQgPSBhcmdzLnNwaW5lQmFja2VuZCBhcyBTcGluZUJhY2tlbmQgfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIGlmIChleHBsaWNpdFNwaW5lQmFja2VuZCAmJiAhU1BJTkVfQkFDS0VORFMuaW5jbHVkZXMoZXhwbGljaXRTcGluZUJhY2tlbmQpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBVbnN1cHBvcnRlZCBTcGluZSBiYWNrZW5kOiAke2V4cGxpY2l0U3BpbmVCYWNrZW5kfWAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAocmVxdWVzdGVkU3BpbmVCYWNrZW5kcy5sZW5ndGggPiAxIHx8XHJcbiAgICAgICAgICAgICAgICBleHBsaWNpdFNwaW5lQmFja2VuZCAmJiByZXF1ZXN0ZWRTcGluZUJhY2tlbmRzLmxlbmd0aCA9PT0gMSAmJiByZXF1ZXN0ZWRTcGluZUJhY2tlbmRzWzBdICE9PSBleHBsaWNpdFNwaW5lQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnUmVxdWVzdGVkIFNwaW5lIGZlYXR1cmUgbW9kdWxlcyBjb25mbGljdCB3aXRoIHRoZSBzZWxlY3RlZCBTcGluZSBiYWNrZW5kLicgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCBzcGluZUJhY2tlbmQgPSBleHBsaWNpdFNwaW5lQmFja2VuZCB8fCByZXF1ZXN0ZWRTcGluZUJhY2tlbmRzWzBdO1xyXG4gICAgICAgICAgICBpZiAoc3BpbmVCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICBtb2R1bGVTZXQuYWRkKCdzcGluZScpO1xyXG4gICAgICAgICAgICAgICAgbW9kdWxlU2V0LmFkZChzcGluZUJhY2tlbmQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IHJlcXVlc3RlZFBoeXNpY3MyZEJhY2tlbmRzID0gUEhZU0lDU18yRF9CQUNLRU5EUy5maWx0ZXIoKGJhY2tlbmQpID0+IG1vZHVsZVNldC5oYXMoYmFja2VuZCkpO1xyXG4gICAgICAgICAgICBjb25zdCBleHBsaWNpdFBoeXNpY3MyZEJhY2tlbmQgPSBhcmdzLnBoeXNpY3MyZEJhY2tlbmQgYXMgUGh5c2ljczJkQmFja2VuZCB8IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgaWYgKGV4cGxpY2l0UGh5c2ljczJkQmFja2VuZCAmJiAhUEhZU0lDU18yRF9CQUNLRU5EUy5pbmNsdWRlcyhleHBsaWNpdFBoeXNpY3MyZEJhY2tlbmQpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBVbnN1cHBvcnRlZCBQaHlzaWNzMkQgYmFja2VuZDogJHtleHBsaWNpdFBoeXNpY3MyZEJhY2tlbmR9YCB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChyZXF1ZXN0ZWRQaHlzaWNzMmRCYWNrZW5kcy5sZW5ndGggPiAxIHx8XHJcbiAgICAgICAgICAgICAgICBleHBsaWNpdFBoeXNpY3MyZEJhY2tlbmQgJiYgcmVxdWVzdGVkUGh5c2ljczJkQmFja2VuZHMubGVuZ3RoID09PSAxICYmXHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0ZWRQaHlzaWNzMmRCYWNrZW5kc1swXSAhPT0gZXhwbGljaXRQaHlzaWNzMmRCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdSZXF1ZXN0ZWQgUGh5c2ljczJEIGZlYXR1cmUgbW9kdWxlcyBjb25mbGljdCB3aXRoIHRoZSBzZWxlY3RlZCBQaHlzaWNzMkQgYmFja2VuZC4nIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3QgcGh5c2ljczJkQmFja2VuZCA9IGV4cGxpY2l0UGh5c2ljczJkQmFja2VuZCB8fCByZXF1ZXN0ZWRQaHlzaWNzMmRCYWNrZW5kc1swXTtcclxuICAgICAgICAgICAgaWYgKHBoeXNpY3MyZEJhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgIG1vZHVsZVNldC5hZGQoJ3BoeXNpY3MtMmQnKTtcclxuICAgICAgICAgICAgICAgIG1vZHVsZVNldC5hZGQocGh5c2ljczJkQmFja2VuZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3QgbW9kdWxlczogc3RyaW5nW10gPSBbLi4ubW9kdWxlU2V0XTtcclxuICAgICAgICAgICAgY29uc3Qgb3ZlcmxhcCA9IGRpc2FibGVkTW9kdWxlcy5maWx0ZXIoKG1vZHVsZU5hbWUpID0+IG1vZHVsZVNldC5oYXMobW9kdWxlTmFtZSkpO1xyXG4gICAgICAgICAgICBpZiAob3ZlcmxhcC5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYEZlYXR1cmVzIGNhbm5vdCBiZSBib3RoIHJlcXVpcmVkIGFuZCBkaXNhYmxlZDogJHtvdmVybGFwLmpvaW4oJywgJyl9YCB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBiZWZvcmVQcm9maWxlID0gYXdhaXQgdGhpcy5yZWFkUHJvZmlsZSgpO1xyXG4gICAgICAgICAgICBjb25zdCBiZWZvcmUgPSBzbmFwc2hvdChiZWZvcmVQcm9maWxlKTtcclxuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGNsb25lKGJlZm9yZVByb2ZpbGUpO1xyXG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhY3RpdmVDb25maWcobmV4dCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGluY2x1ZGUgPSBuZXcgU2V0PHN0cmluZz4oY29uZmlnLmluY2x1ZGVNb2R1bGVzIHx8IFtdKTtcclxuICAgICAgICAgICAgLy8gQSBtb2R1bGUgaXMgd3JpdGFibGUgb25seSB3aGVuIHRoZSBjdXJyZW50IENyZWF0b3IgcHJvZmlsZSBleHBvc2VzXHJcbiAgICAgICAgICAgIC8vIGl0cyBjYWNoZSByZWNvcmQuIGluY2x1ZGVNb2R1bGVzIGlzIHNlbGVjdGlvbiBzdGF0ZSwgbm90IGEgc2NoZW1hO1xyXG4gICAgICAgICAgICAvLyB0cnVzdGluZyBhbiBvcnBoYW4gaW5jbHVkZSBlbnRyeSB3b3VsZCBkZXJlZmVyZW5jZS9pbnNlcnQgYmxpbmRseS5cclxuICAgICAgICAgICAgY29uc3Qga25vd25Nb2R1bGVzID0gbmV3IFNldDxzdHJpbmc+KE9iamVjdC5rZXlzKGNvbmZpZy5jYWNoZSB8fCB7fSkpO1xyXG4gICAgICAgICAgICBjb25zdCB1bmtub3duTW9kdWxlcyA9IG1vZHVsZXMuZmlsdGVyKChtb2R1bGVOYW1lKSA9PiAha25vd25Nb2R1bGVzLmhhcyhtb2R1bGVOYW1lKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHVua25vd25EaXNhYmxlZE1vZHVsZXMgPSBkaXNhYmxlZE1vZHVsZXMuZmlsdGVyKChtb2R1bGVOYW1lKSA9PiAha25vd25Nb2R1bGVzLmhhcyhtb2R1bGVOYW1lKSk7XHJcbiAgICAgICAgICAgIGlmICh1bmtub3duTW9kdWxlcy5sZW5ndGggfHwgdW5rbm93bkRpc2FibGVkTW9kdWxlcy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBSZWZ1c2luZyB0byBtdXRhdGUgdW5rbm93biBDb2NvcyBlbmdpbmUgbW9kdWxlczogJHtbLi4udW5rbm93bk1vZHVsZXMsIC4uLnVua25vd25EaXNhYmxlZE1vZHVsZXNdLmpvaW4oJywgJyl9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAndW5rbm93bi1mZWF0dXJlLW1vZHVsZScsIGJlZm9yZSB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzQmFja2VuZCAmJiAoIWtub3duTW9kdWxlcy5oYXMoJ3BoeXNpY3MnKSB8fCAha25vd25Nb2R1bGVzLmhhcyhwaHlzaWNzQmFja2VuZCkpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgUGh5c2ljcyBmZWF0dXJlL2JhY2tlbmQgaXMgbm90IGF2YWlsYWJsZSBpbiB0aGlzIENvY29zIHByb2ZpbGU6IHBoeXNpY3MgKyAke3BoeXNpY3NCYWNrZW5kfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIHN0YXR1czogJ3Vua25vd24tcGh5c2ljcy1iYWNrZW5kJywgYmVmb3JlIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHNwaW5lQmFja2VuZCAmJiAoIWtub3duTW9kdWxlcy5oYXMoJ3NwaW5lJykgfHwgIWtub3duTW9kdWxlcy5oYXMoc3BpbmVCYWNrZW5kKSkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBTcGluZSBmZWF0dXJlL2JhY2tlbmQgaXMgbm90IGF2YWlsYWJsZSBpbiB0aGlzIENvY29zIHByb2ZpbGU6IHNwaW5lICsgJHtzcGluZUJhY2tlbmR9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAndW5rbm93bi1zcGluZS1iYWNrZW5kJywgYmVmb3JlIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHBoeXNpY3MyZEJhY2tlbmQgJiYgKCFrbm93bk1vZHVsZXMuaGFzKCdwaHlzaWNzLTJkJykgfHwgIWtub3duTW9kdWxlcy5oYXMocGh5c2ljczJkQmFja2VuZCkpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgUGh5c2ljczJEIGZlYXR1cmUvYmFja2VuZCBpcyBub3QgYXZhaWxhYmxlIGluIHRoaXMgQ29jb3MgcHJvZmlsZTogcGh5c2ljcy0yZCArICR7cGh5c2ljczJkQmFja2VuZH1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHsgY29tcGxldGU6IGZhbHNlLCBzdGF0dXM6ICd1bmtub3duLXBoeXNpY3MtMmQtYmFja2VuZCcsIGJlZm9yZSB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7XHJcblxyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1vZHVsZU5hbWUgb2YgbW9kdWxlcykge1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZVttb2R1bGVOYW1lXS5fdmFsdWUgIT09IHRydWUpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGVbbW9kdWxlTmFtZV0uX3ZhbHVlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmICghT1BUSU9OX1BBUkVOVF9GRUFUVVJFUy5oYXMobW9kdWxlTmFtZSkgJiYgIWluY2x1ZGUuaGFzKG1vZHVsZU5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5jbHVkZS5hZGQobW9kdWxlTmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlLnBoeXNpY3MgfHw9IHt9O1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZS5waHlzaWNzLl92YWx1ZSAhPT0gdHJ1ZSB8fCBjb25maWcuY2FjaGUucGh5c2ljcy5fb3B0aW9uICE9PSBwaHlzaWNzQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZS5waHlzaWNzLl92YWx1ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlLnBoeXNpY3MuX29wdGlvbiA9IHBoeXNpY3NCYWNrZW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIFBIWVNJQ1NfQkFDS0VORFMpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWtub3duTW9kdWxlcy5oYXMoYmFja2VuZCkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gYmFja2VuZCA9PT0gcGh5c2ljc0JhY2tlbmQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgIT09IHNlbGVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgPSBzZWxlY3RlZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgaW5jbHVkZS5hZGQoYmFja2VuZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpbmNsdWRlLmRlbGV0ZShiYWNrZW5kKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1vZHVsZU5hbWUgb2YgZGlzYWJsZWRNb2R1bGVzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmNhY2hlW21vZHVsZU5hbWVdLl92YWx1ZSAhPT0gZmFsc2UpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGVbbW9kdWxlTmFtZV0uX3ZhbHVlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoaW5jbHVkZS5kZWxldGUobW9kdWxlTmFtZSkpIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoc3BpbmVCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUuc3BpbmUgfHw9IHt9O1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZS5zcGluZS5fdmFsdWUgIT09IHRydWUgfHwgY29uZmlnLmNhY2hlLnNwaW5lLl9vcHRpb24gIT09IHNwaW5lQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZS5zcGluZS5fdmFsdWUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZS5zcGluZS5fb3B0aW9uID0gc3BpbmVCYWNrZW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIFNQSU5FX0JBQ0tFTkRTKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFrbm93bk1vZHVsZXMuaGFzKGJhY2tlbmQpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IGJhY2tlbmQgPT09IHNwaW5lQmFja2VuZDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmNhY2hlW2JhY2tlbmRdLl92YWx1ZSAhPT0gc2VsZWN0ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlW2JhY2tlbmRdLl92YWx1ZSA9IHNlbGVjdGVkO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGVjdGVkKSBpbmNsdWRlLmFkZChiYWNrZW5kKTtcclxuICAgICAgICAgICAgICAgICAgICBlbHNlIGluY2x1ZGUuZGVsZXRlKGJhY2tlbmQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZS5kZWxldGUoJ3NwaW5lJyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzMmRCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICBjb25maWcuY2FjaGVbJ3BoeXNpY3MtMmQnXSB8fD0ge307XHJcbiAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmNhY2hlWydwaHlzaWNzLTJkJ10uX3ZhbHVlICE9PSB0cnVlIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlWydwaHlzaWNzLTJkJ10uX29wdGlvbiAhPT0gcGh5c2ljczJkQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVsncGh5c2ljcy0yZCddLl92YWx1ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlWydwaHlzaWNzLTJkJ10uX29wdGlvbiA9IHBoeXNpY3MyZEJhY2tlbmQ7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgUEhZU0lDU18yRF9CQUNLRU5EUykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgha25vd25Nb2R1bGVzLmhhcyhiYWNrZW5kKSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VsZWN0ZWQgPSBiYWNrZW5kID09PSBwaHlzaWNzMmRCYWNrZW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGVbYmFja2VuZF0uX3ZhbHVlICE9PSBzZWxlY3RlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGVbYmFja2VuZF0uX3ZhbHVlID0gc2VsZWN0ZWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIGluY2x1ZGUuYWRkKGJhY2tlbmQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaW5jbHVkZS5kZWxldGUoYmFja2VuZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlLmRlbGV0ZSgncGh5c2ljcy0yZCcpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBvcmRlcmVkID0gWy4uLmluY2x1ZGVdLnNvcnQoKTtcclxuICAgICAgICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KG9yZGVyZWQpICE9PSBKU09OLnN0cmluZ2lmeShjb25maWcuaW5jbHVkZU1vZHVsZXMpKSBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgY29uZmlnLmluY2x1ZGVNb2R1bGVzID0gb3JkZXJlZDtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlbG9hZFJlcXVlc3RlZCA9IGFyZ3MucmVsb2FkICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgY29uc3QgdGltZW91dE1zID0gTWF0aC5taW4oMzAwMDAwLCBNYXRoLm1heCgxMDAwLCBOdW1iZXIoYXJncy50aW1lb3V0TXMpIHx8IDI0MDAwMCkpO1xyXG4gICAgICAgICAgICBjb25zdCBwcm9maWxlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuUHJvZmlsZTtcclxuXHJcbiAgICAgICAgICAgIGlmIChjaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXByb2ZpbGVBcGk/LnNldFByb2plY3QpIHRocm93IG5ldyBFcnJvcignRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdCBpcyB1bmF2YWlsYWJsZScpO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgcHJvZmlsZUFwaS5zZXRQcm9qZWN0KCdlbmdpbmUnLCAnbW9kdWxlcycsIG5leHQpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCB2ZXJpZmllZFByb2ZpbGUgPSBhd2FpdCB0aGlzLnJlYWRQcm9maWxlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGFmdGVyID0gc25hcHNob3QodmVyaWZpZWRQcm9maWxlKTtcclxuICAgICAgICAgICAgY29uc3QgbWlzc2luZyA9IG1vZHVsZXMuZmlsdGVyKChuYW1lKSA9PiAhcHJvZmlsZVNlbGVjdGlvbkluY2x1ZGVzKGFmdGVyLCBuYW1lKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHVuZXhwZWN0ZWQgPSBkaXNhYmxlZE1vZHVsZXMuZmlsdGVyKChuYW1lKSA9PlxyXG4gICAgICAgICAgICAgICAgYWZ0ZXIuaW5jbHVkZU1vZHVsZXMuaW5jbHVkZXMobmFtZSkgfHwgYWZ0ZXIuZW5hYmxlZC5pbmNsdWRlcyhuYW1lKSk7XHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzQmFja2VuZCAmJiBhZnRlci5waHlzaWNzQmFja2VuZCAhPT0gcGh5c2ljc0JhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgIG1pc3NpbmcucHVzaChgcGh5c2ljcyBiYWNrZW5kICR7cGh5c2ljc0JhY2tlbmR9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHNwaW5lQmFja2VuZCAmJiBhZnRlci5zcGluZUJhY2tlbmQgIT09IHNwaW5lQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgbWlzc2luZy5wdXNoKGBTcGluZSBiYWNrZW5kICR7c3BpbmVCYWNrZW5kfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzMmRCYWNrZW5kICYmIGFmdGVyLnBoeXNpY3MyZEJhY2tlbmQgIT09IHBoeXNpY3MyZEJhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgIG1pc3NpbmcucHVzaChgUGh5c2ljczJEIGJhY2tlbmQgJHtwaHlzaWNzMmRCYWNrZW5kfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaXNzaW5nLmxlbmd0aCB8fCB1bmV4cGVjdGVkLmxlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYEZlYXR1cmUgQ3JvcHBpbmcgd3JpdGUgZGlkIG5vdCBwZXJzaXN0OiAke1tcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ubWlzc2luZyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4udW5leHBlY3RlZC5tYXAobmFtZSA9PiBgZGlzYWJsZWQgJHtuYW1lfWApXHJcbiAgICAgICAgICAgICAgICAgICAgXS5qb2luKCcsICcpfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIGNoYW5nZWQsIGJlZm9yZSwgYWZ0ZXIgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgYXBwbGllZEJlZm9yZSA9IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTtcclxuICAgICAgICAgICAgY29uc3QgcHJvZmlsZU1vZGlmaWVkTXMgPSBhd2FpdCB0aGlzLnJlYWRQcm9maWxlTW9kaWZpZWRNcygpO1xyXG4gICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICAgICAgbW9kdWxlczogWy4uLm1vZHVsZXNdLnNvcnQoKSxcclxuICAgICAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlczogWy4uLmRpc2FibGVkTW9kdWxlc10uc29ydCgpLFxyXG4gICAgICAgICAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IHBoeXNpY3NCYWNrZW5kIHx8IG51bGwsXHJcbiAgICAgICAgICAgICAgICBzcGluZUJhY2tlbmQ6IHNwaW5lQmFja2VuZCB8fCBudWxsLFxyXG4gICAgICAgICAgICAgICAgcGh5c2ljczJkQmFja2VuZDogcGh5c2ljczJkQmFja2VuZCB8fCBudWxsLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZU1vZHVsZXM6IGFmdGVyLmluY2x1ZGVNb2R1bGVzLFxyXG4gICAgICAgICAgICAgICAgY29uZmlnS2V5OiBhZnRlci5jb25maWdLZXlcclxuICAgICAgICAgICAgfSkpLmRpZ2VzdCgnaGV4Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBlbmRpbmcgPSBhd2FpdCB0aGlzLnJlYWRUcmFuc2FjdGlvbigpO1xyXG5cclxuICAgICAgICAgICAgaWYgKCFjaGFuZ2VkICYmIGFwcGxpZWRTYXRpc2ZpZXMoXHJcbiAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgbW9kdWxlcyxcclxuICAgICAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlcyxcclxuICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kLFxyXG4gICAgICAgICAgICAgICAgc3BpbmVCYWNrZW5kLFxyXG4gICAgICAgICAgICAgICAgcGh5c2ljczJkQmFja2VuZCxcclxuICAgICAgICAgICAgICAgIHByb2ZpbGVNb2RpZmllZE1zXHJcbiAgICAgICAgICAgICkpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuY2xlYXJUcmFuc2FjdGlvbigpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUgYW5kIHRoZSBhY3RpdmUgcHJldmlldyBpbXBvcnQgbWFwIGFyZSBzeW5jaHJvbml6ZWQuJyxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICd2ZXJpZmllZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRBZnRlcjogYXBwbGllZEJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNhY3Rpb246IHBlbmRpbmcgPyB7IHJlY292ZXJlZDogdHJ1ZSwgYXR0ZW1wdHM6IHBlbmRpbmcuYXR0ZW1wdHMgfHwgMSB9IDogbnVsbFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghcmVsb2FkUmVxdWVzdGVkKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ZlYXR1cmUgQ3JvcHBpbmcgcHJvZmlsZSBpcyBwZXJzaXN0ZWQsIGJ1dCBlbmdpbmUgcmVsb2FkIHdhcyBleHBsaWNpdGx5IHNraXBwZWQuJyxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAncHJvZmlsZS1wZXJzaXN0ZWQtcmVsb2FkLXNraXBwZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gQSBDb2NvcyBwcm9jZXNzIGNhbm5vdCByZWxpYWJseSBhY2tub3dsZWRnZSB0aGUgUlBDIHRoYXQgZGVzdHJveXMgaXRzIG93blxyXG4gICAgICAgICAgICAvLyBNQ1AgdHJhbnNwb3J0LiBLZWVwIHJlbGF1bmNoIG91dHNpZGUgdGhpcyBleHRlbnNpb246IHRoZSBzaGFyZWQta2l0XHJcbiAgICAgICAgICAgIC8vIHN1cGVydmlzb3IgY2FuIHZlcmlmeSBleGFjdCBwcm9qZWN0L1BJRCBvd25lcnNoaXAsIHJlc3RhcnQgaXQsIHJlY29ubmVjdCxcclxuICAgICAgICAgICAgLy8gYW5kIHRoZW4gcHJvdmUgdGhhdCB0aGUgcmVnZW5lcmF0ZWQgcHJldmlldyBpbXBvcnQgbWFwIGlzIGN1cnJlbnQuXHJcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoaW5nUGVuZGluZyA9IHBlbmRpbmc/LnNpZ25hdHVyZSA9PT0gc2lnbmF0dXJlXHJcbiAgICAgICAgICAgICAgICAmJiAocGVuZGluZz8uc3RhdHVzID09PSAncmVzdGFydC1yZXF1aXJlZCcgfHwgcGVuZGluZz8uc3RhdHVzID09PSAnZWRpdG9yLXJlbGF1bmNoLXNjaGVkdWxlZCcpO1xyXG4gICAgICAgICAgICBpZiAobWF0Y2hpbmdQZW5kaW5nKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ZlYXR1cmUgQ3JvcHBpbmcgaXMgcGVyc2lzdGVkIGFuZCByZWJ1aWx0LCBidXQgdGhlIGFjdGl2ZSBwcmV2aWV3IGltcG9ydCBtYXAgaXMgc3RpbGwgc3RhbGUuIFJlc3RhcnQgdGhpcyBleGFjdCBDb2NvcyBwcm9qZWN0IGV4dGVybmFsbHksIHRoZW4gY2FsbCBnZXRfZmVhdHVyZXMgYWdhaW4uJyxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAncmVzdGFydC1yZXF1aXJlZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiB7IC4uLnBlbmRpbmcsIHJlY292ZXJlZDogdHJ1ZSwgZXh0ZXJuYWxSZXN0YXJ0UmVxdWlyZWQ6IHRydWUgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFByb3RlY3QgdW5zYXZlZCBzY2VuZSB3b3JrIGJlZm9yZSBzY2hlZHVsaW5nIGFuIEVkaXRvciByZWxhdW5jaC5cclxuICAgICAgICAgICAgbGV0IHNjZW5lV2FzRGlydHkgPSBmYWxzZTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpcnR5UmVzdWx0OiBhbnkgPSBhd2FpdCB3aXRoVGltZW91dChcclxuICAgICAgICAgICAgICAgICAgICAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1kaXJ0eScpLFxyXG4gICAgICAgICAgICAgICAgICAgIDEwMDAwLFxyXG4gICAgICAgICAgICAgICAgICAgICdzY2VuZSBkaXJ0eSBxdWVyeSdcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICBzY2VuZVdhc0RpcnR5ID0gQm9vbGVhbihkaXJ0eVJlc3VsdD8uZGlydHkgPz8gZGlydHlSZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHNjZW5lV2FzRGlydHkpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB3aXRoVGltZW91dChcclxuICAgICAgICAgICAgICAgICAgICAgICAgKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAzMDAwMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NjZW5lIHNhdmUgYmVmb3JlIEVkaXRvciByZWxhdW5jaCdcclxuICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgUmVmdXNpbmcgdG8gcmVsYXVuY2ggQ29jb3MgRWRpdG9yIGJlY2F1c2UgdGhlIGN1cnJlbnQgc2NlbmUgY291bGQgbm90IGJlIHNhZmVseSBjaGVja2VkL3NhdmVkOiAke2Vycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcil9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAnc2NlbmUtc2F2ZS1wcmVmbGlnaHQtZmFpbGVkJywgY2hhbmdlZCwgYmVmb3JlLCBhZnRlciwgYXBwbGllZEJlZm9yZSB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCByZWJ1aWxkU3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgbGV0IGVuZ2luZVJlYnVpbGQ6IGFueTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGQgPSBhd2FpdCB0aGlzLnJlYnVpbGRFbmdpbmVBbmRXYWl0KHRpbWVvdXRNcyk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBDb2NvcyBjb3VsZCBub3QgcmVidWlsZCB0aGUgY3JvcHBlZCBlbmdpbmU6ICR7ZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKX1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcGxldGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdlbmdpbmUtcmVidWlsZC1mYWlsZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkTXM6IERhdGUubm93KCkgLSByZWJ1aWxkU3RhcnRlZEF0XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb24gPSB7XHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiAxLFxyXG4gICAgICAgICAgICAgICAgc2lnbmF0dXJlLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAncmVzdGFydC1yZXF1aXJlZCcsXHJcbiAgICAgICAgICAgICAgICBhdHRlbXB0czogMSxcclxuICAgICAgICAgICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2R1bGVzOiBbLi4ubW9kdWxlc10uc29ydCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlczogWy4uLmRpc2FibGVkTW9kdWxlc10uc29ydCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kOiBwaHlzaWNzQmFja2VuZCB8fCBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIHNwaW5lQmFja2VuZDogc3BpbmVCYWNrZW5kIHx8IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgcGh5c2ljczJkQmFja2VuZDogcGh5c2ljczJkQmFja2VuZCB8fCBudWxsXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgYWZ0ZXIsXHJcbiAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZCxcclxuICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGRNczogRGF0ZS5ub3coKSAtIHJlYnVpbGRTdGFydGVkQXQsXHJcbiAgICAgICAgICAgICAgICBzY2VuZVdhc0RpcnR5XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMud3JpdGVUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUgaXMgcGVyc2lzdGVkIGFuZCB0aGUgY3JvcHBlZCBlbmdpbmUgaXMgcmVidWlsdC4gUmVzdGFydCB0aGlzIGV4YWN0IENvY29zIHByb2plY3QgZXh0ZXJuYWxseSwgdGhlbiBjYWxsIGdldF9mZWF0dXJlcyB0byBvYnRhaW4gdGhlIGZpbmFsIGltcG9ydC1tYXAgcmVjZWlwdC4nLFxyXG4gICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdyZXN0YXJ0LXJlcXVpcmVkJyxcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpZ25hdHVyZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0ZW1wdHM6IHRyYW5zYWN0aW9uLmF0dGVtcHRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkOiB0cmFuc2FjdGlvbi5lbmdpbmVSZWJ1aWxkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkTXM6IHRyYW5zYWN0aW9uLmVuZ2luZVJlYnVpbGRNcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2NlbmVXYXNEaXJ0eSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxSZXN0YXJ0UmVxdWlyZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY29ubmVjdFJlcXVpcmVkOiB0cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcbiJdfQ==