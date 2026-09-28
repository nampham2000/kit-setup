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
exports.ModelImportPolicy = exports.MORPH_FBX_IMPORT_SETTINGS = exports.PLAYABLE_FBX_IMPORT_SETTINGS = void 0;
exports.isFbxModelUrl = isFbxModelUrl;
exports.modelHasMorphTargets = modelHasMorphTargets;
exports.hasPlayableFbxImportSettings = hasPlayableFbxImportSettings;
exports.applyPlayableFbxImportSettings = applyPlayableFbxImportSettings;
exports.getModelImportPolicy = getModelImportPolicy;
exports.startModelImportAutomation = startModelImportAutomation;
exports.stopModelImportAutomation = stopModelImportAutomation;
const fs = __importStar(require("fs"));
const DEFAULT_DIRECTORY = 'db://assets';
const FBX_EXTENSION = /\.fbx$/i;
const MAX_MODELS_PER_SCAN = 10000;
// Keep source topology by default: reducing a two-triangle backdrop to 80% can remove half the image.
exports.PLAYABLE_FBX_IMPORT_SETTINGS = Object.freeze({
    meshOptimize: Object.freeze({ enable: true, vertexCache: true, vertexFetch: true, overdraw: true }),
    meshSimplify: Object.freeze({ enable: true, targetRatio: 1, autoErrorRate: false, errorRate: 1, lockBoundary: false }),
    meshCluster: Object.freeze({ enable: false, generateBounding: false }),
    meshCompress: Object.freeze({ enable: true, encode: false, compress: true, quantize: false }),
});
// Cocos 3.8.8 Mesh Compress repacks the vertex/index data but keeps the morph target displacement
// views at their uncompressed offsets: StdMorphRendering then builds Float32Arrays past the end of the
// buffer ("Invalid typed array length", KriptoFX Chal_Rig2 beard blend shape) and the mesh fails to
// load. A model with morph targets keeps every setting except Mesh Compress, which stays off.
exports.MORPH_FBX_IMPORT_SETTINGS = Object.freeze(Object.assign(Object.assign({}, exports.PLAYABLE_FBX_IMPORT_SETTINGS), { meshCompress: Object.freeze({ enable: false, encode: false, compress: false, quantize: false }) }));
function deepClone(value) {
    return JSON.parse(JSON.stringify(value !== null && value !== void 0 ? value : {}));
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
function isFbxModelUrl(value) {
    return FBX_EXTENSION.test(String(value || '').split(/[?#]/, 1)[0]);
}
function structHasMorph(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8)
        return false;
    if (Array.isArray(value.vertexBundles) && 'morph' in value)
        return !!value.morph;
    return Object.values(value).some((child) => structHasMorph(child, depth + 1));
}
/** True when an imported mesh sub-asset of the model carries morph targets (read from its library JSON). */
function modelHasMorphTargets(info) {
    var _a;
    for (const sub of Object.values((info === null || info === void 0 ? void 0 : info.subAssets) || {})) {
        if ((sub === null || sub === void 0 ? void 0 : sub.type) !== 'cc.Mesh')
            continue;
        const file = (_a = sub === null || sub === void 0 ? void 0 : sub.library) === null || _a === void 0 ? void 0 : _a['.json'];
        if (!file || !fs.existsSync(file))
            continue;
        try {
            if (structHasMorph(JSON.parse(fs.readFileSync(file, 'utf8'))))
                return true;
        }
        catch ( /* a mesh being re-imported is checked again on its asset-change broadcast */_b) { /* a mesh being re-imported is checked again on its asset-change broadcast */ }
    }
    return false;
}
function hasPlayableFbxImportSettings(meta, morph = false) {
    var _a;
    const data = (meta === null || meta === void 0 ? void 0 : meta.userData) || {};
    const expected = morph ? exports.MORPH_FBX_IMPORT_SETTINGS : exports.PLAYABLE_FBX_IMPORT_SETTINGS;
    for (const section of Object.keys(expected)) {
        for (const [key, value] of Object.entries(expected[section])) {
            if (((_a = data === null || data === void 0 ? void 0 : data[section]) === null || _a === void 0 ? void 0 : _a[key]) !== value)
                return false;
        }
    }
    return true;
}
function applyPlayableFbxImportSettings(meta, morph = false) {
    const next = deepClone(meta);
    next.userData || (next.userData = {});
    for (const [section, settings] of Object.entries(morph ? exports.MORPH_FBX_IMPORT_SETTINGS : exports.PLAYABLE_FBX_IMPORT_SETTINGS)) {
        next.userData[section] = Object.assign(Object.assign({}, (next.userData[section] || {})), settings);
    }
    return next;
}
class ModelImportPolicy {
    constructor() {
        this.fullScan = null;
        this.assetInFlight = new Set();
    }
    async enforceAll(options = {}) {
        if (this.fullScan)
            return this.fullScan;
        this.fullScan = this.enforceAllInternal(options).finally(() => { this.fullScan = null; });
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
            return await this.applyAsset(identity, Boolean(options.dryRun));
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
            throw new Error('Cocos Asset DB is not ready; FBX model import policy was not applied.');
        const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
        if (!Array.isArray(assets))
            throw new Error('Cocos Asset DB returned an invalid model inventory.');
        if (assets.length > MAX_MODELS_PER_SCAN)
            throw new Error(`FBX policy scan exceeded the ${MAX_MODELS_PER_SCAN} asset safety budget.`);
        const report = {
            complete: false,
            dryRun,
            directory,
            settings: exports.PLAYABLE_FBX_IMPORT_SETTINGS,
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
            if (!isFbxModelUrl(url)) {
                report.skipped += 1;
                continue;
            }
            report.eligible += 1;
            const result = await this.applyAsset((asset === null || asset === void 0 ? void 0 : asset.uuid) || url, dryRun);
            if (result.status === 'updated')
                report.updated += 1;
            else if (result.status === 'unchanged')
                report.unchanged += 1;
            else if (result.status === 'skipped')
                report.skipped += 1;
            else {
                report.failed += 1;
                if (report.failures.length < 32)
                    report.failures.push({ url: result.url || url, error: result.error || 'Unknown Asset DB failure' });
            }
        }
        report.complete = report.failed === 0 && report.eligible === report.updated + report.unchanged;
        return report;
    }
    async applyAsset(identity, dryRun) {
        try {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', identity);
            const url = String((info === null || info === void 0 ? void 0 : info.url) || (info === null || info === void 0 ? void 0 : info.path) || (info === null || info === void 0 ? void 0 : info.source) || identity);
            if (!info || info.isDirectory || !isFbxModelUrl(url))
                return { status: 'skipped', url };
            const meta = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!meta || meta.importer !== 'fbx') {
                return { status: 'failed', url, uuid: info.uuid, error: 'Asset has .fbx extension but Cocos did not return FBX importer metadata.' };
            }
            const morph = modelHasMorphTargets(info);
            if (hasPlayableFbxImportSettings(meta, morph))
                return { status: 'unchanged', url, uuid: info.uuid };
            if (dryRun)
                return { status: 'updated', url, uuid: info.uuid };
            const next = applyPlayableFbxImportSettings(meta, morph);
            await Editor.Message.request('asset-db', 'save-asset-meta', info.uuid || identity, JSON.stringify(next, null, 2));
            const verified = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!hasPlayableFbxImportSettings(verified, morph))
                throw new Error('Asset DB accepted save-asset-meta but the FBX settings did not persist.');
            return { status: 'updated', url, uuid: info.uuid };
        }
        catch (error) {
            return { status: 'failed', url: identity, error: (error === null || error === void 0 ? void 0 : error.message) || String(error) };
        }
    }
}
exports.ModelImportPolicy = ModelImportPolicy;
let sharedPolicy = null;
let automationStarted = false;
let bootstrapTimer = null;
const broadcastListeners = [];
const MAX_BOOTSTRAP_RETRY_DELAY_MS = 30000;
function getModelImportPolicy() {
    sharedPolicy || (sharedPolicy = new ModelImportPolicy());
    return sharedPolicy;
}
function logAutomationError(scope, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ModelImportPolicy] ${scope}: ${message}`);
}
function scheduleBootstrapScan(attempt = 0) {
    const policy = getModelImportPolicy();
    // Asset DB readiness is independent from extension load order, and its ready
    // broadcast may already have fired. Poll with capped backoff so that a normal
    // delayed startup remains pending rather than becoming a false console error.
    const delayMs = attempt === 0 ? 700 : Math.min(1000 * (2 ** Math.min(attempt - 1, 5)), MAX_BOOTSTRAP_RETRY_DELAY_MS);
    bootstrapTimer = setTimeout(() => {
        bootstrapTimer = null;
        if (!automationStarted)
            return;
        void policy.enforceAll().then((report) => {
            console.log(`[ModelImportPolicy] eligible=${report.eligible} updated=${report.updated} unchanged=${report.unchanged} failed=${report.failed}`);
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
function startModelImportAutomation() {
    if (automationStarted)
        return;
    automationStarted = true;
    const messageApi = Editor.Message;
    const policy = getModelImportPolicy();
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
                    logAutomationError('asset-db ready scan', `${report.failed} FBX model(s) failed`);
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
        console.warn('[ModelImportPolicy] Editor broadcast listeners are unavailable; run npm run ai:model:optimize for existing FBX assets.');
    }
    scheduleBootstrapScan();
}
function stopModelImportAutomation() {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwtaW1wb3J0LXBvbGljeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tb2RlbC1pbXBvcnQtcG9saWN5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQXlEQSxzQ0FFQztBQVNELG9EQVVDO0FBRUQsb0VBU0M7QUFFRCx3RUFPQztBQWdHRCxvREFHQztBQTZCRCxnRUEwQkM7QUFFRCw4REFZQztBQTFRRCx1Q0FBeUI7QUFFekIsTUFBTSxpQkFBaUIsR0FBRyxhQUFhLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUcsU0FBUyxDQUFDO0FBQ2hDLE1BQU0sbUJBQW1CLEdBQUcsS0FBTSxDQUFDO0FBRW5DLHNHQUFzRztBQUN6RixRQUFBLDRCQUE0QixHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7SUFDdEQsWUFBWSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDbkcsWUFBWSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsQ0FBQztJQUN0SCxXQUFXLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLENBQUM7SUFDdEUsWUFBWSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLENBQUM7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QUM7SUFDRCxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcblxyXG5jb25zdCBERUZBVUxUX0RJUkVDVE9SWSA9ICdkYjovL2Fzc2V0cyc7XHJcbmNvbnN0IEZCWF9FWFRFTlNJT04gPSAvXFwuZmJ4JC9pO1xyXG5jb25zdCBNQVhfTU9ERUxTX1BFUl9TQ0FOID0gMTBfMDAwO1xyXG5cclxuLy8gS2VlcCBzb3VyY2UgdG9wb2xvZ3kgYnkgZGVmYXVsdDogcmVkdWNpbmcgYSB0d28tdHJpYW5nbGUgYmFja2Ryb3AgdG8gODAlIGNhbiByZW1vdmUgaGFsZiB0aGUgaW1hZ2UuXHJcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9GQlhfSU1QT1JUX1NFVFRJTkdTID0gT2JqZWN0LmZyZWV6ZSh7XHJcbiAgICBtZXNoT3B0aW1pemU6IE9iamVjdC5mcmVlemUoeyBlbmFibGU6IHRydWUsIHZlcnRleENhY2hlOiB0cnVlLCB2ZXJ0ZXhGZXRjaDogdHJ1ZSwgb3ZlcmRyYXc6IHRydWUgfSksXHJcbiAgICBtZXNoU2ltcGxpZnk6IE9iamVjdC5mcmVlemUoeyBlbmFibGU6IHRydWUsIHRhcmdldFJhdGlvOiAxLCBhdXRvRXJyb3JSYXRlOiBmYWxzZSwgZXJyb3JSYXRlOiAxLCBsb2NrQm91bmRhcnk6IGZhbHNlIH0pLFxyXG4gICAgbWVzaENsdXN0ZXI6IE9iamVjdC5mcmVlemUoeyBlbmFibGU6IGZhbHNlLCBnZW5lcmF0ZUJvdW5kaW5nOiBmYWxzZSB9KSxcclxuICAgIG1lc2hDb21wcmVzczogT2JqZWN0LmZyZWV6ZSh7IGVuYWJsZTogdHJ1ZSwgZW5jb2RlOiBmYWxzZSwgY29tcHJlc3M6IHRydWUsIHF1YW50aXplOiBmYWxzZSB9KSxcclxufSk7XHJcblxyXG4vLyBDb2NvcyAzLjguOCBNZXNoIENvbXByZXNzIHJlcGFja3MgdGhlIHZlcnRleC9pbmRleCBkYXRhIGJ1dCBrZWVwcyB0aGUgbW9ycGggdGFyZ2V0IGRpc3BsYWNlbWVudFxyXG4vLyB2aWV3cyBhdCB0aGVpciB1bmNvbXByZXNzZWQgb2Zmc2V0czogU3RkTW9ycGhSZW5kZXJpbmcgdGhlbiBidWlsZHMgRmxvYXQzMkFycmF5cyBwYXN0IHRoZSBlbmQgb2YgdGhlXHJcbi8vIGJ1ZmZlciAoXCJJbnZhbGlkIHR5cGVkIGFycmF5IGxlbmd0aFwiLCBLcmlwdG9GWCBDaGFsX1JpZzIgYmVhcmQgYmxlbmQgc2hhcGUpIGFuZCB0aGUgbWVzaCBmYWlscyB0b1xyXG4vLyBsb2FkLiBBIG1vZGVsIHdpdGggbW9ycGggdGFyZ2V0cyBrZWVwcyBldmVyeSBzZXR0aW5nIGV4Y2VwdCBNZXNoIENvbXByZXNzLCB3aGljaCBzdGF5cyBvZmYuXHJcbmV4cG9ydCBjb25zdCBNT1JQSF9GQlhfSU1QT1JUX1NFVFRJTkdTID0gT2JqZWN0LmZyZWV6ZSh7XHJcbiAgICAuLi5QTEFZQUJMRV9GQlhfSU1QT1JUX1NFVFRJTkdTLFxyXG4gICAgbWVzaENvbXByZXNzOiBPYmplY3QuZnJlZXplKHsgZW5hYmxlOiBmYWxzZSwgZW5jb2RlOiBmYWxzZSwgY29tcHJlc3M6IGZhbHNlLCBxdWFudGl6ZTogZmFsc2UgfSksXHJcbn0pO1xyXG5cclxudHlwZSBNb2RlbFBvbGljeU9wdGlvbnMgPSB7IGRpcmVjdG9yeT86IHN0cmluZzsgZHJ5UnVuPzogYm9vbGVhbiB9O1xyXG50eXBlIE1vZGVsQXBwbHlSZXN1bHQgPSB7IHN0YXR1czogJ3VwZGF0ZWQnIHwgJ3VuY2hhbmdlZCcgfCAnc2tpcHBlZCcgfCAnZmFpbGVkJzsgdXJsOiBzdHJpbmc7IHV1aWQ/OiBzdHJpbmc7IGVycm9yPzogc3RyaW5nIH07XHJcblxyXG5leHBvcnQgdHlwZSBNb2RlbFBvbGljeVJlcG9ydCA9IHtcclxuICAgIGNvbXBsZXRlOiBib29sZWFuO1xyXG4gICAgZHJ5UnVuOiBib29sZWFuO1xyXG4gICAgZGlyZWN0b3J5OiBzdHJpbmc7XHJcbiAgICBzZXR0aW5nczogdHlwZW9mIFBMQVlBQkxFX0ZCWF9JTVBPUlRfU0VUVElOR1M7XHJcbiAgICBzY2FubmVkOiBudW1iZXI7XHJcbiAgICBlbGlnaWJsZTogbnVtYmVyO1xyXG4gICAgdXBkYXRlZDogbnVtYmVyO1xyXG4gICAgdW5jaGFuZ2VkOiBudW1iZXI7XHJcbiAgICBza2lwcGVkOiBudW1iZXI7XHJcbiAgICBmYWlsZWQ6IG51bWJlcjtcclxuICAgIGZhaWx1cmVzOiBBcnJheTx7IHVybDogc3RyaW5nOyBlcnJvcjogc3RyaW5nIH0+O1xyXG59O1xyXG5cclxuZnVuY3Rpb24gZGVlcENsb25lPFQ+KHZhbHVlOiBUKTogVCB7XHJcbiAgICByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh2YWx1ZSA/PyB7fSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhc3NldElkZW50aXR5KHBheWxvYWQ6IGFueSk6IHN0cmluZyB8IG51bGwge1xyXG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkID09PSAnc3RyaW5nJykgcmV0dXJuIHBheWxvYWQ7XHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXlsb2FkKSkge1xyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBwYXlsb2FkKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkZW50aXR5ID0gYXNzZXRJZGVudGl0eShpdGVtKTtcclxuICAgICAgICAgICAgaWYgKGlkZW50aXR5KSByZXR1cm4gaWRlbnRpdHk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gcGF5bG9hZC51dWlkIHx8IHBheWxvYWQudXJsIHx8IHBheWxvYWQucGF0aCB8fCBwYXlsb2FkLnNvdXJjZSB8fCBudWxsO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaXNGYnhNb2RlbFVybCh2YWx1ZTogdW5rbm93bik6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIEZCWF9FWFRFTlNJT04udGVzdChTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KC9bPyNdLywgMSlbMF0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzdHJ1Y3RIYXNNb3JwaCh2YWx1ZTogYW55LCBkZXB0aCA9IDApOiBib29sZWFuIHtcclxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyB8fCBkZXB0aCA+IDgpIHJldHVybiBmYWxzZTtcclxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlLnZlcnRleEJ1bmRsZXMpICYmICdtb3JwaCcgaW4gdmFsdWUpIHJldHVybiAhIXZhbHVlLm1vcnBoO1xyXG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModmFsdWUpLnNvbWUoKGNoaWxkKSA9PiBzdHJ1Y3RIYXNNb3JwaChjaGlsZCwgZGVwdGggKyAxKSk7XHJcbn1cclxuXHJcbi8qKiBUcnVlIHdoZW4gYW4gaW1wb3J0ZWQgbWVzaCBzdWItYXNzZXQgb2YgdGhlIG1vZGVsIGNhcnJpZXMgbW9ycGggdGFyZ2V0cyAocmVhZCBmcm9tIGl0cyBsaWJyYXJ5IEpTT04pLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gbW9kZWxIYXNNb3JwaFRhcmdldHMoaW5mbzogYW55KTogYm9vbGVhbiB7XHJcbiAgICBmb3IgKGNvbnN0IHN1YiBvZiBPYmplY3QudmFsdWVzPGFueT4oaW5mbz8uc3ViQXNzZXRzIHx8IHt9KSkge1xyXG4gICAgICAgIGlmIChzdWI/LnR5cGUgIT09ICdjYy5NZXNoJykgY29udGludWU7XHJcbiAgICAgICAgY29uc3QgZmlsZSA9IHN1Yj8ubGlicmFyeT8uWycuanNvbiddO1xyXG4gICAgICAgIGlmICghZmlsZSB8fCAhZnMuZXhpc3RzU3luYyhmaWxlKSkgY29udGludWU7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKHN0cnVjdEhhc01vcnBoKEpTT04ucGFyc2UoZnMucmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpKSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfSBjYXRjaCB7IC8qIGEgbWVzaCBiZWluZyByZS1pbXBvcnRlZCBpcyBjaGVja2VkIGFnYWluIG9uIGl0cyBhc3NldC1jaGFuZ2UgYnJvYWRjYXN0ICovIH1cclxuICAgIH1cclxuICAgIHJldHVybiBmYWxzZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGhhc1BsYXlhYmxlRmJ4SW1wb3J0U2V0dGluZ3MobWV0YTogYW55LCBtb3JwaCA9IGZhbHNlKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBkYXRhID0gbWV0YT8udXNlckRhdGEgfHwge307XHJcbiAgICBjb25zdCBleHBlY3RlZDogYW55ID0gbW9ycGggPyBNT1JQSF9GQlhfSU1QT1JUX1NFVFRJTkdTIDogUExBWUFCTEVfRkJYX0lNUE9SVF9TRVRUSU5HUztcclxuICAgIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBPYmplY3Qua2V5cyhleHBlY3RlZCkpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhleHBlY3RlZFtzZWN0aW9uXSkpIHtcclxuICAgICAgICAgICAgaWYgKGRhdGE/LltzZWN0aW9uXT8uW2tleV0gIT09IHZhbHVlKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBhcHBseVBsYXlhYmxlRmJ4SW1wb3J0U2V0dGluZ3MobWV0YTogYW55LCBtb3JwaCA9IGZhbHNlKTogYW55IHtcclxuICAgIGNvbnN0IG5leHQgPSBkZWVwQ2xvbmUobWV0YSk7XHJcbiAgICBuZXh0LnVzZXJEYXRhIHx8PSB7fTtcclxuICAgIGZvciAoY29uc3QgW3NlY3Rpb24sIHNldHRpbmdzXSBvZiBPYmplY3QuZW50cmllczxhbnk+KG1vcnBoID8gTU9SUEhfRkJYX0lNUE9SVF9TRVRUSU5HUyA6IFBMQVlBQkxFX0ZCWF9JTVBPUlRfU0VUVElOR1MpKSB7XHJcbiAgICAgICAgbmV4dC51c2VyRGF0YVtzZWN0aW9uXSA9IHsgLi4uKG5leHQudXNlckRhdGFbc2VjdGlvbl0gfHwge30pLCAuLi5zZXR0aW5ncyB9O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5leHQ7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBNb2RlbEltcG9ydFBvbGljeSB7XHJcbiAgICBwcml2YXRlIGZ1bGxTY2FuOiBQcm9taXNlPE1vZGVsUG9saWN5UmVwb3J0PiB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSByZWFkb25seSBhc3NldEluRmxpZ2h0ID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcblxyXG4gICAgYXN5bmMgZW5mb3JjZUFsbChvcHRpb25zOiBNb2RlbFBvbGljeU9wdGlvbnMgPSB7fSk6IFByb21pc2U8TW9kZWxQb2xpY3lSZXBvcnQ+IHtcclxuICAgICAgICBpZiAodGhpcy5mdWxsU2NhbikgcmV0dXJuIHRoaXMuZnVsbFNjYW47XHJcbiAgICAgICAgdGhpcy5mdWxsU2NhbiA9IHRoaXMuZW5mb3JjZUFsbEludGVybmFsKG9wdGlvbnMpLmZpbmFsbHkoKCkgPT4geyB0aGlzLmZ1bGxTY2FuID0gbnVsbDsgfSk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZnVsbFNjYW47XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZW5mb3JjZUFzc2V0KHBheWxvYWQ6IGFueSwgb3B0aW9uczogTW9kZWxQb2xpY3lPcHRpb25zID0ge30pOiBQcm9taXNlPE1vZGVsQXBwbHlSZXN1bHQ+IHtcclxuICAgICAgICBjb25zdCBpZGVudGl0eSA9IGFzc2V0SWRlbnRpdHkocGF5bG9hZCk7XHJcbiAgICAgICAgaWYgKCFpZGVudGl0eSkgcmV0dXJuIHsgc3RhdHVzOiAnc2tpcHBlZCcsIHVybDogJycsIGVycm9yOiAnQXNzZXQgYnJvYWRjYXN0IGRpZCBub3QgaW5jbHVkZSBhIFVVSUQgb3IgVVJMLicgfTtcclxuICAgICAgICBpZiAodGhpcy5hc3NldEluRmxpZ2h0LmhhcyhpZGVudGl0eSkpIHJldHVybiB7IHN0YXR1czogJ3VuY2hhbmdlZCcsIHVybDogaWRlbnRpdHkgfTtcclxuICAgICAgICB0aGlzLmFzc2V0SW5GbGlnaHQuYWRkKGlkZW50aXR5KTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5hcHBseUFzc2V0KGlkZW50aXR5LCBCb29sZWFuKG9wdGlvbnMuZHJ5UnVuKSk7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgdGhpcy5hc3NldEluRmxpZ2h0LmRlbGV0ZShpZGVudGl0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZW5mb3JjZUFsbEludGVybmFsKG9wdGlvbnM6IE1vZGVsUG9saWN5T3B0aW9ucyk6IFByb21pc2U8TW9kZWxQb2xpY3lSZXBvcnQ+IHtcclxuICAgICAgICBjb25zdCBkaXJlY3RvcnkgPSBTdHJpbmcob3B0aW9ucy5kaXJlY3RvcnkgfHwgREVGQVVMVF9ESVJFQ1RPUlkpLnJlcGxhY2UoL1xcLyQvLCAnJyk7XHJcbiAgICAgICAgY29uc3QgZHJ5UnVuID0gQm9vbGVhbihvcHRpb25zLmRyeVJ1bik7XHJcbiAgICAgICAgY29uc3QgcmVhZHkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1yZWFkeScpO1xyXG4gICAgICAgIGlmICghcmVhZHkpIHRocm93IG5ldyBFcnJvcignQ29jb3MgQXNzZXQgREIgaXMgbm90IHJlYWR5OyBGQlggbW9kZWwgaW1wb3J0IHBvbGljeSB3YXMgbm90IGFwcGxpZWQuJyk7XHJcbiAgICAgICAgY29uc3QgYXNzZXRzOiBhbnlbXSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0cycsIHsgcGF0dGVybjogYCR7ZGlyZWN0b3J5fS8qKi8qYCB9KTtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoYXNzZXRzKSkgdGhyb3cgbmV3IEVycm9yKCdDb2NvcyBBc3NldCBEQiByZXR1cm5lZCBhbiBpbnZhbGlkIG1vZGVsIGludmVudG9yeS4nKTtcclxuICAgICAgICBpZiAoYXNzZXRzLmxlbmd0aCA+IE1BWF9NT0RFTFNfUEVSX1NDQU4pIHRocm93IG5ldyBFcnJvcihgRkJYIHBvbGljeSBzY2FuIGV4Y2VlZGVkIHRoZSAke01BWF9NT0RFTFNfUEVSX1NDQU59IGFzc2V0IHNhZmV0eSBidWRnZXQuYCk7XHJcblxyXG4gICAgICAgIGNvbnN0IHJlcG9ydDogTW9kZWxQb2xpY3lSZXBvcnQgPSB7XHJcbiAgICAgICAgICAgIGNvbXBsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgZHJ5UnVuLFxyXG4gICAgICAgICAgICBkaXJlY3RvcnksXHJcbiAgICAgICAgICAgIHNldHRpbmdzOiBQTEFZQUJMRV9GQlhfSU1QT1JUX1NFVFRJTkdTLFxyXG4gICAgICAgICAgICBzY2FubmVkOiBhc3NldHMubGVuZ3RoLFxyXG4gICAgICAgICAgICBlbGlnaWJsZTogMCxcclxuICAgICAgICAgICAgdXBkYXRlZDogMCxcclxuICAgICAgICAgICAgdW5jaGFuZ2VkOiAwLFxyXG4gICAgICAgICAgICBza2lwcGVkOiAwLFxyXG4gICAgICAgICAgICBmYWlsZWQ6IDAsXHJcbiAgICAgICAgICAgIGZhaWx1cmVzOiBbXSxcclxuICAgICAgICB9O1xyXG4gICAgICAgIGZvciAoY29uc3QgYXNzZXQgb2YgYXNzZXRzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHVybCA9IFN0cmluZyhhc3NldD8udXJsIHx8IGFzc2V0Py5wYXRoIHx8IGFzc2V0Py5zb3VyY2UgfHwgJycpO1xyXG4gICAgICAgICAgICBpZiAoIWlzRmJ4TW9kZWxVcmwodXJsKSkge1xyXG4gICAgICAgICAgICAgICAgcmVwb3J0LnNraXBwZWQgKz0gMTtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlcG9ydC5lbGlnaWJsZSArPSAxO1xyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5QXNzZXQoYXNzZXQ/LnV1aWQgfHwgdXJsLCBkcnlSdW4pO1xyXG4gICAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3VwZGF0ZWQnKSByZXBvcnQudXBkYXRlZCArPSAxO1xyXG4gICAgICAgICAgICBlbHNlIGlmIChyZXN1bHQuc3RhdHVzID09PSAndW5jaGFuZ2VkJykgcmVwb3J0LnVuY2hhbmdlZCArPSAxO1xyXG4gICAgICAgICAgICBlbHNlIGlmIChyZXN1bHQuc3RhdHVzID09PSAnc2tpcHBlZCcpIHJlcG9ydC5za2lwcGVkICs9IDE7XHJcbiAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcmVwb3J0LmZhaWxlZCArPSAxO1xyXG4gICAgICAgICAgICAgICAgaWYgKHJlcG9ydC5mYWlsdXJlcy5sZW5ndGggPCAzMikgcmVwb3J0LmZhaWx1cmVzLnB1c2goeyB1cmw6IHJlc3VsdC51cmwgfHwgdXJsLCBlcnJvcjogcmVzdWx0LmVycm9yIHx8ICdVbmtub3duIEFzc2V0IERCIGZhaWx1cmUnIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJlcG9ydC5jb21wbGV0ZSA9IHJlcG9ydC5mYWlsZWQgPT09IDAgJiYgcmVwb3J0LmVsaWdpYmxlID09PSByZXBvcnQudXBkYXRlZCArIHJlcG9ydC51bmNoYW5nZWQ7XHJcbiAgICAgICAgcmV0dXJuIHJlcG9ydDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGFwcGx5QXNzZXQoaWRlbnRpdHk6IHN0cmluZywgZHJ5UnVuOiBib29sZWFuKTogUHJvbWlzZTxNb2RlbEFwcGx5UmVzdWx0PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaW5mbzogYW55ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIGlkZW50aXR5KTtcclxuICAgICAgICAgICAgY29uc3QgdXJsID0gU3RyaW5nKGluZm8/LnVybCB8fCBpbmZvPy5wYXRoIHx8IGluZm8/LnNvdXJjZSB8fCBpZGVudGl0eSk7XHJcbiAgICAgICAgICAgIGlmICghaW5mbyB8fCBpbmZvLmlzRGlyZWN0b3J5IHx8ICFpc0ZieE1vZGVsVXJsKHVybCkpIHJldHVybiB7IHN0YXR1czogJ3NraXBwZWQnLCB1cmwgfTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YTogYW55ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtbWV0YScsIGluZm8udXVpZCB8fCBpZGVudGl0eSk7XHJcbiAgICAgICAgICAgIGlmICghbWV0YSB8fCBtZXRhLmltcG9ydGVyICE9PSAnZmJ4Jykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnZmFpbGVkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQsIGVycm9yOiAnQXNzZXQgaGFzIC5mYnggZXh0ZW5zaW9uIGJ1dCBDb2NvcyBkaWQgbm90IHJldHVybiBGQlggaW1wb3J0ZXIgbWV0YWRhdGEuJyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IG1vcnBoID0gbW9kZWxIYXNNb3JwaFRhcmdldHMoaW5mbyk7XHJcbiAgICAgICAgICAgIGlmIChoYXNQbGF5YWJsZUZieEltcG9ydFNldHRpbmdzKG1ldGEsIG1vcnBoKSkgcmV0dXJuIHsgc3RhdHVzOiAndW5jaGFuZ2VkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQgfTtcclxuICAgICAgICAgICAgaWYgKGRyeVJ1bikgcmV0dXJuIHsgc3RhdHVzOiAndXBkYXRlZCcsIHVybCwgdXVpZDogaW5mby51dWlkIH07XHJcblxyXG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gYXBwbHlQbGF5YWJsZUZieEltcG9ydFNldHRpbmdzKG1ldGEsIG1vcnBoKTtcclxuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldC1tZXRhJywgaW5mby51dWlkIHx8IGlkZW50aXR5LCBKU09OLnN0cmluZ2lmeShuZXh0LCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHZlcmlmaWVkOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1tZXRhJywgaW5mby51dWlkIHx8IGlkZW50aXR5KTtcclxuICAgICAgICAgICAgaWYgKCFoYXNQbGF5YWJsZUZieEltcG9ydFNldHRpbmdzKHZlcmlmaWVkLCBtb3JwaCkpIHRocm93IG5ldyBFcnJvcignQXNzZXQgREIgYWNjZXB0ZWQgc2F2ZS1hc3NldC1tZXRhIGJ1dCB0aGUgRkJYIHNldHRpbmdzIGRpZCBub3QgcGVyc2lzdC4nKTtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndXBkYXRlZCcsIHVybCwgdXVpZDogaW5mby51dWlkIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdmYWlsZWQnLCB1cmw6IGlkZW50aXR5LCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxubGV0IHNoYXJlZFBvbGljeTogTW9kZWxJbXBvcnRQb2xpY3kgfCBudWxsID0gbnVsbDtcclxubGV0IGF1dG9tYXRpb25TdGFydGVkID0gZmFsc2U7XHJcbmxldCBib290c3RyYXBUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsID0gbnVsbDtcclxuY29uc3QgYnJvYWRjYXN0TGlzdGVuZXJzOiBBcnJheTxbc3RyaW5nLCAocGF5bG9hZDogYW55KSA9PiB2b2lkXT4gPSBbXTtcclxuY29uc3QgTUFYX0JPT1RTVFJBUF9SRVRSWV9ERUxBWV9NUyA9IDMwXzAwMDtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRNb2RlbEltcG9ydFBvbGljeSgpOiBNb2RlbEltcG9ydFBvbGljeSB7XHJcbiAgICBzaGFyZWRQb2xpY3kgfHw9IG5ldyBNb2RlbEltcG9ydFBvbGljeSgpO1xyXG4gICAgcmV0dXJuIHNoYXJlZFBvbGljeTtcclxufVxyXG5cclxuZnVuY3Rpb24gbG9nQXV0b21hdGlvbkVycm9yKHNjb3BlOiBzdHJpbmcsIGVycm9yOiB1bmtub3duKTogdm9pZCB7XHJcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcihgW01vZGVsSW1wb3J0UG9saWN5XSAke3Njb3BlfTogJHttZXNzYWdlfWApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oYXR0ZW1wdCA9IDApOiB2b2lkIHtcclxuICAgIGNvbnN0IHBvbGljeSA9IGdldE1vZGVsSW1wb3J0UG9saWN5KCk7XHJcbiAgICAvLyBBc3NldCBEQiByZWFkaW5lc3MgaXMgaW5kZXBlbmRlbnQgZnJvbSBleHRlbnNpb24gbG9hZCBvcmRlciwgYW5kIGl0cyByZWFkeVxyXG4gICAgLy8gYnJvYWRjYXN0IG1heSBhbHJlYWR5IGhhdmUgZmlyZWQuIFBvbGwgd2l0aCBjYXBwZWQgYmFja29mZiBzbyB0aGF0IGEgbm9ybWFsXHJcbiAgICAvLyBkZWxheWVkIHN0YXJ0dXAgcmVtYWlucyBwZW5kaW5nIHJhdGhlciB0aGFuIGJlY29taW5nIGEgZmFsc2UgY29uc29sZSBlcnJvci5cclxuICAgIGNvbnN0IGRlbGF5TXMgPSBhdHRlbXB0ID09PSAwID8gNzAwIDogTWF0aC5taW4oMTAwMCAqICgyICoqIE1hdGgubWluKGF0dGVtcHQgLSAxLCA1KSksIE1BWF9CT09UU1RSQVBfUkVUUllfREVMQVlfTVMpO1xyXG4gICAgYm9vdHN0cmFwVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICBib290c3RyYXBUaW1lciA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFhdXRvbWF0aW9uU3RhcnRlZCkgcmV0dXJuO1xyXG4gICAgICAgIHZvaWQgcG9saWN5LmVuZm9yY2VBbGwoKS50aGVuKChyZXBvcnQpID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNb2RlbEltcG9ydFBvbGljeV0gZWxpZ2libGU9JHtyZXBvcnQuZWxpZ2libGV9IHVwZGF0ZWQ9JHtyZXBvcnQudXBkYXRlZH0gdW5jaGFuZ2VkPSR7cmVwb3J0LnVuY2hhbmdlZH0gZmFpbGVkPSR7cmVwb3J0LmZhaWxlZH1gKTtcclxuICAgICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcclxuICAgICAgICAgICAgaWYgKC9hc3NldCBkYiBpcyBub3QgcmVhZHkvaS50ZXN0KG1lc3NhZ2UpICYmIGF1dG9tYXRpb25TdGFydGVkKSB7XHJcbiAgICAgICAgICAgICAgICBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oYXR0ZW1wdCArIDEpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxvZ0F1dG9tYXRpb25FcnJvcignc3RhcnR1cCBzY2FuJywgZXJyb3IpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfSwgZGVsYXlNcyk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzdGFydE1vZGVsSW1wb3J0QXV0b21hdGlvbigpOiB2b2lkIHtcclxuICAgIGlmIChhdXRvbWF0aW9uU3RhcnRlZCkgcmV0dXJuO1xyXG4gICAgYXV0b21hdGlvblN0YXJ0ZWQgPSB0cnVlO1xyXG4gICAgY29uc3QgbWVzc2FnZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2U7XHJcbiAgICBjb25zdCBwb2xpY3kgPSBnZXRNb2RlbEltcG9ydFBvbGljeSgpO1xyXG4gICAgaWYgKHR5cGVvZiBtZXNzYWdlQXBpPy5hZGRCcm9hZGNhc3RMaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIGNvbnN0IG9uQXNzZXQgPSAocGF5bG9hZDogYW55KSA9PiB7XHJcbiAgICAgICAgICAgIHZvaWQgcG9saWN5LmVuZm9yY2VBc3NldChwYXlsb2FkKS50aGVuKChyZXN1bHQpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZmFpbGVkJykgbG9nQXV0b21hdGlvbkVycm9yKHJlc3VsdC51cmwgfHwgJ2Fzc2V0IGJyb2FkY2FzdCcsIHJlc3VsdC5lcnJvciB8fCAndW5rbm93biBmYWlsdXJlJyk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4gbG9nQXV0b21hdGlvbkVycm9yKCdhc3NldCBicm9hZGNhc3QnLCBlcnJvcikpO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29uc3Qgb25SZWFkeSA9ICgpID0+IHtcclxuICAgICAgICAgICAgdm9pZCBwb2xpY3kuZW5mb3JjZUFsbCgpLnRoZW4oKHJlcG9ydCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFyZXBvcnQuY29tcGxldGUpIGxvZ0F1dG9tYXRpb25FcnJvcignYXNzZXQtZGIgcmVhZHkgc2NhbicsIGAke3JlcG9ydC5mYWlsZWR9IEZCWCBtb2RlbChzKSBmYWlsZWRgKTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiBsb2dBdXRvbWF0aW9uRXJyb3IoJ2Fzc2V0LWRiIHJlYWR5IHNjYW4nLCBlcnJvcikpO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgZm9yIChjb25zdCBldmVudCBvZiBbJ2Fzc2V0LWRiOmFzc2V0LWFkZCcsICdhc3NldC1kYjphc3NldC1jaGFuZ2UnXSkge1xyXG4gICAgICAgICAgICBtZXNzYWdlQXBpLmFkZEJyb2FkY2FzdExpc3RlbmVyKGV2ZW50LCBvbkFzc2V0KTtcclxuICAgICAgICAgICAgYnJvYWRjYXN0TGlzdGVuZXJzLnB1c2goW2V2ZW50LCBvbkFzc2V0XSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1lc3NhZ2VBcGkuYWRkQnJvYWRjYXN0TGlzdGVuZXIoJ2Fzc2V0LWRiOnJlYWR5Jywgb25SZWFkeSk7XHJcbiAgICAgICAgYnJvYWRjYXN0TGlzdGVuZXJzLnB1c2goWydhc3NldC1kYjpyZWFkeScsIG9uUmVhZHldKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbTW9kZWxJbXBvcnRQb2xpY3ldIEVkaXRvciBicm9hZGNhc3QgbGlzdGVuZXJzIGFyZSB1bmF2YWlsYWJsZTsgcnVuIG5wbSBydW4gYWk6bW9kZWw6b3B0aW1pemUgZm9yIGV4aXN0aW5nIEZCWCBhc3NldHMuJyk7XHJcbiAgICB9XHJcbiAgICBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BNb2RlbEltcG9ydEF1dG9tYXRpb24oKTogdm9pZCB7XHJcbiAgICBpZiAoIWF1dG9tYXRpb25TdGFydGVkKSByZXR1cm47XHJcbiAgICBhdXRvbWF0aW9uU3RhcnRlZCA9IGZhbHNlO1xyXG4gICAgaWYgKGJvb3RzdHJhcFRpbWVyKSB7XHJcbiAgICAgICAgY2xlYXJUaW1lb3V0KGJvb3RzdHJhcFRpbWVyKTtcclxuICAgICAgICBib290c3RyYXBUaW1lciA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXNzYWdlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZTtcclxuICAgIGlmICh0eXBlb2YgbWVzc2FnZUFwaT8ucmVtb3ZlQnJvYWRjYXN0TGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IFtldmVudCwgbGlzdGVuZXJdIG9mIGJyb2FkY2FzdExpc3RlbmVycykgbWVzc2FnZUFwaS5yZW1vdmVCcm9hZGNhc3RMaXN0ZW5lcihldmVudCwgbGlzdGVuZXIpO1xyXG4gICAgfVxyXG4gICAgYnJvYWRjYXN0TGlzdGVuZXJzLmxlbmd0aCA9IDA7XHJcbn1cclxuIl19