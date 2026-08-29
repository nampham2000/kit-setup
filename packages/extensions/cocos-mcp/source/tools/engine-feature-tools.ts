import { ToolDefinition, ToolExecutor, ToolResponse } from '../types';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

const PHYSICS_BACKENDS = [
    'physics-builtin',
    'physics-cannon',
    'physics-ammo',
    'physics-physx'
] as const;

type PhysicsBackend = typeof PHYSICS_BACKENDS[number];

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function validFeatureName(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function activeConfig(profile: any): any {
    const key = profile?.globalConfigKey || 'defaultConfig';
    const config = profile?.configs?.[key];
    if (!config || typeof config !== 'object') {
        throw new Error(`Engine feature profile is missing configs.${key}`);
    }
    config.cache ||= {};
    config.includeModules ||= [];
    return config;
}

function snapshot(profile: any): any {
    const key = profile?.globalConfigKey || 'defaultConfig';
    const config = activeConfig(profile);
    const cache = config.cache || {};
    return {
        configKey: key,
        includeModules: [...(config.includeModules || [])],
        physicsBackend: cache.physics?._option || null,
        enabled: Object.keys(cache).filter((name) => cache[name]?._value === true).sort()
    };
}

interface AppliedFeatureReceipt {
    available: boolean;
    features: string[];
    importMapSha256: string | null;
    importMapModifiedMs: number | null;
    source: string;
    error?: string;
}

function appliedSatisfies(receipt: AppliedFeatureReceipt, modules: string[], physicsBackend?: PhysicsBackend): boolean {
    if (!receipt.available) return false;
    if (modules.some((name) => !receipt.features.includes(name))) return false;
    return !physicsBackend || receipt.features.includes(physicsBackend);
}

export class EngineFeatureTools implements ToolExecutor {
    getTools(): ToolDefinition[] {
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

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        if (toolName === 'get_features') return this.getFeatures();
        if (toolName === 'ensure_features') return this.ensureFeatures(args || {});
        return { success: false, error: `Unknown engineFeature tool: ${toolName}` };
    }

    private async readProfile(): Promise<any> {
        const profileApi: any = (Editor as any).Profile;
        if (!profileApi?.getProject) throw new Error('Editor.Profile.getProject is unavailable');
        const profile = await profileApi.getProject('engine', 'modules');
        if (!profile) throw new Error('Cocos returned an empty engine Feature Cropping profile');
        return profile;
    }

    private async getFeatures(): Promise<ToolResponse> {
        try {
            return {
                success: true,
                data: {
                    ...snapshot(await this.readProfile()),
                    appliedPreview: await this.readAppliedPreviewFeatures()
                }
            };
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    }

    private async readAppliedPreviewFeatures(): Promise<AppliedFeatureReceipt> {
        const source = 'temp/programming/packer-driver/targets/preview/import-map.json';
        const projectTmpDir = (Editor as any).Project?.tmpDir;
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
                fs.readFile(importMapPath, 'utf8'),
                fs.stat(importMapPath)
            ]);
            const parsed = JSON.parse(raw);
            const features = new Set<string>();
            for (const scope of Object.values(parsed?.scopes || {})) {
                if (!scope || typeof scope !== 'object') continue;
                for (const value of Object.values(scope as Record<string, unknown>)) {
                    if (typeof value !== 'string') continue;
                    const prefix = 'cce:/internal/x/cc-fu/';
                    if (value.startsWith(prefix)) features.add(value.slice(prefix.length));
                }
            }
            return {
                available: true,
                features: [...features].sort(),
                importMapSha256: createHash('sha256').update(raw).digest('hex'),
                importMapModifiedMs: stat.mtimeMs,
                source
            };
        } catch (error: any) {
            return {
                available: false,
                features: [],
                importMapSha256: null,
                importMapModifiedMs: null,
                source,
                error: error?.message || String(error)
            };
        }
    }

    private transactionPath(): string | null {
        const projectTmpDir = (Editor as any).Project?.tmpDir;
        return projectTmpDir ? path.join(projectTmpDir, 'cocos-mcp', 'engine-feature-transaction.json') : null;
    }

    private async readTransaction(): Promise<any | null> {
        const file = this.transactionPath();
        if (!file) return null;
        try {
            return JSON.parse(await fs.readFile(file, 'utf8'));
        } catch {
            return null;
        }
    }

    private async writeTransaction(value: any): Promise<void> {
        const file = this.transactionPath();
        if (!file) throw new Error('Editor.Project.tmpDir is unavailable for the engine feature transaction receipt');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }

    private async clearTransaction(): Promise<void> {
        const file = this.transactionPath();
        if (file) await fs.unlink(file).catch(() => undefined);
    }

    private async waitForAppliedFeatures(
        modules: string[],
        physicsBackend: PhysicsBackend | undefined,
        timeoutMs: number
    ): Promise<AppliedFeatureReceipt> {
        const deadline = Date.now() + timeoutMs;
        let receipt = await this.readAppliedPreviewFeatures();
        while (!appliedSatisfies(receipt, modules, physicsBackend) && Date.now() < deadline) {
            await sleep(500);
            receipt = await this.readAppliedPreviewFeatures();
        }
        return receipt;
    }

    private async rebuildEngineAndWait(timeoutMs: number): Promise<any> {
        const messageApi: any = (Editor as any).Message;
        let versionFile: string | null = null;
        let versionMtimeBefore = 0;
        try {
            const engineInfo: any = await withTimeout(
                messageApi.request('engine', 'query-info'),
                10000,
                'engine info query'
            );
            const enginePath = engineInfo?.path;
            if (typeof enginePath === 'string' && enginePath) {
                versionFile = path.join(enginePath, 'bin', '.cache', 'dev', 'VERSION');
                versionMtimeBefore = (await fs.stat(versionFile).catch(() => null))?.mtimeMs || 0;
            }
        } catch {
            // The bounded project log receipt below remains available as a fallback.
        }

        const projectPath = (Editor as any).Project?.path;
        const projectLog = projectPath ? path.join(projectPath, 'temp', 'logs', 'project.log') : null;
        const projectLogSizeBefore = projectLog
            ? ((await fs.stat(projectLog).catch(() => null))?.size || 0)
            : 0;
        const startedAt = Date.now();
        let requestSettled = false;
        let requestError: any = null;

        // Cocos 3.8.8 can finish Quick Compile but leave the message request
        // unresolved while the engine consumer is being replaced. Observe the
        // compiler's own VERSION/log receipt instead of hanging the MCP request.
        void messageApi.request('engine', 'rebuild').then(
            () => { requestSettled = true; },
            (error: any) => { requestSettled = true; requestError = error; }
        );

        const deadline = startedAt + timeoutMs;
        while (Date.now() < deadline) {
            if (versionFile) {
                const stat = await fs.stat(versionFile).catch(() => null);
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
                    const log = await fs.readFile(projectLog);
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
                } catch {
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

    private async ensureFeatures(args: any): Promise<ToolResponse> {
        try {
            const requested: unknown[] = Array.isArray(args.modules) ? args.modules : [];
            if (!requested.every(validFeatureName)) {
                return { success: false, error: 'Every requested module must be a valid Cocos feature name.' };
            }
            const modules: string[] = [...new Set(requested as string[])];
            const physicsBackend = args.physicsBackend as PhysicsBackend | undefined;
            if (physicsBackend && !PHYSICS_BACKENDS.includes(physicsBackend)) {
                return { success: false, error: `Unsupported physics backend: ${physicsBackend}` };
            }

            const beforeProfile = await this.readProfile();
            const before = snapshot(beforeProfile);
            const next = clone(beforeProfile);
            const config = activeConfig(next);
            const include = new Set<string>(config.includeModules || []);
            // A module is writable only when the current Creator profile exposes
            // its cache record. includeModules is selection state, not a schema;
            // trusting an orphan include entry would dereference/insert blindly.
            const knownModules = new Set<string>(Object.keys(config.cache || {}));
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
                config.cache.physics ||= {};
                if (config.cache.physics._value !== true || config.cache.physics._option !== physicsBackend) {
                    config.cache.physics._value = true;
                    config.cache.physics._option = physicsBackend;
                    changed = true;
                }
                for (const backend of PHYSICS_BACKENDS) {
                    if (!knownModules.has(backend)) continue;
                    const selected = backend === physicsBackend;
                    if (config.cache[backend]._value !== selected) {
                        config.cache[backend]._value = selected;
                        changed = true;
                    }
                    if (selected) include.add(backend);
                    else include.delete(backend);
                }
            }

            const ordered = [...include].sort();
            if (JSON.stringify(ordered) !== JSON.stringify(config.includeModules)) changed = true;
            config.includeModules = ordered;

            const reloadRequested = args.reload !== false;
            const timeoutMs = Math.min(300000, Math.max(1000, Number(args.timeoutMs) || 240000));
            const profileApi: any = (Editor as any).Profile;

            if (changed) {
                if (!profileApi?.setProject) throw new Error('Editor.Profile.setProject is unavailable');
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
            const signature = createHash('sha256').update(JSON.stringify({
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
            const matchingPending = pending?.signature === signature
                && (pending?.status === 'restart-required' || pending?.status === 'editor-relaunch-scheduled');
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
                        transaction: { ...pending, recovered: true, externalRestartRequired: true }
                    }
                };
            }

            // Protect unsaved scene work before scheduling an Editor relaunch.
            let sceneWasDirty = false;
            try {
                const dirtyResult: any = await withTimeout(
                    (Editor as any).Message.request('scene', 'query-dirty'),
                    10000,
                    'scene dirty query'
                );
                sceneWasDirty = Boolean(dirtyResult?.dirty ?? dirtyResult);
                if (sceneWasDirty) {
                    await withTimeout(
                        (Editor as any).Message.request('scene', 'save-scene'),
                        30000,
                        'scene save before Editor relaunch'
                    );
                }
            } catch (error: any) {
                return {
                    success: false,
                    error: `Refusing to relaunch Cocos Editor because the current scene could not be safely checked/saved: ${error?.message || String(error)}`,
                    data: { complete: false, status: 'scene-save-preflight-failed', changed, before, after, appliedBefore }
                };
            }

            const rebuildStartedAt = Date.now();
            let engineRebuild: any;
            try {
                engineRebuild = await this.rebuildEngineAndWait(timeoutMs);
            } catch (error: any) {
                return {
                    success: false,
                    error: `Cocos could not rebuild the cropped engine: ${error?.message || String(error)}`,
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
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    }
}
