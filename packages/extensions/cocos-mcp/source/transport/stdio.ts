/**
 * stdio transport (A2).
 *
 * MCP messages are newline‑delimited JSON over stdin → stdout. Stderr is
 * reserved for log output so it doesn't corrupt the JSON stream.
 *
 * The transport instance is intentionally minimal — Claude Desktop, Cursor
 * and the official MCP inspector all use exactly this framing.
 */

import { Readable, Writable } from 'stream';
import { ProtocolHandler } from '../protocol/protocol-handler';
import { JsonRpcRequest, JsonRpcResponse } from '../protocol/jsonrpc';

export interface StdioTransportOptions {
    handler: ProtocolHandler;
    input?: Readable;
    output?: Writable;
    /** Sink for human‑readable diagnostics (defaults to process.stderr). */
    errorOut?: Writable;
}

export class StdioTransport {
    private handler: ProtocolHandler;
    private input: Readable;
    private output: Writable;
    private errorOut: Writable;
    private buffer = '';
    private started = false;
    private onData = (chunk: Buffer | string) => this.consume(chunk);
    private onClose = () => this.handler.cancelAll('stdio closed');

    constructor(opts: StdioTransportOptions) {
        this.handler = opts.handler;
        this.input = opts.input ?? process.stdin;
        this.output = opts.output ?? process.stdout;
        this.errorOut = opts.errorOut ?? process.stderr;
        this.handler.setNotificationSink((n) => this.writeMessage(n));
    }

    public start(): void {
        if (this.started) return;
        this.started = true;
        this.input.setEncoding?.('utf8');
        this.input.on('data', this.onData);
        this.input.on('end', this.onClose);
        this.input.on('close', this.onClose);
    }

    public stop(): void {
        if (!this.started) return;
        this.started = false;
        this.input.off('data', this.onData);
        this.input.off('end', this.onClose);
        this.input.off('close', this.onClose);
        this.handler.setNotificationSink(null);
        this.handler.cancelAll('stdio stopped');
    }

    private consume(chunk: Buffer | string): void {
        this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (line.length === 0) continue;
            this.dispatch(line).catch((e) => this.logError(e));
        }
    }

    private async dispatch(line: string): Promise<void> {
        const response = await this.handler.handle(line);
        if (!response) return;
        if (Array.isArray(response)) {
            for (const r of response) this.writeMessage(r);
        } else {
            this.writeMessage(response);
        }
    }

    private writeMessage(message: JsonRpcRequest | JsonRpcResponse): void {
        try {
            this.output.write(JSON.stringify(message) + '\n');
        } catch (e) {
            this.logError(e);
        }
    }

    private logError(e: unknown): void {
        try {
            this.errorOut.write(`[cocos-mcp stdio] ${(e as any)?.message ?? String(e)}\n`);
        } catch { /* ignore */ }
    }
}
