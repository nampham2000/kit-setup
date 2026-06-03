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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdG9jb2wtaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NvdXJjZS9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7Ozs7OztBQUVILDhDQUE0QztBQUM1Qyw4REFBcUM7QUFDckMsdUNBYW1CO0FBQ25CLDZDQUFnRDtBQUloRCxzRUFBc0U7QUFDekQsUUFBQSwyQkFBMkIsR0FBRyxDQUFDLFlBQVksRUFBRSxZQUFZLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDekUsUUFBQSx3QkFBd0IsR0FBRyxtQ0FBMkIsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUV2RSxNQUFNLGVBQWUsR0FBa0I7SUFDbkMsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsT0FBTyxFQUFFLFdBQVc7Q0FDbEYsQ0FBQztBQUVGLFNBQVMsWUFBWSxDQUFDLEtBQWtCLEVBQUUsU0FBc0I7SUFDNUQsT0FBTyxlQUFlLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLGVBQWUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDaEYsQ0FBQztBQXVDRCxNQUFhLGVBQWU7SUFrQnhCLFlBQVksSUFBNEI7O1FBZGhDLGVBQVUsR0FBNEIsSUFBSSxDQUFDO1FBQzNDLGFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBb0MsQ0FBQztRQUV2RCxlQUFVLEdBQUcsSUFBSSxHQUFHLEVBQTRCLENBQUM7UUFFakQsOEJBQXlCLEdBQUcsZ0NBQXdCLENBQUM7UUFHckQsdUJBQWtCLEdBQXdCLEVBQUUsQ0FBQztRQUVyRCxtRUFBbUU7UUFDM0Qsb0JBQWUsR0FBRyxJQUFJLEdBQUcsRUFBbUcsQ0FBQztRQUM3SCxtQkFBYyxHQUFHLENBQUMsQ0FBQztRQUd2QixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFR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RUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBUyxDQUFDLENBQUM7WUFDOUUsQ0FBQztZQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ1QsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUNwQixJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDaEMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2QsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBbGhCRCwwQ0FraEJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUcmFuc3BvcnTigJFhZ25vc3RpYyBNQ1AgcHJvdG9jb2wgaGFuZGxlci5cbiAqXG4gKiBUaGUge0BsaW5rIFByb3RvY29sSGFuZGxlcn0gb3duczpcbiAqICAgLSBKU09O4oCRUlBDIDIuMCBtZXNzYWdlIGRpc3BhdGNoXG4gKiAgIC0gVGhlIE1DUCBjYXBhYmlsaXR5IGhhbmRzaGFrZSAoYGluaXRpYWxpemVgKVxuICogICAtIFRvb2wgbGlzdGluZyB3aXRoIHBhZ2luYXRpb24gY3Vyc29ycyAoRzQpXG4gKiAgIC0gVG9vbCBjYWxscyB3aXRoIEFqdiBpbnB1dCB2YWxpZGF0aW9uIChHOCkgYW5kIEFib3J0U2lnbmFsIGNhbmNlbGxhdGlvbiAoQTgpXG4gKiAgIC0gYGxvZ2dpbmcvc2V0TGV2ZWxgICsgYG5vdGlmaWNhdGlvbnMvbWVzc2FnZWAgKEE2KVxuICogICAtIGBub3RpZmljYXRpb25zL3Byb2dyZXNzYCBwbHVtYmluZyAoQTcpXG4gKiAgIC0gcHJvdG9jb2xWZXJzaW9uIG5lZ290aWF0aW9uICsgZmVhdHVyZSBmbGFncyAoRzkpXG4gKlxuICogVHJhbnNwb3J0cyAoU3RyZWFtYWJsZSBIVFRQLCBzdGRpbywgZnV0dXJlIFdlYlNvY2tldCkgb25seSBuZWVkIHRvIHB1c2hcbiAqIGluY29taW5nIGBzdHJpbmcgfCBvYmplY3RgIG1lc3NhZ2VzIGludG8ge0BsaW5rIFByb3RvY29sSGFuZGxlci5oYW5kbGV9XG4gKiBhbmQgZm9yd2FyZCBlbWl0dGVkIHNlcnZlciBub3RpZmljYXRpb25zIHRvIHRoZWlyIHBlZXIuXG4gKi9cblxuaW1wb3J0IEFqdiwgeyBWYWxpZGF0ZUZ1bmN0aW9uIH0gZnJvbSAnYWp2JztcbmltcG9ydCBhZGRGb3JtYXRzIGZyb20gJ2Fqdi1mb3JtYXRzJztcbmltcG9ydCB7XG4gICAgSlNPTlJQQ19JTlRFUk5BTF9FUlJPUixcbiAgICBKU09OUlBDX0lOVkFMSURfUEFSQU1TLFxuICAgIEpTT05SUENfSU5WQUxJRF9SRVFVRVNULFxuICAgIEpTT05SUENfTUVUSE9EX05PVF9GT1VORCxcbiAgICBKU09OUlBDX1BBUlNFX0VSUk9SLFxuICAgIEpTT05SUENfVkVSU0lPTixcbiAgICBKc29uUnBjRXJyb3IsXG4gICAgSnNvblJwY1JlcXVlc3QsXG4gICAgSnNvblJwY1Jlc3BvbnNlLFxuICAgIE1DUF9SRVFVRVNUX0NBTkNFTExFRCxcbiAgICBtYWtlRXJyb3IsXG4gICAgbWFrZVJlc3VsdFxufSBmcm9tICcuL2pzb25ycGMnO1xuaW1wb3J0IHsgcmVzb2x2ZVRvb2xIaW50cyB9IGZyb20gJy4vdG9vbC1oaW50cyc7XG5pbXBvcnQgeyBQcm9tcHRSZWdpc3RyeSwgUmVzb3VyY2VSZWdpc3RyeSB9IGZyb20gJy4vcmVnaXN0cmllcyc7XG5pbXBvcnQgeyBNY3BMb2dMZXZlbCwgTWNwU2FtcGxpbmdSZXF1ZXN0LCBUb29sRGVmaW5pdGlvbiB9IGZyb20gJy4uL3R5cGVzJztcblxuLy8gUHJvdG9jb2wgdmVyc2lvbnMgdGhpcyBzZXJ2ZXIgdW5kZXJzdGFuZHMuIFRoZSBsYXRlc3QgaXMgcHJlZmVycmVkLlxuZXhwb3J0IGNvbnN0IFNVUFBPUlRFRF9QUk9UT0NPTF9WRVJTSU9OUyA9IFsnMjAyNS0wNi0xOCcsICcyMDI1LTAzLTI2JywgJzIwMjQtMTEtMDUnXTtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1BST1RPQ09MX1ZFUlNJT04gPSBTVVBQT1JURURfUFJPVE9DT0xfVkVSU0lPTlNbMF07XG5cbmNvbnN0IExPR19MRVZFTF9PUkRFUjogTWNwTG9nTGV2ZWxbXSA9IFtcbiAgICAnZGVidWcnLCAnaW5mbycsICdub3RpY2UnLCAnd2FybmluZycsICdlcnJvcicsICdjcml0aWNhbCcsICdhbGVydCcsICdlbWVyZ2VuY3knXG5dO1xuXG5mdW5jdGlvbiBsZXZlbEF0TGVhc3QobGV2ZWw6IE1jcExvZ0xldmVsLCB0aHJlc2hvbGQ6IE1jcExvZ0xldmVsKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIExPR19MRVZFTF9PUkRFUi5pbmRleE9mKGxldmVsKSA+PSBMT0dfTEVWRUxfT1JERVIuaW5kZXhPZih0aHJlc2hvbGQpO1xufVxuXG4vKiogVG9vbCByZWdpc3RyeSBwYXNzZWQgdG8gdGhlIGhhbmRsZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvb2xSZWdpc3RyeSB7XG4gICAgLyoqIFJldHVybiB0aGUgZnVsbCBlbmFibGVkIHRvb2wgbGlzdCAoYWxyZWFkeSBmaWx0ZXJlZCBieSBUb29sTWFuYWdlcikuICovXG4gICAgbGlzdFRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW107XG4gICAgLyoqIEV4ZWN1dGUgYDxjYXRlZ29yeT5fPHRvb2w+YCB3aXRoIHRoZSBnaXZlbiBhcmdzIHVuZGVyIGFuIEFib3J0U2lnbmFsLiAqL1xuICAgIGV4ZWN1dGVUb29sQ2FsbChuYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSwgY3R4OiBUb29sRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8YW55Pjtcbn1cblxuLyoqIFBlcuKAkXJlcXVlc3QgZXhlY3V0aW9uIGNvbnRleHQgaGFuZGVkIHRvIGEgdG9vbC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG9vbEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIHNpZ25hbDogQWJvcnRTaWduYWw7XG4gICAgLyoqIFByb2dyZXNzIHJlcG9ydGVyLiBgcHJvZ3Jlc3NUb2tlbmAgaXMgc2V0IHdoZW4gdGhlIGNsaWVudCBwcm92aWRlZCBvbmUuICovXG4gICAgcHJvZ3Jlc3NUb2tlbj86IHN0cmluZyB8IG51bWJlcjtcbiAgICByZXBvcnRQcm9ncmVzcyhwcm9ncmVzczogbnVtYmVyLCB0b3RhbD86IG51bWJlciwgbWVzc2FnZT86IHN0cmluZyk6IHZvaWQ7XG4gICAgLyoqIFNlbmQgYSBsb2cgbm90aWZpY2F0aW9uIHRvIHRoZSBjbGllbnQgKHN1YmplY3QgdG8gY3VycmVudCBsb2cgbGV2ZWwpLiAqL1xuICAgIGxvZyhsZXZlbDogTWNwTG9nTGV2ZWwsIGRhdGE6IGFueSwgbG9nZ2VyPzogc3RyaW5nKTogdm9pZDtcbn1cblxuLyoqIE5vdGlmaWNhdGlvbiBzaW5rIOKAlCB0cmFuc3BvcnRzIHBsdWcgdGhlaXIgZGVsaXZlcnkgaGVyZS4gKi9cbmV4cG9ydCB0eXBlIE5vdGlmaWNhdGlvblNpbmsgPSAobm90aWZpY2F0aW9uOiBKc29uUnBjUmVxdWVzdCkgPT4gdm9pZDtcblxuZXhwb3J0IGludGVyZmFjZSBQcm90b2NvbEhhbmRsZXJPcHRpb25zIHtcbiAgICByZWdpc3RyeTogVG9vbFJlZ2lzdHJ5O1xuICAgIC8qKiBUb29scyBwZXIgYHRvb2xzL2xpc3RgIHBhZ2UuIERlZmF1bHQgMTAwIChHNCkuICovXG4gICAgcGFnZVNpemU/OiBudW1iZXI7XG4gICAgLyoqIEluaXRpYWwgbG9nZ2luZyBsZXZlbCAoQTYpLiBEZWZhdWx0cyB0byBgaW5mb2AuICovXG4gICAgaW5pdGlhbExvZ0xldmVsPzogTWNwTG9nTGV2ZWw7XG4gICAgLyoqIE9wdGlvbmFsIGZlYXR1cmUgZmxhZ3MgYWR2ZXJ0aXNlZCBpbiBgaW5pdGlhbGl6ZS5yZXN1bHQuY2FwYWJpbGl0aWVzYC4gKi9cbiAgICBleHRyYUNhcGFiaWxpdGllcz86IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgLyoqIFBoYXNlIDI6IHNoYXJlZCByZXNvdXJjZSByZWdpc3RyeSAoc2VydmVyLXdpZGUpLiAqL1xuICAgIHJlc291cmNlcz86IFJlc291cmNlUmVnaXN0cnk7XG4gICAgLyoqIFBoYXNlIDI6IHNoYXJlZCBwcm9tcHQgcmVnaXN0cnkgKHNlcnZlci13aWRlKS4gKi9cbiAgICBwcm9tcHRzPzogUHJvbXB0UmVnaXN0cnk7XG4gICAgLyoqIFBoYXNlIDI6IHRpbWVvdXQgKG1zKSB3aGVuIHdhaXRpbmcgZm9yIGEgYHNhbXBsaW5nL2NyZWF0ZU1lc3NhZ2VgIHJlcGx5LiAqL1xuICAgIHNhbXBsaW5nVGltZW91dE1zPzogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgUHJvdG9jb2xIYW5kbGVyIHtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdHJ5OiBUb29sUmVnaXN0cnk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBwYWdlU2l6ZTogbnVtYmVyO1xuICAgIHByaXZhdGUgbG9nTGV2ZWw6IE1jcExvZ0xldmVsO1xuICAgIHByaXZhdGUgbm90aWZ5U2luazogTm90aWZpY2F0aW9uU2luayB8IG51bGwgPSBudWxsO1xuICAgIHByaXZhdGUgaW5GbGlnaHQgPSBuZXcgTWFwPHN0cmluZyB8IG51bWJlciwgQWJvcnRDb250cm9sbGVyPigpO1xuICAgIHByaXZhdGUgYWp2OiBBanY7XG4gICAgcHJpdmF0ZSB2YWxpZGF0b3JzID0gbmV3IE1hcDxzdHJpbmcsIFZhbGlkYXRlRnVuY3Rpb24+KCk7XG4gICAgcHJpdmF0ZSBleHRyYUNhcGFiaWxpdGllczogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICBwcml2YXRlIG5lZ290aWF0ZWRQcm90b2NvbFZlcnNpb24gPSBERUZBVUxUX1BST1RPQ09MX1ZFUlNJT047XG4gICAgcHJpdmF0ZSByZXNvdXJjZXM6IFJlc291cmNlUmVnaXN0cnkgfCBudWxsO1xuICAgIHByaXZhdGUgcHJvbXB0czogUHJvbXB0UmVnaXN0cnkgfCBudWxsO1xuICAgIHByaXZhdGUgY2xpZW50Q2FwYWJpbGl0aWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgcHJpdmF0ZSBzYW1wbGluZ1RpbWVvdXRNczogbnVtYmVyO1xuICAgIC8qKiBJbi1mbGlnaHQgc2VydmVy4oaSY2xpZW50IHJlcXVlc3RzIGtleWVkIGJ5IHRoZWlyIG91dGdvaW5nIGlkLiAqL1xuICAgIHByaXZhdGUgcGVuZGluZ1JlcXVlc3RzID0gbmV3IE1hcDxzdHJpbmcgfCBudW1iZXIsIHsgcmVzb2x2ZTogKHY6IGFueSkgPT4gdm9pZDsgcmVqZWN0OiAoZTogYW55KSA9PiB2b2lkOyB0aW1lcjogTm9kZUpTLlRpbWVvdXQgfT4oKTtcbiAgICBwcml2YXRlIG5leHRPdXRnb2luZ0lkID0gMTtcblxuICAgIGNvbnN0cnVjdG9yKG9wdHM6IFByb3RvY29sSGFuZGxlck9wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5yZWdpc3RyeSA9IG9wdHMucmVnaXN0cnk7XG4gICAgICAgIHRoaXMucGFnZVNpemUgPSBNYXRoLm1heCgxLCBvcHRzLnBhZ2VTaXplID8/IDEwMCk7XG4gICAgICAgIHRoaXMubG9nTGV2ZWwgPSBvcHRzLmluaXRpYWxMb2dMZXZlbCA/PyAnaW5mbyc7XG4gICAgICAgIHRoaXMuZXh0cmFDYXBhYmlsaXRpZXMgPSBvcHRzLmV4dHJhQ2FwYWJpbGl0aWVzIHx8IHt9O1xuICAgICAgICB0aGlzLnJlc291cmNlcyA9IG9wdHMucmVzb3VyY2VzID8/IG51bGw7XG4gICAgICAgIHRoaXMucHJvbXB0cyA9IG9wdHMucHJvbXB0cyA/PyBudWxsO1xuICAgICAgICB0aGlzLnNhbXBsaW5nVGltZW91dE1zID0gTWF0aC5tYXgoMV8wMDAsIG9wdHMuc2FtcGxpbmdUaW1lb3V0TXMgPz8gNjBfMDAwKTtcbiAgICAgICAgdGhpcy5hanYgPSBuZXcgQWp2KHsgYWxsRXJyb3JzOiB0cnVlLCBzdHJpY3Q6IGZhbHNlLCB1c2VEZWZhdWx0czogZmFsc2UgfSk7XG4gICAgICAgIGFkZEZvcm1hdHModGhpcy5hanYpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXROb3RpZmljYXRpb25TaW5rKHNpbms6IE5vdGlmaWNhdGlvblNpbmsgfCBudWxsKTogdm9pZCB7XG4gICAgICAgIHRoaXMubm90aWZ5U2luayA9IHNpbms7XG4gICAgfVxuXG4gICAgcHVibGljIHNldExvZ0xldmVsKGxldmVsOiBNY3BMb2dMZXZlbCk6IHZvaWQge1xuICAgICAgICB0aGlzLmxvZ0xldmVsID0gbGV2ZWw7XG4gICAgfVxuXG4gICAgcHVibGljIGdldE5lZ290aWF0ZWRQcm90b2NvbFZlcnNpb24oKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubmVnb3RpYXRlZFByb3RvY29sVmVyc2lvbjtcbiAgICB9XG5cbiAgICAvKiogQ2FuY2VsIGV2ZXJ5IGlu4oCRZmxpZ2h0IHRvb2wgY2FsbC4gVXNlZCBvbiB0cmFuc3BvcnQgc2h1dGRvd24uICovXG4gICAgcHVibGljIGNhbmNlbEFsbChyZWFzb24gPSAndHJhbnNwb3J0IGNsb3NlZCcpOiB2b2lkIHtcbiAgICAgICAgZm9yIChjb25zdCBbLCBjdHJsXSBvZiB0aGlzLmluRmxpZ2h0KSB7XG4gICAgICAgICAgICB0cnkgeyBjdHJsLmFib3J0KG5ldyBFcnJvcihyZWFzb24pKTsgfSBjYXRjaCB7IC8qIG5vb3AgKi8gfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuaW5GbGlnaHQuY2xlYXIoKTtcbiAgICAgICAgZm9yIChjb25zdCBbLCBwXSBvZiB0aGlzLnBlbmRpbmdSZXF1ZXN0cykge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHAudGltZXIpO1xuICAgICAgICAgICAgdHJ5IHsgcC5yZWplY3QobmV3IEVycm9yKHJlYXNvbikpOyB9IGNhdGNoIHsgLyogbm9vcCAqLyB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuY2xlYXIoKTtcbiAgICB9XG5cbiAgICAvKiogRW50cnkgcG9pbnQgZm9yIHRoZSB0cmFuc3BvcnQuIFJldHVybnMgdGhlIHJlc3BvbnNlIChvciBudWxsIGZvciBub3RpZmljYXRpb25zKS4gKi9cbiAgICBwdWJsaWMgYXN5bmMgaGFuZGxlKHJhdzogc3RyaW5nIHwgb2JqZWN0KTogUHJvbWlzZTxKc29uUnBjUmVzcG9uc2UgfCBKc29uUnBjUmVzcG9uc2VbXSB8IG51bGw+IHtcbiAgICAgICAgbGV0IG1lc3NhZ2U6IGFueTtcbiAgICAgICAgaWYgKHR5cGVvZiByYXcgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSByYXcubGVuZ3RoID09PSAwID8gbnVsbCA6IEpTT04ucGFyc2UocmF3KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19QQVJTRV9FUlJPUiwgYFBhcnNlIGVycm9yOiAke2U/Lm1lc3NhZ2UgPz8gJ2ludmFsaWQgSlNPTid9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBtZXNzYWdlID0gcmF3O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobWVzc2FnZSkpIHtcbiAgICAgICAgICAgIGlmIChtZXNzYWdlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19JTlZBTElEX1JFUVVFU1QsICdJbnZhbGlkIFJlcXVlc3Q6IGVtcHR5IGJhdGNoJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBvdXQ6IEpzb25ScGNSZXNwb25zZVtdID0gW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbWVzc2FnZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmhhbmRsZVNpbmdsZShpdGVtKTtcbiAgICAgICAgICAgICAgICBpZiAocikgb3V0LnB1c2gocik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gb3V0Lmxlbmd0aCA/IG91dCA6IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVTaW5nbGUobWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTaW5nbGUobWVzc2FnZTogYW55KTogUHJvbWlzZTxKc29uUnBjUmVzcG9uc2UgfCBudWxsPiB7XG4gICAgICAgIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShtZXNzYWdlKSkge1xuICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihudWxsLCBKU09OUlBDX0lOVkFMSURfUkVRVUVTVCwgJ0ludmFsaWQgUmVxdWVzdCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtZXNzYWdlLmpzb25ycGMgIT09IEpTT05SUENfVkVSU0lPTikge1xuICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihtZXNzYWdlLmlkID8/IG51bGwsIEpTT05SUENfSU5WQUxJRF9SRVFVRVNULCAnSW52YWxpZCBSZXF1ZXN0OiBqc29ucnBjIG11c3QgYmUgXCIyLjBcIicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGhhc2UgMjogcm91dGUgaW5jb21pbmcgcmVzcG9uc2VzIHRvIG91dGdvaW5nIHNlcnZlcuKGkmNsaWVudCByZXF1ZXN0c1xuICAgICAgICAvLyAoZS5nLiBgc2FtcGxpbmcvY3JlYXRlTWVzc2FnZWApLiBSZXNwb25zZXMgaGF2ZSBubyBgbWV0aG9kYCBhbmQgYW5cbiAgICAgICAgLy8gYGlkYCB0aGF0IG1hdGNoZXMgYSBwZW5kaW5nIGVudHJ5LlxuICAgICAgICBpZiAobWVzc2FnZS5tZXRob2QgPT09IHVuZGVmaW5lZCAmJiAobWVzc2FnZS5yZXN1bHQgIT09IHVuZGVmaW5lZCB8fCBtZXNzYWdlLmVycm9yICE9PSB1bmRlZmluZWQpKSB7XG4gICAgICAgICAgICBjb25zdCBwZW5kaW5nID0gdGhpcy5wZW5kaW5nUmVxdWVzdHMuZ2V0KG1lc3NhZ2UuaWQpO1xuICAgICAgICAgICAgaWYgKHBlbmRpbmcpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQocGVuZGluZy50aW1lcik7XG4gICAgICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKG1lc3NhZ2UuaWQpO1xuICAgICAgICAgICAgICAgIGlmIChtZXNzYWdlLmVycm9yKSBwZW5kaW5nLnJlamVjdChuZXcgSnNvblJwY0Vycm9yKG1lc3NhZ2UuZXJyb3IuY29kZSA/PyBKU09OUlBDX0lOVEVSTkFMX0VSUk9SLCBtZXNzYWdlLmVycm9yLm1lc3NhZ2UgPz8gJ2NsaWVudCBlcnJvcicsIG1lc3NhZ2UuZXJyb3IuZGF0YSkpO1xuICAgICAgICAgICAgICAgIGVsc2UgcGVuZGluZy5yZXNvbHZlKG1lc3NhZ2UucmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBpZCwgbWV0aG9kLCBwYXJhbXMgfSA9IG1lc3NhZ2U7XG4gICAgICAgIGNvbnN0IGlzTm90aWYgPSBpZCA9PT0gdW5kZWZpbmVkIHx8IGlkID09PSBudWxsO1xuICAgICAgICBpZiAodHlwZW9mIG1ldGhvZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBpc05vdGlmID8gbnVsbCA6IG1ha2VFcnJvcihpZCwgSlNPTlJQQ19JTlZBTElEX1JFUVVFU1QsICdJbnZhbGlkIFJlcXVlc3Q6IG1pc3NpbmcgbWV0aG9kJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gTm90aWZpY2F0aW9ucyBmaXJzdC5cbiAgICAgICAgICAgIHN3aXRjaCAobWV0aG9kKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAnbm90aWZpY2F0aW9ucy9pbml0aWFsaXplZCc6XG4gICAgICAgICAgICAgICAgY2FzZSAnaW5pdGlhbGl6ZWQnOlxuICAgICAgICAgICAgICAgIGNhc2UgJ25vdGlmaWNhdGlvbnMvcm9vdHMvbGlzdF9jaGFuZ2VkJzpcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgY2FzZSAnbm90aWZpY2F0aW9ucy9jYW5jZWxsZWQnOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldElkID0gcGFyYW1zPy5yZXF1ZXN0SWQ7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRJZCAhPT0gdW5kZWZpbmVkKSB0aGlzLmNhbmNlbFJlcXVlc3QodGFyZ2V0SWQsIHBhcmFtcz8ucmVhc29uID8/ICdjYW5jZWxsZWQgYnkgY2xpZW50Jyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHJlc3VsdDogYW55O1xuICAgICAgICAgICAgc3dpdGNoIChtZXRob2QpIHtcbiAgICAgICAgICAgICAgICBjYXNlICdpbml0aWFsaXplJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gdGhpcy5oYW5kbGVJbml0aWFsaXplKHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3BpbmcnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnbG9nZ2luZy9zZXRMZXZlbCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHRoaXMuaGFuZGxlTG9nZ2luZ1NldExldmVsKHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Rvb2xzL2xpc3QnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB0aGlzLmhhbmRsZVRvb2xzTGlzdChwYXJhbXMpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd0b29scy9jYWxsJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVUb29sc0NhbGwoaWQsIHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy9saXN0JzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVSZXNvdXJjZXNMaXN0KHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy90ZW1wbGF0ZXMvbGlzdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlUmVzb3VyY2VUZW1wbGF0ZXNMaXN0KCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy9yZWFkJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVSZXNvdXJjZXNSZWFkKHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Jlc291cmNlcy9zdWJzY3JpYmUnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZVJlc291cmNlc1N1YnNjcmliZShwYXJhbXMpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdyZXNvdXJjZXMvdW5zdWJzY3JpYmUnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB0aGlzLmhhbmRsZVJlc291cmNlc1Vuc3Vic2NyaWJlKHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Byb21wdHMvbGlzdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlUHJvbXB0c0xpc3QoKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAncHJvbXB0cy9nZXQnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZVByb21wdHNHZXQocGFyYW1zKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnY29tcGxldGlvbi9jb21wbGV0ZSc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlQ29tcGxldGlvbkNvbXBsZXRlKHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCBgTWV0aG9kIG5vdCBmb3VuZDogJHttZXRob2R9YCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChpc05vdGlmKSByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIHJldHVybiBtYWtlUmVzdWx0KGlkLCByZXN1bHQpO1xuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgaWYgKGlzTm90aWYpIHJldHVybiBudWxsO1xuICAgICAgICAgICAgY29uc3QgY29kZSA9IGVyciBpbnN0YW5jZW9mIEpzb25ScGNFcnJvciA/IGVyci5jb2RlIDogSlNPTlJQQ19JTlRFUk5BTF9FUlJPUjtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBlcnIgaW5zdGFuY2VvZiBKc29uUnBjRXJyb3IgPyBlcnIuZGF0YSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiBtYWtlRXJyb3IoaWQsIGNvZGUsIGVycj8ubWVzc2FnZSA/PyBTdHJpbmcoZXJyKSwgZGF0YSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLSBoYW5kbGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgcHJpdmF0ZSBoYW5kbGVJbml0aWFsaXplKHBhcmFtczogYW55KTogYW55IHtcbiAgICAgICAgY29uc3QgcmVxdWVzdGVkID0gcGFyYW1zPy5wcm90b2NvbFZlcnNpb247XG4gICAgICAgIGNvbnN0IG5lZ290aWF0ZWQgPSBTVVBQT1JURURfUFJPVE9DT0xfVkVSU0lPTlMuaW5jbHVkZXMocmVxdWVzdGVkKVxuICAgICAgICAgICAgPyByZXF1ZXN0ZWRcbiAgICAgICAgICAgIDogREVGQVVMVF9QUk9UT0NPTF9WRVJTSU9OO1xuICAgICAgICB0aGlzLm5lZ290aWF0ZWRQcm90b2NvbFZlcnNpb24gPSBuZWdvdGlhdGVkO1xuICAgICAgICB0aGlzLmNsaWVudENhcGFiaWxpdGllcyA9IChwYXJhbXM/LmNhcGFiaWxpdGllcyAmJiB0eXBlb2YgcGFyYW1zLmNhcGFiaWxpdGllcyA9PT0gJ29iamVjdCcpID8gcGFyYW1zLmNhcGFiaWxpdGllcyA6IHt9O1xuICAgICAgICBjb25zdCBjYXBhYmlsaXRpZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgICAgICB0b29sczogeyBsaXN0Q2hhbmdlZDogdHJ1ZSB9LFxuICAgICAgICAgICAgbG9nZ2luZzoge30sXG4gICAgICAgICAgICAuLi50aGlzLmV4dHJhQ2FwYWJpbGl0aWVzXG4gICAgICAgIH07XG4gICAgICAgIGlmICh0aGlzLnJlc291cmNlcykge1xuICAgICAgICAgICAgY2FwYWJpbGl0aWVzLnJlc291cmNlcyA9IHsgbGlzdENoYW5nZWQ6IHRydWUsIHN1YnNjcmliZTogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLnByb21wdHMpIHtcbiAgICAgICAgICAgIGNhcGFiaWxpdGllcy5wcm9tcHRzID0geyBsaXN0Q2hhbmdlZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIFNlcnZlci1pbml0aWF0ZWQgc2FtcGxpbmcgcm91bmQtdHJpcCBpcyBzdXBwb3J0ZWQgd2hlbiB0aGUgY2xpZW50XG4gICAgICAgIC8vIGFkdmVydGlzZXMgdGhlIG1hdGNoaW5nIGNhcGFiaWxpdHkg4oCUIHdlIHN0aWxsIGFubm91bmNlIGl0IHNvIG9sZGVyXG4gICAgICAgIC8vIGNsaWVudHMgdGhhdCBwcm9iZSBjYXBhYmlsaXRpZXMga25vdyB0aGUgc2VydmVyIGlzIHdpbGxpbmcuXG4gICAgICAgIGNhcGFiaWxpdGllcy5zYW1wbGluZyA9IGNhcGFiaWxpdGllcy5zYW1wbGluZyB8fCB7fTtcbiAgICAgICAgY2FwYWJpbGl0aWVzLmNvbXBsZXRpb25zID0gY2FwYWJpbGl0aWVzLmNvbXBsZXRpb25zIHx8IHt9O1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHJvdG9jb2xWZXJzaW9uOiBuZWdvdGlhdGVkLFxuICAgICAgICAgICAgY2FwYWJpbGl0aWVzLFxuICAgICAgICAgICAgc2VydmVySW5mbzoge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdjb2Nvcy1tY3Atc2VydmVyJyxcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiAnMS40LjAnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaW5zdHJ1Y3Rpb25zOlxuICAgICAgICAgICAgICAgICdDb2NvcyBDcmVhdG9yIE1DUCBzZXJ2ZXIuIENhbGwgdG9vbHMvbGlzdCAoc3VwcG9ydHMgYGN1cnNvcmAgcGFnaW5hdGlvbikgJyArXG4gICAgICAgICAgICAgICAgJ3RvIGRpc2NvdmVyIGNhcGFiaWxpdGllcy4gTG9uZ+KAkXJ1bm5pbmcgY2FsbHMgY2FuIGJlIGFib3J0ZWQgd2l0aCAnICtcbiAgICAgICAgICAgICAgICAnbm90aWZpY2F0aW9ucy9jYW5jZWxsZWQuIFVzZSBsb2dnaW5nL3NldExldmVsIHRvIGNvbnRyb2wgbG9nIHZlcmJvc2l0eS4gJyArXG4gICAgICAgICAgICAgICAgJ1Jlc291cmNlcyAocHJvamVjdDovL2luZm8sIHNjZW5lOi8vY3VycmVudCwgYXNzZXRzOi8vdHJlZSwgcnVudGltZTovL2xvZ3MpICcgK1xuICAgICAgICAgICAgICAgICdhbmQgcHJvbXB0cyBhcmUgYWxzbyBhdmFpbGFibGUuJ1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKiBUcnVlIHdoZW4gdGhlIGNsaWVudCBhZHZlcnRpc2VkIHRoZSBuYW1lZCB0b3AtbGV2ZWwgY2FwYWJpbGl0eS4gKi9cbiAgICBwdWJsaWMgY2xpZW50U3VwcG9ydHMobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiAhIXRoaXMuY2xpZW50Q2FwYWJpbGl0aWVzW25hbWVdO1xuICAgIH1cblxuICAgIHByaXZhdGUgaGFuZGxlTG9nZ2luZ1NldExldmVsKHBhcmFtczogYW55KTogYW55IHtcbiAgICAgICAgY29uc3QgbGV2ZWwgPSBwYXJhbXM/LmxldmVsO1xuICAgICAgICBpZiAoIWxldmVsIHx8ICFMT0dfTEVWRUxfT1JERVIuaW5jbHVkZXMobGV2ZWwpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfSU5WQUxJRF9QQVJBTVMsIGBJbnZhbGlkIGxvZyBsZXZlbDogJHtsZXZlbH1gKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZ0xldmVsID0gbGV2ZWw7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGhhbmRsZVRvb2xzTGlzdChwYXJhbXM6IGFueSk6IGFueSB7XG4gICAgICAgIGNvbnN0IGFsbCA9IHRoaXMucmVnaXN0cnkubGlzdFRvb2xzKCkubWFwKCh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBoaW50cyA9IHJlc29sdmVUb29sSGludHModC5uYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGRlZjogYW55ID0ge1xuICAgICAgICAgICAgICAgIG5hbWU6IHQubmFtZSxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogdC5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogdC5pbnB1dFNjaGVtYVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmICh0Lm91dHB1dFNjaGVtYSB8fCBoaW50cy5vdXRwdXRTY2hlbWEpIGRlZi5vdXRwdXRTY2hlbWEgPSB0Lm91dHB1dFNjaGVtYSA/PyBoaW50cy5vdXRwdXRTY2hlbWE7XG4gICAgICAgICAgICBpZiAodC5hbm5vdGF0aW9ucyB8fCBoaW50cy5hbm5vdGF0aW9ucykgZGVmLmFubm90YXRpb25zID0geyAuLi5oaW50cy5hbm5vdGF0aW9ucywgLi4uKHQuYW5ub3RhdGlvbnMgfHwge30pIH07XG4gICAgICAgICAgICByZXR1cm4gZGVmO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBHNDogY3Vyc29yIHBhZ2luYXRpb24uIFRoZSBjdXJzb3IgaXMgdGhlIG9wYXF1ZSBuZXh04oCRaW5kZXguXG4gICAgICAgIGNvbnN0IGN1cnNvciA9IHBhcmFtcz8uY3Vyc29yO1xuICAgICAgICBsZXQgc3RhcnQgPSAwO1xuICAgICAgICBpZiAoY3Vyc29yICE9PSB1bmRlZmluZWQgJiYgY3Vyc29yICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBOdW1iZXIucGFyc2VJbnQoU3RyaW5nKGN1cnNvciksIDEwKTtcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlkeCkgfHwgaWR4IDwgMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgYEludmFsaWQgY3Vyc29yOiAke2N1cnNvcn1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXJ0ID0gaWR4O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWluKGFsbC5sZW5ndGgsIHN0YXJ0ICsgdGhpcy5wYWdlU2l6ZSk7XG4gICAgICAgIGNvbnN0IHRvb2xzID0gYWxsLnNsaWNlKHN0YXJ0LCBlbmQpO1xuICAgICAgICBjb25zdCBvdXQ6IGFueSA9IHsgdG9vbHMgfTtcbiAgICAgICAgaWYgKGVuZCA8IGFsbC5sZW5ndGgpIG91dC5uZXh0Q3Vyc29yID0gU3RyaW5nKGVuZCk7XG4gICAgICAgIHJldHVybiBvdXQ7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVUb29sc0NhbGwoaWQ6IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgaWYgKCFwYXJhbXMgfHwgdHlwZW9mIHBhcmFtcy5uYW1lICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCAnSW52YWxpZCBwYXJhbXM6IFwibmFtZVwiIGlzIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgeyBuYW1lLCBhcmd1bWVudHM6IGFyZ3MgfSA9IHBhcmFtcztcbiAgICAgICAgY29uc3QgcHJvZ3Jlc3NUb2tlbiA9IHBhcmFtcz8uX21ldGE/LnByb2dyZXNzVG9rZW47XG5cbiAgICAgICAgLy8gRzg6IEFqdiBpbnB1dCB2YWxpZGF0aW9uLiBMb29rIHVwIHRoZSB0b29sJ3MgaW5wdXRTY2hlbWEgYW5kIHZhbGlkYXRlLlxuICAgICAgICBjb25zdCBkZWYgPSB0aGlzLnJlZ2lzdHJ5Lmxpc3RUb29scygpLmZpbmQoKHQpID0+IHQubmFtZSA9PT0gbmFtZSk7XG4gICAgICAgIGlmICghZGVmKSB7XG4gICAgICAgICAgICAvLyBQZXIgTUNQIHNwZWMgd2Ugc3RpbGwgcmV0dXJuIGEgcmVzdWx0IHdpdGggaXNFcnJvcj10cnVlIHNvIHRoZSBMTE0gY2FuIHJlYWN0LlxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBjb250ZW50OiBbeyB0eXBlOiAndGV4dCcsIHRleHQ6IGBUb29sIG5vdCBmb3VuZDogJHtuYW1lfWAgfV0sXG4gICAgICAgICAgICAgICAgaXNFcnJvcjogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVmLmlucHV0U2NoZW1hKSB7XG4gICAgICAgICAgICBjb25zdCB2YWxpZGF0b3IgPSB0aGlzLmdldFZhbGlkYXRvcihuYW1lLCBkZWYuaW5wdXRTY2hlbWEpO1xuICAgICAgICAgICAgY29uc3Qgb2sgPSB2YWxpZGF0b3IoYXJncyA/PyB7fSk7XG4gICAgICAgICAgICBpZiAoIW9rKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuYWp2LmVycm9yc1RleHQodmFsaWRhdG9yLmVycm9ycywgeyBzZXBhcmF0b3I6ICc7ICcgfSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCBgSW52YWxpZCBhcmd1bWVudHMgZm9yICR7bmFtZX06ICR7bWVzc2FnZX1gLCB7XG4gICAgICAgICAgICAgICAgICAgIHRvb2w6IG5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVycm9yczogdmFsaWRhdG9yLmVycm9yc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQTg6IEFib3J0U2lnbmFsIHdpcmluZy5cbiAgICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICAgICAgY29uc3QgdHJhY2tJZDogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCA9IGlkO1xuICAgICAgICBpZiAodHJhY2tJZCAhPT0gdW5kZWZpbmVkICYmIHRyYWNrSWQgIT09IG51bGwpIHRoaXMuaW5GbGlnaHQuc2V0KHRyYWNrSWQsIGNvbnRyb2xsZXIpO1xuXG4gICAgICAgIGNvbnN0IGN0eDogVG9vbEV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICAgICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgICAgICAgcHJvZ3Jlc3NUb2tlbixcbiAgICAgICAgICAgIHJlcG9ydFByb2dyZXNzOiAocHJvZ3Jlc3MsIHRvdGFsLCBtZXNzYWdlKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHByb2dyZXNzVG9rZW4gPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL3Byb2dyZXNzJywge1xuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzc1Rva2VuLFxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzcyxcbiAgICAgICAgICAgICAgICAgICAgdG90YWwsXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsb2c6IChsZXZlbCwgZGF0YSwgbG9nZ2VyKSA9PiB0aGlzLmVtaXRMb2cobGV2ZWwsIGRhdGEsIGxvZ2dlcilcbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgdG9vbFJlc3VsdCA9IGF3YWl0IHRoaXMucmVnaXN0cnkuZXhlY3V0ZVRvb2xDYWxsKG5hbWUsIGFyZ3MgPz8ge30sIGN0eCk7XG4gICAgICAgICAgICBjb25zdCBpc0Vycm9yID0gISEodG9vbFJlc3VsdCAmJiB0eXBlb2YgdG9vbFJlc3VsdCA9PT0gJ29iamVjdCcgJiYgdG9vbFJlc3VsdC5zdWNjZXNzID09PSBmYWxzZSk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQ6IGFueSA9IHtcbiAgICAgICAgICAgICAgICBjb250ZW50OiBbeyB0eXBlOiAndGV4dCcsIHRleHQ6IEpTT04uc3RyaW5naWZ5KHRvb2xSZXN1bHQpIH1dLFxuICAgICAgICAgICAgICAgIGlzRXJyb3JcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvLyBNQ1AgMjAyNeKAkTA24oCRMTg6IHdoZW4gdGhlIHRvb2wgZGVjbGFyZXMgYW4gb3V0cHV0U2NoZW1hLCBpbmNsdWRlIGBzdHJ1Y3R1cmVkQ29udGVudGAuXG4gICAgICAgICAgICBpZiAoZGVmLm91dHB1dFNjaGVtYSB8fCByZXNvbHZlVG9vbEhpbnRzKG5hbWUpLm91dHB1dFNjaGVtYSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5zdHJ1Y3R1cmVkQ29udGVudCA9IHRvb2xSZXN1bHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgaWYgKGNvbnRyb2xsZXIuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgICAgICAgICAvLyBSZeKAkXRocm93IGFzIEpTT07igJFSUEMgY2FuY2VsbGF0aW9uIGVycm9yIGZvciBjbGllbnRzIHRoYXQgd2FudCBpdC5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKE1DUF9SRVFVRVNUX0NBTkNFTExFRCwgZXJyPy5tZXNzYWdlID8/ICdSZXF1ZXN0IGNhbmNlbGxlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBjb250ZW50OiBbeyB0eXBlOiAndGV4dCcsIHRleHQ6IGVycj8ubWVzc2FnZSA/PyBTdHJpbmcoZXJyKSB9XSxcbiAgICAgICAgICAgICAgICBpc0Vycm9yOiB0cnVlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgaWYgKHRyYWNrSWQgIT09IHVuZGVmaW5lZCAmJiB0cmFja0lkICE9PSBudWxsKSB0aGlzLmluRmxpZ2h0LmRlbGV0ZSh0cmFja0lkKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0VmFsaWRhdG9yKG5hbWU6IHN0cmluZywgc2NoZW1hOiBhbnkpOiBWYWxpZGF0ZUZ1bmN0aW9uIHtcbiAgICAgICAgbGV0IHYgPSB0aGlzLnZhbGlkYXRvcnMuZ2V0KG5hbWUpO1xuICAgICAgICBpZiAoIXYpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdiA9IHRoaXMuYWp2LmNvbXBpbGUoc2NoZW1hKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgICAgIC8vIFNjaGVtYSBidWcgc2hvdWxkbid0IGtpbGwgdGhlIGNhbGwg4oCUIGZhbGwgYmFjayB0byBhIHBlcm1pc3NpdmUgdmFsaWRhdG9yLlxuICAgICAgICAgICAgICAgIHYgPSAoKCkgPT4gdHJ1ZSkgYXMgdW5rbm93biBhcyBWYWxpZGF0ZUZ1bmN0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy52YWxpZGF0b3JzLnNldChuYW1lLCB2KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdjtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNhbmNlbFJlcXVlc3QocmVxdWVzdElkOiBzdHJpbmcgfCBudW1iZXIsIHJlYXNvbjogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGN0cmwgPSB0aGlzLmluRmxpZ2h0LmdldChyZXF1ZXN0SWQpO1xuICAgICAgICBpZiAoY3RybCkge1xuICAgICAgICAgICAgdHJ5IHsgY3RybC5hYm9ydChuZXcgRXJyb3IocmVhc29uKSk7IH0gY2F0Y2ggeyAvKiBub29wICovIH1cbiAgICAgICAgICAgIHRoaXMuaW5GbGlnaHQuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGVtaXRMb2cobGV2ZWw6IE1jcExvZ0xldmVsLCBkYXRhOiBhbnksIGxvZ2dlcj86IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBpZiAoIWxldmVsQXRMZWFzdChsZXZlbCwgdGhpcy5sb2dMZXZlbCkpIHJldHVybjtcbiAgICAgICAgdGhpcy5ub3RpZnkoJ25vdGlmaWNhdGlvbnMvbWVzc2FnZScsIHsgbGV2ZWwsIGxvZ2dlciwgZGF0YSB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIG5vdGlmeShtZXRob2Q6IHN0cmluZywgcGFyYW1zPzogYW55KTogdm9pZCB7XG4gICAgICAgIGlmICghdGhpcy5ub3RpZnlTaW5rKSByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLm5vdGlmeVNpbmsoeyBqc29ucnBjOiBKU09OUlBDX1ZFUlNJT04sIG1ldGhvZCwgcGFyYW1zIH0pO1xuICAgICAgICB9IGNhdGNoIHsgLyogc2luayBlcnJvcnMgbXVzdCBub3QgYnJlYWsgdG9vbCBleGVjdXRpb24gKi8gfVxuICAgIH1cblxuICAgIC8qKiBJbnZhbGlkYXRlIGNhY2hlZCB2YWxpZGF0b3JzIHdoZW4gdGhlIGVuYWJsZWQgdG9vbCBzZXQgY2hhbmdlcy4gKi9cbiAgICBwdWJsaWMgY2xlYXJWYWxpZGF0b3JDYWNoZSgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy52YWxpZGF0b3JzLmNsZWFyKCk7XG4gICAgfVxuXG4gICAgLyoqIFBoYXNlIDEgZm9sbG93LXVwOiBlbWl0IGBub3RpZmljYXRpb25zL3Rvb2xzL2xpc3RfY2hhbmdlZGAuICovXG4gICAgcHVibGljIGVtaXRUb29sc0xpc3RDaGFuZ2VkKCk6IHZvaWQge1xuICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy90b29scy9saXN0X2NoYW5nZWQnKTtcbiAgICB9XG5cbiAgICAvKiogR2VuZXJpYyBoZWxwZXIgdXNlZCBieSByZWdpc3RyaWVzIHRvIGVtaXQgYW55IG5vdGlmaWNhdGlvbiB0byB0aGUgY2xpZW50LiAqL1xuICAgIHB1YmxpYyBlbWl0Tm90aWZpY2F0aW9uKG1ldGhvZDogc3RyaW5nLCBwYXJhbXM/OiBhbnkpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5ub3RpZnkobWV0aG9kLCBwYXJhbXMpO1xuICAgIH1cblxuICAgIC8vIC0tIFBoYXNlIDIgaGFuZGxlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlc291cmNlc0xpc3QocGFyYW1zOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICBpZiAoIXRoaXMucmVzb3VyY2VzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfTUVUSE9EX05PVF9GT1VORCwgJ3Jlc291cmNlcyBjYXBhYmlsaXR5IG5vdCBlbmFibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYWxsID0gYXdhaXQgdGhpcy5yZXNvdXJjZXMubGlzdFJlc291cmNlcygpO1xuICAgICAgICAvLyBSZXVzZSB0aGUgc2FtZSBvcGFxdWUgY3Vyc29yIHNjaGVtZSBhcyB0b29scy9saXN0IChHNCkuXG4gICAgICAgIGNvbnN0IGN1cnNvciA9IHBhcmFtcz8uY3Vyc29yO1xuICAgICAgICBsZXQgc3RhcnQgPSAwO1xuICAgICAgICBpZiAoY3Vyc29yICE9PSB1bmRlZmluZWQgJiYgY3Vyc29yICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBOdW1iZXIucGFyc2VJbnQoU3RyaW5nKGN1cnNvciksIDEwKTtcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlkeCkgfHwgaWR4IDwgMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgYEludmFsaWQgY3Vyc29yOiAke2N1cnNvcn1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXJ0ID0gaWR4O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWluKGFsbC5sZW5ndGgsIHN0YXJ0ICsgdGhpcy5wYWdlU2l6ZSk7XG4gICAgICAgIGNvbnN0IG91dDogYW55ID0geyByZXNvdXJjZXM6IGFsbC5zbGljZShzdGFydCwgZW5kKSB9O1xuICAgICAgICBpZiAoZW5kIDwgYWxsLmxlbmd0aCkgb3V0Lm5leHRDdXJzb3IgPSBTdHJpbmcoZW5kKTtcbiAgICAgICAgcmV0dXJuIG91dDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlc291cmNlVGVtcGxhdGVzTGlzdCgpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICBpZiAoIXRoaXMucmVzb3VyY2VzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfTUVUSE9EX05PVF9GT1VORCwgJ3Jlc291cmNlcyBjYXBhYmlsaXR5IG5vdCBlbmFibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgcmVzb3VyY2VUZW1wbGF0ZXM6IGF3YWl0IHRoaXMucmVzb3VyY2VzLmxpc3RSZXNvdXJjZVRlbXBsYXRlcygpIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXNvdXJjZXNSZWFkKHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgaWYgKCF0aGlzLnJlc291cmNlcykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsICdyZXNvdXJjZXMgY2FwYWJpbGl0eSBub3QgZW5hYmxlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcGFyYW1zIHx8IHR5cGVvZiBwYXJhbXMudXJpICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCAnSW52YWxpZCBwYXJhbXM6IFwidXJpXCIgaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZXNvdXJjZXMucmVhZFJlc291cmNlKHBhcmFtcy51cmkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVzb3VyY2VzU3Vic2NyaWJlKHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgaWYgKCF0aGlzLnJlc291cmNlcykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsICdyZXNvdXJjZXMgY2FwYWJpbGl0eSBub3QgZW5hYmxlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcGFyYW1zIHx8IHR5cGVvZiBwYXJhbXMudXJpICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCAnSW52YWxpZCBwYXJhbXM6IFwidXJpXCIgaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLnJlc291cmNlcy5zdWJzY3JpYmUocGFyYW1zLnVyaSk7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGhhbmRsZVJlc291cmNlc1Vuc3Vic2NyaWJlKHBhcmFtczogYW55KTogYW55IHtcbiAgICAgICAgaWYgKCF0aGlzLnJlc291cmNlcykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsICdyZXNvdXJjZXMgY2FwYWJpbGl0eSBub3QgZW5hYmxlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcGFyYW1zIHx8IHR5cGVvZiBwYXJhbXMudXJpICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCAnSW52YWxpZCBwYXJhbXM6IFwidXJpXCIgaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlc291cmNlcy51bnN1YnNjcmliZShwYXJhbXMudXJpKTtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlUHJvbXB0c0xpc3QoKTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgaWYgKCF0aGlzLnByb21wdHMpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19NRVRIT0RfTk9UX0ZPVU5ELCAncHJvbXB0cyBjYXBhYmlsaXR5IG5vdCBlbmFibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgcHJvbXB0czogYXdhaXQgdGhpcy5wcm9tcHRzLmxpc3RQcm9tcHRzKCkgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVByb21wdHNHZXQocGFyYW1zOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICBpZiAoIXRoaXMucHJvbXB0cykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsICdwcm9tcHRzIGNhcGFiaWxpdHkgbm90IGVuYWJsZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXBhcmFtcyB8fCB0eXBlb2YgcGFyYW1zLm5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfSU5WQUxJRF9QQVJBTVMsICdJbnZhbGlkIHBhcmFtczogXCJuYW1lXCIgaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhcmdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgICAgIGlmIChwYXJhbXMuYXJndW1lbnRzICYmIHR5cGVvZiBwYXJhbXMuYXJndW1lbnRzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocGFyYW1zLmFyZ3VtZW50cykpIHtcbiAgICAgICAgICAgICAgICBhcmdzW2tdID0gdHlwZW9mIHYgPT09ICdzdHJpbmcnID8gdiA6IFN0cmluZyh2KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5wcm9tcHRzLmdldFByb21wdChwYXJhbXMubmFtZSwgYXJncyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDb21wbGV0aW9uQ29tcGxldGUocGFyYW1zOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICBpZiAoIXBhcmFtcyB8fCAhcGFyYW1zLnJlZiB8fCB0eXBlb2YgcGFyYW1zLnJlZiAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcInJlZlwiIGlzIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXJnTmFtZSA9IHBhcmFtcz8uYXJndW1lbnQ/Lm5hbWU7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gcGFyYW1zPy5hcmd1bWVudD8udmFsdWUgPz8gJyc7XG4gICAgICAgIGlmICh0eXBlb2YgYXJnTmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcImFyZ3VtZW50Lm5hbWVcIiBpcyByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGxldCB2YWx1ZXM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGlmIChwYXJhbXMucmVmLnR5cGUgPT09ICdyZWYvcHJvbXB0JyAmJiB0aGlzLnByb21wdHMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IGF3YWl0IHRoaXMucHJvbXB0cy5jb21wbGV0ZShwYXJhbXMucmVmLm5hbWUsIGFyZ05hbWUsIHZhbHVlKTtcbiAgICAgICAgfSBlbHNlIGlmIChwYXJhbXMucmVmLnR5cGUgPT09ICdyZWYvcmVzb3VyY2UnICYmIHRoaXMucmVzb3VyY2VzKSB7XG4gICAgICAgICAgICB2YWx1ZXMgPSBhd2FpdCB0aGlzLnJlc291cmNlcy5jb21wbGV0ZShwYXJhbXMucmVmLnVyaSwgYXJnTmFtZSwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZpbHRlciBieSBjdXJyZW50IHZhbHVlIHByZWZpeCB3aGVuIHRoZSBwcm92aWRlciBkaWRuJ3QgYWxyZWFkeS5cbiAgICAgICAgY29uc3QgZmlsdGVyZWQgPSB2YWx1ZVxuICAgICAgICAgICAgPyB2YWx1ZXMuZmlsdGVyKCh2KSA9PiB2LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoU3RyaW5nKHZhbHVlKS50b0xvd2VyQ2FzZSgpKSlcbiAgICAgICAgICAgIDogdmFsdWVzO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tcGxldGlvbjoge1xuICAgICAgICAgICAgICAgIHZhbHVlczogZmlsdGVyZWQuc2xpY2UoMCwgMTAwKSxcbiAgICAgICAgICAgICAgICB0b3RhbDogZmlsdGVyZWQubGVuZ3RoLFxuICAgICAgICAgICAgICAgIGhhc01vcmU6IGZpbHRlcmVkLmxlbmd0aCA+IDEwMFxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBoYXNlIDI6IGFzayB0aGUgY29ubmVjdGVkIGNsaWVudCB0byBwZXJmb3JtIExMTSBzYW1wbGluZy4gUmVzb2x2ZXMgd2l0aFxuICAgICAqIHRoZSBjbGllbnQncyByZXNwb25zZSBvciByZWplY3RzIG9uIHRpbWVvdXQgLyBjbGllbnQgZXJyb3IuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHJlcXVlc3RTYW1wbGluZyhyZXE6IE1jcFNhbXBsaW5nUmVxdWVzdCk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnNlbmRDbGllbnRSZXF1ZXN0KCdzYW1wbGluZy9jcmVhdGVNZXNzYWdlJywgcmVxKTtcbiAgICB9XG5cbiAgICAvKiogU2VuZCBhbnkgc2VydmVy4oaSY2xpZW50IEpTT04tUlBDIHJlcXVlc3QgYW5kIGF3YWl0IHRoZSByZXNwb25zZS4gKi9cbiAgICBwdWJsaWMgc2VuZENsaWVudFJlcXVlc3QobWV0aG9kOiBzdHJpbmcsIHBhcmFtczogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgaWYgKCF0aGlzLm5vdGlmeVNpbmspIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3IoJ05vIGFjdGl2ZSBjbGllbnQgY2hhbm5lbCBmb3Igc2VydmVy4oaSY2xpZW50IHJlcXVlc3QnKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gdGhpcy5uZXh0T3V0Z29pbmdJZCsrO1xuICAgICAgICAgICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUoaWQpO1xuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYENsaWVudCByZXF1ZXN0IFwiJHttZXRob2R9XCIgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5zYW1wbGluZ1RpbWVvdXRNc31tc2ApKTtcbiAgICAgICAgICAgIH0sIHRoaXMuc2FtcGxpbmdUaW1lb3V0TXMpO1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KGlkLCB7IHJlc29sdmUsIHJlamVjdCwgdGltZXIgfSk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5U2luayEoeyBqc29ucnBjOiBKU09OUlBDX1ZFUlNJT04sIGlkLCBtZXRob2QsIHBhcmFtcyB9IGFzIGFueSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUoaWQpO1xuICAgICAgICAgICAgICAgIHJlamVjdChlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxufVxuIl19