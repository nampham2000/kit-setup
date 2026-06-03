/**
 * Streamable HTTP transport — MCP 2025‑03‑26.
 *
 * Implements:
 *   - POST `/mcp`           : client → server JSON‑RPC (response is either
 *                              `application/json` or `text/event-stream`
 *                              depending on the `Accept` header).
 *   - GET `/mcp`            : open a server → client SSE channel. Supports
 *                              `Last-Event-ID` for resume.
 *   - DELETE `/mcp`         : explicit session termination (A1 spec).
 *   - `Mcp-Session-Id`      : assigned on `initialize`, echoed on every
 *                              subsequent request from the same client.
 *   - `Origin` allow‑list   : DNS‑rebinding mitigation (A4).
 *   - `Host` allow‑list     : extra DNS‑rebinding mitigation (A4).
 *   - `Authorization: ******`: optional shared secret (A5).
 *
 * Each session owns one {@link ProtocolHandler}. A session can have at most
 * one active GET (SSE) channel at a time — re‑opening replaces the prior one.
 */

import * as http from 'http';
import * as url from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
    JSONRPC_INTERNAL_ERROR,
    JSONRPC_PARSE_ERROR,
    JsonRpcRequest,
    JsonRpcResponse,
    MCP_UNAUTHORIZED,
    makeError
} from '../protocol/jsonrpc';
import { ProtocolHandler } from '../protocol/protocol-handler';
import { MCPClient, MCPServerSettings } from '../types';

const CLIENT_ACTIVITY_TIMEOUT_MS = 5 * 60_000; // 5 minutes is more realistic for SSE clients.
const MAX_REPLAY_BUFFER = 256;

interface SseChannel {
    res: http.ServerResponse;
    /** Buffered events for `Last-Event-ID` resume. */
    buffer: { id: number; event: string; data: string }[];
    nextEventId: number;
    keepAlive: NodeJS.Timeout;
}

interface Session {
    id: string;
    handler: ProtocolHandler;
    sse: SseChannel | null;
    lastActivity: Date;
    userAgent?: string;
}

export interface StreamableHttpServerOptions {
    settings: MCPServerSettings;
    createHandler(sessionId: string): ProtocolHandler;
    onSessionTerminated?(sessionId: string): void;
}

export class StreamableHttpServer {
    private settings: MCPServerSettings;
    private server: http.Server | null = null;
    private sessions = new Map<string, Session>();
    private createHandler: (sessionId: string) => ProtocolHandler;
    private onTerminated?: (sessionId: string) => void;

    constructor(opts: StreamableHttpServerOptions) {
        this.settings = opts.settings;
        this.createHandler = opts.createHandler;
        this.onTerminated = opts.onSessionTerminated;
    }

    public updateSettings(settings: MCPServerSettings): void {
        this.settings = settings;
    }

    public async start(): Promise<void> {
        if (this.server) return;
        this.server = http.createServer((req, res) => this.dispatch(req, res));
        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(this.settings.port, '127.0.0.1', () => resolve());
        });
    }

    public stop(): void {
        if (!this.server) return;
        for (const session of this.sessions.values()) {
            this.closeSse(session, 'server stopping');
            session.handler.cancelAll('server stopping');
        }
        this.sessions.clear();
        this.server.close();
        this.server = null;
    }

    public getClients(): MCPClient[] {
        this.pruneSessions();
        return Array.from(this.sessions.values()).map((s) => ({
            id: s.id,
            lastActivity: s.lastActivity,
            userAgent: s.userAgent
        }));
    }

    public getSessionCount(): number {
        this.pruneSessions();
        return this.sessions.size;
    }

    public getRunning(): boolean {
        return !!this.server;
    }

    public getPort(): number {
        return this.settings.port;
    }

    // -- dispatch --------------------------------------------------------

    private async dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const parsed = url.parse(req.url || '', true);
        const pathname = parsed.pathname;

        // CORS preflight first — never reject before the browser handshake.
        if (req.method === 'OPTIONS') {
            this.writeCors(req, res);
            res.writeHead(204);
            res.end();
            return;
        }

        // A4: Origin + Host allow‑list checks.
        const originError = this.checkOriginAndHost(req);
        if (originError) {
            this.writeCors(req, res);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: originError }));
            return;
        }

        // A5: bearer auth on /mcp.
        if (pathname === '/mcp') {
            const authError = this.checkAuth(req);
            if (authError) {
                this.writeCors(req, res);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(makeError(null, MCP_UNAUTHORIZED, authError)));
                return;
            }
        }

        this.writeCors(req, res);

        try {
            if (pathname === '/health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    name: 'cocos-mcp-server',
                    version: '1.4.0',
                    sessions: this.sessions.size,
                    maxConnections: this.settings.maxConnections,
                    transport: 'streamable-http',
                    auth: this.settings.authToken ? 'bearer' : 'none'
                }));
                return;
            }
            if (pathname !== '/mcp') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            switch (req.method) {
                case 'GET':
                    await this.handleSseOpen(req, res);
                    return;
                case 'POST':
                    await this.handlePost(req, res);
                    return;
                case 'DELETE':
                    this.handleDelete(req, res);
                    return;
                default:
                    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST, DELETE, OPTIONS' });
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
            }
        } catch (e: any) {
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(makeError(null, JSONRPC_INTERNAL_ERROR, e?.message ?? String(e))));
            } catch { /* socket may have been closed */ }
        }
    }

    // -- POST /mcp -------------------------------------------------------

    private async handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await readBody(req);
        let parsed: any;
        try {
            parsed = body.length === 0 ? null : JSON.parse(body);
        } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(makeError(null, JSONRPC_PARSE_ERROR, `Parse error: ${e?.message ?? 'invalid JSON'}`)));
            return;
        }

        // Determine the session. `initialize` requests create a new one if no id was supplied.
        const requestedId = headerString(req, 'mcp-session-id');
        const isInitialize = Array.isArray(parsed)
            ? parsed.some((m: any) => m?.method === 'initialize')
            : parsed?.method === 'initialize';

        let session: Session;
        if (!requestedId && isInitialize) {
            session = this.createSession(req);
        } else if (requestedId && this.sessions.has(requestedId)) {
            session = this.sessions.get(requestedId)!;
            session.lastActivity = new Date();
        } else if (!requestedId && parsed?.method && !isInitialize) {
            // Tolerant fallback: accept first POST without session id by creating one.
            // Spec requires Mcp-Session-Id but many SDK examples elide it.
            session = this.createSession(req);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown Mcp-Session-Id' }));
            return;
        }

        const response = await session.handler.handle(parsed);

        // No response (all notifications) → 202 Accepted, per JSON‑RPC.
        if (!response) {
            res.writeHead(202, { 'Mcp-Session-Id': session.id });
            res.end();
            return;
        }

        const accept = (req.headers['accept'] || '').toString();
        const wantsSse = accept.includes('text/event-stream');

        if (wantsSse) {
            // Stream the response over SSE on this very POST.
            this.writeSseHeaders(res, session.id);
            this.sendSseEvent(res, undefined, 'message', JSON.stringify(response));
            res.end();
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': session.id
        });
        res.end(JSON.stringify(response));
    }

    // -- GET /mcp (open SSE) --------------------------------------------

    private async handleSseOpen(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const accept = (req.headers['accept'] || '').toString();
        if (!accept.includes('text/event-stream') && accept !== '*/*' && accept.length > 0) {
            res.writeHead(406, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Accept: text/event-stream required' }));
            return;
        }
        const sessionId = headerString(req, 'mcp-session-id');
        if (!sessionId || !this.sessions.has(sessionId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown Mcp-Session-Id' }));
            return;
        }
        const session = this.sessions.get(sessionId)!;
        session.lastActivity = new Date();

        // Replace any pre‑existing SSE channel for this session.
        if (session.sse) this.closeSse(session, 'replaced by new SSE');

        this.writeSseHeaders(res, sessionId);

        const channel: SseChannel = {
            res,
            buffer: [],
            nextEventId: 0,
            keepAlive: setInterval(() => {
                try { res.write(': keep-alive\n\n'); } catch { /* ignore */ }
            }, 15_000)
        };
        session.sse = channel;
        session.handler.setNotificationSink((n) => this.deliverNotification(session, n));

        // Resume from Last-Event-ID. We don't persist across reconnects of new
        // SSE channels (the prior channel buffer was wiped on close), but if
        // the client reconnects to the same channel object (rare) replay works.
        const lastEventId = headerString(req, 'last-event-id');
        if (lastEventId) {
            const lastId = Number.parseInt(lastEventId, 10);
            if (Number.isFinite(lastId)) {
                for (const ev of channel.buffer) {
                    if (ev.id > lastId) this.sendSseEvent(res, ev.id, ev.event, ev.data);
                }
            }
        }

        req.on('close', () => {
            this.closeSse(session, 'client closed SSE');
            session.handler.setNotificationSink(null);
        });
    }

    // -- DELETE /mcp -----------------------------------------------------

    private handleDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
        const sessionId = headerString(req, 'mcp-session-id');
        if (!sessionId || !this.sessions.has(sessionId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown Mcp-Session-Id' }));
            return;
        }
        const session = this.sessions.get(sessionId)!;
        this.closeSse(session, 'session terminated by client');
        session.handler.cancelAll('session terminated by client');
        this.sessions.delete(sessionId);
        this.onTerminated?.(sessionId);
        res.writeHead(204);
        res.end();
    }

    // -- helpers ---------------------------------------------------------

    private createSession(req: http.IncomingMessage): Session {
        if (this.settings.maxConnections > 0 && this.sessions.size >= this.settings.maxConnections) {
            // Evict the oldest idle session.
            let oldestKey: string | null = null;
            let oldestTs = Infinity;
            for (const [k, s] of this.sessions) {
                if (s.lastActivity.getTime() < oldestTs) { oldestTs = s.lastActivity.getTime(); oldestKey = k; }
            }
            if (oldestKey) {
                const evicted = this.sessions.get(oldestKey)!;
                this.closeSse(evicted, 'evicted: maxConnections reached');
                evicted.handler.cancelAll('evicted');
                this.sessions.delete(oldestKey);
            }
        }
        const id = uuidv4();
        const session: Session = {
            id,
            handler: this.createHandler(id),
            sse: null,
            lastActivity: new Date(),
            userAgent: (req.headers['user-agent'] as string | undefined) ?? undefined
        };
        this.sessions.set(id, session);
        return session;
    }

    private deliverNotification(session: Session, notification: JsonRpcRequest): void {
        const channel = session.sse;
        if (!channel) return;
        const eventId = channel.nextEventId++;
        const data = JSON.stringify(notification);
        channel.buffer.push({ id: eventId, event: 'message', data });
        if (channel.buffer.length > MAX_REPLAY_BUFFER) channel.buffer.shift();
        this.sendSseEvent(channel.res, eventId, 'message', data);
    }

    private writeSseHeaders(res: http.ServerResponse, sessionId: string): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Mcp-Session-Id': sessionId,
            'X-Accel-Buffering': 'no'
        });
        // Flush headers eagerly so curl/clients show "connected" immediately.
        res.write(': stream opened\n\n');
    }

    private sendSseEvent(res: http.ServerResponse, id: number | undefined, event: string, data: string): void {
        try {
            const lines: string[] = [];
            if (event) lines.push(`event: ${event}`);
            if (id !== undefined) lines.push(`id: ${id}`);
            for (const line of data.split('\n')) lines.push(`data: ${line}`);
            res.write(lines.join('\n') + '\n\n');
        } catch { /* socket closed */ }
    }

    private closeSse(session: Session, _reason: string): void {
        const ch = session.sse;
        if (!ch) return;
        clearInterval(ch.keepAlive);
        try { ch.res.end(); } catch { /* ignore */ }
        session.sse = null;
    }

    private pruneSessions(): void {
        const cutoff = Date.now() - CLIENT_ACTIVITY_TIMEOUT_MS;
        for (const [k, s] of this.sessions) {
            if (!s.sse && s.lastActivity.getTime() < cutoff) {
                s.handler.cancelAll('idle timeout');
                this.sessions.delete(k);
            }
        }
    }

    private checkOriginAndHost(req: http.IncomingMessage): string | null {
        const allowed = this.settings.allowedOrigins ?? ['*'];
        const allowAll = allowed.includes('*');
        const origin = req.headers['origin'];
        if (!allowAll && origin) {
            const originStr = Array.isArray(origin) ? origin[0] : origin;
            if (!allowed.includes(originStr)) {
                return `Origin ${originStr} not allowed`;
            }
        }
        // Host header check — protects against DNS rebinding even when no Origin is sent.
        const host = (req.headers['host'] || '').toString();
        if (host) {
            const hostName = host.split(':')[0];
            const allowedHosts = new Set([
                'localhost', '127.0.0.1', '::1', '[::1]',
                ...(this.settings.allowedHosts ?? [])
            ]);
            if (!allowedHosts.has(hostName) && !allowAll) {
                return `Host ${hostName} not allowed`;
            }
        }
        return null;
    }

    private checkAuth(req: http.IncomingMessage): string | null {
        const token = this.settings.authToken;
        if (!token) return null;
        const auth = (req.headers['authorization'] || '').toString();
        if (!auth.startsWith('Bearer ')) return 'Authorization: ****** required';
        const presented = auth.slice('Bearer '.length).trim();
        // Constant‑time compare to avoid timing leaks.
        if (!constantTimeEqual(presented, token)) return 'Invalid bearer token';
        return null;
    }

    private writeCors(req: http.IncomingMessage, res: http.ServerResponse): void {
        const origin = (req.headers['origin'] as string | undefined) ?? '*';
        const allowed = this.settings.allowedOrigins ?? ['*'];
        const allowAll = allowed.includes('*');
        res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : (allowed.includes(origin) ? origin : 'null'));
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers',
            'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID, Accept');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }
}

// -- helpers --------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (c) => { body += c.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function headerString(req: http.IncomingMessage, name: string): string | undefined {
    const v = req.headers[name];
    if (!v) return undefined;
    return Array.isArray(v) ? v[0] : v;
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
