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
exports.TextureCompressionPolicy = exports.PLAYABLE_OPAQUE_WEBP_QUALITY = exports.PLAYABLE_OPAQUE_PRESET_NAME = exports.PLAYABLE_OPAQUE_PRESET_ID = exports.PLAYABLE_TRANSPARENT_WEBP_QUALITY = exports.PLAYABLE_TRANSPARENT_PRESET_NAME = exports.PLAYABLE_TRANSPARENT_PRESET_ID = void 0;
exports.isPlayableTextureUrl = isPlayableTextureUrl;
exports.normalizeWebpQuality = normalizeWebpQuality;
exports.loadProjectTexturePolicy = loadProjectTexturePolicy;
exports.texturePresetForUrl = texturePresetForUrl;
exports.getTextureCompressionPolicy = getTextureCompressionPolicy;
exports.startTextureCompressionAutomation = startTextureCompressionAutomation;
exports.stopTextureCompressionAutomation = stopTextureCompressionAutomation;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_DIRECTORY = 'db://assets';
exports.PLAYABLE_TRANSPARENT_PRESET_ID = '1fYG0h7MJDcp+zA2cMcUsR';
exports.PLAYABLE_TRANSPARENT_PRESET_NAME = 'PlayableTransparent';
exports.PLAYABLE_TRANSPARENT_WEBP_QUALITY = 50;
exports.PLAYABLE_OPAQUE_PRESET_ID = 'caN1shVmpEEKSqquZ64sut';
exports.PLAYABLE_OPAQUE_PRESET_NAME = 'PlayableOpaque';
exports.PLAYABLE_OPAQUE_WEBP_QUALITY = 20;
const TEXTURE_EXTENSION = /\.(?:png|jpe?g)$/i;
const MAX_TEXTURES_PER_SCAN = 20000;
function normalizedPresetName(value) {
    return String(value || '').replace(/[\s_-]+/g, '').toLowerCase();
}
function isPlayableTextureUrl(value) {
    return TEXTURE_EXTENSION.test(String(value || '').split(/[?#]/, 1)[0]);
}
function normalizeWebpQuality(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return exports.PLAYABLE_TRANSPARENT_WEBP_QUALITY;
    const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(1, Math.min(100, Math.round(percent)));
}
function deepClone(value) {
    return JSON.parse(JSON.stringify(value !== null && value !== void 0 ? value : {}));
}
function presetKey(spec) {
    return `${spec.presetId}\u0000${spec.presetName}\u0000${spec.quality}`;
}
function normalizeDbUrl(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function validatePresetSpec(value, label) {
    const presetId = String((value === null || value === void 0 ? void 0 : value.presetId) || '').trim();
    const presetName = String((value === null || value === void 0 ? void 0 : value.presetName) || '').trim();
    const quality = Number(value === null || value === void 0 ? void 0 : value.quality);
    if (!presetId || !presetName || !Number.isFinite(quality) || quality < 1 || quality > 100) {
        throw new Error(`Invalid texture compression ${label}; presetId, presetName, and quality 1-100 are required.`);
    }
    return { presetId, presetName, quality: normalizeWebpQuality(quality) };
}
function loadProjectTexturePolicy(options = {}) {
    var _a, _b;
    const fallback = {
        version: 1,
        default: validatePresetSpec({
            presetId: options.presetId || exports.PLAYABLE_TRANSPARENT_PRESET_ID,
            presetName: options.presetName || exports.PLAYABLE_TRANSPARENT_PRESET_NAME,
            quality: (_a = options.quality) !== null && _a !== void 0 ? _a : exports.PLAYABLE_TRANSPARENT_WEBP_QUALITY,
        }, 'default'),
        overrides: [],
    };
    const projectRoot = String(((_b = Editor === null || Editor === void 0 ? void 0 : Editor.Project) === null || _b === void 0 ? void 0 : _b.path) || '').trim();
    if (!projectRoot)
        return fallback;
    const policyFile = path.join(projectRoot, 'tools', 'texture-compression-policy.json');
    if (!fs.existsSync(policyFile))
        return fallback;
    let source;
    try {
        source = JSON.parse(fs.readFileSync(policyFile, 'utf8').replace(/^\uFEFF/, ''));
    }
    catch (error) {
        throw new Error(`Cannot read ${policyFile}: ${(error === null || error === void 0 ? void 0 : error.message) || String(error)}`);
    }
    if ((source === null || source === void 0 ? void 0 : source.version) !== 1)
        throw new Error(`Unsupported texture compression policy version in ${policyFile}.`);
    const document = {
        version: 1,
        default: validatePresetSpec(source.default, 'default'),
        overrides: [],
    };
    for (const [index, rule] of (source.overrides || []).entries()) {
        const pathPrefix = normalizeDbUrl(rule === null || rule === void 0 ? void 0 : rule.pathPrefix);
        if (!pathPrefix.startsWith('db://assets/'))
            throw new Error(`Invalid texture compression override ${index}; pathPrefix must be under db://assets/.`);
        document.overrides.push(Object.assign({ pathPrefix }, validatePresetSpec(rule, `override ${index}`)));
    }
    return document;
}
function texturePresetForUrl(url, policy) {
    const normalized = normalizeDbUrl(url);
    let selected = null;
    for (const rule of policy.overrides || []) {
        if (normalized === rule.pathPrefix || normalized.startsWith(`${rule.pathPrefix}/`)) {
            if (!selected || rule.pathPrefix.length > selected.pathPrefix.length)
                selected = rule;
        }
    }
    return selected || policy.default;
}
function assetIdentity(payload) {
    if (typeof payload === 'string')
        return payload;
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const identity = assetIdentity(item);
            if (identity)
                return identity;
        }
        return null;
    }
    if (!payload || typeof payload !== 'object')
        return null;
    return payload.uuid || payload.url || payload.path || payload.source || null;
}
class TextureCompressionPolicy {
    constructor() {
        this.fullScan = null;
        this.assetInFlight = new Set();
        this.presetMutation = Promise.resolve();
    }
    async enforceAll(options = {}) {
        if (this.fullScan)
            return this.fullScan;
        this.fullScan = this.enforceAllInternal(options).finally(() => {
            this.fullScan = null;
        });
        return this.fullScan;
    }
    async enforceAsset(payload, options = {}) {
        const identity = assetIdentity(payload);
        if (!identity)
            return { status: 'skipped', url: '', error: 'Asset broadcast did not include a UUID or URL.' };
        if (this.assetInFlight.has(identity))
            return { status: 'unchanged', url: identity };
        this.assetInFlight.add(identity);
        try {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', identity);
            const url = String((info === null || info === void 0 ? void 0 : info.url) || (info === null || info === void 0 ? void 0 : info.path) || (info === null || info === void 0 ? void 0 : info.source) || identity);
            if (!info || info.isDirectory || !isPlayableTextureUrl(url))
                return { status: 'skipped', url };
            const policy = loadProjectTexturePolicy(options);
            const spec = texturePresetForUrl(url, policy);
            const preset = await this.ensurePreset(Object.assign(Object.assign({}, options), spec));
            return await this.applyAsset(identity, preset.id, Boolean(options.dryRun));
        }
        catch (error) {
            return { status: 'failed', url: identity, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
        finally {
            this.assetInFlight.delete(identity);
        }
    }
    async enforceAllInternal(options) {
        const directory = String(options.directory || DEFAULT_DIRECTORY).replace(/\/$/, '');
        const dryRun = Boolean(options.dryRun);
        const ready = await Editor.Message.request('asset-db', 'query-ready');
        if (!ready)
            throw new Error('Cocos Asset DB is not ready; texture compression policy was not applied.');
        const policy = loadProjectTexturePolicy(options);
        const presetSpecs = [policy.default, ...(policy.overrides || [])];
        const presetsByKey = new Map();
        for (const spec of presetSpecs) {
            const key = presetKey(spec);
            if (!presetsByKey.has(key))
                presetsByKey.set(key, await this.ensurePreset(Object.assign(Object.assign({}, options), spec)));
        }
        const preset = presetsByKey.get(presetKey(policy.default));
        const assets = await Editor.Message.request('asset-db', 'query-assets', {
            pattern: `${directory}/**/*`,
        });
        if (!Array.isArray(assets))
            throw new Error('Cocos Asset DB returned an invalid texture inventory.');
        if (assets.length > MAX_TEXTURES_PER_SCAN) {
            throw new Error(`Texture policy scan exceeded the ${MAX_TEXTURES_PER_SCAN} asset safety budget.`);
        }
        const report = {
            complete: false,
            dryRun,
            directory,
            preset,
            presets: Array.from(presetsByKey.values()),
            scanned: assets.length,
            eligible: 0,
            updated: 0,
            unchanged: 0,
            skipped: 0,
            failed: 0,
            failures: [],
        };
        for (const asset of assets) {
            const url = String((asset === null || asset === void 0 ? void 0 : asset.url) || (asset === null || asset === void 0 ? void 0 : asset.path) || (asset === null || asset === void 0 ? void 0 : asset.source) || '');
            if (!isPlayableTextureUrl(url)) {
                report.skipped += 1;
                continue;
            }
            report.eligible += 1;
            const spec = texturePresetForUrl(url, policy);
            const targetPreset = presetsByKey.get(presetKey(spec));
            if (!targetPreset)
                throw new Error(`Texture policy preset was not initialized for ${url}.`);
            const result = await this.applyAsset((asset === null || asset === void 0 ? void 0 : asset.uuid) || url, targetPreset.id, dryRun);
            if (result.status === 'updated')
                report.updated += 1;
            else if (result.status === 'unchanged')
                report.unchanged += 1;
            else if (result.status === 'skipped')
                report.skipped += 1;
            else {
                report.failed += 1;
                if (report.failures.length < 32) {
                    report.failures.push({ url: result.url || url, error: result.error || 'Unknown Asset DB failure' });
                }
            }
        }
        report.complete = report.failed === 0 && report.eligible === report.updated + report.unchanged;
        return report;
    }
    async ensurePreset(options) {
        const previous = this.presetMutation;
        let release;
        this.presetMutation = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await this.ensurePresetExclusive(options);
        }
        finally {
            release();
        }
    }
    async ensurePresetExclusive(options) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const profileApi = Editor.Profile;
        if (!(profileApi === null || profileApi === void 0 ? void 0 : profileApi.getProject) || !(profileApi === null || profileApi === void 0 ? void 0 : profileApi.setProject)) {
            throw new Error('Editor.Profile project API is unavailable; cannot ensure texture compression preset.');
        }
        const requestedName = String(options.presetName || exports.PLAYABLE_TRANSPARENT_PRESET_NAME).trim() || exports.PLAYABLE_TRANSPARENT_PRESET_NAME;
        const requestedId = String(options.presetId || exports.PLAYABLE_TRANSPARENT_PRESET_ID).trim() || exports.PLAYABLE_TRANSPARENT_PRESET_ID;
        const quality = normalizeWebpQuality(options.quality);
        const current = deepClone(await profileApi.getProject('builder', 'textureCompressConfig') || {});
        current.userPreset || (current.userPreset = {});
        let id = '';
        let entry = null;
        const requestedEntry = current.userPreset[requestedId];
        if ((requestedEntry === null || requestedEntry === void 0 ? void 0 : requestedEntry.name) && normalizedPresetName(requestedEntry.name) === normalizedPresetName(requestedName)) {
            id = requestedId;
            entry = requestedEntry;
        }
        else {
            const wanted = normalizedPresetName(requestedName);
            for (const [candidateId, candidate] of Object.entries(current.userPreset)) {
                if (candidate && normalizedPresetName(candidate.name) === wanted) {
                    id = candidateId;
                    entry = candidate;
                    break;
                }
            }
        }
        let created = false;
        let changed = false;
        if (!entry) {
            id = requestedId;
            if (current.userPreset[id]) {
                throw new Error(`Texture preset ID ${id} is already occupied by preset ${current.userPreset[id].name || '<invalid>'}.`);
            }
            current.userPreset[id] = {
                name: requestedName,
                options: { web: { webp: { quality } } },
            };
            entry = current.userPreset[id];
            created = true;
            changed = true;
        }
        else {
            const currentWeb = (_a = entry === null || entry === void 0 ? void 0 : entry.options) === null || _a === void 0 ? void 0 : _a.web;
            const keys = currentWeb && typeof currentWeb === 'object' ? Object.keys(currentWeb) : [];
            const currentQuality = normalizeWebpQuality((_b = currentWeb === null || currentWeb === void 0 ? void 0 : currentWeb.webp) === null || _b === void 0 ? void 0 : _b.quality);
            if (keys.length !== 1 || keys[0] !== 'webp' || currentQuality !== quality) {
                entry.options || (entry.options = {});
                entry.options.web = { webp: { quality } };
                changed = true;
            }
        }
        if (changed && !options.dryRun) {
            await profileApi.setProject('builder', 'textureCompressConfig', current);
            const verified = await profileApi.getProject('builder', 'textureCompressConfig');
            const verifiedEntry = (_c = verified === null || verified === void 0 ? void 0 : verified.userPreset) === null || _c === void 0 ? void 0 : _c[id];
            const verifiedWeb = (_d = verifiedEntry === null || verifiedEntry === void 0 ? void 0 : verifiedEntry.options) === null || _d === void 0 ? void 0 : _d.web;
            if (!verifiedEntry
                || Object.keys(verifiedWeb || {}).length !== 1
                || !(verifiedWeb === null || verifiedWeb === void 0 ? void 0 : verifiedWeb.webp)
                || normalizeWebpQuality(verifiedWeb.webp.quality) !== quality) {
                throw new Error(`Texture compression preset ${requestedName} did not persist as WebP quality ${quality}.`);
            }
            entry = verifiedEntry;
        }
        return {
            id,
            name: String(entry.name || requestedName),
            created,
            changed,
            webpQuality: (_h = (_g = (_f = (_e = entry === null || entry === void 0 ? void 0 : entry.options) === null || _e === void 0 ? void 0 : _e.web) === null || _f === void 0 ? void 0 : _f.webp) === null || _g === void 0 ? void 0 : _g.quality) !== null && _h !== void 0 ? _h : null,
        };
    }
    async applyAsset(identity, presetId, dryRun) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        var _j;
        try {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', identity);
            const url = String((info === null || info === void 0 ? void 0 : info.url) || (info === null || info === void 0 ? void 0 : info.path) || (info === null || info === void 0 ? void 0 : info.source) || identity);
            if (!info || info.isDirectory || !isPlayableTextureUrl(url))
                return { status: 'skipped', url };
            const meta = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!meta || meta.importer !== 'image') {
                return { status: 'failed', url, uuid: info.uuid, error: 'Asset is a PNG/JPG/JPEG but Cocos did not return image importer metadata.' };
            }
            if (((_b = (_a = meta.userData) === null || _a === void 0 ? void 0 : _a.compressSettings) === null || _b === void 0 ? void 0 : _b.useCompressTexture) === true && ((_d = (_c = meta.userData) === null || _c === void 0 ? void 0 : _c.compressSettings) === null || _d === void 0 ? void 0 : _d.presetId) === presetId) {
                return { status: 'unchanged', url, uuid: info.uuid };
            }
            if (dryRun)
                return { status: 'updated', url, uuid: info.uuid };
            const next = deepClone(meta);
            next.userData || (next.userData = {});
            // Cocos 3.8 reads only this nested importer field during builds.
            (_j = next.userData).compressSettings || (_j.compressSettings = {});
            next.userData.compressSettings.useCompressTexture = true;
            next.userData.compressSettings.presetId = presetId;
            await Editor.Message.request('asset-db', 'save-asset-meta', info.uuid || identity, JSON.stringify(next, null, 2));
            const verified = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (((_f = (_e = verified === null || verified === void 0 ? void 0 : verified.userData) === null || _e === void 0 ? void 0 : _e.compressSettings) === null || _f === void 0 ? void 0 : _f.useCompressTexture) !== true || ((_h = (_g = verified === null || verified === void 0 ? void 0 : verified.userData) === null || _g === void 0 ? void 0 : _g.compressSettings) === null || _h === void 0 ? void 0 : _h.presetId) !== presetId) {
                throw new Error('Asset DB accepted save-asset-meta but the compression settings did not persist.');
            }
            return { status: 'updated', url, uuid: info.uuid };
        }
        catch (error) {
            return { status: 'failed', url: identity, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
    }
}
exports.TextureCompressionPolicy = TextureCompressionPolicy;
let sharedPolicy = null;
let automationStarted = false;
let bootstrapTimer = null;
const broadcastListeners = [];
const MAX_BOOTSTRAP_RETRY_DELAY_MS = 30000;
function getTextureCompressionPolicy() {
    sharedPolicy || (sharedPolicy = new TextureCompressionPolicy());
    return sharedPolicy;
}
function logAutomationError(scope, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TextureCompressionPolicy] ${scope}: ${message}`);
}
function scheduleBootstrapScan(attempt = 0) {
    const policy = getTextureCompressionPolicy();
    // The extension can load before Asset DB and can also miss asset-db:ready if
    // that broadcast happened before listeners were registered. Keep a cheap,
    // capped readiness poll alive instead of turning normal startup ordering into
    // a red console error after an arbitrary retry count.
    const delayMs = attempt === 0 ? 500 : Math.min(1000 * (2 ** Math.min(attempt - 1, 5)), MAX_BOOTSTRAP_RETRY_DELAY_MS);
    bootstrapTimer = setTimeout(() => {
        bootstrapTimer = null;
        if (!automationStarted)
            return;
        void policy.enforceAll().then((report) => {
            console.log(`[TextureCompressionPolicy] preset=${report.preset.name} eligible=${report.eligible} updated=${report.updated} unchanged=${report.unchanged} failed=${report.failed}`);
        }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (/asset db is not ready/i.test(message) && automationStarted) {
                scheduleBootstrapScan(attempt + 1);
                return;
            }
            logAutomationError('startup scan', error);
        });
    }, delayMs);
}
function startTextureCompressionAutomation() {
    if (automationStarted)
        return;
    automationStarted = true;
    const messageApi = Editor.Message;
    const policy = getTextureCompressionPolicy();
    if (typeof (messageApi === null || messageApi === void 0 ? void 0 : messageApi.addBroadcastListener) === 'function') {
        const onAsset = (payload) => {
            void policy.enforceAsset(payload).then((result) => {
                if (result.status === 'failed')
                    logAutomationError(result.url || 'asset broadcast', result.error || 'unknown failure');
            }).catch((error) => logAutomationError('asset broadcast', error));
        };
        const onReady = () => {
            void policy.enforceAll().then((report) => {
                if (!report.complete)
                    logAutomationError('asset-db ready scan', `${report.failed} texture(s) failed`);
            }).catch((error) => logAutomationError('asset-db ready scan', error));
        };
        for (const event of ['asset-db:asset-add', 'asset-db:asset-change']) {
            messageApi.addBroadcastListener(event, onAsset);
            broadcastListeners.push([event, onAsset]);
        }
        messageApi.addBroadcastListener('asset-db:ready', onReady);
        broadcastListeners.push(['asset-db:ready', onReady]);
    }
    else {
        console.warn('[TextureCompressionPolicy] Editor broadcast listeners are unavailable; use assetAdvanced_enforce_texture_compression_policy for existing assets.');
    }
    scheduleBootstrapScan();
}
function stopTextureCompressionAutomation() {
    if (!automationStarted)
        return;
    automationStarted = false;
    if (bootstrapTimer) {
        clearTimeout(bootstrapTimer);
        bootstrapTimer = null;
    }
    const messageApi = Editor.Message;
    if (typeof (messageApi === null || messageApi === void 0 ? void 0 : messageApi.removeBroadcastListener) === 'function') {
        for (const [event, listener] of broadcastListeners)
            messageApi.removeBroadcastListener(event, listener);
    }
    broadcastListeners.length = 0;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGV4dHVyZS1jb21wcmVzc2lvbi1wb2xpY3kuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvdGV4dHVyZS1jb21wcmVzc2lvbi1wb2xpY3kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBbUVBLG9EQUVDO0FBRUQsb0RBS0M7QUF3QkQsNERBZ0NDO0FBRUQsa0RBU0M7QUE4T0Qsa0VBR0M7QUE4QkQsOEVBMkJDO0FBRUQsNEVBWUM7QUF2Y0QsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUU3QixNQUFNLGlCQUFpQixHQUFHLGFBQWEsQ0FBQztBQUMzQixRQUFBLDhCQUE4QixHQUFHLHdCQUF3QixDQUFDO0FBQzFELFFBQUEsZ0NBQWdDLEdBQUcscUJBQXFCLENBQUM7QUFDekQsUUFBQSxpQ0FBaUMsR0FBRyxFQUFFLENBQUM7QUFDdkMsUUFBQSx5QkFBeUIsR0FBRyx3QkFBd0IsQ0FBQztBQUNyRCxRQUFBLDJCQUEyQixHQUFHLGdCQUFnQixDQUFDO0FBQy9DLFFBQUEsNEJBQTRCLEdBQUcsRUFBRSxDQUFDO0FBRS9DLE1BQU0saUJBQWlCLEdBQUcsbUJBQW1CLENBQUM7QUFDOUMsTUFBTSxxQkFBcUIsR0FBRyxLQUFNLENBQUM7QUFtRHJDLFNBQVMsb0JBQW9CLENBQUMsS0FBYztJQUN4QyxPQUFPLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztBQUNyRSxDQUFDO0FBRUQsU0FBZ0Isb0JBQW9CLENBQUMsS0FBYztJQUMvQyxPQUFPLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzRSxDQUFDO0FBRUQs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O1NBQU0sQ0FBQztRQUNKLE9BQU8sQ0FBQyxJQUFJLENBQUMsa0pBQWtKLENBQUMsQ0FBQztJQUNySyxDQUFDO0lBRUQscUJBQXFCLEVBQUUsQ0FBQztBQUM1QixDQUFDO0FBRUQsU0FBZ0IsZ0NBQWdDO0lBQzVDLElBQUksQ0FBQyxpQkFBaUI7UUFBRSxPQUFPO0lBQy9CLGlCQUFpQixHQUFHLEtBQUssQ0FBQztJQUMxQixJQUFJLGNBQWMsRUFBRSxDQUFDO1FBQ2pCLFlBQVksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUM3QixjQUFjLEdBQUcsSUFBSSxDQUFDO0lBQzFCLENBQUM7SUFDRCxNQUFNLFVBQVUsR0FBUyxNQUFjLENBQUMsT0FBTyxDQUFDO0lBQ2hELElBQUksT0FBTyxDQUFBLFVBQVUsYUFBVixVQUFVLHVCQUFWLFVBQVUsQ0FBRSx1QkFBdUIsQ0FBQSxLQUFLLFVBQVUsRUFBRSxDQUFDO1FBQzVELEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsSUFBSSxrQkFBa0I7WUFBRSxVQUFVLENBQUMsdUJBQXVCLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQzVHLENBQUM7SUFDRCxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcblxyXG5jb25zdCBERUZBVUxUX0RJUkVDVE9SWSA9ICdkYjovL2Fzc2V0cyc7XHJcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfSUQgPSAnMWZZRzBoN01KRGNwK3pBMmNNY1VzUic7XHJcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfTkFNRSA9ICdQbGF5YWJsZVRyYW5zcGFyZW50JztcclxuZXhwb3J0IGNvbnN0IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1dFQlBfUVVBTElUWSA9IDUwO1xyXG5leHBvcnQgY29uc3QgUExBWUFCTEVfT1BBUVVFX1BSRVNFVF9JRCA9ICdjYU4xc2hWbXBFRUtTcXF1WjY0c3V0JztcclxuZXhwb3J0IGNvbnN0IFBMQVlBQkxFX09QQVFVRV9QUkVTRVRfTkFNRSA9ICdQbGF5YWJsZU9wYXF1ZSc7XHJcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9PUEFRVUVfV0VCUF9RVUFMSVRZID0gMjA7XHJcblxyXG5jb25zdCBURVhUVVJFX0VYVEVOU0lPTiA9IC9cXC4oPzpwbmd8anBlP2cpJC9pO1xyXG5jb25zdCBNQVhfVEVYVFVSRVNfUEVSX1NDQU4gPSAyMF8wMDA7XHJcblxyXG50eXBlIFRleHR1cmVQb2xpY3lPcHRpb25zID0ge1xyXG4gICAgZGlyZWN0b3J5Pzogc3RyaW5nO1xyXG4gICAgcHJlc2V0SWQ/OiBzdHJpbmc7XHJcbiAgICBwcmVzZXROYW1lPzogc3RyaW5nO1xyXG4gICAgcXVhbGl0eT86IG51bWJlcjtcclxuICAgIGRyeVJ1bj86IGJvb2xlYW47XHJcbn07XHJcblxyXG50eXBlIFRleHR1cmVQcmVzZXRTcGVjID0ge1xyXG4gICAgcHJlc2V0SWQ6IHN0cmluZztcclxuICAgIHByZXNldE5hbWU6IHN0cmluZztcclxuICAgIHF1YWxpdHk6IG51bWJlcjtcclxufTtcclxuXHJcbnR5cGUgVGV4dHVyZVBvbGljeVJ1bGUgPSBUZXh0dXJlUHJlc2V0U3BlYyAmIHsgcGF0aFByZWZpeDogc3RyaW5nIH07XHJcbnR5cGUgVGV4dHVyZVBvbGljeURvY3VtZW50ID0ge1xyXG4gICAgdmVyc2lvbjogMTtcclxuICAgIGRlZmF1bHQ6IFRleHR1cmVQcmVzZXRTcGVjO1xyXG4gICAgb3ZlcnJpZGVzPzogVGV4dHVyZVBvbGljeVJ1bGVbXTtcclxufTtcclxuXHJcbnR5cGUgVGV4dHVyZUFwcGx5UmVzdWx0ID0ge1xyXG4gICAgc3RhdHVzOiAndXBkYXRlZCcgfCAndW5jaGFuZ2VkJyB8ICdza2lwcGVkJyB8ICdmYWlsZWQnO1xyXG4gICAgdXJsOiBzdHJpbmc7XHJcbiAgICB1dWlkPzogc3RyaW5nO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbn07XHJcblxyXG5leHBvcnQgdHlwZSBUZXh0dXJlUG9saWN5UmVwb3J0ID0ge1xyXG4gICAgY29tcGxldGU6IGJvb2xlYW47XHJcbiAgICBkcnlSdW46IGJvb2xlYW47XHJcbiAgICBkaXJlY3Rvcnk6IHN0cmluZztcclxuICAgIHByZXNldDoge1xyXG4gICAgICAgIGlkOiBzdHJpbmc7XHJcbiAgICAgICAgbmFtZTogc3RyaW5nO1xyXG4gICAgICAgIGNyZWF0ZWQ6IGJvb2xlYW47XHJcbiAgICAgICAgY2hhbmdlZDogYm9vbGVhbjtcclxuICAgICAgICB3ZWJwUXVhbGl0eTogbnVtYmVyIHwgc3RyaW5nIHwgbnVsbDtcclxuICAgIH07XHJcbiAgICBwcmVzZXRzPzogQXJyYXk8VGV4dHVyZVBvbGljeVJlcG9ydFsncHJlc2V0J10+O1xyXG4gICAgc2Nhbm5lZDogbnVtYmVyO1xyXG4gICAgZWxpZ2libGU6IG51bWJlcjtcclxuICAgIHVwZGF0ZWQ6IG51bWJlcjtcclxuICAgIHVuY2hhbmdlZDogbnVtYmVyO1xyXG4gICAgc2tpcHBlZDogbnVtYmVyO1xyXG4gICAgZmFpbGVkOiBudW1iZXI7XHJcbiAgICBmYWlsdXJlczogQXJyYXk8eyB1cmw6IHN0cmluZzsgZXJyb3I6IHN0cmluZyB9PjtcclxufTtcclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZWRQcmVzZXROYW1lKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBTdHJpbmcodmFsdWUgfHwgJycpLnJlcGxhY2UoL1tcXHNfLV0rL2csICcnKS50b0xvd2VyQ2FzZSgpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaXNQbGF5YWJsZVRleHR1cmVVcmwodmFsdWU6IHVua25vd24pOiBib29sZWFuIHtcclxuICAgIHJldHVybiBURVhUVVJFX0VYVEVOU0lPTi50ZXN0KFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoL1s/I10vLCAxKVswXSk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVXZWJwUXVhbGl0eSh2YWx1ZTogdW5rbm93bik6IG51bWJlciB7XHJcbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKHZhbHVlKTtcclxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpKSByZXR1cm4gUExBWUFCTEVfVFJBTlNQQVJFTlRfV0VCUF9RVUFMSVRZO1xyXG4gICAgY29uc3QgcGVyY2VudCA9IG51bWVyaWMgPiAwICYmIG51bWVyaWMgPD0gMSA/IG51bWVyaWMgKiAxMDAgOiBudW1lcmljO1xyXG4gICAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGgubWluKDEwMCwgTWF0aC5yb3VuZChwZXJjZW50KSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWVwQ2xvbmU8VD4odmFsdWU6IFQpOiBUIHtcclxuICAgIHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHZhbHVlID8/IHt9KSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHByZXNldEtleShzcGVjOiBUZXh0dXJlUHJlc2V0U3BlYyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gYCR7c3BlYy5wcmVzZXRJZH1cXHUwMDAwJHtzcGVjLnByZXNldE5hbWV9XFx1MDAwMCR7c3BlYy5xdWFsaXR5fWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZURiVXJsKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBTdHJpbmcodmFsdWUgfHwgJycpLnJlcGxhY2UoL1xcXFwvZywgJy8nKS5yZXBsYWNlKC9cXC8rJC8sICcnKS50b0xvd2VyQ2FzZSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB2YWxpZGF0ZVByZXNldFNwZWModmFsdWU6IGFueSwgbGFiZWw6IHN0cmluZyk6IFRleHR1cmVQcmVzZXRTcGVjIHtcclxuICAgIGNvbnN0IHByZXNldElkID0gU3RyaW5nKHZhbHVlPy5wcmVzZXRJZCB8fCAnJykudHJpbSgpO1xyXG4gICAgY29uc3QgcHJlc2V0TmFtZSA9IFN0cmluZyh2YWx1ZT8ucHJlc2V0TmFtZSB8fCAnJykudHJpbSgpO1xyXG4gICAgY29uc3QgcXVhbGl0eSA9IE51bWJlcih2YWx1ZT8ucXVhbGl0eSk7XHJcbiAgICBpZiAoIXByZXNldElkIHx8ICFwcmVzZXROYW1lIHx8ICFOdW1iZXIuaXNGaW5pdGUocXVhbGl0eSkgfHwgcXVhbGl0eSA8IDEgfHwgcXVhbGl0eSA+IDEwMCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0ZXh0dXJlIGNvbXByZXNzaW9uICR7bGFiZWx9OyBwcmVzZXRJZCwgcHJlc2V0TmFtZSwgYW5kIHF1YWxpdHkgMS0xMDAgYXJlIHJlcXVpcmVkLmApO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgcHJlc2V0SWQsIHByZXNldE5hbWUsIHF1YWxpdHk6IG5vcm1hbGl6ZVdlYnBRdWFsaXR5KHF1YWxpdHkpIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBsb2FkUHJvamVjdFRleHR1cmVQb2xpY3kob3B0aW9uczogVGV4dHVyZVBvbGljeU9wdGlvbnMgPSB7fSk6IFRleHR1cmVQb2xpY3lEb2N1bWVudCB7XHJcbiAgICBjb25zdCBmYWxsYmFjazogVGV4dHVyZVBvbGljeURvY3VtZW50ID0ge1xyXG4gICAgICAgIHZlcnNpb246IDEsXHJcbiAgICAgICAgZGVmYXVsdDogdmFsaWRhdGVQcmVzZXRTcGVjKHtcclxuICAgICAgICAgICAgcHJlc2V0SWQ6IG9wdGlvbnMucHJlc2V0SWQgfHwgUExBWUFCTEVfVFJBTlNQQVJFTlRfUFJFU0VUX0lELFxyXG4gICAgICAgICAgICBwcmVzZXROYW1lOiBvcHRpb25zLnByZXNldE5hbWUgfHwgUExBWUFCTEVfVFJBTlNQQVJFTlRfUFJFU0VUX05BTUUsXHJcbiAgICAgICAgICAgIHF1YWxpdHk6IG9wdGlvbnMucXVhbGl0eSA/PyBQTEFZQUJMRV9UUkFOU1BBUkVOVF9XRUJQX1FVQUxJVFksXHJcbiAgICAgICAgfSwgJ2RlZmF1bHQnKSxcclxuICAgICAgICBvdmVycmlkZXM6IFtdLFxyXG4gICAgfTtcclxuICAgIGNvbnN0IHByb2plY3RSb290ID0gU3RyaW5nKChFZGl0b3IgYXMgYW55KT8uUHJvamVjdD8ucGF0aCB8fCAnJykudHJpbSgpO1xyXG4gICAgaWYgKCFwcm9qZWN0Um9vdCkgcmV0dXJuIGZhbGxiYWNrO1xyXG4gICAgY29uc3QgcG9saWN5RmlsZSA9IHBhdGguam9pbihwcm9qZWN0Um9vdCwgJ3Rvb2xzJywgJ3RleHR1cmUtY29tcHJlc3Npb24tcG9saWN5Lmpzb24nKTtcclxuICAgIGlmICghZnMuZXhpc3RzU3luYyhwb2xpY3lGaWxlKSkgcmV0dXJuIGZhbGxiYWNrO1xyXG4gICAgbGV0IHNvdXJjZTogYW55O1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBzb3VyY2UgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyhwb2xpY3lGaWxlLCAndXRmOCcpLnJlcGxhY2UoL15cXHVGRUZGLywgJycpKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZWFkICR7cG9saWN5RmlsZX06ICR7ZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKX1gKTtcclxuICAgIH1cclxuICAgIGlmIChzb3VyY2U/LnZlcnNpb24gIT09IDEpIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgdGV4dHVyZSBjb21wcmVzc2lvbiBwb2xpY3kgdmVyc2lvbiBpbiAke3BvbGljeUZpbGV9LmApO1xyXG4gICAgY29uc3QgZG9jdW1lbnQ6IFRleHR1cmVQb2xpY3lEb2N1bWVudCA9IHtcclxuICAgICAgICB2ZXJzaW9uOiAxLFxyXG4gICAgICAgIGRlZmF1bHQ6IHZhbGlkYXRlUHJlc2V0U3BlYyhzb3VyY2UuZGVmYXVsdCwgJ2RlZmF1bHQnKSxcclxuICAgICAgICBvdmVycmlkZXM6IFtdLFxyXG4gICAgfTtcclxuICAgIGZvciAoY29uc3QgW2luZGV4LCBydWxlXSBvZiAoc291cmNlLm92ZXJyaWRlcyB8fCBbXSkuZW50cmllcygpKSB7XHJcbiAgICAgICAgY29uc3QgcGF0aFByZWZpeCA9IG5vcm1hbGl6ZURiVXJsKHJ1bGU/LnBhdGhQcmVmaXgpO1xyXG4gICAgICAgIGlmICghcGF0aFByZWZpeC5zdGFydHNXaXRoKCdkYjovL2Fzc2V0cy8nKSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHRleHR1cmUgY29tcHJlc3Npb24gb3ZlcnJpZGUgJHtpbmRleH07IHBhdGhQcmVmaXggbXVzdCBiZSB1bmRlciBkYjovL2Fzc2V0cy8uYCk7XHJcbiAgICAgICAgZG9jdW1lbnQub3ZlcnJpZGVzIS5wdXNoKHsgcGF0aFByZWZpeCwgLi4udmFsaWRhdGVQcmVzZXRTcGVjKHJ1bGUsIGBvdmVycmlkZSAke2luZGV4fWApIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGRvY3VtZW50O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gdGV4dHVyZVByZXNldEZvclVybCh1cmw6IHN0cmluZywgcG9saWN5OiBUZXh0dXJlUG9saWN5RG9jdW1lbnQpOiBUZXh0dXJlUHJlc2V0U3BlYyB7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplRGJVcmwodXJsKTtcclxuICAgIGxldCBzZWxlY3RlZDogVGV4dHVyZVBvbGljeVJ1bGUgfCBudWxsID0gbnVsbDtcclxuICAgIGZvciAoY29uc3QgcnVsZSBvZiBwb2xpY3kub3ZlcnJpZGVzIHx8IFtdKSB7XHJcbiAgICAgICAgaWYgKG5vcm1hbGl6ZWQgPT09IHJ1bGUucGF0aFByZWZpeCB8fCBub3JtYWxpemVkLnN0YXJ0c1dpdGgoYCR7cnVsZS5wYXRoUHJlZml4fS9gKSkge1xyXG4gICAgICAgICAgICBpZiAoIXNlbGVjdGVkIHx8IHJ1bGUucGF0aFByZWZpeC5sZW5ndGggPiBzZWxlY3RlZC5wYXRoUHJlZml4Lmxlbmd0aCkgc2VsZWN0ZWQgPSBydWxlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBzZWxlY3RlZCB8fCBwb2xpY3kuZGVmYXVsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gYXNzZXRJZGVudGl0eShwYXlsb2FkOiBhbnkpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgIGlmICh0eXBlb2YgcGF5bG9hZCA9PT0gJ3N0cmluZycpIHJldHVybiBwYXlsb2FkO1xyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgcGF5bG9hZCkge1xyXG4gICAgICAgICAgICBjb25zdCBpZGVudGl0eSA9IGFzc2V0SWRlbnRpdHkoaXRlbSk7XHJcbiAgICAgICAgICAgIGlmIChpZGVudGl0eSkgcmV0dXJuIGlkZW50aXR5O1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xyXG4gICAgcmV0dXJuIHBheWxvYWQudXVpZCB8fCBwYXlsb2FkLnVybCB8fCBwYXlsb2FkLnBhdGggfHwgcGF5bG9hZC5zb3VyY2UgfHwgbnVsbDtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFRleHR1cmVDb21wcmVzc2lvblBvbGljeSB7XHJcbiAgICBwcml2YXRlIGZ1bGxTY2FuOiBQcm9taXNlPFRleHR1cmVQb2xpY3lSZXBvcnQ+IHwgbnVsbCA9IG51bGw7XHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFzc2V0SW5GbGlnaHQgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICAgIHByaXZhdGUgcHJlc2V0TXV0YXRpb246IFByb21pc2U8dm9pZD4gPSBQcm9taXNlLnJlc29sdmUoKTtcclxuXHJcbiAgICBhc3luYyBlbmZvcmNlQWxsKG9wdGlvbnM6IFRleHR1cmVQb2xpY3lPcHRpb25zID0ge30pOiBQcm9taXNlPFRleHR1cmVQb2xpY3lSZXBvcnQ+IHtcclxuICAgICAgICBpZiAodGhpcy5mdWxsU2NhbikgcmV0dXJuIHRoaXMuZnVsbFNjYW47XHJcbiAgICAgICAgdGhpcy5mdWxsU2NhbiA9IHRoaXMuZW5mb3JjZUFsbEludGVybmFsKG9wdGlvbnMpLmZpbmFsbHkoKCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmZ1bGxTY2FuID0gbnVsbDtcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm4gdGhpcy5mdWxsU2NhbjtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBlbmZvcmNlQXNzZXQocGF5bG9hZDogYW55LCBvcHRpb25zOiBUZXh0dXJlUG9saWN5T3B0aW9ucyA9IHt9KTogUHJvbWlzZTxUZXh0dXJlQXBwbHlSZXN1bHQ+IHtcclxuICAgICAgICBjb25zdCBpZGVudGl0eSA9IGFzc2V0SWRlbnRpdHkocGF5bG9hZCk7XHJcbiAgICAgICAgaWYgKCFpZGVudGl0eSkgcmV0dXJuIHsgc3RhdHVzOiAnc2tpcHBlZCcsIHVybDogJycsIGVycm9yOiAnQXNzZXQgYnJvYWRjYXN0IGRpZCBub3QgaW5jbHVkZSBhIFVVSUQgb3IgVVJMLicgfTtcclxuICAgICAgICBpZiAodGhpcy5hc3NldEluRmxpZ2h0LmhhcyhpZGVudGl0eSkpIHJldHVybiB7IHN0YXR1czogJ3VuY2hhbmdlZCcsIHVybDogaWRlbnRpdHkgfTtcclxuICAgICAgICB0aGlzLmFzc2V0SW5GbGlnaHQuYWRkKGlkZW50aXR5KTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBpbmZvOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgaWRlbnRpdHkpO1xyXG4gICAgICAgICAgICBjb25zdCB1cmwgPSBTdHJpbmcoaW5mbz8udXJsIHx8IGluZm8/LnBhdGggfHwgaW5mbz8uc291cmNlIHx8IGlkZW50aXR5KTtcclxuICAgICAgICAgICAgaWYgKCFpbmZvIHx8IGluZm8uaXNEaXJlY3RvcnkgfHwgIWlzUGxheWFibGVUZXh0dXJlVXJsKHVybCkpIHJldHVybiB7IHN0YXR1czogJ3NraXBwZWQnLCB1cmwgfTtcclxuICAgICAgICAgICAgY29uc3QgcG9saWN5ID0gbG9hZFByb2plY3RUZXh0dXJlUG9saWN5KG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBjb25zdCBzcGVjID0gdGV4dHVyZVByZXNldEZvclVybCh1cmwsIHBvbGljeSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHByZXNldCA9IGF3YWl0IHRoaXMuZW5zdXJlUHJlc2V0KHsgLi4ub3B0aW9ucywgLi4uc3BlYyB9KTtcclxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYXBwbHlBc3NldChpZGVudGl0eSwgcHJlc2V0LmlkLCBCb29sZWFuKG9wdGlvbnMuZHJ5UnVuKSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdmYWlsZWQnLCB1cmw6IGlkZW50aXR5LCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9O1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgIHRoaXMuYXNzZXRJbkZsaWdodC5kZWxldGUoaWRlbnRpdHkpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGVuZm9yY2VBbGxJbnRlcm5hbChvcHRpb25zOiBUZXh0dXJlUG9saWN5T3B0aW9ucyk6IFByb21pc2U8VGV4dHVyZVBvbGljeVJlcG9ydD4ge1xyXG4gICAgICAgIGNvbnN0IGRpcmVjdG9yeSA9IFN0cmluZyhvcHRpb25zLmRpcmVjdG9yeSB8fCBERUZBVUxUX0RJUkVDVE9SWSkucmVwbGFjZSgvXFwvJC8sICcnKTtcclxuICAgICAgICBjb25zdCBkcnlSdW4gPSBCb29sZWFuKG9wdGlvbnMuZHJ5UnVuKTtcclxuICAgICAgICBjb25zdCByZWFkeSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LXJlYWR5Jyk7XHJcbiAgICAgICAgaWYgKCFyZWFkeSkgdGhyb3cgbmV3IEVycm9yKCdDb2NvcyBBc3NldCBEQiBpcyBub3QgcmVhZHk7IHRleHR1cmUgY29tcHJlc3Npb24gcG9saWN5IHdhcyBub3QgYXBwbGllZC4nKTtcclxuXHJcbiAgICAgICAgY29uc3QgcG9saWN5ID0gbG9hZFByb2plY3RUZXh0dXJlUG9saWN5KG9wdGlvbnMpO1xyXG4gICAgICAgIGNvbnN0IHByZXNldFNwZWNzID0gW3BvbGljeS5kZWZhdWx0LCAuLi4ocG9saWN5Lm92ZXJyaWRlcyB8fCBbXSldO1xyXG4gICAgICAgIGNvbnN0IHByZXNldHNCeUtleSA9IG5ldyBNYXA8c3RyaW5nLCBUZXh0dXJlUG9saWN5UmVwb3J0WydwcmVzZXQnXT4oKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHNwZWMgb2YgcHJlc2V0U3BlY3MpIHtcclxuICAgICAgICAgICAgY29uc3Qga2V5ID0gcHJlc2V0S2V5KHNwZWMpO1xyXG4gICAgICAgICAgICBpZiAoIXByZXNldHNCeUtleS5oYXMoa2V5KSkgcHJlc2V0c0J5S2V5LnNldChrZXksIGF3YWl0IHRoaXMuZW5zdXJlUHJlc2V0KHsgLi4ub3B0aW9ucywgLi4uc3BlYyB9KSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHByZXNldCA9IHByZXNldHNCeUtleS5nZXQocHJlc2V0S2V5KHBvbGljeS5kZWZhdWx0KSkhO1xyXG4gICAgICAgIGNvbnN0IGFzc2V0czogYW55W10gPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldHMnLCB7XHJcbiAgICAgICAgICAgIHBhdHRlcm46IGAke2RpcmVjdG9yeX0vKiovKmAsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFzc2V0cykpIHRocm93IG5ldyBFcnJvcignQ29jb3MgQXNzZXQgREIgcmV0dXJuZWQgYW4gaW52YWxpZCB0ZXh0dXJlIGludmVudG9yeS4nKTtcclxuICAgICAgICBpZiAoYXNzZXRzLmxlbmd0aCA+IE1BWF9URVhUVVJFU19QRVJfU0NBTikge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRleHR1cmUgcG9saWN5IHNjYW4gZXhjZWVkZWQgdGhlICR7TUFYX1RFWFRVUkVTX1BFUl9TQ0FOfSBhc3NldCBzYWZldHkgYnVkZ2V0LmApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgcmVwb3J0OiBUZXh0dXJlUG9saWN5UmVwb3J0ID0ge1xyXG4gICAgICAgICAgICBjb21wbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgIGRyeVJ1bixcclxuICAgICAgICAgICAgZGlyZWN0b3J5LFxyXG4gICAgICAgICAgICBwcmVzZXQsXHJcbiAgICAgICAgICAgIHByZXNldHM6IEFycmF5LmZyb20ocHJlc2V0c0J5S2V5LnZhbHVlcygpKSxcclxuICAgICAgICAgICAgc2Nhbm5lZDogYXNzZXRzLmxlbmd0aCxcclxuICAgICAgICAgICAgZWxpZ2libGU6IDAsXHJcbiAgICAgICAgICAgIHVwZGF0ZWQ6IDAsXHJcbiAgICAgICAgICAgIHVuY2hhbmdlZDogMCxcclxuICAgICAgICAgICAgc2tpcHBlZDogMCxcclxuICAgICAgICAgICAgZmFpbGVkOiAwLFxyXG4gICAgICAgICAgICBmYWlsdXJlczogW10sXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBhc3NldCBvZiBhc3NldHMpIHtcclxuICAgICAgICAgICAgY29uc3QgdXJsID0gU3RyaW5nKGFzc2V0Py51cmwgfHwgYXNzZXQ/LnBhdGggfHwgYXNzZXQ/LnNvdXJjZSB8fCAnJyk7XHJcbiAgICAgICAgICAgIGlmICghaXNQbGF5YWJsZVRleHR1cmVVcmwodXJsKSkge1xyXG4gICAgICAgICAgICAgICAgcmVwb3J0LnNraXBwZWQgKz0gMTtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlcG9ydC5lbGlnaWJsZSArPSAxO1xyXG4gICAgICAgICAgICBjb25zdCBzcGVjID0gdGV4dHVyZVByZXNldEZvclVybCh1cmwsIHBvbGljeSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRhcmdldFByZXNldCA9IHByZXNldHNCeUtleS5nZXQocHJlc2V0S2V5KHNwZWMpKTtcclxuICAgICAgICAgICAgaWYgKCF0YXJnZXRQcmVzZXQpIHRocm93IG5ldyBFcnJvcihgVGV4dHVyZSBwb2xpY3kgcHJlc2V0IHdhcyBub3QgaW5pdGlhbGl6ZWQgZm9yICR7dXJsfS5gKTtcclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseUFzc2V0KGFzc2V0Py51dWlkIHx8IHVybCwgdGFyZ2V0UHJlc2V0LmlkLCBkcnlSdW4pO1xyXG4gICAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3VwZGF0ZWQnKSByZXBvcnQudXBkYXRlZCArPSAxO1xyXG4gICAgICAgICAgICBlbHNlIGlmIChyZXN1bHQuc3RhdHVzID09PSAndW5jaGFuZ2VkJykgcmVwb3J0LnVuY2hhbmdlZCArPSAxO1xyXG4gICAgICAgICAgICBlbHNlIGlmIChyZXN1bHQuc3RhdHVzID09PSAnc2tpcHBlZCcpIHJlcG9ydC5za2lwcGVkICs9IDE7XHJcbiAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcmVwb3J0LmZhaWxlZCArPSAxO1xyXG4gICAgICAgICAgICAgICAgaWYgKHJlcG9ydC5mYWlsdXJlcy5sZW5ndGggPCAzMikge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlcG9ydC5mYWlsdXJlcy5wdXNoKHsgdXJsOiByZXN1bHQudXJsIHx8IHVybCwgZXJyb3I6IHJlc3VsdC5lcnJvciB8fCAnVW5rbm93biBBc3NldCBEQiBmYWlsdXJlJyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXBvcnQuY29tcGxldGUgPSByZXBvcnQuZmFpbGVkID09PSAwICYmIHJlcG9ydC5lbGlnaWJsZSA9PT0gcmVwb3J0LnVwZGF0ZWQgKyByZXBvcnQudW5jaGFuZ2VkO1xyXG4gICAgICAgIHJldHVybiByZXBvcnQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBlbnN1cmVQcmVzZXQob3B0aW9uczogVGV4dHVyZVBvbGljeU9wdGlvbnMpOiBQcm9taXNlPFRleHR1cmVQb2xpY3lSZXBvcnRbJ3ByZXNldCddPiB7XHJcbiAgICAgICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLnByZXNldE11dGF0aW9uO1xyXG4gICAgICAgIGxldCByZWxlYXNlITogKCkgPT4gdm9pZDtcclxuICAgICAgICB0aGlzLnByZXNldE11dGF0aW9uID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgcmVsZWFzZSA9IHJlc29sdmU7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYXdhaXQgcHJldmlvdXM7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5zdXJlUHJlc2V0RXhjbHVzaXZlKG9wdGlvbnMpO1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgIHJlbGVhc2UoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBlbnN1cmVQcmVzZXRFeGNsdXNpdmUob3B0aW9uczogVGV4dHVyZVBvbGljeU9wdGlvbnMpOiBQcm9taXNlPFRleHR1cmVQb2xpY3lSZXBvcnRbJ3ByZXNldCddPiB7XHJcbiAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XHJcbiAgICAgICAgaWYgKCFwcm9maWxlQXBpPy5nZXRQcm9qZWN0IHx8ICFwcm9maWxlQXBpPy5zZXRQcm9qZWN0KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRWRpdG9yLlByb2ZpbGUgcHJvamVjdCBBUEkgaXMgdW5hdmFpbGFibGU7IGNhbm5vdCBlbnN1cmUgdGV4dHVyZSBjb21wcmVzc2lvbiBwcmVzZXQuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHJlcXVlc3RlZE5hbWUgPSBTdHJpbmcob3B0aW9ucy5wcmVzZXROYW1lIHx8IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1BSRVNFVF9OQU1FKS50cmltKCkgfHwgUExBWUFCTEVfVFJBTlNQQVJFTlRfUFJFU0VUX05BTUU7XHJcbiAgICAgICAgY29uc3QgcmVxdWVzdGVkSWQgPSBTdHJpbmcob3B0aW9ucy5wcmVzZXRJZCB8fCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfSUQpLnRyaW0oKSB8fCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfSUQ7XHJcbiAgICAgICAgY29uc3QgcXVhbGl0eSA9IG5vcm1hbGl6ZVdlYnBRdWFsaXR5KG9wdGlvbnMucXVhbGl0eSk7XHJcbiAgICAgICAgY29uc3QgY3VycmVudCA9IGRlZXBDbG9uZShhd2FpdCBwcm9maWxlQXBpLmdldFByb2plY3QoJ2J1aWxkZXInLCAndGV4dHVyZUNvbXByZXNzQ29uZmlnJykgfHwge30pO1xyXG4gICAgICAgIGN1cnJlbnQudXNlclByZXNldCB8fD0ge307XHJcblxyXG4gICAgICAgIGxldCBpZCA9ICcnO1xyXG4gICAgICAgIGxldCBlbnRyeTogYW55ID0gbnVsbDtcclxuICAgICAgICBjb25zdCByZXF1ZXN0ZWRFbnRyeSA9IGN1cnJlbnQudXNlclByZXNldFtyZXF1ZXN0ZWRJZF07XHJcbiAgICAgICAgaWYgKHJlcXVlc3RlZEVudHJ5Py5uYW1lICYmIG5vcm1hbGl6ZWRQcmVzZXROYW1lKHJlcXVlc3RlZEVudHJ5Lm5hbWUpID09PSBub3JtYWxpemVkUHJlc2V0TmFtZShyZXF1ZXN0ZWROYW1lKSkge1xyXG4gICAgICAgICAgICBpZCA9IHJlcXVlc3RlZElkO1xyXG4gICAgICAgICAgICBlbnRyeSA9IHJlcXVlc3RlZEVudHJ5O1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG5vcm1hbGl6ZWRQcmVzZXROYW1lKHJlcXVlc3RlZE5hbWUpO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtjYW5kaWRhdGVJZCwgY2FuZGlkYXRlXSBvZiBPYmplY3QuZW50cmllczxhbnk+KGN1cnJlbnQudXNlclByZXNldCkpIHtcclxuICAgICAgICAgICAgICAgIGlmIChjYW5kaWRhdGUgJiYgbm9ybWFsaXplZFByZXNldE5hbWUoY2FuZGlkYXRlLm5hbWUpID09PSB3YW50ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZCA9IGNhbmRpZGF0ZUlkO1xyXG4gICAgICAgICAgICAgICAgICAgIGVudHJ5ID0gY2FuZGlkYXRlO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZXQgY3JlYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7XHJcbiAgICAgICAgaWYgKCFlbnRyeSkge1xyXG4gICAgICAgICAgICBpZCA9IHJlcXVlc3RlZElkO1xyXG4gICAgICAgICAgICBpZiAoY3VycmVudC51c2VyUHJlc2V0W2lkXSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZXh0dXJlIHByZXNldCBJRCAke2lkfSBpcyBhbHJlYWR5IG9jY3VwaWVkIGJ5IHByZXNldCAke2N1cnJlbnQudXNlclByZXNldFtpZF0ubmFtZSB8fCAnPGludmFsaWQ+J30uYCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY3VycmVudC51c2VyUHJlc2V0W2lkXSA9IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6IHJlcXVlc3RlZE5hbWUsXHJcbiAgICAgICAgICAgICAgICBvcHRpb25zOiB7IHdlYjogeyB3ZWJwOiB7IHF1YWxpdHkgfSB9IH0sXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIGVudHJ5ID0gY3VycmVudC51c2VyUHJlc2V0W2lkXTtcclxuICAgICAgICAgICAgY3JlYXRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRXZWIgPSBlbnRyeT8ub3B0aW9ucz8ud2ViO1xyXG4gICAgICAgICAgICBjb25zdCBrZXlzID0gY3VycmVudFdlYiAmJiB0eXBlb2YgY3VycmVudFdlYiA9PT0gJ29iamVjdCcgPyBPYmplY3Qua2V5cyhjdXJyZW50V2ViKSA6IFtdO1xyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50UXVhbGl0eSA9IG5vcm1hbGl6ZVdlYnBRdWFsaXR5KGN1cnJlbnRXZWI/LndlYnA/LnF1YWxpdHkpO1xyXG4gICAgICAgICAgICBpZiAoa2V5cy5sZW5ndGggIT09IDEgfHwga2V5c1swXSAhPT0gJ3dlYnAnIHx8IGN1cnJlbnRRdWFsaXR5ICE9PSBxdWFsaXR5KSB7XHJcbiAgICAgICAgICAgICAgICBlbnRyeS5vcHRpb25zIHx8PSB7fTtcclxuICAgICAgICAgICAgICAgIGVudHJ5Lm9wdGlvbnMud2ViID0geyB3ZWJwOiB7IHF1YWxpdHkgfSB9O1xyXG4gICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChjaGFuZ2VkICYmICFvcHRpb25zLmRyeVJ1bikge1xyXG4gICAgICAgICAgICBhd2FpdCBwcm9maWxlQXBpLnNldFByb2plY3QoJ2J1aWxkZXInLCAndGV4dHVyZUNvbXByZXNzQ29uZmlnJywgY3VycmVudCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgcHJvZmlsZUFwaS5nZXRQcm9qZWN0KCdidWlsZGVyJywgJ3RleHR1cmVDb21wcmVzc0NvbmZpZycpO1xyXG4gICAgICAgICAgICBjb25zdCB2ZXJpZmllZEVudHJ5ID0gdmVyaWZpZWQ/LnVzZXJQcmVzZXQ/LltpZF07XHJcbiAgICAgICAgICAgIGNvbnN0IHZlcmlmaWVkV2ViID0gdmVyaWZpZWRFbnRyeT8ub3B0aW9ucz8ud2ViO1xyXG4gICAgICAgICAgICBpZiAoIXZlcmlmaWVkRW50cnlcclxuICAgICAgICAgICAgICAgIHx8IE9iamVjdC5rZXlzKHZlcmlmaWVkV2ViIHx8IHt9KS5sZW5ndGggIT09IDFcclxuICAgICAgICAgICAgICAgIHx8ICF2ZXJpZmllZFdlYj8ud2VicFxyXG4gICAgICAgICAgICAgICAgfHwgbm9ybWFsaXplV2VicFF1YWxpdHkodmVyaWZpZWRXZWIud2VicC5xdWFsaXR5KSAhPT0gcXVhbGl0eSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZXh0dXJlIGNvbXByZXNzaW9uIHByZXNldCAke3JlcXVlc3RlZE5hbWV9IGRpZCBub3QgcGVyc2lzdCBhcyBXZWJQIHF1YWxpdHkgJHtxdWFsaXR5fS5gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbnRyeSA9IHZlcmlmaWVkRW50cnk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBpZCxcclxuICAgICAgICAgICAgbmFtZTogU3RyaW5nKGVudHJ5Lm5hbWUgfHwgcmVxdWVzdGVkTmFtZSksXHJcbiAgICAgICAgICAgIGNyZWF0ZWQsXHJcbiAgICAgICAgICAgIGNoYW5nZWQsXHJcbiAgICAgICAgICAgIHdlYnBRdWFsaXR5OiBlbnRyeT8ub3B0aW9ucz8ud2ViPy53ZWJwPy5xdWFsaXR5ID8/IG51bGwsXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGFwcGx5QXNzZXQoaWRlbnRpdHk6IHN0cmluZywgcHJlc2V0SWQ6IHN0cmluZywgZHJ5UnVuOiBib29sZWFuKTogUHJvbWlzZTxUZXh0dXJlQXBwbHlSZXN1bHQ+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBpbmZvOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgaWRlbnRpdHkpO1xyXG4gICAgICAgICAgICBjb25zdCB1cmwgPSBTdHJpbmcoaW5mbz8udXJsIHx8IGluZm8/LnBhdGggfHwgaW5mbz8uc291cmNlIHx8IGlkZW50aXR5KTtcclxuICAgICAgICAgICAgaWYgKCFpbmZvIHx8IGluZm8uaXNEaXJlY3RvcnkgfHwgIWlzUGxheWFibGVUZXh0dXJlVXJsKHVybCkpIHJldHVybiB7IHN0YXR1czogJ3NraXBwZWQnLCB1cmwgfTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YTogYW55ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtbWV0YScsIGluZm8udXVpZCB8fCBpZGVudGl0eSk7XHJcbiAgICAgICAgICAgIGlmICghbWV0YSB8fCBtZXRhLmltcG9ydGVyICE9PSAnaW1hZ2UnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdmYWlsZWQnLCB1cmwsIHV1aWQ6IGluZm8udXVpZCwgZXJyb3I6ICdBc3NldCBpcyBhIFBORy9KUEcvSlBFRyBidXQgQ29jb3MgZGlkIG5vdCByZXR1cm4gaW1hZ2UgaW1wb3J0ZXIgbWV0YWRhdGEuJyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtZXRhLnVzZXJEYXRhPy5jb21wcmVzc1NldHRpbmdzPy51c2VDb21wcmVzc1RleHR1cmUgPT09IHRydWUgJiYgbWV0YS51c2VyRGF0YT8uY29tcHJlc3NTZXR0aW5ncz8ucHJlc2V0SWQgPT09IHByZXNldElkKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICd1bmNoYW5nZWQnLCB1cmwsIHV1aWQ6IGluZm8udXVpZCB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChkcnlSdW4pIHJldHVybiB7IHN0YXR1czogJ3VwZGF0ZWQnLCB1cmwsIHV1aWQ6IGluZm8udXVpZCB9O1xyXG5cclxuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGRlZXBDbG9uZShtZXRhKTtcclxuICAgICAgICAgICAgbmV4dC51c2VyRGF0YSB8fD0ge307XHJcbiAgICAgICAgICAgIC8vIENvY29zIDMuOCByZWFkcyBvbmx5IHRoaXMgbmVzdGVkIGltcG9ydGVyIGZpZWxkIGR1cmluZyBidWlsZHMuXHJcbiAgICAgICAgICAgIG5leHQudXNlckRhdGEuY29tcHJlc3NTZXR0aW5ncyB8fD0ge307XHJcbiAgICAgICAgICAgIG5leHQudXNlckRhdGEuY29tcHJlc3NTZXR0aW5ncy51c2VDb21wcmVzc1RleHR1cmUgPSB0cnVlO1xyXG4gICAgICAgICAgICBuZXh0LnVzZXJEYXRhLmNvbXByZXNzU2V0dGluZ3MucHJlc2V0SWQgPSBwcmVzZXRJZDtcclxuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldC1tZXRhJywgaW5mby51dWlkIHx8IGlkZW50aXR5LCBKU09OLnN0cmluZ2lmeShuZXh0LCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHZlcmlmaWVkOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1tZXRhJywgaW5mby51dWlkIHx8IGlkZW50aXR5KTtcclxuICAgICAgICAgICAgaWYgKHZlcmlmaWVkPy51c2VyRGF0YT8uY29tcHJlc3NTZXR0aW5ncz8udXNlQ29tcHJlc3NUZXh0dXJlICE9PSB0cnVlIHx8IHZlcmlmaWVkPy51c2VyRGF0YT8uY29tcHJlc3NTZXR0aW5ncz8ucHJlc2V0SWQgIT09IHByZXNldElkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Fzc2V0IERCIGFjY2VwdGVkIHNhdmUtYXNzZXQtbWV0YSBidXQgdGhlIGNvbXByZXNzaW9uIHNldHRpbmdzIGRpZCBub3QgcGVyc2lzdC4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICd1cGRhdGVkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXR1czogJ2ZhaWxlZCcsIHVybDogaWRlbnRpdHksIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5sZXQgc2hhcmVkUG9saWN5OiBUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3kgfCBudWxsID0gbnVsbDtcclxubGV0IGF1dG9tYXRpb25TdGFydGVkID0gZmFsc2U7XHJcbmxldCBib290c3RyYXBUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsID0gbnVsbDtcclxuY29uc3QgYnJvYWRjYXN0TGlzdGVuZXJzOiBBcnJheTxbc3RyaW5nLCAocGF5bG9hZDogYW55KSA9PiB2b2lkXT4gPSBbXTtcclxuY29uc3QgTUFYX0JPT1RTVFJBUF9SRVRSWV9ERUxBWV9NUyA9IDMwXzAwMDtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3koKTogVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5IHtcclxuICAgIHNoYXJlZFBvbGljeSB8fD0gbmV3IFRleHR1cmVDb21wcmVzc2lvblBvbGljeSgpO1xyXG4gICAgcmV0dXJuIHNoYXJlZFBvbGljeTtcclxufVxyXG5cclxuZnVuY3Rpb24gbG9nQXV0b21hdGlvbkVycm9yKHNjb3BlOiBzdHJpbmcsIGVycm9yOiB1bmtub3duKTogdm9pZCB7XHJcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcihgW1RleHR1cmVDb21wcmVzc2lvblBvbGljeV0gJHtzY29wZX06ICR7bWVzc2FnZX1gKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2NoZWR1bGVCb290c3RyYXBTY2FuKGF0dGVtcHQgPSAwKTogdm9pZCB7XHJcbiAgICBjb25zdCBwb2xpY3kgPSBnZXRUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3koKTtcclxuICAgIC8vIFRoZSBleHRlbnNpb24gY2FuIGxvYWQgYmVmb3JlIEFzc2V0IERCIGFuZCBjYW4gYWxzbyBtaXNzIGFzc2V0LWRiOnJlYWR5IGlmXHJcbiAgICAvLyB0aGF0IGJyb2FkY2FzdCBoYXBwZW5lZCBiZWZvcmUgbGlzdGVuZXJzIHdlcmUgcmVnaXN0ZXJlZC4gS2VlcCBhIGNoZWFwLFxyXG4gICAgLy8gY2FwcGVkIHJlYWRpbmVzcyBwb2xsIGFsaXZlIGluc3RlYWQgb2YgdHVybmluZyBub3JtYWwgc3RhcnR1cCBvcmRlcmluZyBpbnRvXHJcbiAgICAvLyBhIHJlZCBjb25zb2xlIGVycm9yIGFmdGVyIGFuIGFyYml0cmFyeSByZXRyeSBjb3VudC5cclxuICAgIGNvbnN0IGRlbGF5TXMgPSBhdHRlbXB0ID09PSAwID8gNTAwIDogTWF0aC5taW4oMTAwMCAqICgyICoqIE1hdGgubWluKGF0dGVtcHQgLSAxLCA1KSksIE1BWF9CT09UU1RSQVBfUkVUUllfREVMQVlfTVMpO1xyXG4gICAgYm9vdHN0cmFwVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICBib290c3RyYXBUaW1lciA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFhdXRvbWF0aW9uU3RhcnRlZCkgcmV0dXJuO1xyXG4gICAgICAgIHZvaWQgcG9saWN5LmVuZm9yY2VBbGwoKS50aGVuKChyZXBvcnQpID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3ldIHByZXNldD0ke3JlcG9ydC5wcmVzZXQubmFtZX0gZWxpZ2libGU9JHtyZXBvcnQuZWxpZ2libGV9IHVwZGF0ZWQ9JHtyZXBvcnQudXBkYXRlZH0gdW5jaGFuZ2VkPSR7cmVwb3J0LnVuY2hhbmdlZH0gZmFpbGVkPSR7cmVwb3J0LmZhaWxlZH1gKTtcclxuICAgICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcclxuICAgICAgICAgICAgaWYgKC9hc3NldCBkYiBpcyBub3QgcmVhZHkvaS50ZXN0KG1lc3NhZ2UpICYmIGF1dG9tYXRpb25TdGFydGVkKSB7XHJcbiAgICAgICAgICAgICAgICBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oYXR0ZW1wdCArIDEpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxvZ0F1dG9tYXRpb25FcnJvcignc3RhcnR1cCBzY2FuJywgZXJyb3IpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfSwgZGVsYXlNcyk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzdGFydFRleHR1cmVDb21wcmVzc2lvbkF1dG9tYXRpb24oKTogdm9pZCB7XHJcbiAgICBpZiAoYXV0b21hdGlvblN0YXJ0ZWQpIHJldHVybjtcclxuICAgIGF1dG9tYXRpb25TdGFydGVkID0gdHJ1ZTtcclxuICAgIGNvbnN0IG1lc3NhZ2VBcGk6IGFueSA9IChFZGl0b3IgYXMgYW55KS5NZXNzYWdlO1xyXG4gICAgY29uc3QgcG9saWN5ID0gZ2V0VGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KCk7XHJcbiAgICBpZiAodHlwZW9mIG1lc3NhZ2VBcGk/LmFkZEJyb2FkY2FzdExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgY29uc3Qgb25Bc3NldCA9IChwYXlsb2FkOiBhbnkpID0+IHtcclxuICAgICAgICAgICAgdm9pZCBwb2xpY3kuZW5mb3JjZUFzc2V0KHBheWxvYWQpLnRoZW4oKHJlc3VsdCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09ICdmYWlsZWQnKSBsb2dBdXRvbWF0aW9uRXJyb3IocmVzdWx0LnVybCB8fCAnYXNzZXQgYnJvYWRjYXN0JywgcmVzdWx0LmVycm9yIHx8ICd1bmtub3duIGZhaWx1cmUnKTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiBsb2dBdXRvbWF0aW9uRXJyb3IoJ2Fzc2V0IGJyb2FkY2FzdCcsIGVycm9yKSk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBjb25zdCBvblJlYWR5ID0gKCkgPT4ge1xyXG4gICAgICAgICAgICB2b2lkIHBvbGljeS5lbmZvcmNlQWxsKCkudGhlbigocmVwb3J0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXJlcG9ydC5jb21wbGV0ZSkgbG9nQXV0b21hdGlvbkVycm9yKCdhc3NldC1kYiByZWFkeSBzY2FuJywgYCR7cmVwb3J0LmZhaWxlZH0gdGV4dHVyZShzKSBmYWlsZWRgKTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiBsb2dBdXRvbWF0aW9uRXJyb3IoJ2Fzc2V0LWRiIHJlYWR5IHNjYW4nLCBlcnJvcikpO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgZm9yIChjb25zdCBldmVudCBvZiBbJ2Fzc2V0LWRiOmFzc2V0LWFkZCcsICdhc3NldC1kYjphc3NldC1jaGFuZ2UnXSkge1xyXG4gICAgICAgICAgICBtZXNzYWdlQXBpLmFkZEJyb2FkY2FzdExpc3RlbmVyKGV2ZW50LCBvbkFzc2V0KTtcclxuICAgICAgICAgICAgYnJvYWRjYXN0TGlzdGVuZXJzLnB1c2goW2V2ZW50LCBvbkFzc2V0XSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1lc3NhZ2VBcGkuYWRkQnJvYWRjYXN0TGlzdGVuZXIoJ2Fzc2V0LWRiOnJlYWR5Jywgb25SZWFkeSk7XHJcbiAgICAgICAgYnJvYWRjYXN0TGlzdGVuZXJzLnB1c2goWydhc3NldC1kYjpyZWFkeScsIG9uUmVhZHldKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5XSBFZGl0b3IgYnJvYWRjYXN0IGxpc3RlbmVycyBhcmUgdW5hdmFpbGFibGU7IHVzZSBhc3NldEFkdmFuY2VkX2VuZm9yY2VfdGV4dHVyZV9jb21wcmVzc2lvbl9wb2xpY3kgZm9yIGV4aXN0aW5nIGFzc2V0cy4nKTtcclxuICAgIH1cclxuXHJcbiAgICBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BUZXh0dXJlQ29tcHJlc3Npb25BdXRvbWF0aW9uKCk6IHZvaWQge1xyXG4gICAgaWYgKCFhdXRvbWF0aW9uU3RhcnRlZCkgcmV0dXJuO1xyXG4gICAgYXV0b21hdGlvblN0YXJ0ZWQgPSBmYWxzZTtcclxuICAgIGlmIChib290c3RyYXBUaW1lcikge1xyXG4gICAgICAgIGNsZWFyVGltZW91dChib290c3RyYXBUaW1lcik7XHJcbiAgICAgICAgYm9vdHN0cmFwVGltZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgY29uc3QgbWVzc2FnZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2U7XHJcbiAgICBpZiAodHlwZW9mIG1lc3NhZ2VBcGk/LnJlbW92ZUJyb2FkY2FzdExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBbZXZlbnQsIGxpc3RlbmVyXSBvZiBicm9hZGNhc3RMaXN0ZW5lcnMpIG1lc3NhZ2VBcGkucmVtb3ZlQnJvYWRjYXN0TGlzdGVuZXIoZXZlbnQsIGxpc3RlbmVyKTtcclxuICAgIH1cclxuICAgIGJyb2FkY2FzdExpc3RlbmVycy5sZW5ndGggPSAwO1xyXG59XHJcbiJdfQ==