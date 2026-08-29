"use strict";
/**
 * Transport‑agnostic MCP protocol handler.
 *
 * The {@link ProtocolHandler} owns:
 *   - JSON‑RPC 2.0 message dispatch
 *   - The MCP capability handshake (`initialize`)
 *   - Tool listing with pagination cursors (G4)
 *   - Tool calls with Ajv input validation (G8) and AbortSignal cancellation (A8)
 *   - `logging/setLevel` + `notifications/message` (A6)
 *   - `notifications/progress` plumbing (A7)
 *   - protocolVersion negotiation + feature flags (G9)
 *
 * Transports (Streamable HTTP, stdio, future WebSocket) only need to push
 * incoming `string | object` messages into {@link ProtocolHandler.handle}
 * and forward emitted server notifications to their peer.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolHandler = exports.DEFAULT_PROTOCOL_VERSION = exports.SUPPORTED_PROTOCOL_VERSIONS = void 0;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const jsonrpc_1 = require("./jsonrpc");
const tool_hints_1 = require("./tool-hints");
// Protocol versions this server understands. The latest is preferred.
exports.SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
exports.DEFAULT_PROTOCOL_VERSION = exports.SUPPORTED_PROTOCOL_VERSIONS[0];
const LOG_LEVEL_ORDER = [
    'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'
];
function levelAtLeast(level, threshold) {
    return LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(threshold);
}
class ProtocolHandler {
    constructor(opts) {
        var _a, _b, _c, _d, _e;
        this.notifySink = null;
        this.inFlight = new Map();
        this.validators = new Map();
        this.negotiatedProtocolVersion = exports.DEFAULT_PROTOCOL_VERSION;
        this.clientCapabilities = {};
        /** In-flight server→client requests keyed by their outgoing id. */
        this.pendingRequests = new Map();
        this.nextOutgoingId = 1;
        this.registry = opts.registry;
        this.pageSize = Math.max(1, (_a = opts.pageSize) !== null && _a !== void 0 ? _a : 100);
        this.logLevel = (_b = opts.initialLogLevel) !== null && _b !== void 0 ? _b : 'info';
        this.extraCapabilities = opts.extraCapabilities || {};
        this.resources = (_c = opts.resources) !== null && _c !== void 0 ? _c : null;
        this.prompts = (_d = opts.prompts) !== null && _d !== void 0 ? _d : null;
        this.samplingTimeoutMs = Math.max(1000, (_e = opts.samplingTimeoutMs) !== null && _e !== void 0 ? _e : 60000);
        this.ajv = new ajv_1.default({ allErrors: true, strict: false, useDefaults: false });
        (0, ajv_formats_1.default)(this.ajv);
    }
    setNotificationSink(sink) {
        this.notifySink = sink;
    }
    setLogLevel(level) {
        this.logLevel = level;
    }
    getNegotiatedProtocolVersion() {
        return this.negotiatedProtocolVersion;
    }
    /** Cancel every in‑flight tool call. Used on transport shutdown. */
    cancelAll(reason = 'transport closed') {
        for (const [, ctrl] of this.inFlight) {
            try {
                ctrl.abort(new Error(reason));
            }
            catch ( /* noop */_a) { /* noop */ }
        }
        this.inFlight.clear();
        for (const [, p] of this.pendingRequests) {
            clearTimeout(p.timer);
            try {
                p.reject(new Error(reason));
            }
            catch ( /* noop */_b) { /* noop */ }
        }
        this.pendingRequests.clear();
    }
    /** Entry point for the transport. Returns the response (or null for notifications). */
    async handle(raw) {
        var _a;
        let message;
        if (typeof raw === 'string') {
            try {
                message = raw.length === 0 ? null : JSON.parse(raw);
            }
            catch (e) {
                return (0, jsonrpc_1.makeError)(null, jsonrpc_1.JSONRPC_PARSE_ERROR, `Parse error: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : 'invalid JSON'}`);
            }
        }
        else {
            message = raw;
        }
        if (Array.isArray(message)) {
            if (message.length === 0) {
                return (0, jsonrpc_1.makeError)(null, jsonrpc_1.JSONRPC_INVALID_REQUEST, 'Invalid Request: empty batch');
            }
            const out = [];
            for (const item of message) {
                const r = await this.handleSingle(item);
                if (r)
                    out.push(r);
            }
            return out.length ? out : null;
        }
        return this.handleSingle(message);
    }
    async handleSingle(message) {
        var _a, _b, _c, _d, _e;
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return (0, jsonrpc_1.makeError)(null, jsonrpc_1.JSONRPC_INVALID_REQUEST, 'Invalid Request');
        }
        if (message.jsonrpc !== jsonrpc_1.JSONRPC_VERSION) {
            return (0, jsonrpc_1.makeError)((_a = message.id) !== null && _a !== void 0 ? _a : null, jsonrpc_1.JSONRPC_INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"');
        }
        // Phase 2: route incoming responses to outgoing server→client requests
        // (e.g. `sampling/createMessage`). Responses have no `method` and an
        // `id` that matches a pending entry.
        if (message.method === undefined && (message.result !== undefined || message.error !== undefined)) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(message.id);
                if (message.error)
                    pending.reject(new jsonrpc_1.JsonRpcError((_b = message.error.code) !== null && _b !== void 0 ? _b : jsonrpc_1.JSONRPC_INTERNAL_ERROR, (_c = message.error.message) !== null && _c !== void 0 ? _c : 'client error', message.error.data));
                else
                    pending.resolve(message.result);
            }
            return null;
        }
        const { id, method, params } = message;
        const isNotif = id === undefined || id === null;
        if (typeof method !== 'string') {
            return isNotif ? null : (0, jsonrpc_1.makeError)(id, jsonrpc_1.JSONRPC_INVALID_REQUEST, 'Invalid Request: missing method');
        }
        try {
            // Notifications first.
            switch (method) {
                case 'notifications/initialized':
                case 'initialized':
                case 'notifications/roots/list_changed':
                    return null;
                case 'notifications/cancelled': {
                    const targetId = params === null || params === void 0 ? void 0 : params.requestId;
                    if (targetId !== undefined)
                        this.cancelRequest(targetId, (_d = params === null || params === void 0 ? void 0 : params.reason) !== null && _d !== void 0 ? _d : 'cancelled by client');
                    return null;
                }
            }
            let result;
            switch (method) {
                case 'initialize':
                    result = this.handleInitialize(params);
                    break;
                case 'ping':
                    result = {};
                    break;
                case 'logging/setLevel':
                    result = this.handleLoggingSetLevel(params);
                    break;
                case 'tools/list':
                    result = this.handleToolsList(params);
                    break;
                case 'tools/call':
                    result = await this.handleToolsCall(id, params);
                    break;
                case 'resources/list':
                    result = await this.handleResourcesList(params);
                    break;
                case 'resources/templates/list':
                    result = await this.handleResourceTemplatesList();
                    break;
                case 'resources/read':
                    result = await this.handleResourcesRead(params);
                    break;
                case 'resources/subscribe':
                    result = await this.handleResourcesSubscribe(params);
                    break;
                case 'resources/unsubscribe':
                    result = this.handleResourcesUnsubscribe(params);
                    break;
                case 'prompts/list':
                    result = await this.handlePromptsList();
                    break;
                case 'prompts/get':
                    result = await this.handlePromptsGet(params);
                    break;
                case 'completion/complete':
                    result = await this.handleCompletionComplete(params);
                    break;
                default:
                    throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
            }
            if (isNotif)
                return null;
            return (0, jsonrpc_1.makeResult)(id, result);
        }
        catch (err) {
            if (isNotif)
                return null;
            const code = err instanceof jsonrpc_1.JsonRpcError ? err.code : jsonrpc_1.JSONRPC_INTERNAL_ERROR;
            const data = err instanceof jsonrpc_1.JsonRpcError ? err.data : undefined;
            return (0, jsonrpc_1.makeError)(id, code, (_e = err === null || err === void 0 ? void 0 : err.message) !== null && _e !== void 0 ? _e : String(err), data);
        }
    }
    // -- handlers --------------------------------------------------------
    handleInitialize(params) {
        const requested = params === null || params === void 0 ? void 0 : params.protocolVersion;
        const negotiated = exports.SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : exports.DEFAULT_PROTOCOL_VERSION;
        this.negotiatedProtocolVersion = negotiated;
        this.clientCapabilities = ((params === null || params === void 0 ? void 0 : params.capabilities) && typeof params.capabilities === 'object') ? params.capabilities : {};
        const capabilities = Object.assign({ tools: { listChanged: true }, logging: {} }, this.extraCapabilities);
        if (this.resources) {
            capabilities.resources = { listChanged: true, subscribe: true };
        }
        if (this.prompts) {
            capabilities.prompts = { listChanged: true };
        }
        // Server-initiated sampling round-trip is supported when the client
        // advertises the matching capability — we still announce it so older
        // clients that probe capabilities know the server is willing.
        capabilities.sampling = capabilities.sampling || {};
        capabilities.completions = capabilities.completions || {};
        return {
            protocolVersion: negotiated,
            capabilities,
            serverInfo: {
                name: 'cocos-mcp-server',
                version: '1.4.0'
            },
            instructions: 'Cocos Creator MCP server. Call tools/list (supports `cursor` pagination) ' +
                'to discover capabilities. Long‑running calls can be aborted with ' +
                'notifications/cancelled. Use logging/setLevel to control log verbosity. ' +
                'Resources (project://info, scene://current, assets://tree, runtime://logs) ' +
                'and prompts are also available.'
        };
    }
    /** True when the client advertised the named top-level capability. */
    clientSupports(name) {
        return !!this.clientCapabilities[name];
    }
    handleLoggingSetLevel(params) {
        const level = params === null || params === void 0 ? void 0 : params.level;
        if (!level || !LOG_LEVEL_ORDER.includes(level)) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, `Invalid log level: ${level}`);
        }
        this.logLevel = level;
        return {};
    }
    handleToolsList(params) {
        const all = this.registry.listTools().map((t) => {
            var _a;
            const hints = (0, tool_hints_1.resolveToolHints)(t.name);
            const def = {
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema
            };
            if (t.outputSchema || hints.outputSchema)
                def.outputSchema = (_a = t.outputSchema) !== null && _a !== void 0 ? _a : hints.outputSchema;
            if (t.annotations || hints.annotations)
                def.annotations = Object.assign(Object.assign({}, hints.annotations), (t.annotations || {}));
            return def;
        });
        // G4: cursor pagination. The cursor is the opaque next‑index.
        const cursor = params === null || params === void 0 ? void 0 : params.cursor;
        let start = 0;
        if (cursor !== undefined && cursor !== null) {
            const idx = Number.parseInt(String(cursor), 10);
            if (!Number.isFinite(idx) || idx < 0) {
                throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, `Invalid cursor: ${cursor}`);
            }
            start = idx;
        }
        const end = Math.min(all.length, start + this.pageSize);
        const tools = all.slice(start, end);
        const out = { tools };
        if (end < all.length)
            out.nextCursor = String(end);
        return out;
    }
    async handleToolsCall(id, params) {
        var _a, _b, _c;
        if (!params || typeof params.name !== 'string') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "name" is required');
        }
        const { name, arguments: args } = params;
        const progressToken = (_a = params === null || params === void 0 ? void 0 : params._meta) === null || _a === void 0 ? void 0 : _a.progressToken;
        // G8: Ajv input validation. Look up the tool's inputSchema and validate.
        const def = this.registry.listTools().find((t) => t.name === name);
        if (!def) {
            // Per MCP spec we still return a result with isError=true so the LLM can react.
            return {
                content: [{ type: 'text', text: `Tool not found: ${name}` }],
                isError: true
            };
        }
        if (def.inputSchema) {
            const validator = this.getValidator(name, def.inputSchema);
            const ok = validator(args !== null && args !== void 0 ? args : {});
            if (!ok) {
                const message = this.ajv.errorsText(validator.errors, { separator: '; ' });
                throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, `Invalid arguments for ${name}: ${message}`, {
                    tool: name,
                    errors: validator.errors
                });
            }
        }
        // A8: AbortSignal wiring.
        const controller = new AbortController();
        const trackId = id;
        if (trackId !== undefined && trackId !== null)
            this.inFlight.set(trackId, controller);
        const ctx = {
            signal: controller.signal,
            progressToken,
            reportProgress: (progress, total, message) => {
                if (progressToken === undefined)
                    return;
                this.notify('notifications/progress', {
                    progressToken,
                    progress,
                    total,
                    message
                });
            },
            log: (level, data, logger) => this.emitLog(level, data, logger)
        };
        try {
            const toolResult = await this.registry.executeToolCall(name, args !== null && args !== void 0 ? args : {}, ctx);
            const isError = !!(toolResult && typeof toolResult === 'object' && toolResult.success === false);
            const result = {
                content: [{ type: 'text', text: JSON.stringify(toolResult) }],
                isError
            };
            // MCP 2025‑06‑18: when the tool declares an outputSchema, include `structuredContent`.
            if (def.outputSchema || (0, tool_hints_1.resolveToolHints)(name).outputSchema) {
                result.structuredContent = toolResult;
            }
            return result;
        }
        catch (err) {
            if (controller.signal.aborted) {
                // Re‑throw as JSON‑RPC cancellation error for clients that want it.
                throw new jsonrpc_1.JsonRpcError(jsonrpc_1.MCP_REQUEST_CANCELLED, (_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : 'Request cancelled');
            }
            return {
                content: [{ type: 'text', text: (_c = err === null || err === void 0 ? void 0 : err.message) !== null && _c !== void 0 ? _c : String(err) }],
                isError: true
            };
        }
        finally {
            if (trackId !== undefined && trackId !== null)
                this.inFlight.delete(trackId);
        }
    }
    getValidator(name, schema) {
        let v = this.validators.get(name);
        if (!v) {
            try {
                v = this.ajv.compile(schema);
            }
            catch (e) {
                // Schema bug shouldn't kill the call — fall back to a permissive validator.
                v = (() => true);
            }
            this.validators.set(name, v);
        }
        return v;
    }
    cancelRequest(requestId, reason) {
        const ctrl = this.inFlight.get(requestId);
        if (ctrl) {
            try {
                ctrl.abort(new Error(reason));
            }
            catch ( /* noop */_a) { /* noop */ }
            this.inFlight.delete(requestId);
        }
    }
    emitLog(level, data, logger) {
        if (!levelAtLeast(level, this.logLevel))
            return;
        this.notify('notifications/message', { level, logger, data });
    }
    notify(method, params) {
        if (!this.notifySink)
            return;
        try {
            this.notifySink({ jsonrpc: jsonrpc_1.JSONRPC_VERSION, method, params });
        }
        catch ( /* sink errors must not break tool execution */_a) { /* sink errors must not break tool execution */ }
    }
    /** Invalidate cached validators when the enabled tool set changes. */
    clearValidatorCache() {
        this.validators.clear();
    }
    /** Phase 1 follow-up: emit `notifications/tools/list_changed`. */
    emitToolsListChanged() {
        this.notify('notifications/tools/list_changed');
    }
    /** Generic helper used by registries to emit any notification to the client. */
    emitNotification(method, params) {
        this.notify(method, params);
    }
    // -- Phase 2 handlers ------------------------------------------------
    async handleResourcesList(params) {
        if (!this.resources) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'resources capability not enabled');
        }
        const all = await this.resources.listResources();
        // Reuse the same opaque cursor scheme as tools/list (G4).
        const cursor = params === null || params === void 0 ? void 0 : params.cursor;
        let start = 0;
        if (cursor !== undefined && cursor !== null) {
            const idx = Number.parseInt(String(cursor), 10);
            if (!Number.isFinite(idx) || idx < 0) {
                throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, `Invalid cursor: ${cursor}`);
            }
            start = idx;
        }
        const end = Math.min(all.length, start + this.pageSize);
        const out = { resources: all.slice(start, end) };
        if (end < all.length)
            out.nextCursor = String(end);
        return out;
    }
    async handleResourceTemplatesList() {
        if (!this.resources) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'resources capability not enabled');
        }
        return { resourceTemplates: await this.resources.listResourceTemplates() };
    }
    async handleResourcesRead(params) {
        if (!this.resources) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'resources capability not enabled');
        }
        if (!params || typeof params.uri !== 'string') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "uri" is required');
        }
        return await this.resources.readResource(params.uri);
    }
    async handleResourcesSubscribe(params) {
        if (!this.resources) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'resources capability not enabled');
        }
        if (!params || typeof params.uri !== 'string') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "uri" is required');
        }
        await this.resources.subscribe(params.uri);
        return {};
    }
    handleResourcesUnsubscribe(params) {
        if (!this.resources) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'resources capability not enabled');
        }
        if (!params || typeof params.uri !== 'string') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "uri" is required');
        }
        this.resources.unsubscribe(params.uri);
        return {};
    }
    async handlePromptsList() {
        if (!this.prompts) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'prompts capability not enabled');
        }
        return { prompts: await this.prompts.listPrompts() };
    }
    async handlePromptsGet(params) {
        if (!this.prompts) {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_METHOD_NOT_FOUND, 'prompts capability not enabled');
        }
        if (!params || typeof params.name !== 'string') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "name" is required');
        }
        const args = {};
        if (params.arguments && typeof params.arguments === 'object') {
            for (const [k, v] of Object.entries(params.arguments)) {
                args[k] = typeof v === 'string' ? v : String(v);
            }
        }
        return await this.prompts.getPrompt(params.name, args);
    }
    async handleCompletionComplete(params) {
        var _a, _b, _c;
        if (!params || !params.ref || typeof params.ref !== 'object') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "ref" is required');
        }
        const argName = (_a = params === null || params === void 0 ? void 0 : params.argument) === null || _a === void 0 ? void 0 : _a.name;
        const value = (_c = (_b = params === null || params === void 0 ? void 0 : params.argument) === null || _b === void 0 ? void 0 : _b.value) !== null && _c !== void 0 ? _c : '';
        if (typeof argName !== 'string') {
            throw new jsonrpc_1.JsonRpcError(jsonrpc_1.JSONRPC_INVALID_PARAMS, 'Invalid params: "argument.name" is required');
        }
        let values = [];
        if (params.ref.type === 'ref/prompt' && this.prompts) {
            values = await this.prompts.complete(params.ref.name, argName, value);
        }
        else if (params.ref.type === 'ref/resource' && this.resources) {
            values = await this.resources.complete(params.ref.uri, argName, value);
        }
        // Filter by current value prefix when the provider didn't already.
        const filtered = value
            ? values.filter((v) => v.toLowerCase().includes(String(value).toLowerCase()))
            : values;
        return {
            completion: {
                values: filtered.slice(0, 100),
                total: filtered.length,
                hasMore: filtered.length > 100
            }
        };
    }
    /**
     * Phase 2: ask the connected client to perform LLM sampling. Resolves with
     * the client's response or rejects on timeout / client error.
     */
    async requestSampling(req) {
        return await this.sendClientRequest('sampling/createMessage', req);
    }
    /** Send any server→client JSON-RPC request and await the response. */
    sendClientRequest(method, params) {
        if (!this.notifySink) {
            return Promise.reject(new Error('No active client channel for server→client request'));
        }
        return new Promise((resolve, reject) => {
            const id = this.nextOutgoingId++;
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Client request "${method}" timed out after ${this.samplingTimeoutMs}ms`));
            }, this.samplingTimeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timer });
            try {
                this.notifySink({ jsonrpc: jsonrpc_1.JSONRPC_VERSION, id, method, params });
            }
            catch (e) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(e);
            }
        });
    }
}
exports.ProtocolHandler = ProtocolHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdG9jb2wtaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NvdXJjZS9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7Ozs7OztBQUVILDhDQUE0QztBQUM1Qyw4REFBcUM7QUFDckMsdUNBYW1CO0FBQ25CLDZDQUFnRDtBQUloRCxzRUFBc0U7QUFDekQsUUFBQSwyQkFBMkIsR0FBRyxDQUFDLFlBQVksRUFBRSxZQUFZLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDekUsUUFBQSx3QkFBd0IsR0FBRyxtQ0FBMkIsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUV2RSxNQUFNLGVBQWUsR0FBa0I7SUFDbkMsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsT0FBTyxFQUFFLFdBQVc7Q0FDbEYsQ0FBQztBQUVGLFNBQVMsWUFBWSxDQUFDLEtBQWtCLEVBQUUsU0FBc0I7SUFDNUQsT0FBTyxlQUFlLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLGVBQWUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDaEYsQ0FBQztBQXVDRCxNQUFhLGVBQWU7SUFrQnhCLFlBQVksSUFBNEI7O1FBZGhDLGVBQVUsR0FBNEIsSUFBSSxDQUFDO1FBQzNDLGFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBb0MsQ0FBQztRQUV2RCxlQUFVLEdBQUcsSUFBSSxHQUFHLEVBQTRCLENBQUM7UUFFakQsOEJBQXlCLEdBQUcsZ0NBQXdCLENBQUM7UUFHckQsdUJBQWtCLEdBQXdCLEVBQUUsQ0FBQztRQUVyRCxtRUFBbUU7UUFDM0Qsb0JBQWUsR0FBRyxJQUFJLEdBQUcsRUFBbUcsQ0FBQztRQUM3SCxtQkFBYyxHQUFHLENBQUMsQ0FBQztRQUd2QixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7UUFDOUIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFBLElBQUksQ0FBQyxRQUFRLG1DQUFJLEdBQUcsQ0FBQyxDQUFDO1FBQ2xELElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBQSxJQUFJLENBQUMsZUFBZSxtQ0FBSSxNQUFNLENBQUM7UUFDL0MsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksQ0FBQyxpQkFBaUIsSUFBSSxFQUFFLENBQUM7UUFDdEQsSUFBSSxDQUFDLFNBQVMsR0FBRyxNQUFBLElBQUksQ0FBQyxTQUFTLG1DQUFJLElBQUksQ0FBQztRQUN4QyxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQUEsSUFBSSxDQUFDLE9BQU8sbUNBQUksSUFBSSxDQUFDO1FBQ3BDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUssRUFBRSxNQUFBLElBQUksQ0FBQyxpQkFBaUIsbUNBQUksS0FBTSxDQUFDLENBQUM7UUFDM0UsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLGFBQUcsQ0FBQyxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztRQUMzRSxJQUFBLHFCQUFVLEVBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFFTSxtQkFBbUIsQ0FBQyxJQUE2QjtRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztJQUMzQixDQUFDO0lBRU0sV0FBVyxDQUFDLEtBQWtCO1FBQ2pDLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDO0lBQzFCLENBQUM7SUFFTSw0QkFBNEI7UUFDL0IsT0FBTyxJQUFJLENBQUMseUJBQXlCLENBQUM7SUFDMUMsQ0FBQztJQUVELG9FQUFvRTtJQUM3RCxTQUFTLENBQUMsTUFBTSxHQUFHLGtCQUFrQjtRQUN4QyxLQUFLLE1BQU0sQ0FBQyxFQUFFLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNuQyxJQUFJLENBQUM7Z0JBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQUMsQ0FBQztZQUFDLFFBQVEsVUFBVSxJQUFaLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUMvRCxDQUFDO1FBQ0QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN0QixLQUFLLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUN2QyxZQUFZLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3RCLElBQUksQ0FBQztnQkFBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFBQyxDQUFDO1lBQUMsUUFBUSxVQUFVLElBQVosQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzdELENBQUM7UUFDRCxJQUFJLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ2pDLENBQUM7SUFFRCx1RkFBdUY7SUFDaEYsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFvQjs7UUFDcEMsSUFBSSxPQUFZLENBQUM7UUFDakIsSUFBSSxPQUFPLEdBQUcsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUMxQixJQUFJLENBQUM7Z0JBQ0QsT0FBTyxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDeEQsQ0FBQztZQUFDLE9BQU8sQ0FBTSxFQUFFLENBQUM7Z0JBQ2QsT0FBTyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLDZCQUFtQixFQUFFLGdCQUFnQixNQUFBLENBQUMsYUFBRCxDQUFDLHVCQUFELENBQUMsQ0FBRSxPQUFPLG1DQUFJLGNBQWMsRUFBRSxDQUFDLENBQUM7WUFDaEcsQ0FBQztRQUNMLENBQUM7YUFBTSxDQUFDO1lBQ0osT0FBTyxHQUFHLEdBQUcsQ0FBQztRQUNsQixDQUFDO1FBRUQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDekIsSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUN2QixPQUFPLElBQUEsbUJBQVMsRUFBQyxJQUFJLEVBQUUsaUNBQXVCLEVBQUUsOEJBQThCLENBQUMsQ0FBQztZQUNwRixDQUFDO1lBQ0QsTUFBTSxHQUFHLEdBQXNCLEVBQUUsQ0FBQztZQUNsQyxLQUFLLE1BQU0sSUFBSSxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUN6QixNQUFNLENBQUMsR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3hDLElBQUksQ0FBQztvQkFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZCLENBQUM7WUFDRCxPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQ25DLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVPLEtBQUssQ0FBQyxZQUFZLENBQUMsT0FBWTs7UUFDbkMsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3BFLE9BQU8sSUFBQSxtQkFBUyxFQUFDLElBQUksRUFBRSxpQ0FBdUIsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7UUFDRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUsseUJBQWUsRUFBRSxDQUFDO1lBQ3RDLE9BQU8sSUFBQSxtQkFBUyxFQUFDLE1BQUEsT0FBTyxDQUFDLEVBQUUsbUNBQUksSUFBSSxFQUFFLGlDQUF1QixFQUFFLHdDQUF3QyxDQUFDLENBQUM7UUFDNUcsQ0FBQztRQUVELHVFQUF1RTtRQUN2RSxxRUFBcUU7UUFDckUscUNBQXFDO1FBQ3JDLElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxLQUFLLFNBQVMsSUFBSSxPQUFPLENBQUMsS0FBSyxLQUFLLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDaEcsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3JELElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQ1YsWUFBWSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDNUIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUN4QyxJQUFJLE9BQU8sQ0FBQyxLQUFLO29CQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxzQkFBWSxDQUFDLE1BQUEsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLG1DQUFJLGdDQUFzQixFQUFFLE1BQUEsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLG1DQUFJLGNBQWMsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7O29CQUMxSixPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUN6QyxDQUFDO1lBQ0QsT0FBTyxJQUFJLENBQUM7UUFDaEIsQ0FBQztRQUVELE1BQU0sRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQztRQUN2QyxNQUFNLE9BQU8sR0FBRyxFQUFFLEtBQUssU0FBUyxJQUFJLEVBQUUsS0FBSyxJQUFJLENBQUM7UUFDaEQsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM3QixPQUFPLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsRUFBRSxFQUFFLGlDQUF1QixFQUFFLGlDQUFpQyxDQUFDLENBQUM7UUFDdEcsQ0FBQztRQUVELElBQUksQ0FBQztZQUNELHVCQUF1QjtZQUN2QixRQUFRLE1BQU0sRUFBRSxDQUFDO2dCQUNiLEtBQUssMkJBQTJCLENBQUM7Z0JBQ2pDLEtBQUssYUFBYSxDQUFDO2dCQUNuQixLQUFLLGtDQUFrQztvQkFDbkMsT0FBTyxJQUFJLENBQUM7Z0JBQ2hCLEtBQUsseUJBQXlCLENBQUMsQ0FBQyxDQUFDO29CQUM3QixNQUFNLFFBQVEsR0FBRyxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsU0FBUyxDQUFDO29CQUNuQyxJQUFJLFFBQVEsS0FBSyxTQUFTO3dCQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFFLE1BQUEsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLE1BQU0sbUNBQUkscUJBQXFCLENBQUMsQ0FBQztvQkFDbEcsT0FBTyxJQUFJLENBQUM7Z0JBQ2hCLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxNQUFXLENBQUM7WUFDaEIsUUFBUSxNQUFNLEVBQUUsQ0FBQztnQkFDYixLQUFLLFlBQVk7b0JBQ2IsTUFBTSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDdkMsTUFBTTtnQkFDVixLQUFLLE1BQU07b0JBQ1AsTUFBTSxHQUFHLEVBQUUsQ0FBQztvQkFDWixNQUFNO2dCQUNWLEtBQUssa0JBQWtCO29CQUNuQixNQUFNLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUM1QyxNQUFNO2dCQUNWLEtBQUssWUFBWTtvQkFDYixNQUFNLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDdEMsTUFBTTtnQkFDVixLQUFLLFlBQVk7b0JBQ2IsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQ2hELE1BQU07Z0JBQ1YsS0FBSyxnQkFBZ0I7b0JBQ2pCLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDaEQsTUFBTTtnQkFDVixLQUFLLDBCQUEwQjtvQkFDM0IsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUM7b0JBQ2xELE1BQU07Z0JBQ1YsS0FBSyxnQkFBZ0I7b0JBQ2pCLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDaEQsTUFBTTtnQkFDVixLQUFLLHFCQUFxQjtvQkFDdEIsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUNyRCxNQUFNO2dCQUNWLEtBQUssdUJBQXVCO29CQUN4QixNQUFNLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUNqRCxNQUFNO2dCQUNWLEtBQUssY0FBYztvQkFDZixNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztvQkFDeEMsTUFBTTtnQkFDVixLQUFLLGFBQWE7b0JBQ2QsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUM3QyxNQUFNO2dCQUNWLEtBQUsscUJBQXFCO29CQUN0QixNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUM7b0JBQ3JELE1BQU07Z0JBQ1Y7b0JBQ0ksTUFBTSxJQUFJLHNCQUFZLENBQUMsa0NBQXdCLEVBQUUscUJBQXFCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDeEYsQ0FBQztZQUVELElBQUksT0FBTztnQkFBRSxPQUFPLElBQUksQ0FBQztZQUN6QixPQUFPLElBQUEsb0JBQVUsRUFBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDbEMsQ0FBQztRQUFDLE9BQU8sR0FBUSxFQUFFLENBQUM7WUFDaEIsSUFBSSxPQUFPO2dCQUFFLE9BQU8sSUFBSSxDQUFDO1lBQ3pCLE1BQU0sSUFBSSxHQUFHLEdBQUcsWUFBWSxzQkFBWSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxnQ0FBc0IsQ0FBQztZQUM3RSxNQUFNLElBQUksR0FBRyxHQUFHLFlBQVksc0JBQVksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1lBQ2hFLE9BQU8sSUFBQSxtQkFBUyxFQUFDLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBQSxHQUFHLGFBQUgsR0FBRyx1QkFBSCxHQUFHLENBQUUsT0FBTyxtQ0FBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDbEUsQ0FBQztJQUNMLENBQUM7SUFFRCx1RUFBdUU7SUFFL0QsZ0JBQWdCLENBQUMsTUFBVztRQUNoQyxNQUFNLFNBQVMsR0FBRyxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsZUFBZSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLG1DQUEyQixDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUM7WUFDOUQsQ0FBQyxDQUFDLFNBQVM7WUFDWCxDQUFDLENBQUMsZ0NBQXdCLENBQUM7UUFDL0IsSUFBSSxDQUFDLHlCQUF5QixHQUFHLFVBQVUsQ0FBQztRQUM1QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxDQUFBLE1BQU0sYUFBTixNQUFNLHVCQUFOLE1BQU0sQ0FBRSxZQUFZLEtBQUksT0FBTyxNQUFNLENBQUMsWUFBWSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDdkgsTUFBTSxZQUFZLG1CQUNkLEtBQUssRUFBRSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsRUFDNUIsT0FBTyxFQUFFLEVBQUUsSUFDUixJQUFJLENBQUMsaUJBQWlCLENBQzVCLENBQUM7UUFDRixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNqQixZQUFZLENBQUMsU0FBUyxHQUFHLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUM7UUFDcEUsQ0FBQztRQUNELElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2YsWUFBWSxDQUFDLE9BQU8sR0FBRyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBQztRQUNqRCxDQUFDO1FBQ0Qsb0VBQW9FO1FBQ3BFLHFFQUFxRTtRQUNyRSw4REFBOEQ7UUFDOUQsWUFBWSxDQUFDLFFBQVEsR0FBRyxZQUFZLENBQUMsUUFBUSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxZQUFZLENBQUMsV0FBVyxHQUFHLFlBQVksQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQzFELE9BQU87WUFDSCxlQUFlLEVBQUUsVUFBVTtZQUMzQixZQUFZO1lBQ1osVUFBVSxFQUFFO2dCQUNSLElBQUksRUFBRSxrQkFBa0I7Z0JBQ3hCLE9BQU8sRUFBRSxPQUFPO2FBQ25CO1lBQ0QsWUFBWSxFQUNSLDJFQUEyRTtnQkFDM0UsbUVBQW1FO2dCQUNuRSwwRUFBMEU7Z0JBQzFFLDZFQUE2RTtnQkFDN0UsaUNBQWlDO1NBQ3hDLENBQUM7SUFDTixDQUFDO0lBRUQsc0VBQXNFO0lBQy9ELGNBQWMsQ0FBQyxJQUFZO1FBQzlCLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBRU8scUJBQXFCLENBQUMsTUFBVztRQUNyQyxNQUFNLEtBQUssR0FBRyxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsS0FBSyxDQUFDO1FBQzVCLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLHNCQUFZLENBQUMsZ0NBQXNCLEVBQUUsc0JBQXNCLEtBQUssRUFBRSxDQUFDLENBQUM7UUFDbEYsQ0FBQztRQUNELElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDO1FBQ3RCLE9BQU8sRUFBRSxDQUFDO0lBQ2QsQ0FBQztJQUVPLGVBQWUsQ0FBQyxNQUFXO1FBQy9CLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7O1lBQzVDLE1BQU0sS0FBSyxHQUFHLElBQUEsNkJBQWdCLEVBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sR0FBRyxHQUFRO2dCQUNiLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtnQkFDWixXQUFXLEVBQUUsQ0FBQyxDQUFDLFdBQVc7Z0JBQzFCLFdBQVcsRUFBRSxDQUFDLENBQUMsV0FBVzthQUM3QixDQUFDO1lBQ0YsSUFBSSxDQUFDLENBQUMsWUFBWSxJQUFJLEtBQUssQ0FBQyxZQUFZO2dCQUFFLEdBQUcsQ0FBQyxZQUFZLEdBQUcsTUFBQSxDQUFDLENBQUMsWUFBWSxtQ0FBSSxLQUFLLENBQUMsWUFBWSxDQUFDO1lBQ2xHLElBQUksQ0FBQyxDQUFDLFdBQVcsSUFBSSxLQUFLLENBQUMsV0FBVztnQkFBRSxHQUFHLENBQUMsV0FBVyxtQ0FBUSxLQUFLLENBQUMsV0FBVyxHQUFLLENBQUMsQ0FBQyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBRSxDQUFDO1lBQzdHLE9BQU8sR0FBRyxDQUFDO1FBQ2YsQ0FBQyxDQUFDLENBQUM7UUFFSCw4REFBOEQ7UUFDOUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLE1BQU0sQ0FBQztRQUM5QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7UUFDZCxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksTUFBTSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQzFDLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2hELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDbkMsTUFBTSxJQUFJLHNCQUFZLENBQUMsZ0NBQXNCLEVBQUUsbUJBQW1CLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDaEYsQ0FBQztZQUNELEtBQUssR0FBRyxHQUFHLENBQUM7UUFDaEIsQ0FBQztRQUNELE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxLQUFLLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3hELE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3BDLE1BQU0sR0FBRyxHQUFRLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDM0IsSUFBSSxHQUFHLEdBQUcsR0FBRyxDQUFDLE1BQU07WUFBRSxHQUFHLENBQUMsVUFBVSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNuRCxPQUFPLEdBQUcsQ0FBQztJQUNmLENBQUM7SUFFTyxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQXNDLEVBQUUsTUFBVzs7UUFDN0UsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLHNCQUFZLENBQUMsZ0NBQXNCLEVBQUUsb0NBQW9DLENBQUMsQ0FBQztRQUN6RixDQUFDO1FBQ0QsTUFBTSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDO1FBQ3pDLE1BQU0sYUFBYSxHQUFHLE1BQUEsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLEtBQUssMENBQUUsYUFBYSxDQUFDO1FBRW5ELHlFQUF5RTtRQUN6RSxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxJQUFJLENBQUMsQ0FBQztRQUNuRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDUCxnRkFBZ0Y7WUFDaEYsT0FBTztnQkFDSCxPQUFPLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLG1CQUFtQixJQUFJLEVBQUUsRUFBRSxDQUFDO2dCQUM1RCxPQUFPLEVBQUUsSUFBSTthQUNoQixDQUFDO1FBQ04sQ0FBQztRQUNELElBQUksR0FBRyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2xCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUMzRCxNQUFNLEVBQUUsR0FBRyxTQUFTLENBQUMsSUFBSSxhQUFKLElBQUksY0FBSixJQUFJLEdBQUksRUFBRSxDQUFDLENBQUM7WUFDakMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO2dCQUNOLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDM0UsTUFBTSxJQUFJLHNCQUFZLENBQUMsZ0NBQXNCLEVBQUUseUJBQXlCLElBQUksS0FBSyxPQUFPLEVBQUUsRUFBRTtvQkFDeEYsSUFBSSxFQUFFLElBQUk7b0JBQ1YsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNO2lCQUMzQixDQUFDLENBQUM7WUFDUCxDQUFDO1FBQ0wsQ0FBQztRQUVELDBCQUEwQjtRQUMxQixNQUFNLFVBQVUsR0FBRyxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sT0FBTyxHQUF1QyxFQUFFLENBQUM7UUFDdkQsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJO1lBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRXRGLE1BQU0sR0FBRyxHQUF5QjtZQUM5QixNQUFNLEVBQUUsVUFBVSxDQUFDLE1BQU07WUFDekIsYUFBYTtZQUNiLGNBQWMsRUFBRSxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUU7Z0JBQ3pDLElBQUksYUFBYSxLQUFLLFNBQVM7b0JBQUUsT0FBTztnQkFDeEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyx3QkFBd0IsRUFBRTtvQkFDbEMsYUFBYTtvQkFDYixRQUFRO29CQUNSLEtBQUs7b0JBQ0wsT0FBTztpQkFDVixDQUFDLENBQUM7WUFDUCxDQUFDO1lBQ0QsR0FBRyxFQUFFLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxNQUFNLENBQUM7U0FDbEUsQ0FBQztRQUVGLElBQUksQ0FBQztZQUNELE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLElBQUksYUFBSixJQUFJLGNBQUosSUFBSSxHQUFJLEVBQUUsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUM5RSxNQUFNLE9BQU8sR0FBRyxDQUFDLENBQUMsQ0FBQyxVQUFVLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxJQUFJLFVBQVUsQ0FBQyxPQUFPLEtBQUssS0FBSyxDQUFDLENBQUM7WUFDakcsTUFBTSxNQUFNLEdBQVE7Z0JBQ2hCLE9BQU8sRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUM3RCxPQUFPO2FBQ1YsQ0FBQztZQUNGLHVGQUF1RjtZQUN2RixJQUFJLEdBQUcsQ0FBQyxZQUFZLElBQUksSUFBQSw2QkFBZ0IsRUFBQyxJQUFJLENBQUMsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDMUQsTUFBTSxDQUFDLGlCQUFpQixHQUFHLFVBQVUsQ0FBQztZQUMxQyxDQUFDO1lBQ0QsT0FBTyxNQUFNLENBQUM7UUFDbEIsQ0FBQztRQUFDLE9BQU8sR0FBUSxFQUFFLENBQUM7WUFDaEIsSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUM1QixvRUFBb0U7Z0JBQ3BFLE1BQU0sSUFBSSxzQkFBWSxDQUFDLCtCQUFxQixFQUFFLE1BQUEsR0FBRyxhQUFILEdBQUcsdUJBQUgsR0FBRyxDQUFFLE9BQU8sbUNBQUksbUJBQW1CLENBQUMsQ0FBQztZQUN2RixDQUFDO1lBQ0QsT0FBTztnQkFDSCxPQUFPLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLE1BQUEsR0FBRyxhQUFILEdBQUcsdUJBQUgsR0FBRyxDQUFFLE9BQU8sbUNBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzlELE9BQU8sRUFBRSxJQUFJO2FBQ2hCLENBQUM7UUFDTixDQUFDO2dCQUFTLENBQUM7WUFDUCxJQUFJLE9BQU8sS0FBSyxTQUFTLElBQUksT0FBTyxLQUFLLElBQUk7Z0JBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDakYsQ0FBQztJQUNMLENBQUM7SUFFTyxZQUFZLENBQUMsSUFBWSxFQUFFLE1BQVc7UUFDMUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEMsSUFBSSxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ0wsSUFBSSxDQUFDO2dCQUNELENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUNqQyxDQUFDO1lBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztnQkFDZCw0RUFBNEU7Z0JBQzVFLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBZ0MsQ0FBQztZQUNwRCxDQUFDO1lBQ0QsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2pDLENBQUM7UUFDRCxPQUFPLENBQUMsQ0FBQztJQUNiLENBQUM7SUFFTyxhQUFhLENBQUMsU0FBMEIsRUFBRSxNQUFjO1FBQzVELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzFDLElBQUksSUFBSSxFQUFFLENBQUM7WUFDUCxJQUFJLENBQUM7Z0JBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQUMsQ0FBQztZQUFDLFFBQVEsVUFBVSxJQUFaLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUMzRCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNwQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLE9BQU8sQ0FBQyxLQUFrQixFQUFFLElBQVMsRUFBRSxNQUFlO1FBQzFELElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUM7WUFBRSxPQUFPO1FBQ2hELElBQUksQ0FBQyxNQUFNLENBQUMsdUJBQXVCLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7SUFDbEUsQ0FBQztJQUVPLE1BQU0sQ0FBQyxNQUFjLEVBQUUsTUFBWTtRQUN2QyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPO1FBQzdCLElBQUksQ0FBQztZQUNELElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxPQUFPLEVBQUUseUJBQWUsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUNsRSxDQUFDO1FBQUMsUUFBUSwrQ0FBK0MsSUFBakQsQ0FBQyxDQUFDLCtDQUErQyxDQUFDLENBQUM7SUFDL0QsQ0FBQztJQUVELHNFQUFzRTtJQUMvRCxtQkFBbUI7UUFDdEIsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUM1QixDQUFDO0lBRUQsa0VBQWtFO0lBQzNELG9CQUFvQjtRQUN2QixJQUFJLENBQUMsTUFBTSxDQUFDLGtDQUFrQyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVELGdGQUFnRjtJQUN6RSxnQkFBZ0IsQ0FBQyxNQUFjLEVBQUUsTUFBWTtRQUNoRCxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUNoQyxDQUFDO0lBRUQsdUVBQXVFO0lBRS9ELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxNQUFXO1FBQ3pDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDbEIsTUFBTSxJQUFJLHNCQUFZLENBQUMsa0NBQXdCLEVBQUUsa0NBQWtDLENBQUMsQ0FBQztRQUN6RixDQUFDO1FBQ0QsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ2pELDBEQUEwRDtRQUMxRCxNQUFNLE1BQU0sR0FBRyxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsTUFBTSxDQUFDO1FBQzlCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztRQUNkLElBQUksTUFBTSxLQUFLLFNBQVMsSUFBSSxNQUFNLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDMUMsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDaEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNuQyxNQUFNLElBQUksc0JBQVksQ0FBQyxnQ0FBc0IsRUFBRSxtQkFBbUIsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUNoRixDQUFDO1lBQ0QsS0FBSyxHQUFHLEdBQUcsQ0FBQztRQUNoQixDQUFDO1FBQ0QsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLEtBQUssR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDeEQsTUFBTSxHQUFHLEdBQVEsRUFBRSxTQUFTLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN0RCxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTTtZQUFFLEdBQUcsQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ25ELE9BQU8sR0FBRyxDQUFDO0lBQ2YsQ0FBQztJQUVPLEtBQUssQ0FBQywyQkFBMkI7UUFDckMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksc0JBQVksQ0FBQyxrQ0FBd0IsRUFBRSxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7UUFDRCxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLHFCQUFxQixFQUFFLEVBQUUsQ0FBQztJQUMvRSxDQUFDO0lBRU8sS0FBSyxDQUFDLG1CQUFtQixDQUFDLE1BQVc7UUFDekMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksc0JBQVksQ0FBQyxrQ0FBd0IsRUFBRSxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM1QyxNQUFNLElBQUksc0JBQVksQ0FBQyxnQ0FBc0IsRUFBRSxtQ0FBbUMsQ0FBQyxDQUFDO1FBQ3hGLENBQUM7UUFDRCxPQUFPLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3pELENBQUM7SUFFTyxLQUFLLENBQUMsd0JBQXdCLENBQUMsTUFBVztRQUM5QyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2xCLE1BQU0sSUFBSSxzQkFBWSxDQUFDLGtDQUF3QixFQUFFLGtDQUFrQyxDQUFDLENBQUM7UUFDekYsQ0FBQztRQUNELElBQUksQ0FBQyxNQUFNLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzVDLE1BQU0sSUFBSSxzQkFBWSxDQUFDLGdDQUFzQixFQUFFLG1DQUFtQyxDQUFDLENBQUM7UUFDeEYsQ0FBQztRQUNELE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzNDLE9BQU8sRUFBRSxDQUFDO0lBQ2QsQ0FBQztJQUVPLDBCQUEwQixDQUFDLE1BQVc7UUFDMUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksc0JBQVksQ0FBQyxrQ0FBd0IsRUFBRSxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM1QyxNQUFNLElBQUksc0JBQVksQ0FBQyxnQ0FBc0IsRUFBRSxtQ0FBbUMsQ0FBQyxDQUFDO1FBQ3hGLENBQUM7UUFDRCxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdkMsT0FBTyxFQUFFLENBQUM7SUFDZCxDQUFDO0lBRU8sS0FBSyxDQUFDLGlCQUFpQjtRQUMzQixJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2hCLE1BQU0sSUFBSSxzQkFBWSxDQUFDLGtDQUF3QixFQUFFLGdDQUFnQyxDQUFDLENBQUM7UUFDdkYsQ0FBQztRQUNELE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7SUFDekQsQ0FBQztJQUVPLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFXO1FBQ3RDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDaEIsTUFBTSxJQUFJLHNCQUFZLENBQUMsa0NBQXdCLEVBQUUsZ0NBQWdDLENBQUMsQ0FBQztRQUN2RixDQUFDO1FBQ0QsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLHNCQUFZLENBQUMsZ0NBQXNCLEVBQUUsb0NBQW9DLENBQUMsQ0FBQztRQUN6RixDQUFDO1FBQ0QsTUFBTSxJQUFJLEdBQTJCLEVBQUUsQ0FBQztRQUN4QyxJQUFJLE1BQU0sQ0FBQyxTQUFTLElBQUksT0FBTyxNQUFNLENBQUMsU0FBUyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzNELEtBQUssTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO2dCQUNwRCxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNwRCxDQUFDO1FBQ0wsQ0FBQztRQUNELE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzNELENBQUM7SUFFTyxLQUFLLENBQUMsd0JBQXdCLENBQUMsTUFBVzs7UUFDOUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzNELE1BQU0sSUFBSSxzQkFBWSxDQUFDLGdDQUFzQixFQUFFLG1DQUFtQyxDQUFDLENBQUM7UUFDeEYsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFHLE1BQUEsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLFFBQVEsMENBQUUsSUFBSSxDQUFDO1FBQ3ZDLE1BQU0sS0FBSyxHQUFHLE1BQUEsTUFBQSxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsUUFBUSwwQ0FBRSxLQUFLLG1DQUFJLEVBQUUsQ0FBQztRQUM1QyxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzlCLE1BQU0sSUFBSSxzQkFBWSxDQUFDLGdDQUFzQixFQUFFLDZDQUE2QyxDQUFDLENBQUM7UUFDbEcsQ0FBQztRQUNELElBQUksTUFBTSxHQUFhLEVBQUUsQ0FBQztRQUMxQixJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxLQUFLLFlBQVksSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDbkQsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzFFLENBQUM7YUFBTSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxLQUFLLGNBQWMsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDOUQsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNFLENBQUM7UUFDRCxtRUFBbUU7UUFDbkUsTUFBTSxRQUFRLEdBQUcsS0FBSztZQUNsQixDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztZQUM3RSxDQUFDLENBQUMsTUFBTSxDQUFDO1FBQ2IsT0FBTztZQUNILFVBQVUsRUFBRTtnQkFDUixNQUFNLEVBQUUsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDO2dCQUM5QixLQUFLLEVBQUUsUUFBUSxDQUFDLE1BQU07Z0JBQ3RCLE9BQU8sRUFBRSxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUc7YUFDakM7U0FDSixDQUFDO0lBQ04sQ0FBQztJQUVEOzs7T0FHRztJQUNJLEtBQUssQ0FBQyxlQUFlLENBQUMsR0FBdUI7UUFDaEQsT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyx3QkFBd0IsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBRUQsc0VBQXNFO0lBQy9ELGlCQUFpQixDQUFDLE1BQWMsRUFBRSxNQUFXO1FBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDbkIsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLG9EQUFvRCxDQUFDLENBQUMsQ0FBQztRQUMzRixDQUFDO1FBQ0QsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUNuQyxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDakMsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtnQkFDMUIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ2hDLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsTUFBTSxxQkFBcUIsSUFBSSxDQUFDLGlCQUFpQixJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ2hHLENBQUMsRUFBRSxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUMzQixJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDekQsSUFBSSxDQUFDO2dCQUNELElBQUksQ0FBQyxVQUFXLENBQUMsRUFBRSxPQUFPLEVBQUUseUJBQWUsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBUyxDQUFDLENBQUM7WUFDOUUsQ0FBQztZQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ1QsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUNwQixJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDaEMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2QsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBbGhCRCwwQ0FraEJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFRyYW5zcG9ydOKAkWFnbm9zdGljIE1DUCBwcm90b2NvbCBoYW5kbGVyLlxyXG4gKlxyXG4gKiBUaGUge0BsaW5rIFByb3RvY29sSGFuZGxlcn0gb3duczpcclxuICogICAtIEpTT07igJFSUEMgMi4wIG1lc3NhZ2UgZGlzcGF0Y2hcclxuICogICAtIFRoZSBNQ1AgY2FwYWJpbGl0eSBoYW5kc2hha2UgKGBpbml0aWFsaXplYClcclxuICogICAtIFRvb2wgbGlzdGluZyB3aXRoIHBhZ2luYXRpb24gY3Vyc29ycyAoRzQpXHJcbiAqICAgLSBUb29sIGNhbGxzIHdpdGggQWp2IGlucHV0IHZhbGlkYXRpb24gKEc4KSBhbmQgQWJvcnRTaWduYWwgY2FuY2VsbGF0aW9uIChBOClcclxuICogICAtIGBsb2dnaW5nL3NldExldmVsYCArIGBub3RpZmljYXRpb25zL21lc3NhZ2VgIChBNilcclxuICogICAtIGBub3RpZmljYXRpb25zL3Byb2dyZXNzYCBwbHVtYmluZyAoQTcpXHJcbiAqICAgLSBwcm90b2NvbFZlcnNpb24gbmVnb3RpYXRpb24gKyBmZWF0dXJlIGZsYWdzIChHOSlcclxuICpcclxuICogVHJhbnNwb3J0cyAoU3RyZWFtYWJsZSBIVFRQLCBzdGRpbywgZnV0dXJlIFdlYlNvY2tldCkgb25seSBuZWVkIHRvIHB1c2hcclxuICogaW5jb21pbmcgYHN0cmluZyB8IG9iamVjdGAgbWVzc2FnZXMgaW50byB7QGxpbmsgUHJvdG9jb2xIYW5kbGVyLmhhbmRsZX1cclxuICogYW5kIGZvcndhcmQgZW1pdHRlZCBzZXJ2ZXIgbm90aWZpY2F0aW9ucyB0byB0aGVpciBwZWVyLlxyXG4gKi9cclxuXHJcbmltcG9ydCBBanYsIHsgVmFsaWRhdGVGdW5jdGlvbiB9IGZyb20gJ2Fqdic7XHJcbmltcG9ydCBhZGRGb3JtYXRzIGZyb20gJ2Fqdi1mb3JtYXRzJztcclxuaW1wb3J0IHtcclxuICAgIEpTT05SUENfSU5URVJOQUxfRVJST1IsXHJcbiAgICBKU09OUlBDX0lOVkFMSURfUEFSQU1TLFxyXG4gICAgSlNPTlJQQ19JTlZBTElEX1JFUVVFU1QsXHJcbiAgICBKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsXHJcbiAgICBKU09OUlBDX1BBUlNFX0VSUk9SLFxyXG4gICAgSlNPTlJQQ19WRVJTSU9OLFxyXG4gICAgSnNvblJwY0Vycm9yLFxyXG4gICAgSnNvblJwY1JlcXVlc3QsXHJcbiAgICBKc29uUnBjUmVzcG9uc2UsXHJcbiAgICBNQ1BfUkVRVUVTVF9DQU5DRUxMRUQsXHJcbiAgICBtYWtlRXJyb3IsXHJcbiAgICBtYWtlUmVzdWx0XHJcbn0gZnJvbSAnLi9qc29ucnBjJztcclxuaW1wb3J0IHsgcmVzb2x2ZVRvb2xIaW50cyB9IGZyb20gJy4vdG9vbC1oaW50cyc7XHJcbmltcG9ydCB7IFByb21wdFJlZ2lzdHJ5LCBSZXNvdXJjZVJlZ2lzdHJ5IH0gZnJvbSAnLi9yZWdpc3RyaWVzJztcclxuaW1wb3J0IHsgTWNwTG9nTGV2ZWwsIE1jcFNhbXBsaW5nUmVxdWVzdCwgVG9vbERlZmluaXRpb24gfSBmcm9tICcuLi90eXBlcyc7XHJcblxyXG4vLyBQcm90b2NvbCB2ZXJzaW9ucyB0aGlzIHNlcnZlciB1bmRlcnN0YW5kcy4gVGhlIGxhdGVzdCBpcyBwcmVmZXJyZWQuXHJcbmV4cG9ydCBjb25zdCBTVVBQT1JURURfUFJPVE9DT0xfVkVSU0lPTlMgPSBbJzIwMjUtMDYtMTgnLCAnMjAyNS0wMy0yNicsICcyMDI0LTExLTA1J107XHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX1BST1RPQ09MX1ZFUlNJT04gPSBTVVBQT1JURURfUFJPVE9DT0xfVkVSU0lPTlNbMF07XHJcblxyXG5jb25zdCBMT0dfTEVWRUxfT1JERVI6IE1jcExvZ0xldmVsW10gPSBbXHJcbiAgICAnZGVidWcnLCAnaW5mbycsICdub3RpY2UnLCAnd2FybmluZycsICdlcnJvcicsICdjcml0aWNhbCcsICdhbGVydCcsICdlbWVyZ2VuY3knXHJcbl07XHJcblxyXG5mdW5jdGlvbiBsZXZlbEF0TGVhc3QobGV2ZWw6IE1jcExvZ0xldmVsLCB0aHJlc2hvbGQ6IE1jcExvZ0xldmVsKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gTE9HX0xFVkVMX09SREVSLmluZGV4T2YobGV2ZWwpID49IExPR19MRVZFTF9PUkRFUi5pbmRleE9mKHRocmVzaG9sZCk7XHJcbn1cclxuXHJcbi8qKiBUb29sIHJlZ2lzdHJ5IHBhc3NlZCB0byB0aGUgaGFuZGxlci4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBUb29sUmVnaXN0cnkge1xyXG4gICAgLyoqIFJldHVybiB0aGUgZnVsbCBlbmFibGVkIHRvb2wgbGlzdCAoYWxyZWFkeSBmaWx0ZXJlZCBieSBUb29sTWFuYWdlcikuICovXHJcbiAgICBsaXN0VG9vbHMoKTogVG9vbERlZmluaXRpb25bXTtcclxuICAgIC8qKiBFeGVjdXRlIGA8Y2F0ZWdvcnk+Xzx0b29sPmAgd2l0aCB0aGUgZ2l2ZW4gYXJncyB1bmRlciBhbiBBYm9ydFNpZ25hbC4gKi9cclxuICAgIGV4ZWN1dGVUb29sQ2FsbChuYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSwgY3R4OiBUb29sRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8YW55PjtcclxufVxyXG5cclxuLyoqIFBlcuKAkXJlcXVlc3QgZXhlY3V0aW9uIGNvbnRleHQgaGFuZGVkIHRvIGEgdG9vbC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBUb29sRXhlY3V0aW9uQ29udGV4dCB7XHJcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsO1xyXG4gICAgLyoqIFByb2dyZXNzIHJlcG9ydGVyLiBgcHJvZ3Jlc3NUb2tlbmAgaXMgc2V0IHdoZW4gdGhlIGNsaWVudCBwcm92aWRlZCBvbmUuICovXHJcbiAgICBwcm9ncmVzc1Rva2VuPzogc3RyaW5nIHwgbnVtYmVyO1xyXG4gICAgcmVwb3J0UHJvZ3Jlc3MocHJvZ3Jlc3M6IG51bWJlciwgdG90YWw/OiBudW1iZXIsIG1lc3NhZ2U/OiBzdHJpbmcpOiB2b2lkO1xyXG4gICAgLyoqIFNlbmQgYSBsb2cgbm90aWZpY2F0aW9uIHRvIHRoZSBjbGllbnQgKHN1YmplY3QgdG8gY3VycmVudCBsb2cgbGV2ZWwpLiAqL1xyXG4gICAgbG9nKGxldmVsOiBNY3BMb2dMZXZlbCwgZGF0YTogYW55LCBsb2dnZXI/OiBzdHJpbmcpOiB2b2lkO1xyXG59XHJcblxyXG4vKiogTm90aWZpY2F0aW9uIHNpbmsg4oCUIHRyYW5zcG9ydHMgcGx1ZyB0aGVpciBkZWxpdmVyeSBoZXJlLiAqL1xyXG5leHBvcnQgdHlwZSBOb3RpZmljYXRpb25TaW5rID0gKG5vdGlmaWNhdGlvbjogSnNvblJwY1JlcXVlc3QpID0+IHZvaWQ7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFByb3RvY29sSGFuZGxlck9wdGlvbnMge1xyXG4gICAgcmVnaXN0cnk6IFRvb2xSZWdpc3RyeTtcclxuICAgIC8qKiBUb29scyBwZXIgYHRvb2xzL2xpc3RgIHBhZ2UuIERlZmF1bHQgMTAwIChHNCkuICovXHJcbiAgICBwYWdlU2l6ZT86IG51bWJlcjtcclxuICAgIC8qKiBJbml0aWFsIGxvZ2dpbmcgbGV2ZWwgKEE2KS4gRGVmYXVsdHMgdG8gYGluZm9gLiAqL1xyXG4gICAgaW5pdGlhbExvZ0xldmVsPzogTWNwTG9nTGV2ZWw7XHJcbiAgICAvKiogT3B0aW9uYWwgZmVhdHVyZSBmbGFncyBhZHZlcnRpc2VkIGluIGBpbml0aWFsaXplLnJlc3VsdC5jYXBhYmlsaXRpZXNgLiAqL1xyXG4gICAgZXh0cmFDYXBhYmlsaXRpZXM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xyXG4gICAgLyoqIFBoYXNlIDI6IHNoYXJlZCByZXNvdXJjZSByZWdpc3RyeSAoc2VydmVyLXdpZGUpLiAqL1xyXG4gICAgcmVzb3VyY2VzPzogUmVzb3VyY2VSZWdpc3RyeTtcclxuICAgIC8qKiBQaGFzZSAyOiBzaGFyZWQgcHJvbXB0IHJlZ2lzdHJ5IChzZXJ2ZXItd2lkZSkuICovXHJcbiAgICBwcm9tcHRzPzogUHJvbXB0UmVnaXN0cnk7XHJcbiAgICAvKiogUGhhc2UgMjogdGltZW91dCAobXMpIHdoZW4gd2FpdGluZyBmb3IgYSBgc2FtcGxpbmcvY3JlYXRlTWVzc2FnZWAgcmVwbHkuICovXHJcbiAgICBzYW1wbGluZ1RpbWVvdXRNcz86IG51bWJlcjtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFByb3RvY29sSGFuZGxlciB7XHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdHJ5OiBUb29sUmVnaXN0cnk7XHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBhZ2VTaXplOiBudW1iZXI7XHJcbiAgICBwcml2YXRlIGxvZ0xldmVsOiBNY3BMb2dMZXZlbDtcclxuICAgIHByaXZhdGUgbm90aWZ5U2luazogTm90aWZpY2F0aW9uU2luayB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSBpbkZsaWdodCA9IG5ldyBNYXA8c3RyaW5nIHwgbnVtYmVyLCBBYm9ydENvbnRyb2xsZXI+KCk7XHJcbiAgICBwcml2YXRlIGFqdjogQWp2O1xyXG4gICAgcHJpdmF0ZSB2YWxpZGF0b3JzID0gbmV3IE1hcDxzdHJpbmcsIFZhbGlkYXRlRnVuY3Rpb24+KCk7XHJcbiAgICBwcml2YXRlIGV4dHJhQ2FwYWJpbGl0aWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xyXG4gICAgcHJpdmF0ZSBuZWdvdGlhdGVkUHJvdG9jb2xWZXJzaW9uID0gREVGQVVMVF9QUk9UT0NPTF9WRVJTSU9OO1xyXG4gICAgcHJpdmF0ZSByZXNvdXJjZXM6IFJlc291cmNlUmVnaXN0cnkgfCBudWxsO1xyXG4gICAgcHJpdmF0ZSBwcm9tcHRzOiBQcm9tcHRSZWdpc3RyeSB8IG51bGw7XHJcbiAgICBwcml2YXRlIGNsaWVudENhcGFiaWxpdGllczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xyXG4gICAgcHJpdmF0ZSBzYW1wbGluZ1RpbWVvdXRNczogbnVtYmVyO1xyXG4gICAgLyoqIEluLWZsaWdodCBzZXJ2ZXLihpJjbGllbnQgcmVxdWVzdHMga2V5ZWQgYnkgdGhlaXIgb3V0Z29pbmcgaWQuICovXHJcbiAgICBwcml2YXRlIHBlbmRpbmdSZXF1ZXN0cyA9IG5ldyBNYXA8c3RyaW5nIHwgbnVtYmVyLCB7IHJlc29sdmU6ICh2OiBhbnkpID0+IHZvaWQ7IHJlamVjdDogKGU6IGFueSkgPT4gdm9pZDsgdGltZXI6IE5vZGVKUy5UaW1lb3V0IH0+KCk7XHJcbiAgICBwcml2YXRlIG5leHRPdXRnb2luZ0lkID0gMTtcclxuXHJcbiAgICBjb25zdHJ1Y3RvcihvcHRzOiBQcm90b2NvbEhhbmRsZXJPcHRpb25zKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RyeSA9IG9wdHMucmVnaXN0cnk7XHJcbiAgICAgICAgdGhpcy5wYWdlU2l6ZSA9IE1hdGgubWF4KDEsIG9wdHMucGFnZVNpemUgPz8gMTAwKTtcclxuICAgICAgICB0aGlzLmxvZ0xldmVsID0gb3B0cy5pbml0aWFsTG9nTGV2ZWwgPz8gJ2luZm8nO1xyXG4gICAgICAgIHRoaXMuZXh0cmFDYXBhYmlsaXRpZXMgPSBvcHRzLmV4dHJhQ2FwYWJpbGl0aWVzIHx8IHt9O1xyXG4gICAgICAgIHRoaXMucmVzb3VyY2VzID0gb3B0cy5yZXNvdXJjZXMgPz8gbnVsbDtcclxuICAgICAgICB0aGlzLnByb21wdHMgPSBvcHRzLnByb21wdHMgPz8gbnVsbDtcclxuICAgICAgICB0aGlzLnNhbXBsaW5nVGltZW91dE1zID0gTWF0aC5tYXgoMV8wMDAsIG9wdHMuc2FtcGxpbmdUaW1lb3V0TXMgPz8gNjBfMDAwKTtcclxuICAgICAgICB0aGlzLmFqdiA9IG5ldyBBanYoeyBhbGxFcnJvcnM6IHRydWUsIHN0cmljdDogZmFsc2UsIHVzZURlZmF1bHRzOiBmYWxzZSB9KTtcclxuICAgICAgICBhZGRGb3JtYXRzKHRoaXMuYWp2KTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgc2V0Tm90aWZpY2F0aW9uU2luayhzaW5rOiBOb3RpZmljYXRpb25TaW5rIHwgbnVsbCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMubm90aWZ5U2luayA9IHNpbms7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHNldExvZ0xldmVsKGxldmVsOiBNY3BMb2dMZXZlbCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMubG9nTGV2ZWwgPSBsZXZlbDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0TmVnb3RpYXRlZFByb3RvY29sVmVyc2lvbigpOiBzdHJpbmcge1xyXG4gICAgICAgIHJldHVybiB0aGlzLm5lZ290aWF0ZWRQcm90b2NvbFZlcnNpb247XHJcbiAgICB9XHJcblxyXG4gICAgLyoqIENhbmNlbCBldmVyeSBpbuKAkWZsaWdodCB0b29sIGNhbGwuIFVzZWQgb24gdHJhbnNwb3J0IHNodXRkb3duLiAqL1xyXG4gICAgcHVibGljIGNhbmNlbEFsbChyZWFzb24gPSAndHJhbnNwb3J0IGNsb3NlZCcpOiB2b2lkIHtcclxuICAgICAgICBmb3IgKGNvbnN0IFssIGN0cmxdIG9mIHRoaXMuaW5GbGlnaHQpIHtcclxuICAgICAgICAgICAgdHJ5IHsgY3RybC5hYm9ydChuZXcgRXJyb3IocmVhc29uKSk7IH0gY2F0Y2ggeyAvKiBub29wICovIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5pbkZsaWdodC5jbGVhcigpO1xyXG4gICAgICAgIGZvciAoY29uc3QgWywgcF0gb2YgdGhpcy5wZW5kaW5nUmVxdWVzdHMpIHtcclxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHAudGltZXIpO1xyXG4gICAgICAgICAgICB0cnkgeyBwLnJlamVjdChuZXcgRXJyb3IocmVhc29uKSk7IH0gY2F0Y2ggeyAvKiBub29wICovIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuY2xlYXIoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKiogRW50cnkgcG9pbnQgZm9yIHRoZSB0cmFuc3BvcnQuIFJldHVybnMgdGhlIHJlc3BvbnNlIChvciBudWxsIGZvciBub3RpZmljYXRpb25zKS4gKi9cclxuICAgIHB1YmxpYyBhc3luYyBoYW5kbGUocmF3OiBzdHJpbmcgfCBvYmplY3QpOiBQcm9taXNlPEpzb25ScGNSZXNwb25zZSB8IEpzb25ScGNSZXNwb25zZVtdIHwgbnVsbD4ge1xyXG4gICAgICAgIGxldCBtZXNzYWdlOiBhbnk7XHJcbiAgICAgICAgaWYgKHR5cGVvZiByYXcgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gcmF3Lmxlbmd0aCA9PT0gMCA/IG51bGwgOiBKU09OLnBhcnNlKHJhdyk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihudWxsLCBKU09OUlBDX1BBUlNFX0VSUk9SLCBgUGFyc2UgZXJyb3I6ICR7ZT8ubWVzc2FnZSA/PyAnaW52YWxpZCBKU09OJ31gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1lc3NhZ2UgPSByYXc7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShtZXNzYWdlKSkge1xyXG4gICAgICAgICAgICBpZiAobWVzc2FnZS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19JTlZBTElEX1JFUVVFU1QsICdJbnZhbGlkIFJlcXVlc3Q6IGVtcHR5IGJhdGNoJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3Qgb3V0OiBKc29uUnBjUmVzcG9uc2VbXSA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbWVzc2FnZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgciA9IGF3YWl0IHRoaXMuaGFuZGxlU2luZ2xlKGl0ZW0pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHIpIG91dC5wdXNoKHIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBvdXQubGVuZ3RoID8gb3V0IDogbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVNpbmdsZShtZXNzYWdlKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVNpbmdsZShtZXNzYWdlOiBhbnkpOiBQcm9taXNlPEpzb25ScGNSZXNwb25zZSB8IG51bGw+IHtcclxuICAgICAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkobWVzc2FnZSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihudWxsLCBKU09OUlBDX0lOVkFMSURfUkVRVUVTVCwgJ0ludmFsaWQgUmVxdWVzdCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWVzc2FnZS5qc29ucnBjICE9PSBKU09OUlBDX1ZFUlNJT04pIHtcclxuICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihtZXNzYWdlLmlkID8/IG51bGwsIEpTT05SUENfSU5WQUxJRF9SRVFVRVNULCAnSW52YWxpZCBSZXF1ZXN0OiBqc29ucnBjIG11c3QgYmUgXCIyLjBcIicpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gUGhhc2UgMjogcm91dGUgaW5jb21pbmcgcmVzcG9uc2VzIHRvIG91dGdvaW5nIHNlcnZlcuKGkmNsaWVudCByZXF1ZXN0c1xyXG4gICAgICAgIC8vIChlLmcuIGBzYW1wbGluZy9jcmVhdGVNZXNzYWdlYCkuIFJlc3BvbnNlcyBoYXZlIG5vIGBtZXRob2RgIGFuZCBhblxyXG4gICAgICAgIC8vIGBpZGAgdGhhdCBtYXRjaGVzIGEgcGVuZGluZyBlbnRyeS5cclxuICAgICAgICBpZiAobWVzc2FnZS5tZXRob2QgPT09IHVuZGVmaW5lZCAmJiAobWVzc2FnZS5yZXN1bHQgIT09IHVuZGVmaW5lZCB8fCBtZXNzYWdlLmVycm9yICE9PSB1bmRlZmluZWQpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBlbmRpbmcgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQobWVzc2FnZS5pZCk7XHJcbiAgICAgICAgICAgIGlmIChwZW5kaW5nKSB7XHJcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQocGVuZGluZy50aW1lcik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUobWVzc2FnZS5pZCk7XHJcbiAgICAgICAgICAgICAgICBpZiAobWVzc2FnZS5lcnJvcikgcGVuZGluZy5yZWplY3QobmV3IEpzb25ScGNFcnJvcihtZXNzYWdlLmVycm9yLmNvZGUgPz8gSlNPTlJQQ19JTlRFUk5BTF9FUlJPUiwgbWVzc2FnZS5lcnJvci5tZXNzYWdlID8/ICdjbGllbnQgZXJyb3InLCBtZXNzYWdlLmVycm9yLmRhdGEpKTtcclxuICAgICAgICAgICAgICAgIGVsc2UgcGVuZGluZy5yZXNvbHZlKG1lc3NhZ2UucmVzdWx0KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHsgaWQsIG1ldGhvZCwgcGFyYW1zIH0gPSBtZXNzYWdlO1xyXG4gICAgICAgIGNvbnN0IGlzTm90aWYgPSBpZCA9PT0gdW5kZWZpbmVkIHx8IGlkID09PSBudWxsO1xyXG4gICAgICAgIGlmICh0eXBlb2YgbWV0aG9kICE9PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZXR1cm4gaXNOb3RpZiA/IG51bGwgOiBtYWtlRXJyb3IoaWQsIEpTT05SUENfSU5WQUxJRF9SRVFVRVNULCAnSW52YWxpZCBSZXF1ZXN0OiBtaXNzaW5nIG1ldGhvZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gTm90aWZpY2F0aW9ucyBmaXJzdC5cclxuICAgICAgICAgICAgc3dpdGNoIChtZXRob2QpIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgJ25vdGlmaWNhdGlvbnMvaW5pdGlhbGl6ZWQnOlxyXG4gICAgICAgICAgICAgICAgY2FzZSAnaW5pdGlhbGl6ZWQnOlxyXG4gICAgICAgICAgICAgICAgY2FzZSAnbm90aWZpY2F0aW9ucy9yb290cy9saXN0X2NoYW5nZWQnOlxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICAgICAgY2FzZSAnbm90aWZpY2F0aW9ucy9jYW5jZWxsZWQnOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SWQgPSBwYXJhbXM/LnJlcXVlc3RJZDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SWQgIT09IHVuZGVmaW5lZCkgdGhpcy5jYW5jZWxSZXF1ZXN0KHRhcmdldElkLCBwYXJhbXM/LnJlYXNvbiA/PyAnY2FuY2VsbGVkIGJ5IGNsaWVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBsZXQgcmVzdWx0OiBhbnk7XHJcbiAgICAgICAgICAgIHN3aXRjaCAobWV0aG9kKSB7XHJcbiAgICAgICAgICAgICAgICBjYXNlICdpbml0aWFsaXplJzpcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB0aGlzLmhhbmRsZUluaXRpYWxpemUocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3BpbmcnOlxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHt9O1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSAnbG9nZ2luZy9zZXRMZXZlbCc6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gdGhpcy5oYW5kbGVMb2dnaW5nU2V0TGV2ZWwocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3Rvb2xzL2xpc3QnOlxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHRoaXMuaGFuZGxlVG9vbHNMaXN0KHBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICBjYXNlICd0b29scy9jYWxsJzpcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZVRvb2xzQ2FsbChpZCwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy9saXN0JzpcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZVJlc291cmNlc0xpc3QocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy90ZW1wbGF0ZXMvbGlzdCc6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVSZXNvdXJjZVRlbXBsYXRlc0xpc3QoKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy9yZWFkJzpcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZVJlc291cmNlc1JlYWQocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy9zdWJzY3JpYmUnOlxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlUmVzb3VyY2VzU3Vic2NyaWJlKHBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICBjYXNlICdyZXNvdXJjZXMvdW5zdWJzY3JpYmUnOlxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHRoaXMuaGFuZGxlUmVzb3VyY2VzVW5zdWJzY3JpYmUocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3Byb21wdHMvbGlzdCc6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVQcm9tcHRzTGlzdCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSAncHJvbXB0cy9nZXQnOlxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlUHJvbXB0c0dldChwYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSAnY29tcGxldGlvbi9jb21wbGV0ZSc6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVDb21wbGV0aW9uQ29tcGxldGUocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsIGBNZXRob2Qgbm90IGZvdW5kOiAke21ldGhvZH1gKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKGlzTm90aWYpIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICByZXR1cm4gbWFrZVJlc3VsdChpZCwgcmVzdWx0KTtcclxuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICBpZiAoaXNOb3RpZikgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvZGUgPSBlcnIgaW5zdGFuY2VvZiBKc29uUnBjRXJyb3IgPyBlcnIuY29kZSA6IEpTT05SUENfSU5URVJOQUxfRVJST1I7XHJcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBlcnIgaW5zdGFuY2VvZiBKc29uUnBjRXJyb3IgPyBlcnIuZGF0YSA6IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihpZCwgY29kZSwgZXJyPy5tZXNzYWdlID8/IFN0cmluZyhlcnIpLCBkYXRhKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gLS0gaGFuZGxlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBwcml2YXRlIGhhbmRsZUluaXRpYWxpemUocGFyYW1zOiBhbnkpOiBhbnkge1xyXG4gICAgICAgIGNvbnN0IHJlcXVlc3RlZCA9IHBhcmFtcz8ucHJvdG9jb2xWZXJzaW9uO1xyXG4gICAgICAgIGNvbnN0IG5lZ290aWF0ZWQgPSBTVVBQT1JURURfUFJPVE9DT0xfVkVSU0lPTlMuaW5jbHVkZXMocmVxdWVzdGVkKVxyXG4gICAgICAgICAgICA/IHJlcXVlc3RlZFxyXG4gICAgICAgICAgICA6IERFRkFVTFRfUFJPVE9DT0xfVkVSU0lPTjtcclxuICAgICAgICB0aGlzLm5lZ290aWF0ZWRQcm90b2NvbFZlcnNpb24gPSBuZWdvdGlhdGVkO1xyXG4gICAgICAgIHRoaXMuY2xpZW50Q2FwYWJpbGl0aWVzID0gKHBhcmFtcz8uY2FwYWJpbGl0aWVzICYmIHR5cGVvZiBwYXJhbXMuY2FwYWJpbGl0aWVzID09PSAnb2JqZWN0JykgPyBwYXJhbXMuY2FwYWJpbGl0aWVzIDoge307XHJcbiAgICAgICAgY29uc3QgY2FwYWJpbGl0aWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xyXG4gICAgICAgICAgICB0b29sczogeyBsaXN0Q2hhbmdlZDogdHJ1ZSB9LFxyXG4gICAgICAgICAgICBsb2dnaW5nOiB7fSxcclxuICAgICAgICAgICAgLi4udGhpcy5leHRyYUNhcGFiaWxpdGllc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgaWYgKHRoaXMucmVzb3VyY2VzKSB7XHJcbiAgICAgICAgICAgIGNhcGFiaWxpdGllcy5yZXNvdXJjZXMgPSB7IGxpc3RDaGFuZ2VkOiB0cnVlLCBzdWJzY3JpYmU6IHRydWUgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHRoaXMucHJvbXB0cykge1xyXG4gICAgICAgICAgICBjYXBhYmlsaXRpZXMucHJvbXB0cyA9IHsgbGlzdENoYW5nZWQ6IHRydWUgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gU2VydmVyLWluaXRpYXRlZCBzYW1wbGluZyByb3VuZC10cmlwIGlzIHN1cHBvcnRlZCB3aGVuIHRoZSBjbGllbnRcclxuICAgICAgICAvLyBhZHZlcnRpc2VzIHRoZSBtYXRjaGluZyBjYXBhYmlsaXR5IOKAlCB3ZSBzdGlsbCBhbm5vdW5jZSBpdCBzbyBvbGRlclxyXG4gICAgICAgIC8vIGNsaWVudHMgdGhhdCBwcm9iZSBjYXBhYmlsaXRpZXMga25vdyB0aGUgc2VydmVyIGlzIHdpbGxpbmcuXHJcbiAgICAgICAgY2FwYWJpbGl0aWVzLnNhbXBsaW5nID0gY2FwYWJpbGl0aWVzLnNhbXBsaW5nIHx8IHt9O1xyXG4gICAgICAgIGNhcGFiaWxpdGllcy5jb21wbGV0aW9ucyA9IGNhcGFiaWxpdGllcy5jb21wbGV0aW9ucyB8fCB7fTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBwcm90b2NvbFZlcnNpb246IG5lZ290aWF0ZWQsXHJcbiAgICAgICAgICAgIGNhcGFiaWxpdGllcyxcclxuICAgICAgICAgICAgc2VydmVySW5mbzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2NvY29zLW1jcC1zZXJ2ZXInLFxyXG4gICAgICAgICAgICAgICAgdmVyc2lvbjogJzEuNC4wJ1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBpbnN0cnVjdGlvbnM6XHJcbiAgICAgICAgICAgICAgICAnQ29jb3MgQ3JlYXRvciBNQ1Agc2VydmVyLiBDYWxsIHRvb2xzL2xpc3QgKHN1cHBvcnRzIGBjdXJzb3JgIHBhZ2luYXRpb24pICcgK1xyXG4gICAgICAgICAgICAgICAgJ3RvIGRpc2NvdmVyIGNhcGFiaWxpdGllcy4gTG9uZ+KAkXJ1bm5pbmcgY2FsbHMgY2FuIGJlIGFib3J0ZWQgd2l0aCAnICtcclxuICAgICAgICAgICAgICAgICdub3RpZmljYXRpb25zL2NhbmNlbGxlZC4gVXNlIGxvZ2dpbmcvc2V0TGV2ZWwgdG8gY29udHJvbCBsb2cgdmVyYm9zaXR5LiAnICtcclxuICAgICAgICAgICAgICAgICdSZXNvdXJjZXMgKHByb2plY3Q6Ly9pbmZvLCBzY2VuZTovL2N1cnJlbnQsIGFzc2V0czovL3RyZWUsIHJ1bnRpbWU6Ly9sb2dzKSAnICtcclxuICAgICAgICAgICAgICAgICdhbmQgcHJvbXB0cyBhcmUgYWxzbyBhdmFpbGFibGUuJ1xyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLyoqIFRydWUgd2hlbiB0aGUgY2xpZW50IGFkdmVydGlzZWQgdGhlIG5hbWVkIHRvcC1sZXZlbCBjYXBhYmlsaXR5LiAqL1xyXG4gICAgcHVibGljIGNsaWVudFN1cHBvcnRzKG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgICAgIHJldHVybiAhIXRoaXMuY2xpZW50Q2FwYWJpbGl0aWVzW25hbWVdO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgaGFuZGxlTG9nZ2luZ1NldExldmVsKHBhcmFtczogYW55KTogYW55IHtcclxuICAgICAgICBjb25zdCBsZXZlbCA9IHBhcmFtcz8ubGV2ZWw7XHJcbiAgICAgICAgaWYgKCFsZXZlbCB8fCAhTE9HX0xFVkVMX09SREVSLmluY2x1ZGVzKGxldmVsKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfSU5WQUxJRF9QQVJBTVMsIGBJbnZhbGlkIGxvZyBsZXZlbDogJHtsZXZlbH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5sb2dMZXZlbCA9IGxldmVsO1xyXG4gICAgICAgIHJldHVybiB7fTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGhhbmRsZVRvb2xzTGlzdChwYXJhbXM6IGFueSk6IGFueSB7XHJcbiAgICAgICAgY29uc3QgYWxsID0gdGhpcy5yZWdpc3RyeS5saXN0VG9vbHMoKS5tYXAoKHQpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgaGludHMgPSByZXNvbHZlVG9vbEhpbnRzKHQubmFtZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGRlZjogYW55ID0ge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogdC5uYW1lLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IHQuZGVzY3JpcHRpb24sXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogdC5pbnB1dFNjaGVtYVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBpZiAodC5vdXRwdXRTY2hlbWEgfHwgaGludHMub3V0cHV0U2NoZW1hKSBkZWYub3V0cHV0U2NoZW1hID0gdC5vdXRwdXRTY2hlbWEgPz8gaGludHMub3V0cHV0U2NoZW1hO1xyXG4gICAgICAgICAgICBpZiAodC5hbm5vdGF0aW9ucyB8fCBoaW50cy5hbm5vdGF0aW9ucykgZGVmLmFubm90YXRpb25zID0geyAuLi5oaW50cy5hbm5vdGF0aW9ucywgLi4uKHQuYW5ub3RhdGlvbnMgfHwge30pIH07XHJcbiAgICAgICAgICAgIHJldHVybiBkZWY7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEc0OiBjdXJzb3IgcGFnaW5hdGlvbi4gVGhlIGN1cnNvciBpcyB0aGUgb3BhcXVlIG5leHTigJFpbmRleC5cclxuICAgICAgICBjb25zdCBjdXJzb3IgPSBwYXJhbXM/LmN1cnNvcjtcclxuICAgICAgICBsZXQgc3RhcnQgPSAwO1xyXG4gICAgICAgIGlmIChjdXJzb3IgIT09IHVuZGVmaW5lZCAmJiBjdXJzb3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgY29uc3QgaWR4ID0gTnVtYmVyLnBhcnNlSW50KFN0cmluZyhjdXJzb3IpLCAxMCk7XHJcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlkeCkgfHwgaWR4IDwgMCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCBgSW52YWxpZCBjdXJzb3I6ICR7Y3Vyc29yfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHN0YXJ0ID0gaWR4O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1pbihhbGwubGVuZ3RoLCBzdGFydCArIHRoaXMucGFnZVNpemUpO1xyXG4gICAgICAgIGNvbnN0IHRvb2xzID0gYWxsLnNsaWNlKHN0YXJ0LCBlbmQpO1xyXG4gICAgICAgIGNvbnN0IG91dDogYW55ID0geyB0b29scyB9O1xyXG4gICAgICAgIGlmIChlbmQgPCBhbGwubGVuZ3RoKSBvdXQubmV4dEN1cnNvciA9IFN0cmluZyhlbmQpO1xyXG4gICAgICAgIHJldHVybiBvdXQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVUb29sc0NhbGwoaWQ6IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBpZiAoIXBhcmFtcyB8fCB0eXBlb2YgcGFyYW1zLm5hbWUgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcIm5hbWVcIiBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCB7IG5hbWUsIGFyZ3VtZW50czogYXJncyB9ID0gcGFyYW1zO1xyXG4gICAgICAgIGNvbnN0IHByb2dyZXNzVG9rZW4gPSBwYXJhbXM/Ll9tZXRhPy5wcm9ncmVzc1Rva2VuO1xyXG5cclxuICAgICAgICAvLyBHODogQWp2IGlucHV0IHZhbGlkYXRpb24uIExvb2sgdXAgdGhlIHRvb2wncyBpbnB1dFNjaGVtYSBhbmQgdmFsaWRhdGUuXHJcbiAgICAgICAgY29uc3QgZGVmID0gdGhpcy5yZWdpc3RyeS5saXN0VG9vbHMoKS5maW5kKCh0KSA9PiB0Lm5hbWUgPT09IG5hbWUpO1xyXG4gICAgICAgIGlmICghZGVmKSB7XHJcbiAgICAgICAgICAgIC8vIFBlciBNQ1Agc3BlYyB3ZSBzdGlsbCByZXR1cm4gYSByZXN1bHQgd2l0aCBpc0Vycm9yPXRydWUgc28gdGhlIExMTSBjYW4gcmVhY3QuXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50OiBbeyB0eXBlOiAndGV4dCcsIHRleHQ6IGBUb29sIG5vdCBmb3VuZDogJHtuYW1lfWAgfV0sXHJcbiAgICAgICAgICAgICAgICBpc0Vycm9yOiB0cnVlXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkZWYuaW5wdXRTY2hlbWEpIHtcclxuICAgICAgICAgICAgY29uc3QgdmFsaWRhdG9yID0gdGhpcy5nZXRWYWxpZGF0b3IobmFtZSwgZGVmLmlucHV0U2NoZW1hKTtcclxuICAgICAgICAgICAgY29uc3Qgb2sgPSB2YWxpZGF0b3IoYXJncyA/PyB7fSk7XHJcbiAgICAgICAgICAgIGlmICghb2spIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmFqdi5lcnJvcnNUZXh0KHZhbGlkYXRvci5lcnJvcnMsIHsgc2VwYXJhdG9yOiAnOyAnIH0pO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCBgSW52YWxpZCBhcmd1bWVudHMgZm9yICR7bmFtZX06ICR7bWVzc2FnZX1gLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9vbDogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcnM6IHZhbGlkYXRvci5lcnJvcnNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBBODogQWJvcnRTaWduYWwgd2lyaW5nLlxyXG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XHJcbiAgICAgICAgY29uc3QgdHJhY2tJZDogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCA9IGlkO1xyXG4gICAgICAgIGlmICh0cmFja0lkICE9PSB1bmRlZmluZWQgJiYgdHJhY2tJZCAhPT0gbnVsbCkgdGhpcy5pbkZsaWdodC5zZXQodHJhY2tJZCwgY29udHJvbGxlcik7XHJcblxyXG4gICAgICAgIGNvbnN0IGN0eDogVG9vbEV4ZWN1dGlvbkNvbnRleHQgPSB7XHJcbiAgICAgICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXHJcbiAgICAgICAgICAgIHByb2dyZXNzVG9rZW4sXHJcbiAgICAgICAgICAgIHJlcG9ydFByb2dyZXNzOiAocHJvZ3Jlc3MsIHRvdGFsLCBtZXNzYWdlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvZ3Jlc3NUb2tlbiA9PT0gdW5kZWZpbmVkKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9wcm9ncmVzcycsIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzc1Rva2VuLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2dyZXNzLFxyXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBsb2c6IChsZXZlbCwgZGF0YSwgbG9nZ2VyKSA9PiB0aGlzLmVtaXRMb2cobGV2ZWwsIGRhdGEsIGxvZ2dlcilcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB0b29sUmVzdWx0ID0gYXdhaXQgdGhpcy5yZWdpc3RyeS5leGVjdXRlVG9vbENhbGwobmFtZSwgYXJncyA/PyB7fSwgY3R4KTtcclxuICAgICAgICAgICAgY29uc3QgaXNFcnJvciA9ICEhKHRvb2xSZXN1bHQgJiYgdHlwZW9mIHRvb2xSZXN1bHQgPT09ICdvYmplY3QnICYmIHRvb2xSZXN1bHQuc3VjY2VzcyA9PT0gZmFsc2UpO1xyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQ6IGFueSA9IHtcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6IFt7IHR5cGU6ICd0ZXh0JywgdGV4dDogSlNPTi5zdHJpbmdpZnkodG9vbFJlc3VsdCkgfV0sXHJcbiAgICAgICAgICAgICAgICBpc0Vycm9yXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIC8vIE1DUCAyMDI14oCRMDbigJExODogd2hlbiB0aGUgdG9vbCBkZWNsYXJlcyBhbiBvdXRwdXRTY2hlbWEsIGluY2x1ZGUgYHN0cnVjdHVyZWRDb250ZW50YC5cclxuICAgICAgICAgICAgaWYgKGRlZi5vdXRwdXRTY2hlbWEgfHwgcmVzb2x2ZVRvb2xIaW50cyhuYW1lKS5vdXRwdXRTY2hlbWEpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5zdHJ1Y3R1cmVkQ29udGVudCA9IHRvb2xSZXN1bHQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICBpZiAoY29udHJvbGxlci5zaWduYWwuYWJvcnRlZCkge1xyXG4gICAgICAgICAgICAgICAgLy8gUmXigJF0aHJvdyBhcyBKU09O4oCRUlBDIGNhbmNlbGxhdGlvbiBlcnJvciBmb3IgY2xpZW50cyB0aGF0IHdhbnQgaXQuXHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKE1DUF9SRVFVRVNUX0NBTkNFTExFRCwgZXJyPy5tZXNzYWdlID8/ICdSZXF1ZXN0IGNhbmNlbGxlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50OiBbeyB0eXBlOiAndGV4dCcsIHRleHQ6IGVycj8ubWVzc2FnZSA/PyBTdHJpbmcoZXJyKSB9XSxcclxuICAgICAgICAgICAgICAgIGlzRXJyb3I6IHRydWVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICBpZiAodHJhY2tJZCAhPT0gdW5kZWZpbmVkICYmIHRyYWNrSWQgIT09IG51bGwpIHRoaXMuaW5GbGlnaHQuZGVsZXRlKHRyYWNrSWQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldFZhbGlkYXRvcihuYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55KTogVmFsaWRhdGVGdW5jdGlvbiB7XHJcbiAgICAgICAgbGV0IHYgPSB0aGlzLnZhbGlkYXRvcnMuZ2V0KG5hbWUpO1xyXG4gICAgICAgIGlmICghdikge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgdiA9IHRoaXMuYWp2LmNvbXBpbGUoc2NoZW1hKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgICAgICAgICAvLyBTY2hlbWEgYnVnIHNob3VsZG4ndCBraWxsIHRoZSBjYWxsIOKAlCBmYWxsIGJhY2sgdG8gYSBwZXJtaXNzaXZlIHZhbGlkYXRvci5cclxuICAgICAgICAgICAgICAgIHYgPSAoKCkgPT4gdHJ1ZSkgYXMgdW5rbm93biBhcyBWYWxpZGF0ZUZ1bmN0aW9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMudmFsaWRhdG9ycy5zZXQobmFtZSwgdik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB2O1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY2FuY2VsUmVxdWVzdChyZXF1ZXN0SWQ6IHN0cmluZyB8IG51bWJlciwgcmVhc29uOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICBjb25zdCBjdHJsID0gdGhpcy5pbkZsaWdodC5nZXQocmVxdWVzdElkKTtcclxuICAgICAgICBpZiAoY3RybCkge1xyXG4gICAgICAgICAgICB0cnkgeyBjdHJsLmFib3J0KG5ldyBFcnJvcihyZWFzb24pKTsgfSBjYXRjaCB7IC8qIG5vb3AgKi8gfVxyXG4gICAgICAgICAgICB0aGlzLmluRmxpZ2h0LmRlbGV0ZShyZXF1ZXN0SWQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGVtaXRMb2cobGV2ZWw6IE1jcExvZ0xldmVsLCBkYXRhOiBhbnksIGxvZ2dlcj86IHN0cmluZyk6IHZvaWQge1xyXG4gICAgICAgIGlmICghbGV2ZWxBdExlYXN0KGxldmVsLCB0aGlzLmxvZ0xldmVsKSkgcmV0dXJuO1xyXG4gICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL21lc3NhZ2UnLCB7IGxldmVsLCBsb2dnZXIsIGRhdGEgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBub3RpZnkobWV0aG9kOiBzdHJpbmcsIHBhcmFtcz86IGFueSk6IHZvaWQge1xyXG4gICAgICAgIGlmICghdGhpcy5ub3RpZnlTaW5rKSByZXR1cm47XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhpcy5ub3RpZnlTaW5rKHsganNvbnJwYzogSlNPTlJQQ19WRVJTSU9OLCBtZXRob2QsIHBhcmFtcyB9KTtcclxuICAgICAgICB9IGNhdGNoIHsgLyogc2luayBlcnJvcnMgbXVzdCBub3QgYnJlYWsgdG9vbCBleGVjdXRpb24gKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKiBJbnZhbGlkYXRlIGNhY2hlZCB2YWxpZGF0b3JzIHdoZW4gdGhlIGVuYWJsZWQgdG9vbCBzZXQgY2hhbmdlcy4gKi9cclxuICAgIHB1YmxpYyBjbGVhclZhbGlkYXRvckNhY2hlKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMudmFsaWRhdG9ycy5jbGVhcigpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKiBQaGFzZSAxIGZvbGxvdy11cDogZW1pdCBgbm90aWZpY2F0aW9ucy90b29scy9saXN0X2NoYW5nZWRgLiAqL1xyXG4gICAgcHVibGljIGVtaXRUb29sc0xpc3RDaGFuZ2VkKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL3Rvb2xzL2xpc3RfY2hhbmdlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKiBHZW5lcmljIGhlbHBlciB1c2VkIGJ5IHJlZ2lzdHJpZXMgdG8gZW1pdCBhbnkgbm90aWZpY2F0aW9uIHRvIHRoZSBjbGllbnQuICovXHJcbiAgICBwdWJsaWMgZW1pdE5vdGlmaWNhdGlvbihtZXRob2Q6IHN0cmluZywgcGFyYW1zPzogYW55KTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5ub3RpZnkobWV0aG9kLCBwYXJhbXMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIC0tIFBoYXNlIDIgaGFuZGxlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXNvdXJjZXNMaXN0KHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBpZiAoIXRoaXMucmVzb3VyY2VzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCAncmVzb3VyY2VzIGNhcGFiaWxpdHkgbm90IGVuYWJsZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgYWxsID0gYXdhaXQgdGhpcy5yZXNvdXJjZXMubGlzdFJlc291cmNlcygpO1xyXG4gICAgICAgIC8vIFJldXNlIHRoZSBzYW1lIG9wYXF1ZSBjdXJzb3Igc2NoZW1lIGFzIHRvb2xzL2xpc3QgKEc0KS5cclxuICAgICAgICBjb25zdCBjdXJzb3IgPSBwYXJhbXM/LmN1cnNvcjtcclxuICAgICAgICBsZXQgc3RhcnQgPSAwO1xyXG4gICAgICAgIGlmIChjdXJzb3IgIT09IHVuZGVmaW5lZCAmJiBjdXJzb3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgY29uc3QgaWR4ID0gTnVtYmVyLnBhcnNlSW50KFN0cmluZyhjdXJzb3IpLCAxMCk7XHJcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlkeCkgfHwgaWR4IDwgMCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCBgSW52YWxpZCBjdXJzb3I6ICR7Y3Vyc29yfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHN0YXJ0ID0gaWR4O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1pbihhbGwubGVuZ3RoLCBzdGFydCArIHRoaXMucGFnZVNpemUpO1xyXG4gICAgICAgIGNvbnN0IG91dDogYW55ID0geyByZXNvdXJjZXM6IGFsbC5zbGljZShzdGFydCwgZW5kKSB9O1xyXG4gICAgICAgIGlmIChlbmQgPCBhbGwubGVuZ3RoKSBvdXQubmV4dEN1cnNvciA9IFN0cmluZyhlbmQpO1xyXG4gICAgICAgIHJldHVybiBvdXQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXNvdXJjZVRlbXBsYXRlc0xpc3QoKTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBpZiAoIXRoaXMucmVzb3VyY2VzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCAncmVzb3VyY2VzIGNhcGFiaWxpdHkgbm90IGVuYWJsZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHsgcmVzb3VyY2VUZW1wbGF0ZXM6IGF3YWl0IHRoaXMucmVzb3VyY2VzLmxpc3RSZXNvdXJjZVRlbXBsYXRlcygpIH07XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXNvdXJjZXNSZWFkKHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBpZiAoIXRoaXMucmVzb3VyY2VzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCAncmVzb3VyY2VzIGNhcGFiaWxpdHkgbm90IGVuYWJsZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFwYXJhbXMgfHwgdHlwZW9mIHBhcmFtcy51cmkgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcInVyaVwiIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlc291cmNlcy5yZWFkUmVzb3VyY2UocGFyYW1zLnVyaSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXNvdXJjZXNTdWJzY3JpYmUocGFyYW1zOiBhbnkpOiBQcm9taXNlPGFueT4ge1xyXG4gICAgICAgIGlmICghdGhpcy5yZXNvdXJjZXMpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsICdyZXNvdXJjZXMgY2FwYWJpbGl0eSBub3QgZW5hYmxlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIXBhcmFtcyB8fCB0eXBlb2YgcGFyYW1zLnVyaSAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCAnSW52YWxpZCBwYXJhbXM6IFwidXJpXCIgaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgYXdhaXQgdGhpcy5yZXNvdXJjZXMuc3Vic2NyaWJlKHBhcmFtcy51cmkpO1xyXG4gICAgICAgIHJldHVybiB7fTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGhhbmRsZVJlc291cmNlc1Vuc3Vic2NyaWJlKHBhcmFtczogYW55KTogYW55IHtcclxuICAgICAgICBpZiAoIXRoaXMucmVzb3VyY2VzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCAncmVzb3VyY2VzIGNhcGFiaWxpdHkgbm90IGVuYWJsZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFwYXJhbXMgfHwgdHlwZW9mIHBhcmFtcy51cmkgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcInVyaVwiIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMucmVzb3VyY2VzLnVuc3Vic2NyaWJlKHBhcmFtcy51cmkpO1xyXG4gICAgICAgIHJldHVybiB7fTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVByb21wdHNMaXN0KCk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnByb21wdHMpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsICdwcm9tcHRzIGNhcGFiaWxpdHkgbm90IGVuYWJsZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHsgcHJvbXB0czogYXdhaXQgdGhpcy5wcm9tcHRzLmxpc3RQcm9tcHRzKCkgfTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVByb21wdHNHZXQocGFyYW1zOiBhbnkpOiBQcm9taXNlPGFueT4ge1xyXG4gICAgICAgIGlmICghdGhpcy5wcm9tcHRzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCAncHJvbXB0cyBjYXBhYmlsaXR5IG5vdCBlbmFibGVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghcGFyYW1zIHx8IHR5cGVvZiBwYXJhbXMubmFtZSAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCAnSW52YWxpZCBwYXJhbXM6IFwibmFtZVwiIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGFyZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcclxuICAgICAgICBpZiAocGFyYW1zLmFyZ3VtZW50cyAmJiB0eXBlb2YgcGFyYW1zLmFyZ3VtZW50cyA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocGFyYW1zLmFyZ3VtZW50cykpIHtcclxuICAgICAgICAgICAgICAgIGFyZ3Nba10gPSB0eXBlb2YgdiA9PT0gJ3N0cmluZycgPyB2IDogU3RyaW5nKHYpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnByb21wdHMuZ2V0UHJvbXB0KHBhcmFtcy5uYW1lLCBhcmdzKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZUNvbXBsZXRpb25Db21wbGV0ZShwYXJhbXM6IGFueSk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgaWYgKCFwYXJhbXMgfHwgIXBhcmFtcy5yZWYgfHwgdHlwZW9mIHBhcmFtcy5yZWYgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcInJlZlwiIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGFyZ05hbWUgPSBwYXJhbXM/LmFyZ3VtZW50Py5uYW1lO1xyXG4gICAgICAgIGNvbnN0IHZhbHVlID0gcGFyYW1zPy5hcmd1bWVudD8udmFsdWUgPz8gJyc7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBhcmdOYW1lICE9PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfSU5WQUxJRF9QQVJBTVMsICdJbnZhbGlkIHBhcmFtczogXCJhcmd1bWVudC5uYW1lXCIgaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbGV0IHZhbHVlczogc3RyaW5nW10gPSBbXTtcclxuICAgICAgICBpZiAocGFyYW1zLnJlZi50eXBlID09PSAncmVmL3Byb21wdCcgJiYgdGhpcy5wcm9tcHRzKSB7XHJcbiAgICAgICAgICAgIHZhbHVlcyA9IGF3YWl0IHRoaXMucHJvbXB0cy5jb21wbGV0ZShwYXJhbXMucmVmLm5hbWUsIGFyZ05hbWUsIHZhbHVlKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHBhcmFtcy5yZWYudHlwZSA9PT0gJ3JlZi9yZXNvdXJjZScgJiYgdGhpcy5yZXNvdXJjZXMpIHtcclxuICAgICAgICAgICAgdmFsdWVzID0gYXdhaXQgdGhpcy5yZXNvdXJjZXMuY29tcGxldGUocGFyYW1zLnJlZi51cmksIGFyZ05hbWUsIHZhbHVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gRmlsdGVyIGJ5IGN1cnJlbnQgdmFsdWUgcHJlZml4IHdoZW4gdGhlIHByb3ZpZGVyIGRpZG4ndCBhbHJlYWR5LlxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkID0gdmFsdWVcclxuICAgICAgICAgICAgPyB2YWx1ZXMuZmlsdGVyKCh2KSA9PiB2LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoU3RyaW5nKHZhbHVlKS50b0xvd2VyQ2FzZSgpKSlcclxuICAgICAgICAgICAgOiB2YWx1ZXM7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgY29tcGxldGlvbjoge1xyXG4gICAgICAgICAgICAgICAgdmFsdWVzOiBmaWx0ZXJlZC5zbGljZSgwLCAxMDApLFxyXG4gICAgICAgICAgICAgICAgdG90YWw6IGZpbHRlcmVkLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgIGhhc01vcmU6IGZpbHRlcmVkLmxlbmd0aCA+IDEwMFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFBoYXNlIDI6IGFzayB0aGUgY29ubmVjdGVkIGNsaWVudCB0byBwZXJmb3JtIExMTSBzYW1wbGluZy4gUmVzb2x2ZXMgd2l0aFxyXG4gICAgICogdGhlIGNsaWVudCdzIHJlc3BvbnNlIG9yIHJlamVjdHMgb24gdGltZW91dCAvIGNsaWVudCBlcnJvci5cclxuICAgICAqL1xyXG4gICAgcHVibGljIGFzeW5jIHJlcXVlc3RTYW1wbGluZyhyZXE6IE1jcFNhbXBsaW5nUmVxdWVzdCk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc2VuZENsaWVudFJlcXVlc3QoJ3NhbXBsaW5nL2NyZWF0ZU1lc3NhZ2UnLCByZXEpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKiBTZW5kIGFueSBzZXJ2ZXLihpJjbGllbnQgSlNPTi1SUEMgcmVxdWVzdCBhbmQgYXdhaXQgdGhlIHJlc3BvbnNlLiAqL1xyXG4gICAgcHVibGljIHNlbmRDbGllbnRSZXF1ZXN0KG1ldGhvZDogc3RyaW5nLCBwYXJhbXM6IGFueSk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLm5vdGlmeVNpbmspIHtcclxuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvcignTm8gYWN0aXZlIGNsaWVudCBjaGFubmVsIGZvciBzZXJ2ZXLihpJjbGllbnQgcmVxdWVzdCcpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgaWQgPSB0aGlzLm5leHRPdXRnb2luZ0lkKys7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQ2xpZW50IHJlcXVlc3QgXCIke21ldGhvZH1cIiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNhbXBsaW5nVGltZW91dE1zfW1zYCkpO1xyXG4gICAgICAgICAgICB9LCB0aGlzLnNhbXBsaW5nVGltZW91dE1zKTtcclxuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KGlkLCB7IHJlc29sdmUsIHJlamVjdCwgdGltZXIgfSk7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeVNpbmshKHsganNvbnJwYzogSlNPTlJQQ19WRVJTSU9OLCBpZCwgbWV0aG9kLCBwYXJhbXMgfSBhcyBhbnkpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKGlkKTtcclxuICAgICAgICAgICAgICAgIHJlamVjdChlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG59XHJcbiJdfQ==