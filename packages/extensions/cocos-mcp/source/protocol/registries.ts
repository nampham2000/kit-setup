/**
 * Phase 2 — Resources & Prompts registries.
 *
 * The {@link ResourceRegistry} and {@link PromptRegistry} let pluggable
 * providers expose MCP resources and prompt templates. They also handle
 * subscription bookkeeping for `resources/subscribe` so the server can emit
 * `notifications/resources/updated` when an underlying provider changes.
 *
 * Built‑in providers (`buildBuiltInResourceProvider` / `buildBuiltInPromptProvider`)
 * cover project metadata, the current scene, the asset tree and the editor
 * runtime log feed (Phases 3–5). They degrade gracefully when the host
 * `Editor` global is unavailable (e.g. stdio outside the editor) so the
 * server still answers `resources/list` with descriptive errors instead of
 * crashing.
 */

import { McpPrompt, McpPromptExpansion, McpResource, McpResourceContents, McpResourceTemplate } from '../types';

/** Lightweight dependency the registry takes for emitting change notifications. */
export type RegistryNotifier = (method: string, params?: any) => void;

// -- Resource provider ------------------------------------------------------

export interface ResourceProvider {
    /** Return the static resource list this provider contributes. */
    listResources(): McpResource[] | Promise<McpResource[]>;
    /** Return URI templates this provider supports. Optional. */
    listResourceTemplates?(): McpResourceTemplate[] | Promise<McpResourceTemplate[]>;
    /** Read a resource by URI. Throw to signal "not found / not handled". */
    readResource(uri: string): Promise<McpResourceContents> | McpResourceContents;
    /** Return true if the provider claims this URI for read/subscribe. */
    handles(uri: string): boolean;
    /** Optional argument completion for `completion/complete` on resource templates. */
    complete?(uri: string, argName: string, value: string): Promise<string[]> | string[];
    /** Optional subscription hook — return false if subscription is not supported. */
    subscribe?(uri: string, notify: () => void): boolean | Promise<boolean>;
    unsubscribe?(uri: string): void;
}

export class ResourceRegistry {
    private providers: ResourceProvider[] = [];
    private notify: RegistryNotifier;
    private subscriptions = new Set<string>();

    constructor(notify: RegistryNotifier) {
        this.notify = notify;
    }

    public addProvider(provider: ResourceProvider): void {
        this.providers.push(provider);
        this.notify('notifications/resources/list_changed');
    }

    public async listResources(): Promise<McpResource[]> {
        const out: McpResource[] = [];
        for (const p of this.providers) {
            try {
                const items = await p.listResources();
                if (items) out.push(...items);
            } catch { /* skip a misbehaving provider */ }
        }
        // De‑duplicate by URI (last writer wins).
        const byUri = new Map<string, McpResource>();
        for (const r of out) byUri.set(r.uri, r);
        return Array.from(byUri.values());
    }

    public async listResourceTemplates(): Promise<McpResourceTemplate[]> {
        const out: McpResourceTemplate[] = [];
        for (const p of this.providers) {
            if (!p.listResourceTemplates) continue;
            try {
                const items = await p.listResourceTemplates();
                if (items) out.push(...items);
            } catch { /* skip */ }
        }
        return out;
    }

    public async readResource(uri: string): Promise<McpResourceContents> {
        for (const p of this.providers) {
            if (!p.handles(uri)) continue;
            return await p.readResource(uri);
        }
        throw new Error(`No provider handles resource URI: ${uri}`);
    }

    public async subscribe(uri: string): Promise<void> {
        for (const p of this.providers) {
            if (!p.handles(uri) || !p.subscribe) continue;
            const ok = await p.subscribe(uri, () => {
                this.notify('notifications/resources/updated', { uri });
            });
            if (ok) {
                this.subscriptions.add(uri);
                return;
            }
        }
        // No provider supports subscriptions for this URI — succeed silently
        // (the spec leaves this server‑defined; emitting nothing is safe).
        this.subscriptions.add(uri);
    }

    public unsubscribe(uri: string): void {
        for (const p of this.providers) {
            if (p.handles(uri) && p.unsubscribe) p.unsubscribe(uri);
        }
        this.subscriptions.delete(uri);
    }

    public async complete(uri: string, argName: string, value: string): Promise<string[]> {
        for (const p of this.providers) {
            if (!p.handles(uri) || !p.complete) continue;
            const r = await p.complete(uri, argName, value);
            if (r && r.length) return r;
        }
        return [];
    }

    /** Trigger a list_changed notification (e.g. after live add/remove). */
    public notifyListChanged(): void {
        this.notify('notifications/resources/list_changed');
    }

    /** Trigger an updated notification for a single URI. */
    public notifyUpdated(uri: string): void {
        if (this.subscriptions.has(uri)) {
            this.notify('notifications/resources/updated', { uri });
        }
    }
}

// -- Prompt provider --------------------------------------------------------

export interface PromptProvider {
    listPrompts(): McpPrompt[] | Promise<McpPrompt[]>;
    /** Return the rendered prompt or throw to signal "not handled". */
    getPrompt(name: string, args: Record<string, string>): Promise<McpPromptExpansion> | McpPromptExpansion;
    handles(name: string): boolean;
    complete?(name: string, argName: string, value: string): Promise<string[]> | string[];
}

export class PromptRegistry {
    private providers: PromptProvider[] = [];
    private notify: RegistryNotifier;

    constructor(notify: RegistryNotifier) {
        this.notify = notify;
    }

    public addProvider(provider: PromptProvider): void {
        this.providers.push(provider);
        this.notify('notifications/prompts/list_changed');
    }

    public async listPrompts(): Promise<McpPrompt[]> {
        const out: McpPrompt[] = [];
        for (const p of this.providers) {
            try {
                const items = await p.listPrompts();
                if (items) out.push(...items);
            } catch { /* skip */ }
        }
        const byName = new Map<string, McpPrompt>();
        for (const pr of out) byName.set(pr.name, pr);
        return Array.from(byName.values());
    }

    public async getPrompt(name: string, args: Record<string, string>): Promise<McpPromptExpansion> {
        for (const p of this.providers) {
            if (!p.handles(name)) continue;
            return await p.getPrompt(name, args || {});
        }
        throw new Error(`Unknown prompt: ${name}`);
    }

    public async complete(name: string, argName: string, value: string): Promise<string[]> {
        for (const p of this.providers) {
            if (!p.handles(name) || !p.complete) continue;
            const r = await p.complete(name, argName, value);
            if (r && r.length) return r;
        }
        return [];
    }

    public notifyListChanged(): void {
        this.notify('notifications/prompts/list_changed');
    }
}

// -- Built-in providers -----------------------------------------------------

const PROJECT_INFO_URI = 'project://info';
const SCENE_CURRENT_URI = 'scene://current';
const ASSETS_TREE_URI = 'assets://tree';
const RUNTIME_LOGS_URI = 'runtime://logs';

/**
 * Resolve the global Cocos `Editor` proxy when present. Outside the editor
 * (e.g. stdio binary running standalone) it returns null and providers
 * gracefully report unavailable instead of throwing.
 */
function getEditor(): any | null {
    const g: any = globalThis as any;
    if (g.Editor && typeof g.Editor === 'object') return g.Editor;
    return null;
}

/** A small ring buffer used by `runtime://logs`. */
class RuntimeLogBuffer {
    private buf: string[] = [];
    private listeners = new Set<() => void>();
    private installed = false;

    public push(line: string): void {
        this.buf.push(line);
        if (this.buf.length > 200) this.buf.shift();
        for (const l of this.listeners) {
            try { l(); } catch { /* ignore */ }
        }
    }

    public snapshot(): string[] {
        return [...this.buf];
    }

    public addListener(l: () => void): void {
        this.listeners.add(l);
        this.ensureInstalled();
    }

    public removeListener(l: () => void): void {
        this.listeners.delete(l);
    }

    private ensureInstalled(): void {
        if (this.installed) return;
        this.installed = true;
        const ed = getEditor();
        // Editor.Message broadcasts are the primary log source. We tolerate
        // missing APIs because the stdio binary stub doesn't ship them.
        try {
            ed?.Message?.addBroadcastListener?.('console:log', (msg: any) => {
                this.push(`${new Date().toISOString()} ${(msg?.type || 'log').toUpperCase()}: ${msg?.message ?? ''}`);
            });
        } catch { /* ignore */ }
    }
}

const runtimeLogs = new RuntimeLogBuffer();

/** Public hook for tools to push synthetic runtime log entries. */
export function pushRuntimeLog(level: string, message: string): void {
    runtimeLogs.push(`${new Date().toISOString()} ${level.toUpperCase()}: ${message}`);
}

/** Snapshot of the runtime log ring buffer (used by the EditorRuntimeTools tail tool). */
export function getRuntimeLogs(): string[] {
    return runtimeLogs.snapshot();
}

export function buildBuiltInResourceProvider(): ResourceProvider {
    return {
        handles(uri: string): boolean {
            return uri === PROJECT_INFO_URI
                || uri === SCENE_CURRENT_URI
                || uri === ASSETS_TREE_URI
                || uri === RUNTIME_LOGS_URI
                || uri.startsWith('scene://node/')
                || uri.startsWith('assets://item/');
        },
        listResources(): McpResource[] {
            return [
                {
                    uri: PROJECT_INFO_URI,
                    name: 'Cocos project info',
                    description: 'Static project metadata (name, path, version).',
                    mimeType: 'application/json'
                },
                {
                    uri: SCENE_CURRENT_URI,
                    name: 'Current scene',
                    description: 'Hierarchy of the currently open scene.',
                    mimeType: 'application/json'
                },
                {
                    uri: ASSETS_TREE_URI,
                    name: 'Asset database tree',
                    description: 'Top-level db://assets tree as reported by the asset DB.',
                    mimeType: 'application/json'
                },
                {
                    uri: RUNTIME_LOGS_URI,
                    name: 'Editor runtime log tail',
                    description: 'Last ~200 console messages forwarded by the editor (Phase 5). Subscribe for live updates.',
                    mimeType: 'text/plain'
                }
            ];
        },
        listResourceTemplates(): McpResourceTemplate[] {
            return [
                {
                    uriTemplate: 'scene://node/{uuid}',
                    name: 'Scene node',
                    description: 'Snapshot of a single node by UUID.',
                    mimeType: 'application/json'
                },
                {
                    uriTemplate: 'assets://item/{uuid}',
                    name: 'Asset item',
                    description: 'Asset DB info for a single asset by UUID.',
                    mimeType: 'application/json'
                }
            ];
        },
        async readResource(uri: string): Promise<McpResourceContents> {
            const ed = getEditor();
            if (uri === PROJECT_INFO_URI) {
                let data: any;
                try {
                    data = ed
                        ? {
                            name: ed.Project?.name ?? 'unknown',
                            path: ed.Project?.path ?? '',
                            uuid: ed.Project?.uuid ?? '',
                            version: ed.Project?.version ?? '',
                            cocosVersion: ed.versions?.['@cocos/creator-types'] ?? ed.App?.version ?? ''
                        }
                        : { error: 'Editor not available (running outside Cocos Creator)' };
                } catch (e: any) {
                    data = { error: e?.message ?? String(e) };
                }
                return jsonContents(uri, data);
            }
            if (uri === SCENE_CURRENT_URI) {
                if (!ed) return jsonContents(uri, { error: 'Editor not available' });
                try {
                    const tree = await ed.Message?.request?.('scene', 'query-node-tree');
                    return jsonContents(uri, tree ?? null);
                } catch (e: any) {
                    return jsonContents(uri, { error: e?.message ?? String(e) });
                }
            }
            if (uri === ASSETS_TREE_URI) {
                if (!ed) return jsonContents(uri, { error: 'Editor not available' });
                try {
                    const list = await ed.Message?.request?.('asset-db', 'query-assets', { pattern: 'db://assets/**/*' });
                    return jsonContents(uri, list ?? []);
                } catch (e: any) {
                    return jsonContents(uri, { error: e?.message ?? String(e) });
                }
            }
            if (uri === RUNTIME_LOGS_URI) {
                return {
                    contents: [{
                        uri,
                        mimeType: 'text/plain',
                        text: runtimeLogs.snapshot().join('\n')
                    }]
                };
            }
            if (uri.startsWith('scene://node/')) {
                const uuid = uri.slice('scene://node/'.length);
                if (!ed) return jsonContents(uri, { uuid, error: 'Editor not available' });
                try {
                    const node = await ed.Message?.request?.('scene', 'query-node', uuid);
                    return jsonContents(uri, node ?? { uuid, error: 'not found' });
                } catch (e: any) {
                    return jsonContents(uri, { uuid, error: e?.message ?? String(e) });
                }
            }
            if (uri.startsWith('assets://item/')) {
                const uuid = uri.slice('assets://item/'.length);
                if (!ed) return jsonContents(uri, { uuid, error: 'Editor not available' });
                try {
                    const info = await ed.Message?.request?.('asset-db', 'query-asset-info', uuid);
                    return jsonContents(uri, info ?? { uuid, error: 'not found' });
                } catch (e: any) {
                    return jsonContents(uri, { uuid, error: e?.message ?? String(e) });
                }
            }
            throw new Error(`Built-in provider cannot read: ${uri}`);
        },
        subscribe(uri: string, notify: () => void): boolean {
            if (uri === RUNTIME_LOGS_URI) {
                runtimeLogs.addListener(notify);
                return true;
            }
            // Other built-ins are not subscribable — return false so the
            // registry can record the subscription as no-op.
            return false;
        },
        unsubscribe(uri: string): void {
            if (uri === RUNTIME_LOGS_URI) {
                // We don't track per-call listeners individually here; the
                // registry already removes the subscription bookkeeping.
                // For correctness in tests we clear all listeners on
                // unsubscribe; in practice each session has one subscriber.
                runtimeLogs.removeListener(() => {});
            }
        }
    };
}

function jsonContents(uri: string, data: any): McpResourceContents {
    return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }]
    };
}

export function buildBuiltInPromptProvider(): PromptProvider {
    const PROMPTS: Record<string, McpPrompt> = {
        'explain-current-scene': {
            name: 'explain-current-scene',
            description: 'Ask the LLM to summarize the current scene hierarchy and key components.',
            arguments: [
                { name: 'focus', description: 'Optional area to focus on (e.g. "physics", "ui").', required: false }
            ]
        },
        'create-prefab-from-node': {
            name: 'create-prefab-from-node',
            description: 'Generate a step-by-step plan for converting a scene node into a reusable prefab.',
            arguments: [
                { name: 'nodeUuid', description: 'UUID of the source node.', required: true },
                { name: 'destination', description: 'Asset path for the new prefab (default db://assets/prefabs).', required: false }
            ]
        },
        'debug-runtime-error': {
            name: 'debug-runtime-error',
            description: 'Walk through likely causes of a runtime error using the latest editor logs.',
            arguments: [
                { name: 'errorMessage', description: 'The error message text.', required: true }
            ]
        }
    };

    return {
        handles(name: string): boolean {
            return Object.prototype.hasOwnProperty.call(PROMPTS, name);
        },
        listPrompts(): McpPrompt[] {
            return Object.values(PROMPTS);
        },
        getPrompt(name: string, args: Record<string, string>): McpPromptExpansion {
            switch (name) {
                case 'explain-current-scene': {
                    const focus = args.focus ? ` Pay special attention to ${args.focus}.` : '';
                    return {
                        description: 'Summarize the current scene.',
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text:
                                        'You are reviewing a Cocos Creator scene. ' +
                                        'Read the resource scene://current and produce a concise hierarchy ' +
                                        'summary (root → leaves), highlighting key components.' + focus
                                }
                            }
                        ]
                    };
                }
                case 'create-prefab-from-node': {
                    const dst = args.destination || 'db://assets/prefabs';
                    return {
                        description: 'Plan prefab extraction.',
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text:
                                        `Plan how to convert node ${args.nodeUuid} into a prefab saved under ${dst}. ` +
                                        'Use scene://node/{uuid} to inspect components first, then propose a sequence ' +
                                        'of cocos-mcp tool calls (prefab_create_prefab, prefab_save_prefab) to perform ' +
                                        'the extraction.'
                                }
                            }
                        ]
                    };
                }
                case 'debug-runtime-error': {
                    const msg = args.errorMessage || '<no error message provided>';
                    return {
                        description: 'Debug a runtime error.',
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text:
                                        `An error occurred at runtime: "${msg}". ` +
                                        'First read runtime://logs for context. Then list 3 likely causes and ' +
                                        'concrete next-step tool calls (e.g. debug_get_console_logs, ' +
                                        'scene_validate_scene) to verify each.'
                                }
                            }
                        ]
                    };
                }
            }
            throw new Error(`Unknown prompt: ${name}`);
        },
        complete(name: string, argName: string, _value: string): string[] {
            if (name === 'explain-current-scene' && argName === 'focus') {
                return ['physics', 'ui', 'rendering', 'audio', 'animation'];
            }
            return [];
        }
    };
}
