/**
 * Shared JSON‑RPC 2.0 / MCP wire helpers used by every transport.
 *
 * Keeping these here means the HTTP, SSE and stdio transports speak exactly
 * the same protocol — only their framing differs.
 */

export const JSONRPC_VERSION = '2.0';

// JSON‑RPC 2.0 standard error codes plus the MCP‑specific ones.
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/** MCP request was cancelled by the client via `notifications/cancelled`. */
export const MCP_REQUEST_CANCELLED = -32800;
/** Authentication required / failed for a Streamable HTTP transport. */
export const MCP_UNAUTHORIZED = -32001;

export class JsonRpcError extends Error {
    public readonly code: number;
    public readonly data?: any;
    constructor(code: number, message: string, data?: any) {
        super(message);
        this.code = code;
        this.data = data;
    }
}

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: any;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

export function makeError(id: string | number | null, code: number, message: string, data?: any): JsonRpcResponse {
    const error: any = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: JSONRPC_VERSION, id, error };
}

export function makeResult(id: string | number | null, result: any): JsonRpcResponse {
    return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function isNotification(message: any): boolean {
    return !message || message.id === undefined || message.id === null;
}
