const DEFAULT_DIRECTORY = 'db://assets';
export const PLAYABLE_TRANSPARENT_PRESET_ID = '1fYG0h7MJDcp+zA2cMcUsR';
export const PLAYABLE_TRANSPARENT_PRESET_NAME = 'PlayableTransparent';
export const PLAYABLE_TRANSPARENT_WEBP_QUALITY = 50;

const TEXTURE_EXTENSION = /\.(?:png|jpe?g)$/i;
const MAX_TEXTURES_PER_SCAN = 20_000;

type TexturePolicyOptions = {
    directory?: string;
    presetId?: string;
    presetName?: string;
    quality?: number;
    dryRun?: boolean;
};

type TextureApplyResult = {
    status: 'updated' | 'unchanged' | 'skipped' | 'failed';
    url: string;
    uuid?: string;
    error?: string;
};

export type TexturePolicyReport = {
    complete: boolean;
    dryRun: boolean;
    directory: string;
    preset: {
        id: string;
        name: string;
        created: boolean;
        changed: boolean;
        webpQuality: number | string | null;
    };
    scanned: number;
    eligible: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
    failures: Array<{ url: string; error: string }>;
};

function normalizedPresetName(value: unknown): string {
    return String(value || '').replace(/[\s_-]+/g, '').toLowerCase();
}

export function isPlayableTextureUrl(value: unknown): boolean {
    return TEXTURE_EXTENSION.test(String(value || '').split(/[?#]/, 1)[0]);
}

export function normalizeWebpQuality(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return PLAYABLE_TRANSPARENT_WEBP_QUALITY;
    const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(1, Math.min(100, Math.round(percent)));
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value ?? {}));
}

function assetIdentity(payload: any): string | null {
    if (typeof payload === 'string') return payload;
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const identity = assetIdentity(item);
            if (identity) return identity;
        }
        return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    return payload.uuid || payload.url || payload.path || payload.source || null;
}

export class TextureCompressionPolicy {
    private fullScan: Promise<TexturePolicyReport> | null = null;
    private readonly assetInFlight = new Set<string>();

    async enforceAll(options: TexturePolicyOptions = {}): Promise<TexturePolicyReport> {
        if (this.fullScan) return this.fullScan;
        this.fullScan = this.enforceAllInternal(options).finally(() => {
            this.fullScan = null;
        });
        return this.fullScan;
    }

    async enforceAsset(payload: any, options: TexturePolicyOptions = {}): Promise<TextureApplyResult> {
        const identity = assetIdentity(payload);
        if (!identity) return { status: 'skipped', url: '', error: 'Asset broadcast did not include a UUID or URL.' };
        if (this.assetInFlight.has(identity)) return { status: 'unchanged', url: identity };
        this.assetInFlight.add(identity);
        try {
            const preset = await this.ensurePreset(options);
            return await this.applyAsset(identity, preset.id, Boolean(options.dryRun));
        } catch (error: any) {
            return { status: 'failed', url: identity, error: error?.message || String(error) };
        } finally {
            this.assetInFlight.delete(identity);
        }
    }

    private async enforceAllInternal(options: TexturePolicyOptions): Promise<TexturePolicyReport> {
        const directory = String(options.directory || DEFAULT_DIRECTORY).replace(/\/$/, '');
        const dryRun = Boolean(options.dryRun);
        const ready = await Editor.Message.request('asset-db', 'query-ready');
        if (!ready) throw new Error('Cocos Asset DB is not ready; texture compression policy was not applied.');

        const preset = await this.ensurePreset(options);
        const assets: any[] = await Editor.Message.request('asset-db', 'query-assets', {
            pattern: `${directory}/**/*`,
        });
        if (!Array.isArray(assets)) throw new Error('Cocos Asset DB returned an invalid texture inventory.');
        if (assets.length > MAX_TEXTURES_PER_SCAN) {
            throw new Error(`Texture policy scan exceeded the ${MAX_TEXTURES_PER_SCAN} asset safety budget.`);
        }

        const report: TexturePolicyReport = {
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
            const url = String(asset?.url || asset?.path || asset?.source || '');
            if (!isPlayableTextureUrl(url)) {
                report.skipped += 1;
                continue;
            }
            report.eligible += 1;
            const result = await this.applyAsset(asset?.uuid || url, preset.id, dryRun);
            if (result.status === 'updated') report.updated += 1;
            else if (result.status === 'unchanged') report.unchanged += 1;
            else if (result.status === 'skipped') report.skipped += 1;
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

    private async ensurePreset(options: TexturePolicyOptions): Promise<TexturePolicyReport['preset']> {
        const profileApi: any = (Editor as any).Profile;
        if (!profileApi?.getProject || !profileApi?.setProject) {
            throw new Error('Editor.Profile project API is unavailable; cannot ensure texture compression preset.');
        }
        const requestedName = String(options.presetName || PLAYABLE_TRANSPARENT_PRESET_NAME).trim() || PLAYABLE_TRANSPARENT_PRESET_NAME;
        const requestedId = String(options.presetId || PLAYABLE_TRANSPARENT_PRESET_ID).trim() || PLAYABLE_TRANSPARENT_PRESET_ID;
        const quality = normalizeWebpQuality(options.quality);
        const current = deepClone(await profileApi.getProject('builder', 'textureCompressConfig') || {});
        current.userPreset ||= {};

        let id = '';
        let entry: any = null;
        const requestedEntry = current.userPreset[requestedId];
        if (requestedEntry?.name && normalizedPresetName(requestedEntry.name) === normalizedPresetName(requestedName)) {
            id = requestedId;
            entry = requestedEntry;
        } else {
            const wanted = normalizedPresetName(requestedName);
            for (const [candidateId, candidate] of Object.entries<any>(current.userPreset)) {
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
        } else {
            const currentWeb = entry?.options?.web;
            const keys = currentWeb && typeof currentWeb === 'object' ? Object.keys(currentWeb) : [];
            const currentQuality = normalizeWebpQuality(currentWeb?.webp?.quality);
            if (keys.length !== 1 || keys[0] !== 'webp' || currentQuality !== quality) {
                entry.options ||= {};
                entry.options.web = { webp: { quality } };
                changed = true;
            }
        }

        if (changed && !options.dryRun) {
            await profileApi.setProject('builder', 'textureCompressConfig', current);
            const verified = await profileApi.getProject('builder', 'textureCompressConfig');
            const verifiedEntry = verified?.userPreset?.[id];
            const verifiedWeb = verifiedEntry?.options?.web;
            if (!verifiedEntry
                || Object.keys(verifiedWeb || {}).length !== 1
                || !verifiedWeb?.webp
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
            webpQuality: entry?.options?.web?.webp?.quality ?? null,
        };
    }

    private async applyAsset(identity: string, presetId: string, dryRun: boolean): Promise<TextureApplyResult> {
        try {
            const info: any = await Editor.Message.request('asset-db', 'query-asset-info', identity);
            const url = String(info?.url || info?.path || info?.source || identity);
            if (!info || info.isDirectory || !isPlayableTextureUrl(url)) return { status: 'skipped', url };
            const meta: any = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!meta || meta.importer !== 'image') {
                return { status: 'failed', url, uuid: info.uuid, error: 'Asset is a PNG/JPG/JPEG but Cocos did not return image importer metadata.' };
            }
            if (meta.userData?.useCompressTexture === true && meta.userData?.presetId === presetId) {
                return { status: 'unchanged', url, uuid: info.uuid };
            }
            if (dryRun) return { status: 'updated', url, uuid: info.uuid };

            const next = deepClone(meta);
            next.userData ||= {};
            next.userData.useCompressTexture = true;
            next.userData.presetId = presetId;
            await Editor.Message.request('asset-db', 'save-asset-meta', info.uuid || identity, JSON.stringify(next, null, 2));
            const verified: any = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (verified?.userData?.useCompressTexture !== true || verified?.userData?.presetId !== presetId) {
                throw new Error('Asset DB accepted save-asset-meta but the compression settings did not persist.');
            }
            return { status: 'updated', url, uuid: info.uuid };
        } catch (error: any) {
            return { status: 'failed', url: identity, error: error?.message || String(error) };
        }
    }
}

let sharedPolicy: TextureCompressionPolicy | null = null;
let automationStarted = false;
let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
const broadcastListeners: Array<[string, (payload: any) => void]> = [];

export function getTextureCompressionPolicy(): TextureCompressionPolicy {
    sharedPolicy ||= new TextureCompressionPolicy();
    return sharedPolicy;
}

function logAutomationError(scope: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TextureCompressionPolicy] ${scope}: ${message}`);
}

function scheduleBootstrapScan(attempt = 0): void {
    const policy = getTextureCompressionPolicy();
    const delayMs = attempt === 0 ? 500 : 1000;
    bootstrapTimer = setTimeout(() => {
        bootstrapTimer = null;
        if (!automationStarted) return;
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

export function startTextureCompressionAutomation(): void {
    if (automationStarted) return;
    automationStarted = true;
    const messageApi: any = (Editor as any).Message;
    const policy = getTextureCompressionPolicy();
    if (typeof messageApi?.addBroadcastListener === 'function') {
        const onAsset = (payload: any) => {
            void policy.enforceAsset(payload).then((result) => {
                if (result.status === 'failed') logAutomationError(result.url || 'asset broadcast', result.error || 'unknown failure');
            }).catch((error) => logAutomationError('asset broadcast', error));
        };
        const onReady = () => {
            void policy.enforceAll().then((report) => {
                if (!report.complete) logAutomationError('asset-db ready scan', `${report.failed} texture(s) failed`);
            }).catch((error) => logAutomationError('asset-db ready scan', error));
        };
        for (const event of ['asset-db:asset-add', 'asset-db:asset-change']) {
            messageApi.addBroadcastListener(event, onAsset);
            broadcastListeners.push([event, onAsset]);
        }
        messageApi.addBroadcastListener('asset-db:ready', onReady);
        broadcastListeners.push(['asset-db:ready', onReady]);
    } else {
        console.warn('[TextureCompressionPolicy] Editor broadcast listeners are unavailable; use assetAdvanced_enforce_texture_compression_policy for existing assets.');
    }

    scheduleBootstrapScan();
}

export function stopTextureCompressionAutomation(): void {
    if (!automationStarted) return;
    automationStarted = false;
    if (bootstrapTimer) {
        clearTimeout(bootstrapTimer);
        bootstrapTimer = null;
    }
    const messageApi: any = (Editor as any).Message;
    if (typeof messageApi?.removeBroadcastListener === 'function') {
        for (const [event, listener] of broadcastListeners) messageApi.removeBroadcastListener(event, listener);
    }
    broadcastListeners.length = 0;
}
