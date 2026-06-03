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

import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
    JSONRPC_INTERNAL_ERROR,
    JSONRPC_INVALID_PARAMS,
    JSONRPC_INVALID_REQUEST,
    JSONRPC_METHOD_NOT_FOUND,
    JSONRPC_PARSE_ERROR,
    JSONRPC_VERSION,
    JsonRpcError,
    JsonRpcRequest,
    JsonRpcResponse,
    MCP_REQUEST_CANCELLED,
    makeError,
    makeResult
} from './jsonrpc';
import { resolveToolHints } from './tool-hints';
import { McpLogLevel, ToolDefinition } from '../types';

// Protocol versions this server understands. The latest is preferred.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const LOG_LEVEL_ORDER: McpLogLevel[] = [
    'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'
];

function levelAtLeast(level: McpLogLevel, threshold: McpLogLevel): boolean {
    return LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(threshold);
}

/** Tool registry passed to the handler. */
export interface ToolRegistry {
    /** Return the full enabled tool list (already filtered by ToolManager). */
    listTools(): ToolDefinition[];
    /** Execute `<category>_<tool>` with the given args under an AbortSignal. */
    executeToolCall(name: string, args: any, ctx: ToolExecutionContext): Promise<any>;
}

/** Per‑request execution context handed to a tool. */
export interface ToolExecutionContext {
    signal: AbortSignal;
    /** Progress reporter. `progressToken` is set when the client provided one. */
    progressToken?: string | number;
    reportProgress(progress: number, total?: number, message?: string): void;
    /** Send a log notification to the client (subject to current log level). */
    log(level: McpLogLevel, data: any, logger?: string): void;
}

/** Notification sink — transports plug their delivery here. */
export type NotificationSink = (notification: JsonRpcRequest) => void;

export interface ProtocolHandlerOptions {
    registry: ToolRegistry;
    /** Tools per `tools/list` page. Default 100 (G4). */
    pageSize?: number;
    /** Initial logging level (A6). Defaults to `info`. */
    initialLogLevel?: McpLogLevel;
    /** Optional feature flags advertised in `initialize.result.capabilities`. */
    extraCapabilities?: Record<string, any>;
}

export class ProtocolHandler {
    private readonly registry: ToolRegistry;
    private readonly pageSize: number;
    private logLevel: McpLogLevel;
    private notifySink: NotificationSink | null = null;
    private inFlight = new Map<string | number, AbortController>();
    private ajv: Ajv;
    private validators = new Map<string, ValidateFunction>();
    private extraCapabilities: Record<string, any>;
    private negotiatedProtocolVersion = DEFAULT_PROTOCOL_VERSION;

    constructor(opts: ProtocolHandlerOptions) {
        this.registry = opts.registry;
        this.pageSize = Math.max(1, opts.pageSize ?? 100);
        this.logLevel = opts.initialLogLevel ?? 'info';
        this.extraCapabilities = opts.extraCapabilities || {};
        this.ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
        addFormats(this.ajv);
    }

    public setNotificationSink(sink: NotificationSink | null): void {
        this.notifySink = sink;
    }

    public setLogLevel(level: McpLogLevel): void {
        this.logLevel = level;
    }

    public getNegotiatedProtocolVersion(): string {
        return this.negotiatedProtocolVersion;
    }

    /** Cancel every in‑flight tool call. Used on transport shutdown. */
    public cancelAll(reason = 'transport closed'): void {
        for (const [, ctrl] of this.inFlight) {
            try { ctrl.abort(new Error(reason)); } catch { /* noop */ }
        }
        this.inFlight.clear();
    }

    /** Entry point for the transport. Returns the response (or null for notifications). */
    public async handle(raw: string | object): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
        let message: any;
        if (typeof raw === 'string') {
            try {
                message = raw.length === 0 ? null : JSON.parse(raw);
            } catch (e: any) {
                return makeError(null, JSONRPC_PARSE_ERROR, `Parse error: ${e?.message ?? 'invalid JSON'}`);
            }
        } else {
            message = raw;
        }

        if (Array.isArray(message)) {
            if (message.length === 0) {
                return makeError(null, JSONRPC_INVALID_REQUEST, 'Invalid Request: empty batch');
            }
            const out: JsonRpcResponse[] = [];
            for (const item of message) {
                const r = await this.handleSingle(item);
                if (r) out.push(r);
            }
            return out.length ? out : null;
        }

        return this.handleSingle(message);
    }

    private async handleSingle(message: any): Promise<JsonRpcResponse | null> {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return makeError(null, JSONRPC_INVALID_REQUEST, 'Invalid Request');
        }
        if (message.jsonrpc !== JSONRPC_VERSION) {
            return makeError(message.id ?? null, JSONRPC_INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"');
        }
        const { id, method, params } = message;
        const isNotif = id === undefined || id === null;
        if (typeof method !== 'string') {
            return isNotif ? null : makeError(id, JSONRPC_INVALID_REQUEST, 'Invalid Request: missing method');
        }

        try {
            // Notifications first.
            switch (method) {
                case 'notifications/initialized':
                case 'initialized':
                case 'notifications/roots/list_changed':
                    return null;
                case 'notifications/cancelled': {
                    const targetId = params?.requestId;
                    if (targetId !== undefined) this.cancelRequest(targetId, params?.reason ?? 'cancelled by client');
                    return null;
                }
            }

            let result: any;
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
                    throw new JsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
            }

            if (isNotif) return null;
            return makeResult(id, result);
        } catch (err: any) {
            if (isNotif) return null;
            const code = err instanceof JsonRpcError ? err.code : JSONRPC_INTERNAL_ERROR;
            const data = err instanceof JsonRpcError ? err.data : undefined;
            return makeError(id, code, err?.message ?? String(err), data);
        }
    }

    // -- handlers --------------------------------------------------------

    private handleInitialize(params: any): any {
        const requested = params?.protocolVersion;
        const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : DEFAULT_PROTOCOL_VERSION;
        this.negotiatedProtocolVersion = negotiated;
        return {
            protocolVersion: negotiated,
            capabilities: {
                tools: { listChanged: true },
                logging: {},
                ...this.extraCapabilities
            },
            serverInfo: {
                name: 'cocos-mcp-server',
                version: '1.4.0'
            },
            instructions:
                'Cocos Creator MCP server. Call tools/list (supports `cursor` pagination) ' +
                'to discover capabilities. Long‑running calls can be aborted with ' +
                'notifications/cancelled. Use logging/setLevel to control log verbosity.'
        };
    }

    private handleLoggingSetLevel(params: any): any {
        const level = params?.level;
        if (!level || !LOG_LEVEL_ORDER.includes(level)) {
            throw new JsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid log level: ${level}`);
        }
        this.logLevel = level;
        return {};
    }

    private handleToolsList(params: any): any {
        const all = this.registry.listTools().map((t) => {
            const hints = resolveToolHints(t.name);
            const def: any = {
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema
            };
            if (t.outputSchema || hints.outputSchema) def.outputSchema = t.outputSchema ?? hints.outputSchema;
            if (t.annotations || hints.annotations) def.annotations = { ...hints.annotations, ...(t.annotations || {}) };
            return def;
        });

        // G4: cursor pagination. The cursor is the opaque next‑index.
        const cursor = params?.cursor;
        let start = 0;
        if (cursor !== undefined && cursor !== null) {
            const idx = Number.parseInt(String(cursor), 10);
            if (!Number.isFinite(idx) || idx < 0) {
                throw new JsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid cursor: ${cursor}`);
            }
            start = idx;
        }
        const end = Math.min(all.length, start + this.pageSize);
        const tools = all.slice(start, end);
        const out: any = { tools };
        if (end < all.length) out.nextCursor = String(end);
        return out;
    }

    private async handleToolsCall(id: string | number | null | undefined, params: any): Promise<any> {
        if (!params || typeof params.name !== 'string') {
            throw new JsonRpcError(JSONRPC_INVALID_PARAMS, 'Invalid params: "name" is required');
        }
        const { name, arguments: args } = params;
        const progressToken = params?._meta?.progressToken;

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
            const ok = validator(args ?? {});
            if (!ok) {
                const message = this.ajv.errorsText(validator.errors, { separator: '; ' });
                throw new JsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid arguments for ${name}: ${message}`, {
                    tool: name,
                    errors: validator.errors
                });
            }
        }

        // A8: AbortSignal wiring.
        const controller = new AbortController();
        const trackId: string | number | null | undefined = id;
        if (trackId !== undefined && trackId !== null) this.inFlight.set(trackId, controller);

        const ctx: ToolExecutionContext = {
            signal: controller.signal,
            progressToken,
            reportProgress: (progress, total, message) => {
                if (progressToken === undefined) return;
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
            const toolResult = await this.registry.executeToolCall(name, args ?? {}, ctx);
            const isError = !!(toolResult && typeof toolResult === 'object' && toolResult.success === false);
            const result: any = {
                content: [{ type: 'text', text: JSON.stringify(toolResult) }],
                isError
            };
            // MCP 2025‑06‑18: when the tool declares an outputSchema, include `structuredContent`.
            if (def.outputSchema || resolveToolHints(name).outputSchema) {
                result.structuredContent = toolResult;
            }
            return result;
        } catch (err: any) {
            if (controller.signal.aborted) {
                // Re‑throw as JSON‑RPC cancellation error for clients that want it.
                throw new JsonRpcError(MCP_REQUEST_CANCELLED, err?.message ?? 'Request cancelled');
            }
            return {
                content: [{ type: 'text', text: err?.message ?? String(err) }],
                isError: true
            };
        } finally {
            if (trackId !== undefined && trackId !== null) this.inFlight.delete(trackId);
        }
    }

    private getValidator(name: string, schema: any): ValidateFunction {
        let v = this.validators.get(name);
        if (!v) {
            try {
                v = this.ajv.compile(schema);
            } catch (e: any) {
                // Schema bug shouldn't kill the call — fall back to a permissive validator.
                v = (() => true) as unknown as ValidateFunction;
            }
            this.validators.set(name, v);
        }
        return v;
    }

    private cancelRequest(requestId: string | number, reason: string): void {
        const ctrl = this.inFlight.get(requestId);
        if (ctrl) {
            try { ctrl.abort(new Error(reason)); } catch { /* noop */ }
            this.inFlight.delete(requestId);
        }
    }

    private emitLog(level: McpLogLevel, data: any, logger?: string): void {
        if (!levelAtLeast(level, this.logLevel)) return;
        this.notify('notifications/message', { level, logger, data });
    }

    private notify(method: string, params: any): void {
        if (!this.notifySink) return;
        try {
            this.notifySink({ jsonrpc: JSONRPC_VERSION, method, params });
        } catch { /* sink errors must not break tool execution */ }
    }

    /** Invalidate cached validators when the enabled tool set changes. */
    public clearValidatorCache(): void {
        this.validators.clear();
    }
}
