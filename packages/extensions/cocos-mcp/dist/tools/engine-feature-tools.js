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
exports.evaluateIntrinsicFeatures = evaluateIntrinsicFeatures;
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
const SHARED_ENGINE_SOURCE = 'cocos-install:bin/.cache/dev/preview/import-map.json';
function moduleSuffix(file) {
    return `/${String(file).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.ts$/, '.js')}`;
}
function overrideApplied(imports, from, to) {
    const suffix = moduleSuffix(from);
    for (const [key, value] of Object.entries(imports)) {
        if (key.endsWith(suffix))
            return typeof value === 'string' && value.endsWith(moduleSuffix(to));
    }
    return false;
}
/**
 * Cocos 3.8.x resolves intrinsic-flag features (marionette -> MARIONETTE, procedural-animation,
 * spine-3.8/4.2, vendor-google) through cc.config.json moduleOverrides baked into ONE preview
 * import map inside the editor install. Every project opened from the same install rewrites it
 * on startup/engine rebuild, so it is the only evidence of what this preview actually loads.
 */
function evaluateIntrinsicFeatures(ccConfig, importMap) {
    const imports = (importMap === null || importMap === void 0 ? void 0 : importMap.imports) && typeof importMap.imports === 'object' ? importMap.imports : {};
    const overrides = Array.isArray(ccConfig === null || ccConfig === void 0 ? void 0 : ccConfig.moduleOverrides) ? ccConfig.moduleOverrides : [];
    const features = {};
    for (const [feature, definition] of Object.entries((ccConfig === null || ccConfig === void 0 ? void 0 : ccConfig.features) || {})) {
        const intrinsic = definition === null || definition === void 0 ? void 0 : definition.intrinsicFlags;
        if (!intrinsic || typeof intrinsic !== 'object')
            continue;
        let active;
        for (const flag of Object.keys(intrinsic)) {
            for (const entry of overrides) {
                const test = String((entry === null || entry === void 0 ? void 0 : entry.test) || '').replace(/\s+/g, '');
                const negative = test === `!context.buildTimeConstants.${flag}`;
                const positive = test === `context.buildTimeConstants.${flag}`;
                if (!negative && !positive)
                    continue;
                const pairs = Object.entries((entry === null || entry === void 0 ? void 0 : entry.overrides) || {});
                if (!pairs.length)
                    continue;
                const flagActive = negative
                    ? pairs.every(([from, to]) => !overrideApplied(imports, from, to))
                    : pairs.every(([from, to]) => overrideApplied(imports, from, to));
                active = active === undefined ? flagActive : active && flagActive;
            }
        }
        if (active !== undefined)
            features[feature] = active;
    }
    return features;
}
function sharedKnows(receipt, moduleName) {
    var _a;
    return Boolean((_a = receipt.sharedEngine) === null || _a === void 0 ? void 0 : _a.available)
        && Object.prototype.hasOwnProperty.call(receipt.sharedEngine.features, moduleName);
}
function sharedMissing(receipt, modules) {
    return modules.filter((name) => sharedKnows(receipt, name) && receipt.sharedEngine.features[name] !== true);
}
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
    if (sharedKnows(receipt, moduleName))
        return receipt.sharedEngine.features[moduleName] === true;
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
    async readSharedEngineIntrinsics() {
        const unavailable = (error) => ({
            available: false,
            source: SHARED_ENGINE_SOURCE,
            features: {},
            importMapSha256: null,
            importMapModifiedMs: null,
            error
        });
        const messageApi = Editor.Message;
        if (!(messageApi === null || messageApi === void 0 ? void 0 : messageApi.request))
            return unavailable('Editor.Message is unavailable');
        let enginePath;
        try {
            const info = await withTimeout(messageApi.request('engine', 'query-info'), 10000, 'engine info query');
            enginePath = info === null || info === void 0 ? void 0 : info.path;
        }
        catch (error) {
            return unavailable((error === null || error === void 0 ? void 0 : error.message) || String(error));
        }
        if (typeof enginePath !== 'string' || !enginePath)
            return unavailable('engine query-info returned no path');
        try {
            const importMapPath = path.join(enginePath, 'bin', '.cache', 'dev', 'preview', 'import-map.json');
            const [configRaw, raw, stat] = await Promise.all([
                fs_1.promises.readFile(path.join(enginePath, 'cc.config.json'), 'utf8'),
                fs_1.promises.readFile(importMapPath, 'utf8'),
                fs_1.promises.stat(importMapPath)
            ]);
            const features = evaluateIntrinsicFeatures(JSON.parse(configRaw), JSON.parse(raw));
            const evaluable = Object.keys(features).length > 0;
            return Object.assign({ available: evaluable, source: SHARED_ENGINE_SOURCE, features, importMapSha256: (0, crypto_1.createHash)('sha256').update(raw).digest('hex'), importMapModifiedMs: stat.mtimeMs }, (evaluable ? {} : { error: 'cc.config.json declares no evaluable intrinsic-flag overrides' }));
        }
        catch (error) {
            return unavailable((error === null || error === void 0 ? void 0 : error.message) || String(error));
        }
    }
    async readAppliedPreviewFeatures() {
        var _a;
        const source = 'temp/programming/packer-driver/targets/preview/import-map.json';
        const sharedEngine = await this.readSharedEngineIntrinsics();
        const projectTmpDir = (_a = Editor.Project) === null || _a === void 0 ? void 0 : _a.tmpDir;
        if (!projectTmpDir) {
            return {
                available: false,
                features: [],
                importMapSha256: null,
                importMapModifiedMs: null,
                source,
                error: 'Editor.Project.tmpDir is unavailable',
                sharedEngine
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
                source,
                sharedEngine
            };
        }
        catch (error) {
            return {
                available: false,
                features: [],
                importMapSha256: null,
                importMapModifiedMs: null,
                source,
                error: (error === null || error === void 0 ? void 0 : error.message) || String(error),
                sharedEngine
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
            // Another project opened from the same Cocos install may have rewritten the shared
            // engine preview map since the pending restart was recorded. The in-place rebuild
            // below re-emits it for this project, so a pending restart must not short-circuit it.
            const sharedGapBefore = sharedMissing(appliedBefore, modules);
            if (matchingPending && sharedGapBefore.length === 0) {
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
            // Quick Compile re-emits the install-wide preview map from this project's profile.
            // When that closes every gap (typically a map rewritten by another open project),
            // the preview is verified without relaunching the Editor.
            const appliedAfterRebuild = await this.readAppliedPreviewFeatures();
            if (appliedSatisfies(appliedAfterRebuild, modules, disabledModules, physicsBackend, spineBackend, physics2dBackend, profileModifiedMs)) {
                await this.clearTransaction();
                return {
                    success: true,
                    message: 'The engine rebuild re-applied this project\'s features to the active preview import map.',
                    data: {
                        complete: true,
                        status: 'verified-after-rebuild',
                        changed,
                        before,
                        after,
                        appliedBefore,
                        appliedAfter: appliedAfterRebuild,
                        sharedGapBefore,
                        engineRebuild,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLWZlYXR1cmUtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvZW5naW5lLWZlYXR1cmUtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBK0NBLDhEQXlCQztBQXZFRCxtQ0FBb0M7QUFDcEMsMkJBQW9DO0FBQ3BDLDJDQUE2QjtBQUU3QixNQUFNLGdCQUFnQixHQUFHO0lBQ3JCLGlCQUFpQjtJQUNqQixnQkFBZ0I7SUFDaEIsY0FBYztJQUNkLGVBQWU7Q0FDVCxDQUFDO0FBSVgsTUFBTSxjQUFjLEdBQUcsQ0FBQyxXQUFXLEVBQUUsV0FBVyxDQUFVLENBQUM7QUFHM0QsTUFBTSxtQkFBbUIsR0FBRztJQUN4QixrQkFBa0I7SUFDbEIsdUJBQXVCO0lBQ3ZCLG9CQUFvQjtJQUNwQixzQkFBc0I7Q0FDaEIsQ0FBQztBQUdYLE1BQU0sc0JBQXNCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQztBQUNoRSxNQUFNLDBCQUEwQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztBQUMzRCxNQUFNLG9CQUFvQixHQUFHLHNEQUFzRCxDQUFDO0FBRXBGLFNBQVMsWUFBWSxDQUFDLElBQVk7SUFDOUIsT0FBTyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRSxDQUFDO0FBQzlGLENBQUM7QUFFRCxTQUFTLGVBQWUsQ0FBQyxPQUFnQyxFQUFFLElBQVksRUFBRSxFQUFVO0lBQy9FLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNs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QVEsRUFBRSxXQUFXLENBQUMsUUFBUTt3QkFDOUIsYUFBYSxFQUFFLFdBQVcsQ0FBQyxhQUFhO3dCQUN4QyxlQUFlLEVBQUUsV0FBVyxDQUFDLGVBQWU7d0JBQzVDLGFBQWE7d0JBQ2IsdUJBQXVCLEVBQUUsSUFBSTt3QkFDN0IsaUJBQWlCLEVBQUUsSUFBSTtxQkFDMUI7aUJBQ0o7YUFDSixDQUFDO1FBQ04sQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDbEIsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN0RSxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBcHRCRCxnREFvdEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVG9vbERlZmluaXRpb24sIFRvb2xFeGVjdXRvciwgVG9vbFJlc3BvbnNlIH0gZnJvbSAnLi4vdHlwZXMnO1xyXG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcclxuaW1wb3J0IHsgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcblxyXG5jb25zdCBQSFlTSUNTX0JBQ0tFTkRTID0gW1xyXG4gICAgJ3BoeXNpY3MtYnVpbHRpbicsXHJcbiAgICAncGh5c2ljcy1jYW5ub24nLFxyXG4gICAgJ3BoeXNpY3MtYW1tbycsXHJcbiAgICAncGh5c2ljcy1waHlzeCdcclxuXSBhcyBjb25zdDtcclxuXHJcbnR5cGUgUGh5c2ljc0JhY2tlbmQgPSB0eXBlb2YgUEhZU0lDU19CQUNLRU5EU1tudW1iZXJdO1xyXG5cclxuY29uc3QgU1BJTkVfQkFDS0VORFMgPSBbJ3NwaW5lLTMuOCcsICdzcGluZS00LjInXSBhcyBjb25zdDtcclxudHlwZSBTcGluZUJhY2tlbmQgPSB0eXBlb2YgU1BJTkVfQkFDS0VORFNbbnVtYmVyXTtcclxuXHJcbmNvbnN0IFBIWVNJQ1NfMkRfQkFDS0VORFMgPSBbXHJcbiAgICAncGh5c2ljcy0yZC1ib3gyZCcsXHJcbiAgICAncGh5c2ljcy0yZC1ib3gyZC13YXNtJyxcclxuICAgICdwaHlzaWNzLTJkLWJ1aWx0aW4nLFxyXG4gICAgJ3BoeXNpY3MtMmQtYm94MmQtanNiJ1xyXG5dIGFzIGNvbnN0O1xyXG50eXBlIFBoeXNpY3MyZEJhY2tlbmQgPSB0eXBlb2YgUEhZU0lDU18yRF9CQUNLRU5EU1tudW1iZXJdO1xyXG5cclxuY29uc3QgT1BUSU9OX1BBUkVOVF9GRUFUVVJFUyA9IG5ldyBTZXQoWydzcGluZScsICdwaHlzaWNzLTJkJ10pO1xyXG5jb25zdCBJTVBPUlRfTUFQX1NJTEVOVF9GRUFUVVJFUyA9IG5ldyBTZXQoWydtYXJpb25ldHRlJ10pO1xyXG5jb25zdCBTSEFSRURfRU5HSU5FX1NPVVJDRSA9ICdjb2Nvcy1pbnN0YWxsOmJpbi8uY2FjaGUvZGV2L3ByZXZpZXcvaW1wb3J0LW1hcC5qc29uJztcclxuXHJcbmZ1bmN0aW9uIG1vZHVsZVN1ZmZpeChmaWxlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGAvJHtTdHJpbmcoZmlsZSkucmVwbGFjZSgvXFxcXC9nLCAnLycpLnJlcGxhY2UoL15cXC8rLywgJycpLnJlcGxhY2UoL1xcLnRzJC8sICcuanMnKX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvdmVycmlkZUFwcGxpZWQoaW1wb3J0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGZyb206IHN0cmluZywgdG86IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgY29uc3Qgc3VmZml4ID0gbW9kdWxlU3VmZml4KGZyb20pO1xyXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoaW1wb3J0cykpIHtcclxuICAgICAgICBpZiAoa2V5LmVuZHNXaXRoKHN1ZmZpeCkpIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmIHZhbHVlLmVuZHNXaXRoKG1vZHVsZVN1ZmZpeCh0bykpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG4vKipcclxuICogQ29jb3MgMy44LnggcmVzb2x2ZXMgaW50cmluc2ljLWZsYWcgZmVhdHVyZXMgKG1hcmlvbmV0dGUgLT4gTUFSSU9ORVRURSwgcHJvY2VkdXJhbC1hbmltYXRpb24sXHJcbiAqIHNwaW5lLTMuOC80LjIsIHZlbmRvci1nb29nbGUpIHRocm91Z2ggY2MuY29uZmlnLmpzb24gbW9kdWxlT3ZlcnJpZGVzIGJha2VkIGludG8gT05FIHByZXZpZXdcclxuICogaW1wb3J0IG1hcCBpbnNpZGUgdGhlIGVkaXRvciBpbnN0YWxsLiBFdmVyeSBwcm9qZWN0IG9wZW5lZCBmcm9tIHRoZSBzYW1lIGluc3RhbGwgcmV3cml0ZXMgaXRcclxuICogb24gc3RhcnR1cC9lbmdpbmUgcmVidWlsZCwgc28gaXQgaXMgdGhlIG9ubHkgZXZpZGVuY2Ugb2Ygd2hhdCB0aGlzIHByZXZpZXcgYWN0dWFsbHkgbG9hZHMuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVJbnRyaW5zaWNGZWF0dXJlcyhjY0NvbmZpZzogYW55LCBpbXBvcnRNYXA6IGFueSk6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGltcG9ydHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0gaW1wb3J0TWFwPy5pbXBvcnRzICYmIHR5cGVvZiBpbXBvcnRNYXAuaW1wb3J0cyA9PT0gJ29iamVjdCcgPyBpbXBvcnRNYXAuaW1wb3J0cyA6IHt9O1xyXG4gICAgY29uc3Qgb3ZlcnJpZGVzOiBhbnlbXSA9IEFycmF5LmlzQXJyYXkoY2NDb25maWc/Lm1vZHVsZU92ZXJyaWRlcykgPyBjY0NvbmZpZy5tb2R1bGVPdmVycmlkZXMgOiBbXTtcclxuICAgIGNvbnN0IGZlYXR1cmVzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuPiA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBbZmVhdHVyZSwgZGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXM8YW55PihjY0NvbmZpZz8uZmVhdHVyZXMgfHwge30pKSB7XHJcbiAgICAgICAgY29uc3QgaW50cmluc2ljID0gZGVmaW5pdGlvbj8uaW50cmluc2ljRmxhZ3M7XHJcbiAgICAgICAgaWYgKCFpbnRyaW5zaWMgfHwgdHlwZW9mIGludHJpbnNpYyAhPT0gJ29iamVjdCcpIGNvbnRpbnVlO1xyXG4gICAgICAgIGxldCBhY3RpdmU6IGJvb2xlYW4gfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgZm9yIChjb25zdCBmbGFnIG9mIE9iamVjdC5rZXlzKGludHJpbnNpYykpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBvdmVycmlkZXMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHRlc3QgPSBTdHJpbmcoZW50cnk/LnRlc3QgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbmVnYXRpdmUgPSB0ZXN0ID09PSBgIWNvbnRleHQuYnVpbGRUaW1lQ29uc3RhbnRzLiR7ZmxhZ31gO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpdmUgPSB0ZXN0ID09PSBgY29udGV4dC5idWlsZFRpbWVDb25zdGFudHMuJHtmbGFnfWA7XHJcbiAgICAgICAgICAgICAgICBpZiAoIW5lZ2F0aXZlICYmICFwb3NpdGl2ZSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwYWlycyA9IE9iamVjdC5lbnRyaWVzPHN0cmluZz4oZW50cnk/Lm92ZXJyaWRlcyB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXBhaXJzLmxlbmd0aCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmbGFnQWN0aXZlID0gbmVnYXRpdmVcclxuICAgICAgICAgICAgICAgICAgICA/IHBhaXJzLmV2ZXJ5KChbZnJvbSwgdG9dKSA9PiAhb3ZlcnJpZGVBcHBsaWVkKGltcG9ydHMsIGZyb20sIHRvKSlcclxuICAgICAgICAgICAgICAgICAgICA6IHBhaXJzLmV2ZXJ5KChbZnJvbSwgdG9dKSA9PiBvdmVycmlkZUFwcGxpZWQoaW1wb3J0cywgZnJvbSwgdG8pKTtcclxuICAgICAgICAgICAgICAgIGFjdGl2ZSA9IGFjdGl2ZSA9PT0gdW5kZWZpbmVkID8gZmxhZ0FjdGl2ZSA6IGFjdGl2ZSAmJiBmbGFnQWN0aXZlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChhY3RpdmUgIT09IHVuZGVmaW5lZCkgZmVhdHVyZXNbZmVhdHVyZV0gPSBhY3RpdmU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmVhdHVyZXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNoYXJlZEtub3dzKHJlY2VpcHQ6IEFwcGxpZWRGZWF0dXJlUmVjZWlwdCwgbW9kdWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gQm9vbGVhbihyZWNlaXB0LnNoYXJlZEVuZ2luZT8uYXZhaWxhYmxlKVxyXG4gICAgICAgICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZWNlaXB0LnNoYXJlZEVuZ2luZSEuZmVhdHVyZXMsIG1vZHVsZU5hbWUpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzaGFyZWRNaXNzaW5nKHJlY2VpcHQ6IEFwcGxpZWRGZWF0dXJlUmVjZWlwdCwgbW9kdWxlczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XHJcbiAgICByZXR1cm4gbW9kdWxlcy5maWx0ZXIoKG5hbWUpID0+IHNoYXJlZEtub3dzKHJlY2VpcHQsIG5hbWUpICYmIHJlY2VpcHQuc2hhcmVkRW5naW5lIS5mZWF0dXJlc1tuYW1lXSAhPT0gdHJ1ZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNsZWVwKG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiB3aXRoVGltZW91dDxUPihwcm9taXNlOiBQcm9taXNlPFQ+LCB0aW1lb3V0TXM6IG51bWJlciwgbGFiZWw6IHN0cmluZyk6IFByb21pc2U8VD4ge1xyXG4gICAgbGV0IHRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZDtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UucmFjZShbXHJcbiAgICAgICAgICAgIHByb21pc2UsXHJcbiAgICAgICAgICAgIG5ldyBQcm9taXNlPFQ+KChfcmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgJHtsYWJlbH0gdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYCkpLCB0aW1lb3V0TXMpO1xyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIF0pO1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgICBpZiAodGltZXIpIGNsZWFyVGltZW91dCh0aW1lcik7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNsb25lPFQ+KHZhbHVlOiBUKTogVCB7XHJcbiAgICByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh2YWx1ZSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB2YWxpZEZlYXR1cmVOYW1lKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgc3RyaW5nIHtcclxuICAgIC8vIENvY29zIDMuOC44IGV4cG9zZXMgdmVyc2lvbmVkIGNhY2hlIElEcyBzdWNoIGFzIGBzcGluZS00LjJgLlxyXG4gICAgLy8gRG90cyBhcmUgYWNjZXB0ZWQgb25seSBhcyBzZXBhcmF0b3JzIGJldHdlZW4gbm9uLWVtcHR5LCBsb3dlci1jYXNlXHJcbiAgICAvLyBhbHBoYW51bWVyaWMvaHlwaGVuIHNlZ21lbnRzOyBwYXRocywgdHJhdmVyc2FsIGFuZCBhcmJpdHJhcnkgcHVuY3R1YXRpb25cclxuICAgIC8vIHJlbWFpbiBpbnZhbGlkLCBhbmQgdGhlIHByb2ZpbGUgY2FjaGUgaXMgc3RpbGwgdGhlIGF1dGhvcml0eSBmb3IgbmFtZXMuXHJcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJ1xyXG4gICAgICAgICYmIC9eW2EtejAtOV0oPzpbYS16MC05LV0qW2EtejAtOV0pPyg/OlxcLlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT8pKiQvLnRlc3QodmFsdWUpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhY3RpdmVDb25maWcocHJvZmlsZTogYW55KTogYW55IHtcclxuICAgIGNvbnN0IGtleSA9IHByb2ZpbGU/Lmdsb2JhbENvbmZpZ0tleSB8fCAnZGVmYXVsdENvbmZpZyc7XHJcbiAgICBjb25zdCBjb25maWcgPSBwcm9maWxlPy5jb25maWdzPy5ba2V5XTtcclxuICAgIGlmICghY29uZmlnIHx8IHR5cGVvZiBjb25maWcgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbmdpbmUgZmVhdHVyZSBwcm9maWxlIGlzIG1pc3NpbmcgY29uZmlncy4ke2tleX1gKTtcclxuICAgIH1cclxuICAgIGNvbmZpZy5jYWNoZSB8fD0ge307XHJcbiAgICBjb25maWcuaW5jbHVkZU1vZHVsZXMgfHw9IFtdO1xyXG4gICAgcmV0dXJuIGNvbmZpZztcclxufVxyXG5cclxuZnVuY3Rpb24gc25hcHNob3QocHJvZmlsZTogYW55KTogYW55IHtcclxuICAgIGNvbnN0IGtleSA9IHByb2ZpbGU/Lmdsb2JhbENvbmZpZ0tleSB8fCAnZGVmYXVsdENvbmZpZyc7XHJcbiAgICBjb25zdCBjb25maWcgPSBhY3RpdmVDb25maWcocHJvZmlsZSk7XHJcbiAgICBjb25zdCBjYWNoZSA9IGNvbmZpZy5jYWNoZSB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgY29uZmlnS2V5OiBrZXksXHJcbiAgICAgICAgaW5jbHVkZU1vZHVsZXM6IFsuLi4oY29uZmlnLmluY2x1ZGVNb2R1bGVzIHx8IFtdKV0sXHJcbiAgICAgICAgcGh5c2ljc0JhY2tlbmQ6IGNhY2hlLnBoeXNpY3M/Ll9vcHRpb24gfHwgbnVsbCxcclxuICAgICAgICBzcGluZUJhY2tlbmQ6IGNhY2hlLnNwaW5lPy5fb3B0aW9uIHx8IG51bGwsXHJcbiAgICAgICAgcGh5c2ljczJkQmFja2VuZDogY2FjaGVbJ3BoeXNpY3MtMmQnXT8uX29wdGlvbiB8fCBudWxsLFxyXG4gICAgICAgIGVuYWJsZWQ6IE9iamVjdC5rZXlzKGNhY2hlKS5maWx0ZXIoKG5hbWUpID0+IGNhY2hlW25hbWVdPy5fdmFsdWUgPT09IHRydWUpLnNvcnQoKVxyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gcHJvZmlsZVNlbGVjdGlvbkluY2x1ZGVzKHNuYXBzaG90VmFsdWU6IGFueSwgbW9kdWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBpZiAoc25hcHNob3RWYWx1ZS5pbmNsdWRlTW9kdWxlcy5pbmNsdWRlcyhtb2R1bGVOYW1lKSkgcmV0dXJuIHRydWU7XHJcbiAgICBpZiAoIU9QVElPTl9QQVJFTlRfRkVBVFVSRVMuaGFzKG1vZHVsZU5hbWUpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBjb25zdCBzZWxlY3RlZCA9IG1vZHVsZU5hbWUgPT09ICdzcGluZSdcclxuICAgICAgICA/IHNuYXBzaG90VmFsdWUuc3BpbmVCYWNrZW5kXHJcbiAgICAgICAgOiBzbmFwc2hvdFZhbHVlLnBoeXNpY3MyZEJhY2tlbmQ7XHJcbiAgICByZXR1cm4gc25hcHNob3RWYWx1ZS5lbmFibGVkLmluY2x1ZGVzKG1vZHVsZU5hbWUpXHJcbiAgICAgICAgJiYgdHlwZW9mIHNlbGVjdGVkID09PSAnc3RyaW5nJ1xyXG4gICAgICAgICYmIHNuYXBzaG90VmFsdWUuZW5hYmxlZC5pbmNsdWRlcyhzZWxlY3RlZClcclxuICAgICAgICAmJiBzbmFwc2hvdFZhbHVlLmluY2x1ZGVNb2R1bGVzLmluY2x1ZGVzKHNlbGVjdGVkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYXBwbGllZEZlYXR1cmVQcmVzZW50KFxyXG4gICAgcmVjZWlwdDogQXBwbGllZEZlYXR1cmVSZWNlaXB0LFxyXG4gICAgbW9kdWxlTmFtZTogc3RyaW5nLFxyXG4gICAgcHJldmlld0ZyZXNoOiBib29sZWFuLFxyXG4gICAgc3BpbmVCYWNrZW5kPzogU3BpbmVCYWNrZW5kXHJcbik6IGJvb2xlYW4ge1xyXG4gICAgaWYgKHNoYXJlZEtub3dzKHJlY2VpcHQsIG1vZHVsZU5hbWUpKSByZXR1cm4gcmVjZWlwdC5zaGFyZWRFbmdpbmUhLmZlYXR1cmVzW21vZHVsZU5hbWVdID09PSB0cnVlO1xyXG4gICAgaWYgKHJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMobW9kdWxlTmFtZSkpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKElNUE9SVF9NQVBfU0lMRU5UX0ZFQVRVUkVTLmhhcyhtb2R1bGVOYW1lKSkgcmV0dXJuIHByZXZpZXdGcmVzaDtcclxuICAgIGlmIChtb2R1bGVOYW1lID09PSAncGh5c2ljcy0yZCcpIHtcclxuICAgICAgICByZXR1cm4gcHJldmlld0ZyZXNoICYmIHJlY2VpcHQuZmVhdHVyZXMuaW5jbHVkZXMoJ3BoeXNpY3MtMmQtZnJhbWV3b3JrJyk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcHJldmlld0ZyZXNoXHJcbiAgICAgICAgJiYgU1BJTkVfQkFDS0VORFMuaW5jbHVkZXMobW9kdWxlTmFtZSBhcyBTcGluZUJhY2tlbmQpXHJcbiAgICAgICAgJiYgc3BpbmVCYWNrZW5kID09PSBtb2R1bGVOYW1lXHJcbiAgICAgICAgJiYgcmVjZWlwdC5mZWF0dXJlcy5pbmNsdWRlcygnc3BpbmUnKTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNoYXJlZEVuZ2luZVJlY2VpcHQge1xyXG4gICAgYXZhaWxhYmxlOiBib29sZWFuO1xyXG4gICAgc291cmNlOiBzdHJpbmc7XHJcbiAgICBmZWF0dXJlczogUmVjb3JkPHN0cmluZywgYm9vbGVhbj47XHJcbiAgICBpbXBvcnRNYXBTaGEyNTY6IHN0cmluZyB8IG51bGw7XHJcbiAgICBpbXBvcnRNYXBNb2RpZmllZE1zOiBudW1iZXIgfCBudWxsO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBBcHBsaWVkRmVhdHVyZVJlY2VpcHQge1xyXG4gICAgYXZhaWxhYmxlOiBib29sZWFuO1xyXG4gICAgZmVhdHVyZXM6IHN0cmluZ1tdO1xyXG4gICAgaW1wb3J0TWFwU2hhMjU2OiBzdHJpbmcgfCBudWxsO1xyXG4gICAgaW1wb3J0TWFwTW9kaWZpZWRNczogbnVtYmVyIHwgbnVsbDtcclxuICAgIHNvdXJjZTogc3RyaW5nO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgICBzaGFyZWRFbmdpbmU/OiBTaGFyZWRFbmdpbmVSZWNlaXB0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBhcHBsaWVkU2F0aXNmaWVzKFxyXG4gICAgcmVjZWlwdDogQXBwbGllZEZlYXR1cmVSZWNlaXB0LFxyXG4gICAgbW9kdWxlczogc3RyaW5nW10sXHJcbiAgICBkaXNhYmxlZE1vZHVsZXM6IHN0cmluZ1tdLFxyXG4gICAgcGh5c2ljc0JhY2tlbmQ/OiBQaHlzaWNzQmFja2VuZCxcclxuICAgIHNwaW5lQmFja2VuZD86IFNwaW5lQmFja2VuZCxcclxuICAgIHBoeXNpY3MyZEJhY2tlbmQ/OiBQaHlzaWNzMmRCYWNrZW5kLFxyXG4gICAgbWluaW11bUFwcGxpZWRNb2RpZmllZE1zPzogbnVtYmVyIHwgbnVsbFxyXG4pOiBib29sZWFuIHtcclxuICAgIGlmICghcmVjZWlwdC5hdmFpbGFibGUpIHJldHVybiBmYWxzZTtcclxuICAgIGNvbnN0IHByZXZpZXdGcmVzaCA9IE51bWJlci5pc0Zpbml0ZShyZWNlaXB0LmltcG9ydE1hcE1vZGlmaWVkTXMpXHJcbiAgICAgICAgJiYgTnVtYmVyLmlzRmluaXRlKG1pbmltdW1BcHBsaWVkTW9kaWZpZWRNcylcclxuICAgICAgICAmJiBOdW1iZXIocmVjZWlwdC5pbXBvcnRNYXBNb2RpZmllZE1zKSA+PSBOdW1iZXIobWluaW11bUFwcGxpZWRNb2RpZmllZE1zKTtcclxuICAgIGlmIChtb2R1bGVzLnNvbWUoKG5hbWUpID0+ICFhcHBsaWVkRmVhdHVyZVByZXNlbnQocmVjZWlwdCwgbmFtZSwgcHJldmlld0ZyZXNoLCBzcGluZUJhY2tlbmQpKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKGRpc2FibGVkTW9kdWxlcy5zb21lKChuYW1lKSA9PiByZWNlaXB0LmZlYXR1cmVzLmluY2x1ZGVzKG5hbWUpKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHBoeXNpY3NCYWNrZW5kICYmICFyZWNlaXB0LmZlYXR1cmVzLmluY2x1ZGVzKHBoeXNpY3NCYWNrZW5kKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHNwaW5lQmFja2VuZCAmJiAhYXBwbGllZEZlYXR1cmVQcmVzZW50KHJlY2VpcHQsIHNwaW5lQmFja2VuZCwgcHJldmlld0ZyZXNoLCBzcGluZUJhY2tlbmQpKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gIXBoeXNpY3MyZEJhY2tlbmQgfHwgcmVjZWlwdC5mZWF0dXJlcy5pbmNsdWRlcyhwaHlzaWNzMmRCYWNrZW5kKTtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIEVuZ2luZUZlYXR1cmVUb29scyBpbXBsZW1lbnRzIFRvb2xFeGVjdXRvciB7XHJcbiAgICBnZXRUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcclxuICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X2ZlYXR1cmVzJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVhZCB0aGUgYWN0aXZlIENvY29zIEZlYXR1cmUgQ3JvcHBpbmcgcHJvZmlsZSBhbmQgc2VsZWN0ZWQgcGh5c2ljcyBiYWNrZW5kLicsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogeyB0eXBlOiAnb2JqZWN0JywgcHJvcGVydGllczoge30gfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZW5zdXJlX2ZlYXR1cmVzJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRW5hYmxlIHJlcXVpcmVkIEZlYXR1cmUgQ3JvcHBpbmcgbW9kdWxlcyB0aHJvdWdoIEVkaXRvci5Qcm9maWxlIGFuZCByZWJ1aWxkIHRoZSBjcm9wcGVkIGVuZ2luZS4gV2hlbiBkYXRhLnN0YXR1cyBpcyByZXN0YXJ0LXJlcXVpcmVkLCByZXN0YXJ0IHRoZSBleGFjdCBwcm9qZWN0IGZyb20gYW4gZXh0ZXJuYWwgc3VwZXJ2aXNvciBhbmQgY2FsbCBnZXRfZmVhdHVyZXMgYWdhaW47IGRhdGEuY29tcGxldGUgaXMgdHJ1ZSBvbmx5IGFmdGVyIHRoZSBhY3RpdmUgcHJldmlldyBpbXBvcnQgbWFwIGlzIHZlcmlmaWVkLicsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kdWxlczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjogJ15bYS16MC05XSg/OlthLXowLTktXSpbYS16MC05XSk/KD86XFxcXC5bYS16MC05XSg/OlthLXowLTktXSpbYS16MC05XSk/KSokJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heEl0ZW1zOiA2NCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IFtdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnS25vd24gRmVhdHVyZSBDcm9wcGluZyBtb2R1bGVzIHRoYXQgdGhpcyBleGFjdCBzb3VyY2UgY2xvc3VyZSByZXF1aXJlcyB0byByZW1haW4gZGlzYWJsZWQuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjogJ15bYS16MC05XSg/OlthLXowLTktXSpbYS16MC05XSk/KD86XFxcXC5bYS16MC05XSg/OlthLXowLTktXSpbYS16MC05XSk/KSokJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heEl0ZW1zOiA2NCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IFtdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVudW06IFsuLi5QSFlTSUNTX0JBQ0tFTkRTXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzcGluZUJhY2tlbmQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWy4uLlNQSU5FX0JBQ0tFTkRTXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwaHlzaWNzMmRCYWNrZW5kOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVudW06IFsuLi5QSFlTSUNTXzJEX0JBQ0tFTkRTXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWxvYWQ6IHsgdHlwZTogJ2Jvb2xlYW4nLCBkZWZhdWx0OiB0cnVlIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVvdXRNczogeyB0eXBlOiAnaW50ZWdlcicsIG1pbmltdW06IDEwMDAsIG1heGltdW06IDMwMDAwMCwgZGVmYXVsdDogMjQwMDAwIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGV4ZWN1dGUodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICBpZiAodG9vbE5hbWUgPT09ICdnZXRfZmVhdHVyZXMnKSByZXR1cm4gdGhpcy5nZXRGZWF0dXJlcygpO1xyXG4gICAgICAgIGlmICh0b29sTmFtZSA9PT0gJ2Vuc3VyZV9mZWF0dXJlcycpIHJldHVybiB0aGlzLmVuc3VyZUZlYXR1cmVzKGFyZ3MgfHwge30pO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFVua25vd24gZW5naW5lRmVhdHVyZSB0b29sOiAke3Rvb2xOYW1lfWAgfTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHJlYWRQcm9maWxlKCk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XHJcbiAgICAgICAgaWYgKCFwcm9maWxlQXBpPy5nZXRQcm9qZWN0KSB0aHJvdyBuZXcgRXJyb3IoJ0VkaXRvci5Qcm9maWxlLmdldFByb2plY3QgaXMgdW5hdmFpbGFibGUnKTtcclxuICAgICAgICBjb25zdCBwcm9maWxlID0gYXdhaXQgcHJvZmlsZUFwaS5nZXRQcm9qZWN0KCdlbmdpbmUnLCAnbW9kdWxlcycpO1xyXG4gICAgICAgIGlmICghcHJvZmlsZSkgdGhyb3cgbmV3IEVycm9yKCdDb2NvcyByZXR1cm5lZCBhbiBlbXB0eSBlbmdpbmUgRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlJyk7XHJcbiAgICAgICAgcmV0dXJuIHByb2ZpbGU7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBnZXRGZWF0dXJlcygpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLnNuYXBzaG90KGF3YWl0IHRoaXMucmVhZFByb2ZpbGUoKSksXHJcbiAgICAgICAgICAgICAgICAgICAgYXBwbGllZFByZXZpZXc6IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcmVhZFNoYXJlZEVuZ2luZUludHJpbnNpY3MoKTogUHJvbWlzZTxTaGFyZWRFbmdpbmVSZWNlaXB0PiB7XHJcbiAgICAgICAgY29uc3QgdW5hdmFpbGFibGUgPSAoZXJyb3I6IHN0cmluZyk6IFNoYXJlZEVuZ2luZVJlY2VpcHQgPT4gKHtcclxuICAgICAgICAgICAgYXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgc291cmNlOiBTSEFSRURfRU5HSU5FX1NPVVJDRSxcclxuICAgICAgICAgICAgZmVhdHVyZXM6IHt9LFxyXG4gICAgICAgICAgICBpbXBvcnRNYXBTaGEyNTY6IG51bGwsXHJcbiAgICAgICAgICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IG51bGwsXHJcbiAgICAgICAgICAgIGVycm9yXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29uc3QgbWVzc2FnZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2U7XHJcbiAgICAgICAgaWYgKCFtZXNzYWdlQXBpPy5yZXF1ZXN0KSByZXR1cm4gdW5hdmFpbGFibGUoJ0VkaXRvci5NZXNzYWdlIGlzIHVuYXZhaWxhYmxlJyk7XHJcbiAgICAgICAgbGV0IGVuZ2luZVBhdGg6IHVua25vd247XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaW5mbzogYW55ID0gYXdhaXQgd2l0aFRpbWVvdXQobWVzc2FnZUFwaS5yZXF1ZXN0KCdlbmdpbmUnLCAncXVlcnktaW5mbycpLCAxMDAwMCwgJ2VuZ2luZSBpbmZvIHF1ZXJ5Jyk7XHJcbiAgICAgICAgICAgIGVuZ2luZVBhdGggPSBpbmZvPy5wYXRoO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHVuYXZhaWxhYmxlKGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcikpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodHlwZW9mIGVuZ2luZVBhdGggIT09ICdzdHJpbmcnIHx8ICFlbmdpbmVQYXRoKSByZXR1cm4gdW5hdmFpbGFibGUoJ2VuZ2luZSBxdWVyeS1pbmZvIHJldHVybmVkIG5vIHBhdGgnKTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXBQYXRoID0gcGF0aC5qb2luKGVuZ2luZVBhdGgsICdiaW4nLCAnLmNhY2hlJywgJ2RldicsICdwcmV2aWV3JywgJ2ltcG9ydC1tYXAuanNvbicpO1xyXG4gICAgICAgICAgICBjb25zdCBbY29uZmlnUmF3LCByYXcsIHN0YXRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICAgICAgICAgICAgZnMucmVhZEZpbGUocGF0aC5qb2luKGVuZ2luZVBhdGgsICdjYy5jb25maWcuanNvbicpLCAndXRmOCcpLFxyXG4gICAgICAgICAgICAgICAgZnMucmVhZEZpbGUoaW1wb3J0TWFwUGF0aCwgJ3V0ZjgnKSxcclxuICAgICAgICAgICAgICAgIGZzLnN0YXQoaW1wb3J0TWFwUGF0aClcclxuICAgICAgICAgICAgXSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZlYXR1cmVzID0gZXZhbHVhdGVJbnRyaW5zaWNGZWF0dXJlcyhKU09OLnBhcnNlKGNvbmZpZ1JhdyksIEpTT04ucGFyc2UocmF3KSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGV2YWx1YWJsZSA9IE9iamVjdC5rZXlzKGZlYXR1cmVzKS5sZW5ndGggPiAwO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlOiBldmFsdWFibGUsXHJcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFNIQVJFRF9FTkdJTkVfU09VUkNFLFxyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMsXHJcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBTaGEyNTY6IGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShyYXcpLmRpZ2VzdCgnaGV4JyksXHJcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBNb2RpZmllZE1zOiBzdGF0Lm10aW1lTXMsXHJcbiAgICAgICAgICAgICAgICAuLi4oZXZhbHVhYmxlID8ge30gOiB7IGVycm9yOiAnY2MuY29uZmlnLmpzb24gZGVjbGFyZXMgbm8gZXZhbHVhYmxlIGludHJpbnNpYy1mbGFnIG92ZXJyaWRlcycgfSlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1bmF2YWlsYWJsZShlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyByZWFkQXBwbGllZFByZXZpZXdGZWF0dXJlcygpOiBQcm9taXNlPEFwcGxpZWRGZWF0dXJlUmVjZWlwdD4ge1xyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9ICd0ZW1wL3Byb2dyYW1taW5nL3BhY2tlci1kcml2ZXIvdGFyZ2V0cy9wcmV2aWV3L2ltcG9ydC1tYXAuanNvbic7XHJcbiAgICAgICAgY29uc3Qgc2hhcmVkRW5naW5lID0gYXdhaXQgdGhpcy5yZWFkU2hhcmVkRW5naW5lSW50cmluc2ljcygpO1xyXG4gICAgICAgIGNvbnN0IHByb2plY3RUbXBEaXIgPSAoRWRpdG9yIGFzIGFueSkuUHJvamVjdD8udG1wRGlyO1xyXG4gICAgICAgIGlmICghcHJvamVjdFRtcERpcikge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVzOiBbXSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogbnVsbCxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBzb3VyY2UsXHJcbiAgICAgICAgICAgICAgICBlcnJvcjogJ0VkaXRvci5Qcm9qZWN0LnRtcERpciBpcyB1bmF2YWlsYWJsZScsXHJcbiAgICAgICAgICAgICAgICBzaGFyZWRFbmdpbmVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGltcG9ydE1hcFBhdGggPSBwYXRoLmpvaW4ocHJvamVjdFRtcERpciwgJ3Byb2dyYW1taW5nJywgJ3BhY2tlci1kcml2ZXInLCAndGFyZ2V0cycsICdwcmV2aWV3JywgJ2ltcG9ydC1tYXAuanNvbicpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IFtyYXcsIHN0YXRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICAgICAgICAgICAgZnMucmVhZEZpbGUoaW1wb3J0TWFwUGF0aCwgJ3V0ZjgnKSxcclxuICAgICAgICAgICAgICAgIGZzLnN0YXQoaW1wb3J0TWFwUGF0aClcclxuICAgICAgICAgICAgXSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcclxuICAgICAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBzY29wZSBvZiBPYmplY3QudmFsdWVzKHBhcnNlZD8uc2NvcGVzIHx8IHt9KSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzY29wZSB8fCB0eXBlb2Ygc2NvcGUgIT09ICdvYmplY3QnKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgT2JqZWN0LnZhbHVlcyhzY29wZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJlZml4ID0gJ2NjZTovaW50ZXJuYWwveC9jYy1mdS8nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKHByZWZpeCkpIGZlYXR1cmVzLmFkZCh2YWx1ZS5zbGljZShwcmVmaXgubGVuZ3RoKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVzOiBbLi4uZmVhdHVyZXNdLnNvcnQoKSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcFNoYTI1NjogY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHJhdykuZGlnZXN0KCdoZXgnKSxcclxuICAgICAgICAgICAgICAgIGltcG9ydE1hcE1vZGlmaWVkTXM6IHN0YXQubXRpbWVNcyxcclxuICAgICAgICAgICAgICAgIHNvdXJjZSxcclxuICAgICAgICAgICAgICAgIHNoYXJlZEVuZ2luZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlczogW10sXHJcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBTaGEyNTY6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBpbXBvcnRNYXBNb2RpZmllZE1zOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgc291cmNlLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yPy5tZXNzYWdlIHx8IFN0cmluZyhlcnJvciksXHJcbiAgICAgICAgICAgICAgICBzaGFyZWRFbmdpbmVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyByZWFkUHJvZmlsZU1vZGlmaWVkTXMoKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdFBhdGggPSAoRWRpdG9yIGFzIGFueSkuUHJvamVjdD8ucGF0aDtcclxuICAgICAgICBpZiAoIXByb2plY3RQYXRoKSByZXR1cm4gbnVsbDtcclxuICAgICAgICBjb25zdCBmaWxlID0gcGF0aC5qb2luKHByb2plY3RQYXRoLCAnc2V0dGluZ3MnLCAndjInLCAncGFja2FnZXMnLCAnZW5naW5lLmpzb24nKTtcclxuICAgICAgICByZXR1cm4gKGF3YWl0IGZzLnN0YXQoZmlsZSkuY2F0Y2goKCkgPT4gbnVsbCkpPy5tdGltZU1zIHx8IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB0cmFuc2FjdGlvblBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdFRtcERpciA9IChFZGl0b3IgYXMgYW55KS5Qcm9qZWN0Py50bXBEaXI7XHJcbiAgICAgICAgcmV0dXJuIHByb2plY3RUbXBEaXIgPyBwYXRoLmpvaW4ocHJvamVjdFRtcERpciwgJ2NvY29zLW1jcCcsICdlbmdpbmUtZmVhdHVyZS10cmFuc2FjdGlvbi5qc29uJykgOiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcmVhZFRyYW5zYWN0aW9uKCk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xyXG4gICAgICAgIGlmICghZmlsZSkgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYXdhaXQgZnMucmVhZEZpbGUoZmlsZSwgJ3V0ZjgnKSk7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHdyaXRlVHJhbnNhY3Rpb24odmFsdWU6IGFueSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xyXG4gICAgICAgIGlmICghZmlsZSkgdGhyb3cgbmV3IEVycm9yKCdFZGl0b3IuUHJvamVjdC50bXBEaXIgaXMgdW5hdmFpbGFibGUgZm9yIHRoZSBlbmdpbmUgZmVhdHVyZSB0cmFuc2FjdGlvbiByZWNlaXB0Jyk7XHJcbiAgICAgICAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJuYW1lKGZpbGUpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZSwgYCR7SlNPTi5zdHJpbmdpZnkodmFsdWUsIG51bGwsIDIpfVxcbmAsICd1dGY4Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBjbGVhclRyYW5zYWN0aW9uKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnRyYW5zYWN0aW9uUGF0aCgpO1xyXG4gICAgICAgIGlmIChmaWxlKSBhd2FpdCBmcy51bmxpbmsoZmlsZSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JBcHBsaWVkRmVhdHVyZXMoXHJcbiAgICAgICAgbW9kdWxlczogc3RyaW5nW10sXHJcbiAgICAgICAgZGlzYWJsZWRNb2R1bGVzOiBzdHJpbmdbXSxcclxuICAgICAgICBwaHlzaWNzQmFja2VuZDogUGh5c2ljc0JhY2tlbmQgfCB1bmRlZmluZWQsXHJcbiAgICAgICAgc3BpbmVCYWNrZW5kOiBTcGluZUJhY2tlbmQgfCB1bmRlZmluZWQsXHJcbiAgICAgICAgcGh5c2ljczJkQmFja2VuZDogUGh5c2ljczJkQmFja2VuZCB8IHVuZGVmaW5lZCxcclxuICAgICAgICB0aW1lb3V0TXM6IG51bWJlcixcclxuICAgICAgICBtaW5pbXVtQXBwbGllZE1vZGlmaWVkTXM/OiBudW1iZXIgfCBudWxsXHJcbiAgICApOiBQcm9taXNlPEFwcGxpZWRGZWF0dXJlUmVjZWlwdD4ge1xyXG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHRpbWVvdXRNcztcclxuICAgICAgICBsZXQgcmVjZWlwdCA9IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTtcclxuICAgICAgICB3aGlsZSAoIWFwcGxpZWRTYXRpc2ZpZXMoXHJcbiAgICAgICAgICAgIHJlY2VpcHQsXHJcbiAgICAgICAgICAgIG1vZHVsZXMsXHJcbiAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlcyxcclxuICAgICAgICAgICAgcGh5c2ljc0JhY2tlbmQsXHJcbiAgICAgICAgICAgIHNwaW5lQmFja2VuZCxcclxuICAgICAgICAgICAgcGh5c2ljczJkQmFja2VuZCxcclxuICAgICAgICAgICAgbWluaW11bUFwcGxpZWRNb2RpZmllZE1zXHJcbiAgICAgICAgKSAmJiBEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcclxuICAgICAgICAgICAgYXdhaXQgc2xlZXAoNTAwKTtcclxuICAgICAgICAgICAgcmVjZWlwdCA9IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlY2VpcHQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyByZWJ1aWxkRW5naW5lQW5kV2FpdCh0aW1lb3V0TXM6IG51bWJlcik6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgY29uc3QgbWVzc2FnZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2U7XHJcbiAgICAgICAgbGV0IHZlcnNpb25GaWxlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuICAgICAgICBsZXQgdmVyc2lvbk10aW1lQmVmb3JlID0gMDtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBlbmdpbmVJbmZvOiBhbnkgPSBhd2FpdCB3aXRoVGltZW91dChcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2VBcGkucmVxdWVzdCgnZW5naW5lJywgJ3F1ZXJ5LWluZm8nKSxcclxuICAgICAgICAgICAgICAgIDEwMDAwLFxyXG4gICAgICAgICAgICAgICAgJ2VuZ2luZSBpbmZvIHF1ZXJ5J1xyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBjb25zdCBlbmdpbmVQYXRoID0gZW5naW5lSW5mbz8ucGF0aDtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBlbmdpbmVQYXRoID09PSAnc3RyaW5nJyAmJiBlbmdpbmVQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uRmlsZSA9IHBhdGguam9pbihlbmdpbmVQYXRoLCAnYmluJywgJy5jYWNoZScsICdkZXYnLCAnVkVSU0lPTicpO1xyXG4gICAgICAgICAgICAgICAgdmVyc2lvbk10aW1lQmVmb3JlID0gKGF3YWl0IGZzLnN0YXQodmVyc2lvbkZpbGUpLmNhdGNoKCgpID0+IG51bGwpKT8ubXRpbWVNcyB8fCAwO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIC8vIFRoZSBib3VuZGVkIHByb2plY3QgbG9nIHJlY2VpcHQgYmVsb3cgcmVtYWlucyBhdmFpbGFibGUgYXMgYSBmYWxsYmFjay5cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHByb2plY3RQYXRoID0gKEVkaXRvciBhcyBhbnkpLlByb2plY3Q/LnBhdGg7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdExvZyA9IHByb2plY3RQYXRoID8gcGF0aC5qb2luKHByb2plY3RQYXRoLCAndGVtcCcsICdsb2dzJywgJ3Byb2plY3QubG9nJykgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHByb2plY3RMb2dTaXplQmVmb3JlID0gcHJvamVjdExvZ1xyXG4gICAgICAgICAgICA/ICgoYXdhaXQgZnMuc3RhdChwcm9qZWN0TG9nKS5jYXRjaCgoKSA9PiBudWxsKSk/LnNpemUgfHwgMClcclxuICAgICAgICAgICAgOiAwO1xyXG4gICAgICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XHJcbiAgICAgICAgbGV0IHJlcXVlc3RTZXR0bGVkID0gZmFsc2U7XHJcbiAgICAgICAgbGV0IHJlcXVlc3RFcnJvcjogYW55ID0gbnVsbDtcclxuXHJcbiAgICAgICAgLy8gQ29jb3MgMy44LjggY2FuIGZpbmlzaCBRdWljayBDb21waWxlIGJ1dCBsZWF2ZSB0aGUgbWVzc2FnZSByZXF1ZXN0XHJcbiAgICAgICAgLy8gdW5yZXNvbHZlZCB3aGlsZSB0aGUgZW5naW5lIGNvbnN1bWVyIGlzIGJlaW5nIHJlcGxhY2VkLiBPYnNlcnZlIHRoZVxyXG4gICAgICAgIC8vIGNvbXBpbGVyJ3Mgb3duIFZFUlNJT04vbG9nIHJlY2VpcHQgaW5zdGVhZCBvZiBoYW5naW5nIHRoZSBNQ1AgcmVxdWVzdC5cclxuICAgICAgICB2b2lkIG1lc3NhZ2VBcGkucmVxdWVzdCgnZW5naW5lJywgJ3JlYnVpbGQnKS50aGVuKFxyXG4gICAgICAgICAgICAoKSA9PiB7IHJlcXVlc3RTZXR0bGVkID0gdHJ1ZTsgfSxcclxuICAgICAgICAgICAgKGVycm9yOiBhbnkpID0+IHsgcmVxdWVzdFNldHRsZWQgPSB0cnVlOyByZXF1ZXN0RXJyb3IgPSBlcnJvcjsgfVxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gc3RhcnRlZEF0ICsgdGltZW91dE1zO1xyXG4gICAgICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcclxuICAgICAgICAgICAgaWYgKHZlcnNpb25GaWxlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnMuc3RhdCh2ZXJzaW9uRmlsZSkuY2F0Y2goKCkgPT4gbnVsbCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoc3RhdCAmJiBzdGF0Lm10aW1lTXMgPiB2ZXJzaW9uTXRpbWVCZWZvcmUgJiYgc3RhdC5tdGltZU1zID49IHN0YXJ0ZWRBdCAtIDEwMDApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZTogJ2VuZ2luZS1jYWNoZS12ZXJzaW9uJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbk1vZGlmaWVkTXM6IHN0YXQubXRpbWVNcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWVzdFNldHRsZWRcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAocHJvamVjdExvZykge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBsb2cgPSBhd2FpdCBmcy5yZWFkRmlsZShwcm9qZWN0TG9nKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobG9nLmxlbmd0aCA+IHByb2plY3RMb2dTaXplQmVmb3JlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFwcGVuZGVkID0gbG9nLnN1YmFycmF5KHByb2plY3RMb2dTaXplQmVmb3JlKS50b1N0cmluZygndXRmOCcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoL1F1aWNrIENvbXBpbGU6XFxzKlxcZCttcy8udGVzdChhcHBlbmRlZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tcGxldGVkOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNvdXJjZTogJ3Byb2plY3QtbG9nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3RTZXR0bGVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gS2VlcCBwb2xsaW5nIHRoZSBlbmdpbmUgVkVSU0lPTiByZWNlaXB0IHdoZW4gYXZhaWxhYmxlLlxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAocmVxdWVzdFNldHRsZWQgJiYgcmVxdWVzdEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyByZXF1ZXN0RXJyb3I7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgYXdhaXQgc2xlZXAoMjUwKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb2NvcyBlbmdpbmUgZmVhdHVyZSByZWJ1aWxkIHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRNc31tc2ApO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZW5zdXJlRmVhdHVyZXMoYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCByZXF1ZXN0ZWQ6IHVua25vd25bXSA9IEFycmF5LmlzQXJyYXkoYXJncy5tb2R1bGVzKSA/IGFyZ3MubW9kdWxlcyA6IFtdO1xyXG4gICAgICAgICAgICBjb25zdCByZXF1ZXN0ZWREaXNhYmxlZDogdW5rbm93bltdID0gQXJyYXkuaXNBcnJheShhcmdzLmRpc2FibGVkTW9kdWxlcykgPyBhcmdzLmRpc2FibGVkTW9kdWxlcyA6IFtdO1xyXG4gICAgICAgICAgICBpZiAoIXJlcXVlc3RlZC5ldmVyeSh2YWxpZEZlYXR1cmVOYW1lKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnRXZlcnkgcmVxdWVzdGVkIG1vZHVsZSBtdXN0IGJlIGEgdmFsaWQgQ29jb3MgZmVhdHVyZSBuYW1lLicgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoIXJlcXVlc3RlZERpc2FibGVkLmV2ZXJ5KHZhbGlkRmVhdHVyZU5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdFdmVyeSBkaXNhYmxlZCBtb2R1bGUgbXVzdCBiZSBhIHZhbGlkIENvY29zIGZlYXR1cmUgbmFtZS4nIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3QgbW9kdWxlU2V0ID0gbmV3IFNldChyZXF1ZXN0ZWQgYXMgc3RyaW5nW10pO1xyXG4gICAgICAgICAgICBjb25zdCBkaXNhYmxlZE1vZHVsZXMgPSBbLi4ubmV3IFNldChyZXF1ZXN0ZWREaXNhYmxlZCBhcyBzdHJpbmdbXSldO1xyXG4gICAgICAgICAgICBjb25zdCBwaHlzaWNzQmFja2VuZCA9IGFyZ3MucGh5c2ljc0JhY2tlbmQgYXMgUGh5c2ljc0JhY2tlbmQgfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzQmFja2VuZCAmJiAhUEhZU0lDU19CQUNLRU5EUy5pbmNsdWRlcyhwaHlzaWNzQmFja2VuZCkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFVuc3VwcG9ydGVkIHBoeXNpY3MgYmFja2VuZDogJHtwaHlzaWNzQmFja2VuZH1gIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3QgcmVxdWVzdGVkU3BpbmVCYWNrZW5kcyA9IFNQSU5FX0JBQ0tFTkRTLmZpbHRlcigoYmFja2VuZCkgPT4gbW9kdWxlU2V0LmhhcyhiYWNrZW5kKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGV4cGxpY2l0U3BpbmVCYWNrZW5kID0gYXJncy5zcGluZUJhY2tlbmQgYXMgU3BpbmVCYWNrZW5kIHwgdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBpZiAoZXhwbGljaXRTcGluZUJhY2tlbmQgJiYgIVNQSU5FX0JBQ0tFTkRTLmluY2x1ZGVzKGV4cGxpY2l0U3BpbmVCYWNrZW5kKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgU3BpbmUgYmFja2VuZDogJHtleHBsaWNpdFNwaW5lQmFja2VuZH1gIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHJlcXVlc3RlZFNwaW5lQmFja2VuZHMubGVuZ3RoID4gMSB8fFxyXG4gICAgICAgICAgICAgICAgZXhwbGljaXRTcGluZUJhY2tlbmQgJiYgcmVxdWVzdGVkU3BpbmVCYWNrZW5kcy5sZW5ndGggPT09IDEgJiYgcmVxdWVzdGVkU3BpbmVCYWNrZW5kc1swXSAhPT0gZXhwbGljaXRTcGluZUJhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ1JlcXVlc3RlZCBTcGluZSBmZWF0dXJlIG1vZHVsZXMgY29uZmxpY3Qgd2l0aCB0aGUgc2VsZWN0ZWQgU3BpbmUgYmFja2VuZC4nIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3Qgc3BpbmVCYWNrZW5kID0gZXhwbGljaXRTcGluZUJhY2tlbmQgfHwgcmVxdWVzdGVkU3BpbmVCYWNrZW5kc1swXTtcclxuICAgICAgICAgICAgaWYgKHNwaW5lQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgbW9kdWxlU2V0LmFkZCgnc3BpbmUnKTtcclxuICAgICAgICAgICAgICAgIG1vZHVsZVNldC5hZGQoc3BpbmVCYWNrZW5kKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCByZXF1ZXN0ZWRQaHlzaWNzMmRCYWNrZW5kcyA9IFBIWVNJQ1NfMkRfQkFDS0VORFMuZmlsdGVyKChiYWNrZW5kKSA9PiBtb2R1bGVTZXQuaGFzKGJhY2tlbmQpKTtcclxuICAgICAgICAgICAgY29uc3QgZXhwbGljaXRQaHlzaWNzMmRCYWNrZW5kID0gYXJncy5waHlzaWNzMmRCYWNrZW5kIGFzIFBoeXNpY3MyZEJhY2tlbmQgfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIGlmIChleHBsaWNpdFBoeXNpY3MyZEJhY2tlbmQgJiYgIVBIWVNJQ1NfMkRfQkFDS0VORFMuaW5jbHVkZXMoZXhwbGljaXRQaHlzaWNzMmRCYWNrZW5kKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgUGh5c2ljczJEIGJhY2tlbmQ6ICR7ZXhwbGljaXRQaHlzaWNzMmRCYWNrZW5kfWAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAocmVxdWVzdGVkUGh5c2ljczJkQmFja2VuZHMubGVuZ3RoID4gMSB8fFxyXG4gICAgICAgICAgICAgICAgZXhwbGljaXRQaHlzaWNzMmRCYWNrZW5kICYmIHJlcXVlc3RlZFBoeXNpY3MyZEJhY2tlbmRzLmxlbmd0aCA9PT0gMSAmJlxyXG4gICAgICAgICAgICAgICAgcmVxdWVzdGVkUGh5c2ljczJkQmFja2VuZHNbMF0gIT09IGV4cGxpY2l0UGh5c2ljczJkQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnUmVxdWVzdGVkIFBoeXNpY3MyRCBmZWF0dXJlIG1vZHVsZXMgY29uZmxpY3Qgd2l0aCB0aGUgc2VsZWN0ZWQgUGh5c2ljczJEIGJhY2tlbmQuJyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IHBoeXNpY3MyZEJhY2tlbmQgPSBleHBsaWNpdFBoeXNpY3MyZEJhY2tlbmQgfHwgcmVxdWVzdGVkUGh5c2ljczJkQmFja2VuZHNbMF07XHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzMmRCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICBtb2R1bGVTZXQuYWRkKCdwaHlzaWNzLTJkJyk7XHJcbiAgICAgICAgICAgICAgICBtb2R1bGVTZXQuYWRkKHBoeXNpY3MyZEJhY2tlbmQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXM6IHN0cmluZ1tdID0gWy4uLm1vZHVsZVNldF07XHJcbiAgICAgICAgICAgIGNvbnN0IG92ZXJsYXAgPSBkaXNhYmxlZE1vZHVsZXMuZmlsdGVyKChtb2R1bGVOYW1lKSA9PiBtb2R1bGVTZXQuaGFzKG1vZHVsZU5hbWUpKTtcclxuICAgICAgICAgICAgaWYgKG92ZXJsYXAubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBGZWF0dXJlcyBjYW5ub3QgYmUgYm90aCByZXF1aXJlZCBhbmQgZGlzYWJsZWQ6ICR7b3ZlcmxhcC5qb2luKCcsICcpfWAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgYmVmb3JlUHJvZmlsZSA9IGF3YWl0IHRoaXMucmVhZFByb2ZpbGUoKTtcclxuICAgICAgICAgICAgY29uc3QgYmVmb3JlID0gc25hcHNob3QoYmVmb3JlUHJvZmlsZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBjbG9uZShiZWZvcmVQcm9maWxlKTtcclxuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYWN0aXZlQ29uZmlnKG5leHQpO1xyXG4gICAgICAgICAgICBjb25zdCBpbmNsdWRlID0gbmV3IFNldDxzdHJpbmc+KGNvbmZpZy5pbmNsdWRlTW9kdWxlcyB8fCBbXSk7XHJcbiAgICAgICAgICAgIC8vIEEgbW9kdWxlIGlzIHdyaXRhYmxlIG9ubHkgd2hlbiB0aGUgY3VycmVudCBDcmVhdG9yIHByb2ZpbGUgZXhwb3Nlc1xyXG4gICAgICAgICAgICAvLyBpdHMgY2FjaGUgcmVjb3JkLiBpbmNsdWRlTW9kdWxlcyBpcyBzZWxlY3Rpb24gc3RhdGUsIG5vdCBhIHNjaGVtYTtcclxuICAgICAgICAgICAgLy8gdHJ1c3RpbmcgYW4gb3JwaGFuIGluY2x1ZGUgZW50cnkgd291bGQgZGVyZWZlcmVuY2UvaW5zZXJ0IGJsaW5kbHkuXHJcbiAgICAgICAgICAgIGNvbnN0IGtub3duTW9kdWxlcyA9IG5ldyBTZXQ8c3RyaW5nPihPYmplY3Qua2V5cyhjb25maWcuY2FjaGUgfHwge30pKTtcclxuICAgICAgICAgICAgY29uc3QgdW5rbm93bk1vZHVsZXMgPSBtb2R1bGVzLmZpbHRlcigobW9kdWxlTmFtZSkgPT4gIWtub3duTW9kdWxlcy5oYXMobW9kdWxlTmFtZSkpO1xyXG4gICAgICAgICAgICBjb25zdCB1bmtub3duRGlzYWJsZWRNb2R1bGVzID0gZGlzYWJsZWRNb2R1bGVzLmZpbHRlcigobW9kdWxlTmFtZSkgPT4gIWtub3duTW9kdWxlcy5oYXMobW9kdWxlTmFtZSkpO1xyXG4gICAgICAgICAgICBpZiAodW5rbm93bk1vZHVsZXMubGVuZ3RoIHx8IHVua25vd25EaXNhYmxlZE1vZHVsZXMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgUmVmdXNpbmcgdG8gbXV0YXRlIHVua25vd24gQ29jb3MgZW5naW5lIG1vZHVsZXM6ICR7Wy4uLnVua25vd25Nb2R1bGVzLCAuLi51bmtub3duRGlzYWJsZWRNb2R1bGVzXS5qb2luKCcsICcpfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIHN0YXR1czogJ3Vua25vd24tZmVhdHVyZS1tb2R1bGUnLCBiZWZvcmUgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAocGh5c2ljc0JhY2tlbmQgJiYgKCFrbm93bk1vZHVsZXMuaGFzKCdwaHlzaWNzJykgfHwgIWtub3duTW9kdWxlcy5oYXMocGh5c2ljc0JhY2tlbmQpKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYFBoeXNpY3MgZmVhdHVyZS9iYWNrZW5kIGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBDb2NvcyBwcm9maWxlOiBwaHlzaWNzICsgJHtwaHlzaWNzQmFja2VuZH1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHsgY29tcGxldGU6IGZhbHNlLCBzdGF0dXM6ICd1bmtub3duLXBoeXNpY3MtYmFja2VuZCcsIGJlZm9yZSB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChzcGluZUJhY2tlbmQgJiYgKCFrbm93bk1vZHVsZXMuaGFzKCdzcGluZScpIHx8ICFrbm93bk1vZHVsZXMuaGFzKHNwaW5lQmFja2VuZCkpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBgU3BpbmUgZmVhdHVyZS9iYWNrZW5kIGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBDb2NvcyBwcm9maWxlOiBzcGluZSArICR7c3BpbmVCYWNrZW5kfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogeyBjb21wbGV0ZTogZmFsc2UsIHN0YXR1czogJ3Vua25vd24tc3BpbmUtYmFja2VuZCcsIGJlZm9yZSB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChwaHlzaWNzMmRCYWNrZW5kICYmICgha25vd25Nb2R1bGVzLmhhcygncGh5c2ljcy0yZCcpIHx8ICFrbm93bk1vZHVsZXMuaGFzKHBoeXNpY3MyZEJhY2tlbmQpKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYFBoeXNpY3MyRCBmZWF0dXJlL2JhY2tlbmQgaXMgbm90IGF2YWlsYWJsZSBpbiB0aGlzIENvY29zIHByb2ZpbGU6IHBoeXNpY3MtMmQgKyAke3BoeXNpY3MyZEJhY2tlbmR9YCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7IGNvbXBsZXRlOiBmYWxzZSwgc3RhdHVzOiAndW5rbm93bi1waHlzaWNzLTJkLWJhY2tlbmQnLCBiZWZvcmUgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xyXG5cclxuICAgICAgICAgICAgZm9yIChjb25zdCBtb2R1bGVOYW1lIG9mIG1vZHVsZXMpIHtcclxuICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGVbbW9kdWxlTmFtZV0uX3ZhbHVlICE9PSB0cnVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlW21vZHVsZU5hbWVdLl92YWx1ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoIU9QVElPTl9QQVJFTlRfRkVBVFVSRVMuaGFzKG1vZHVsZU5hbWUpICYmICFpbmNsdWRlLmhhcyhtb2R1bGVOYW1lKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGluY2x1ZGUuYWRkKG1vZHVsZU5hbWUpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAocGh5c2ljc0JhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZS5waHlzaWNzIHx8PSB7fTtcclxuICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGUucGh5c2ljcy5fdmFsdWUgIT09IHRydWUgfHwgY29uZmlnLmNhY2hlLnBoeXNpY3MuX29wdGlvbiAhPT0gcGh5c2ljc0JhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUucGh5c2ljcy5fdmFsdWUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZS5waHlzaWNzLl9vcHRpb24gPSBwaHlzaWNzQmFja2VuZDtcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYmFja2VuZCBvZiBQSFlTSUNTX0JBQ0tFTkRTKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFrbm93bk1vZHVsZXMuaGFzKGJhY2tlbmQpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IGJhY2tlbmQgPT09IHBoeXNpY3NCYWNrZW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGVbYmFja2VuZF0uX3ZhbHVlICE9PSBzZWxlY3RlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGVbYmFja2VuZF0uX3ZhbHVlID0gc2VsZWN0ZWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIGluY2x1ZGUuYWRkKGJhY2tlbmQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaW5jbHVkZS5kZWxldGUoYmFja2VuZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZm9yIChjb25zdCBtb2R1bGVOYW1lIG9mIGRpc2FibGVkTW9kdWxlcykge1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZVttb2R1bGVOYW1lXS5fdmFsdWUgIT09IGZhbHNlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlW21vZHVsZU5hbWVdLl92YWx1ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKGluY2x1ZGUuZGVsZXRlKG1vZHVsZU5hbWUpKSBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKHNwaW5lQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlLnNwaW5lIHx8PSB7fTtcclxuICAgICAgICAgICAgICAgIGlmIChjb25maWcuY2FjaGUuc3BpbmUuX3ZhbHVlICE9PSB0cnVlIHx8IGNvbmZpZy5jYWNoZS5zcGluZS5fb3B0aW9uICE9PSBzcGluZUJhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUuc3BpbmUuX3ZhbHVlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGUuc3BpbmUuX29wdGlvbiA9IHNwaW5lQmFja2VuZDtcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYmFja2VuZCBvZiBTUElORV9CQUNLRU5EUykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgha25vd25Nb2R1bGVzLmhhcyhiYWNrZW5kKSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VsZWN0ZWQgPSBiYWNrZW5kID09PSBzcGluZUJhY2tlbmQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgIT09IHNlbGVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVtiYWNrZW5kXS5fdmFsdWUgPSBzZWxlY3RlZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgaW5jbHVkZS5hZGQoYmFja2VuZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpbmNsdWRlLmRlbGV0ZShiYWNrZW5kKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGluY2x1ZGUuZGVsZXRlKCdzcGluZScpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAocGh5c2ljczJkQmFja2VuZCkge1xyXG4gICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlWydwaHlzaWNzLTJkJ10gfHw9IHt9O1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5jYWNoZVsncGh5c2ljcy0yZCddLl92YWx1ZSAhPT0gdHJ1ZSB8fFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVsncGh5c2ljcy0yZCddLl9vcHRpb24gIT09IHBoeXNpY3MyZEJhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcuY2FjaGVbJ3BoeXNpY3MtMmQnXS5fdmFsdWUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5jYWNoZVsncGh5c2ljcy0yZCddLl9vcHRpb24gPSBwaHlzaWNzMmRCYWNrZW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIFBIWVNJQ1NfMkRfQkFDS0VORFMpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWtub3duTW9kdWxlcy5oYXMoYmFja2VuZCkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gYmFja2VuZCA9PT0gcGh5c2ljczJkQmFja2VuZDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmNhY2hlW2JhY2tlbmRdLl92YWx1ZSAhPT0gc2VsZWN0ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLmNhY2hlW2JhY2tlbmRdLl92YWx1ZSA9IHNlbGVjdGVkO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGVjdGVkKSBpbmNsdWRlLmFkZChiYWNrZW5kKTtcclxuICAgICAgICAgICAgICAgICAgICBlbHNlIGluY2x1ZGUuZGVsZXRlKGJhY2tlbmQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZS5kZWxldGUoJ3BoeXNpY3MtMmQnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3Qgb3JkZXJlZCA9IFsuLi5pbmNsdWRlXS5zb3J0KCk7XHJcbiAgICAgICAgICAgIGlmIChKU09OLnN0cmluZ2lmeShvcmRlcmVkKSAhPT0gSlNPTi5zdHJpbmdpZnkoY29uZmlnLmluY2x1ZGVNb2R1bGVzKSkgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIGNvbmZpZy5pbmNsdWRlTW9kdWxlcyA9IG9yZGVyZWQ7XHJcblxyXG4gICAgICAgICAgICBjb25zdCByZWxvYWRSZXF1ZXN0ZWQgPSBhcmdzLnJlbG9hZCAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVvdXRNcyA9IE1hdGgubWluKDMwMDAwMCwgTWF0aC5tYXgoMTAwMCwgTnVtYmVyKGFyZ3MudGltZW91dE1zKSB8fCAyNDAwMDApKTtcclxuICAgICAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XHJcblxyXG4gICAgICAgICAgICBpZiAoY2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFwcm9maWxlQXBpPy5zZXRQcm9qZWN0KSB0aHJvdyBuZXcgRXJyb3IoJ0VkaXRvci5Qcm9maWxlLnNldFByb2plY3QgaXMgdW5hdmFpbGFibGUnKTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHByb2ZpbGVBcGkuc2V0UHJvamVjdCgnZW5naW5lJywgJ21vZHVsZXMnLCBuZXh0KTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgdmVyaWZpZWRQcm9maWxlID0gYXdhaXQgdGhpcy5yZWFkUHJvZmlsZSgpO1xyXG4gICAgICAgICAgICBjb25zdCBhZnRlciA9IHNuYXBzaG90KHZlcmlmaWVkUHJvZmlsZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1pc3NpbmcgPSBtb2R1bGVzLmZpbHRlcigobmFtZSkgPT4gIXByb2ZpbGVTZWxlY3Rpb25JbmNsdWRlcyhhZnRlciwgbmFtZSkpO1xyXG4gICAgICAgICAgICBjb25zdCB1bmV4cGVjdGVkID0gZGlzYWJsZWRNb2R1bGVzLmZpbHRlcigobmFtZSkgPT5cclxuICAgICAgICAgICAgICAgIGFmdGVyLmluY2x1ZGVNb2R1bGVzLmluY2x1ZGVzKG5hbWUpIHx8IGFmdGVyLmVuYWJsZWQuaW5jbHVkZXMobmFtZSkpO1xyXG4gICAgICAgICAgICBpZiAocGh5c2ljc0JhY2tlbmQgJiYgYWZ0ZXIucGh5c2ljc0JhY2tlbmQgIT09IHBoeXNpY3NCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICBtaXNzaW5nLnB1c2goYHBoeXNpY3MgYmFja2VuZCAke3BoeXNpY3NCYWNrZW5kfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChzcGluZUJhY2tlbmQgJiYgYWZ0ZXIuc3BpbmVCYWNrZW5kICE9PSBzcGluZUJhY2tlbmQpIHtcclxuICAgICAgICAgICAgICAgIG1pc3NpbmcucHVzaChgU3BpbmUgYmFja2VuZCAke3NwaW5lQmFja2VuZH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAocGh5c2ljczJkQmFja2VuZCAmJiBhZnRlci5waHlzaWNzMmRCYWNrZW5kICE9PSBwaHlzaWNzMmRCYWNrZW5kKSB7XHJcbiAgICAgICAgICAgICAgICBtaXNzaW5nLnB1c2goYFBoeXNpY3MyRCBiYWNrZW5kICR7cGh5c2ljczJkQmFja2VuZH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWlzc2luZy5sZW5ndGggfHwgdW5leHBlY3RlZC5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGZWF0dXJlIENyb3BwaW5nIHdyaXRlIGRpZCBub3QgcGVyc2lzdDogJHtbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLm1pc3NpbmcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnVuZXhwZWN0ZWQubWFwKG5hbWUgPT4gYGRpc2FibGVkICR7bmFtZX1gKVxyXG4gICAgICAgICAgICAgICAgICAgIF0uam9pbignLCAnKX1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHsgY29tcGxldGU6IGZhbHNlLCBjaGFuZ2VkLCBiZWZvcmUsIGFmdGVyIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGFwcGxpZWRCZWZvcmUgPSBhd2FpdCB0aGlzLnJlYWRBcHBsaWVkUHJldmlld0ZlYXR1cmVzKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHByb2ZpbGVNb2RpZmllZE1zID0gYXdhaXQgdGhpcy5yZWFkUHJvZmlsZU1vZGlmaWVkTXMoKTtcclxuICAgICAgICAgICAgY29uc3Qgc2lnbmF0dXJlID0gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgICAgIG1vZHVsZXM6IFsuLi5tb2R1bGVzXS5zb3J0KCksXHJcbiAgICAgICAgICAgICAgICBkaXNhYmxlZE1vZHVsZXM6IFsuLi5kaXNhYmxlZE1vZHVsZXNdLnNvcnQoKSxcclxuICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kOiBwaHlzaWNzQmFja2VuZCB8fCBudWxsLFxyXG4gICAgICAgICAgICAgICAgc3BpbmVCYWNrZW5kOiBzcGluZUJhY2tlbmQgfHwgbnVsbCxcclxuICAgICAgICAgICAgICAgIHBoeXNpY3MyZEJhY2tlbmQ6IHBoeXNpY3MyZEJhY2tlbmQgfHwgbnVsbCxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVNb2R1bGVzOiBhZnRlci5pbmNsdWRlTW9kdWxlcyxcclxuICAgICAgICAgICAgICAgIGNvbmZpZ0tleTogYWZ0ZXIuY29uZmlnS2V5XHJcbiAgICAgICAgICAgIH0pKS5kaWdlc3QoJ2hleCcpO1xyXG4gICAgICAgICAgICBjb25zdCBwZW5kaW5nID0gYXdhaXQgdGhpcy5yZWFkVHJhbnNhY3Rpb24oKTtcclxuXHJcbiAgICAgICAgICAgIGlmICghY2hhbmdlZCAmJiBhcHBsaWVkU2F0aXNmaWVzKFxyXG4gICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZSxcclxuICAgICAgICAgICAgICAgIG1vZHVsZXMsXHJcbiAgICAgICAgICAgICAgICBkaXNhYmxlZE1vZHVsZXMsXHJcbiAgICAgICAgICAgICAgICBwaHlzaWNzQmFja2VuZCxcclxuICAgICAgICAgICAgICAgIHNwaW5lQmFja2VuZCxcclxuICAgICAgICAgICAgICAgIHBoeXNpY3MyZEJhY2tlbmQsXHJcbiAgICAgICAgICAgICAgICBwcm9maWxlTW9kaWZpZWRNc1xyXG4gICAgICAgICAgICApKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNsZWFyVHJhbnNhY3Rpb24oKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiAnRmVhdHVyZSBDcm9wcGluZyBwcm9maWxlIGFuZCB0aGUgYWN0aXZlIHByZXZpZXcgaW1wb3J0IG1hcCBhcmUgc3luY2hyb25pemVkLicsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAndmVyaWZpZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQWZ0ZXI6IGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiBwZW5kaW5nID8geyByZWNvdmVyZWQ6IHRydWUsIGF0dGVtcHRzOiBwZW5kaW5nLmF0dGVtcHRzIHx8IDEgfSA6IG51bGxcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoIXJlbG9hZFJlcXVlc3RlZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUgaXMgcGVyc2lzdGVkLCBidXQgZW5naW5lIHJlbG9hZCB3YXMgZXhwbGljaXRseSBza2lwcGVkLicsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ3Byb2ZpbGUtcGVyc2lzdGVkLXJlbG9hZC1za2lwcGVkJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEEgQ29jb3MgcHJvY2VzcyBjYW5ub3QgcmVsaWFibHkgYWNrbm93bGVkZ2UgdGhlIFJQQyB0aGF0IGRlc3Ryb3lzIGl0cyBvd25cclxuICAgICAgICAgICAgLy8gTUNQIHRyYW5zcG9ydC4gS2VlcCByZWxhdW5jaCBvdXRzaWRlIHRoaXMgZXh0ZW5zaW9uOiB0aGUgc2hhcmVkLWtpdFxyXG4gICAgICAgICAgICAvLyBzdXBlcnZpc29yIGNhbiB2ZXJpZnkgZXhhY3QgcHJvamVjdC9QSUQgb3duZXJzaGlwLCByZXN0YXJ0IGl0LCByZWNvbm5lY3QsXHJcbiAgICAgICAgICAgIC8vIGFuZCB0aGVuIHByb3ZlIHRoYXQgdGhlIHJlZ2VuZXJhdGVkIHByZXZpZXcgaW1wb3J0IG1hcCBpcyBjdXJyZW50LlxyXG4gICAgICAgICAgICBjb25zdCBtYXRjaGluZ1BlbmRpbmcgPSBwZW5kaW5nPy5zaWduYXR1cmUgPT09IHNpZ25hdHVyZVxyXG4gICAgICAgICAgICAgICAgJiYgKHBlbmRpbmc/LnN0YXR1cyA9PT0gJ3Jlc3RhcnQtcmVxdWlyZWQnIHx8IHBlbmRpbmc/LnN0YXR1cyA9PT0gJ2VkaXRvci1yZWxhdW5jaC1zY2hlZHVsZWQnKTtcclxuICAgICAgICAgICAgLy8gQW5vdGhlciBwcm9qZWN0IG9wZW5lZCBmcm9tIHRoZSBzYW1lIENvY29zIGluc3RhbGwgbWF5IGhhdmUgcmV3cml0dGVuIHRoZSBzaGFyZWRcclxuICAgICAgICAgICAgLy8gZW5naW5lIHByZXZpZXcgbWFwIHNpbmNlIHRoZSBwZW5kaW5nIHJlc3RhcnQgd2FzIHJlY29yZGVkLiBUaGUgaW4tcGxhY2UgcmVidWlsZFxyXG4gICAgICAgICAgICAvLyBiZWxvdyByZS1lbWl0cyBpdCBmb3IgdGhpcyBwcm9qZWN0LCBzbyBhIHBlbmRpbmcgcmVzdGFydCBtdXN0IG5vdCBzaG9ydC1jaXJjdWl0IGl0LlxyXG4gICAgICAgICAgICBjb25zdCBzaGFyZWRHYXBCZWZvcmUgPSBzaGFyZWRNaXNzaW5nKGFwcGxpZWRCZWZvcmUsIG1vZHVsZXMpO1xyXG4gICAgICAgICAgICBpZiAobWF0Y2hpbmdQZW5kaW5nICYmIHNoYXJlZEdhcEJlZm9yZS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiAnRmVhdHVyZSBDcm9wcGluZyBpcyBwZXJzaXN0ZWQgYW5kIHJlYnVpbHQsIGJ1dCB0aGUgYWN0aXZlIHByZXZpZXcgaW1wb3J0IG1hcCBpcyBzdGlsbCBzdGFsZS4gUmVzdGFydCB0aGlzIGV4YWN0IENvY29zIHByb2plY3QgZXh0ZXJuYWxseSwgdGhlbiBjYWxsIGdldF9mZWF0dXJlcyBhZ2Fpbi4nLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcGxldGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdyZXN0YXJ0LXJlcXVpcmVkJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZEJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNhY3Rpb246IHsgLi4ucGVuZGluZywgcmVjb3ZlcmVkOiB0cnVlLCBleHRlcm5hbFJlc3RhcnRSZXF1aXJlZDogdHJ1ZSB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gUHJvdGVjdCB1bnNhdmVkIHNjZW5lIHdvcmsgYmVmb3JlIHNjaGVkdWxpbmcgYW4gRWRpdG9yIHJlbGF1bmNoLlxyXG4gICAgICAgICAgICBsZXQgc2NlbmVXYXNEaXJ0eSA9IGZhbHNlO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGlydHlSZXN1bHQ6IGFueSA9IGF3YWl0IHdpdGhUaW1lb3V0KFxyXG4gICAgICAgICAgICAgICAgICAgIChFZGl0b3IgYXMgYW55KS5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWRpcnR5JyksXHJcbiAgICAgICAgICAgICAgICAgICAgMTAwMDAsXHJcbiAgICAgICAgICAgICAgICAgICAgJ3NjZW5lIGRpcnR5IHF1ZXJ5J1xyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgIHNjZW5lV2FzRGlydHkgPSBCb29sZWFuKGRpcnR5UmVzdWx0Py5kaXJ0eSA/PyBkaXJ0eVJlc3VsdCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoc2NlbmVXYXNEaXJ0eSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHdpdGhUaW1lb3V0KFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzYXZlLXNjZW5lJyksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDMwMDAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnc2NlbmUgc2F2ZSBiZWZvcmUgRWRpdG9yIHJlbGF1bmNoJ1xyXG4gICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBSZWZ1c2luZyB0byByZWxhdW5jaCBDb2NvcyBFZGl0b3IgYmVjYXVzZSB0aGUgY3VycmVudCBzY2VuZSBjb3VsZCBub3QgYmUgc2FmZWx5IGNoZWNrZWQvc2F2ZWQ6ICR7ZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKX1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHsgY29tcGxldGU6IGZhbHNlLCBzdGF0dXM6ICdzY2VuZS1zYXZlLXByZWZsaWdodC1mYWlsZWQnLCBjaGFuZ2VkLCBiZWZvcmUsIGFmdGVyLCBhcHBsaWVkQmVmb3JlIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlYnVpbGRTdGFydGVkQXQgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBsZXQgZW5naW5lUmVidWlsZDogYW55O1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZCA9IGF3YWl0IHRoaXMucmVidWlsZEVuZ2luZUFuZFdhaXQodGltZW91dE1zKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogYENvY29zIGNvdWxkIG5vdCByZWJ1aWxkIHRoZSBjcm9wcGVkIGVuZ2luZTogJHtlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2VuZ2luZS1yZWJ1aWxkLWZhaWxlZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGRNczogRGF0ZS5ub3coKSAtIHJlYnVpbGRTdGFydGVkQXRcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBRdWljayBDb21waWxlIHJlLWVtaXRzIHRoZSBpbnN0YWxsLXdpZGUgcHJldmlldyBtYXAgZnJvbSB0aGlzIHByb2plY3QncyBwcm9maWxlLlxyXG4gICAgICAgICAgICAvLyBXaGVuIHRoYXQgY2xvc2VzIGV2ZXJ5IGdhcCAodHlwaWNhbGx5IGEgbWFwIHJld3JpdHRlbiBieSBhbm90aGVyIG9wZW4gcHJvamVjdCksXHJcbiAgICAgICAgICAgIC8vIHRoZSBwcmV2aWV3IGlzIHZlcmlmaWVkIHdpdGhvdXQgcmVsYXVuY2hpbmcgdGhlIEVkaXRvci5cclxuICAgICAgICAgICAgY29uc3QgYXBwbGllZEFmdGVyUmVidWlsZCA9IGF3YWl0IHRoaXMucmVhZEFwcGxpZWRQcmV2aWV3RmVhdHVyZXMoKTtcclxuICAgICAgICAgICAgaWYgKGFwcGxpZWRTYXRpc2ZpZXMoXHJcbiAgICAgICAgICAgICAgICBhcHBsaWVkQWZ0ZXJSZWJ1aWxkLFxyXG4gICAgICAgICAgICAgICAgbW9kdWxlcyxcclxuICAgICAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlcyxcclxuICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kLFxyXG4gICAgICAgICAgICAgICAgc3BpbmVCYWNrZW5kLFxyXG4gICAgICAgICAgICAgICAgcGh5c2ljczJkQmFja2VuZCxcclxuICAgICAgICAgICAgICAgIHByb2ZpbGVNb2RpZmllZE1zXHJcbiAgICAgICAgICAgICkpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuY2xlYXJUcmFuc2FjdGlvbigpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdUaGUgZW5naW5lIHJlYnVpbGQgcmUtYXBwbGllZCB0aGlzIHByb2plY3RcXCdzIGZlYXR1cmVzIHRvIHRoZSBhY3RpdmUgcHJldmlldyBpbXBvcnQgbWFwLicsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAndmVyaWZpZWQtYWZ0ZXItcmVidWlsZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWZ0ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRCZWZvcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRBZnRlcjogYXBwbGllZEFmdGVyUmVidWlsZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcmVkR2FwQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkTXM6IERhdGUubm93KCkgLSByZWJ1aWxkU3RhcnRlZEF0XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb24gPSB7XHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiAxLFxyXG4gICAgICAgICAgICAgICAgc2lnbmF0dXJlLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAncmVzdGFydC1yZXF1aXJlZCcsXHJcbiAgICAgICAgICAgICAgICBhdHRlbXB0czogMSxcclxuICAgICAgICAgICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2R1bGVzOiBbLi4ubW9kdWxlc10uc29ydCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIGRpc2FibGVkTW9kdWxlczogWy4uLmRpc2FibGVkTW9kdWxlc10uc29ydCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIHBoeXNpY3NCYWNrZW5kOiBwaHlzaWNzQmFja2VuZCB8fCBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIHNwaW5lQmFja2VuZDogc3BpbmVCYWNrZW5kIHx8IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgcGh5c2ljczJkQmFja2VuZDogcGh5c2ljczJkQmFja2VuZCB8fCBudWxsXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgYWZ0ZXIsXHJcbiAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgZW5naW5lUmVidWlsZCxcclxuICAgICAgICAgICAgICAgIGVuZ2luZVJlYnVpbGRNczogRGF0ZS5ub3coKSAtIHJlYnVpbGRTdGFydGVkQXQsXHJcbiAgICAgICAgICAgICAgICBzY2VuZVdhc0RpcnR5XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMud3JpdGVUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdGZWF0dXJlIENyb3BwaW5nIHByb2ZpbGUgaXMgcGVyc2lzdGVkIGFuZCB0aGUgY3JvcHBlZCBlbmdpbmUgaXMgcmVidWlsdC4gUmVzdGFydCB0aGlzIGV4YWN0IENvY29zIHByb2plY3QgZXh0ZXJuYWxseSwgdGhlbiBjYWxsIGdldF9mZWF0dXJlcyB0byBvYnRhaW4gdGhlIGZpbmFsIGltcG9ydC1tYXAgcmVjZWlwdC4nLFxyXG4gICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdyZXN0YXJ0LXJlcXVpcmVkJyxcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICAgICAgICAgIGJlZm9yZSxcclxuICAgICAgICAgICAgICAgICAgICBhZnRlcixcclxuICAgICAgICAgICAgICAgICAgICBhcHBsaWVkQmVmb3JlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpZ25hdHVyZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0ZW1wdHM6IHRyYW5zYWN0aW9uLmF0dGVtcHRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkOiB0cmFuc2FjdGlvbi5lbmdpbmVSZWJ1aWxkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmdpbmVSZWJ1aWxkTXM6IHRyYW5zYWN0aW9uLmVuZ2luZVJlYnVpbGRNcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2NlbmVXYXNEaXJ0eSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxSZXN0YXJ0UmVxdWlyZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY29ubmVjdFJlcXVpcmVkOiB0cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcbiJdfQ==