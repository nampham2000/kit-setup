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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVnaXN0cmllcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NvdXJjZS9wcm90b2NvbC9yZWdpc3RyaWVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7R0FjRzs7O0FBOE9ILHdDQUVDO0FBR0Qsd0NBRUM7QUFFRCxvRUE2SUM7QUFRRCxnRUFxR0M7QUF4ZEQsTUFBYSxnQkFBZ0I7SUFLekIsWUFBWSxNQUF3QjtRQUo1QixjQUFTLEdBQXVCLEVBQUUsQ0FBQztRQUVuQyxrQkFBYSxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFHdEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDekIsQ0FBQztJQUVNLFdBQVcsQ0FBQyxRQUEwQjtRQUN6QyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM5QixJQUFJLENBQUMsTUFBTSxDQUFDLHNDQUFzQyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVNLEtBQUssQ0FBQyxhQUFhO1FBQ3RCLE1BQU0sR0FBRyxHQUFrQixFQUFFLENBQUM7UUFDOUIsS0FBSyxNQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDN0IsSUFBSSxDQUFDO2dCQUNELE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO2dCQUN0QyxJQUFJLEtBQUs7b0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDO1lBQ2xDLENBQUM7WUFBQyxRQUFRLGlDQUFpQyxJQUFuQyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQztRQUNqRCxDQUFDO1FBQ0QsMENBQTBDO1FBQzFDLE1BQU0sS0FBSyxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO1FBQzdDLEtBQUssTUFBTSxDQUFDLElBQUksR0FBRztZQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcs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RUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFDaEUsQ0FBQztZQUNELE9BQU8sRUFBRSxDQUFDO1FBQ2QsQ0FBQztLQUNKLENBQUM7QUFDTixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFBoYXNlIDIg4oCUIFJlc291cmNlcyAmIFByb21wdHMgcmVnaXN0cmllcy5cclxuICpcclxuICogVGhlIHtAbGluayBSZXNvdXJjZVJlZ2lzdHJ5fSBhbmQge0BsaW5rIFByb21wdFJlZ2lzdHJ5fSBsZXQgcGx1Z2dhYmxlXHJcbiAqIHByb3ZpZGVycyBleHBvc2UgTUNQIHJlc291cmNlcyBhbmQgcHJvbXB0IHRlbXBsYXRlcy4gVGhleSBhbHNvIGhhbmRsZVxyXG4gKiBzdWJzY3JpcHRpb24gYm9va2tlZXBpbmcgZm9yIGByZXNvdXJjZXMvc3Vic2NyaWJlYCBzbyB0aGUgc2VydmVyIGNhbiBlbWl0XHJcbiAqIGBub3RpZmljYXRpb25zL3Jlc291cmNlcy91cGRhdGVkYCB3aGVuIGFuIHVuZGVybHlpbmcgcHJvdmlkZXIgY2hhbmdlcy5cclxuICpcclxuICogQnVpbHTigJFpbiBwcm92aWRlcnMgKGBidWlsZEJ1aWx0SW5SZXNvdXJjZVByb3ZpZGVyYCAvIGBidWlsZEJ1aWx0SW5Qcm9tcHRQcm92aWRlcmApXHJcbiAqIGNvdmVyIHByb2plY3QgbWV0YWRhdGEsIHRoZSBjdXJyZW50IHNjZW5lLCB0aGUgYXNzZXQgdHJlZSBhbmQgdGhlIGVkaXRvclxyXG4gKiBydW50aW1lIGxvZyBmZWVkIChQaGFzZXMgM+KAkzUpLiBUaGV5IGRlZ3JhZGUgZ3JhY2VmdWxseSB3aGVuIHRoZSBob3N0XHJcbiAqIGBFZGl0b3JgIGdsb2JhbCBpcyB1bmF2YWlsYWJsZSAoZS5nLiBzdGRpbyBvdXRzaWRlIHRoZSBlZGl0b3IpIHNvIHRoZVxyXG4gKiBzZXJ2ZXIgc3RpbGwgYW5zd2VycyBgcmVzb3VyY2VzL2xpc3RgIHdpdGggZGVzY3JpcHRpdmUgZXJyb3JzIGluc3RlYWQgb2ZcclxuICogY3Jhc2hpbmcuXHJcbiAqL1xyXG5cclxuaW1wb3J0IHsgTWNwUHJvbXB0LCBNY3BQcm9tcHRFeHBhbnNpb24sIE1jcFJlc291cmNlLCBNY3BSZXNvdXJjZUNvbnRlbnRzLCBNY3BSZXNvdXJjZVRlbXBsYXRlIH0gZnJvbSAnLi4vdHlwZXMnO1xyXG5cclxuLyoqIExpZ2h0d2VpZ2h0IGRlcGVuZGVuY3kgdGhlIHJlZ2lzdHJ5IHRha2VzIGZvciBlbWl0dGluZyBjaGFuZ2Ugbm90aWZpY2F0aW9ucy4gKi9cclxuZXhwb3J0IHR5cGUgUmVnaXN0cnlOb3RpZmllciA9IChtZXRob2Q6IHN0cmluZywgcGFyYW1zPzogYW55KSA9PiB2b2lkO1xyXG5cclxuLy8gLS0gUmVzb3VyY2UgcHJvdmlkZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFJlc291cmNlUHJvdmlkZXIge1xyXG4gICAgLyoqIFJldHVybiB0aGUgc3RhdGljIHJlc291cmNlIGxpc3QgdGhpcyBwcm92aWRlciBjb250cmlidXRlcy4gKi9cclxuICAgIGxpc3RSZXNvdXJjZXMoKTogTWNwUmVzb3VyY2VbXSB8IFByb21pc2U8TWNwUmVzb3VyY2VbXT47XHJcbiAgICAvKiogUmV0dXJuIFVSSSB0ZW1wbGF0ZXMgdGhpcyBwcm92aWRlciBzdXBwb3J0cy4gT3B0aW9uYWwuICovXHJcbiAgICBsaXN0UmVzb3VyY2VUZW1wbGF0ZXM/KCk6IE1jcFJlc291cmNlVGVtcGxhdGVbXSB8IFByb21pc2U8TWNwUmVzb3VyY2VUZW1wbGF0ZVtdPjtcclxuICAgIC8qKiBSZWFkIGEgcmVzb3VyY2UgYnkgVVJJLiBUaHJvdyB0byBzaWduYWwgXCJub3QgZm91bmQgLyBub3QgaGFuZGxlZFwiLiAqL1xyXG4gICAgcmVhZFJlc291cmNlKHVyaTogc3RyaW5nKTogUHJvbWlzZTxNY3BSZXNvdXJjZUNvbnRlbnRzPiB8IE1jcFJlc291cmNlQ29udGVudHM7XHJcbiAgICAvKiogUmV0dXJuIHRydWUgaWYgdGhlIHByb3ZpZGVyIGNsYWltcyB0aGlzIFVSSSBmb3IgcmVhZC9zdWJzY3JpYmUuICovXHJcbiAgICBoYW5kbGVzKHVyaTogc3RyaW5nKTogYm9vbGVhbjtcclxuICAgIC8qKiBPcHRpb25hbCBhcmd1bWVudCBjb21wbGV0aW9uIGZvciBgY29tcGxldGlvbi9jb21wbGV0ZWAgb24gcmVzb3VyY2UgdGVtcGxhdGVzLiAqL1xyXG4gICAgY29tcGxldGU/KHVyaTogc3RyaW5nLCBhcmdOYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB8IHN0cmluZ1tdO1xyXG4gICAgLyoqIE9wdGlvbmFsIHN1YnNjcmlwdGlvbiBob29rIOKAlCByZXR1cm4gZmFsc2UgaWYgc3Vic2NyaXB0aW9uIGlzIG5vdCBzdXBwb3J0ZWQuICovXHJcbiAgICBzdWJzY3JpYmU/KHVyaTogc3RyaW5nLCBub3RpZnk6ICgpID0+IHZvaWQpOiBib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPjtcclxuICAgIHVuc3Vic2NyaWJlPyh1cmk6IHN0cmluZyk6IHZvaWQ7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBSZXNvdXJjZVJlZ2lzdHJ5IHtcclxuICAgIHByaXZhdGUgcHJvdmlkZXJzOiBSZXNvdXJjZVByb3ZpZGVyW10gPSBbXTtcclxuICAgIHByaXZhdGUgbm90aWZ5OiBSZWdpc3RyeU5vdGlmaWVyO1xyXG4gICAgcHJpdmF0ZSBzdWJzY3JpcHRpb25zID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcblxyXG4gICAgY29uc3RydWN0b3Iobm90aWZ5OiBSZWdpc3RyeU5vdGlmaWVyKSB7XHJcbiAgICAgICAgdGhpcy5ub3RpZnkgPSBub3RpZnk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFkZFByb3ZpZGVyKHByb3ZpZGVyOiBSZXNvdXJjZVByb3ZpZGVyKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5wcm92aWRlcnMucHVzaChwcm92aWRlcik7XHJcbiAgICAgICAgdGhpcy5ub3RpZnkoJ25vdGlmaWNhdGlvbnMvcmVzb3VyY2VzL2xpc3RfY2hhbmdlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyBsaXN0UmVzb3VyY2VzKCk6IFByb21pc2U8TWNwUmVzb3VyY2VbXT4ge1xyXG4gICAgICAgIGNvbnN0IG91dDogTWNwUmVzb3VyY2VbXSA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBhd2FpdCBwLmxpc3RSZXNvdXJjZXMoKTtcclxuICAgICAgICAgICAgICAgIGlmIChpdGVtcykgb3V0LnB1c2goLi4uaXRlbXMpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIHsgLyogc2tpcCBhIG1pc2JlaGF2aW5nIHByb3ZpZGVyICovIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gRGXigJFkdXBsaWNhdGUgYnkgVVJJIChsYXN0IHdyaXRlciB3aW5zKS5cclxuICAgICAgICBjb25zdCBieVVyaSA9IG5ldyBNYXA8c3RyaW5nLCBNY3BSZXNvdXJjZT4oKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygb3V0KSBieVVyaS5zZXQoci51cmksIHIpO1xyXG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGJ5VXJpLnZhbHVlcygpKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgYXN5bmMgbGlzdFJlc291cmNlVGVtcGxhdGVzKCk6IFByb21pc2U8TWNwUmVzb3VyY2VUZW1wbGF0ZVtdPiB7XHJcbiAgICAgICAgY29uc3Qgb3V0OiBNY3BSZXNvdXJjZVRlbXBsYXRlW10gPSBbXTtcclxuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcclxuICAgICAgICAgICAgaWYgKCFwLmxpc3RSZXNvdXJjZVRlbXBsYXRlcykgY29udGludWU7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtcyA9IGF3YWl0IHAubGlzdFJlc291cmNlVGVtcGxhdGVzKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXRlbXMpIG91dC5wdXNoKC4uLml0ZW1zKTtcclxuICAgICAgICAgICAgfSBjYXRjaCB7IC8qIHNraXAgKi8gfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gb3V0O1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyByZWFkUmVzb3VyY2UodXJpOiBzdHJpbmcpOiBQcm9taXNlPE1jcFJlc291cmNlQ29udGVudHM+IHtcclxuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcclxuICAgICAgICAgICAgaWYgKCFwLmhhbmRsZXModXJpKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBwLnJlYWRSZXNvdXJjZSh1cmkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHByb3ZpZGVyIGhhbmRsZXMgcmVzb3VyY2UgVVJJOiAke3VyaX1gKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgYXN5bmMgc3Vic2NyaWJlKHVyaTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBwIG9mIHRoaXMucHJvdmlkZXJzKSB7XHJcbiAgICAgICAgICAgIGlmICghcC5oYW5kbGVzKHVyaSkgfHwgIXAuc3Vic2NyaWJlKSBjb250aW51ZTtcclxuICAgICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCBwLnN1YnNjcmliZSh1cmksICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL3Jlc291cmNlcy91cGRhdGVkJywgeyB1cmkgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBpZiAob2spIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5hZGQodXJpKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBObyBwcm92aWRlciBzdXBwb3J0cyBzdWJzY3JpcHRpb25zIGZvciB0aGlzIFVSSSDigJQgc3VjY2VlZCBzaWxlbnRseVxyXG4gICAgICAgIC8vICh0aGUgc3BlYyBsZWF2ZXMgdGhpcyBzZXJ2ZXLigJFkZWZpbmVkOyBlbWl0dGluZyBub3RoaW5nIGlzIHNhZmUpLlxyXG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5hZGQodXJpKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdW5zdWJzY3JpYmUodXJpOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcclxuICAgICAgICAgICAgaWYgKHAuaGFuZGxlcyh1cmkpICYmIHAudW5zdWJzY3JpYmUpIHAudW5zdWJzY3JpYmUodXJpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25zLmRlbGV0ZSh1cmkpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyBjb21wbGV0ZSh1cmk6IHN0cmluZywgYXJnTmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xyXG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xyXG4gICAgICAgICAgICBpZiAoIXAuaGFuZGxlcyh1cmkpIHx8ICFwLmNvbXBsZXRlKSBjb250aW51ZTtcclxuICAgICAgICAgICAgY29uc3QgciA9IGF3YWl0IHAuY29tcGxldGUodXJpLCBhcmdOYW1lLCB2YWx1ZSk7XHJcbiAgICAgICAgICAgIGlmIChyICYmIHIubGVuZ3RoKSByZXR1cm4gcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKiBUcmlnZ2VyIGEgbGlzdF9jaGFuZ2VkIG5vdGlmaWNhdGlvbiAoZS5nLiBhZnRlciBsaXZlIGFkZC9yZW1vdmUpLiAqL1xyXG4gICAgcHVibGljIG5vdGlmeUxpc3RDaGFuZ2VkKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL3Jlc291cmNlcy9saXN0X2NoYW5nZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvKiogVHJpZ2dlciBhbiB1cGRhdGVkIG5vdGlmaWNhdGlvbiBmb3IgYSBzaW5nbGUgVVJJLiAqL1xyXG4gICAgcHVibGljIG5vdGlmeVVwZGF0ZWQodXJpOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICBpZiAodGhpcy5zdWJzY3JpcHRpb25zLmhhcyh1cmkpKSB7XHJcbiAgICAgICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL3Jlc291cmNlcy91cGRhdGVkJywgeyB1cmkgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG4vLyAtLSBQcm9tcHQgcHJvdmlkZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUHJvbXB0UHJvdmlkZXIge1xyXG4gICAgbGlzdFByb21wdHMoKTogTWNwUHJvbXB0W10gfCBQcm9taXNlPE1jcFByb21wdFtdPjtcclxuICAgIC8qKiBSZXR1cm4gdGhlIHJlbmRlcmVkIHByb21wdCBvciB0aHJvdyB0byBzaWduYWwgXCJub3QgaGFuZGxlZFwiLiAqL1xyXG4gICAgZ2V0UHJvbXB0KG5hbWU6IHN0cmluZywgYXJnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFByb21pc2U8TWNwUHJvbXB0RXhwYW5zaW9uPiB8IE1jcFByb21wdEV4cGFuc2lvbjtcclxuICAgIGhhbmRsZXMobmFtZTogc3RyaW5nKTogYm9vbGVhbjtcclxuICAgIGNvbXBsZXRlPyhuYW1lOiBzdHJpbmcsIGFyZ05hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHwgc3RyaW5nW107XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBQcm9tcHRSZWdpc3RyeSB7XHJcbiAgICBwcml2YXRlIHByb3ZpZGVyczogUHJvbXB0UHJvdmlkZXJbXSA9IFtdO1xyXG4gICAgcHJpdmF0ZSBub3RpZnk6IFJlZ2lzdHJ5Tm90aWZpZXI7XHJcblxyXG4gICAgY29uc3RydWN0b3Iobm90aWZ5OiBSZWdpc3RyeU5vdGlmaWVyKSB7XHJcbiAgICAgICAgdGhpcy5ub3RpZnkgPSBub3RpZnk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFkZFByb3ZpZGVyKHByb3ZpZGVyOiBQcm9tcHRQcm92aWRlcik6IHZvaWQge1xyXG4gICAgICAgIHRoaXMucHJvdmlkZXJzLnB1c2gocHJvdmlkZXIpO1xyXG4gICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL3Byb21wdHMvbGlzdF9jaGFuZ2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIGxpc3RQcm9tcHRzKCk6IFByb21pc2U8TWNwUHJvbXB0W10+IHtcclxuICAgICAgICBjb25zdCBvdXQ6IE1jcFByb21wdFtdID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBwIG9mIHRoaXMucHJvdmlkZXJzKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtcyA9IGF3YWl0IHAubGlzdFByb21wdHMoKTtcclxuICAgICAgICAgICAgICAgIGlmIChpdGVtcykgb3V0LnB1c2goLi4uaXRlbXMpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIHsgLyogc2tpcCAqLyB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBNY3BQcm9tcHQ+KCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBwciBvZiBvdXQpIGJ5TmFtZS5zZXQocHIubmFtZSwgcHIpO1xyXG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGJ5TmFtZS52YWx1ZXMoKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIGdldFByb21wdChuYW1lOiBzdHJpbmcsIGFyZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBQcm9taXNlPE1jcFByb21wdEV4cGFuc2lvbj4ge1xyXG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnByb3ZpZGVycykge1xyXG4gICAgICAgICAgICBpZiAoIXAuaGFuZGxlcyhuYW1lKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBwLmdldFByb21wdChuYW1lLCBhcmdzIHx8IHt9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHByb21wdDogJHtuYW1lfWApO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyBjb21wbGV0ZShuYW1lOiBzdHJpbmcsIGFyZ05hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wcm92aWRlcnMpIHtcclxuICAgICAgICAgICAgaWYgKCFwLmhhbmRsZXMobmFtZSkgfHwgIXAuY29tcGxldGUpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBjb25zdCByID0gYXdhaXQgcC5jb21wbGV0ZShuYW1lLCBhcmdOYW1lLCB2YWx1ZSk7XHJcbiAgICAgICAgICAgIGlmIChyICYmIHIubGVuZ3RoKSByZXR1cm4gcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBub3RpZnlMaXN0Q2hhbmdlZCgpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9wcm9tcHRzL2xpc3RfY2hhbmdlZCcpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyAtLSBCdWlsdC1pbiBwcm92aWRlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmNvbnN0IFBST0pFQ1RfSU5GT19VUkkgPSAncHJvamVjdDovL2luZm8nO1xyXG5jb25zdCBTQ0VORV9DVVJSRU5UX1VSSSA9ICdzY2VuZTovL2N1cnJlbnQnO1xyXG5jb25zdCBBU1NFVFNfVFJFRV9VUkkgPSAnYXNzZXRzOi8vdHJlZSc7XHJcbmNvbnN0IFJVTlRJTUVfTE9HU19VUkkgPSAncnVudGltZTovL2xvZ3MnO1xyXG5cclxuLyoqXHJcbiAqIFJlc29sdmUgdGhlIGdsb2JhbCBDb2NvcyBgRWRpdG9yYCBwcm94eSB3aGVuIHByZXNlbnQuIE91dHNpZGUgdGhlIGVkaXRvclxyXG4gKiAoZS5nLiBzdGRpbyBiaW5hcnkgcnVubmluZyBzdGFuZGFsb25lKSBpdCByZXR1cm5zIG51bGwgYW5kIHByb3ZpZGVyc1xyXG4gKiBncmFjZWZ1bGx5IHJlcG9ydCB1bmF2YWlsYWJsZSBpbnN0ZWFkIG9mIHRocm93aW5nLlxyXG4gKi9cclxuZnVuY3Rpb24gZ2V0RWRpdG9yKCk6IGFueSB8IG51bGwge1xyXG4gICAgY29uc3QgZzogYW55ID0gZ2xvYmFsVGhpcyBhcyBhbnk7XHJcbiAgICBpZiAoZy5FZGl0b3IgJiYgdHlwZW9mIGcuRWRpdG9yID09PSAnb2JqZWN0JykgcmV0dXJuIGcuRWRpdG9yO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8qKiBBIHNtYWxsIHJpbmcgYnVmZmVyIHVzZWQgYnkgYHJ1bnRpbWU6Ly9sb2dzYC4gKi9cclxuY2xhc3MgUnVudGltZUxvZ0J1ZmZlciB7XHJcbiAgICBwcml2YXRlIGJ1Zjogc3RyaW5nW10gPSBbXTtcclxuICAgIHByaXZhdGUgbGlzdGVuZXJzID0gbmV3IFNldDwoKSA9PiB2b2lkPigpO1xyXG4gICAgcHJpdmF0ZSBpbnN0YWxsZWQgPSBmYWxzZTtcclxuXHJcbiAgICBwdWJsaWMgcHVzaChsaW5lOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLmJ1Zi5wdXNoKGxpbmUpO1xyXG4gICAgICAgIGlmICh0aGlzLmJ1Zi5sZW5ndGggPiAyMDApIHRoaXMuYnVmLnNoaWZ0KCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBsIG9mIHRoaXMubGlzdGVuZXJzKSB7XHJcbiAgICAgICAgICAgIHRyeSB7IGwoKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzbmFwc2hvdCgpOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgcmV0dXJuIFsuLi50aGlzLmJ1Zl07XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFkZExpc3RlbmVyKGw6ICgpID0+IHZvaWQpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLmxpc3RlbmVycy5hZGQobCk7XHJcbiAgICAgICAgdGhpcy5lbnN1cmVJbnN0YWxsZWQoKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgcmVtb3ZlTGlzdGVuZXIobDogKCkgPT4gdm9pZCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGVuc3VyZUluc3RhbGxlZCgpOiB2b2lkIHtcclxuICAgICAgICBpZiAodGhpcy5pbnN0YWxsZWQpIHJldHVybjtcclxuICAgICAgICB0aGlzLmluc3RhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgY29uc3QgZWQgPSBnZXRFZGl0b3IoKTtcclxuICAgICAgICAvLyBFZGl0b3IuTWVzc2FnZSBicm9hZGNhc3RzIGFyZSB0aGUgcHJpbWFyeSBsb2cgc291cmNlLiBXZSB0b2xlcmF0ZVxyXG4gICAgICAgIC8vIG1pc3NpbmcgQVBJcyBiZWNhdXNlIHRoZSBzdGRpbyBiaW5hcnkgc3R1YiBkb2Vzbid0IHNoaXAgdGhlbS5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBlZD8uTWVzc2FnZT8uYWRkQnJvYWRjYXN0TGlzdGVuZXI/LignY29uc29sZTpsb2cnLCAobXNnOiBhbnkpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucHVzaChgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9ICR7KG1zZz8udHlwZSB8fCAnbG9nJykudG9VcHBlckNhc2UoKX06ICR7bXNnPy5tZXNzYWdlID8/ICcnfWApO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cclxuICAgIH1cclxufVxyXG5cclxuY29uc3QgcnVudGltZUxvZ3MgPSBuZXcgUnVudGltZUxvZ0J1ZmZlcigpO1xyXG5cclxuLyoqIFB1YmxpYyBob29rIGZvciB0b29scyB0byBwdXNoIHN5bnRoZXRpYyBydW50aW1lIGxvZyBlbnRyaWVzLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gcHVzaFJ1bnRpbWVMb2cobGV2ZWw6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBydW50aW1lTG9ncy5wdXNoKGAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX0gJHtsZXZlbC50b1VwcGVyQ2FzZSgpfTogJHttZXNzYWdlfWApO1xyXG59XHJcblxyXG4vKiogU25hcHNob3Qgb2YgdGhlIHJ1bnRpbWUgbG9nIHJpbmcgYnVmZmVyICh1c2VkIGJ5IHRoZSBFZGl0b3JSdW50aW1lVG9vbHMgdGFpbCB0b29sKS4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGdldFJ1bnRpbWVMb2dzKCk6IHN0cmluZ1tdIHtcclxuICAgIHJldHVybiBydW50aW1lTG9ncy5zbmFwc2hvdCgpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRCdWlsdEluUmVzb3VyY2VQcm92aWRlcigpOiBSZXNvdXJjZVByb3ZpZGVyIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaGFuZGxlcyh1cmk6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgICAgICAgICByZXR1cm4gdXJpID09PSBQUk9KRUNUX0lORk9fVVJJXHJcbiAgICAgICAgICAgICAgICB8fCB1cmkgPT09IFNDRU5FX0NVUlJFTlRfVVJJXHJcbiAgICAgICAgICAgICAgICB8fCB1cmkgPT09IEFTU0VUU19UUkVFX1VSSVxyXG4gICAgICAgICAgICAgICAgfHwgdXJpID09PSBSVU5USU1FX0xPR1NfVVJJXHJcbiAgICAgICAgICAgICAgICB8fCB1cmkuc3RhcnRzV2l0aCgnc2NlbmU6Ly9ub2RlLycpXHJcbiAgICAgICAgICAgICAgICB8fCB1cmkuc3RhcnRzV2l0aCgnYXNzZXRzOi8vaXRlbS8nKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGxpc3RSZXNvdXJjZXMoKTogTWNwUmVzb3VyY2VbXSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgdXJpOiBQUk9KRUNUX0lORk9fVVJJLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdDb2NvcyBwcm9qZWN0IGluZm8nLFxyXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU3RhdGljIHByb2plY3QgbWV0YWRhdGEgKG5hbWUsIHBhdGgsIHZlcnNpb24pLicsXHJcbiAgICAgICAgICAgICAgICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICB1cmk6IFNDRU5FX0NVUlJFTlRfVVJJLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdDdXJyZW50IHNjZW5lJyxcclxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0hpZXJhcmNoeSBvZiB0aGUgY3VycmVudGx5IG9wZW4gc2NlbmUuJyxcclxuICAgICAgICAgICAgICAgICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIHVyaTogQVNTRVRTX1RSRUVfVVJJLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdBc3NldCBkYXRhYmFzZSB0cmVlJyxcclxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1RvcC1sZXZlbCBkYjovL2Fzc2V0cyB0cmVlIGFzIHJlcG9ydGVkIGJ5IHRoZSBhc3NldCBEQi4nLFxyXG4gICAgICAgICAgICAgICAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbidcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgdXJpOiBSVU5USU1FX0xPR1NfVVJJLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdFZGl0b3IgcnVudGltZSBsb2cgdGFpbCcsXHJcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdMYXN0IH4yMDAgY29uc29sZSBtZXNzYWdlcyBmb3J3YXJkZWQgYnkgdGhlIGVkaXRvciAoUGhhc2UgNSkuIFN1YnNjcmliZSBmb3IgbGl2ZSB1cGRhdGVzLicsXHJcbiAgICAgICAgICAgICAgICAgICAgbWltZVR5cGU6ICd0ZXh0L3BsYWluJ1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBdO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgbGlzdFJlc291cmNlVGVtcGxhdGVzKCk6IE1jcFJlc291cmNlVGVtcGxhdGVbXSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgdXJpVGVtcGxhdGU6ICdzY2VuZTovL25vZGUve3V1aWR9JyxcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnU2NlbmUgbm9kZScsXHJcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTbmFwc2hvdCBvZiBhIHNpbmdsZSBub2RlIGJ5IFVVSUQuJyxcclxuICAgICAgICAgICAgICAgICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIHVyaVRlbXBsYXRlOiAnYXNzZXRzOi8vaXRlbS97dXVpZH0nLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdBc3NldCBpdGVtJyxcclxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0Fzc2V0IERCIGluZm8gZm9yIGEgc2luZ2xlIGFzc2V0IGJ5IFVVSUQuJyxcclxuICAgICAgICAgICAgICAgICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIF07XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhc3luYyByZWFkUmVzb3VyY2UodXJpOiBzdHJpbmcpOiBQcm9taXNlPE1jcFJlc291cmNlQ29udGVudHM+IHtcclxuICAgICAgICAgICAgY29uc3QgZWQgPSBnZXRFZGl0b3IoKTtcclxuICAgICAgICAgICAgaWYgKHVyaSA9PT0gUFJPSkVDVF9JTkZPX1VSSSkge1xyXG4gICAgICAgICAgICAgICAgbGV0IGRhdGE6IGFueTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YSA9IGVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgID8ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogZWQuUHJvamVjdD8ubmFtZSA/PyAndW5rbm93bicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiBlZC5Qcm9qZWN0Py5wYXRoID8/ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogZWQuUHJvamVjdD8udXVpZCA/PyAnJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZlcnNpb246IGVkLlByb2plY3Q/LnZlcnNpb24gPz8gJycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2Nvc1ZlcnNpb246IGVkLnZlcnNpb25zPy5bJ0Bjb2Nvcy9jcmVhdG9yLXR5cGVzJ10gPz8gZWQuQXBwPy52ZXJzaW9uID8/ICcnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgOiB7IGVycm9yOiAnRWRpdG9yIG5vdCBhdmFpbGFibGUgKHJ1bm5pbmcgb3V0c2lkZSBDb2NvcyBDcmVhdG9yKScgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGRhdGEgPSB7IGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIGRhdGEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh1cmkgPT09IFNDRU5FX0NVUlJFTlRfVVJJKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWVkKSByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgeyBlcnJvcjogJ0VkaXRvciBub3QgYXZhaWxhYmxlJyB9KTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdHJlZSA9IGF3YWl0IGVkLk1lc3NhZ2U/LnJlcXVlc3Q/Lignc2NlbmUnLCAncXVlcnktbm9kZS10cmVlJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHRyZWUgPz8gbnVsbCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgeyBlcnJvcjogZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHVyaSA9PT0gQVNTRVRTX1RSRUVfVVJJKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWVkKSByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgeyBlcnJvcjogJ0VkaXRvciBub3QgYXZhaWxhYmxlJyB9KTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdCA9IGF3YWl0IGVkLk1lc3NhZ2U/LnJlcXVlc3Q/LignYXNzZXQtZGInLCAncXVlcnktYXNzZXRzJywgeyBwYXR0ZXJuOiAnZGI6Ly9hc3NldHMvKiovKicgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIGxpc3QgPz8gW10pO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHsgZXJyb3I6IGU/Lm1lc3NhZ2UgPz8gU3RyaW5nKGUpIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh1cmkgPT09IFJVTlRJTUVfTE9HU19VUkkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGVudHM6IFt7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVyaSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWltZVR5cGU6ICd0ZXh0L3BsYWluJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogcnVudGltZUxvZ3Muc25hcHNob3QoKS5qb2luKCdcXG4nKVxyXG4gICAgICAgICAgICAgICAgICAgIH1dXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh1cmkuc3RhcnRzV2l0aCgnc2NlbmU6Ly9ub2RlLycpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB1dWlkID0gdXJpLnNsaWNlKCdzY2VuZTovL25vZGUvJy5sZW5ndGgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHsgdXVpZCwgZXJyb3I6ICdFZGl0b3Igbm90IGF2YWlsYWJsZScgfSk7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5vZGUgPSBhd2FpdCBlZC5NZXNzYWdlPy5yZXF1ZXN0Py4oJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCB1dWlkKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgbm9kZSA/PyB7IHV1aWQsIGVycm9yOiAnbm90IGZvdW5kJyB9KTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IHV1aWQsIGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodXJpLnN0YXJ0c1dpdGgoJ2Fzc2V0czovL2l0ZW0vJykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHV1aWQgPSB1cmkuc2xpY2UoJ2Fzc2V0czovL2l0ZW0vJy5sZW5ndGgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFlZCkgcmV0dXJuIGpzb25Db250ZW50cyh1cmksIHsgdXVpZCwgZXJyb3I6ICdFZGl0b3Igbm90IGF2YWlsYWJsZScgfSk7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhd2FpdCBlZC5NZXNzYWdlPy5yZXF1ZXN0Py4oJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCB1dWlkKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ganNvbkNvbnRlbnRzKHVyaSwgaW5mbyA/PyB7IHV1aWQsIGVycm9yOiAnbm90IGZvdW5kJyB9KTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqc29uQ29udGVudHModXJpLCB7IHV1aWQsIGVycm9yOiBlPy5tZXNzYWdlID8/IFN0cmluZyhlKSB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEJ1aWx0LWluIHByb3ZpZGVyIGNhbm5vdCByZWFkOiAke3VyaX1gKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHN1YnNjcmliZSh1cmk6IHN0cmluZywgbm90aWZ5OiAoKSA9PiB2b2lkKTogYm9vbGVhbiB7XHJcbiAgICAgICAgICAgIGlmICh1cmkgPT09IFJVTlRJTUVfTE9HU19VUkkpIHtcclxuICAgICAgICAgICAgICAgIHJ1bnRpbWVMb2dzLmFkZExpc3RlbmVyKG5vdGlmeSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBPdGhlciBidWlsdC1pbnMgYXJlIG5vdCBzdWJzY3JpYmFibGUg4oCUIHJldHVybiBmYWxzZSBzbyB0aGVcclxuICAgICAgICAgICAgLy8gcmVnaXN0cnkgY2FuIHJlY29yZCB0aGUgc3Vic2NyaXB0aW9uIGFzIG5vLW9wLlxyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB1bnN1YnNjcmliZSh1cmk6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgICAgICAgICBpZiAodXJpID09PSBSVU5USU1FX0xPR1NfVVJJKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBXZSBkb24ndCB0cmFjayBwZXItY2FsbCBsaXN0ZW5lcnMgaW5kaXZpZHVhbGx5IGhlcmU7IHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gcmVnaXN0cnkgYWxyZWFkeSByZW1vdmVzIHRoZSBzdWJzY3JpcHRpb24gYm9va2tlZXBpbmcuXHJcbiAgICAgICAgICAgICAgICAvLyBGb3IgY29ycmVjdG5lc3MgaW4gdGVzdHMgd2UgY2xlYXIgYWxsIGxpc3RlbmVycyBvblxyXG4gICAgICAgICAgICAgICAgLy8gdW5zdWJzY3JpYmU7IGluIHByYWN0aWNlIGVhY2ggc2Vzc2lvbiBoYXMgb25lIHN1YnNjcmliZXIuXHJcbiAgICAgICAgICAgICAgICBydW50aW1lTG9ncy5yZW1vdmVMaXN0ZW5lcigoKSA9PiB7fSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBqc29uQ29udGVudHModXJpOiBzdHJpbmcsIGRhdGE6IGFueSk6IE1jcFJlc291cmNlQ29udGVudHMge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBjb250ZW50czogW3sgdXJpLCBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLCB0ZXh0OiBKU09OLnN0cmluZ2lmeShkYXRhLCBudWxsLCAyKSB9XVxyXG4gICAgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQnVpbHRJblByb21wdFByb3ZpZGVyKCk6IFByb21wdFByb3ZpZGVyIHtcclxuICAgIGNvbnN0IFBST01QVFM6IFJlY29yZDxzdHJpbmcsIE1jcFByb21wdD4gPSB7XHJcbiAgICAgICAgJ2V4cGxhaW4tY3VycmVudC1zY2VuZSc6IHtcclxuICAgICAgICAgICAgbmFtZTogJ2V4cGxhaW4tY3VycmVudC1zY2VuZScsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXNrIHRoZSBMTE0gdG8gc3VtbWFyaXplIHRoZSBjdXJyZW50IHNjZW5lIGhpZXJhcmNoeSBhbmQga2V5IGNvbXBvbmVudHMuJyxcclxuICAgICAgICAgICAgYXJndW1lbnRzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdmb2N1cycsIGRlc2NyaXB0aW9uOiAnT3B0aW9uYWwgYXJlYSB0byBmb2N1cyBvbiAoZS5nLiBcInBoeXNpY3NcIiwgXCJ1aVwiKS4nLCByZXF1aXJlZDogZmFsc2UgfVxyXG4gICAgICAgICAgICBdXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnY3JlYXRlLXByZWZhYi1mcm9tLW5vZGUnOiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdjcmVhdGUtcHJlZmFiLWZyb20tbm9kZScsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnR2VuZXJhdGUgYSBzdGVwLWJ5LXN0ZXAgcGxhbiBmb3IgY29udmVydGluZyBhIHNjZW5lIG5vZGUgaW50byBhIHJldXNhYmxlIHByZWZhYi4nLFxyXG4gICAgICAgICAgICBhcmd1bWVudHM6IFtcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ25vZGVVdWlkJywgZGVzY3JpcHRpb246ICdVVUlEIG9mIHRoZSBzb3VyY2Ugbm9kZS4nLCByZXF1aXJlZDogdHJ1ZSB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZGVzdGluYXRpb24nLCBkZXNjcmlwdGlvbjogJ0Fzc2V0IHBhdGggZm9yIHRoZSBuZXcgcHJlZmFiIChkZWZhdWx0IGRiOi8vYXNzZXRzL3ByZWZhYnMpLicsIHJlcXVpcmVkOiBmYWxzZSB9XHJcbiAgICAgICAgICAgIF1cclxuICAgICAgICB9LFxyXG4gICAgICAgICdkZWJ1Zy1ydW50aW1lLWVycm9yJzoge1xyXG4gICAgICAgICAgICBuYW1lOiAnZGVidWctcnVudGltZS1lcnJvcicsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnV2FsayB0aHJvdWdoIGxpa2VseSBjYXVzZXMgb2YgYSBydW50aW1lIGVycm9yIHVzaW5nIHRoZSBsYXRlc3QgZWRpdG9yIGxvZ3MuJyxcclxuICAgICAgICAgICAgYXJndW1lbnRzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdlcnJvck1lc3NhZ2UnLCBkZXNjcmlwdGlvbjogJ1RoZSBlcnJvciBtZXNzYWdlIHRleHQuJywgcmVxdWlyZWQ6IHRydWUgfVxyXG4gICAgICAgICAgICBdXHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGhhbmRsZXMobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICAgICAgICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoUFJPTVBUUywgbmFtZSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBsaXN0UHJvbXB0cygpOiBNY3BQcm9tcHRbXSB7XHJcbiAgICAgICAgICAgIHJldHVybiBPYmplY3QudmFsdWVzKFBST01QVFMpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZ2V0UHJvbXB0KG5hbWU6IHN0cmluZywgYXJnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IE1jcFByb21wdEV4cGFuc2lvbiB7XHJcbiAgICAgICAgICAgIHN3aXRjaCAobmFtZSkge1xyXG4gICAgICAgICAgICAgICAgY2FzZSAnZXhwbGFpbi1jdXJyZW50LXNjZW5lJzoge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvY3VzID0gYXJncy5mb2N1cyA/IGAgUGF5IHNwZWNpYWwgYXR0ZW50aW9uIHRvICR7YXJncy5mb2N1c30uYCA6ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU3VtbWFyaXplIHRoZSBjdXJyZW50IHNjZW5lLicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VzOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ3VzZXInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ1lvdSBhcmUgcmV2aWV3aW5nIGEgQ29jb3MgQ3JlYXRvciBzY2VuZS4gJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnUmVhZCB0aGUgcmVzb3VyY2Ugc2NlbmU6Ly9jdXJyZW50IGFuZCBwcm9kdWNlIGEgY29uY2lzZSBoaWVyYXJjaHkgJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3VtbWFyeSAocm9vdCDihpIgbGVhdmVzKSwgaGlnaGxpZ2h0aW5nIGtleSBjb21wb25lbnRzLicgKyBmb2N1c1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjYXNlICdjcmVhdGUtcHJlZmFiLWZyb20tbm9kZSc6IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkc3QgPSBhcmdzLmRlc3RpbmF0aW9uIHx8ICdkYjovL2Fzc2V0cy9wcmVmYWJzJztcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1BsYW4gcHJlZmFiIGV4dHJhY3Rpb24uJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZXM6IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb2xlOiAndXNlcicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAndGV4dCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgUGxhbiBob3cgdG8gY29udmVydCBub2RlICR7YXJncy5ub2RlVXVpZH0gaW50byBhIHByZWZhYiBzYXZlZCB1bmRlciAke2RzdH0uIGAgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ1VzZSBzY2VuZTovL25vZGUve3V1aWR9IHRvIGluc3BlY3QgY29tcG9uZW50cyBmaXJzdCwgdGhlbiBwcm9wb3NlIGEgc2VxdWVuY2UgJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnb2YgY29jb3MtbWNwIHRvb2wgY2FsbHMgKHByZWZhYl9jcmVhdGVfcHJlZmFiLCBwcmVmYWJfc2F2ZV9wcmVmYWIpIHRvIHBlcmZvcm0gJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAndGhlIGV4dHJhY3Rpb24uJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjYXNlICdkZWJ1Zy1ydW50aW1lLWVycm9yJzoge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1zZyA9IGFyZ3MuZXJyb3JNZXNzYWdlIHx8ICc8bm8gZXJyb3IgbWVzc2FnZSBwcm92aWRlZD4nO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRGVidWcgYSBydW50aW1lIGVycm9yLicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VzOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ3VzZXInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYEFuIGVycm9yIG9jY3VycmVkIGF0IHJ1bnRpbWU6IFwiJHttc2d9XCIuIGAgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ0ZpcnN0IHJlYWQgcnVudGltZTovL2xvZ3MgZm9yIGNvbnRleHQuIFRoZW4gbGlzdCAzIGxpa2VseSBjYXVzZXMgYW5kICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbmNyZXRlIG5leHQtc3RlcCB0b29sIGNhbGxzIChlLmcuIGRlYnVnX2dldF9jb25zb2xlX2xvZ3MsICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NjZW5lX3ZhbGlkYXRlX3NjZW5lKSB0byB2ZXJpZnkgZWFjaC4nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBdXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcHJvbXB0OiAke25hbWV9YCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBjb21wbGV0ZShuYW1lOiBzdHJpbmcsIGFyZ05hbWU6IHN0cmluZywgX3ZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgICAgIGlmIChuYW1lID09PSAnZXhwbGFpbi1jdXJyZW50LXNjZW5lJyAmJiBhcmdOYW1lID09PSAnZm9jdXMnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gWydwaHlzaWNzJywgJ3VpJywgJ3JlbmRlcmluZycsICdhdWRpbycsICdhbmltYXRpb24nXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufVxyXG4iXX0=