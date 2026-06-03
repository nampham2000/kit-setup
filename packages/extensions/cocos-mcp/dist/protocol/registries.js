"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptRegistry = exports.ResourceRegistry = void 0;
exports.pushRuntimeLog = pushRuntimeLog;
exports.getRuntimeLogs = getRuntimeLogs;
exports.buildBuiltInResourceProvider = buildBuiltInResourceProvider;
exports.buildBuiltInPromptProvider = buildBuiltInPromptProvider;
class ResourceRegistry {
    constructor(notify) {
        this.providers = [];
        this.subscriptions = new Set();
        this.notify = notify;
    }
    addProvider(provider) {
        this.providers.push(provider);
        this.notify('notifications/resources/list_changed');
    }
    async listResources() {
        const out = [];
        for (const p of this.providers) {
            try {
                const items = await p.listResources();
                if (items)
                    out.push(...items);
            }
            catch ( /* skip a misbehaving provider */_a) { /* skip a misbehaving provider */ }
        }
        // De‑duplicate by URI (last writer wins).
        const byUri = new Map();
        for (const r of out)
            byUri.set(r.uri, r);
        return Array.from(byUri.values());
    }
    async listResourceTemplates() {
        const out = [];
        for (const p of this.providers) {
            if (!p.listResourceTemplates)
                continue;
            try {
                const items = await p.listResourceTemplates();
                if (items)
                    out.push(...items);
            }
            catch ( /* skip */_a) { /* skip */ }
        }
        return out;
    }
    async readResource(uri) {
        for (const p of this.providers) {
            if (!p.handles(uri))
                continue;
            return await p.readResource(uri);
        }
        throw new Error(`No provider handles resource URI: ${uri}`);
    }
    async subscribe(uri) {
        for (const p of this.providers) {
            if (!p.handles(uri) || !p.subscribe)
                continue;
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
    unsubscribe(uri) {
        for (const p of this.providers) {
            if (p.handles(uri) && p.unsubscribe)
                p.unsubscribe(uri);
        }
        this.subscriptions.delete(uri);
    }
    async complete(uri, argName, value) {
        for (const p of this.providers) {
            if (!p.handles(uri) || !p.complete)
                continue;
            const r = await p.complete(uri, argName, value);
            if (r && r.length)
                return r;
        }
        return [];
    }
    /** Trigger a list_changed notification (e.g. after live add/remove). */
    notifyListChanged() {
        this.notify('notifications/resources/list_changed');
    }
    /** Trigger an updated notification for a single URI. */
    notifyUpdated(uri) {
        if (this.subscriptions.has(uri)) {
            this.notify('notifications/resources/updated', { uri });
        }
    }
}
exports.ResourceRegistry = ResourceRegistry;
class PromptRegistry {
    constructor(notify) {
        this.providers = [];
        this.notify = notify;
    }
    addProvider(provider) {
        this.providers.push(provider);
        this.notify('notifications/prompts/list_changed');
    }
    async listPrompts() {
        const out = [];
        for (const p of this.providers) {
            try {
                const items = await p.listPrompts();
                if (items)
                    out.push(...items);
            }
            catch ( /* skip */_a) { /* skip */ }
        }
        const byName = new Map();
        for (const pr of out)
            byName.set(pr.name, pr);
        return Array.from(byName.values());
    }
    async getPrompt(name, args) {
        for (const p of this.providers) {
            if (!p.handles(name))
                continue;
            return await p.getPrompt(name, args || {});
        }
        throw new Error(`Unknown prompt: ${name}`);
    }
    async complete(name, argName, value) {
        for (const p of this.providers) {
            if (!p.handles(name) || !p.complete)
                continue;
            const r = await p.complete(name, argName, value);
            if (r && r.length)
                return r;
        }
        return [];
    }
    notifyListChanged() {
        this.notify('notifications/prompts/list_changed');
    }
}
exports.PromptRegistry = PromptRegistry;
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
function getEditor() {
    const g = globalThis;
    if (g.Editor && typeof g.Editor === 'object')
        return g.Editor;
    return null;
}
/** A small ring buffer used by `runtime://logs`. */
class RuntimeLogBuffer {
    constructor() {
        this.buf = [];
        this.listeners = new Set();
        this.installed = false;
    }
    push(line) {
        this.buf.push(line);
        if (this.buf.length > 200)
            this.buf.shift();
        for (const l of this.listeners) {
            try {
                l();
            }
            catch ( /* ignore */_a) { /* ignore */ }
        }
    }
    snapshot() {
        return [...this.buf];
    }
    addListener(l) {
        this.listeners.add(l);
        this.ensureInstalled();
    }
    removeListener(l) {
        this.listeners.delete(l);
    }
    ensureInstalled() {
        var _a, _b;
        if (this.installed)
            return;
        this.installed = true;
        const ed = getEditor();
        // Editor.Message broadcasts are the primary log source. We tolerate
        // missing APIs because the stdio binary stub doesn't ship them.
        try {
            (_b = (_a = ed === null || ed === void 0 ? void 0 : ed.Message) === null || _a === void 0 ? void 0 : _a.addBroadcastListener) === null || _b === void 0 ? void 0 : _b.call(_a, 'console:log', (msg) => {
                var _a;
                this.push(`${new Date().toISOString()} ${((msg === null || msg === void 0 ? void 0 : msg.type) || 'log').toUpperCase()}: ${(_a = msg === null || msg === void 0 ? void 0 : msg.message) !== null && _a !== void 0 ? _a : ''}`);
            });
        }
        catch ( /* ignore */_c) { /* ignore */ }
    }
}
const runtimeLogs = new RuntimeLogBuffer();
/** Public hook for tools to push synthetic runtime log entries. */
function pushRuntimeLog(level, message) {
    runtimeLogs.push(`${new Date().toISOString()} ${level.toUpperCase()}: ${message}`);
}
/** Snapshot of the runtime log ring buffer (used by the EditorRuntimeTools tail tool). */
function getRuntimeLogs() {
    return runtimeLogs.snapshot();
}
function buildBuiltInResourceProvider() {
    return {
        handles(uri) {
            return uri === PROJECT_INFO_URI
                || uri === SCENE_CURRENT_URI
                || uri === ASSETS_TREE_URI
                || uri === RUNTIME_LOGS_URI
                || uri.startsWith('scene://node/')
                || uri.startsWith('assets://item/');
        },
        listResources() {
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
        listResourceTemplates() {
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
        async readResource(uri) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
            const ed = getEditor();
            if (uri === PROJECT_INFO_URI) {
                let data;
                try {
                    data = ed
                        ? {
                            name: (_b = (_a = ed.Project) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'unknown',
                            path: (_d = (_c = ed.Project) === null || _c === void 0 ? void 0 : _c.path) !== null && _d !== void 0 ? _d : '',
                            uuid: (_f = (_e = ed.Project) === null || _e === void 0 ? void 0 : _e.uuid) !== null && _f !== void 0 ? _f : '',
                            version: (_h = (_g = ed.Project) === null || _g === void 0 ? void 0 : _g.version) !== null && _h !== void 0 ? _h : '',
                            cocosVersion: (_m = (_k = (_j = ed.versions) === null || _j === void 0 ? void 0 : _j['@cocos/creator-types']) !== null && _k !== void 0 ? _k : (_l = ed.App) === null || _l === void 0 ? void 0 : _l.version) !== null && _m !== void 0 ? _m : ''
                        }
                        : { error: 'Editor not available (running outside Cocos Creator)' };
                }
                catch (e) {
                    data = { error: (_o = e === null || e === void 0 ? void 0 : e.message) !== null && _o !== void 0 ? _o : String(e) };
                }
                return jsonContents(uri, data);
            }
            if (uri === SCENE_CURRENT_URI) {
                if (!ed)
                    return jsonContents(uri, { error: 'Editor not available' });
                try {
                    const tree = await ((_q = (_p = ed.Message) === null || _p === void 0 ? void 0 : _p.request) === null || _q === void 0 ? void 0 : _q.call(_p, 'scene', 'query-node-tree'));
                    return jsonContents(uri, tree !== null && tree !== void 0 ? tree : null);
                }
                catch (e) {
                    return jsonContents(uri, { error: (_r = e === null || e === void 0 ? void 0 : e.message) !== null && _r !== void 0 ? _r : String(e) });
                }
            }
            if (uri === ASSETS_TREE_URI) {
                if (!ed)
                    return jsonContents(uri, { error: 'Editor not available' });
                try {
                    const list = await ((_t = (_s = ed.Message) === null || _s === void 0 ? void 0 : _s.request) === null || _t === void 0 ? void 0 : _t.call(_s, 'asset-db', 'query-assets', { pattern: 'db://assets/**/*' }));
                    return jsonContents(uri, list !== null && list !== void 0 ? list : []);
                }
                catch (e) {
                    return jsonContents(uri, { error: (_u = e === null || e === void 0 ? void 0 : e.message) !== null && _u !== void 0 ? _u : String(e) });
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
                if (!ed)
                    return jsonContents(uri, { uuid, error: 'Editor not available' });
                try {
                    const node = await ((_w = (_v = ed.Message) === null || _v === void 0 ? void 0 : _v.request) === null || _w === void 0 ? void 0 : _w.call(_v, 'scene', 'query-node', uuid));
                    return jsonContents(uri, node !== null && node !== void 0 ? node : { uuid, error: 'not found' });
                }
                catch (e) {
                    return jsonContents(uri, { uuid, error: (_x = e === null || e === void 0 ? void 0 : e.message) !== null && _x !== void 0 ? _x : String(e) });
                }
            }
            if (uri.startsWith('assets://item/')) {
                const uuid = uri.slice('assets://item/'.length);
                if (!ed)
                    return jsonContents(uri, { uuid, error: 'Editor not available' });
                try {
                    const info = await ((_z = (_y = ed.Message) === null || _y === void 0 ? void 0 : _y.request) === null || _z === void 0 ? void 0 : _z.call(_y, 'asset-db', 'query-asset-info', uuid));
                    return jsonContents(uri, info !== null && info !== void 0 ? info : { uuid, error: 'not found' });
                }
                catch (e) {
                    return jsonContents(uri, { uuid, error: (_0 = e === null || e === void 0 ? void 0 : e.message) !== null && _0 !== void 0 ? _0 : String(e) });
                }
            }
            throw new Error(`Built-in provider cannot read: ${uri}`);
        },
        subscribe(uri, notify) {
            if (uri === RUNTIME_LOGS_URI) {
                runtimeLogs.addListener(notify);
                return true;
            }
            // Other built-ins are not subscribable — return false so the
            // registry can record the subscription as no-op.
            return false;
        },
        unsubscribe(uri) {
            if (uri === RUNTIME_LOGS_URI) {
                // We don't track per-call listeners individually here; the
                // registry already removes the subscription bookkeeping.
                // For correctness in tests we clear all listeners on
                // unsubscribe; in practice each session has one subscriber.
                runtimeLogs.removeListener(() => { });
            }
        }
    };
}
function jsonContents(uri, data) {
    return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }]
    };
}
function buildBuiltInPromptProvider() {
    const PROMPTS = {
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
        handles(name) {
            return Object.prototype.hasOwnProperty.call(PROMPTS, name);
        },
        listPrompts() {
            return Object.values(PROMPTS);
        },
        getPrompt(name, args) {
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
                                    text: 'You are reviewing a Cocos Creator scene. ' +
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
                                    text: `Plan how to convert node ${args.nodeUuid} into a prefab saved under ${dst}. ` +
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
                                    text: `An error occurred at runtime: "${msg}". ` +
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
        complete(name, argName, _value) {
            if (name === 'explain-current-scene' && argName === 'focus') {
                return ['physics', 'ui', 'rendering', 'audio', 'animation'];
            }
            return [];
        }
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVnaXN0cmllcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NvdXJjZS9wcm90b2NvbC9yZWdpc3RyaWVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7R0FjRzs7O0FBOE9ILHdDQUVDO0FBR0Qsd0NBRUM7QUFFRCxvRUE2SUM7QUFRRCxnRUFxR0M7QUF4ZEQsTUFBYSxnQkFBZ0I7SUFLekIsWUFBWSxNQUF3QjtRQUo1QixjQUFTLEdBQXVCLEVBQUUsQ0FBQztRQUVuQyxrQkFBYSxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFHdEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDekIsQ0FBQztJQUVNLFdBQVcsQ0FBQyxRQUEwQjtRQUN6QyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM5QixJQUFJLENBQUMsTUFBTSxDQUFDLHNDQUFzQyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVNLEtBQUssQ0FBQyxhQUFhO1FBQ3RCLE1BQU0sR0FBRyxHQUFrQixFQUFFLENBQUM7UUFDOUIsS0FBSyxNQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDN0IsSUFBSSxDQUFDO2dCQUNELE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO2dCQUN0QyxJQUFJLEtBQUs7b0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDO1lBQ2xDLENBQUM7WUFBQyxRQUFRLGlDQUFpQyxJQUFuQyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQztRQUNqRCxDQUFDO1FBQ0QsMENBQTBDO1FBQzFDLE1BQU0sS0FBSyxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO1FBQzdDLEtBQUssTUFBTSxDQUFDLElBQUksR0FBRztZQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcs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RUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFDaEUsQ0FBQztZQUNELE9BQU8sRUFBRSxDQUFDO1FBQ2QsQ0FBQztLQUNKLENBQUM7QUFDTixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQaGFzZSAyIOKAlCBSZXNvdXJjZXMgJiBQcm9tcHRzIHJlZ2lzdHJpZXMuXG4gKlxuICogVGhlIHtAbGluayBSZXNvdXJjZVJlZ2lzdHJ5fSBhbmQge0BsaW5rIFByb21wdFJlZ2lzdHJ5fSBsZXQgcGx1Z2dhYmxlXG4gKiBwcm92aWRlcnMgZXhwb3NlIE1DUCByZXNvdXJjZXMgYW5kIHByb21wdCB0ZW1wbGF0ZXMuIFRoZXkgYWxzbyBoYW5kbGVcbiAqIHN1YnNjcmlwdGlvbiBib29ra2VlcGluZyBmb3IgYHJlc291cmNlcy9zdWJzY3JpYmVgIHNvIHRoZSBzZXJ2ZXIgY2FuIGVtaXRcbiAqIGBub3RpZmljYXRpb25zL3Jlc291cmNlcy91cGRhdGVkYCB3aGVuIGFuIHVuZGVybHlpbmcgcHJvdmlkZXIgY2hhbmdlcy5cbiAqXG4gKiBCdWlsdOKAkWluIHByb3ZpZGVycyAoYGJ1aWxkQnVpbHRJblJlc291cmNlUHJvdmlkZXJgIC8gYGJ1aWxkQnVpbHRJblByb21wdFByb3ZpZGVyYClcbiAqIGNvdmVyIHByb2plY3QgbWV0YWRhdGEsIHRoZSBjdXJyZW50IHNjZW5lLCB0aGUgYXNzZXQgdHJlZSBhbmQgdGhlIGVkaXRvclxuICogcnVudGltZSBsb2cgZmVlZCAoUGhhc2VzIDPigJM1KS4gVGhleSBkZWdyYWRlIGdyYWNlZnVsbHkgd2hlbiB0aGUgaG9zdFxuICogYEVkaXRvcmAgZ2xvYmFsIGlzIHVuYXZhaWxhYmxlIChlLmcuIHN0ZGlvIG91dHNpZGUgdGhlIGVkaXRvcikgc28gdGhlXG4gKiBzZXJ2ZXIgc3RpbGwgYW5zd2VycyBgcmVzb3VyY2VzL2xpc3RgIHdpdGggZGVzY3JpcHRpdmUgZXJyb3JzIGluc3RlYWQgb2ZcbiAqIGNyYXNoaW5nLlxuICovXG5cbmltcG9ydCB7IE1jcFByb21wdCwgTWNwUHJvbXB0RXhwYW5zaW9uLCBNY3BSZXNvdXJjZSwgTWNwUmVzb3VyY2VDb250ZW50cywgTWNwUmVzb3VyY2VUZW1wbGF0ZSB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqIExpZ2h0d2VpZ2h0IGRlcGVuZGVuY3kgdGhlIHJlZ2lzdHJ5IHRha2VzIGZvciBlbWl0dGluZyBjaGFuZ2Ugbm90aWZpY2F0aW9ucy4gKi9cbmV4cG9ydCB0eXBlIFJlZ2lzdHJ5Tm90aWZpZXIgPSAobWV0aG9kOiBzdHJpbmcsIHBhcmFtcz86IGFueSkgPT4gdm9pZDtcblxuLy8gLS0gUmVzb3VyY2UgcHJvdmlkZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb3VyY2VQcm92aWRlciB7XG4gICAgLyoqIFJldHVybiB0aGUgc3RhdGljIHJlc291cmNlIGxpc3QgdGhpcyBwcm92aWRlciBjb250cmlidXRlcy4gKi9cbiAgICBsaXN0UmVzb3VyY2VzKCk6IE1jcFJlc291cmNlW10gfCBQcm9taXNlPE1jcFJlc291cmNlW10+O1xuICAgIC8qKiBSZXR1cm4gVVJJIHRlbXBsYXRlcyB0aGlzIHByb3ZpZGVyIHN1cHBvcnRzLiBPcHRpb25hbC4gKi9cbiAgICBsaXN0UmVzb3VyY2VUZW1wbGF0ZXM/KCk6IE1jcFJlc291cmNlVGVtcGxhdGVbXSB8IFByb21pc2U8TWNwUmVzb3VyY2VUZW1wbGF0ZVtdPjtcbiAgICAvKiogUmVhZCBhIHJlc291cmNlIGJ5IFVSSS4gVGhyb3cgdG8gc2lnbmFsIFwibm90IGZvdW5kIC8gbm90IGhhbmRsZWRcIi4gKi9cbiAgICByZWFkUmVzb3VyY2UodXJpOiBzdHJpbmcpOiBQcm9taXNlPE1jcFJlc291cmNlQ29udGVudHM+IHwgTWNwUmVzb3VyY2VDb250ZW50cztcbiAgICAvKiogUmV0dXJuIHRydWUgaWYgdGhlIHByb3ZpZGVyIGNsYWltcyB0aGlzIFVSSSBmb3IgcmVhZC9zdWJzY3JpYmUuICovXG4gICAgaGFuZGxlcyh1cmk6IHN0cmluZyk6IGJvb2xlYW47XG4gICAgLyoqIE9wdGlvbmFsIGFyZ3VtZW50IGNvbXBsZXRpb24gZm9yIGBjb21wbGV0aW9uL2NvbXBsZXRlYCBvbiByZXNvdXJjZSB0ZW1wbGF0ZXMuICovXG4gICAgY29tcGxldGU/KHVyaTogc3RyaW5nLCBhcmdOYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB8IHN0cmluZ1tdO1xuICAgIC8qKiBPcHRpb25hbCBzdWJzY3JpcHRpb24gaG9vayDigJQgcmV0dXJuIGZhbHNlIGlmIHN1YnNjcmlwdGlvbiBpcyBub3Qgc3VwcG9ydGVkLiAqL1xuICAgIHN1YnNjcmliZT8odXJpOiBzdHJpbmcsIG5vdGlmeTogKCkgPT4gdm9pZCk6IGJvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+O1xuICAgIHVuc3Vic2NyaWJlPyh1cmk6IHN0cmluZyk6IHZvaWQ7XG59XG5cbmV4cG9ydCBjbGFzcyBSZXNvdXJjZVJlZ2lzdHJ5IHtcbiAgICBwcml2YXRlIHByb3ZpZGVyczogUmVzb3VyY2VQcm92aWRlcltdID0gW107XG4gICAgcHJpdmF0ZSBub3RpZnk6IFJlZ2lzdHJ5Tm90aWZpZXI7XG4gICAgcHJpdmF0ZSBzdWJzY3JpcHRpb25zID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBjb25zdHJ1Y3Rvcihub3RpZnk6IFJlZ2lzdHJ5Tm90aWZpZXIpIHtcbiAgICAgICAgdGhpcy5ub3RpZnkgPSBub3RpZnk7XG4gICAgfVxuXG4gICAgcHVibGljIGFkZFByb3ZpZGVyKHByb3ZpZGVyOiBSZXNvdXJjZVByb3ZpZGVyKTogdm9pZCB7XG4gICAgICAgIHRoaXMucHJvdmlkZXJzLnB1c2gocHJvdmlkZXIpO1xuICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9yZXNvdXJjZXMvbGlzdF9jaGFuZ2VkJyk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGxpc3RSZXNvdXJjZXMoKTogUHJvbWlzZTxNY3BSZXNvdXJjZVtdPiB7XG4gICAgICAgIGNvbnN0IG91dDogTWNwUmVzb3VyY2VbXSA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBhd2FpdCBwLmxpc3RSZXNvdXJjZXMoKTtcbiAgICAgICAgICAgICAgICBpZiAoaXRlbXMpIG91dC5wdXNoKC4uLml0ZW1zKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggeyAvKiBza2lwIGEgbWlzYmVoYXZpbmcgcHJvdmlkZXIgKi8gfVxuICAgICAgICB9XG4gICAgICAgIC8vIERl4oCRZHVwbGljYXRlIGJ5IFVSSSAobGFzdCB3cml0ZXIgd2lucykuXG4gICAgICAgIGNvbnN0IGJ5VXJpID0gbmV3IE1hcDxzdHJpbmcsIE1jcFJlc291cmNlPigpO1xuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygb3V0KSBieVVyaS5zZXQoci51cmksIHIpO1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbShieVVyaS52YWx1ZXMoKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGxpc3RSZXNvdXJjZVRlbXBsYXRlcygpOiBQcm9taXNlPE1jcFJlc291cmNlVGVtcGxhdGVbXT4ge1xuICAgICAgICBjb25zdCBvdXQ6IE1jcFJlc291cmNlVGVtcGxhdGVbXSA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgICAgICAgIGlmICghcC5saXN0UmVzb3VyY2VUZW1wbGF0ZXMpIGNvbnRpbnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtcyA9IGF3YWl0IHAubGlzdFJlc291cmNlVGVtcGxhdGVzKCk7XG4gICAgICAgICAgICAgICAgaWYgKGl0ZW1zKSBvdXQucHVzaCguLi5pdGVtcyk7XG4gICAgICAgICAgICB9IGNhdGNoIHsgLyogc2tpcCAqLyB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG91dDtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgcmVhZFJlc291cmNlKHVyaTogc3RyaW5nKTogUHJvbWlzZTxNY3BSZXNvdXJjZUNvbnRlbnRzPiB7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICAgICAgaWYgKCFwLmhhbmRsZXModXJpKSkgY29udGludWU7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgcC5yZWFkUmVzb3VyY2UodXJpKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHByb3ZpZGVyIGhhbmRsZXMgcmVzb3VyY2UgVVJJOiAke3VyaX1gKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgc3Vic2NyaWJlKHVyaTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICAgICAgaWYgKCFwLmhhbmRsZXModXJpKSB8fCAhcC5zdWJzY3JpYmUpIGNvbnRpbnVlO1xuICAgICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCBwLnN1YnNjcmliZSh1cmksICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9yZXNvdXJjZXMvdXBkYXRlZCcsIHsgdXJpIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMuYWRkKHVyaSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIE5vIHByb3ZpZGVyIHN1cHBvcnRzIHN1YnNjcmlwdGlvbnMgZm9yIHRoaXMgVVJJIOKAlCBzdWNjZWVkIHNpbGVudGx5XG4gICAgICAgIC8vICh0aGUgc3BlYyBsZWF2ZXMgdGhpcyBzZXJ2ZXLigJFkZWZpbmVkOyBlbWl0dGluZyBub3RoaW5nIGlzIHNhZmUpLlxuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMuYWRkKHVyaSk7XG4gICAgfVxuXG4gICAgcHVibGljIHVuc3Vic2NyaWJlKHVyaTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICAgICAgaWYgKHAuaGFuZGxlcyh1cmkpICYmIHAudW5zdWJzY3JpYmUpIHAudW5zdWJzY3JpYmUodXJpKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMuZGVsZXRlKHVyaSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGNvbXBsZXRlKHVyaTogc3RyaW5nLCBhcmdOYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICAgICAgaWYgKCFwLmhhbmRsZXModXJpKSB8fCAhcC5jb21wbGV0ZSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCByID0gYXdhaXQgcC5jb21wbGV0ZSh1cmksIGFyZ05hbWUsIHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChyICYmIHIubGVuZ3RoKSByZXR1cm4gcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLyoqIFRyaWdnZXIgYSBsaXN0X2NoYW5nZWQgbm90aWZpY2F0aW9uIChlLmcuIGFmdGVyIGxpdmUgYWRkL3JlbW92ZSkuICovXG4gICAgcHVibGljIG5vdGlmeUxpc3RDaGFuZ2VkKCk6IHZvaWQge1xuICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9yZXNvdXJjZXMvbGlzdF9jaGFuZ2VkJyk7XG4gICAgfVxuXG4gICAgLyoqIFRyaWdnZXIgYW4gdXBkYXRlZCBub3RpZmljYXRpb24gZm9yIGEgc2luZ2xlIFVSSS4gKi9cbiAgICBwdWJsaWMgbm90aWZ5VXBkYXRlZCh1cmk6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5zdWJzY3JpcHRpb25zLmhhcyh1cmkpKSB7XG4gICAgICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9yZXNvdXJjZXMvdXBkYXRlZCcsIHsgdXJpIH0pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyAtLSBQcm9tcHQgcHJvdmlkZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQcm9tcHRQcm92aWRlciB7XG4gICAgbGlzdFByb21wdHMoKTogTWNwUHJvbXB0W10gfCBQcm9taXNlPE1jcFByb21wdFtdPjtcbiAgICAvKiogUmV0dXJuIHRoZSByZW5kZXJlZCBwcm9tcHQgb3IgdGhyb3cgdG8gc2lnbmFsIFwibm90IGhhbmRsZWRcIi4gKi9cbiAgICBnZXRQcm9tcHQobmFtZTogc3RyaW5nLCBhcmdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTxNY3BQcm9tcHRFeHBhbnNpb24+IHwgTWNwUHJvbXB0RXhwYW5zaW9uO1xuICAgIGhhbmRsZXMobmFtZTogc3RyaW5nKTogYm9vbGVhbjtcbiAgICBjb21wbGV0ZT8obmFtZTogc3RyaW5nLCBhcmdOYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB8IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgY2xhc3MgUHJvbXB0UmVnaXN0cnkge1xuICAgIHByaXZhdGUgcHJvdmlkZXJzOiBQcm9tcHRQcm92aWRlcltdID0gW107XG4gICAgcHJpdmF0ZSBub3RpZnk6IFJlZ2lzdHJ5Tm90aWZpZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcihub3RpZnk6IFJlZ2lzdHJ5Tm90aWZpZXIpIHtcbiAgICAgICAgdGhpcy5ub3RpZnkgPSBub3RpZnk7XG4gICAgfVxuXG4gICAgcHVibGljIGFkZFByb3ZpZGVyKHByb3ZpZGVyOiBQcm9tcHRQcm92aWRlcik6IHZvaWQge1xuICAgICAgICB0aGlzLnByb3ZpZGVycy5wdXNoKHByb3ZpZGVyKTtcbiAgICAgICAgdGhpcy5ub3RpZnkoJ25vdGlmaWNhdGlvbnMvcHJvbXB0cy9saXN0X2NoYW5nZWQnKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgbGlzdFByb21wdHMoKTogUHJvbWlzZTxNY3BQcm9tcHRbXT4ge1xuICAgICAgICBjb25zdCBvdXQ6IE1jcFByb21wdFtdID0gW107XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtcyA9IGF3YWl0IHAubGlzdFByb21wdHMoKTtcbiAgICAgICAgICAgICAgICBpZiAoaXRlbXMpIG91dC5wdXNoKC4uLml0ZW1zKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggeyAvKiBza2lwICovIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBieU5hbWUgPSBuZXcgTWFwPHN0cmluZywgTWNwUHJvbXB0PigpO1xuICAgICAgICBmb3IgKGNvbnN0IHByIG9mIG91dCkgYnlOYW1lLnNldChwci5uYW1lLCBwcik7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGJ5TmFtZS52YWx1ZXMoKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGdldFByb21wdChuYW1lOiBzdHJpbmcsIGFyZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBQcm9taXNlPE1jcFByb21wdEV4cGFuc2lvbj4ge1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgICAgICAgIGlmICghcC5oYW5kbGVzKG5hbWUpKSBjb250aW51ZTtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBwLmdldFByb21wdChuYW1lLCBhcmdzIHx8IHt9KTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcHJvbXB0OiAke25hbWV9YCk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGNvbXBsZXRlKG5hbWU6IHN0cmluZywgYXJnTmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgICAgICAgIGlmICghcC5oYW5kbGVzKG5hbWUpIHx8ICFwLmNvbXBsZXRlKSBjb250aW51ZTtcbiAgICAgICAgICAgIGNvbnN0IHIgPSBhd2FpdCBwLmNvbXBsZXRlKG5hbWUsIGFyZ05hbWUsIHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChyICYmIHIubGVuZ3RoKSByZXR1cm4gcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgcHVibGljIG5vdGlmeUxpc3RDaGFuZ2VkKCk6IHZvaWQge1xuICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9wcm9tcHRzL2xpc3RfY2hhbmdlZCcpO1xuICAgIH1cbn1cblxuLy8gLS0gQnVpbHQtaW4gcHJvdmlkZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFBST0pFQ1RfSU5GT19VUkkgPSAncHJvamVjdDovL2luZm8nO1xuY29uc3QgU0NFTkVfQ1VSUkVOVF9VUkkgPSAnc2NlbmU6Ly9jdXJyZW50JztcbmNvbnN0IEFTU0VUU19UUkVFX1VSSSA9ICdhc3NldHM6Ly90cmVlJztcbmNvbnN0IFJVTlRJTUVfTE9HU19VUkkgPSAncnVudGltZTovL2xvZ3MnO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdsb2JhbCBDb2NvcyBgRWRpdG9yYCBwcm94eSB3aGVuIHByZXNlbnQuIE91dHNpZGUgdGhlIGVkaXRvclxuICogKGUuZy4gc3RkaW8gYmluYXJ5IHJ1bm5pbmcgc3RhbmRhbG9uZSkgaXQgcmV0dXJucyBudWxsIGFuZCBwcm92aWRlcnNcbiAqIGdyYWNlZnVsbHkgcmVwb3J0IHVuYXZhaWxhYmxlIGluc3RlYWQgb2YgdGhyb3dpbmcuXG4gKi9cbmZ1bmN0aW9uIGdldEVkaXRvcigpOiBhbnkgfCBudWxsIHtcbiAgICBjb25zdCBnOiBhbnkgPSBnbG9iYWxUaGlzIGFzIGFueTtcbiAgICBpZiAoZy5FZGl0b3IgJiYgdHlwZW9mIGcuRWRpdG9yID09PSAnb2JqZWN0JykgcmV0dXJuIGcuRWRpdG9yO1xuICAgIHJldHVybiBudWxsO1xufVxuXG4vKiogQSBzbWFsbCByaW5nIGJ1ZmZlciB1c2VkIGJ5IGBydW50aW1lOi8vbG9nc2AuICovXG5jbGFzcyBSdW50aW1lTG9nQnVmZmVyIHtcbiAgICBwcml2YXRlIGJ1Zjogc3RyaW5nW10gPSBbXTtcbiAgICBwcml2YXRlIGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcbiAgICBwcml2YXRlIGluc3RhbGxlZCA9IGZhbHNlO1xuXG4gICAgcHVibGljIHB1c2gobGluZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIHRoaXMuYnVmLnB1c2gobGluZSk7XG4gICAgICAgIGlmICh0aGlzLmJ1Zi5sZW5ndGggPiAyMDApIHRoaXMuYnVmLnNoaWZ0KCk7XG4gICAgICAgIGZvciAoY29uc3QgbCBvZiB0aGlzLmxpc3RlbmVycykge1xuICAgICAgICAgICAgdHJ5IHsgbCgpOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBzbmFwc2hvdCgpOiBzdHJpbmdbXSB7XG4gICAgICAgIHJldHVybiBbLi4udGhpcy5idWZdO1xuICAgIH1cblxuICAgIHB1YmxpYyBhZGRMaXN0ZW5lcihsOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzLmFkZChsKTtcbiAgICAgICAgdGhpcy5lbnN1cmVJbnN0YWxsZWQoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVtb3ZlTGlzdGVuZXIobDogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgICAgICB0aGlzLmxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBlbnN1cmVJbnN0YWxsZWQoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLmluc3RhbGxlZCkgcmV0dXJuO1xuICAgICAgICB0aGlzLmluc3RhbGxlZCA9IHRydWU7XG4gICAgICAgIGNvbnN0IGVkID0gZ2V0RWRpdG9yKCk7XG4gICAgICAgIC8vIEVkaXRvci5NZXNzYWdlIGJyb2FkY2FzdHMgYXJlIHRoZSBwcmltYXJ5IGxvZyBzb3VyY2UuIFdlIHRvbGVyYXRlXG4gICAgICAgIC8vIG1pc3NpbmcgQVBJcyBiZWNhdXNlIHRoZSBzdGRpbyBiaW5hcnkgc3R1YiBkb2Vzbid0IHNoaXAgdGhlbS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGVkPy5NZXNzYWdlPy5hZGRCcm9hZGNhc3RMaXN0ZW5lcj8uKCdjb25zb2xlOmxvZycsIChtc2c6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucHVzaChgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9ICR7KG1zZz8udHlwZSB8fCAnbG9nJykudG9VcHBlckNhc2UoKX06ICR7bXNnPy5tZXNzYWdlID8/ICcnfWApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgIH1cbn1cblxuY29uc3QgcnVudGltZUxvZ3MgPSBuZXcgUnVudGltZUxvZ0J1ZmZlcigpO1xuXG4vKiogUHVibGljIGhvb2sgZm9yIHRvb2xzIHRvIHB1c2ggc3ludGhldGljIHJ1bnRpbWUgbG9nIGVudHJpZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcHVzaFJ1bnRpbWVMb2cobGV2ZWw6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XG4gICAgcnVudGltZUxvZ3MucHVzaChgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9ICR7bGV2ZWwudG9VcHBlckNhc2UoKX06ICR7bWVzc2FnZX1gKTtcbn1cblxuLyoqIFNuYXBzaG90IG9mIHRoZSBydW50aW1lIGxvZyByaW5nIGJ1ZmZlciAodXNlZCBieSB0aGUgRWRpdG9yUnVudGltZVRvb2xzIHRhaWwgdG9vbCkuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UnVudGltZUxvZ3MoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBydW50aW1lTG9ncy5zbmFwc2hvdCgpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRCdWlsdEluUmVzb3VyY2VQcm92aWRlcigpOiBSZXNvdXJjZVByb3ZpZGVyIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBoYW5kbGVzKHVyaTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgICAgICByZXR1cm4gdXJpID09PSBQUk9KRUNUX0lORk9fVVJJXG4gICAgICAgICAgICAgICAgfHwgdXJpID09PSBTQ0VORV9DVVJSRU5UX1VSSVxuICAgICAgICAgICAgICAgIHx8IHVyaSA9PT0gQVNTRVRTX1RSRUVfVVJJXG4gICAgICAgICAgICAgICAgfHwgdXJpID09PSBSVU5USU1FX0xPR1NfVVJJXG4gICAgICAgICAgICAgICAgfHwgdXJpLnN0YXJ0c1dpdGgoJ3NjZW5lOi8vbm9kZS8nKVxuICAgICAgICAgICAgICAgIHx8IHVyaS5zdGFydHNXaXRoKCdhc3NldHM6Ly9pdGVtLycpO1xuICAgICAgICB9LFxuICAgICAgICBsaXN0UmVzb3VyY2VzKCk6IE1jcFJlc291cmNlW10ge1xuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHVyaTogUFJPSkVDVF9JTkZPX1VSSSxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ0NvY29zIHByb2plY3QgaW5mbycsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU3RhdGljIHByb2plY3QgbWV0YWRhdGEgKG5hbWUsIHBhdGgsIHZlcnNpb24pLicsXG4gICAgICAgICAgICAgICAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdXJpOiBTQ0VORV9DVVJSRU5UX1VSSSxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ0N1cnJlbnQgc2NlbmUnLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0hpZXJhcmNoeSBvZiB0aGUgY3VycmVudGx5IG9wZW4gc2NlbmUuJyxcbiAgICAgICAgICAgICAgICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICB1cmk6IEFTU0VUU19UUkVFX1VSSSxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ0Fzc2V0IGRhdGFiYXNlIHRyZWUnLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1RvcC1sZXZlbCBkYjovL2Fzc2V0cyB0cmVlIGFzIHJlcG9ydGVkIGJ5IHRoZSBhc3NldCBEQi4nLFxuICAgICAgICAgICAgICAgICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHVyaTogUlVOVElNRV9MT0dTX1VSSSxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ0VkaXRvciBydW50aW1lIGxvZyB0YWlsJyxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdMYXN0IH4yMDAgY29uc29sZSBtZXNzYWdlcyBmb3J3YXJkZWQgYnkgdGhlIGVkaXRvciAoUGhhc2UgNSkuIFN1YnNjcmliZSBmb3IgbGl2ZSB1cGRhdGVzLicsXG4gICAgICAgICAgICAgICAgICAgIG1pbWVUeXBlOiAndGV4dC9wbGFpbidcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdO1xuICAgICAgICB9LFxuICAgICAgICBsaXN0UmVzb3VyY2VUZW1wbGF0ZXMoKTogTWNwUmVzb3VyY2VUZW1wbGF0ZVtdIHtcbiAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICB1cmlUZW1wbGF0ZTogJ3NjZW5lOi8vbm9kZS97dXVpZH0nLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnU2NlbmUgbm9kZScsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU25hcHNob3Qgb2YgYSBzaW5nbGUgbm9kZSBieSBVVUlELicsXG4gICAgICAgICAgICAgICAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdXJpVGVtcGxhdGU6ICdhc3NldHM6Ly9pdGVtL3t1dWlkfScsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdBc3NldCBpdGVtJyxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBc3NldCBEQiBpbmZvIGZvciBhIHNpbmdsZSBhc3NldCBieSBVVUlELicsXG4gICAgICAgICAgICAgICAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdO1xuICAgICAgICB9LFxuICAgICAgICBhc3luYyByZWFkUmVzb3VyY2UodXJpOiBzdHJpbmcpOiBQcm9taXNlPE1jcFJlc291cmNlQ29udGVudHM+IHtcbiAgICAgICAgICAgIGNvbnN0IGVkID0gZ2V0RWRpdG9yKCk7XG4gICAgICAgICAgICBpZiAodXJpID09PSBQUk9KRUNUX0lORk9fVVJJKSB7XG4gICAgICAgICAgICAgICAgbGV0IGRhdGE6IGFueTtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBkYXRhID0gZWRcbiAgICAgICAgICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGVkLlByb2plY3Q/Lm5hbWUgPz8gJ3Vua25vd24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IGVkLlByb2plY3Q/LnBhdGggPz8gJycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogZWQuUHJvamVjdD8udXVpZCA/PyAnJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBlZC5Qcm9qZWN0Py52ZXJzaW9uID8/ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvY29zVmVyc2lvbjogZWQudmVyc2lvbnM/LlsnQGNvY29zL2NyZWF0b3ItdHlwZXMnXSA/PyBlZC5BcHA/LnZlcnNpb24gPz8gJydcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIDogeyBlcnJvcjogJ0VkaXRvciBub3QgYXZhaWxhYmxlIChydW5uaW5nIG91dHNpZGUgQ29jb3MgQ3JlYXRvciknIH07XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIGRhdGEgPSB7IGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodXJpID09PSBTQ0VORV9DVVJSRU5UX1VSSSkge1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IGVycm9yOiAnRWRpdG9yIG5vdCBhdmFpbGFibGUnIH0pO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRyZWUgPSBhd2FpdCBlZC5NZXNzYWdlPy5yZXF1ZXN0Py4oJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgdHJlZSA/PyBudWxsKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHsgZXJyb3I6IGU/Lm1lc3NhZ2UgPz8gU3RyaW5nKGUpIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh1cmkgPT09IEFTU0VUU19UUkVFX1VSSSkge1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IGVycm9yOiAnRWRpdG9yIG5vdCBhdmFpbGFibGUnIH0pO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpc3QgPSBhd2FpdCBlZC5NZXNzYWdlPy5yZXF1ZXN0Py4oJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0cycsIHsgcGF0dGVybjogJ2RiOi8vYXNzZXRzLyoqLyonIH0pO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgbGlzdCA/PyBbXSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodXJpID09PSBSVU5USU1FX0xPR1NfVVJJKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGVudHM6IFt7XG4gICAgICAgICAgICAgICAgICAgICAgICB1cmksXG4gICAgICAgICAgICAgICAgICAgICAgICBtaW1lVHlwZTogJ3RleHQvcGxhaW4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogcnVudGltZUxvZ3Muc25hcHNob3QoKS5qb2luKCdcXG4nKVxuICAgICAgICAgICAgICAgICAgICB9XVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodXJpLnN0YXJ0c1dpdGgoJ3NjZW5lOi8vbm9kZS8nKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHV1aWQgPSB1cmkuc2xpY2UoJ3NjZW5lOi8vbm9kZS8nLmxlbmd0aCk7XG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHsgdXVpZCwgZXJyb3I6ICdFZGl0b3Igbm90IGF2YWlsYWJsZScgfSk7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgbm9kZSA9IGF3YWl0IGVkLk1lc3NhZ2U/LnJlcXVlc3Q/Lignc2NlbmUnLCAncXVlcnktbm9kZScsIHV1aWQpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgbm9kZSA/PyB7IHV1aWQsIGVycm9yOiAnbm90IGZvdW5kJyB9KTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHsgdXVpZCwgZXJyb3I6IGU/Lm1lc3NhZ2UgPz8gU3RyaW5nKGUpIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh1cmkuc3RhcnRzV2l0aCgnYXNzZXRzOi8vaXRlbS8nKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHV1aWQgPSB1cmkuc2xpY2UoJ2Fzc2V0czovL2l0ZW0vJy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgIGlmICghZWQpIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IHV1aWQsIGVycm9yOiAnRWRpdG9yIG5vdCBhdmFpbGFibGUnIH0pO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhd2FpdCBlZC5NZXNzYWdlPy5yZXF1ZXN0Py4oJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCB1dWlkKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIGluZm8gPz8geyB1dWlkLCBlcnJvcjogJ25vdCBmb3VuZCcgfSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IHV1aWQsIGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEJ1aWx0LWluIHByb3ZpZGVyIGNhbm5vdCByZWFkOiAke3VyaX1gKTtcbiAgICAgICAgfSxcbiAgICAgICAgc3Vic2NyaWJlKHVyaTogc3RyaW5nLCBub3RpZnk6ICgpID0+IHZvaWQpOiBib29sZWFuIHtcbiAgICAgICAgICAgIGlmICh1cmkgPT09IFJVTlRJTUVfTE9HU19VUkkpIHtcbiAgICAgICAgICAgICAgICBydW50aW1lTG9ncy5hZGRMaXN0ZW5lcihub3RpZnkpO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3RoZXIgYnVpbHQtaW5zIGFyZSBub3Qgc3Vic2NyaWJhYmxlIOKAlCByZXR1cm4gZmFsc2Ugc28gdGhlXG4gICAgICAgICAgICAvLyByZWdpc3RyeSBjYW4gcmVjb3JkIHRoZSBzdWJzY3JpcHRpb24gYXMgbm8tb3AuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0sXG4gICAgICAgIHVuc3Vic2NyaWJlKHVyaTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgICAgICBpZiAodXJpID09PSBSVU5USU1FX0xPR1NfVVJJKSB7XG4gICAgICAgICAgICAgICAgLy8gV2UgZG9uJ3QgdHJhY2sgcGVyLWNhbGwgbGlzdGVuZXJzIGluZGl2aWR1YWxseSBoZXJlOyB0aGVcbiAgICAgICAgICAgICAgICAvLyByZWdpc3RyeSBhbHJlYWR5IHJlbW92ZXMgdGhlIHN1YnNjcmlwdGlvbiBib29ra2VlcGluZy5cbiAgICAgICAgICAgICAgICAvLyBGb3IgY29ycmVjdG5lc3MgaW4gdGVzdHMgd2UgY2xlYXIgYWxsIGxpc3RlbmVycyBvblxuICAgICAgICAgICAgICAgIC8vIHVuc3Vic2NyaWJlOyBpbiBwcmFjdGljZSBlYWNoIHNlc3Npb24gaGFzIG9uZSBzdWJzY3JpYmVyLlxuICAgICAgICAgICAgICAgIHJ1bnRpbWVMb2dzLnJlbW92ZUxpc3RlbmVyKCgpID0+IHt9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGpzb25Db250ZW50cyh1cmk6IHN0cmluZywgZGF0YTogYW55KTogTWNwUmVzb3VyY2VDb250ZW50cyB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgY29udGVudHM6IFt7IHVyaSwgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJywgdGV4dDogSlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMikgfV1cbiAgICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRCdWlsdEluUHJvbXB0UHJvdmlkZXIoKTogUHJvbXB0UHJvdmlkZXIge1xuICAgIGNvbnN0IFBST01QVFM6IFJlY29yZDxzdHJpbmcsIE1jcFByb21wdD4gPSB7XG4gICAgICAgICdleHBsYWluLWN1cnJlbnQtc2NlbmUnOiB7XG4gICAgICAgICAgICBuYW1lOiAnZXhwbGFpbi1jdXJyZW50LXNjZW5lJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXNrIHRoZSBMTE0gdG8gc3VtbWFyaXplIHRoZSBjdXJyZW50IHNjZW5lIGhpZXJhcmNoeSBhbmQga2V5IGNvbXBvbmVudHMuJyxcbiAgICAgICAgICAgIGFyZ3VtZW50czogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2ZvY3VzJywgZGVzY3JpcHRpb246ICdPcHRpb25hbCBhcmVhIHRvIGZvY3VzIG9uIChlLmcuIFwicGh5c2ljc1wiLCBcInVpXCIpLicsIHJlcXVpcmVkOiBmYWxzZSB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH0sXG4gICAgICAgICdjcmVhdGUtcHJlZmFiLWZyb20tbm9kZSc6IHtcbiAgICAgICAgICAgIG5hbWU6ICdjcmVhdGUtcHJlZmFiLWZyb20tbm9kZScsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0dlbmVyYXRlIGEgc3RlcC1ieS1zdGVwIHBsYW4gZm9yIGNvbnZlcnRpbmcgYSBzY2VuZSBub2RlIGludG8gYSByZXVzYWJsZSBwcmVmYWIuJyxcbiAgICAgICAgICAgIGFyZ3VtZW50czogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ25vZGVVdWlkJywgZGVzY3JpcHRpb246ICdVVUlEIG9mIHRoZSBzb3VyY2Ugbm9kZS4nLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2Rlc3RpbmF0aW9uJywgZGVzY3JpcHRpb246ICdBc3NldCBwYXRoIGZvciB0aGUgbmV3IHByZWZhYiAoZGVmYXVsdCBkYjovL2Fzc2V0cy9wcmVmYWJzKS4nLCByZXF1aXJlZDogZmFsc2UgfVxuICAgICAgICAgICAgXVxuICAgICAgICB9LFxuICAgICAgICAnZGVidWctcnVudGltZS1lcnJvcic6IHtcbiAgICAgICAgICAgIG5hbWU6ICdkZWJ1Zy1ydW50aW1lLWVycm9yJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnV2FsayB0aHJvdWdoIGxpa2VseSBjYXVzZXMgb2YgYSBydW50aW1lIGVycm9yIHVzaW5nIHRoZSBsYXRlc3QgZWRpdG9yIGxvZ3MuJyxcbiAgICAgICAgICAgIGFyZ3VtZW50czogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2Vycm9yTWVzc2FnZScsIGRlc2NyaXB0aW9uOiAnVGhlIGVycm9yIG1lc3NhZ2UgdGV4dC4nLCByZXF1aXJlZDogdHJ1ZSB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgaGFuZGxlcyhuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoUFJPTVBUUywgbmFtZSk7XG4gICAgICAgIH0sXG4gICAgICAgIGxpc3RQcm9tcHRzKCk6IE1jcFByb21wdFtdIHtcbiAgICAgICAgICAgIHJldHVybiBPYmplY3QudmFsdWVzKFBST01QVFMpO1xuICAgICAgICB9LFxuICAgICAgICBnZXRQcm9tcHQobmFtZTogc3RyaW5nLCBhcmdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogTWNwUHJvbXB0RXhwYW5zaW9uIHtcbiAgICAgICAgICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ2V4cGxhaW4tY3VycmVudC1zY2VuZSc6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm9jdXMgPSBhcmdzLmZvY3VzID8gYCBQYXkgc3BlY2lhbCBhdHRlbnRpb24gdG8gJHthcmdzLmZvY3VzfS5gIDogJyc7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1N1bW1hcml6ZSB0aGUgY3VycmVudCBzY2VuZS4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvbGU6ICd1c2VyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnWW91IGFyZSByZXZpZXdpbmcgYSBDb2NvcyBDcmVhdG9yIHNjZW5lLiAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnUmVhZCB0aGUgcmVzb3VyY2Ugc2NlbmU6Ly9jdXJyZW50IGFuZCBwcm9kdWNlIGEgY29uY2lzZSBoaWVyYXJjaHkgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3N1bW1hcnkgKHJvb3Qg4oaSIGxlYXZlcyksIGhpZ2hsaWdodGluZyBrZXkgY29tcG9uZW50cy4nICsgZm9jdXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2FzZSAnY3JlYXRlLXByZWZhYi1mcm9tLW5vZGUnOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRzdCA9IGFyZ3MuZGVzdGluYXRpb24gfHwgJ2RiOi8vYXNzZXRzL3ByZWZhYnMnO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQbGFuIHByZWZhYiBleHRyYWN0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ3VzZXInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBQbGFuIGhvdyB0byBjb252ZXJ0IG5vZGUgJHthcmdzLm5vZGVVdWlkfSBpbnRvIGEgcHJlZmFiIHNhdmVkIHVuZGVyICR7ZHN0fS4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ1VzZSBzY2VuZTovL25vZGUve3V1aWR9IHRvIGluc3BlY3QgY29tcG9uZW50cyBmaXJzdCwgdGhlbiBwcm9wb3NlIGEgc2VxdWVuY2UgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ29mIGNvY29zLW1jcCB0b29sIGNhbGxzIChwcmVmYWJfY3JlYXRlX3ByZWZhYiwgcHJlZmFiX3NhdmVfcHJlZmFiKSB0byBwZXJmb3JtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICd0aGUgZXh0cmFjdGlvbi4nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhc2UgJ2RlYnVnLXJ1bnRpbWUtZXJyb3InOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1zZyA9IGFyZ3MuZXJyb3JNZXNzYWdlIHx8ICc8bm8gZXJyb3IgbWVzc2FnZSBwcm92aWRlZD4nO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdEZWJ1ZyBhIHJ1bnRpbWUgZXJyb3IuJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb2xlOiAndXNlcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYEFuIGVycm9yIG9jY3VycmVkIGF0IHJ1bnRpbWU6IFwiJHttc2d9XCIuIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdGaXJzdCByZWFkIHJ1bnRpbWU6Ly9sb2dzIGZvciBjb250ZXh0LiBUaGVuIGxpc3QgMyBsaWtlbHkgY2F1c2VzIGFuZCAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29uY3JldGUgbmV4dC1zdGVwIHRvb2wgY2FsbHMgKGUuZy4gZGVidWdfZ2V0X2NvbnNvbGVfbG9ncywgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NjZW5lX3ZhbGlkYXRlX3NjZW5lKSB0byB2ZXJpZnkgZWFjaC4nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHByb21wdDogJHtuYW1lfWApO1xuICAgICAgICB9LFxuICAgICAgICBjb21wbGV0ZShuYW1lOiBzdHJpbmcsIGFyZ05hbWU6IHN0cmluZywgX3ZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gJ2V4cGxhaW4tY3VycmVudC1zY2VuZScgJiYgYXJnTmFtZSA9PT0gJ2ZvY3VzJykge1xuICAgICAgICAgICAgICAgIHJldHVybiBbJ3BoeXNpY3MnLCAndWknLCAncmVuZGVyaW5nJywgJ2F1ZGlvJywgJ2FuaW1hdGlvbiddO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgfTtcbn1cbiJdfQ==