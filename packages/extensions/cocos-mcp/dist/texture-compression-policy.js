"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextureCompressionPolicy = exports.PLAYABLE_TRANSPARENT_WEBP_QUALITY = exports.PLAYABLE_TRANSPARENT_PRESET_NAME = exports.PLAYABLE_TRANSPARENT_PRESET_ID = void 0;
exports.isPlayableTextureUrl = isPlayableTextureUrl;
exports.normalizeWebpQuality = normalizeWebpQuality;
exports.getTextureCompressionPolicy = getTextureCompressionPolicy;
exports.startTextureCompressionAutomation = startTextureCompressionAutomation;
exports.stopTextureCompressionAutomation = stopTextureCompressionAutomation;
const DEFAULT_DIRECTORY = 'db://assets';
exports.PLAYABLE_TRANSPARENT_PRESET_ID = '1fYG0h7MJDcp+zA2cMcUsR';
exports.PLAYABLE_TRANSPARENT_PRESET_NAME = 'PlayableTransparent';
exports.PLAYABLE_TRANSPARENT_WEBP_QUALITY = 50;
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
            const preset = await this.ensurePreset(options);
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
        const preset = await this.ensurePreset(options);
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
            const result = await this.applyAsset((asset === null || asset === void 0 ? void 0 : asset.uuid) || url, preset.id, dryRun);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGV4dHVyZS1jb21wcmVzc2lvbi1wb2xpY3kuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvdGV4dHVyZS1jb21wcmVzc2lvbi1wb2xpY3kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBK0NBLG9EQUVDO0FBRUQsb0RBS0M7QUFtTkQsa0VBR0M7QUE4QkQsOEVBMkJDO0FBRUQsNEVBWUM7QUFyVkQsTUFBTSxpQkFBaUIsR0FBRyxhQUFhLENBQUM7QUFDM0IsUUFBQSw4QkFBOEIsR0FBRyx3QkFBd0IsQ0FBQztBQUMxRCxRQUFBLGdDQUFnQyxHQUFHLHFCQUFxQixDQUFDO0FBQ3pELFFBQUEsaUNBQWlDLEdBQUcsRUFBRSxDQUFDO0FBRXBELE1BQU0saUJBQWlCLEdBQUcsbUJBQW1CLENBQUM7QUFDOUMsTUFBTSxxQkFBcUIsR0FBRyxLQUFNLENBQUM7QUFxQ3JDLFNBQVMsb0JBQW9CLENBQUMsS0FBYztJQUN4QyxPQUFPLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztBQUNyRSxDQUFDO0FBRUQsU0FBZ0Isb0JBQW9CLENBQUMsS0FBYztJQUMvQyxPQUFPLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzRSxDQUFDO0FBRUQsU0FBZ0Isb0JBQW9CLENBQUMsS0FBYztJQUMvQyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDOUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO1FBQUUsT0FBTyx5Q0FBaUMsQ0FBQztJQUN4RSxNQUFNLE9BQU8sR0FBRyxPQUFPLEdBQUcsQ0FBQyxJQUFJLE9BQU8sSUFB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SUFBSSxDQUFDO0lBQzFCLENBQUM7SUFDRCxNQUFNLFVBQVUsR0FBUyxNQUFjLENBQUMsT0FBTyxDQUFDO0lBQ2hELElBQUksT0FBTyxDQUFBLFVBQVUsYUFBVixVQUFVLHVCQUFWLFVBQVUsQ0FBRSx1QkFBdUIsQ0FBQSxLQUFLLFVBQVUsRUFBRSxDQUFDO1FBQzVELEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsSUFBSSxrQkFBa0I7WUFBRSxVQUFVLENBQUMsdUJBQXVCLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQzVHLENBQUM7SUFDRCxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBERUZBVUxUX0RJUkVDVE9SWSA9ICdkYjovL2Fzc2V0cyc7XHJcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfSUQgPSAnMWZZRzBoN01KRGNwK3pBMmNNY1VzUic7XHJcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfTkFNRSA9ICdQbGF5YWJsZVRyYW5zcGFyZW50JztcclxuZXhwb3J0IGNvbnN0IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1dFQlBfUVVBTElUWSA9IDUwO1xyXG5cclxuY29uc3QgVEVYVFVSRV9FWFRFTlNJT04gPSAvXFwuKD86cG5nfGpwZT9nKSQvaTtcclxuY29uc3QgTUFYX1RFWFRVUkVTX1BFUl9TQ0FOID0gMjBfMDAwO1xyXG5cclxudHlwZSBUZXh0dXJlUG9saWN5T3B0aW9ucyA9IHtcclxuICAgIGRpcmVjdG9yeT86IHN0cmluZztcclxuICAgIHByZXNldElkPzogc3RyaW5nO1xyXG4gICAgcHJlc2V0TmFtZT86IHN0cmluZztcclxuICAgIHF1YWxpdHk/OiBudW1iZXI7XHJcbiAgICBkcnlSdW4/OiBib29sZWFuO1xyXG59O1xyXG5cclxudHlwZSBUZXh0dXJlQXBwbHlSZXN1bHQgPSB7XHJcbiAgICBzdGF0dXM6ICd1cGRhdGVkJyB8ICd1bmNoYW5nZWQnIHwgJ3NraXBwZWQnIHwgJ2ZhaWxlZCc7XHJcbiAgICB1cmw6IHN0cmluZztcclxuICAgIHV1aWQ/OiBzdHJpbmc7XHJcbiAgICBlcnJvcj86IHN0cmluZztcclxufTtcclxuXHJcbmV4cG9ydCB0eXBlIFRleHR1cmVQb2xpY3lSZXBvcnQgPSB7XHJcbiAgICBjb21wbGV0ZTogYm9vbGVhbjtcclxuICAgIGRyeVJ1bjogYm9vbGVhbjtcclxuICAgIGRpcmVjdG9yeTogc3RyaW5nO1xyXG4gICAgcHJlc2V0OiB7XHJcbiAgICAgICAgaWQ6IHN0cmluZztcclxuICAgICAgICBuYW1lOiBzdHJpbmc7XHJcbiAgICAgICAgY3JlYXRlZDogYm9vbGVhbjtcclxuICAgICAgICBjaGFuZ2VkOiBib29sZWFuO1xyXG4gICAgICAgIHdlYnBRdWFsaXR5OiBudW1iZXIgfCBzdHJpbmcgfCBudWxsO1xyXG4gICAgfTtcclxuICAgIHNjYW5uZWQ6IG51bWJlcjtcclxuICAgIGVsaWdpYmxlOiBudW1iZXI7XHJcbiAgICB1cGRhdGVkOiBudW1iZXI7XHJcbiAgICB1bmNoYW5nZWQ6IG51bWJlcjtcclxuICAgIHNraXBwZWQ6IG51bWJlcjtcclxuICAgIGZhaWxlZDogbnVtYmVyO1xyXG4gICAgZmFpbHVyZXM6IEFycmF5PHsgdXJsOiBzdHJpbmc7IGVycm9yOiBzdHJpbmcgfT47XHJcbn07XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVkUHJlc2V0TmFtZSh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8ICcnKS5yZXBsYWNlKC9bXFxzXy1dKy9nLCAnJykudG9Mb3dlckNhc2UoKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzUGxheWFibGVUZXh0dXJlVXJsKHZhbHVlOiB1bmtub3duKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gVEVYVFVSRV9FWFRFTlNJT04udGVzdChTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KC9bPyNdLywgMSlbMF0pO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplV2VicFF1YWxpdHkodmFsdWU6IHVua25vd24pOiBudW1iZXIge1xyXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcih2YWx1ZSk7XHJcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShudW1lcmljKSkgcmV0dXJuIFBMQVlBQkxFX1RSQU5TUEFSRU5UX1dFQlBfUVVBTElUWTtcclxuICAgIGNvbnN0IHBlcmNlbnQgPSBudW1lcmljID4gMCAmJiBudW1lcmljIDw9IDEgPyBudW1lcmljICogMTAwIDogbnVtZXJpYztcclxuICAgIHJldHVybiBNYXRoLm1heCgxLCBNYXRoLm1pbigxMDAsIE1hdGgucm91bmQocGVyY2VudCkpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZGVlcENsb25lPFQ+KHZhbHVlOiBUKTogVCB7XHJcbiAgICByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh2YWx1ZSA/PyB7fSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhc3NldElkZW50aXR5KHBheWxvYWQ6IGFueSk6IHN0cmluZyB8IG51bGwge1xyXG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkID09PSAnc3RyaW5nJykgcmV0dXJuIHBheWxvYWQ7XHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXlsb2FkKSkge1xyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBwYXlsb2FkKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkZW50aXR5ID0gYXNzZXRJZGVudGl0eShpdGVtKTtcclxuICAgICAgICAgICAgaWYgKGlkZW50aXR5KSByZXR1cm4gaWRlbnRpdHk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gcGF5bG9hZC51dWlkIHx8IHBheWxvYWQudXJsIHx8IHBheWxvYWQucGF0aCB8fCBwYXlsb2FkLnNvdXJjZSB8fCBudWxsO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5IHtcclxuICAgIHByaXZhdGUgZnVsbFNjYW46IFByb21pc2U8VGV4dHVyZVBvbGljeVJlcG9ydD4gfCBudWxsID0gbnVsbDtcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXNzZXRJbkZsaWdodCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG5cclxuICAgIGFzeW5jIGVuZm9yY2VBbGwob3B0aW9uczogVGV4dHVyZVBvbGljeU9wdGlvbnMgPSB7fSk6IFByb21pc2U8VGV4dHVyZVBvbGljeVJlcG9ydD4ge1xyXG4gICAgICAgIGlmICh0aGlzLmZ1bGxTY2FuKSByZXR1cm4gdGhpcy5mdWxsU2NhbjtcclxuICAgICAgICB0aGlzLmZ1bGxTY2FuID0gdGhpcy5lbmZvcmNlQWxsSW50ZXJuYWwob3B0aW9ucykuZmluYWxseSgoKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuZnVsbFNjYW4gPSBudWxsO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiB0aGlzLmZ1bGxTY2FuO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGVuZm9yY2VBc3NldChwYXlsb2FkOiBhbnksIG9wdGlvbnM6IFRleHR1cmVQb2xpY3lPcHRpb25zID0ge30pOiBQcm9taXNlPFRleHR1cmVBcHBseVJlc3VsdD4ge1xyXG4gICAgICAgIGNvbnN0IGlkZW50aXR5ID0gYXNzZXRJZGVudGl0eShwYXlsb2FkKTtcclxuICAgICAgICBpZiAoIWlkZW50aXR5KSByZXR1cm4geyBzdGF0dXM6ICdza2lwcGVkJywgdXJsOiAnJywgZXJyb3I6ICdBc3NldCBicm9hZGNhc3QgZGlkIG5vdCBpbmNsdWRlIGEgVVVJRCBvciBVUkwuJyB9O1xyXG4gICAgICAgIGlmICh0aGlzLmFzc2V0SW5GbGlnaHQuaGFzKGlkZW50aXR5KSkgcmV0dXJuIHsgc3RhdHVzOiAndW5jaGFuZ2VkJywgdXJsOiBpZGVudGl0eSB9O1xyXG4gICAgICAgIHRoaXMuYXNzZXRJbkZsaWdodC5hZGQoaWRlbnRpdHkpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHByZXNldCA9IGF3YWl0IHRoaXMuZW5zdXJlUHJlc2V0KG9wdGlvbnMpO1xyXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5hcHBseUFzc2V0KGlkZW50aXR5LCBwcmVzZXQuaWQsIEJvb2xlYW4ob3B0aW9ucy5kcnlSdW4pKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXR1czogJ2ZhaWxlZCcsIHVybDogaWRlbnRpdHksIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgdGhpcy5hc3NldEluRmxpZ2h0LmRlbGV0ZShpZGVudGl0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZW5mb3JjZUFsbEludGVybmFsKG9wdGlvbnM6IFRleHR1cmVQb2xpY3lPcHRpb25zKTogUHJvbWlzZTxUZXh0dXJlUG9saWN5UmVwb3J0PiB7XHJcbiAgICAgICAgY29uc3QgZGlyZWN0b3J5ID0gU3RyaW5nKG9wdGlvbnMuZGlyZWN0b3J5IHx8IERFRkFVTFRfRElSRUNUT1JZKS5yZXBsYWNlKC9cXC8kLywgJycpO1xyXG4gICAgICAgIGNvbnN0IGRyeVJ1biA9IEJvb2xlYW4ob3B0aW9ucy5kcnlSdW4pO1xyXG4gICAgICAgIGNvbnN0IHJlYWR5ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktcmVhZHknKTtcclxuICAgICAgICBpZiAoIXJlYWR5KSB0aHJvdyBuZXcgRXJyb3IoJ0NvY29zIEFzc2V0IERCIGlzIG5vdCByZWFkeTsgdGV4dHVyZSBjb21wcmVzc2lvbiBwb2xpY3kgd2FzIG5vdCBhcHBsaWVkLicpO1xyXG5cclxuICAgICAgICBjb25zdCBwcmVzZXQgPSBhd2FpdCB0aGlzLmVuc3VyZVByZXNldChvcHRpb25zKTtcclxuICAgICAgICBjb25zdCBhc3NldHM6IGFueVtdID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXRzJywge1xyXG4gICAgICAgICAgICBwYXR0ZXJuOiBgJHtkaXJlY3Rvcnl9LyoqLypgLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShhc3NldHMpKSB0aHJvdyBuZXcgRXJyb3IoJ0NvY29zIEFzc2V0IERCIHJldHVybmVkIGFuIGludmFsaWQgdGV4dHVyZSBpbnZlbnRvcnkuJyk7XHJcbiAgICAgICAgaWYgKGFzc2V0cy5sZW5ndGggPiBNQVhfVEVYVFVSRVNfUEVSX1NDQU4pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZXh0dXJlIHBvbGljeSBzY2FuIGV4Y2VlZGVkIHRoZSAke01BWF9URVhUVVJFU19QRVJfU0NBTn0gYXNzZXQgc2FmZXR5IGJ1ZGdldC5gKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHJlcG9ydDogVGV4dHVyZVBvbGljeVJlcG9ydCA9IHtcclxuICAgICAgICAgICAgY29tcGxldGU6IGZhbHNlLFxyXG4gICAgICAgICAgICBkcnlSdW4sXHJcbiAgICAgICAgICAgIGRpcmVjdG9yeSxcclxuICAgICAgICAgICAgcHJlc2V0LFxyXG4gICAgICAgICAgICBzY2FubmVkOiBhc3NldHMubGVuZ3RoLFxyXG4gICAgICAgICAgICBlbGlnaWJsZTogMCxcclxuICAgICAgICAgICAgdXBkYXRlZDogMCxcclxuICAgICAgICAgICAgdW5jaGFuZ2VkOiAwLFxyXG4gICAgICAgICAgICBza2lwcGVkOiAwLFxyXG4gICAgICAgICAgICBmYWlsZWQ6IDAsXHJcbiAgICAgICAgICAgIGZhaWx1cmVzOiBbXSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGFzc2V0cykge1xyXG4gICAgICAgICAgICBjb25zdCB1cmwgPSBTdHJpbmcoYXNzZXQ/LnVybCB8fCBhc3NldD8ucGF0aCB8fCBhc3NldD8uc291cmNlIHx8ICcnKTtcclxuICAgICAgICAgICAgaWYgKCFpc1BsYXlhYmxlVGV4dHVyZVVybCh1cmwpKSB7XHJcbiAgICAgICAgICAgICAgICByZXBvcnQuc2tpcHBlZCArPSAxO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmVwb3J0LmVsaWdpYmxlICs9IDE7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlBc3NldChhc3NldD8udXVpZCB8fCB1cmwsIHByZXNldC5pZCwgZHJ5UnVuKTtcclxuICAgICAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09ICd1cGRhdGVkJykgcmVwb3J0LnVwZGF0ZWQgKz0gMTtcclxuICAgICAgICAgICAgZWxzZSBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3VuY2hhbmdlZCcpIHJlcG9ydC51bmNoYW5nZWQgKz0gMTtcclxuICAgICAgICAgICAgZWxzZSBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3NraXBwZWQnKSByZXBvcnQuc2tpcHBlZCArPSAxO1xyXG4gICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHJlcG9ydC5mYWlsZWQgKz0gMTtcclxuICAgICAgICAgICAgICAgIGlmIChyZXBvcnQuZmFpbHVyZXMubGVuZ3RoIDwgMzIpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXBvcnQuZmFpbHVyZXMucHVzaCh7IHVybDogcmVzdWx0LnVybCB8fCB1cmwsIGVycm9yOiByZXN1bHQuZXJyb3IgfHwgJ1Vua25vd24gQXNzZXQgREIgZmFpbHVyZScgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmVwb3J0LmNvbXBsZXRlID0gcmVwb3J0LmZhaWxlZCA9PT0gMCAmJiByZXBvcnQuZWxpZ2libGUgPT09IHJlcG9ydC51cGRhdGVkICsgcmVwb3J0LnVuY2hhbmdlZDtcclxuICAgICAgICByZXR1cm4gcmVwb3J0O1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZW5zdXJlUHJlc2V0KG9wdGlvbnM6IFRleHR1cmVQb2xpY3lPcHRpb25zKTogUHJvbWlzZTxUZXh0dXJlUG9saWN5UmVwb3J0WydwcmVzZXQnXT4ge1xyXG4gICAgICAgIGNvbnN0IHByb2ZpbGVBcGk6IGFueSA9IChFZGl0b3IgYXMgYW55KS5Qcm9maWxlO1xyXG4gICAgICAgIGlmICghcHJvZmlsZUFwaT8uZ2V0UHJvamVjdCB8fCAhcHJvZmlsZUFwaT8uc2V0UHJvamVjdCkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VkaXRvci5Qcm9maWxlIHByb2plY3QgQVBJIGlzIHVuYXZhaWxhYmxlOyBjYW5ub3QgZW5zdXJlIHRleHR1cmUgY29tcHJlc3Npb24gcHJlc2V0LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCByZXF1ZXN0ZWROYW1lID0gU3RyaW5nKG9wdGlvbnMucHJlc2V0TmFtZSB8fCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfTkFNRSkudHJpbSgpIHx8IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1BSRVNFVF9OQU1FO1xyXG4gICAgICAgIGNvbnN0IHJlcXVlc3RlZElkID0gU3RyaW5nKG9wdGlvbnMucHJlc2V0SWQgfHwgUExBWUFCTEVfVFJBTlNQQVJFTlRfUFJFU0VUX0lEKS50cmltKCkgfHwgUExBWUFCTEVfVFJBTlNQQVJFTlRfUFJFU0VUX0lEO1xyXG4gICAgICAgIGNvbnN0IHF1YWxpdHkgPSBub3JtYWxpemVXZWJwUXVhbGl0eShvcHRpb25zLnF1YWxpdHkpO1xyXG4gICAgICAgIGNvbnN0IGN1cnJlbnQgPSBkZWVwQ2xvbmUoYXdhaXQgcHJvZmlsZUFwaS5nZXRQcm9qZWN0KCdidWlsZGVyJywgJ3RleHR1cmVDb21wcmVzc0NvbmZpZycpIHx8IHt9KTtcclxuICAgICAgICBjdXJyZW50LnVzZXJQcmVzZXQgfHw9IHt9O1xyXG5cclxuICAgICAgICBsZXQgaWQgPSAnJztcclxuICAgICAgICBsZXQgZW50cnk6IGFueSA9IG51bGw7XHJcbiAgICAgICAgY29uc3QgcmVxdWVzdGVkRW50cnkgPSBjdXJyZW50LnVzZXJQcmVzZXRbcmVxdWVzdGVkSWRdO1xyXG4gICAgICAgIGlmIChyZXF1ZXN0ZWRFbnRyeT8ubmFtZSAmJiBub3JtYWxpemVkUHJlc2V0TmFtZShyZXF1ZXN0ZWRFbnRyeS5uYW1lKSA9PT0gbm9ybWFsaXplZFByZXNldE5hbWUocmVxdWVzdGVkTmFtZSkpIHtcclxuICAgICAgICAgICAgaWQgPSByZXF1ZXN0ZWRJZDtcclxuICAgICAgICAgICAgZW50cnkgPSByZXF1ZXN0ZWRFbnRyeTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCB3YW50ZWQgPSBub3JtYWxpemVkUHJlc2V0TmFtZShyZXF1ZXN0ZWROYW1lKTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbY2FuZGlkYXRlSWQsIGNhbmRpZGF0ZV0gb2YgT2JqZWN0LmVudHJpZXM8YW55PihjdXJyZW50LnVzZXJQcmVzZXQpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY2FuZGlkYXRlICYmIG5vcm1hbGl6ZWRQcmVzZXROYW1lKGNhbmRpZGF0ZS5uYW1lKSA9PT0gd2FudGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWQgPSBjYW5kaWRhdGVJZDtcclxuICAgICAgICAgICAgICAgICAgICBlbnRyeSA9IGNhbmRpZGF0ZTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbGV0IGNyZWF0ZWQgPSBmYWxzZTtcclxuICAgICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xyXG4gICAgICAgIGlmICghZW50cnkpIHtcclxuICAgICAgICAgICAgaWQgPSByZXF1ZXN0ZWRJZDtcclxuICAgICAgICAgICAgaWYgKGN1cnJlbnQudXNlclByZXNldFtpZF0pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGV4dHVyZSBwcmVzZXQgSUQgJHtpZH0gaXMgYWxyZWFkeSBvY2N1cGllZCBieSBwcmVzZXQgJHtjdXJyZW50LnVzZXJQcmVzZXRbaWRdLm5hbWUgfHwgJzxpbnZhbGlkPid9LmApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnJlbnQudXNlclByZXNldFtpZF0gPSB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiByZXF1ZXN0ZWROYW1lLFxyXG4gICAgICAgICAgICAgICAgb3B0aW9uczogeyB3ZWI6IHsgd2VicDogeyBxdWFsaXR5IH0gfSB9LFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBlbnRyeSA9IGN1cnJlbnQudXNlclByZXNldFtpZF07XHJcbiAgICAgICAgICAgIGNyZWF0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50V2ViID0gZW50cnk/Lm9wdGlvbnM/LndlYjtcclxuICAgICAgICAgICAgY29uc3Qga2V5cyA9IGN1cnJlbnRXZWIgJiYgdHlwZW9mIGN1cnJlbnRXZWIgPT09ICdvYmplY3QnID8gT2JqZWN0LmtleXMoY3VycmVudFdlYikgOiBbXTtcclxuICAgICAgICAgICAgY29uc3QgY3VycmVudFF1YWxpdHkgPSBub3JtYWxpemVXZWJwUXVhbGl0eShjdXJyZW50V2ViPy53ZWJwPy5xdWFsaXR5KTtcclxuICAgICAgICAgICAgaWYgKGtleXMubGVuZ3RoICE9PSAxIHx8IGtleXNbMF0gIT09ICd3ZWJwJyB8fCBjdXJyZW50UXVhbGl0eSAhPT0gcXVhbGl0eSkge1xyXG4gICAgICAgICAgICAgICAgZW50cnkub3B0aW9ucyB8fD0ge307XHJcbiAgICAgICAgICAgICAgICBlbnRyeS5vcHRpb25zLndlYiA9IHsgd2VicDogeyBxdWFsaXR5IH0gfTtcclxuICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoY2hhbmdlZCAmJiAhb3B0aW9ucy5kcnlSdW4pIHtcclxuICAgICAgICAgICAgYXdhaXQgcHJvZmlsZUFwaS5zZXRQcm9qZWN0KCdidWlsZGVyJywgJ3RleHR1cmVDb21wcmVzc0NvbmZpZycsIGN1cnJlbnQpO1xyXG4gICAgICAgICAgICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHByb2ZpbGVBcGkuZ2V0UHJvamVjdCgnYnVpbGRlcicsICd0ZXh0dXJlQ29tcHJlc3NDb25maWcnKTtcclxuICAgICAgICAgICAgY29uc3QgdmVyaWZpZWRFbnRyeSA9IHZlcmlmaWVkPy51c2VyUHJlc2V0Py5baWRdO1xyXG4gICAgICAgICAgICBjb25zdCB2ZXJpZmllZFdlYiA9IHZlcmlmaWVkRW50cnk/Lm9wdGlvbnM/LndlYjtcclxuICAgICAgICAgICAgaWYgKCF2ZXJpZmllZEVudHJ5XHJcbiAgICAgICAgICAgICAgICB8fCBPYmplY3Qua2V5cyh2ZXJpZmllZFdlYiB8fCB7fSkubGVuZ3RoICE9PSAxXHJcbiAgICAgICAgICAgICAgICB8fCAhdmVyaWZpZWRXZWI/LndlYnBcclxuICAgICAgICAgICAgICAgIHx8IG5vcm1hbGl6ZVdlYnBRdWFsaXR5KHZlcmlmaWVkV2ViLndlYnAucXVhbGl0eSkgIT09IHF1YWxpdHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGV4dHVyZSBjb21wcmVzc2lvbiBwcmVzZXQgJHtyZXF1ZXN0ZWROYW1lfSBkaWQgbm90IHBlcnNpc3QgYXMgV2ViUCBxdWFsaXR5ICR7cXVhbGl0eX0uYCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZW50cnkgPSB2ZXJpZmllZEVudHJ5O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgaWQsXHJcbiAgICAgICAgICAgIG5hbWU6IFN0cmluZyhlbnRyeS5uYW1lIHx8IHJlcXVlc3RlZE5hbWUpLFxyXG4gICAgICAgICAgICBjcmVhdGVkLFxyXG4gICAgICAgICAgICBjaGFuZ2VkLFxyXG4gICAgICAgICAgICB3ZWJwUXVhbGl0eTogZW50cnk/Lm9wdGlvbnM/LndlYj8ud2VicD8ucXVhbGl0eSA/PyBudWxsLFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBhcHBseUFzc2V0KGlkZW50aXR5OiBzdHJpbmcsIHByZXNldElkOiBzdHJpbmcsIGRyeVJ1bjogYm9vbGVhbik6IFByb21pc2U8VGV4dHVyZUFwcGx5UmVzdWx0PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaW5mbzogYW55ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIGlkZW50aXR5KTtcclxuICAgICAgICAgICAgY29uc3QgdXJsID0gU3RyaW5nKGluZm8/LnVybCB8fCBpbmZvPy5wYXRoIHx8IGluZm8/LnNvdXJjZSB8fCBpZGVudGl0eSk7XHJcbiAgICAgICAgICAgIGlmICghaW5mbyB8fCBpbmZvLmlzRGlyZWN0b3J5IHx8ICFpc1BsYXlhYmxlVGV4dHVyZVVybCh1cmwpKSByZXR1cm4geyBzdGF0dXM6ICdza2lwcGVkJywgdXJsIH07XHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGE6IGFueSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LW1ldGEnLCBpbmZvLnV1aWQgfHwgaWRlbnRpdHkpO1xyXG4gICAgICAgICAgICBpZiAoIW1ldGEgfHwgbWV0YS5pbXBvcnRlciAhPT0gJ2ltYWdlJykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnZmFpbGVkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQsIGVycm9yOiAnQXNzZXQgaXMgYSBQTkcvSlBHL0pQRUcgYnV0IENvY29zIGRpZCBub3QgcmV0dXJuIGltYWdlIGltcG9ydGVyIG1ldGFkYXRhLicgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWV0YS51c2VyRGF0YT8uY29tcHJlc3NTZXR0aW5ncz8udXNlQ29tcHJlc3NUZXh0dXJlID09PSB0cnVlICYmIG1ldGEudXNlckRhdGE/LmNvbXByZXNzU2V0dGluZ3M/LnByZXNldElkID09PSBwcmVzZXRJZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jaGFuZ2VkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoZHJ5UnVuKSByZXR1cm4geyBzdGF0dXM6ICd1cGRhdGVkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQgfTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBkZWVwQ2xvbmUobWV0YSk7XHJcbiAgICAgICAgICAgIG5leHQudXNlckRhdGEgfHw9IHt9O1xyXG4gICAgICAgICAgICAvLyBDb2NvcyAzLjggcmVhZHMgb25seSB0aGlzIG5lc3RlZCBpbXBvcnRlciBmaWVsZCBkdXJpbmcgYnVpbGRzLlxyXG4gICAgICAgICAgICBuZXh0LnVzZXJEYXRhLmNvbXByZXNzU2V0dGluZ3MgfHw9IHt9O1xyXG4gICAgICAgICAgICBuZXh0LnVzZXJEYXRhLmNvbXByZXNzU2V0dGluZ3MudXNlQ29tcHJlc3NUZXh0dXJlID0gdHJ1ZTtcclxuICAgICAgICAgICAgbmV4dC51c2VyRGF0YS5jb21wcmVzc1NldHRpbmdzLnByZXNldElkID0gcHJlc2V0SWQ7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3NhdmUtYXNzZXQtbWV0YScsIGluZm8udXVpZCB8fCBpZGVudGl0eSwgSlNPTi5zdHJpbmdpZnkobmV4dCwgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICBjb25zdCB2ZXJpZmllZDogYW55ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtbWV0YScsIGluZm8udXVpZCB8fCBpZGVudGl0eSk7XHJcbiAgICAgICAgICAgIGlmICh2ZXJpZmllZD8udXNlckRhdGE/LmNvbXByZXNzU2V0dGluZ3M/LnVzZUNvbXByZXNzVGV4dHVyZSAhPT0gdHJ1ZSB8fCB2ZXJpZmllZD8udXNlckRhdGE/LmNvbXByZXNzU2V0dGluZ3M/LnByZXNldElkICE9PSBwcmVzZXRJZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBc3NldCBEQiBhY2NlcHRlZCBzYXZlLWFzc2V0LW1ldGEgYnV0IHRoZSBjb21wcmVzc2lvbiBzZXR0aW5ncyBkaWQgbm90IHBlcnNpc3QuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndXBkYXRlZCcsIHVybCwgdXVpZDogaW5mby51dWlkIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdmYWlsZWQnLCB1cmw6IGlkZW50aXR5LCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxubGV0IHNoYXJlZFBvbGljeTogVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5IHwgbnVsbCA9IG51bGw7XG5sZXQgYXV0b21hdGlvblN0YXJ0ZWQgPSBmYWxzZTtcbmxldCBib290c3RyYXBUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsID0gbnVsbDtcbmNvbnN0IGJyb2FkY2FzdExpc3RlbmVyczogQXJyYXk8W3N0cmluZywgKHBheWxvYWQ6IGFueSkgPT4gdm9pZF0+ID0gW107XG5jb25zdCBNQVhfQk9PVFNUUkFQX1JFVFJZX0RFTEFZX01TID0gMzBfMDAwO1xuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3koKTogVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5IHtcclxuICAgIHNoYXJlZFBvbGljeSB8fD0gbmV3IFRleHR1cmVDb21wcmVzc2lvblBvbGljeSgpO1xyXG4gICAgcmV0dXJuIHNoYXJlZFBvbGljeTtcclxufVxyXG5cclxuZnVuY3Rpb24gbG9nQXV0b21hdGlvbkVycm9yKHNjb3BlOiBzdHJpbmcsIGVycm9yOiB1bmtub3duKTogdm9pZCB7XHJcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcihgW1RleHR1cmVDb21wcmVzc2lvblBvbGljeV0gJHtzY29wZX06ICR7bWVzc2FnZX1gKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2NoZWR1bGVCb290c3RyYXBTY2FuKGF0dGVtcHQgPSAwKTogdm9pZCB7XG4gICAgY29uc3QgcG9saWN5ID0gZ2V0VGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KCk7XG4gICAgLy8gVGhlIGV4dGVuc2lvbiBjYW4gbG9hZCBiZWZvcmUgQXNzZXQgREIgYW5kIGNhbiBhbHNvIG1pc3MgYXNzZXQtZGI6cmVhZHkgaWZcbiAgICAvLyB0aGF0IGJyb2FkY2FzdCBoYXBwZW5lZCBiZWZvcmUgbGlzdGVuZXJzIHdlcmUgcmVnaXN0ZXJlZC4gS2VlcCBhIGNoZWFwLFxuICAgIC8vIGNhcHBlZCByZWFkaW5lc3MgcG9sbCBhbGl2ZSBpbnN0ZWFkIG9mIHR1cm5pbmcgbm9ybWFsIHN0YXJ0dXAgb3JkZXJpbmcgaW50b1xuICAgIC8vIGEgcmVkIGNvbnNvbGUgZXJyb3IgYWZ0ZXIgYW4gYXJiaXRyYXJ5IHJldHJ5IGNvdW50LlxuICAgIGNvbnN0IGRlbGF5TXMgPSBhdHRlbXB0ID09PSAwID8gNTAwIDogTWF0aC5taW4oMTAwMCAqICgyICoqIE1hdGgubWluKGF0dGVtcHQgLSAxLCA1KSksIE1BWF9CT09UU1RSQVBfUkVUUllfREVMQVlfTVMpO1xuICAgIGJvb3RzdHJhcFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgYm9vdHN0cmFwVGltZXIgPSBudWxsO1xyXG4gICAgICAgIGlmICghYXV0b21hdGlvblN0YXJ0ZWQpIHJldHVybjtcclxuICAgICAgICB2b2lkIHBvbGljeS5lbmZvcmNlQWxsKCkudGhlbigocmVwb3J0KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5XSBwcmVzZXQ9JHtyZXBvcnQucHJlc2V0Lm5hbWV9IGVsaWdpYmxlPSR7cmVwb3J0LmVsaWdpYmxlfSB1cGRhdGVkPSR7cmVwb3J0LnVwZGF0ZWR9IHVuY2hhbmdlZD0ke3JlcG9ydC51bmNoYW5nZWR9IGZhaWxlZD0ke3JlcG9ydC5mYWlsZWR9YCk7XHJcbiAgICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XHJcbiAgICAgICAgICAgIGlmICgvYXNzZXQgZGIgaXMgbm90IHJlYWR5L2kudGVzdChtZXNzYWdlKSAmJiBhdXRvbWF0aW9uU3RhcnRlZCkge1xuICAgICAgICAgICAgICAgIHNjaGVkdWxlQm9vdHN0cmFwU2NhbihhdHRlbXB0ICsgMSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsb2dBdXRvbWF0aW9uRXJyb3IoJ3N0YXJ0dXAgc2NhbicsIGVycm9yKTtcclxuICAgICAgICB9KTtcclxuICAgIH0sIGRlbGF5TXMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRUZXh0dXJlQ29tcHJlc3Npb25BdXRvbWF0aW9uKCk6IHZvaWQge1xyXG4gICAgaWYgKGF1dG9tYXRpb25TdGFydGVkKSByZXR1cm47XHJcbiAgICBhdXRvbWF0aW9uU3RhcnRlZCA9IHRydWU7XHJcbiAgICBjb25zdCBtZXNzYWdlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZTtcclxuICAgIGNvbnN0IHBvbGljeSA9IGdldFRleHR1cmVDb21wcmVzc2lvblBvbGljeSgpO1xyXG4gICAgaWYgKHR5cGVvZiBtZXNzYWdlQXBpPy5hZGRCcm9hZGNhc3RMaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIGNvbnN0IG9uQXNzZXQgPSAocGF5bG9hZDogYW55KSA9PiB7XHJcbiAgICAgICAgICAgIHZvaWQgcG9saWN5LmVuZm9yY2VBc3NldChwYXlsb2FkKS50aGVuKChyZXN1bHQpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZmFpbGVkJykgbG9nQXV0b21hdGlvbkVycm9yKHJlc3VsdC51cmwgfHwgJ2Fzc2V0IGJyb2FkY2FzdCcsIHJlc3VsdC5lcnJvciB8fCAndW5rbm93biBmYWlsdXJlJyk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4gbG9nQXV0b21hdGlvbkVycm9yKCdhc3NldCBicm9hZGNhc3QnLCBlcnJvcikpO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29uc3Qgb25SZWFkeSA9ICgpID0+IHtcclxuICAgICAgICAgICAgdm9pZCBwb2xpY3kuZW5mb3JjZUFsbCgpLnRoZW4oKHJlcG9ydCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFyZXBvcnQuY29tcGxldGUpIGxvZ0F1dG9tYXRpb25FcnJvcignYXNzZXQtZGIgcmVhZHkgc2NhbicsIGAke3JlcG9ydC5mYWlsZWR9IHRleHR1cmUocykgZmFpbGVkYCk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4gbG9nQXV0b21hdGlvbkVycm9yKCdhc3NldC1kYiByZWFkeSBzY2FuJywgZXJyb3IpKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGZvciAoY29uc3QgZXZlbnQgb2YgWydhc3NldC1kYjphc3NldC1hZGQnLCAnYXNzZXQtZGI6YXNzZXQtY2hhbmdlJ10pIHtcclxuICAgICAgICAgICAgbWVzc2FnZUFwaS5hZGRCcm9hZGNhc3RMaXN0ZW5lcihldmVudCwgb25Bc3NldCk7XHJcbiAgICAgICAgICAgIGJyb2FkY2FzdExpc3RlbmVycy5wdXNoKFtldmVudCwgb25Bc3NldF0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBtZXNzYWdlQXBpLmFkZEJyb2FkY2FzdExpc3RlbmVyKCdhc3NldC1kYjpyZWFkeScsIG9uUmVhZHkpO1xyXG4gICAgICAgIGJyb2FkY2FzdExpc3RlbmVycy5wdXNoKFsnYXNzZXQtZGI6cmVhZHknLCBvblJlYWR5XSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignW1RleHR1cmVDb21wcmVzc2lvblBvbGljeV0gRWRpdG9yIGJyb2FkY2FzdCBsaXN0ZW5lcnMgYXJlIHVuYXZhaWxhYmxlOyB1c2UgYXNzZXRBZHZhbmNlZF9lbmZvcmNlX3RleHR1cmVfY29tcHJlc3Npb25fcG9saWN5IGZvciBleGlzdGluZyBhc3NldHMuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgc2NoZWR1bGVCb290c3RyYXBTY2FuKCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzdG9wVGV4dHVyZUNvbXByZXNzaW9uQXV0b21hdGlvbigpOiB2b2lkIHtcclxuICAgIGlmICghYXV0b21hdGlvblN0YXJ0ZWQpIHJldHVybjtcclxuICAgIGF1dG9tYXRpb25TdGFydGVkID0gZmFsc2U7XHJcbiAgICBpZiAoYm9vdHN0cmFwVGltZXIpIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQoYm9vdHN0cmFwVGltZXIpO1xyXG4gICAgICAgIGJvb3RzdHJhcFRpbWVyID0gbnVsbDtcclxuICAgIH1cclxuICAgIGNvbnN0IG1lc3NhZ2VBcGk6IGFueSA9IChFZGl0b3IgYXMgYW55KS5NZXNzYWdlO1xyXG4gICAgaWYgKHR5cGVvZiBtZXNzYWdlQXBpPy5yZW1vdmVCcm9hZGNhc3RMaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIGZvciAoY29uc3QgW2V2ZW50LCBsaXN0ZW5lcl0gb2YgYnJvYWRjYXN0TGlzdGVuZXJzKSBtZXNzYWdlQXBpLnJlbW92ZUJyb2FkY2FzdExpc3RlbmVyKGV2ZW50LCBsaXN0ZW5lcik7XHJcbiAgICB9XHJcbiAgICBicm9hZGNhc3RMaXN0ZW5lcnMubGVuZ3RoID0gMDtcclxufVxyXG4iXX0=