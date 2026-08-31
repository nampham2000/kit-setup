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
        var _a, _b, _c, _d;
        try {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', identity);
            const url = String((info === null || info === void 0 ? void 0 : info.url) || (info === null || info === void 0 ? void 0 : info.path) || (info === null || info === void 0 ? void 0 : info.source) || identity);
            if (!info || info.isDirectory || !isPlayableTextureUrl(url))
                return { status: 'skipped', url };
            const meta = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!meta || meta.importer !== 'image') {
                return { status: 'failed', url, uuid: info.uuid, error: 'Asset is a PNG/JPG/JPEG but Cocos did not return image importer metadata.' };
            }
            if (((_a = meta.userData) === null || _a === void 0 ? void 0 : _a.useCompressTexture) === true && ((_b = meta.userData) === null || _b === void 0 ? void 0 : _b.presetId) === presetId) {
                return { status: 'unchanged', url, uuid: info.uuid };
            }
            if (dryRun)
                return { status: 'updated', url, uuid: info.uuid };
            const next = deepClone(meta);
            next.userData || (next.userData = {});
            next.userData.useCompressTexture = true;
            next.userData.presetId = presetId;
            await Editor.Message.request('asset-db', 'save-asset-meta', info.uuid || identity, JSON.stringify(next, null, 2));
            const verified = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (((_c = verified === null || verified === void 0 ? void 0 : verified.userData) === null || _c === void 0 ? void 0 : _c.useCompressTexture) !== true || ((_d = verified === null || verified === void 0 ? void 0 : verified.userData) === null || _d === void 0 ? void 0 : _d.presetId) !== presetId) {
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
    const delayMs = attempt === 0 ? 500 : 1000;
    bootstrapTimer = setTimeout(() => {
        bootstrapTimer = null;
        if (!automationStarted)
            return;
        void policy.enforceAll().then((report) => {
            console.log(`[TextureCompressionPolicy] preset=${report.preset.name} eligible=${report.eligible} updated=${report.updated} unchanged=${report.unchanged} failed=${report.failed}`);
        }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (/asset db is not ready/i.test(message) && attempt < 30 && automationStarted) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGV4dHVyZS1jb21wcmVzc2lvbi1wb2xpY3kuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvdGV4dHVyZS1jb21wcmVzc2lvbi1wb2xpY3kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBK0NBLG9EQUVDO0FBRUQsb0RBS0M7QUFnTkQsa0VBR0M7QUEwQkQsOEVBMkJDO0FBRUQsNEVBWUM7QUE5VUQsTUFBTSxpQkFBaUIsR0FBRyxhQUFhLENBQUM7QUFDM0IsUUFBQSw4QkFBOEIsR0FBRyx3QkFBd0IsQ0FBQztBQUMxRCxRQUFBLGdDQUFnQyxHQUFHLHFCQUFxQixDQUFDO0FBQ3pELFFBQUEsaUNBQWlDLEdBQUcsRUFBRSxDQUFDO0FBRXBELE1BQU0saUJBQWlCLEdBQUcsbUJBQW1CLENBQUM7QUFDOUMsTUFBTSxxQkFBcUIsR0FBRyxLQUFNLENBQUM7QUFxQ3JDLFNBQVMsb0JBQW9CLENBQUMsS0FBYztJQUN4QyxPQUFPLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztBQUNyRSxDQUFDO0FBRUQsU0FBZ0Isb0JBQW9CLENBQUMsS0FBYztJQUMvQyxPQUFPLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzRSxDQUFDO0FBRUQsU0FBZ0Isb0JBQW9CLENBQUMsS0FBYztJQUMvQyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDOUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO1FBQUUsT0FBTyx5Q0FBaUMsQ0FBQztJQUN4RSxNQUFNLE9BQU8sR0FBRyxPQUFPLEdBQUcsQ0FBQyxJQUFJLE9BQU8sSUFB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PSAnZGI6Ly9hc3NldHMnO1xuZXhwb3J0IGNvbnN0IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1BSRVNFVF9JRCA9ICcxZllHMGg3TUpEY3ArekEyY01jVXNSJztcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfTkFNRSA9ICdQbGF5YWJsZVRyYW5zcGFyZW50JztcbmV4cG9ydCBjb25zdCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9XRUJQX1FVQUxJVFkgPSA1MDtcblxuY29uc3QgVEVYVFVSRV9FWFRFTlNJT04gPSAvXFwuKD86cG5nfGpwZT9nKSQvaTtcbmNvbnN0IE1BWF9URVhUVVJFU19QRVJfU0NBTiA9IDIwXzAwMDtcblxudHlwZSBUZXh0dXJlUG9saWN5T3B0aW9ucyA9IHtcbiAgICBkaXJlY3Rvcnk/OiBzdHJpbmc7XG4gICAgcHJlc2V0SWQ/OiBzdHJpbmc7XG4gICAgcHJlc2V0TmFtZT86IHN0cmluZztcbiAgICBxdWFsaXR5PzogbnVtYmVyO1xuICAgIGRyeVJ1bj86IGJvb2xlYW47XG59O1xuXG50eXBlIFRleHR1cmVBcHBseVJlc3VsdCA9IHtcbiAgICBzdGF0dXM6ICd1cGRhdGVkJyB8ICd1bmNoYW5nZWQnIHwgJ3NraXBwZWQnIHwgJ2ZhaWxlZCc7XG4gICAgdXJsOiBzdHJpbmc7XG4gICAgdXVpZD86IHN0cmluZztcbiAgICBlcnJvcj86IHN0cmluZztcbn07XG5cbmV4cG9ydCB0eXBlIFRleHR1cmVQb2xpY3lSZXBvcnQgPSB7XG4gICAgY29tcGxldGU6IGJvb2xlYW47XG4gICAgZHJ5UnVuOiBib29sZWFuO1xuICAgIGRpcmVjdG9yeTogc3RyaW5nO1xuICAgIHByZXNldDoge1xuICAgICAgICBpZDogc3RyaW5nO1xuICAgICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICAgIGNyZWF0ZWQ6IGJvb2xlYW47XG4gICAgICAgIGNoYW5nZWQ6IGJvb2xlYW47XG4gICAgICAgIHdlYnBRdWFsaXR5OiBudW1iZXIgfCBzdHJpbmcgfCBudWxsO1xuICAgIH07XG4gICAgc2Nhbm5lZDogbnVtYmVyO1xuICAgIGVsaWdpYmxlOiBudW1iZXI7XG4gICAgdXBkYXRlZDogbnVtYmVyO1xuICAgIHVuY2hhbmdlZDogbnVtYmVyO1xuICAgIHNraXBwZWQ6IG51bWJlcjtcbiAgICBmYWlsZWQ6IG51bWJlcjtcbiAgICBmYWlsdXJlczogQXJyYXk8eyB1cmw6IHN0cmluZzsgZXJyb3I6IHN0cmluZyB9Pjtcbn07XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZWRQcmVzZXROYW1lKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8ICcnKS5yZXBsYWNlKC9bXFxzXy1dKy9nLCAnJykudG9Mb3dlckNhc2UoKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzUGxheWFibGVUZXh0dXJlVXJsKHZhbHVlOiB1bmtub3duKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIFRFWFRVUkVfRVhURU5TSU9OLnRlc3QoU3RyaW5nKHZhbHVlIHx8ICcnKS5zcGxpdCgvWz8jXS8sIDEpWzBdKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVdlYnBRdWFsaXR5KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKHZhbHVlKTtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShudW1lcmljKSkgcmV0dXJuIFBMQVlBQkxFX1RSQU5TUEFSRU5UX1dFQlBfUVVBTElUWTtcbiAgICBjb25zdCBwZXJjZW50ID0gbnVtZXJpYyA+IDAgJiYgbnVtZXJpYyA8PSAxID8gbnVtZXJpYyAqIDEwMCA6IG51bWVyaWM7XG4gICAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGgubWluKDEwMCwgTWF0aC5yb3VuZChwZXJjZW50KSkpO1xufVxuXG5mdW5jdGlvbiBkZWVwQ2xvbmU8VD4odmFsdWU6IFQpOiBUIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh2YWx1ZSA/PyB7fSkpO1xufVxuXG5mdW5jdGlvbiBhc3NldElkZW50aXR5KHBheWxvYWQ6IGFueSk6IHN0cmluZyB8IG51bGwge1xuICAgIGlmICh0eXBlb2YgcGF5bG9hZCA9PT0gJ3N0cmluZycpIHJldHVybiBwYXlsb2FkO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHBheWxvYWQpKSB7XG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBwYXlsb2FkKSB7XG4gICAgICAgICAgICBjb25zdCBpZGVudGl0eSA9IGFzc2V0SWRlbnRpdHkoaXRlbSk7XG4gICAgICAgICAgICBpZiAoaWRlbnRpdHkpIHJldHVybiBpZGVudGl0eTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHBheWxvYWQudXVpZCB8fCBwYXlsb2FkLnVybCB8fCBwYXlsb2FkLnBhdGggfHwgcGF5bG9hZC5zb3VyY2UgfHwgbnVsbDtcbn1cblxuZXhwb3J0IGNsYXNzIFRleHR1cmVDb21wcmVzc2lvblBvbGljeSB7XG4gICAgcHJpdmF0ZSBmdWxsU2NhbjogUHJvbWlzZTxUZXh0dXJlUG9saWN5UmVwb3J0PiB8IG51bGwgPSBudWxsO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgYXNzZXRJbkZsaWdodCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgYXN5bmMgZW5mb3JjZUFsbChvcHRpb25zOiBUZXh0dXJlUG9saWN5T3B0aW9ucyA9IHt9KTogUHJvbWlzZTxUZXh0dXJlUG9saWN5UmVwb3J0PiB7XG4gICAgICAgIGlmICh0aGlzLmZ1bGxTY2FuKSByZXR1cm4gdGhpcy5mdWxsU2NhbjtcbiAgICAgICAgdGhpcy5mdWxsU2NhbiA9IHRoaXMuZW5mb3JjZUFsbEludGVybmFsKG9wdGlvbnMpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5mdWxsU2NhbiA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGhpcy5mdWxsU2NhbjtcbiAgICB9XG5cbiAgICBhc3luYyBlbmZvcmNlQXNzZXQocGF5bG9hZDogYW55LCBvcHRpb25zOiBUZXh0dXJlUG9saWN5T3B0aW9ucyA9IHt9KTogUHJvbWlzZTxUZXh0dXJlQXBwbHlSZXN1bHQ+IHtcbiAgICAgICAgY29uc3QgaWRlbnRpdHkgPSBhc3NldElkZW50aXR5KHBheWxvYWQpO1xuICAgICAgICBpZiAoIWlkZW50aXR5KSByZXR1cm4geyBzdGF0dXM6ICdza2lwcGVkJywgdXJsOiAnJywgZXJyb3I6ICdBc3NldCBicm9hZGNhc3QgZGlkIG5vdCBpbmNsdWRlIGEgVVVJRCBvciBVUkwuJyB9O1xuICAgICAgICBpZiAodGhpcy5hc3NldEluRmxpZ2h0LmhhcyhpZGVudGl0eSkpIHJldHVybiB7IHN0YXR1czogJ3VuY2hhbmdlZCcsIHVybDogaWRlbnRpdHkgfTtcbiAgICAgICAgdGhpcy5hc3NldEluRmxpZ2h0LmFkZChpZGVudGl0eSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBwcmVzZXQgPSBhd2FpdCB0aGlzLmVuc3VyZVByZXNldChvcHRpb25zKTtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFwcGx5QXNzZXQoaWRlbnRpdHksIHByZXNldC5pZCwgQm9vbGVhbihvcHRpb25zLmRyeVJ1bikpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdmYWlsZWQnLCB1cmw6IGlkZW50aXR5LCBlcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSB9O1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdGhpcy5hc3NldEluRmxpZ2h0LmRlbGV0ZShpZGVudGl0eSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGVuZm9yY2VBbGxJbnRlcm5hbChvcHRpb25zOiBUZXh0dXJlUG9saWN5T3B0aW9ucyk6IFByb21pc2U8VGV4dHVyZVBvbGljeVJlcG9ydD4ge1xuICAgICAgICBjb25zdCBkaXJlY3RvcnkgPSBTdHJpbmcob3B0aW9ucy5kaXJlY3RvcnkgfHwgREVGQVVMVF9ESVJFQ1RPUlkpLnJlcGxhY2UoL1xcLyQvLCAnJyk7XG4gICAgICAgIGNvbnN0IGRyeVJ1biA9IEJvb2xlYW4ob3B0aW9ucy5kcnlSdW4pO1xuICAgICAgICBjb25zdCByZWFkeSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LXJlYWR5Jyk7XG4gICAgICAgIGlmICghcmVhZHkpIHRocm93IG5ldyBFcnJvcignQ29jb3MgQXNzZXQgREIgaXMgbm90IHJlYWR5OyB0ZXh0dXJlIGNvbXByZXNzaW9uIHBvbGljeSB3YXMgbm90IGFwcGxpZWQuJyk7XG5cbiAgICAgICAgY29uc3QgcHJlc2V0ID0gYXdhaXQgdGhpcy5lbnN1cmVQcmVzZXQob3B0aW9ucyk7XG4gICAgICAgIGNvbnN0IGFzc2V0czogYW55W10gPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldHMnLCB7XG4gICAgICAgICAgICBwYXR0ZXJuOiBgJHtkaXJlY3Rvcnl9LyoqLypgLFxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFzc2V0cykpIHRocm93IG5ldyBFcnJvcignQ29jb3MgQXNzZXQgREIgcmV0dXJuZWQgYW4gaW52YWxpZCB0ZXh0dXJlIGludmVudG9yeS4nKTtcbiAgICAgICAgaWYgKGFzc2V0cy5sZW5ndGggPiBNQVhfVEVYVFVSRVNfUEVSX1NDQU4pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGV4dHVyZSBwb2xpY3kgc2NhbiBleGNlZWRlZCB0aGUgJHtNQVhfVEVYVFVSRVNfUEVSX1NDQU59IGFzc2V0IHNhZmV0eSBidWRnZXQuYCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXBvcnQ6IFRleHR1cmVQb2xpY3lSZXBvcnQgPSB7XG4gICAgICAgICAgICBjb21wbGV0ZTogZmFsc2UsXG4gICAgICAgICAgICBkcnlSdW4sXG4gICAgICAgICAgICBkaXJlY3RvcnksXG4gICAgICAgICAgICBwcmVzZXQsXG4gICAgICAgICAgICBzY2FubmVkOiBhc3NldHMubGVuZ3RoLFxuICAgICAgICAgICAgZWxpZ2libGU6IDAsXG4gICAgICAgICAgICB1cGRhdGVkOiAwLFxuICAgICAgICAgICAgdW5jaGFuZ2VkOiAwLFxuICAgICAgICAgICAgc2tpcHBlZDogMCxcbiAgICAgICAgICAgIGZhaWxlZDogMCxcbiAgICAgICAgICAgIGZhaWx1cmVzOiBbXSxcbiAgICAgICAgfTtcblxuICAgICAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGFzc2V0cykge1xuICAgICAgICAgICAgY29uc3QgdXJsID0gU3RyaW5nKGFzc2V0Py51cmwgfHwgYXNzZXQ/LnBhdGggfHwgYXNzZXQ/LnNvdXJjZSB8fCAnJyk7XG4gICAgICAgICAgICBpZiAoIWlzUGxheWFibGVUZXh0dXJlVXJsKHVybCkpIHtcbiAgICAgICAgICAgICAgICByZXBvcnQuc2tpcHBlZCArPSAxO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVwb3J0LmVsaWdpYmxlICs9IDE7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5QXNzZXQoYXNzZXQ/LnV1aWQgfHwgdXJsLCBwcmVzZXQuaWQsIGRyeVJ1bik7XG4gICAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3VwZGF0ZWQnKSByZXBvcnQudXBkYXRlZCArPSAxO1xuICAgICAgICAgICAgZWxzZSBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3VuY2hhbmdlZCcpIHJlcG9ydC51bmNoYW5nZWQgKz0gMTtcbiAgICAgICAgICAgIGVsc2UgaWYgKHJlc3VsdC5zdGF0dXMgPT09ICdza2lwcGVkJykgcmVwb3J0LnNraXBwZWQgKz0gMTtcbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlcG9ydC5mYWlsZWQgKz0gMTtcbiAgICAgICAgICAgICAgICBpZiAocmVwb3J0LmZhaWx1cmVzLmxlbmd0aCA8IDMyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcG9ydC5mYWlsdXJlcy5wdXNoKHsgdXJsOiByZXN1bHQudXJsIHx8IHVybCwgZXJyb3I6IHJlc3VsdC5lcnJvciB8fCAnVW5rbm93biBBc3NldCBEQiBmYWlsdXJlJyB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmVwb3J0LmNvbXBsZXRlID0gcmVwb3J0LmZhaWxlZCA9PT0gMCAmJiByZXBvcnQuZWxpZ2libGUgPT09IHJlcG9ydC51cGRhdGVkICsgcmVwb3J0LnVuY2hhbmdlZDtcbiAgICAgICAgcmV0dXJuIHJlcG9ydDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGVuc3VyZVByZXNldChvcHRpb25zOiBUZXh0dXJlUG9saWN5T3B0aW9ucyk6IFByb21pc2U8VGV4dHVyZVBvbGljeVJlcG9ydFsncHJlc2V0J10+IHtcbiAgICAgICAgY29uc3QgcHJvZmlsZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLlByb2ZpbGU7XG4gICAgICAgIGlmICghcHJvZmlsZUFwaT8uZ2V0UHJvamVjdCB8fCAhcHJvZmlsZUFwaT8uc2V0UHJvamVjdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFZGl0b3IuUHJvZmlsZSBwcm9qZWN0IEFQSSBpcyB1bmF2YWlsYWJsZTsgY2Fubm90IGVuc3VyZSB0ZXh0dXJlIGNvbXByZXNzaW9uIHByZXNldC4nKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXF1ZXN0ZWROYW1lID0gU3RyaW5nKG9wdGlvbnMucHJlc2V0TmFtZSB8fCBQTEFZQUJMRV9UUkFOU1BBUkVOVF9QUkVTRVRfTkFNRSkudHJpbSgpIHx8IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1BSRVNFVF9OQU1FO1xuICAgICAgICBjb25zdCByZXF1ZXN0ZWRJZCA9IFN0cmluZyhvcHRpb25zLnByZXNldElkIHx8IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1BSRVNFVF9JRCkudHJpbSgpIHx8IFBMQVlBQkxFX1RSQU5TUEFSRU5UX1BSRVNFVF9JRDtcbiAgICAgICAgY29uc3QgcXVhbGl0eSA9IG5vcm1hbGl6ZVdlYnBRdWFsaXR5KG9wdGlvbnMucXVhbGl0eSk7XG4gICAgICAgIGNvbnN0IGN1cnJlbnQgPSBkZWVwQ2xvbmUoYXdhaXQgcHJvZmlsZUFwaS5nZXRQcm9qZWN0KCdidWlsZGVyJywgJ3RleHR1cmVDb21wcmVzc0NvbmZpZycpIHx8IHt9KTtcbiAgICAgICAgY3VycmVudC51c2VyUHJlc2V0IHx8PSB7fTtcblxuICAgICAgICBsZXQgaWQgPSAnJztcbiAgICAgICAgbGV0IGVudHJ5OiBhbnkgPSBudWxsO1xuICAgICAgICBjb25zdCByZXF1ZXN0ZWRFbnRyeSA9IGN1cnJlbnQudXNlclByZXNldFtyZXF1ZXN0ZWRJZF07XG4gICAgICAgIGlmIChyZXF1ZXN0ZWRFbnRyeT8ubmFtZSAmJiBub3JtYWxpemVkUHJlc2V0TmFtZShyZXF1ZXN0ZWRFbnRyeS5uYW1lKSA9PT0gbm9ybWFsaXplZFByZXNldE5hbWUocmVxdWVzdGVkTmFtZSkpIHtcbiAgICAgICAgICAgIGlkID0gcmVxdWVzdGVkSWQ7XG4gICAgICAgICAgICBlbnRyeSA9IHJlcXVlc3RlZEVudHJ5O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgd2FudGVkID0gbm9ybWFsaXplZFByZXNldE5hbWUocmVxdWVzdGVkTmFtZSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtjYW5kaWRhdGVJZCwgY2FuZGlkYXRlXSBvZiBPYmplY3QuZW50cmllczxhbnk+KGN1cnJlbnQudXNlclByZXNldCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoY2FuZGlkYXRlICYmIG5vcm1hbGl6ZWRQcmVzZXROYW1lKGNhbmRpZGF0ZS5uYW1lKSA9PT0gd2FudGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkID0gY2FuZGlkYXRlSWQ7XG4gICAgICAgICAgICAgICAgICAgIGVudHJ5ID0gY2FuZGlkYXRlO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgY3JlYXRlZCA9IGZhbHNlO1xuICAgICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuICAgICAgICBpZiAoIWVudHJ5KSB7XG4gICAgICAgICAgICBpZCA9IHJlcXVlc3RlZElkO1xuICAgICAgICAgICAgaWYgKGN1cnJlbnQudXNlclByZXNldFtpZF0pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRleHR1cmUgcHJlc2V0IElEICR7aWR9IGlzIGFscmVhZHkgb2NjdXBpZWQgYnkgcHJlc2V0ICR7Y3VycmVudC51c2VyUHJlc2V0W2lkXS5uYW1lIHx8ICc8aW52YWxpZD4nfS5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN1cnJlbnQudXNlclByZXNldFtpZF0gPSB7XG4gICAgICAgICAgICAgICAgbmFtZTogcmVxdWVzdGVkTmFtZSxcbiAgICAgICAgICAgICAgICBvcHRpb25zOiB7IHdlYjogeyB3ZWJwOiB7IHF1YWxpdHkgfSB9IH0sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgZW50cnkgPSBjdXJyZW50LnVzZXJQcmVzZXRbaWRdO1xuICAgICAgICAgICAgY3JlYXRlZCA9IHRydWU7XG4gICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRXZWIgPSBlbnRyeT8ub3B0aW9ucz8ud2ViO1xuICAgICAgICAgICAgY29uc3Qga2V5cyA9IGN1cnJlbnRXZWIgJiYgdHlwZW9mIGN1cnJlbnRXZWIgPT09ICdvYmplY3QnID8gT2JqZWN0LmtleXMoY3VycmVudFdlYikgOiBbXTtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRRdWFsaXR5ID0gbm9ybWFsaXplV2VicFF1YWxpdHkoY3VycmVudFdlYj8ud2VicD8ucXVhbGl0eSk7XG4gICAgICAgICAgICBpZiAoa2V5cy5sZW5ndGggIT09IDEgfHwga2V5c1swXSAhPT0gJ3dlYnAnIHx8IGN1cnJlbnRRdWFsaXR5ICE9PSBxdWFsaXR5KSB7XG4gICAgICAgICAgICAgICAgZW50cnkub3B0aW9ucyB8fD0ge307XG4gICAgICAgICAgICAgICAgZW50cnkub3B0aW9ucy53ZWIgPSB7IHdlYnA6IHsgcXVhbGl0eSB9IH07XG4gICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2hhbmdlZCAmJiAhb3B0aW9ucy5kcnlSdW4pIHtcbiAgICAgICAgICAgIGF3YWl0IHByb2ZpbGVBcGkuc2V0UHJvamVjdCgnYnVpbGRlcicsICd0ZXh0dXJlQ29tcHJlc3NDb25maWcnLCBjdXJyZW50KTtcbiAgICAgICAgICAgIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgcHJvZmlsZUFwaS5nZXRQcm9qZWN0KCdidWlsZGVyJywgJ3RleHR1cmVDb21wcmVzc0NvbmZpZycpO1xuICAgICAgICAgICAgY29uc3QgdmVyaWZpZWRFbnRyeSA9IHZlcmlmaWVkPy51c2VyUHJlc2V0Py5baWRdO1xuICAgICAgICAgICAgY29uc3QgdmVyaWZpZWRXZWIgPSB2ZXJpZmllZEVudHJ5Py5vcHRpb25zPy53ZWI7XG4gICAgICAgICAgICBpZiAoIXZlcmlmaWVkRW50cnlcbiAgICAgICAgICAgICAgICB8fCBPYmplY3Qua2V5cyh2ZXJpZmllZFdlYiB8fCB7fSkubGVuZ3RoICE9PSAxXG4gICAgICAgICAgICAgICAgfHwgIXZlcmlmaWVkV2ViPy53ZWJwXG4gICAgICAgICAgICAgICAgfHwgbm9ybWFsaXplV2VicFF1YWxpdHkodmVyaWZpZWRXZWIud2VicC5xdWFsaXR5KSAhPT0gcXVhbGl0eSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGV4dHVyZSBjb21wcmVzc2lvbiBwcmVzZXQgJHtyZXF1ZXN0ZWROYW1lfSBkaWQgbm90IHBlcnNpc3QgYXMgV2ViUCBxdWFsaXR5ICR7cXVhbGl0eX0uYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbnRyeSA9IHZlcmlmaWVkRW50cnk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICBuYW1lOiBTdHJpbmcoZW50cnkubmFtZSB8fCByZXF1ZXN0ZWROYW1lKSxcbiAgICAgICAgICAgIGNyZWF0ZWQsXG4gICAgICAgICAgICBjaGFuZ2VkLFxuICAgICAgICAgICAgd2VicFF1YWxpdHk6IGVudHJ5Py5vcHRpb25zPy53ZWI/LndlYnA/LnF1YWxpdHkgPz8gbnVsbCxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGFwcGx5QXNzZXQoaWRlbnRpdHk6IHN0cmluZywgcHJlc2V0SWQ6IHN0cmluZywgZHJ5UnVuOiBib29sZWFuKTogUHJvbWlzZTxUZXh0dXJlQXBwbHlSZXN1bHQ+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGluZm86IGFueSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCBpZGVudGl0eSk7XG4gICAgICAgICAgICBjb25zdCB1cmwgPSBTdHJpbmcoaW5mbz8udXJsIHx8IGluZm8/LnBhdGggfHwgaW5mbz8uc291cmNlIHx8IGlkZW50aXR5KTtcbiAgICAgICAgICAgIGlmICghaW5mbyB8fCBpbmZvLmlzRGlyZWN0b3J5IHx8ICFpc1BsYXlhYmxlVGV4dHVyZVVybCh1cmwpKSByZXR1cm4geyBzdGF0dXM6ICdza2lwcGVkJywgdXJsIH07XG4gICAgICAgICAgICBjb25zdCBtZXRhOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1tZXRhJywgaW5mby51dWlkIHx8IGlkZW50aXR5KTtcbiAgICAgICAgICAgIGlmICghbWV0YSB8fCBtZXRhLmltcG9ydGVyICE9PSAnaW1hZ2UnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnZmFpbGVkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQsIGVycm9yOiAnQXNzZXQgaXMgYSBQTkcvSlBHL0pQRUcgYnV0IENvY29zIGRpZCBub3QgcmV0dXJuIGltYWdlIGltcG9ydGVyIG1ldGFkYXRhLicgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChtZXRhLnVzZXJEYXRhPy51c2VDb21wcmVzc1RleHR1cmUgPT09IHRydWUgJiYgbWV0YS51c2VyRGF0YT8ucHJlc2V0SWQgPT09IHByZXNldElkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jaGFuZ2VkJywgdXJsLCB1dWlkOiBpbmZvLnV1aWQgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkcnlSdW4pIHJldHVybiB7IHN0YXR1czogJ3VwZGF0ZWQnLCB1cmwsIHV1aWQ6IGluZm8udXVpZCB9O1xuXG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gZGVlcENsb25lKG1ldGEpO1xuICAgICAgICAgICAgbmV4dC51c2VyRGF0YSB8fD0ge307XG4gICAgICAgICAgICBuZXh0LnVzZXJEYXRhLnVzZUNvbXByZXNzVGV4dHVyZSA9IHRydWU7XG4gICAgICAgICAgICBuZXh0LnVzZXJEYXRhLnByZXNldElkID0gcHJlc2V0SWQ7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdzYXZlLWFzc2V0LW1ldGEnLCBpbmZvLnV1aWQgfHwgaWRlbnRpdHksIEpTT04uc3RyaW5naWZ5KG5leHQsIG51bGwsIDIpKTtcbiAgICAgICAgICAgIGNvbnN0IHZlcmlmaWVkOiBhbnkgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1tZXRhJywgaW5mby51dWlkIHx8IGlkZW50aXR5KTtcbiAgICAgICAgICAgIGlmICh2ZXJpZmllZD8udXNlckRhdGE/LnVzZUNvbXByZXNzVGV4dHVyZSAhPT0gdHJ1ZSB8fCB2ZXJpZmllZD8udXNlckRhdGE/LnByZXNldElkICE9PSBwcmVzZXRJZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQXNzZXQgREIgYWNjZXB0ZWQgc2F2ZS1hc3NldC1tZXRhIGJ1dCB0aGUgY29tcHJlc3Npb24gc2V0dGluZ3MgZGlkIG5vdCBwZXJzaXN0LicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndXBkYXRlZCcsIHVybCwgdXVpZDogaW5mby51dWlkIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXR1czogJ2ZhaWxlZCcsIHVybDogaWRlbnRpdHksIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpIH07XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmxldCBzaGFyZWRQb2xpY3k6IFRleHR1cmVDb21wcmVzc2lvblBvbGljeSB8IG51bGwgPSBudWxsO1xubGV0IGF1dG9tYXRpb25TdGFydGVkID0gZmFsc2U7XG5sZXQgYm9vdHN0cmFwVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5jb25zdCBicm9hZGNhc3RMaXN0ZW5lcnM6IEFycmF5PFtzdHJpbmcsIChwYXlsb2FkOiBhbnkpID0+IHZvaWRdPiA9IFtdO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KCk6IFRleHR1cmVDb21wcmVzc2lvblBvbGljeSB7XG4gICAgc2hhcmVkUG9saWN5IHx8PSBuZXcgVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KCk7XG4gICAgcmV0dXJuIHNoYXJlZFBvbGljeTtcbn1cblxuZnVuY3Rpb24gbG9nQXV0b21hdGlvbkVycm9yKHNjb3BlOiBzdHJpbmcsIGVycm9yOiB1bmtub3duKTogdm9pZCB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICBjb25zb2xlLmVycm9yKGBbVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5XSAke3Njb3BlfTogJHttZXNzYWdlfWApO1xufVxuXG5mdW5jdGlvbiBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oYXR0ZW1wdCA9IDApOiB2b2lkIHtcbiAgICBjb25zdCBwb2xpY3kgPSBnZXRUZXh0dXJlQ29tcHJlc3Npb25Qb2xpY3koKTtcbiAgICBjb25zdCBkZWxheU1zID0gYXR0ZW1wdCA9PT0gMCA/IDUwMCA6IDEwMDA7XG4gICAgYm9vdHN0cmFwVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgYm9vdHN0cmFwVGltZXIgPSBudWxsO1xuICAgICAgICBpZiAoIWF1dG9tYXRpb25TdGFydGVkKSByZXR1cm47XG4gICAgICAgIHZvaWQgcG9saWN5LmVuZm9yY2VBbGwoKS50aGVuKChyZXBvcnQpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVGV4dHVyZUNvbXByZXNzaW9uUG9saWN5XSBwcmVzZXQ9JHtyZXBvcnQucHJlc2V0Lm5hbWV9IGVsaWdpYmxlPSR7cmVwb3J0LmVsaWdpYmxlfSB1cGRhdGVkPSR7cmVwb3J0LnVwZGF0ZWR9IHVuY2hhbmdlZD0ke3JlcG9ydC51bmNoYW5nZWR9IGZhaWxlZD0ke3JlcG9ydC5mYWlsZWR9YCk7XG4gICAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgICAgICAgIGlmICgvYXNzZXQgZGIgaXMgbm90IHJlYWR5L2kudGVzdChtZXNzYWdlKSAmJiBhdHRlbXB0IDwgMzAgJiYgYXV0b21hdGlvblN0YXJ0ZWQpIHtcbiAgICAgICAgICAgICAgICBzY2hlZHVsZUJvb3RzdHJhcFNjYW4oYXR0ZW1wdCArIDEpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxvZ0F1dG9tYXRpb25FcnJvcignc3RhcnR1cCBzY2FuJywgZXJyb3IpO1xuICAgICAgICB9KTtcbiAgICB9LCBkZWxheU1zKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0VGV4dHVyZUNvbXByZXNzaW9uQXV0b21hdGlvbigpOiB2b2lkIHtcbiAgICBpZiAoYXV0b21hdGlvblN0YXJ0ZWQpIHJldHVybjtcbiAgICBhdXRvbWF0aW9uU3RhcnRlZCA9IHRydWU7XG4gICAgY29uc3QgbWVzc2FnZUFwaTogYW55ID0gKEVkaXRvciBhcyBhbnkpLk1lc3NhZ2U7XG4gICAgY29uc3QgcG9saWN5ID0gZ2V0VGV4dHVyZUNvbXByZXNzaW9uUG9saWN5KCk7XG4gICAgaWYgKHR5cGVvZiBtZXNzYWdlQXBpPy5hZGRCcm9hZGNhc3RMaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBvbkFzc2V0ID0gKHBheWxvYWQ6IGFueSkgPT4ge1xuICAgICAgICAgICAgdm9pZCBwb2xpY3kuZW5mb3JjZUFzc2V0KHBheWxvYWQpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZmFpbGVkJykgbG9nQXV0b21hdGlvbkVycm9yKHJlc3VsdC51cmwgfHwgJ2Fzc2V0IGJyb2FkY2FzdCcsIHJlc3VsdC5lcnJvciB8fCAndW5rbm93biBmYWlsdXJlJyk7XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IGxvZ0F1dG9tYXRpb25FcnJvcignYXNzZXQgYnJvYWRjYXN0JywgZXJyb3IpKTtcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3Qgb25SZWFkeSA9ICgpID0+IHtcbiAgICAgICAgICAgIHZvaWQgcG9saWN5LmVuZm9yY2VBbGwoKS50aGVuKChyZXBvcnQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIXJlcG9ydC5jb21wbGV0ZSkgbG9nQXV0b21hdGlvbkVycm9yKCdhc3NldC1kYiByZWFkeSBzY2FuJywgYCR7cmVwb3J0LmZhaWxlZH0gdGV4dHVyZShzKSBmYWlsZWRgKTtcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4gbG9nQXV0b21hdGlvbkVycm9yKCdhc3NldC1kYiByZWFkeSBzY2FuJywgZXJyb3IpKTtcbiAgICAgICAgfTtcbiAgICAgICAgZm9yIChjb25zdCBldmVudCBvZiBbJ2Fzc2V0LWRiOmFzc2V0LWFkZCcsICdhc3NldC1kYjphc3NldC1jaGFuZ2UnXSkge1xuICAgICAgICAgICAgbWVzc2FnZUFwaS5hZGRCcm9hZGNhc3RMaXN0ZW5lcihldmVudCwgb25Bc3NldCk7XG4gICAgICAgICAgICBicm9hZGNhc3RMaXN0ZW5lcnMucHVzaChbZXZlbnQsIG9uQXNzZXRdKTtcbiAgICAgICAgfVxuICAgICAgICBtZXNzYWdlQXBpLmFkZEJyb2FkY2FzdExpc3RlbmVyKCdhc3NldC1kYjpyZWFkeScsIG9uUmVhZHkpO1xuICAgICAgICBicm9hZGNhc3RMaXN0ZW5lcnMucHVzaChbJ2Fzc2V0LWRiOnJlYWR5Jywgb25SZWFkeV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2FybignW1RleHR1cmVDb21wcmVzc2lvblBvbGljeV0gRWRpdG9yIGJyb2FkY2FzdCBsaXN0ZW5lcnMgYXJlIHVuYXZhaWxhYmxlOyB1c2UgYXNzZXRBZHZhbmNlZF9lbmZvcmNlX3RleHR1cmVfY29tcHJlc3Npb25fcG9saWN5IGZvciBleGlzdGluZyBhc3NldHMuJyk7XG4gICAgfVxuXG4gICAgc2NoZWR1bGVCb290c3RyYXBTY2FuKCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdG9wVGV4dHVyZUNvbXByZXNzaW9uQXV0b21hdGlvbigpOiB2b2lkIHtcbiAgICBpZiAoIWF1dG9tYXRpb25TdGFydGVkKSByZXR1cm47XG4gICAgYXV0b21hdGlvblN0YXJ0ZWQgPSBmYWxzZTtcbiAgICBpZiAoYm9vdHN0cmFwVGltZXIpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KGJvb3RzdHJhcFRpbWVyKTtcbiAgICAgICAgYm9vdHN0cmFwVGltZXIgPSBudWxsO1xuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlQXBpOiBhbnkgPSAoRWRpdG9yIGFzIGFueSkuTWVzc2FnZTtcbiAgICBpZiAodHlwZW9mIG1lc3NhZ2VBcGk/LnJlbW92ZUJyb2FkY2FzdExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGZvciAoY29uc3QgW2V2ZW50LCBsaXN0ZW5lcl0gb2YgYnJvYWRjYXN0TGlzdGVuZXJzKSBtZXNzYWdlQXBpLnJlbW92ZUJyb2FkY2FzdExpc3RlbmVyKGV2ZW50LCBsaXN0ZW5lcik7XG4gICAgfVxuICAgIGJyb2FkY2FzdExpc3RlbmVycy5sZW5ndGggPSAwO1xufVxuIl19