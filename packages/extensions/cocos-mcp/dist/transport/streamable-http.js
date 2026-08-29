"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamableHttpServer = void 0;
const http = __importStar(require("http"));
const url = __importStar(require("url"));
const uuid_1 = require("uuid");
const jsonrpc_1 = require("../protocol/jsonrpc");
const CLIENT_ACTIVITY_TIMEOUT_MS = 5 * 60000; // 5 minutes is more realistic for SSE clients.
const MAX_REPLAY_BUFFER = 256;
class StreamableHttpServer {
    constructor(opts) {
        this.server = null;
        this.sessions = new Map();
        this.settings = opts.settings;
        this.createHandler = opts.createHandler;
        this.onTerminated = opts.onSessionTerminated;
    }
    updateSettings(settings) {
        this.settings = settings;
    }
    async start() {
        if (this.server)
            return;
        this.server = http.createServer((req, res) => this.dispatch(req, res));
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.settings.port, '127.0.0.1', () => resolve());
        });
    }
    stop() {
        if (!this.server)
            return;
        for (const session of this.sessions.values()) {
            this.closeSse(session, 'server stopping');
            session.handler.cancelAll('server stopping');
        }
        this.sessions.clear();
        this.server.close();
        this.server = null;
    }
    getClients() {
        this.pruneSessions();
        return Array.from(this.sessions.values()).map((s) => ({
            id: s.id,
            lastActivity: s.lastActivity,
            userAgent: s.userAgent
        }));
    }
    getSessionCount() {
        this.pruneSessions();
        return this.sessions.size;
    }
    getRunning() {
        return !!this.server;
    }
    getPort() {
        return this.settings.port;
    }
    // -- dispatch --------------------------------------------------------
    async dispatch(req, res) {
        var _a;
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
                res.end(JSON.stringify((0, jsonrpc_1.makeError)(null, jsonrpc_1.MCP_UNAUTHORIZED, authError)));
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
        }
        catch (e) {
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify((0, jsonrpc_1.makeError)(null, jsonrpc_1.JSONRPC_INTERNAL_ERROR, (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(e))));
            }
            catch ( /* socket may have been closed */_b) { /* socket may have been closed */ }
        }
    }
    // -- POST /mcp -------------------------------------------------------
    async handlePost(req, res) {
        var _a;
        const body = await readBody(req);
        let parsed;
        try {
            parsed = body.length === 0 ? null : JSON.parse(body);
        }
        catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify((0, jsonrpc_1.makeError)(null, jsonrpc_1.JSONRPC_PARSE_ERROR, `Parse error: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : 'invalid JSON'}`)));
            return;
        }
        // Determine the session. `initialize` requests create a new one if no id was supplied.
        const requestedId = headerString(req, 'mcp-session-id');
        const isInitialize = Array.isArray(parsed)
            ? parsed.some((m) => (m === null || m === void 0 ? void 0 : m.method) === 'initialize')
            : (parsed === null || parsed === void 0 ? void 0 : parsed.method) === 'initialize';
        let session;
        if (!requestedId && isInitialize) {
            session = this.createSession(req);
        }
        else if (requestedId && this.sessions.has(requestedId)) {
            session = this.sessions.get(requestedId);
            session.lastActivity = new Date();
        }
        else if (!requestedId && (parsed === null || parsed === void 0 ? void 0 : parsed.method) && !isInitialize) {
            // Tolerant fallback: accept first POST without session id by creating one.
            // Spec requires Mcp-Session-Id but many SDK examples elide it.
            session = this.createSession(req);
        }
        else {
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
    async handleSseOpen(req, res) {
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
        const session = this.sessions.get(sessionId);
        session.lastActivity = new Date();
        // Replace any pre‑existing SSE channel for this session.
        if (session.sse)
            this.closeSse(session, 'replaced by new SSE');
        this.writeSseHeaders(res, sessionId);
        const channel = {
            res,
            buffer: [],
            nextEventId: 0,
            keepAlive: setInterval(() => {
                try {
                    res.write(': keep-alive\n\n');
                }
                catch ( /* ignore */_a) { /* ignore */ }
            }, 15000)
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
                    if (ev.id > lastId)
                        this.sendSseEvent(res, ev.id, ev.event, ev.data);
                }
            }
        }
        req.on('close', () => {
            this.closeSse(session, 'client closed SSE');
            session.handler.setNotificationSink(null);
        });
    }
    // -- DELETE /mcp -----------------------------------------------------
    handleDelete(req, res) {
        var _a;
        const sessionId = headerString(req, 'mcp-session-id');
        if (!sessionId || !this.sessions.has(sessionId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown Mcp-Session-Id' }));
            return;
        }
        const session = this.sessions.get(sessionId);
        this.closeSse(session, 'session terminated by client');
        session.handler.cancelAll('session terminated by client');
        this.sessions.delete(sessionId);
        (_a = this.onTerminated) === null || _a === void 0 ? void 0 : _a.call(this, sessionId);
        res.writeHead(204);
        res.end();
    }
    // -- helpers ---------------------------------------------------------
    createSession(req) {
        var _a;
        if (this.settings.maxConnections > 0 && this.sessions.size >= this.settings.maxConnections) {
            // Evict the oldest idle session.
            let oldestKey = null;
            let oldestTs = Infinity;
            for (const [k, s] of this.sessions) {
                if (s.lastActivity.getTime() < oldestTs) {
                    oldestTs = s.lastActivity.getTime();
                    oldestKey = k;
                }
            }
            if (oldestKey) {
                const evicted = this.sessions.get(oldestKey);
                this.closeSse(evicted, 'evicted: maxConnections reached');
                evicted.handler.cancelAll('evicted');
                this.sessions.delete(oldestKey);
            }
        }
        const id = (0, uuid_1.v4)();
        const session = {
            id,
            handler: this.createHandler(id),
            sse: null,
            lastActivity: new Date(),
            userAgent: (_a = req.headers['user-agent']) !== null && _a !== void 0 ? _a : undefined
        };
        this.sessions.set(id, session);
        return session;
    }
    deliverNotification(session, notification) {
        const channel = session.sse;
        if (!channel)
            return;
        const eventId = channel.nextEventId++;
        const data = JSON.stringify(notification);
        channel.buffer.push({ id: eventId, event: 'message', data });
        if (channel.buffer.length > MAX_REPLAY_BUFFER)
            channel.buffer.shift();
        this.sendSseEvent(channel.res, eventId, 'message', data);
    }
    writeSseHeaders(res, sessionId) {
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
    sendSseEvent(res, id, event, data) {
        try {
            const lines = [];
            if (event)
                lines.push(`event: ${event}`);
            if (id !== undefined)
                lines.push(`id: ${id}`);
            for (const line of data.split('\n'))
                lines.push(`data: ${line}`);
            res.write(lines.join('\n') + '\n\n');
        }
        catch ( /* socket closed */_a) { /* socket closed */ }
    }
    closeSse(session, _reason) {
        const ch = session.sse;
        if (!ch)
            return;
        clearInterval(ch.keepAlive);
        try {
            ch.res.end();
        }
        catch ( /* ignore */_a) { /* ignore */ }
        session.sse = null;
    }
    pruneSessions() {
        const cutoff = Date.now() - CLIENT_ACTIVITY_TIMEOUT_MS;
        for (const [k, s] of this.sessions) {
            if (!s.sse && s.lastActivity.getTime() < cutoff) {
                s.handler.cancelAll('idle timeout');
                this.sessions.delete(k);
            }
        }
    }
    checkOriginAndHost(req) {
        var _a, _b;
        const allowed = (_a = this.settings.allowedOrigins) !== null && _a !== void 0 ? _a : ['*'];
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
                ...((_b = this.settings.allowedHosts) !== null && _b !== void 0 ? _b : [])
            ]);
            if (!allowedHosts.has(hostName) && !allowAll) {
                return `Host ${hostName} not allowed`;
            }
        }
        return null;
    }
    checkAuth(req) {
        const token = this.settings.authToken;
        if (!token)
            return null;
        const auth = (req.headers['authorization'] || '').toString();
        if (!auth.startsWith('Bearer '))
            return 'Authorization: ****** required';
        const presented = auth.slice('Bearer '.length).trim();
        // Constant‑time compare to avoid timing leaks.
        if (!constantTimeEqual(presented, token))
            return 'Invalid bearer token';
        return null;
    }
    writeCors(req, res) {
        var _a, _b;
        const origin = (_a = req.headers['origin']) !== null && _a !== void 0 ? _a : '*';
        const allowed = (_b = this.settings.allowedOrigins) !== null && _b !== void 0 ? _b : ['*'];
        const allowAll = allowed.includes('*');
        res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : (allowed.includes(origin) ? origin : 'null'));
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID, Accept');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }
}
exports.StreamableHttpServer = StreamableHttpServer;
// -- helpers --------------------------------------------------------------
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (c) => { body += c.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
function headerString(req, name) {
    const v = req.headers[name];
    if (!v)
        return undefined;
    return Array.isArray(v) ? v[0] : v;
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RyZWFtYWJsZS1odHRwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc291cmNlL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILDJDQUE2QjtBQUM3Qix5Q0FBMkI7QUFDM0IsK0JBQW9DO0FBQ3BDLGlEQU82QjtBQUk3QixNQUFNLDBCQUEwQixHQUFHLENBQUMsR0FBRyxLQUFNLENBQUMsQ0FBQywrQ0FBK0M7QUFDOUYsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLENBQUM7QUF3QjlCLE1BQWEsb0JBQW9CO0lBTzdCLFlBQVksSUFBaUM7UUFMckMsV0FBTSxHQUF1QixJQUFJLENBQUM7UUFDbEMsYUFBUSxHQUFHLElBQUksR0FBRyxFQUFtQixDQUFDO1FBSzFDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUM7SUFDakQsQ0FBQztJQUVNLGNBQWMsQ0FBQyxRQUEyQjtRQUM3QyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUM3QixDQUFDO0lBRU0sS0FBSyxDQUFDLEtBQUs7UUFDZCxJQUFJLElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTztRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ3ZFLE1BQU0sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDeEMsSUFBSSxDQUFDLE1BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ25DLElBQUksQ0FBQyxNQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVNLElBQUk7UUFDUCxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFPO1FBQ3pCLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzNDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLGlCQUFpQixDQUFDLENBQUM7WUFDMUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNqRCxDQUFDO1FBQ0QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN0QixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3BCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO0lBQ3ZCLENBQUM7SUFFTSxVQUFVO1FBQ2IsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3JCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2xELEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRTtZQUNSLFlBQVksRUFBRSxDQUFDLENBQUMsWUFBWTtZQUM1QixTQUFTLEVBQUUsQ0FBQyxDQUFDLFNBQVM7U0FDekIsQ0FBQyxDQUFDLENBQUM7SUFDUixDQUFDO0lBRU0sZUFBZTtRQUNsQixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDckIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztJQUM5QixDQUFDO0lBRU0sVUFBVTtRQUNiLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDekIsQ0FBQztJQUVNLE9BQU87UUFDVixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQzlCLENBQUM7SUFFRCx1RUFBdUU7SUFFL0QsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUF5QixFQUFFLEdBQXdCOztRQUN0RSxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUM7UUFFakMsb0VBQW9FO1FBQ3BFLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUN6QixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25CLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNWLE9BQU87UUFDWCxDQUFDO1FBRUQsdUNBQXVDO1FBQ3ZDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNqRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDekIsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDaEQsT0FBTztRQUNYLENBQUM7UUFFRCwyQkFBMkI7UUFDM0IsSUFBSSxRQUFRLEtBQUssTUFBTSxFQUFFLENBQUM7WUFDdEIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUN0QyxJQUFJLFNBQVMsRUFBRSxDQUFDO2dCQUNaLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO2dCQUN6QixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7Z0JBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLDBCQUFnQixFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDdEUsT0FBTztZQUNYLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFekIsSUFBSSxDQUFDO1lBQ0QsSUFBSSxRQUFRLEtBQUssU0FBUyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssS0FBSyxFQUFFLENBQUM7Z0JBQ2pELEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixNQUFNLEVBQUUsSUFBSTtvQkFDWixJQUFJLEVBQUUsa0JBQWtCO29CQUN4QixPQUFPLEVBQUUsT0FBTztvQkFDaEIsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSTtvQkFDNUIsY0FBYyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYztvQkFDNUMsU0FBUyxFQUFFLGlCQUFpQjtvQkFDNUIsSUFBSSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU07aUJBQ3BELENBQUMsQ0FBQyxDQUFDO2dCQUNKLE9BQU87WUFDWCxDQUFDO1lBQ0QsSUFBSSxRQUFRLEtBQUssTUFBTSxFQUFFLENBQUM7Z0JBQ3RCLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztnQkFDaEQsT0FBTztZQUNYLENBQUM7WUFFRCxRQUFRLEdBQUcsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakIsS0FBSyxLQUFLO29CQUNOLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQ25DLE9BQU87Z0JBQ1gsS0FBSyxNQUFNO29CQUNQLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQ2hDLE9BQU87Z0JBQ1gsS0FBSyxRQUFRO29CQUNULElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO29CQUM1QixPQUFPO2dCQUNYO29CQUNJLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSw0QkFBNEIsRUFBRSxDQUFDLENBQUM7b0JBQ2hHLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxvQkFBb0IsRUFBRSxDQUFDLENBQUMsQ0FBQztvQkFDekQsT0FBTztZQUNmLENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNkLElBQUksQ0FBQztnQkFDRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7Z0JBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLGdDQUFzQixFQUFFLE1BQUEsQ0FBQyxhQUFELENBQUMsdUJBQUQsQ0FBQyxDQUFFLE9BQU8sbUNBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlGLENBQUM7WUFBQyxRQUFRLGlDQUFpQyxJQUFuQyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQztRQUNqRCxDQUFDO0lBQ0wsQ0FBQztJQUVELHVFQUF1RTtJQUUvRCxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQXlCLEVBQUUsR0FBd0I7O1FBQ3hFLE1BQU0sSUFBSSxHQUFHLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2pDLElBQUksTUFBVyxDQUFDO1FBQ2hCLElBQUksQ0FBQztZQUNELE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3pELENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2QsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLDZCQUFtQixFQUFFLGdCQUFnQixNQUFBLENBQUMsYUFBRCxDQUFDLHVCQUFELENBQUMsQ0FBRSxPQUFPLG1DQUFJLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlHLE9BQU87UUFDWCxDQUFDO1FBRUQsdUZBQXVGO1FBQ3ZGLE1BQU0sV0FBVyxHQUFHLFlBQVksQ0FBQyxHQUFHLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUN4RCxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztZQUN0QyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQSxDQUFDLGFBQUQsQ0FBQyx1QkFBRCxDQUFDLENBQUUsTUFBTSxNQUFLLFlBQVksQ0FBQztZQUNyRCxDQUFDLENBQUMsQ0FBQSxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsTUFBTSxNQUFLLFlBQVksQ0FBQztRQUV0QyxJQUFJLE9BQWdCLENBQUM7UUFDckIsSUFBSSxDQUFDLFdBQVcsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUMvQixPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN0QyxDQUFDO2FBQU0sSUFBSSxXQUFXLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUN2RCxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFFLENBQUM7WUFDMUMsT0FBTyxDQUFDLFlBQVksR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3RDLENBQUM7YUFBTSxJQUFJLENBQUMsV0FBVyxLQUFJLE1BQU0sYUFBTixNQUFNLHVCQUFOLE1BQU0sQ0FBRSxNQUFNLENBQUEsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3pELDJFQUEyRTtZQUMzRSwrREFBK0Q7WUFDL0QsT0FBTyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdEMsQ0FBQzthQUFNLENBQUM7WUFDSixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7WUFDM0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdCQUF3QixFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQzdELE9BQU87UUFDWCxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV0RCxnRUFBZ0U7UUFDaEUsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ1osR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNyRCxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDVixPQUFPO1FBQ1gsQ0FBQztRQUVELE1BQU0sTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUN4RCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFFdEQsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNYLGtEQUFrRDtZQUNsRCxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7WUFDdkUsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ1YsT0FBTztRQUNYLENBQUM7UUFFRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRTtZQUNmLGNBQWMsRUFBRSxrQkFBa0I7WUFDbEMsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLEVBQUU7U0FDL0IsQ0FBQyxDQUFDO1FBQ0gsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVELHNFQUFzRTtJQUU5RCxLQUFLLENBQUMsYUFBYSxDQUFDLEdBQXlCLEVBQUUsR0FBd0I7UUFDM0UsTUFBTSxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3hELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLElBQUksTUFBTSxLQUFLLEtBQUssSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2pGLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztZQUMzRCxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsb0NBQW9DLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDekUsT0FBTztRQUNYLENBQUM7UUFDRCxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFDdEQsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDOUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx3QkFBd0IsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUM3RCxPQUFPO1FBQ1gsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBRSxDQUFDO1FBQzlDLE9BQU8sQ0FBQyxZQUFZLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUVsQyx5REFBeUQ7UUFDekQsSUFBSSxPQUFPLENBQUMsR0FBRztZQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFFL0QsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFFckMsTUFBTSxPQUFPLEdBQWU7WUFDeEIsR0FBRztZQUNILE1BQU0sRUFBRSxFQUFFO1lBQ1YsV0FBVyxFQUFFLENBQUM7WUFDZCxTQUFTLEVBQUUsV0FBVyxDQUFDLEdBQUcsRUFBRTtnQkFDeEIsSUFBSSxDQUFDO29CQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQztnQkFBQyxDQUFDO2dCQUFDLFFBQVEsWUFBWSxJQUFkLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUNqRSxDQUFDLEVBQUUsS0FBTSxDQUFDO1NBQ2IsQ0FBQztRQUNGLE9BQU8sQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDO1FBQ3RCLE9BQU8sQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVqRix1RUFBdUU7UUFDdkUscUVBQXFFO1FBQ3JFLHdFQUF3RTtRQUN4RSxNQUFNLFdBQVcsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBQ3ZELElBQUksV0FBVyxFQUFFLENBQUM7WUFDZCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNoRCxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztnQkFDMUIsS0FBSyxNQUFNLEVBQUUsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQzlCLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxNQUFNO3dCQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3pFLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztRQUVELEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRTtZQUNqQixJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1lBQzVDLE9BQU8sQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDOUMsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsdUVBQXVFO0lBRS9ELFlBQVksQ0FBQyxHQUF5QixFQUFFLEdBQXdCOztRQUNwRSxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFDdEQsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDOUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx3QkFBd0IsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUM3RCxPQUFPO1FBQ1gsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBRSxDQUFDO1FBQzlDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLDhCQUE4QixDQUFDLENBQUM7UUFDdkQsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUMxRCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNoQyxNQUFBLElBQUksQ0FBQyxZQUFZLHFEQUFHLFNBQVMsQ0FBQyxDQUFDO1FBQy9CLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDbkIsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ2QsQ0FBQztJQUVELHVFQUF1RTtJQUUvRCxhQUFhLENBQUMsR0FBeUI7O1FBQzNDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDekYsaUNBQWlDO1lBQ2pDLElBQUksU0FBUyxHQUFrQixJQUFJLENBQUM7WUFDcEMsSUFBSSxRQUFRLEdBQUcsUUFBUSxDQUFDO1lBQ3hCLEtBQUssTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2pDLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsR0FBRyxRQUFRLEVBQUUsQ0FBQztvQkFBQyxRQUFRLEdBQUcsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDO2dCQUFDLENBQUM7WUFDcEcsQ0FBQztZQUNELElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ1osTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFFLENBQUM7Z0JBQzlDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLGlDQUFpQyxDQUFDLENBQUM7Z0JBQzFELE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNyQyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUNwQyxDQUFDO1FBQ0wsQ0FBQztRQUNELE1BQU0sRUFBRSxHQUFHLElBQUEsU0FBTSxHQUFFLENBQUM7UUFDcEIsTUFBTSxPQUFPLEdBQVk7WUFDckIsRUFBRTtZQUNGLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUMvQixHQUFHLEVBQUUsSUFBSTtZQUNULFlBQVksRUFBRSxJQUFJLElBQUksRUFBRTtZQUN4QixTQUFTLEVBQUUsTUFBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBd0IsbUNBQUksU0FBUztTQUM1RSxDQUFDO1FBQ0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQy9CLE9BQU8sT0FBTyxDQUFDO0lBQ25CLENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxPQUFnQixFQUFFLFlBQTRCO1FBQ3RFLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDNUIsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPO1FBQ3JCLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUN0QyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQzFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDN0QsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxpQkFBaUI7WUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3RFLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzdELENBQUM7SUFFTyxlQUFlLENBQUMsR0FBd0IsRUFBRSxTQUFpQjtRQUMvRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRTtZQUNmLGNBQWMsRUFBRSxtQkFBbUI7WUFDbkMsZUFBZSxFQUFFLHdCQUF3QjtZQUN6QyxVQUFVLEVBQUUsWUFBWTtZQUN4QixnQkFBZ0IsRUFBRSxTQUFTO1lBQzNCLG1CQUFtQixFQUFFLElBQUk7U0FDNUIsQ0FBQyxDQUFDO1FBQ0gsc0VBQXNFO1FBQ3RFLEdBQUcsQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRU8sWUFBWSxDQUFDLEdBQXdCLEVBQUUsRUFBc0IsRUFBRSxLQUFhLEVBQUUsSUFBWTtRQUM5RixJQUFJLENBQUM7WUFDRCxNQUFNLEtBQUssR0FBYSxFQUFFLENBQUM7WUFDM0IsSUFBSSxLQUFLO2dCQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ3pDLElBQUksRUFBRSxLQUFLLFNBQVM7Z0JBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDOUMsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNqRSxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUM7UUFDekMsQ0FBQztRQUFDLFFBQVEsbUJBQW1CLElBQXJCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFTyxRQUFRLENBQUMsT0FBZ0IsRUFBRSxPQUFlO1FBQzlDLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDdkIsSUFBSSxDQUFDLEVBQUU7WUFBRSxPQUFPO1FBQ2hCLGFBQWEsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDNUIsSUFBSSxDQUFDO1lBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUFDLENBQUM7UUFBQyxRQUFRLFlBQVksSUFBZCxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDNUMsT0FBTyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUM7SUFDdkIsQ0FBQztJQUVPLGFBQWE7UUFDakIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLDBCQUEwQixDQUFDO1FBQ3ZELEtBQUssTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQztnQkFDOUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLENBQUM7Z0JBQ3BDLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVCLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVPLGtCQUFrQixDQUFDLEdBQXlCOztRQUNoRCxNQUFNLE9BQU8sR0FBRyxNQUFBLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxtQ0FBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3RELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdkMsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNyQyxJQUFJLENBQUMsUUFBUSxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ3RCLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDO1lBQzdELElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQy9CLE9BQU8sVUFBVSxTQUFTLGNBQWMsQ0FBQztZQUM3QyxDQUFDO1FBQ0wsQ0FBQztRQUNELGtGQUFrRjtRQUNsRixNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDcEQsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNQLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDcEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLENBQUM7Z0JBQ3pCLFdBQVcsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLE9BQU87Z0JBQ3hDLEdBQUcsQ0FBQyxNQUFBLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWSxtQ0FBSSxFQUFFLENBQUM7YUFDeEMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDM0MsT0FBTyxRQUFRLFFBQVEsY0FBYyxDQUFDO1lBQzFDLENBQUM7UUFDTCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVPLFNBQVMsQ0FBQyxHQUF5QjtRQUN2QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUN0QyxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sSUFBSSxDQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM3RCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUM7WUFBRSxPQUFPLGdDQUFnQyxDQUFDO1FBQ3pFLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ3RELCtDQUErQztRQUMvQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQztZQUFFLE9BQU8sc0JBQXNCLENBQUM7UUFDeEUsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVPLFNBQVMsQ0FBQyxHQUF5QixFQUFFLEdBQXdCOztRQUNqRSxNQUFNLE1BQU0sR0FBRyxNQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUF3QixtQ0FBSSxHQUFHLENBQUM7UUFDcEUsTUFBTSxPQUFPLEdBQUcsTUFBQSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsbUNBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN0RCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZDLEdBQUcsQ0FBQyxTQUFTLENBQUMsNkJBQTZCLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBQzVHLEdBQUcsQ0FBQyxTQUFTLENBQUMsOEJBQThCLEVBQUUsNEJBQTRCLENBQUMsQ0FBQztRQUM1RSxHQUFHLENBQUMsU0FBUyxDQUFDLDhCQUE4QixFQUN4QyxvRUFBb0UsQ0FBQyxDQUFDO1FBQzFFLEdBQUcsQ0FBQyxTQUFTLENBQUMsK0JBQStCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztJQUNyRSxDQUFDO0NBQ0o7QUE1WUQsb0RBNFlDO0FBRUQsNEVBQTRFO0FBRTVFLFNBQVMsUUFBUSxDQUFDLEdBQXlCO0lBQ3ZDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ2QsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNqRCxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUNuQyxHQUFHLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUM1QixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxHQUF5QixFQUFFLElBQVk7SUFDekQsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QixJQUFJLENBQUMsQ0FBQztRQUFFLE9BQU8sU0FBUyxDQUFDO0lBQ3pCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkMsQ0FBQztBQUVELFNBQVMsaUJBQWlCLENBQUMsQ0FBUyxFQUFFLENBQVM7SUFDM0MsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxNQUFNO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDeEMsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDO0lBQ2IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFO1FBQUUsSUFBSSxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM3RSxPQUFPLElBQUksS0FBSyxDQUFDLENBQUM7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0IOKAlCBNQ1AgMjAyNeKAkTAz4oCRMjYuXHJcbiAqXHJcbiAqIEltcGxlbWVudHM6XHJcbiAqICAgLSBQT1NUIGAvbWNwYCAgICAgICAgICAgOiBjbGllbnQg4oaSIHNlcnZlciBKU09O4oCRUlBDIChyZXNwb25zZSBpcyBlaXRoZXJcclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYXBwbGljYXRpb24vanNvbmAgb3IgYHRleHQvZXZlbnQtc3RyZWFtYFxyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcGVuZGluZyBvbiB0aGUgYEFjY2VwdGAgaGVhZGVyKS5cclxuICogICAtIEdFVCBgL21jcGAgICAgICAgICAgICA6IG9wZW4gYSBzZXJ2ZXIg4oaSIGNsaWVudCBTU0UgY2hhbm5lbC4gU3VwcG9ydHNcclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgTGFzdC1FdmVudC1JRGAgZm9yIHJlc3VtZS5cclxuICogICAtIERFTEVURSBgL21jcGAgICAgICAgICA6IGV4cGxpY2l0IHNlc3Npb24gdGVybWluYXRpb24gKEExIHNwZWMpLlxyXG4gKiAgIC0gYE1jcC1TZXNzaW9uLUlkYCAgICAgIDogYXNzaWduZWQgb24gYGluaXRpYWxpemVgLCBlY2hvZWQgb24gZXZlcnlcclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJzZXF1ZW50IHJlcXVlc3QgZnJvbSB0aGUgc2FtZSBjbGllbnQuXHJcbiAqICAgLSBgT3JpZ2luYCBhbGxvd+KAkWxpc3QgICA6IEROU+KAkXJlYmluZGluZyBtaXRpZ2F0aW9uIChBNCkuXHJcbiAqICAgLSBgSG9zdGAgYWxsb3figJFsaXN0ICAgICA6IGV4dHJhIEROU+KAkXJlYmluZGluZyBtaXRpZ2F0aW9uIChBNCkuXHJcbiAqICAgLSBgQXV0aG9yaXphdGlvbjogKioqKioqYDogb3B0aW9uYWwgc2hhcmVkIHNlY3JldCAoQTUpLlxyXG4gKlxyXG4gKiBFYWNoIHNlc3Npb24gb3ducyBvbmUge0BsaW5rIFByb3RvY29sSGFuZGxlcn0uIEEgc2Vzc2lvbiBjYW4gaGF2ZSBhdCBtb3N0XHJcbiAqIG9uZSBhY3RpdmUgR0VUIChTU0UpIGNoYW5uZWwgYXQgYSB0aW1lIOKAlCByZeKAkW9wZW5pbmcgcmVwbGFjZXMgdGhlIHByaW9yIG9uZS5cclxuICovXHJcblxyXG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ2h0dHAnO1xyXG5pbXBvcnQgKiBhcyB1cmwgZnJvbSAndXJsJztcclxuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSAndXVpZCc7XHJcbmltcG9ydCB7XHJcbiAgICBKU09OUlBDX0lOVEVSTkFMX0VSUk9SLFxyXG4gICAgSlNPTlJQQ19QQVJTRV9FUlJPUixcclxuICAgIEpzb25ScGNSZXF1ZXN0LFxyXG4gICAgSnNvblJwY1Jlc3BvbnNlLFxyXG4gICAgTUNQX1VOQVVUSE9SSVpFRCxcclxuICAgIG1ha2VFcnJvclxyXG59IGZyb20gJy4uL3Byb3RvY29sL2pzb25ycGMnO1xyXG5pbXBvcnQgeyBQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuLi9wcm90b2NvbC9wcm90b2NvbC1oYW5kbGVyJztcclxuaW1wb3J0IHsgTUNQQ2xpZW50LCBNQ1BTZXJ2ZXJTZXR0aW5ncyB9IGZyb20gJy4uL3R5cGVzJztcclxuXHJcbmNvbnN0IENMSUVOVF9BQ1RJVklUWV9USU1FT1VUX01TID0gNSAqIDYwXzAwMDsgLy8gNSBtaW51dGVzIGlzIG1vcmUgcmVhbGlzdGljIGZvciBTU0UgY2xpZW50cy5cclxuY29uc3QgTUFYX1JFUExBWV9CVUZGRVIgPSAyNTY7XHJcblxyXG5pbnRlcmZhY2UgU3NlQ2hhbm5lbCB7XHJcbiAgICByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2U7XHJcbiAgICAvKiogQnVmZmVyZWQgZXZlbnRzIGZvciBgTGFzdC1FdmVudC1JRGAgcmVzdW1lLiAqL1xyXG4gICAgYnVmZmVyOiB7IGlkOiBudW1iZXI7IGV2ZW50OiBzdHJpbmc7IGRhdGE6IHN0cmluZyB9W107XHJcbiAgICBuZXh0RXZlbnRJZDogbnVtYmVyO1xyXG4gICAga2VlcEFsaXZlOiBOb2RlSlMuVGltZW91dDtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNlc3Npb24ge1xyXG4gICAgaWQ6IHN0cmluZztcclxuICAgIGhhbmRsZXI6IFByb3RvY29sSGFuZGxlcjtcclxuICAgIHNzZTogU3NlQ2hhbm5lbCB8IG51bGw7XHJcbiAgICBsYXN0QWN0aXZpdHk6IERhdGU7XHJcbiAgICB1c2VyQWdlbnQ/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3RyZWFtYWJsZUh0dHBTZXJ2ZXJPcHRpb25zIHtcclxuICAgIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcclxuICAgIGNyZWF0ZUhhbmRsZXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm90b2NvbEhhbmRsZXI7XHJcbiAgICBvblNlc3Npb25UZXJtaW5hdGVkPyhzZXNzaW9uSWQ6IHN0cmluZyk6IHZvaWQ7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBTdHJlYW1hYmxlSHR0cFNlcnZlciB7XHJcbiAgICBwcml2YXRlIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcclxuICAgIHByaXZhdGUgc2VydmVyOiBodHRwLlNlcnZlciB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSBzZXNzaW9ucyA9IG5ldyBNYXA8c3RyaW5nLCBTZXNzaW9uPigpO1xyXG4gICAgcHJpdmF0ZSBjcmVhdGVIYW5kbGVyOiAoc2Vzc2lvbklkOiBzdHJpbmcpID0+IFByb3RvY29sSGFuZGxlcjtcclxuICAgIHByaXZhdGUgb25UZXJtaW5hdGVkPzogKHNlc3Npb25JZDogc3RyaW5nKSA9PiB2b2lkO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKG9wdHM6IFN0cmVhbWFibGVIdHRwU2VydmVyT3B0aW9ucykge1xyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBvcHRzLnNldHRpbmdzO1xyXG4gICAgICAgIHRoaXMuY3JlYXRlSGFuZGxlciA9IG9wdHMuY3JlYXRlSGFuZGxlcjtcclxuICAgICAgICB0aGlzLm9uVGVybWluYXRlZCA9IG9wdHMub25TZXNzaW9uVGVybWluYXRlZDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdXBkYXRlU2V0dGluZ3Moc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHNldHRpbmdzO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBpZiAodGhpcy5zZXJ2ZXIpIHJldHVybjtcclxuICAgICAgICB0aGlzLnNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4gdGhpcy5kaXNwYXRjaChyZXEsIHJlcykpO1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIhLm9uY2UoJ2Vycm9yJywgcmVqZWN0KTtcclxuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIhLmxpc3Rlbih0aGlzLnNldHRpbmdzLnBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiByZXNvbHZlKCkpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBzdG9wKCk6IHZvaWQge1xyXG4gICAgICAgIGlmICghdGhpcy5zZXJ2ZXIpIHJldHVybjtcclxuICAgICAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5zZXNzaW9ucy52YWx1ZXMoKSkge1xyXG4gICAgICAgICAgICB0aGlzLmNsb3NlU3NlKHNlc3Npb24sICdzZXJ2ZXIgc3RvcHBpbmcnKTtcclxuICAgICAgICAgICAgc2Vzc2lvbi5oYW5kbGVyLmNhbmNlbEFsbCgnc2VydmVyIHN0b3BwaW5nJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuc2Vzc2lvbnMuY2xlYXIoKTtcclxuICAgICAgICB0aGlzLnNlcnZlci5jbG9zZSgpO1xyXG4gICAgICAgIHRoaXMuc2VydmVyID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0Q2xpZW50cygpOiBNQ1BDbGllbnRbXSB7XHJcbiAgICAgICAgdGhpcy5wcnVuZVNlc3Npb25zKCk7XHJcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5zZXNzaW9ucy52YWx1ZXMoKSkubWFwKChzKSA9PiAoe1xyXG4gICAgICAgICAgICBpZDogcy5pZCxcclxuICAgICAgICAgICAgbGFzdEFjdGl2aXR5OiBzLmxhc3RBY3Rpdml0eSxcclxuICAgICAgICAgICAgdXNlckFnZW50OiBzLnVzZXJBZ2VudFxyXG4gICAgICAgIH0pKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0U2Vzc2lvbkNvdW50KCk6IG51bWJlciB7XHJcbiAgICAgICAgdGhpcy5wcnVuZVNlc3Npb25zKCk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMuc2l6ZTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0UnVubmluZygpOiBib29sZWFuIHtcclxuICAgICAgICByZXR1cm4gISF0aGlzLnNlcnZlcjtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZ2V0UG9ydCgpOiBudW1iZXIge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLnBvcnQ7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gLS0gZGlzcGF0Y2ggLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGRpc3BhdGNoKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHVybC5wYXJzZShyZXEudXJsIHx8ICcnLCB0cnVlKTtcclxuICAgICAgICBjb25zdCBwYXRobmFtZSA9IHBhcnNlZC5wYXRobmFtZTtcclxuXHJcbiAgICAgICAgLy8gQ09SUyBwcmVmbGlnaHQgZmlyc3Qg4oCUIG5ldmVyIHJlamVjdCBiZWZvcmUgdGhlIGJyb3dzZXIgaGFuZHNoYWtlLlxyXG4gICAgICAgIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgICAgICAgdGhpcy53cml0ZUNvcnMocmVxLCByZXMpO1xyXG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDIwNCk7XHJcbiAgICAgICAgICAgIHJlcy5lbmQoKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQTQ6IE9yaWdpbiArIEhvc3QgYWxsb3figJFsaXN0IGNoZWNrcy5cclxuICAgICAgICBjb25zdCBvcmlnaW5FcnJvciA9IHRoaXMuY2hlY2tPcmlnaW5BbmRIb3N0KHJlcSk7XHJcbiAgICAgICAgaWYgKG9yaWdpbkVycm9yKSB7XHJcbiAgICAgICAgICAgIHRoaXMud3JpdGVDb3JzKHJlcSwgcmVzKTtcclxuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDMsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcclxuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBvcmlnaW5FcnJvciB9KSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIEE1OiBiZWFyZXIgYXV0aCBvbiAvbWNwLlxyXG4gICAgICAgIGlmIChwYXRobmFtZSA9PT0gJy9tY3AnKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGF1dGhFcnJvciA9IHRoaXMuY2hlY2tBdXRoKHJlcSk7XHJcbiAgICAgICAgICAgIGlmIChhdXRoRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMud3JpdGVDb3JzKHJlcSwgcmVzKTtcclxuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDAxLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XHJcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KG1ha2VFcnJvcihudWxsLCBNQ1BfVU5BVVRIT1JJWkVELCBhdXRoRXJyb3IpKSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMud3JpdGVDb3JzKHJlcSwgcmVzKTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKHBhdGhuYW1lID09PSAnL2hlYWx0aCcgJiYgcmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcclxuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XHJcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdvaycsXHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2NvY29zLW1jcC1zZXJ2ZXInLFxyXG4gICAgICAgICAgICAgICAgICAgIHZlcnNpb246ICcxLjQuMCcsXHJcbiAgICAgICAgICAgICAgICAgICAgc2Vzc2lvbnM6IHRoaXMuc2Vzc2lvbnMuc2l6ZSxcclxuICAgICAgICAgICAgICAgICAgICBtYXhDb25uZWN0aW9uczogdGhpcy5zZXR0aW5ncy5tYXhDb25uZWN0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICB0cmFuc3BvcnQ6ICdzdHJlYW1hYmxlLWh0dHAnLFxyXG4gICAgICAgICAgICAgICAgICAgIGF1dGg6IHRoaXMuc2V0dGluZ3MuYXV0aFRva2VuID8gJ2JlYXJlcicgOiAnbm9uZSdcclxuICAgICAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAocGF0aG5hbWUgIT09ICcvbWNwJykge1xyXG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcclxuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ05vdCBmb3VuZCcgfSkpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBzd2l0Y2ggKHJlcS5tZXRob2QpIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgJ0dFVCc6XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTc2VPcGVuKHJlcSwgcmVzKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICBjYXNlICdQT1NUJzpcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZVBvc3QocmVxLCByZXMpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIGNhc2UgJ0RFTEVURSc6XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVEZWxldGUocmVxLCByZXMpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDUsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywgQWxsb3c6ICdHRVQsIFBPU1QsIERFTEVURSwgT1BUSU9OUycgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTWV0aG9kIG5vdCBhbGxvd2VkJyB9KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDUwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xyXG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19JTlRFUk5BTF9FUlJPUiwgZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkpKSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggeyAvKiBzb2NrZXQgbWF5IGhhdmUgYmVlbiBjbG9zZWQgKi8gfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyAtLSBQT1NUIC9tY3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlUG9zdChyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEJvZHkocmVxKTtcclxuICAgICAgICBsZXQgcGFyc2VkOiBhbnk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcGFyc2VkID0gYm9keS5sZW5ndGggPT09IDAgPyBudWxsIDogSlNPTi5wYXJzZShib2R5KTtcclxuICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcclxuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcclxuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19QQVJTRV9FUlJPUiwgYFBhcnNlIGVycm9yOiAke2U/Lm1lc3NhZ2UgPz8gJ2ludmFsaWQgSlNPTid9YCkpKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gRGV0ZXJtaW5lIHRoZSBzZXNzaW9uLiBgaW5pdGlhbGl6ZWAgcmVxdWVzdHMgY3JlYXRlIGEgbmV3IG9uZSBpZiBubyBpZCB3YXMgc3VwcGxpZWQuXHJcbiAgICAgICAgY29uc3QgcmVxdWVzdGVkSWQgPSBoZWFkZXJTdHJpbmcocmVxLCAnbWNwLXNlc3Npb24taWQnKTtcclxuICAgICAgICBjb25zdCBpc0luaXRpYWxpemUgPSBBcnJheS5pc0FycmF5KHBhcnNlZClcclxuICAgICAgICAgICAgPyBwYXJzZWQuc29tZSgobTogYW55KSA9PiBtPy5tZXRob2QgPT09ICdpbml0aWFsaXplJylcclxuICAgICAgICAgICAgOiBwYXJzZWQ/Lm1ldGhvZCA9PT0gJ2luaXRpYWxpemUnO1xyXG5cclxuICAgICAgICBsZXQgc2Vzc2lvbjogU2Vzc2lvbjtcclxuICAgICAgICBpZiAoIXJlcXVlc3RlZElkICYmIGlzSW5pdGlhbGl6ZSkge1xyXG4gICAgICAgICAgICBzZXNzaW9uID0gdGhpcy5jcmVhdGVTZXNzaW9uKHJlcSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChyZXF1ZXN0ZWRJZCAmJiB0aGlzLnNlc3Npb25zLmhhcyhyZXF1ZXN0ZWRJZCkpIHtcclxuICAgICAgICAgICAgc2Vzc2lvbiA9IHRoaXMuc2Vzc2lvbnMuZ2V0KHJlcXVlc3RlZElkKSE7XHJcbiAgICAgICAgICAgIHNlc3Npb24ubGFzdEFjdGl2aXR5ID0gbmV3IERhdGUoKTtcclxuICAgICAgICB9IGVsc2UgaWYgKCFyZXF1ZXN0ZWRJZCAmJiBwYXJzZWQ/Lm1ldGhvZCAmJiAhaXNJbml0aWFsaXplKSB7XHJcbiAgICAgICAgICAgIC8vIFRvbGVyYW50IGZhbGxiYWNrOiBhY2NlcHQgZmlyc3QgUE9TVCB3aXRob3V0IHNlc3Npb24gaWQgYnkgY3JlYXRpbmcgb25lLlxyXG4gICAgICAgICAgICAvLyBTcGVjIHJlcXVpcmVzIE1jcC1TZXNzaW9uLUlkIGJ1dCBtYW55IFNESyBleGFtcGxlcyBlbGlkZSBpdC5cclxuICAgICAgICAgICAgc2Vzc2lvbiA9IHRoaXMuY3JlYXRlU2Vzc2lvbihyZXEpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XHJcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1Vua25vd24gTWNwLVNlc3Npb24tSWQnIH0pKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzZXNzaW9uLmhhbmRsZXIuaGFuZGxlKHBhcnNlZCk7XHJcblxyXG4gICAgICAgIC8vIE5vIHJlc3BvbnNlIChhbGwgbm90aWZpY2F0aW9ucykg4oaSIDIwMiBBY2NlcHRlZCwgcGVyIEpTT07igJFSUEMuXHJcbiAgICAgICAgaWYgKCFyZXNwb25zZSkge1xyXG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDIwMiwgeyAnTWNwLVNlc3Npb24tSWQnOiBzZXNzaW9uLmlkIH0pO1xyXG4gICAgICAgICAgICByZXMuZW5kKCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGFjY2VwdCA9IChyZXEuaGVhZGVyc1snYWNjZXB0J10gfHwgJycpLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgY29uc3Qgd2FudHNTc2UgPSBhY2NlcHQuaW5jbHVkZXMoJ3RleHQvZXZlbnQtc3RyZWFtJyk7XHJcblxyXG4gICAgICAgIGlmICh3YW50c1NzZSkge1xyXG4gICAgICAgICAgICAvLyBTdHJlYW0gdGhlIHJlc3BvbnNlIG92ZXIgU1NFIG9uIHRoaXMgdmVyeSBQT1NULlxyXG4gICAgICAgICAgICB0aGlzLndyaXRlU3NlSGVhZGVycyhyZXMsIHNlc3Npb24uaWQpO1xyXG4gICAgICAgICAgICB0aGlzLnNlbmRTc2VFdmVudChyZXMsIHVuZGVmaW5lZCwgJ21lc3NhZ2UnLCBKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xyXG4gICAgICAgICAgICByZXMuZW5kKCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XHJcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAgICdNY3AtU2Vzc2lvbi1JZCc6IHNlc3Npb24uaWRcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gLS0gR0VUIC9tY3AgKG9wZW4gU1NFKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlU3NlT3BlbihyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBjb25zdCBhY2NlcHQgPSAocmVxLmhlYWRlcnNbJ2FjY2VwdCddIHx8ICcnKS50b1N0cmluZygpO1xyXG4gICAgICAgIGlmICghYWNjZXB0LmluY2x1ZGVzKCd0ZXh0L2V2ZW50LXN0cmVhbScpICYmIGFjY2VwdCAhPT0gJyovKicgJiYgYWNjZXB0Lmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDYsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcclxuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnQWNjZXB0OiB0ZXh0L2V2ZW50LXN0cmVhbSByZXF1aXJlZCcgfSkpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHNlc3Npb25JZCA9IGhlYWRlclN0cmluZyhyZXEsICdtY3Atc2Vzc2lvbi1pZCcpO1xyXG4gICAgICAgIGlmICghc2Vzc2lvbklkIHx8ICF0aGlzLnNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSB7XHJcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XHJcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1Vua25vd24gTWNwLVNlc3Npb24tSWQnIH0pKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5zZXNzaW9ucy5nZXQoc2Vzc2lvbklkKSE7XHJcbiAgICAgICAgc2Vzc2lvbi5sYXN0QWN0aXZpdHkgPSBuZXcgRGF0ZSgpO1xyXG5cclxuICAgICAgICAvLyBSZXBsYWNlIGFueSBwcmXigJFleGlzdGluZyBTU0UgY2hhbm5lbCBmb3IgdGhpcyBzZXNzaW9uLlxyXG4gICAgICAgIGlmIChzZXNzaW9uLnNzZSkgdGhpcy5jbG9zZVNzZShzZXNzaW9uLCAncmVwbGFjZWQgYnkgbmV3IFNTRScpO1xyXG5cclxuICAgICAgICB0aGlzLndyaXRlU3NlSGVhZGVycyhyZXMsIHNlc3Npb25JZCk7XHJcblxyXG4gICAgICAgIGNvbnN0IGNoYW5uZWw6IFNzZUNoYW5uZWwgPSB7XHJcbiAgICAgICAgICAgIHJlcyxcclxuICAgICAgICAgICAgYnVmZmVyOiBbXSxcclxuICAgICAgICAgICAgbmV4dEV2ZW50SWQ6IDAsXHJcbiAgICAgICAgICAgIGtlZXBBbGl2ZTogc2V0SW50ZXJ2YWwoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHsgcmVzLndyaXRlKCc6IGtlZXAtYWxpdmVcXG5cXG4nKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XHJcbiAgICAgICAgICAgIH0sIDE1XzAwMClcclxuICAgICAgICB9O1xyXG4gICAgICAgIHNlc3Npb24uc3NlID0gY2hhbm5lbDtcclxuICAgICAgICBzZXNzaW9uLmhhbmRsZXIuc2V0Tm90aWZpY2F0aW9uU2luaygobikgPT4gdGhpcy5kZWxpdmVyTm90aWZpY2F0aW9uKHNlc3Npb24sIG4pKTtcclxuXHJcbiAgICAgICAgLy8gUmVzdW1lIGZyb20gTGFzdC1FdmVudC1JRC4gV2UgZG9uJ3QgcGVyc2lzdCBhY3Jvc3MgcmVjb25uZWN0cyBvZiBuZXdcclxuICAgICAgICAvLyBTU0UgY2hhbm5lbHMgKHRoZSBwcmlvciBjaGFubmVsIGJ1ZmZlciB3YXMgd2lwZWQgb24gY2xvc2UpLCBidXQgaWZcclxuICAgICAgICAvLyB0aGUgY2xpZW50IHJlY29ubmVjdHMgdG8gdGhlIHNhbWUgY2hhbm5lbCBvYmplY3QgKHJhcmUpIHJlcGxheSB3b3Jrcy5cclxuICAgICAgICBjb25zdCBsYXN0RXZlbnRJZCA9IGhlYWRlclN0cmluZyhyZXEsICdsYXN0LWV2ZW50LWlkJyk7XHJcbiAgICAgICAgaWYgKGxhc3RFdmVudElkKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhc3RJZCA9IE51bWJlci5wYXJzZUludChsYXN0RXZlbnRJZCwgMTApO1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKGxhc3RJZCkpIHtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXYgb2YgY2hhbm5lbC5idWZmZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZXYuaWQgPiBsYXN0SWQpIHRoaXMuc2VuZFNzZUV2ZW50KHJlcywgZXYuaWQsIGV2LmV2ZW50LCBldi5kYXRhKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmVxLm9uKCdjbG9zZScsICgpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5jbG9zZVNzZShzZXNzaW9uLCAnY2xpZW50IGNsb3NlZCBTU0UnKTtcclxuICAgICAgICAgICAgc2Vzc2lvbi5oYW5kbGVyLnNldE5vdGlmaWNhdGlvblNpbmsobnVsbCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gLS0gREVMRVRFIC9tY3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBwcml2YXRlIGhhbmRsZURlbGV0ZShyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiB2b2lkIHtcclxuICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSBoZWFkZXJTdHJpbmcocmVxLCAnbWNwLXNlc3Npb24taWQnKTtcclxuICAgICAgICBpZiAoIXNlc3Npb25JZCB8fCAhdGhpcy5zZXNzaW9ucy5oYXMoc2Vzc2lvbklkKSkge1xyXG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xyXG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmtub3duIE1jcC1TZXNzaW9uLUlkJyB9KSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuc2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCkhO1xyXG4gICAgICAgIHRoaXMuY2xvc2VTc2Uoc2Vzc2lvbiwgJ3Nlc3Npb24gdGVybWluYXRlZCBieSBjbGllbnQnKTtcclxuICAgICAgICBzZXNzaW9uLmhhbmRsZXIuY2FuY2VsQWxsKCdzZXNzaW9uIHRlcm1pbmF0ZWQgYnkgY2xpZW50Jyk7XHJcbiAgICAgICAgdGhpcy5zZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKTtcclxuICAgICAgICB0aGlzLm9uVGVybWluYXRlZD8uKHNlc3Npb25JZCk7XHJcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDQpO1xyXG4gICAgICAgIHJlcy5lbmQoKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyAtLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICAgIHByaXZhdGUgY3JlYXRlU2Vzc2lvbihyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlKTogU2Vzc2lvbiB7XHJcbiAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3MubWF4Q29ubmVjdGlvbnMgPiAwICYmIHRoaXMuc2Vzc2lvbnMuc2l6ZSA+PSB0aGlzLnNldHRpbmdzLm1heENvbm5lY3Rpb25zKSB7XHJcbiAgICAgICAgICAgIC8vIEV2aWN0IHRoZSBvbGRlc3QgaWRsZSBzZXNzaW9uLlxyXG4gICAgICAgICAgICBsZXQgb2xkZXN0S2V5OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuICAgICAgICAgICAgbGV0IG9sZGVzdFRzID0gSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgW2ssIHNdIG9mIHRoaXMuc2Vzc2lvbnMpIHtcclxuICAgICAgICAgICAgICAgIGlmIChzLmxhc3RBY3Rpdml0eS5nZXRUaW1lKCkgPCBvbGRlc3RUcykgeyBvbGRlc3RUcyA9IHMubGFzdEFjdGl2aXR5LmdldFRpbWUoKTsgb2xkZXN0S2V5ID0gazsgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChvbGRlc3RLZXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGV2aWN0ZWQgPSB0aGlzLnNlc3Npb25zLmdldChvbGRlc3RLZXkpITtcclxuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2VTc2UoZXZpY3RlZCwgJ2V2aWN0ZWQ6IG1heENvbm5lY3Rpb25zIHJlYWNoZWQnKTtcclxuICAgICAgICAgICAgICAgIGV2aWN0ZWQuaGFuZGxlci5jYW5jZWxBbGwoJ2V2aWN0ZWQnKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKG9sZGVzdEtleSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgaWQgPSB1dWlkdjQoKTtcclxuICAgICAgICBjb25zdCBzZXNzaW9uOiBTZXNzaW9uID0ge1xyXG4gICAgICAgICAgICBpZCxcclxuICAgICAgICAgICAgaGFuZGxlcjogdGhpcy5jcmVhdGVIYW5kbGVyKGlkKSxcclxuICAgICAgICAgICAgc3NlOiBudWxsLFxyXG4gICAgICAgICAgICBsYXN0QWN0aXZpdHk6IG5ldyBEYXRlKCksXHJcbiAgICAgICAgICAgIHVzZXJBZ2VudDogKHJlcS5oZWFkZXJzWyd1c2VyLWFnZW50J10gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/PyB1bmRlZmluZWRcclxuICAgICAgICB9O1xyXG4gICAgICAgIHRoaXMuc2Vzc2lvbnMuc2V0KGlkLCBzZXNzaW9uKTtcclxuICAgICAgICByZXR1cm4gc2Vzc2lvbjtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGRlbGl2ZXJOb3RpZmljYXRpb24oc2Vzc2lvbjogU2Vzc2lvbiwgbm90aWZpY2F0aW9uOiBKc29uUnBjUmVxdWVzdCk6IHZvaWQge1xyXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBzZXNzaW9uLnNzZTtcclxuICAgICAgICBpZiAoIWNoYW5uZWwpIHJldHVybjtcclxuICAgICAgICBjb25zdCBldmVudElkID0gY2hhbm5lbC5uZXh0RXZlbnRJZCsrO1xyXG4gICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnN0cmluZ2lmeShub3RpZmljYXRpb24pO1xyXG4gICAgICAgIGNoYW5uZWwuYnVmZmVyLnB1c2goeyBpZDogZXZlbnRJZCwgZXZlbnQ6ICdtZXNzYWdlJywgZGF0YSB9KTtcclxuICAgICAgICBpZiAoY2hhbm5lbC5idWZmZXIubGVuZ3RoID4gTUFYX1JFUExBWV9CVUZGRVIpIGNoYW5uZWwuYnVmZmVyLnNoaWZ0KCk7XHJcbiAgICAgICAgdGhpcy5zZW5kU3NlRXZlbnQoY2hhbm5lbC5yZXMsIGV2ZW50SWQsICdtZXNzYWdlJywgZGF0YSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB3cml0ZVNzZUhlYWRlcnMocmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLCBzZXNzaW9uSWQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XHJcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAndGV4dC9ldmVudC1zdHJlYW0nLFxyXG4gICAgICAgICAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1jYWNoZSwgbm8tdHJhbnNmb3JtJyxcclxuICAgICAgICAgICAgQ29ubmVjdGlvbjogJ2tlZXAtYWxpdmUnLFxyXG4gICAgICAgICAgICAnTWNwLVNlc3Npb24tSWQnOiBzZXNzaW9uSWQsXHJcbiAgICAgICAgICAgICdYLUFjY2VsLUJ1ZmZlcmluZyc6ICdubydcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBGbHVzaCBoZWFkZXJzIGVhZ2VybHkgc28gY3VybC9jbGllbnRzIHNob3cgXCJjb25uZWN0ZWRcIiBpbW1lZGlhdGVseS5cclxuICAgICAgICByZXMud3JpdGUoJzogc3RyZWFtIG9wZW5lZFxcblxcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgc2VuZFNzZUV2ZW50KHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSwgaWQ6IG51bWJlciB8IHVuZGVmaW5lZCwgZXZlbnQ6IHN0cmluZywgZGF0YTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XHJcbiAgICAgICAgICAgIGlmIChldmVudCkgbGluZXMucHVzaChgZXZlbnQ6ICR7ZXZlbnR9YCk7XHJcbiAgICAgICAgICAgIGlmIChpZCAhPT0gdW5kZWZpbmVkKSBsaW5lcy5wdXNoKGBpZDogJHtpZH1gKTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGRhdGEuc3BsaXQoJ1xcbicpKSBsaW5lcy5wdXNoKGBkYXRhOiAke2xpbmV9YCk7XHJcbiAgICAgICAgICAgIHJlcy53cml0ZShsaW5lcy5qb2luKCdcXG4nKSArICdcXG5cXG4nKTtcclxuICAgICAgICB9IGNhdGNoIHsgLyogc29ja2V0IGNsb3NlZCAqLyB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjbG9zZVNzZShzZXNzaW9uOiBTZXNzaW9uLCBfcmVhc29uOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICBjb25zdCBjaCA9IHNlc3Npb24uc3NlO1xyXG4gICAgICAgIGlmICghY2gpIHJldHVybjtcclxuICAgICAgICBjbGVhckludGVydmFsKGNoLmtlZXBBbGl2ZSk7XHJcbiAgICAgICAgdHJ5IHsgY2gucmVzLmVuZCgpOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cclxuICAgICAgICBzZXNzaW9uLnNzZSA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBwcnVuZVNlc3Npb25zKCk6IHZvaWQge1xyXG4gICAgICAgIGNvbnN0IGN1dG9mZiA9IERhdGUubm93KCkgLSBDTElFTlRfQUNUSVZJVFlfVElNRU9VVF9NUztcclxuICAgICAgICBmb3IgKGNvbnN0IFtrLCBzXSBvZiB0aGlzLnNlc3Npb25zKSB7XHJcbiAgICAgICAgICAgIGlmICghcy5zc2UgJiYgcy5sYXN0QWN0aXZpdHkuZ2V0VGltZSgpIDwgY3V0b2ZmKSB7XHJcbiAgICAgICAgICAgICAgICBzLmhhbmRsZXIuY2FuY2VsQWxsKCdpZGxlIHRpbWVvdXQnKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKGspO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY2hlY2tPcmlnaW5BbmRIb3N0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgICAgICBjb25zdCBhbGxvd2VkID0gdGhpcy5zZXR0aW5ncy5hbGxvd2VkT3JpZ2lucyA/PyBbJyonXTtcclxuICAgICAgICBjb25zdCBhbGxvd0FsbCA9IGFsbG93ZWQuaW5jbHVkZXMoJyonKTtcclxuICAgICAgICBjb25zdCBvcmlnaW4gPSByZXEuaGVhZGVyc1snb3JpZ2luJ107XHJcbiAgICAgICAgaWYgKCFhbGxvd0FsbCAmJiBvcmlnaW4pIHtcclxuICAgICAgICAgICAgY29uc3Qgb3JpZ2luU3RyID0gQXJyYXkuaXNBcnJheShvcmlnaW4pID8gb3JpZ2luWzBdIDogb3JpZ2luO1xyXG4gICAgICAgICAgICBpZiAoIWFsbG93ZWQuaW5jbHVkZXMob3JpZ2luU3RyKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGBPcmlnaW4gJHtvcmlnaW5TdHJ9IG5vdCBhbGxvd2VkYDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBIb3N0IGhlYWRlciBjaGVjayDigJQgcHJvdGVjdHMgYWdhaW5zdCBETlMgcmViaW5kaW5nIGV2ZW4gd2hlbiBubyBPcmlnaW4gaXMgc2VudC5cclxuICAgICAgICBjb25zdCBob3N0ID0gKHJlcS5oZWFkZXJzWydob3N0J10gfHwgJycpLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgaWYgKGhvc3QpIHtcclxuICAgICAgICAgICAgY29uc3QgaG9zdE5hbWUgPSBob3N0LnNwbGl0KCc6JylbMF07XHJcbiAgICAgICAgICAgIGNvbnN0IGFsbG93ZWRIb3N0cyA9IG5ldyBTZXQoW1xyXG4gICAgICAgICAgICAgICAgJ2xvY2FsaG9zdCcsICcxMjcuMC4wLjEnLCAnOjoxJywgJ1s6OjFdJyxcclxuICAgICAgICAgICAgICAgIC4uLih0aGlzLnNldHRpbmdzLmFsbG93ZWRIb3N0cyA/PyBbXSlcclxuICAgICAgICAgICAgXSk7XHJcbiAgICAgICAgICAgIGlmICghYWxsb3dlZEhvc3RzLmhhcyhob3N0TmFtZSkgJiYgIWFsbG93QWxsKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYEhvc3QgJHtob3N0TmFtZX0gbm90IGFsbG93ZWRgO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY2hlY2tBdXRoKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuc2V0dGluZ3MuYXV0aFRva2VuO1xyXG4gICAgICAgIGlmICghdG9rZW4pIHJldHVybiBudWxsO1xyXG4gICAgICAgIGNvbnN0IGF1dGggPSAocmVxLmhlYWRlcnNbJ2F1dGhvcml6YXRpb24nXSB8fCAnJykudG9TdHJpbmcoKTtcclxuICAgICAgICBpZiAoIWF1dGguc3RhcnRzV2l0aCgnQmVhcmVyICcpKSByZXR1cm4gJ0F1dGhvcml6YXRpb246ICoqKioqKiByZXF1aXJlZCc7XHJcbiAgICAgICAgY29uc3QgcHJlc2VudGVkID0gYXV0aC5zbGljZSgnQmVhcmVyICcubGVuZ3RoKS50cmltKCk7XHJcbiAgICAgICAgLy8gQ29uc3RhbnTigJF0aW1lIGNvbXBhcmUgdG8gYXZvaWQgdGltaW5nIGxlYWtzLlxyXG4gICAgICAgIGlmICghY29uc3RhbnRUaW1lRXF1YWwocHJlc2VudGVkLCB0b2tlbikpIHJldHVybiAnSW52YWxpZCBiZWFyZXIgdG9rZW4nO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgd3JpdGVDb3JzKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IHZvaWQge1xyXG4gICAgICAgIGNvbnN0IG9yaWdpbiA9IChyZXEuaGVhZGVyc1snb3JpZ2luJ10gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/PyAnKic7XHJcbiAgICAgICAgY29uc3QgYWxsb3dlZCA9IHRoaXMuc2V0dGluZ3MuYWxsb3dlZE9yaWdpbnMgPz8gWycqJ107XHJcbiAgICAgICAgY29uc3QgYWxsb3dBbGwgPSBhbGxvd2VkLmluY2x1ZGVzKCcqJyk7XHJcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgYWxsb3dBbGwgPyAnKicgOiAoYWxsb3dlZC5pbmNsdWRlcyhvcmlnaW4pID8gb3JpZ2luIDogJ251bGwnKSk7XHJcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsICdHRVQsIFBPU1QsIERFTEVURSwgT1BUSU9OUycpO1xyXG4gICAgICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxyXG4gICAgICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBNY3AtU2Vzc2lvbi1JZCwgTGFzdC1FdmVudC1JRCwgQWNjZXB0Jyk7XHJcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtRXhwb3NlLUhlYWRlcnMnLCAnTWNwLVNlc3Npb24tSWQnKTtcclxuICAgIH1cclxufVxyXG5cclxuLy8gLS0gaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZnVuY3Rpb24gcmVhZEJvZHkocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGxldCBib2R5ID0gJyc7XHJcbiAgICAgICAgcmVxLm9uKCdkYXRhJywgKGMpID0+IHsgYm9keSArPSBjLnRvU3RyaW5nKCk7IH0pO1xyXG4gICAgICAgIHJlcS5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShib2R5KSk7XHJcbiAgICAgICAgcmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGVhZGVyU3RyaW5nKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XHJcbiAgICBjb25zdCB2ID0gcmVxLmhlYWRlcnNbbmFtZV07XHJcbiAgICBpZiAoIXYpIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheSh2KSA/IHZbMF0gOiB2O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb25zdGFudFRpbWVFcXVhbChhOiBzdHJpbmcsIGI6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgbGV0IGRpZmYgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSBkaWZmIHw9IGEuY2hhckNvZGVBdChpKSBeIGIuY2hhckNvZGVBdChpKTtcclxuICAgIHJldHVybiBkaWZmID09PSAwO1xyXG59XHJcbiJdfQ==