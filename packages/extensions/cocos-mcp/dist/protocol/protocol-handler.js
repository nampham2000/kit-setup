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
        var _a, _b;
        this.notifySink = null;
        this.inFlight = new Map();
        this.validators = new Map();
        this.negotiatedProtocolVersion = exports.DEFAULT_PROTOCOL_VERSION;
        this.registry = opts.registry;
        this.pageSize = Math.max(1, (_a = opts.pageSize) !== null && _a !== void 0 ? _a : 100);
        this.logLevel = (_b = opts.initialLogLevel) !== null && _b !== void 0 ? _b : 'info';
        this.extraCapabilities = opts.extraCapabilities || {};
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
        var _a, _b, _c;
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return (0, jsonrpc_1.makeError)(null, jsonrpc_1.JSONRPC_INVALID_REQUEST, 'Invalid Request');
        }
        if (message.jsonrpc !== jsonrpc_1.JSONRPC_VERSION) {
            return (0, jsonrpc_1.makeError)((_a = message.id) !== null && _a !== void 0 ? _a : null, jsonrpc_1.JSONRPC_INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"');
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
                        this.cancelRequest(targetId, (_b = params === null || params === void 0 ? void 0 : params.reason) !== null && _b !== void 0 ? _b : 'cancelled by client');
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
            return (0, jsonrpc_1.makeError)(id, code, (_c = err === null || err === void 0 ? void 0 : err.message) !== null && _c !== void 0 ? _c : String(err), data);
        }
    }
    // -- handlers --------------------------------------------------------
    handleInitialize(params) {
        const requested = params === null || params === void 0 ? void 0 : params.protocolVersion;
        const negotiated = exports.SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : exports.DEFAULT_PROTOCOL_VERSION;
        this.negotiatedProtocolVersion = negotiated;
        return {
            protocolVersion: negotiated,
            capabilities: Object.assign({ tools: { listChanged: true }, logging: {} }, this.extraCapabilities),
            serverInfo: {
                name: 'cocos-mcp-server',
                version: '1.4.0'
            },
            instructions: 'Cocos Creator MCP server. Call tools/list (supports `cursor` pagination) ' +
                'to discover capabilities. Long‑running calls can be aborted with ' +
                'notifications/cancelled. Use logging/setLevel to control log verbosity.'
        };
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
}
exports.ProtocolHandler = ProtocolHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdG9jb2wtaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NvdXJjZS9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7Ozs7OztBQUVILDhDQUE0QztBQUM1Qyw4REFBcUM7QUFDckMsdUNBYW1CO0FBQ25CLDZDQUFnRDtBQUdoRCxzRUFBc0U7QUFDekQsUUFBQSwyQkFBMkIsR0FBRyxDQUFDLFlBQVksRUFBRSxZQUFZLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDekUsUUFBQSx3QkFBd0IsR0FBRyxtQ0FBMkIsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUV2RSxNQUFNLGVBQWUsR0FBa0I7SUFDbkMsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsT0FBTyxFQUFFLFdBQVc7Q0FDbEYsQ0FBQztBQUVGLFNBQVMsWUFBWSxDQUFDLEtBQWtCLEVBQUUsU0FBc0I7SUFDNUQsT0FBTyxlQUFlLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLGVBQWUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDaEYsQ0FBQztBQWlDRCxNQUFhLGVBQWU7SUFXeEIsWUFBWSxJQUE0Qjs7UUFQaEMsZUFBVSxHQUE0QixJQUFJLENBQUM7UUFDM0MsYUFBUSxHQUFHLElBQUksR0FBRyxFQUFvQyxDQUFDO1FBRXZELGVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBNEIsQ0FBQztRQUVqRCw4QkFBeUIsR0FBRyxnQ0FBd0IsQ0FBQztRQUd6RCxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7UUFDOUIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFBLElBQUksQ0FBQyxRQUFRLG1DQUFJLEdBQUcsQ0FBQyxDQUFDO1FBQ2xE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O0lBQy9ELENBQUM7SUFFRCxzRUFBc0U7SUFDL0QsbUJBQW1CO1FBQ3RCLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDNUIsQ0FBQztDQUNKO0FBL1NELDBDQStTQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVHJhbnNwb3J04oCRYWdub3N0aWMgTUNQIHByb3RvY29sIGhhbmRsZXIuXG4gKlxuICogVGhlIHtAbGluayBQcm90b2NvbEhhbmRsZXJ9IG93bnM6XG4gKiAgIC0gSlNPTuKAkVJQQyAyLjAgbWVzc2FnZSBkaXNwYXRjaFxuICogICAtIFRoZSBNQ1AgY2FwYWJpbGl0eSBoYW5kc2hha2UgKGBpbml0aWFsaXplYClcbiAqICAgLSBUb29sIGxpc3Rpbmcgd2l0aCBwYWdpbmF0aW9uIGN1cnNvcnMgKEc0KVxuICogICAtIFRvb2wgY2FsbHMgd2l0aCBBanYgaW5wdXQgdmFsaWRhdGlvbiAoRzgpIGFuZCBBYm9ydFNpZ25hbCBjYW5jZWxsYXRpb24gKEE4KVxuICogICAtIGBsb2dnaW5nL3NldExldmVsYCArIGBub3RpZmljYXRpb25zL21lc3NhZ2VgIChBNilcbiAqICAgLSBgbm90aWZpY2F0aW9ucy9wcm9ncmVzc2AgcGx1bWJpbmcgKEE3KVxuICogICAtIHByb3RvY29sVmVyc2lvbiBuZWdvdGlhdGlvbiArIGZlYXR1cmUgZmxhZ3MgKEc5KVxuICpcbiAqIFRyYW5zcG9ydHMgKFN0cmVhbWFibGUgSFRUUCwgc3RkaW8sIGZ1dHVyZSBXZWJTb2NrZXQpIG9ubHkgbmVlZCB0byBwdXNoXG4gKiBpbmNvbWluZyBgc3RyaW5nIHwgb2JqZWN0YCBtZXNzYWdlcyBpbnRvIHtAbGluayBQcm90b2NvbEhhbmRsZXIuaGFuZGxlfVxuICogYW5kIGZvcndhcmQgZW1pdHRlZCBzZXJ2ZXIgbm90aWZpY2F0aW9ucyB0byB0aGVpciBwZWVyLlxuICovXG5cbmltcG9ydCBBanYsIHsgVmFsaWRhdGVGdW5jdGlvbiB9IGZyb20gJ2Fqdic7XG5pbXBvcnQgYWRkRm9ybWF0cyBmcm9tICdhanYtZm9ybWF0cyc7XG5pbXBvcnQge1xuICAgIEpTT05SUENfSU5URVJOQUxfRVJST1IsXG4gICAgSlNPTlJQQ19JTlZBTElEX1BBUkFNUyxcbiAgICBKU09OUlBDX0lOVkFMSURfUkVRVUVTVCxcbiAgICBKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsXG4gICAgSlNPTlJQQ19QQVJTRV9FUlJPUixcbiAgICBKU09OUlBDX1ZFUlNJT04sXG4gICAgSnNvblJwY0Vycm9yLFxuICAgIEpzb25ScGNSZXF1ZXN0LFxuICAgIEpzb25ScGNSZXNwb25zZSxcbiAgICBNQ1BfUkVRVUVTVF9DQU5DRUxMRUQsXG4gICAgbWFrZUVycm9yLFxuICAgIG1ha2VSZXN1bHRcbn0gZnJvbSAnLi9qc29ucnBjJztcbmltcG9ydCB7IHJlc29sdmVUb29sSGludHMgfSBmcm9tICcuL3Rvb2wtaGludHMnO1xuaW1wb3J0IHsgTWNwTG9nTGV2ZWwsIFRvb2xEZWZpbml0aW9uIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vLyBQcm90b2NvbCB2ZXJzaW9ucyB0aGlzIHNlcnZlciB1bmRlcnN0YW5kcy4gVGhlIGxhdGVzdCBpcyBwcmVmZXJyZWQuXG5leHBvcnQgY29uc3QgU1VQUE9SVEVEX1BST1RPQ09MX1ZFUlNJT05TID0gWycyMDI1LTA2LTE4JywgJzIwMjUtMDMtMjYnLCAnMjAyNC0xMS0wNSddO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPVE9DT0xfVkVSU0lPTiA9IFNVUFBPUlRFRF9QUk9UT0NPTF9WRVJTSU9OU1swXTtcblxuY29uc3QgTE9HX0xFVkVMX09SREVSOiBNY3BMb2dMZXZlbFtdID0gW1xuICAgICdkZWJ1ZycsICdpbmZvJywgJ25vdGljZScsICd3YXJuaW5nJywgJ2Vycm9yJywgJ2NyaXRpY2FsJywgJ2FsZXJ0JywgJ2VtZXJnZW5jeSdcbl07XG5cbmZ1bmN0aW9uIGxldmVsQXRMZWFzdChsZXZlbDogTWNwTG9nTGV2ZWwsIHRocmVzaG9sZDogTWNwTG9nTGV2ZWwpOiBib29sZWFuIHtcbiAgICByZXR1cm4gTE9HX0xFVkVMX09SREVSLmluZGV4T2YobGV2ZWwpID49IExPR19MRVZFTF9PUkRFUi5pbmRleE9mKHRocmVzaG9sZCk7XG59XG5cbi8qKiBUb29sIHJlZ2lzdHJ5IHBhc3NlZCB0byB0aGUgaGFuZGxlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG9vbFJlZ2lzdHJ5IHtcbiAgICAvKiogUmV0dXJuIHRoZSBmdWxsIGVuYWJsZWQgdG9vbCBsaXN0IChhbHJlYWR5IGZpbHRlcmVkIGJ5IFRvb2xNYW5hZ2VyKS4gKi9cbiAgICBsaXN0VG9vbHMoKTogVG9vbERlZmluaXRpb25bXTtcbiAgICAvKiogRXhlY3V0ZSBgPGNhdGVnb3J5Pl88dG9vbD5gIHdpdGggdGhlIGdpdmVuIGFyZ3MgdW5kZXIgYW4gQWJvcnRTaWduYWwuICovXG4gICAgZXhlY3V0ZVRvb2xDYWxsKG5hbWU6IHN0cmluZywgYXJnczogYW55LCBjdHg6IFRvb2xFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxhbnk+O1xufVxuXG4vKiogUGVy4oCRcmVxdWVzdCBleGVjdXRpb24gY29udGV4dCBoYW5kZWQgdG8gYSB0b29sLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb29sRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbDtcbiAgICAvKiogUHJvZ3Jlc3MgcmVwb3J0ZXIuIGBwcm9ncmVzc1Rva2VuYCBpcyBzZXQgd2hlbiB0aGUgY2xpZW50IHByb3ZpZGVkIG9uZS4gKi9cbiAgICBwcm9ncmVzc1Rva2VuPzogc3RyaW5nIHwgbnVtYmVyO1xuICAgIHJlcG9ydFByb2dyZXNzKHByb2dyZXNzOiBudW1iZXIsIHRvdGFsPzogbnVtYmVyLCBtZXNzYWdlPzogc3RyaW5nKTogdm9pZDtcbiAgICAvKiogU2VuZCBhIGxvZyBub3RpZmljYXRpb24gdG8gdGhlIGNsaWVudCAoc3ViamVjdCB0byBjdXJyZW50IGxvZyBsZXZlbCkuICovXG4gICAgbG9nKGxldmVsOiBNY3BMb2dMZXZlbCwgZGF0YTogYW55LCBsb2dnZXI/OiBzdHJpbmcpOiB2b2lkO1xufVxuXG4vKiogTm90aWZpY2F0aW9uIHNpbmsg4oCUIHRyYW5zcG9ydHMgcGx1ZyB0aGVpciBkZWxpdmVyeSBoZXJlLiAqL1xuZXhwb3J0IHR5cGUgTm90aWZpY2F0aW9uU2luayA9IChub3RpZmljYXRpb246IEpzb25ScGNSZXF1ZXN0KSA9PiB2b2lkO1xuXG5leHBvcnQgaW50ZXJmYWNlIFByb3RvY29sSGFuZGxlck9wdGlvbnMge1xuICAgIHJlZ2lzdHJ5OiBUb29sUmVnaXN0cnk7XG4gICAgLyoqIFRvb2xzIHBlciBgdG9vbHMvbGlzdGAgcGFnZS4gRGVmYXVsdCAxMDAgKEc0KS4gKi9cbiAgICBwYWdlU2l6ZT86IG51bWJlcjtcbiAgICAvKiogSW5pdGlhbCBsb2dnaW5nIGxldmVsIChBNikuIERlZmF1bHRzIHRvIGBpbmZvYC4gKi9cbiAgICBpbml0aWFsTG9nTGV2ZWw/OiBNY3BMb2dMZXZlbDtcbiAgICAvKiogT3B0aW9uYWwgZmVhdHVyZSBmbGFncyBhZHZlcnRpc2VkIGluIGBpbml0aWFsaXplLnJlc3VsdC5jYXBhYmlsaXRpZXNgLiAqL1xuICAgIGV4dHJhQ2FwYWJpbGl0aWVzPzogUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuZXhwb3J0IGNsYXNzIFByb3RvY29sSGFuZGxlciB7XG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RyeTogVG9vbFJlZ2lzdHJ5O1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcGFnZVNpemU6IG51bWJlcjtcbiAgICBwcml2YXRlIGxvZ0xldmVsOiBNY3BMb2dMZXZlbDtcbiAgICBwcml2YXRlIG5vdGlmeVNpbms6IE5vdGlmaWNhdGlvblNpbmsgfCBudWxsID0gbnVsbDtcbiAgICBwcml2YXRlIGluRmxpZ2h0ID0gbmV3IE1hcDxzdHJpbmcgfCBudW1iZXIsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgICBwcml2YXRlIGFqdjogQWp2O1xuICAgIHByaXZhdGUgdmFsaWRhdG9ycyA9IG5ldyBNYXA8c3RyaW5nLCBWYWxpZGF0ZUZ1bmN0aW9uPigpO1xuICAgIHByaXZhdGUgZXh0cmFDYXBhYmlsaXRpZXM6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgcHJpdmF0ZSBuZWdvdGlhdGVkUHJvdG9jb2xWZXJzaW9uID0gREVGQVVMVF9QUk9UT0NPTF9WRVJTSU9OO1xuXG4gICAgY29uc3RydWN0b3Iob3B0czogUHJvdG9jb2xIYW5kbGVyT3B0aW9ucykge1xuICAgICAgICB0aGlzLnJlZ2lzdHJ5ID0gb3B0cy5yZWdpc3RyeTtcbiAgICAgICAgdGhpcy5wYWdlU2l6ZSA9IE1hdGgubWF4KDEsIG9wdHMucGFnZVNpemUgPz8gMTAwKTtcbiAgICAgICAgdGhpcy5sb2dMZXZlbCA9IG9wdHMuaW5pdGlhbExvZ0xldmVsID8/ICdpbmZvJztcbiAgICAgICAgdGhpcy5leHRyYUNhcGFiaWxpdGllcyA9IG9wdHMuZXh0cmFDYXBhYmlsaXRpZXMgfHwge307XG4gICAgICAgIHRoaXMuYWp2ID0gbmV3IEFqdih7IGFsbEVycm9yczogdHJ1ZSwgc3RyaWN0OiBmYWxzZSwgdXNlRGVmYXVsdHM6IGZhbHNlIH0pO1xuICAgICAgICBhZGRGb3JtYXRzKHRoaXMuYWp2KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0Tm90aWZpY2F0aW9uU2luayhzaW5rOiBOb3RpZmljYXRpb25TaW5rIHwgbnVsbCk6IHZvaWQge1xuICAgICAgICB0aGlzLm5vdGlmeVNpbmsgPSBzaW5rO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXRMb2dMZXZlbChsZXZlbDogTWNwTG9nTGV2ZWwpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5sb2dMZXZlbCA9IGxldmVsO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXROZWdvdGlhdGVkUHJvdG9jb2xWZXJzaW9uKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiB0aGlzLm5lZ290aWF0ZWRQcm90b2NvbFZlcnNpb247XG4gICAgfVxuXG4gICAgLyoqIENhbmNlbCBldmVyeSBpbuKAkWZsaWdodCB0b29sIGNhbGwuIFVzZWQgb24gdHJhbnNwb3J0IHNodXRkb3duLiAqL1xuICAgIHB1YmxpYyBjYW5jZWxBbGwocmVhc29uID0gJ3RyYW5zcG9ydCBjbG9zZWQnKTogdm9pZCB7XG4gICAgICAgIGZvciAoY29uc3QgWywgY3RybF0gb2YgdGhpcy5pbkZsaWdodCkge1xuICAgICAgICAgICAgdHJ5IHsgY3RybC5hYm9ydChuZXcgRXJyb3IocmVhc29uKSk7IH0gY2F0Y2ggeyAvKiBub29wICovIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLmluRmxpZ2h0LmNsZWFyKCk7XG4gICAgfVxuXG4gICAgLyoqIEVudHJ5IHBvaW50IGZvciB0aGUgdHJhbnNwb3J0LiBSZXR1cm5zIHRoZSByZXNwb25zZSAob3IgbnVsbCBmb3Igbm90aWZpY2F0aW9ucykuICovXG4gICAgcHVibGljIGFzeW5jIGhhbmRsZShyYXc6IHN0cmluZyB8IG9iamVjdCk6IFByb21pc2U8SnNvblJwY1Jlc3BvbnNlIHwgSnNvblJwY1Jlc3BvbnNlW10gfCBudWxsPiB7XG4gICAgICAgIGxldCBtZXNzYWdlOiBhbnk7XG4gICAgICAgIGlmICh0eXBlb2YgcmF3ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gcmF3Lmxlbmd0aCA9PT0gMCA/IG51bGwgOiBKU09OLnBhcnNlKHJhdyk7XG4gICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFrZUVycm9yKG51bGwsIEpTT05SUENfUEFSU0VfRVJST1IsIGBQYXJzZSBlcnJvcjogJHtlPy5tZXNzYWdlID8/ICdpbnZhbGlkIEpTT04nfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbWVzc2FnZSA9IHJhdztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG1lc3NhZ2UpKSB7XG4gICAgICAgICAgICBpZiAobWVzc2FnZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFrZUVycm9yKG51bGwsIEpTT05SUENfSU5WQUxJRF9SRVFVRVNULCAnSW52YWxpZCBSZXF1ZXN0OiBlbXB0eSBiYXRjaCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3Qgb3V0OiBKc29uUnBjUmVzcG9uc2VbXSA9IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIG1lc3NhZ2UpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gYXdhaXQgdGhpcy5oYW5kbGVTaW5nbGUoaXRlbSk7XG4gICAgICAgICAgICAgICAgaWYgKHIpIG91dC5wdXNoKHIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG91dC5sZW5ndGggPyBvdXQgOiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlU2luZ2xlKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlU2luZ2xlKG1lc3NhZ2U6IGFueSk6IFByb21pc2U8SnNvblJwY1Jlc3BvbnNlIHwgbnVsbD4ge1xuICAgICAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkobWVzc2FnZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19JTlZBTElEX1JFUVVFU1QsICdJbnZhbGlkIFJlcXVlc3QnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS5qc29ucnBjICE9PSBKU09OUlBDX1ZFUlNJT04pIHtcbiAgICAgICAgICAgIHJldHVybiBtYWtlRXJyb3IobWVzc2FnZS5pZCA/PyBudWxsLCBKU09OUlBDX0lOVkFMSURfUkVRVUVTVCwgJ0ludmFsaWQgUmVxdWVzdDoganNvbnJwYyBtdXN0IGJlIFwiMi4wXCInKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7IGlkLCBtZXRob2QsIHBhcmFtcyB9ID0gbWVzc2FnZTtcbiAgICAgICAgY29uc3QgaXNOb3RpZiA9IGlkID09PSB1bmRlZmluZWQgfHwgaWQgPT09IG51bGw7XG4gICAgICAgIGlmICh0eXBlb2YgbWV0aG9kICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIGlzTm90aWYgPyBudWxsIDogbWFrZUVycm9yKGlkLCBKU09OUlBDX0lOVkFMSURfUkVRVUVTVCwgJ0ludmFsaWQgUmVxdWVzdDogbWlzc2luZyBtZXRob2QnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBOb3RpZmljYXRpb25zIGZpcnN0LlxuICAgICAgICAgICAgc3dpdGNoIChtZXRob2QpIHtcbiAgICAgICAgICAgICAgICBjYXNlICdub3RpZmljYXRpb25zL2luaXRpYWxpemVkJzpcbiAgICAgICAgICAgICAgICBjYXNlICdpbml0aWFsaXplZCc6XG4gICAgICAgICAgICAgICAgY2FzZSAnbm90aWZpY2F0aW9ucy9yb290cy9saXN0X2NoYW5nZWQnOlxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICBjYXNlICdub3RpZmljYXRpb25zL2NhbmNlbGxlZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SWQgPSBwYXJhbXM/LnJlcXVlc3RJZDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldElkICE9PSB1bmRlZmluZWQpIHRoaXMuY2FuY2VsUmVxdWVzdCh0YXJnZXRJZCwgcGFyYW1zPy5yZWFzb24gPz8gJ2NhbmNlbGxlZCBieSBjbGllbnQnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgcmVzdWx0OiBhbnk7XG4gICAgICAgICAgICBzd2l0Y2ggKG1ldGhvZCkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ2luaXRpYWxpemUnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB0aGlzLmhhbmRsZUluaXRpYWxpemUocGFyYW1zKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAncGluZyc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHt9O1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdsb2dnaW5nL3NldExldmVsJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gdGhpcy5oYW5kbGVMb2dnaW5nU2V0TGV2ZWwocGFyYW1zKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAndG9vbHMvbGlzdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHRoaXMuaGFuZGxlVG9vbHNMaXN0KHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Rvb2xzL2NhbGwnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZVRvb2xzQ2FsbChpZCwgcGFyYW1zKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX01FVEhPRF9OT1RfRk9VTkQsIGBNZXRob2Qgbm90IGZvdW5kOiAke21ldGhvZH1gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGlzTm90aWYpIHJldHVybiBudWxsO1xuICAgICAgICAgICAgcmV0dXJuIG1ha2VSZXN1bHQoaWQsIHJlc3VsdCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICBpZiAoaXNOb3RpZikgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICBjb25zdCBjb2RlID0gZXJyIGluc3RhbmNlb2YgSnNvblJwY0Vycm9yID8gZXJyLmNvZGUgOiBKU09OUlBDX0lOVEVSTkFMX0VSUk9SO1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IGVyciBpbnN0YW5jZW9mIEpzb25ScGNFcnJvciA/IGVyci5kYXRhIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIG1ha2VFcnJvcihpZCwgY29kZSwgZXJyPy5tZXNzYWdlID8/IFN0cmluZyhlcnIpLCBkYXRhKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tIGhhbmRsZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGhhbmRsZUluaXRpYWxpemUocGFyYW1zOiBhbnkpOiBhbnkge1xuICAgICAgICBjb25zdCByZXF1ZXN0ZWQgPSBwYXJhbXM/LnByb3RvY29sVmVyc2lvbjtcbiAgICAgICAgY29uc3QgbmVnb3RpYXRlZCA9IFNVUFBPUlRFRF9QUk9UT0NPTF9WRVJTSU9OUy5pbmNsdWRlcyhyZXF1ZXN0ZWQpXG4gICAgICAgICAgICA/IHJlcXVlc3RlZFxuICAgICAgICAgICAgOiBERUZBVUxUX1BST1RPQ09MX1ZFUlNJT047XG4gICAgICAgIHRoaXMubmVnb3RpYXRlZFByb3RvY29sVmVyc2lvbiA9IG5lZ290aWF0ZWQ7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcm90b2NvbFZlcnNpb246IG5lZ290aWF0ZWQsXG4gICAgICAgICAgICBjYXBhYmlsaXRpZXM6IHtcbiAgICAgICAgICAgICAgICB0b29sczogeyBsaXN0Q2hhbmdlZDogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgIGxvZ2dpbmc6IHt9LFxuICAgICAgICAgICAgICAgIC4uLnRoaXMuZXh0cmFDYXBhYmlsaXRpZXNcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzZXJ2ZXJJbmZvOiB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2NvY29zLW1jcC1zZXJ2ZXInLFxuICAgICAgICAgICAgICAgIHZlcnNpb246ICcxLjQuMCdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpbnN0cnVjdGlvbnM6XG4gICAgICAgICAgICAgICAgJ0NvY29zIENyZWF0b3IgTUNQIHNlcnZlci4gQ2FsbCB0b29scy9saXN0IChzdXBwb3J0cyBgY3Vyc29yYCBwYWdpbmF0aW9uKSAnICtcbiAgICAgICAgICAgICAgICAndG8gZGlzY292ZXIgY2FwYWJpbGl0aWVzLiBMb25n4oCRcnVubmluZyBjYWxscyBjYW4gYmUgYWJvcnRlZCB3aXRoICcgK1xuICAgICAgICAgICAgICAgICdub3RpZmljYXRpb25zL2NhbmNlbGxlZC4gVXNlIGxvZ2dpbmcvc2V0TGV2ZWwgdG8gY29udHJvbCBsb2cgdmVyYm9zaXR5LidcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGhhbmRsZUxvZ2dpbmdTZXRMZXZlbChwYXJhbXM6IGFueSk6IGFueSB7XG4gICAgICAgIGNvbnN0IGxldmVsID0gcGFyYW1zPy5sZXZlbDtcbiAgICAgICAgaWYgKCFsZXZlbCB8fCAhTE9HX0xFVkVMX09SREVSLmluY2x1ZGVzKGxldmVsKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihKU09OUlBDX0lOVkFMSURfUEFSQU1TLCBgSW52YWxpZCBsb2cgbGV2ZWw6ICR7bGV2ZWx9YCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dMZXZlbCA9IGxldmVsO1xuICAgICAgICByZXR1cm4ge307XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBoYW5kbGVUb29sc0xpc3QocGFyYW1zOiBhbnkpOiBhbnkge1xuICAgICAgICBjb25zdCBhbGwgPSB0aGlzLnJlZ2lzdHJ5Lmxpc3RUb29scygpLm1hcCgodCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgaGludHMgPSByZXNvbHZlVG9vbEhpbnRzKHQubmFtZSk7XG4gICAgICAgICAgICBjb25zdCBkZWY6IGFueSA9IHtcbiAgICAgICAgICAgICAgICBuYW1lOiB0Lm5hbWUsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IHQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHQuaW5wdXRTY2hlbWFcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAodC5vdXRwdXRTY2hlbWEgfHwgaGludHMub3V0cHV0U2NoZW1hKSBkZWYub3V0cHV0U2NoZW1hID0gdC5vdXRwdXRTY2hlbWEgPz8gaGludHMub3V0cHV0U2NoZW1hO1xuICAgICAgICAgICAgaWYgKHQuYW5ub3RhdGlvbnMgfHwgaGludHMuYW5ub3RhdGlvbnMpIGRlZi5hbm5vdGF0aW9ucyA9IHsgLi4uaGludHMuYW5ub3RhdGlvbnMsIC4uLih0LmFubm90YXRpb25zIHx8IHt9KSB9O1xuICAgICAgICAgICAgcmV0dXJuIGRlZjtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRzQ6IGN1cnNvciBwYWdpbmF0aW9uLiBUaGUgY3Vyc29yIGlzIHRoZSBvcGFxdWUgbmV4dOKAkWluZGV4LlxuICAgICAgICBjb25zdCBjdXJzb3IgPSBwYXJhbXM/LmN1cnNvcjtcbiAgICAgICAgbGV0IHN0YXJ0ID0gMDtcbiAgICAgICAgaWYgKGN1cnNvciAhPT0gdW5kZWZpbmVkICYmIGN1cnNvciAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgaWR4ID0gTnVtYmVyLnBhcnNlSW50KFN0cmluZyhjdXJzb3IpLCAxMCk7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShpZHgpIHx8IGlkeCA8IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSnNvblJwY0Vycm9yKEpTT05SUENfSU5WQUxJRF9QQVJBTVMsIGBJbnZhbGlkIGN1cnNvcjogJHtjdXJzb3J9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGFydCA9IGlkeDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1pbihhbGwubGVuZ3RoLCBzdGFydCArIHRoaXMucGFnZVNpemUpO1xuICAgICAgICBjb25zdCB0b29scyA9IGFsbC5zbGljZShzdGFydCwgZW5kKTtcbiAgICAgICAgY29uc3Qgb3V0OiBhbnkgPSB7IHRvb2xzIH07XG4gICAgICAgIGlmIChlbmQgPCBhbGwubGVuZ3RoKSBvdXQubmV4dEN1cnNvciA9IFN0cmluZyhlbmQpO1xuICAgICAgICByZXR1cm4gb3V0O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlVG9vbHNDYWxsKGlkOiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkLCBwYXJhbXM6IGFueSk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGlmICghcGFyYW1zIHx8IHR5cGVvZiBwYXJhbXMubmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgJ0ludmFsaWQgcGFyYW1zOiBcIm5hbWVcIiBpcyByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHsgbmFtZSwgYXJndW1lbnRzOiBhcmdzIH0gPSBwYXJhbXM7XG4gICAgICAgIGNvbnN0IHByb2dyZXNzVG9rZW4gPSBwYXJhbXM/Ll9tZXRhPy5wcm9ncmVzc1Rva2VuO1xuXG4gICAgICAgIC8vIEc4OiBBanYgaW5wdXQgdmFsaWRhdGlvbi4gTG9vayB1cCB0aGUgdG9vbCdzIGlucHV0U2NoZW1hIGFuZCB2YWxpZGF0ZS5cbiAgICAgICAgY29uc3QgZGVmID0gdGhpcy5yZWdpc3RyeS5saXN0VG9vbHMoKS5maW5kKCh0KSA9PiB0Lm5hbWUgPT09IG5hbWUpO1xuICAgICAgICBpZiAoIWRlZikge1xuICAgICAgICAgICAgLy8gUGVyIE1DUCBzcGVjIHdlIHN0aWxsIHJldHVybiBhIHJlc3VsdCB3aXRoIGlzRXJyb3I9dHJ1ZSBzbyB0aGUgTExNIGNhbiByZWFjdC5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgY29udGVudDogW3sgdHlwZTogJ3RleHQnLCB0ZXh0OiBgVG9vbCBub3QgZm91bmQ6ICR7bmFtZX1gIH1dLFxuICAgICAgICAgICAgICAgIGlzRXJyb3I6IHRydWVcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlZi5pbnB1dFNjaGVtYSkge1xuICAgICAgICAgICAgY29uc3QgdmFsaWRhdG9yID0gdGhpcy5nZXRWYWxpZGF0b3IobmFtZSwgZGVmLmlucHV0U2NoZW1hKTtcbiAgICAgICAgICAgIGNvbnN0IG9rID0gdmFsaWRhdG9yKGFyZ3MgPz8ge30pO1xuICAgICAgICAgICAgaWYgKCFvaykge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmFqdi5lcnJvcnNUZXh0KHZhbGlkYXRvci5lcnJvcnMsIHsgc2VwYXJhdG9yOiAnOyAnIH0pO1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKc29uUnBjRXJyb3IoSlNPTlJQQ19JTlZBTElEX1BBUkFNUywgYEludmFsaWQgYXJndW1lbnRzIGZvciAke25hbWV9OiAke21lc3NhZ2V9YCwge1xuICAgICAgICAgICAgICAgICAgICB0b29sOiBuYW1lLFxuICAgICAgICAgICAgICAgICAgICBlcnJvcnM6IHZhbGlkYXRvci5lcnJvcnNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEE4OiBBYm9ydFNpZ25hbCB3aXJpbmcuXG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICAgIGNvbnN0IHRyYWNrSWQ6IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQgPSBpZDtcbiAgICAgICAgaWYgKHRyYWNrSWQgIT09IHVuZGVmaW5lZCAmJiB0cmFja0lkICE9PSBudWxsKSB0aGlzLmluRmxpZ2h0LnNldCh0cmFja0lkLCBjb250cm9sbGVyKTtcblxuICAgICAgICBjb25zdCBjdHg6IFRvb2xFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgICAgICAgIHByb2dyZXNzVG9rZW4sXG4gICAgICAgICAgICByZXBvcnRQcm9ncmVzczogKHByb2dyZXNzLCB0b3RhbCwgbWVzc2FnZSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1Rva2VuID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeSgnbm90aWZpY2F0aW9ucy9wcm9ncmVzcycsIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3NUb2tlbixcbiAgICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3MsXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbG9nOiAobGV2ZWwsIGRhdGEsIGxvZ2dlcikgPT4gdGhpcy5lbWl0TG9nKGxldmVsLCBkYXRhLCBsb2dnZXIpXG4gICAgICAgIH07XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHRvb2xSZXN1bHQgPSBhd2FpdCB0aGlzLnJlZ2lzdHJ5LmV4ZWN1dGVUb29sQ2FsbChuYW1lLCBhcmdzID8/IHt9LCBjdHgpO1xuICAgICAgICAgICAgY29uc3QgaXNFcnJvciA9ICEhKHRvb2xSZXN1bHQgJiYgdHlwZW9mIHRvb2xSZXN1bHQgPT09ICdvYmplY3QnICYmIHRvb2xSZXN1bHQuc3VjY2VzcyA9PT0gZmFsc2UpO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0OiBhbnkgPSB7XG4gICAgICAgICAgICAgICAgY29udGVudDogW3sgdHlwZTogJ3RleHQnLCB0ZXh0OiBKU09OLnN0cmluZ2lmeSh0b29sUmVzdWx0KSB9XSxcbiAgICAgICAgICAgICAgICBpc0Vycm9yXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy8gTUNQIDIwMjXigJEwNuKAkTE4OiB3aGVuIHRoZSB0b29sIGRlY2xhcmVzIGFuIG91dHB1dFNjaGVtYSwgaW5jbHVkZSBgc3RydWN0dXJlZENvbnRlbnRgLlxuICAgICAgICAgICAgaWYgKGRlZi5vdXRwdXRTY2hlbWEgfHwgcmVzb2x2ZVRvb2xIaW50cyhuYW1lKS5vdXRwdXRTY2hlbWEpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQuc3RydWN0dXJlZENvbnRlbnQgPSB0b29sUmVzdWx0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgIGlmIChjb250cm9sbGVyLnNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgICAgICAgLy8gUmXigJF0aHJvdyBhcyBKU09O4oCRUlBDIGNhbmNlbGxhdGlvbiBlcnJvciBmb3IgY2xpZW50cyB0aGF0IHdhbnQgaXQuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpzb25ScGNFcnJvcihNQ1BfUkVRVUVTVF9DQU5DRUxMRUQsIGVycj8ubWVzc2FnZSA/PyAnUmVxdWVzdCBjYW5jZWxsZWQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgY29udGVudDogW3sgdHlwZTogJ3RleHQnLCB0ZXh0OiBlcnI/Lm1lc3NhZ2UgPz8gU3RyaW5nKGVycikgfV0sXG4gICAgICAgICAgICAgICAgaXNFcnJvcjogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGlmICh0cmFja0lkICE9PSB1bmRlZmluZWQgJiYgdHJhY2tJZCAhPT0gbnVsbCkgdGhpcy5pbkZsaWdodC5kZWxldGUodHJhY2tJZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFZhbGlkYXRvcihuYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55KTogVmFsaWRhdGVGdW5jdGlvbiB7XG4gICAgICAgIGxldCB2ID0gdGhpcy52YWxpZGF0b3JzLmdldChuYW1lKTtcbiAgICAgICAgaWYgKCF2KSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHYgPSB0aGlzLmFqdi5jb21waWxlKHNjaGVtYSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAvLyBTY2hlbWEgYnVnIHNob3VsZG4ndCBraWxsIHRoZSBjYWxsIOKAlCBmYWxsIGJhY2sgdG8gYSBwZXJtaXNzaXZlIHZhbGlkYXRvci5cbiAgICAgICAgICAgICAgICB2ID0gKCgpID0+IHRydWUpIGFzIHVua25vd24gYXMgVmFsaWRhdGVGdW5jdGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMudmFsaWRhdG9ycy5zZXQobmFtZSwgdik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHY7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjYW5jZWxSZXF1ZXN0KHJlcXVlc3RJZDogc3RyaW5nIHwgbnVtYmVyLCByZWFzb246IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBjdHJsID0gdGhpcy5pbkZsaWdodC5nZXQocmVxdWVzdElkKTtcbiAgICAgICAgaWYgKGN0cmwpIHtcbiAgICAgICAgICAgIHRyeSB7IGN0cmwuYWJvcnQobmV3IEVycm9yKHJlYXNvbikpOyB9IGNhdGNoIHsgLyogbm9vcCAqLyB9XG4gICAgICAgICAgICB0aGlzLmluRmxpZ2h0LmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBlbWl0TG9nKGxldmVsOiBNY3BMb2dMZXZlbCwgZGF0YTogYW55LCBsb2dnZXI/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgaWYgKCFsZXZlbEF0TGVhc3QobGV2ZWwsIHRoaXMubG9nTGV2ZWwpKSByZXR1cm47XG4gICAgICAgIHRoaXMubm90aWZ5KCdub3RpZmljYXRpb25zL21lc3NhZ2UnLCB7IGxldmVsLCBsb2dnZXIsIGRhdGEgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBub3RpZnkobWV0aG9kOiBzdHJpbmcsIHBhcmFtczogYW55KTogdm9pZCB7XG4gICAgICAgIGlmICghdGhpcy5ub3RpZnlTaW5rKSByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLm5vdGlmeVNpbmsoeyBqc29ucnBjOiBKU09OUlBDX1ZFUlNJT04sIG1ldGhvZCwgcGFyYW1zIH0pO1xuICAgICAgICB9IGNhdGNoIHsgLyogc2luayBlcnJvcnMgbXVzdCBub3QgYnJlYWsgdG9vbCBleGVjdXRpb24gKi8gfVxuICAgIH1cblxuICAgIC8qKiBJbnZhbGlkYXRlIGNhY2hlZCB2YWxpZGF0b3JzIHdoZW4gdGhlIGVuYWJsZWQgdG9vbCBzZXQgY2hhbmdlcy4gKi9cbiAgICBwdWJsaWMgY2xlYXJWYWxpZGF0b3JDYWNoZSgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy52YWxpZGF0b3JzLmNsZWFyKCk7XG4gICAgfVxufVxuIl19