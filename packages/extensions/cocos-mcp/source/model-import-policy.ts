const DEFAULT_DIRECTORY = 'db://assets';
const FBX_EXTENSION = /\.fbx$/i;
const MAX_MODELS_PER_SCAN = 10_000;

export const PLAYABLE_FBX_IMPORT_SETTINGS = Object.freeze({
    meshOptimize: Object.freeze({ enable: true, vertexCache: true, vertexFetch: true, overdraw: true }),
    meshSimplify: Object.freeze({ enable: true, targetRatio: 0.8, autoErrorRate: false, errorRate: 1, lockBoundary: false }),
    meshCluster: Object.freeze({ enable: false, generateBounding: false }),
    meshCompress: Object.freeze({ enable: true, encode: false, compress: true, quantize: false }),
});

type ModelPolicyOptions = { directory?: string; dryRun?: boolean };
type ModelApplyResult = { status: 'updated' | 'unchanged' | 'skipped' | 'failed'; url: string; uuid?: string; error?: string };

export type ModelPolicyReport = {
    complete: boolean;
    dryRun: boolean;
    directory: string;
    settings: typeof PLAYABLE_FBX_IMPORT_SETTINGS;
    scanned: number;
    eligible: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
    failures: Array<{ url: string; error: string }>;
};

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

export function isFbxModelUrl(value: unknown): boolean {
    return FBX_EXTENSION.test(String(value || '').split(/[?#]/, 1)[0]);
}

export function hasPlayableFbxImportSettings(meta: any): boolean {
    const data = meta?.userData || {};
    const expected: any = PLAYABLE_FBX_IMPORT_SETTINGS;
    for (const section of Object.keys(expected)) {
        for (const [key, value] of Object.entries(expected[section])) {
            if (data?.[section]?.[key] !== value) return false;
        }
    }
    return true;
}

export function applyPlayableFbxImportSettings(meta: any): any {
    const next = deepClone(meta);
    next.userData ||= {};
    for (const [section, settings] of Object.entries<any>(PLAYABLE_FBX_IMPORT_SETTINGS)) {
        next.userData[section] = { ...(next.userData[section] || {}), ...settings };
    }
    return next;
}

export class ModelImportPolicy {
    private fullScan: Promise<ModelPolicyReport> | null = null;
    private readonly assetInFlight = new Set<string>();

    async enforceAll(options: ModelPolicyOptions = {}): Promise<ModelPolicyReport> {
        if (this.fullScan) return this.fullScan;
        this.fullScan = this.enforceAllInternal(options).finally(() => { this.fullScan = null; });
        return this.fullScan;
    }

    async enforceAsset(payload: any, options: ModelPolicyOptions = {}): Promise<ModelApplyResult> {
        const identity = assetIdentity(payload);
        if (!identity) return { status: 'skipped', url: '', error: 'Asset broadcast did not include a UUID or URL.' };
        if (this.assetInFlight.has(identity)) return { status: 'unchanged', url: identity };
        this.assetInFlight.add(identity);
        try {
            return await this.applyAsset(identity, Boolean(options.dryRun));
        } finally {
            this.assetInFlight.delete(identity);
        }
    }

    private async enforceAllInternal(options: ModelPolicyOptions): Promise<ModelPolicyReport> {
        const directory = String(options.directory || DEFAULT_DIRECTORY).replace(/\/$/, '');
        const dryRun = Boolean(options.dryRun);
        const ready = await Editor.Message.request('asset-db', 'query-ready');
        if (!ready) throw new Error('Cocos Asset DB is not ready; FBX model import policy was not applied.');
        const assets: any[] = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` });
        if (!Array.isArray(assets)) throw new Error('Cocos Asset DB returned an invalid model inventory.');
        if (assets.length > MAX_MODELS_PER_SCAN) throw new Error(`FBX policy scan exceeded the ${MAX_MODELS_PER_SCAN} asset safety budget.`);

        const report: ModelPolicyReport = {
            complete: false,
            dryRun,
            directory,
            settings: PLAYABLE_FBX_IMPORT_SETTINGS,
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
            if (!isFbxModelUrl(url)) {
                report.skipped += 1;
                continue;
            }
            report.eligible += 1;
            const result = await this.applyAsset(asset?.uuid || url, dryRun);
            if (result.status === 'updated') report.updated += 1;
            else if (result.status === 'unchanged') report.unchanged += 1;
            else if (result.status === 'skipped') report.skipped += 1;
            else {
                report.failed += 1;
                if (report.failures.length < 32) report.failures.push({ url: result.url || url, error: result.error || 'Unknown Asset DB failure' });
            }
        }
        report.complete = report.failed === 0 && report.eligible === report.updated + report.unchanged;
        return report;
    }

    private async applyAsset(identity: string, dryRun: boolean): Promise<ModelApplyResult> {
        try {
            const info: any = await Editor.Message.request('asset-db', 'query-asset-info', identity);
            const url = String(info?.url || info?.path || info?.source || identity);
            if (!info || info.isDirectory || !isFbxModelUrl(url)) return { status: 'skipped', url };
            const meta: any = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!meta || meta.importer !== 'fbx') {
                return { status: 'failed', url, uuid: info.uuid, error: 'Asset has .fbx extension but Cocos did not return FBX importer metadata.' };
            }
            if (hasPlayableFbxImportSettings(meta)) return { status: 'unchanged', url, uuid: info.uuid };
            if (dryRun) return { status: 'updated', url, uuid: info.uuid };

            const next = applyPlayableFbxImportSettings(meta);
            await Editor.Message.request('asset-db', 'save-asset-meta', info.uuid || identity, JSON.stringify(next, null, 2));
            const verified: any = await Editor.Message.request('asset-db', 'query-asset-meta', info.uuid || identity);
            if (!hasPlayableFbxImportSettings(verified)) throw new Error('Asset DB accepted save-asset-meta but the FBX settings did not persist.');
            return { status: 'updated', url, uuid: info.uuid };
        } catch (error: any) {
            return { status: 'failed', url: identity, error: error?.message || String(error) };
        }
    }
}

let sharedPolicy: ModelImportPolicy | null = null;
let automationStarted = false;
let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
const broadcastListeners: Array<[string, (payload: any) => void]> = [];

export function getModelImportPolicy(): ModelImportPolicy {
    sharedPolicy ||= new ModelImportPolicy();
    return sharedPolicy;
}

function logAutomationError(scope: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ModelImportPolicy] ${scope}: ${message}`);
}

function scheduleBootstrapScan(attempt = 0): void {
    const policy = getModelImportPolicy();
    const delayMs = attempt === 0 ? 700 : 1000;
    bootstrapTimer = setTimeout(() => {
        bootstrapTimer = null;
        if (!automationStarted) return;
        void policy.enforceAll().then((report) => {
            console.log(`[ModelImportPolicy] eligible=${report.eligible} updated=${report.updated} unchanged=${report.unchanged} failed=${report.failed}`);
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

export function startModelImportAutomation(): void {
    if (automationStarted) return;
    automationStarted = true;
    const messageApi: any = (Editor as any).Message;
    const policy = getModelImportPolicy();
    if (typeof messageApi?.addBroadcastListener === 'function') {
        const onAsset = (payload: any) => {
            void policy.enforceAsset(payload).then((result) => {
                if (result.status === 'failed') logAutomationError(result.url || 'asset broadcast', result.error || 'unknown failure');
            }).catch((error) => logAutomationError('asset broadcast', error));
        };
        const onReady = () => {
            void policy.enforceAll().then((report) => {
                if (!report.complete) logAutomationError('asset-db ready scan', `${report.failed} FBX model(s) failed`);
            }).catch((error) => logAutomationError('asset-db ready scan', error));
        };
        for (const event of ['asset-db:asset-add', 'asset-db:asset-change']) {
            messageApi.addBroadcastListener(event, onAsset);
            broadcastListeners.push([event, onAsset]);
        }
        messageApi.addBroadcastListener('asset-db:ready', onReady);
        broadcastListeners.push(['asset-db:ready', onReady]);
    } else {
        console.warn('[ModelImportPolicy] Editor broadcast listeners are unavailable; run npm run ai:model:optimize for existing FBX assets.');
    }
    scheduleBootstrapScan();
}

export function stopModelImportAutomation(): void {
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
