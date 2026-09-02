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

const SPINE_BACKENDS = ['spine-3.8', 'spine-4.2'] as const;
type SpineBackend = typeof SPINE_BACKENDS[number];

const PHYSICS_2D_BACKENDS = [
    'physics-2d-box2d',
    'physics-2d-box2d-wasm',
    'physics-2d-builtin',
    'physics-2d-box2d-jsb'
] as const;
type Physics2dBackend = typeof PHYSICS_2D_BACKENDS[number];

const OPTION_PARENT_FEATURES = new Set(['spine', 'physics-2d']);
const IMPORT_MAP_SILENT_FEATURES = new Set(['marionette']);

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
    // Cocos 3.8.8 exposes versioned cache IDs such as `spine-4.2`.
    // Dots are accepted only as separators between non-empty, lower-case
    // alphanumeric/hyphen segments; paths, traversal and arbitrary punctuation
    // remain invalid, and the profile cache is still the authority for names.
    return typeof value === 'string'
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(value);
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
        spineBackend: cache.spine?._option || null,
        physics2dBackend: cache['physics-2d']?._option || null,
        enabled: Object.keys(cache).filter((name) => cache[name]?._value === true).sort()
    };
}

function profileSelectionIncludes(snapshotValue: any, moduleName: string): boolean {
    if (snapshotValue.includeModules.includes(moduleName)) return true;
    if (!OPTION_PARENT_FEATURES.has(moduleName)) return false;
    const selected = moduleName === 'spine'
        ? snapshotValue.spineBackend
        : snapshotValue.physics2dBackend;
    return snapshotValue.enabled.includes(moduleName)
        && typeof selected === 'string'
        && snapshotValue.enabled.includes(selected)
        && snapshotValue.includeModules.includes(selected);
}

function appliedFeaturePresent(
    receipt: AppliedFeatureReceipt,
    moduleName: string,
    previewFresh: boolean,
    spineBackend?: SpineBackend
): boolean {
    if (receipt.features.includes(moduleName)) return true;
    if (IMPORT_MAP_SILENT_FEATURES.has(moduleName)) return previewFresh;
    if (moduleName === 'physics-2d') {
        return previewFresh && receipt.features.includes('physics-2d-framework');
    }
    return previewFresh
        && SPINE_BACKENDS.includes(moduleName as SpineBackend)
        && spineBackend === moduleName
        && receipt.features.includes('spine');
}

interface AppliedFeatureReceipt {
    available: boolean;
    features: string[];
    importMapSha256: string | null;
    importMapModifiedMs: number | null;
    source: string;
    error?: string;
}

function appliedSatisfies(
    receipt: AppliedFeatureReceipt,
    modules: string[],
    disabledModules: string[],
    physicsBackend?: PhysicsBackend,
    spineBackend?: SpineBackend,
    physics2dBackend?: Physics2dBackend,
    minimumAppliedModifiedMs?: number | null
): boolean {
    if (!receipt.available) return false;
    const previewFresh = Number.isFinite(receipt.importMapModifiedMs)
        && Number.isFinite(minimumAppliedModifiedMs)
        && Number(receipt.importMapModifiedMs) >= Number(minimumAppliedModifiedMs);
    if (modules.some((name) => !appliedFeaturePresent(receipt, name, previewFresh, spineBackend))) return false;
    if (disabledModules.some((name) => receipt.features.includes(name))) return false;
    if (physicsBackend && !receipt.features.includes(physicsBackend)) return false;
    if (spineBackend && !appliedFeaturePresent(receipt, spineBackend, previewFresh, spineBackend)) return false;
    return !physics2dBackend || receipt.features.includes(physics2dBackend);
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

    private async readProfileModifiedMs(): Promise<number | null> {
        const projectPath = (Editor as any).Project?.path;
        if (!projectPath) return null;
        const file = path.join(projectPath, 'settings', 'v2', 'packages', 'engine.json');
        return (await fs.stat(file).catch(() => null))?.mtimeMs || null;
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
        disabledModules: string[],
        physicsBackend: PhysicsBackend | undefined,
        spineBackend: SpineBackend | undefined,
        physics2dBackend: Physics2dBackend | undefined,
        timeoutMs: number,
        minimumAppliedModifiedMs?: number | null
    ): Promise<AppliedFeatureReceipt> {
        const deadline = Date.now() + timeoutMs;
        let receipt = await this.readAppliedPreviewFeatures();
        while (!appliedSatisfies(
            receipt,
            modules,
            disabledModules,
            physicsBackend,
            spineBackend,
            physics2dBackend,
            minimumAppliedModifiedMs
        ) && Date.now() < deadline) {
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
            const requestedDisabled: unknown[] = Array.isArray(args.disabledModules) ? args.disabledModules : [];
            if (!requested.every(validFeatureName)) {
                return { success: false, error: 'Every requested module must be a valid Cocos feature name.' };
            }
            if (!requestedDisabled.every(validFeatureName)) {
                return { success: false, error: 'Every disabled module must be a valid Cocos feature name.' };
            }
            const moduleSet = new Set(requested as string[]);
            const disabledModules = [...new Set(requestedDisabled as string[])];
            const physicsBackend = args.physicsBackend as PhysicsBackend | undefined;
            if (physicsBackend && !PHYSICS_BACKENDS.includes(physicsBackend)) {
                return { success: false, error: `Unsupported physics backend: ${physicsBackend}` };
            }
            const requestedSpineBackends = SPINE_BACKENDS.filter((backend) => moduleSet.has(backend));
            const explicitSpineBackend = args.spineBackend as SpineBackend | undefined;
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
            const explicitPhysics2dBackend = args.physics2dBackend as Physics2dBackend | undefined;
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
            const modules: string[] = [...moduleSet];
            const overlap = disabledModules.filter((moduleName) => moduleSet.has(moduleName));
            if (overlap.length) {
                return { success: false, error: `Features cannot be both required and disabled: ${overlap.join(', ')}` };
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
            for (const moduleName of disabledModules) {
                if (config.cache[moduleName]._value !== false) {
                    config.cache[moduleName]._value = false;
                    changed = true;
                }
                if (include.delete(moduleName)) changed = true;
            }

            if (spineBackend) {
                config.cache.spine ||= {};
                if (config.cache.spine._value !== true || config.cache.spine._option !== spineBackend) {
                    config.cache.spine._value = true;
                    config.cache.spine._option = spineBackend;
                    changed = true;
                }
                for (const backend of SPINE_BACKENDS) {
                    if (!knownModules.has(backend)) continue;
                    const selected = backend === spineBackend;
                    if (config.cache[backend]._value !== selected) {
                        config.cache[backend]._value = selected;
                        changed = true;
                    }
                    if (selected) include.add(backend);
                    else include.delete(backend);
                }
                include.delete('spine');
            }

            if (physics2dBackend) {
                config.cache['physics-2d'] ||= {};
                if (config.cache['physics-2d']._value !== true ||
                    config.cache['physics-2d']._option !== physics2dBackend) {
                    config.cache['physics-2d']._value = true;
                    config.cache['physics-2d']._option = physics2dBackend;
                    changed = true;
                }
                for (const backend of PHYSICS_2D_BACKENDS) {
                    if (!knownModules.has(backend)) continue;
                    const selected = backend === physics2dBackend;
                    if (config.cache[backend]._value !== selected) {
                        config.cache[backend]._value = selected;
                        changed = true;
                    }
                    if (selected) include.add(backend);
                    else include.delete(backend);
                }
                include.delete('physics-2d');
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
            const missing = modules.filter((name) => !profileSelectionIncludes(after, name));
            const unexpected = disabledModules.filter((name) =>
                after.includeModules.includes(name) || after.enabled.includes(name));
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
            const signature = createHash('sha256').update(JSON.stringify({
                modules: [...modules].sort(),
                disabledModules: [...disabledModules].sort(),
                physicsBackend: physicsBackend || null,
                spineBackend: spineBackend || null,
                physics2dBackend: physics2dBackend || null,
                includeModules: after.includeModules,
                configKey: after.configKey
            })).digest('hex');
            const pending = await this.readTransaction();

            if (!changed && appliedSatisfies(
                appliedBefore,
                modules,
                disabledModules,
                physicsBackend,
                spineBackend,
                physics2dBackend,
                profileModifiedMs
            )) {
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
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    }
}
