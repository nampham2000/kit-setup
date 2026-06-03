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
                res.end(JSON.stringify({ status: 'ok', sessions: this.sessions.size }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RyZWFtYWJsZS1odHRwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc291cmNlL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILDJDQUE2QjtBQUM3Qix5Q0FBMkI7QUFDM0IsK0JBQW9DO0FBQ3BDLGlEQU82QjtBQUk3QixNQUFNLDBCQUEwQixHQUFHLENBQUMsR0FBRyxLQUFNLENBQUMsQ0FBQywrQ0FBK0M7QUFDOUYsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLENBQUM7QUF3QjlCLE1BQWEsb0JBQW9CO0lBTzdCLFlBQVksSUFBaUM7UUFMckMsV0FBTSxHQUF1QixJQUFJLENBQUM7UUFDbEMsYUFBUSxHQUFHLElBQUksR0FBRyxFQUFtQixDQUFDO1FBSzFDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUM7SUFDakQsQ0FBQztJQUVNLGNBQWMsQ0FBQyxRQUEyQjtRQUM3QyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUM3QixDQUFDO0lBRU0sS0FBSyxDQUFDLEtBQUs7UUFDZCxJQUFJLElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTztRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ3ZFLE1BQU0sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDeEMsSUFBSSxDQUFDLE1BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ25DLElBQUksQ0FBQyxNQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVNLElBQUk7UUFDUCxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFPO1FBQ3pCLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzNDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLGlCQUFpQixDQUFDLENBQUM7WUFDMUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNqRCxDQUFDO1FBQ0QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN0QixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3BCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO0lBQ3ZCLENBQUM7SUFFTSxVQUFVO1FBQ2IsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3JCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2xELEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRTtZQUNSLFlBQVksRUFBRSxDQUFDLENBQUMsWUFBWTtZQUM1QixTQUFTLEVBQUUsQ0FBQyxDQUFDLFNBQVM7U0FDekIsQ0FBQyxDQUFDLENBQUM7SUFDUixDQUFDO0lBRU0sZUFBZTtRQUNsQixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDckIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztJQUM5QixDQUFDO0lBRU0sVUFBVTtRQUNiLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDekIsQ0FBQztJQUVNLE9BQU87UUFDVixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQzlCLENBQUM7SUFFRCx1RUFBdUU7SUFFL0QsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUF5QixFQUFFLEdBQXdCOztRQUN0RSxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUM7UUFFakMsb0VBQW9FO1FBQ3BFLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUN6QixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25CLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNWLE9BQU87UUFDWCxDQUFDO1FBRUQsdUNBQXVDO1FBQ3ZDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNqRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDekIsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDaEQsT0FBTztRQUNYLENBQUM7UUFFRCwyQkFBMkI7UUFDM0IsSUFBSSxRQUFRLEtBQUssTUFBTSxFQUFFLENBQUM7WUFDdEIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUN0QyxJQUFJLFNBQVMsRUFBRSxDQUFDO2dCQUNaLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO2dCQUN6QixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7Z0JBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLDBCQUFnQixFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDdEUsT0FBTztZQUNYLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFekIsSUFBSSxDQUFDO1lBQ0QsSUFBSSxRQUFRLEtBQUssU0FBUyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssS0FBSyxFQUFFLENBQUM7Z0JBQ2pELEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQ3hFLE9BQU87WUFDWCxDQUFDO1lBQ0QsSUFBSSxRQUFRLEtBQUssTUFBTSxFQUFFLENBQUM7Z0JBQ3RCLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztnQkFDaEQsT0FBTztZQUNYLENBQUM7WUFFRCxRQUFRLEdBQUcsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakIsS0FBSyxLQUFLO29CQUNOLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQ25DLE9BQU87Z0JBQ1gsS0FBSyxNQUFNO29CQUNQLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQ2hDLE9BQU87Z0JBQ1gsS0FBSyxRQUFRO29CQUNULElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO29CQUM1QixPQUFPO2dCQUNYO29CQUNJLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSw0QkFBNEIsRUFBRSxDQUFDLENBQUM7b0JBQ2hHLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxvQkFBb0IsRUFBRSxDQUFDLENBQUMsQ0FBQztvQkFDekQsT0FBTztZQUNmLENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNkLElBQUksQ0FBQztnQkFDRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7Z0JBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLGdDQUFzQixFQUFFLE1BQUEsQ0FBQyxhQUFELENBQUMsdUJBQUQsQ0FBQyxDQUFFLE9BQU8sbUNBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlGLENBQUM7WUFBQyxRQUFRLGlDQUFpQyxJQUFuQyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQztRQUNqRCxDQUFDO0lBQ0wsQ0FBQztJQUVELHVFQUF1RTtJQUUvRCxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQXlCLEVBQUUsR0FBd0I7O1FBQ3hFLE1BQU0sSUFBSSxHQUFHLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2pDLElBQUksTUFBVyxDQUFDO1FBQ2hCLElBQUksQ0FBQztZQUNELE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3pELENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2QsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFBLG1CQUFTLEVBQUMsSUFBSSxFQUFFLDZCQUFtQixFQUFFLGdCQUFnQixNQUFBLENBQUMsYUFBRCxDQUFDLHVCQUFELENBQUMsQ0FBRSxPQUFPLG1DQUFJLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlHLE9BQU87UUFDWCxDQUFDO1FBRUQsdUZBQXVGO1FBQ3ZGLE1BQU0sV0FBVyxHQUFHLFlBQVksQ0FBQyxHQUFHLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUN4RCxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztZQUN0QyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQSxDQUFDLGFBQUQsQ0FBQyx1QkFBRCxDQUFDLENBQUUsTUFBTSxNQUFLLFlBQVksQ0FBQztZQUNyRCxDQUFDLENBQUMsQ0FBQSxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsTUFBTSxNQUFLLFlBQVksQ0FBQztRQUV0QyxJQUFJLE9BQWdCLENBQUM7UUFDckIsSUFBSSxDQUFDLFdBQVcsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUMvQixPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN0QyxDQUFDO2FBQU0sSUFBSSxXQUFXLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUN2RCxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFFLENBQUM7WUFDMUMsT0FBTyxDQUFDLFlBQVksR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3RDLENBQUM7YUFBTSxJQUFJLENBQUMsV0FBVyxLQUFJLE1BQU0sYUFBTixNQUFNLHVCQUFOLE1BQU0sQ0FBRSxNQUFNLENBQUEsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3pELDJFQUEyRTtZQUMzRSwrREFBK0Q7WUFDL0QsT0FBTyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdEMsQ0FBQzthQUFNLENBQUM7WUFDSixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7WUFDM0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHdCQUF3QixFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQzdELE9BQU87UUFDWCxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV0RCxnRUFBZ0U7UUFDaEUsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ1osR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNyRCxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDVixPQUFPO1FBQ1gsQ0FBQztRQUVELE1BQU0sTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUN4RCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFFdEQsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNYLGtEQUFrRDtZQUNsRCxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7WUFDdkUsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ1YsT0FBTztRQUNYLENBQUM7UUFFRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRTtZQUNmLGNBQWMsRUFBRSxrQkFBa0I7WUFDbEMsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLEVBQUU7U0FDL0IsQ0FBQyxDQUFDO1FBQ0gsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVELHNFQUFzRTtJQUU5RCxLQUFLLENBQUMsYUFBYSxDQUFDLEdBQXlCLEVBQUUsR0FBd0I7UUFDM0UsTUFBTSxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3hELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLElBQUksTUFBTSxLQUFLLEtBQUssSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2pGLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztZQUMzRCxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsb0NBQW9DLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDekUsT0FBTztRQUNYLENBQUM7UUFDRCxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFDdEQsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDOUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx3QkFBd0IsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUM3RCxPQUFPO1FBQ1gsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBRSxDQUFDO1FBQzlDLE9BQU8sQ0FBQyxZQUFZLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUVsQyx5REFBeUQ7UUFDekQsSUFBSSxPQUFPLENBQUMsR0FBRztZQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFFL0QsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFFckMsTUFBTSxPQUFPLEdBQWU7WUFDeEIsR0FBRztZQUNILE1BQU0sRUFBRSxFQUFFO1lBQ1YsV0FBVyxFQUFFLENBQUM7WUFDZCxTQUFTLEVBQUUsV0FBVyxDQUFDLEdBQUcsRUFBRTtnQkFDeEIsSUFBSSxDQUFDO29CQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQztnQkFBQyxDQUFDO2dCQUFDLFFBQVEsWUFBWSxJQUFkLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUNqRSxDQUFDLEVBQUUsS0FBTSxDQUFDO1NBQ2IsQ0FBQztRQUNGLE9BQU8sQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDO1FBQ3RCLE9BQU8sQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVqRix1RUFBdUU7UUFDdkUscUVBQXFFO1FBQ3JFLHdFQUF3RTtRQUN4RSxNQUFNLFdBQVcsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBQ3ZELElBQUksV0FBVyxFQUFFLENBQUM7WUFDZCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNoRCxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztnQkFDMUIsS0FBSyxNQUFNLEVBQUUsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQzlCLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxNQUFNO3dCQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3pFLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztRQUVELEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRTtZQUNqQixJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1lBQzVDLE9BQU8sQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDOUMsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsdUVBQXVFO0lBRS9ELFlBQVksQ0FBQyxHQUF5QixFQUFFLEdBQXdCOztRQUNwRSxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFDdEQsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDOUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1lBQzNELEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSx3QkFBd0IsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUM3RCxPQUFPO1FBQ1gsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBRSxDQUFDO1FBQzlDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLDhCQUE4QixDQUFDLENBQUM7UUFDdkQsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUMxRCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNoQyxNQUFBLElBQUksQ0FBQyxZQUFZLHFEQUFHLFNBQVMsQ0FBQyxDQUFDO1FBQy9CLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDbkIsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ2QsQ0FBQztJQUVELHVFQUF1RTtJQUUvRCxhQUFhLENBQUMsR0FBeUI7O1FBQzNDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDekYsaUNBQWlDO1lBQ2pDLElBQUksU0FBUyxHQUFrQixJQUFJLENBQUM7WUFDcEMsSUFBSSxRQUFRLEdBQUcsUUFBUSxDQUFDO1lBQ3hCLEtBQUssTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2pDLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsR0FBRyxRQUFRLEVBQUUsQ0FBQztvQkFBQyxRQUFRLEdBQUcsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDO2dCQUFDLENBQUM7WUFDcEcsQ0FBQztZQUNELElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ1osTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFFLENBQUM7Z0JBQzlDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLGlDQUFpQyxDQUFDLENBQUM7Z0JBQzFELE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNyQyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUNwQyxDQUFDO1FBQ0wsQ0FBQztRQUNELE1BQU0sRUFBRSxHQUFHLElBQUEsU0FBTSxHQUFFLENBQUM7UUFDcEIsTUFBTSxPQUFPLEdBQVk7WUFDckIsRUFBRTtZQUNGLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUMvQixHQUFHLEVBQUUsSUFBSTtZQUNULFlBQVksRUFBRSxJQUFJLElBQUksRUFBRTtZQUN4QixTQUFTLEVBQUUsTUFBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBd0IsbUNBQUksU0FBUztTQUM1RSxDQUFDO1FBQ0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQy9CLE9BQU8sT0FBTyxDQUFDO0lBQ25CLENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxPQUFnQixFQUFFLFlBQTRCO1FBQ3RFLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDNUIsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPO1FBQ3JCLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUN0QyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQzFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDN0QsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxpQkFBaUI7WUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3RFLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzdELENBQUM7SUFFTyxlQUFlLENBQUMsR0FBd0IsRUFBRSxTQUFpQjtRQUMvRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRTtZQUNmLGNBQWMsRUFBRSxtQkFBbUI7WUFDbkMsZUFBZSxFQUFFLHdCQUF3QjtZQUN6QyxVQUFVLEVBQUUsWUFBWTtZQUN4QixnQkFBZ0IsRUFBRSxTQUFTO1lBQzNCLG1CQUFtQixFQUFFLElBQUk7U0FDNUIsQ0FBQyxDQUFDO1FBQ0gsc0VBQXNFO1FBQ3RFLEdBQUcsQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRU8sWUFBWSxDQUFDLEdBQXdCLEVBQUUsRUFBc0IsRUFBRSxLQUFhLEVBQUUsSUFBWTtRQUM5RixJQUFJLENBQUM7WUFDRCxNQUFNLEtBQUssR0FBYSxFQUFFLENBQUM7WUFDM0IsSUFBSSxLQUFLO2dCQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ3pDLElBQUksRUFBRSxLQUFLLFNBQVM7Z0JBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDOUMsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNqRSxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUM7UUFDekMsQ0FBQztRQUFDLFFBQVEsbUJBQW1CLElBQXJCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFTyxRQUFRLENBQUMsT0FBZ0IsRUFBRSxPQUFlO1FBQzlDLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDdkIsSUFBSSxDQUFDLEVBQUU7WUFBRSxPQUFPO1FBQ2hCLGFBQWEsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDNUIsSUFBSSxDQUFDO1lBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUFDLENBQUM7UUFBQyxRQUFRLFlBQVksSUFBZCxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDNUMsT0FBTyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUM7SUFDdkIsQ0FBQztJQUVPLGFBQWE7UUFDakIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLDBCQUEwQixDQUFDO1FBQ3ZELEtBQUssTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQztnQkFDOUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLENBQUM7Z0JBQ3BDLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVCLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVPLGtCQUFrQixDQUFDLEdBQXlCOztRQUNoRCxNQUFNLE9BQU8sR0FBRyxNQUFBLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxtQ0FBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3RELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdkMsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNyQyxJQUFJLENBQUMsUUFBUSxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ3RCLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDO1lBQzdELElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQy9CLE9BQU8sVUFBVSxTQUFTLGNBQWMsQ0FBQztZQUM3QyxDQUFDO1FBQ0wsQ0FBQztRQUNELGtGQUFrRjtRQUNsRixNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDcEQsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNQLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDcEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLENBQUM7Z0JBQ3pCLFdBQVcsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLE9BQU87Z0JBQ3hDLEdBQUcsQ0FBQyxNQUFBLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWSxtQ0FBSSxFQUFFLENBQUM7YUFDeEMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDM0MsT0FBTyxRQUFRLFFBQVEsY0FBYyxDQUFDO1lBQzFDLENBQUM7UUFDTCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVPLFNBQVMsQ0FBQyxHQUF5QjtRQUN2QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUN0QyxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sSUFBSSxDQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM3RCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUM7WUFBRSxPQUFPLGdDQUFnQyxDQUFDO1FBQ3pFLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ3RELCtDQUErQztRQUMvQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQztZQUFFLE9BQU8sc0JBQXNCLENBQUM7UUFDeEUsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVPLFNBQVMsQ0FBQyxHQUF5QixFQUFFLEdBQXdCOztRQUNqRSxNQUFNLE1BQU0sR0FBRyxNQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUF3QixtQ0FBSSxHQUFHLENBQUM7UUFDcEUsTUFBTSxPQUFPLEdBQUcsTUFBQSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsbUNBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN0RCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZDLEdBQUcsQ0FBQyxTQUFTLENBQUMsNkJBQTZCLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBQzVHLEdBQUcsQ0FBQyxTQUFTLENBQUMsOEJBQThCLEVBQUUsNEJBQTRCLENBQUMsQ0FBQztRQUM1RSxHQUFHLENBQUMsU0FBUyxDQUFDLDhCQUE4QixFQUN4QyxvRUFBb0UsQ0FBQyxDQUFDO1FBQzFFLEdBQUcsQ0FBQyxTQUFTLENBQUMsK0JBQStCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztJQUNyRSxDQUFDO0NBQ0o7QUFwWUQsb0RBb1lDO0FBRUQsNEVBQTRFO0FBRTVFLFNBQVMsUUFBUSxDQUFDLEdBQXlCO0lBQ3ZDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ2QsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNqRCxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUNuQyxHQUFHLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUM1QixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxHQUF5QixFQUFFLElBQVk7SUFDekQsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QixJQUFJLENBQUMsQ0FBQztRQUFFLE9BQU8sU0FBUyxDQUFDO0lBQ3pCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkMsQ0FBQztBQUVELFNBQVMsaUJBQWlCLENBQUMsQ0FBUyxFQUFFLENBQVM7SUFDM0MsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxNQUFNO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDeEMsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDO0lBQ2IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFO1FBQUUsSUFBSSxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM3RSxPQUFPLElBQUksS0FBSyxDQUFDLENBQUM7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RyZWFtYWJsZSBIVFRQIHRyYW5zcG9ydCDigJQgTUNQIDIwMjXigJEwM+KAkTI2LlxuICpcbiAqIEltcGxlbWVudHM6XG4gKiAgIC0gUE9TVCBgL21jcGAgICAgICAgICAgIDogY2xpZW50IOKGkiBzZXJ2ZXIgSlNPTuKAkVJQQyAocmVzcG9uc2UgaXMgZWl0aGVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBhcHBsaWNhdGlvbi9qc29uYCBvciBgdGV4dC9ldmVudC1zdHJlYW1gXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcGVuZGluZyBvbiB0aGUgYEFjY2VwdGAgaGVhZGVyKS5cbiAqICAgLSBHRVQgYC9tY3BgICAgICAgICAgICAgOiBvcGVuIGEgc2VydmVyIOKGkiBjbGllbnQgU1NFIGNoYW5uZWwuIFN1cHBvcnRzXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBMYXN0LUV2ZW50LUlEYCBmb3IgcmVzdW1lLlxuICogICAtIERFTEVURSBgL21jcGAgICAgICAgICA6IGV4cGxpY2l0IHNlc3Npb24gdGVybWluYXRpb24gKEExIHNwZWMpLlxuICogICAtIGBNY3AtU2Vzc2lvbi1JZGAgICAgICA6IGFzc2lnbmVkIG9uIGBpbml0aWFsaXplYCwgZWNob2VkIG9uIGV2ZXJ5XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1YnNlcXVlbnQgcmVxdWVzdCBmcm9tIHRoZSBzYW1lIGNsaWVudC5cbiAqICAgLSBgT3JpZ2luYCBhbGxvd+KAkWxpc3QgICA6IEROU+KAkXJlYmluZGluZyBtaXRpZ2F0aW9uIChBNCkuXG4gKiAgIC0gYEhvc3RgIGFsbG934oCRbGlzdCAgICAgOiBleHRyYSBETlPigJFyZWJpbmRpbmcgbWl0aWdhdGlvbiAoQTQpLlxuICogICAtIGBBdXRob3JpemF0aW9uOiAqKioqKipgOiBvcHRpb25hbCBzaGFyZWQgc2VjcmV0IChBNSkuXG4gKlxuICogRWFjaCBzZXNzaW9uIG93bnMgb25lIHtAbGluayBQcm90b2NvbEhhbmRsZXJ9LiBBIHNlc3Npb24gY2FuIGhhdmUgYXQgbW9zdFxuICogb25lIGFjdGl2ZSBHRVQgKFNTRSkgY2hhbm5lbCBhdCBhIHRpbWUg4oCUIHJl4oCRb3BlbmluZyByZXBsYWNlcyB0aGUgcHJpb3Igb25lLlxuICovXG5cbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnaHR0cCc7XG5pbXBvcnQgKiBhcyB1cmwgZnJvbSAndXJsJztcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHtcbiAgICBKU09OUlBDX0lOVEVSTkFMX0VSUk9SLFxuICAgIEpTT05SUENfUEFSU0VfRVJST1IsXG4gICAgSnNvblJwY1JlcXVlc3QsXG4gICAgSnNvblJwY1Jlc3BvbnNlLFxuICAgIE1DUF9VTkFVVEhPUklaRUQsXG4gICAgbWFrZUVycm9yXG59IGZyb20gJy4uL3Byb3RvY29sL2pzb25ycGMnO1xuaW1wb3J0IHsgUHJvdG9jb2xIYW5kbGVyIH0gZnJvbSAnLi4vcHJvdG9jb2wvcHJvdG9jb2wtaGFuZGxlcic7XG5pbXBvcnQgeyBNQ1BDbGllbnQsIE1DUFNlcnZlclNldHRpbmdzIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG5jb25zdCBDTElFTlRfQUNUSVZJVFlfVElNRU9VVF9NUyA9IDUgKiA2MF8wMDA7IC8vIDUgbWludXRlcyBpcyBtb3JlIHJlYWxpc3RpYyBmb3IgU1NFIGNsaWVudHMuXG5jb25zdCBNQVhfUkVQTEFZX0JVRkZFUiA9IDI1NjtcblxuaW50ZXJmYWNlIFNzZUNoYW5uZWwge1xuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZTtcbiAgICAvKiogQnVmZmVyZWQgZXZlbnRzIGZvciBgTGFzdC1FdmVudC1JRGAgcmVzdW1lLiAqL1xuICAgIGJ1ZmZlcjogeyBpZDogbnVtYmVyOyBldmVudDogc3RyaW5nOyBkYXRhOiBzdHJpbmcgfVtdO1xuICAgIG5leHRFdmVudElkOiBudW1iZXI7XG4gICAga2VlcEFsaXZlOiBOb2RlSlMuVGltZW91dDtcbn1cblxuaW50ZXJmYWNlIFNlc3Npb24ge1xuICAgIGlkOiBzdHJpbmc7XG4gICAgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyO1xuICAgIHNzZTogU3NlQ2hhbm5lbCB8IG51bGw7XG4gICAgbGFzdEFjdGl2aXR5OiBEYXRlO1xuICAgIHVzZXJBZ2VudD86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdHJlYW1hYmxlSHR0cFNlcnZlck9wdGlvbnMge1xuICAgIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcbiAgICBjcmVhdGVIYW5kbGVyKHNlc3Npb25JZDogc3RyaW5nKTogUHJvdG9jb2xIYW5kbGVyO1xuICAgIG9uU2Vzc2lvblRlcm1pbmF0ZWQ/KHNlc3Npb25JZDogc3RyaW5nKTogdm9pZDtcbn1cblxuZXhwb3J0IGNsYXNzIFN0cmVhbWFibGVIdHRwU2VydmVyIHtcbiAgICBwcml2YXRlIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcbiAgICBwcml2YXRlIHNlcnZlcjogaHR0cC5TZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgICBwcml2YXRlIHNlc3Npb25zID0gbmV3IE1hcDxzdHJpbmcsIFNlc3Npb24+KCk7XG4gICAgcHJpdmF0ZSBjcmVhdGVIYW5kbGVyOiAoc2Vzc2lvbklkOiBzdHJpbmcpID0+IFByb3RvY29sSGFuZGxlcjtcbiAgICBwcml2YXRlIG9uVGVybWluYXRlZD86IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZDtcblxuICAgIGNvbnN0cnVjdG9yKG9wdHM6IFN0cmVhbWFibGVIdHRwU2VydmVyT3B0aW9ucykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gb3B0cy5zZXR0aW5ncztcbiAgICAgICAgdGhpcy5jcmVhdGVIYW5kbGVyID0gb3B0cy5jcmVhdGVIYW5kbGVyO1xuICAgICAgICB0aGlzLm9uVGVybWluYXRlZCA9IG9wdHMub25TZXNzaW9uVGVybWluYXRlZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgdXBkYXRlU2V0dGluZ3Moc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzKTogdm9pZCB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBzZXR0aW5ncztcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLnNlcnZlcikgcmV0dXJuO1xuICAgICAgICB0aGlzLnNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4gdGhpcy5kaXNwYXRjaChyZXEsIHJlcykpO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNlcnZlciEub25jZSgnZXJyb3InLCByZWplY3QpO1xuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIhLmxpc3Rlbih0aGlzLnNldHRpbmdzLnBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiByZXNvbHZlKCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc3RvcCgpOiB2b2lkIHtcbiAgICAgICAgaWYgKCF0aGlzLnNlcnZlcikgcmV0dXJuO1xuICAgICAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5zZXNzaW9ucy52YWx1ZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5jbG9zZVNzZShzZXNzaW9uLCAnc2VydmVyIHN0b3BwaW5nJyk7XG4gICAgICAgICAgICBzZXNzaW9uLmhhbmRsZXIuY2FuY2VsQWxsKCdzZXJ2ZXIgc3RvcHBpbmcnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnNlc3Npb25zLmNsZWFyKCk7XG4gICAgICAgIHRoaXMuc2VydmVyLmNsb3NlKCk7XG4gICAgICAgIHRoaXMuc2VydmVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q2xpZW50cygpOiBNQ1BDbGllbnRbXSB7XG4gICAgICAgIHRoaXMucHJ1bmVTZXNzaW9ucygpO1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnNlc3Npb25zLnZhbHVlcygpKS5tYXAoKHMpID0+ICh7XG4gICAgICAgICAgICBpZDogcy5pZCxcbiAgICAgICAgICAgIGxhc3RBY3Rpdml0eTogcy5sYXN0QWN0aXZpdHksXG4gICAgICAgICAgICB1c2VyQWdlbnQ6IHMudXNlckFnZW50XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0U2Vzc2lvbkNvdW50KCk6IG51bWJlciB7XG4gICAgICAgIHRoaXMucHJ1bmVTZXNzaW9ucygpO1xuICAgICAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5zaXplO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRSdW5uaW5nKCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gISF0aGlzLnNlcnZlcjtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0UG9ydCgpOiBudW1iZXIge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXR0aW5ncy5wb3J0O1xuICAgIH1cblxuICAgIC8vIC0tIGRpc3BhdGNoIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGFzeW5jIGRpc3BhdGNoKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSB1cmwucGFyc2UocmVxLnVybCB8fCAnJywgdHJ1ZSk7XG4gICAgICAgIGNvbnN0IHBhdGhuYW1lID0gcGFyc2VkLnBhdGhuYW1lO1xuXG4gICAgICAgIC8vIENPUlMgcHJlZmxpZ2h0IGZpcnN0IOKAlCBuZXZlciByZWplY3QgYmVmb3JlIHRoZSBicm93c2VyIGhhbmRzaGFrZS5cbiAgICAgICAgaWYgKHJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgICAgICAgdGhpcy53cml0ZUNvcnMocmVxLCByZXMpO1xuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDQpO1xuICAgICAgICAgICAgcmVzLmVuZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQTQ6IE9yaWdpbiArIEhvc3QgYWxsb3figJFsaXN0IGNoZWNrcy5cbiAgICAgICAgY29uc3Qgb3JpZ2luRXJyb3IgPSB0aGlzLmNoZWNrT3JpZ2luQW5kSG9zdChyZXEpO1xuICAgICAgICBpZiAob3JpZ2luRXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMud3JpdGVDb3JzKHJlcSwgcmVzKTtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDAzLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IG9yaWdpbkVycm9yIH0pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEE1OiBiZWFyZXIgYXV0aCBvbiAvbWNwLlxuICAgICAgICBpZiAocGF0aG5hbWUgPT09ICcvbWNwJykge1xuICAgICAgICAgICAgY29uc3QgYXV0aEVycm9yID0gdGhpcy5jaGVja0F1dGgocmVxKTtcbiAgICAgICAgICAgIGlmIChhdXRoRXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aGlzLndyaXRlQ29ycyhyZXEsIHJlcyk7XG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDEsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KG1ha2VFcnJvcihudWxsLCBNQ1BfVU5BVVRIT1JJWkVELCBhdXRoRXJyb3IpKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy53cml0ZUNvcnMocmVxLCByZXMpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAocGF0aG5hbWUgPT09ICcvaGVhbHRoJyAmJiByZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IHN0YXR1czogJ29rJywgc2Vzc2lvbnM6IHRoaXMuc2Vzc2lvbnMuc2l6ZSB9KSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHBhdGhuYW1lICE9PSAnL21jcCcpIHtcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ05vdCBmb3VuZCcgfSkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc3dpdGNoIChyZXEubWV0aG9kKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAnR0VUJzpcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTc2VPcGVuKHJlcSwgcmVzKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIGNhc2UgJ1BPU1QnOlxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZVBvc3QocmVxLCByZXMpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgY2FzZSAnREVMRVRFJzpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVEZWxldGUocmVxLCByZXMpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDUsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywgQWxsb3c6ICdHRVQsIFBPU1QsIERFTEVURSwgT1BUSU9OUycgfSk7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01ldGhvZCBub3QgYWxsb3dlZCcgfSkpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDUwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkobWFrZUVycm9yKG51bGwsIEpTT05SUENfSU5URVJOQUxfRVJST1IsIGU/Lm1lc3NhZ2UgPz8gU3RyaW5nKGUpKSkpO1xuICAgICAgICAgICAgfSBjYXRjaCB7IC8qIHNvY2tldCBtYXkgaGF2ZSBiZWVuIGNsb3NlZCAqLyB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLSBQT1NUIC9tY3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVQb3N0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEJvZHkocmVxKTtcbiAgICAgICAgbGV0IHBhcnNlZDogYW55O1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcGFyc2VkID0gYm9keS5sZW5ndGggPT09IDAgPyBudWxsIDogSlNPTi5wYXJzZShib2R5KTtcbiAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19QQVJTRV9FUlJPUiwgYFBhcnNlIGVycm9yOiAke2U/Lm1lc3NhZ2UgPz8gJ2ludmFsaWQgSlNPTid9YCkpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERldGVybWluZSB0aGUgc2Vzc2lvbi4gYGluaXRpYWxpemVgIHJlcXVlc3RzIGNyZWF0ZSBhIG5ldyBvbmUgaWYgbm8gaWQgd2FzIHN1cHBsaWVkLlxuICAgICAgICBjb25zdCByZXF1ZXN0ZWRJZCA9IGhlYWRlclN0cmluZyhyZXEsICdtY3Atc2Vzc2lvbi1pZCcpO1xuICAgICAgICBjb25zdCBpc0luaXRpYWxpemUgPSBBcnJheS5pc0FycmF5KHBhcnNlZClcbiAgICAgICAgICAgID8gcGFyc2VkLnNvbWUoKG06IGFueSkgPT4gbT8ubWV0aG9kID09PSAnaW5pdGlhbGl6ZScpXG4gICAgICAgICAgICA6IHBhcnNlZD8ubWV0aG9kID09PSAnaW5pdGlhbGl6ZSc7XG5cbiAgICAgICAgbGV0IHNlc3Npb246IFNlc3Npb247XG4gICAgICAgIGlmICghcmVxdWVzdGVkSWQgJiYgaXNJbml0aWFsaXplKSB7XG4gICAgICAgICAgICBzZXNzaW9uID0gdGhpcy5jcmVhdGVTZXNzaW9uKHJlcSk7XG4gICAgICAgIH0gZWxzZSBpZiAocmVxdWVzdGVkSWQgJiYgdGhpcy5zZXNzaW9ucy5oYXMocmVxdWVzdGVkSWQpKSB7XG4gICAgICAgICAgICBzZXNzaW9uID0gdGhpcy5zZXNzaW9ucy5nZXQocmVxdWVzdGVkSWQpITtcbiAgICAgICAgICAgIHNlc3Npb24ubGFzdEFjdGl2aXR5ID0gbmV3IERhdGUoKTtcbiAgICAgICAgfSBlbHNlIGlmICghcmVxdWVzdGVkSWQgJiYgcGFyc2VkPy5tZXRob2QgJiYgIWlzSW5pdGlhbGl6ZSkge1xuICAgICAgICAgICAgLy8gVG9sZXJhbnQgZmFsbGJhY2s6IGFjY2VwdCBmaXJzdCBQT1NUIHdpdGhvdXQgc2Vzc2lvbiBpZCBieSBjcmVhdGluZyBvbmUuXG4gICAgICAgICAgICAvLyBTcGVjIHJlcXVpcmVzIE1jcC1TZXNzaW9uLUlkIGJ1dCBtYW55IFNESyBleGFtcGxlcyBlbGlkZSBpdC5cbiAgICAgICAgICAgIHNlc3Npb24gPSB0aGlzLmNyZWF0ZVNlc3Npb24ocmVxKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmtub3duIE1jcC1TZXNzaW9uLUlkJyB9KSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHNlc3Npb24uaGFuZGxlci5oYW5kbGUocGFyc2VkKTtcblxuICAgICAgICAvLyBObyByZXNwb25zZSAoYWxsIG5vdGlmaWNhdGlvbnMpIOKGkiAyMDIgQWNjZXB0ZWQsIHBlciBKU09O4oCRUlBDLlxuICAgICAgICBpZiAoIXJlc3BvbnNlKSB7XG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDIwMiwgeyAnTWNwLVNlc3Npb24tSWQnOiBzZXNzaW9uLmlkIH0pO1xuICAgICAgICAgICAgcmVzLmVuZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWNjZXB0ID0gKHJlcS5oZWFkZXJzWydhY2NlcHQnXSB8fCAnJykudG9TdHJpbmcoKTtcbiAgICAgICAgY29uc3Qgd2FudHNTc2UgPSBhY2NlcHQuaW5jbHVkZXMoJ3RleHQvZXZlbnQtc3RyZWFtJyk7XG5cbiAgICAgICAgaWYgKHdhbnRzU3NlKSB7XG4gICAgICAgICAgICAvLyBTdHJlYW0gdGhlIHJlc3BvbnNlIG92ZXIgU1NFIG9uIHRoaXMgdmVyeSBQT1NULlxuICAgICAgICAgICAgdGhpcy53cml0ZVNzZUhlYWRlcnMocmVzLCBzZXNzaW9uLmlkKTtcbiAgICAgICAgICAgIHRoaXMuc2VuZFNzZUV2ZW50KHJlcywgdW5kZWZpbmVkLCAnbWVzc2FnZScsIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgICAgICByZXMuZW5kKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwge1xuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICdNY3AtU2Vzc2lvbi1JZCc6IHNlc3Npb24uaWRcbiAgICAgICAgfSk7XG4gICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICB9XG5cbiAgICAvLyAtLSBHRVQgL21jcCAob3BlbiBTU0UpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVNzZU9wZW4ocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSwgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGFjY2VwdCA9IChyZXEuaGVhZGVyc1snYWNjZXB0J10gfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICAgIGlmICghYWNjZXB0LmluY2x1ZGVzKCd0ZXh0L2V2ZW50LXN0cmVhbScpICYmIGFjY2VwdCAhPT0gJyovKicgJiYgYWNjZXB0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA2LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdBY2NlcHQ6IHRleHQvZXZlbnQtc3RyZWFtIHJlcXVpcmVkJyB9KSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2Vzc2lvbklkID0gaGVhZGVyU3RyaW5nKHJlcSwgJ21jcC1zZXNzaW9uLWlkJyk7XG4gICAgICAgIGlmICghc2Vzc2lvbklkIHx8ICF0aGlzLnNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSB7XG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5rbm93biBNY3AtU2Vzc2lvbi1JZCcgfSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLnNlc3Npb25zLmdldChzZXNzaW9uSWQpITtcbiAgICAgICAgc2Vzc2lvbi5sYXN0QWN0aXZpdHkgPSBuZXcgRGF0ZSgpO1xuXG4gICAgICAgIC8vIFJlcGxhY2UgYW55IHByZeKAkWV4aXN0aW5nIFNTRSBjaGFubmVsIGZvciB0aGlzIHNlc3Npb24uXG4gICAgICAgIGlmIChzZXNzaW9uLnNzZSkgdGhpcy5jbG9zZVNzZShzZXNzaW9uLCAncmVwbGFjZWQgYnkgbmV3IFNTRScpO1xuXG4gICAgICAgIHRoaXMud3JpdGVTc2VIZWFkZXJzKHJlcywgc2Vzc2lvbklkKTtcblxuICAgICAgICBjb25zdCBjaGFubmVsOiBTc2VDaGFubmVsID0ge1xuICAgICAgICAgICAgcmVzLFxuICAgICAgICAgICAgYnVmZmVyOiBbXSxcbiAgICAgICAgICAgIG5leHRFdmVudElkOiAwLFxuICAgICAgICAgICAga2VlcEFsaXZlOiBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHsgcmVzLndyaXRlKCc6IGtlZXAtYWxpdmVcXG5cXG4nKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG4gICAgICAgICAgICB9LCAxNV8wMDApXG4gICAgICAgIH07XG4gICAgICAgIHNlc3Npb24uc3NlID0gY2hhbm5lbDtcbiAgICAgICAgc2Vzc2lvbi5oYW5kbGVyLnNldE5vdGlmaWNhdGlvblNpbmsoKG4pID0+IHRoaXMuZGVsaXZlck5vdGlmaWNhdGlvbihzZXNzaW9uLCBuKSk7XG5cbiAgICAgICAgLy8gUmVzdW1lIGZyb20gTGFzdC1FdmVudC1JRC4gV2UgZG9uJ3QgcGVyc2lzdCBhY3Jvc3MgcmVjb25uZWN0cyBvZiBuZXdcbiAgICAgICAgLy8gU1NFIGNoYW5uZWxzICh0aGUgcHJpb3IgY2hhbm5lbCBidWZmZXIgd2FzIHdpcGVkIG9uIGNsb3NlKSwgYnV0IGlmXG4gICAgICAgIC8vIHRoZSBjbGllbnQgcmVjb25uZWN0cyB0byB0aGUgc2FtZSBjaGFubmVsIG9iamVjdCAocmFyZSkgcmVwbGF5IHdvcmtzLlxuICAgICAgICBjb25zdCBsYXN0RXZlbnRJZCA9IGhlYWRlclN0cmluZyhyZXEsICdsYXN0LWV2ZW50LWlkJyk7XG4gICAgICAgIGlmIChsYXN0RXZlbnRJZCkge1xuICAgICAgICAgICAgY29uc3QgbGFzdElkID0gTnVtYmVyLnBhcnNlSW50KGxhc3RFdmVudElkLCAxMCk7XG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKGxhc3RJZCkpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV2IG9mIGNoYW5uZWwuYnVmZmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChldi5pZCA+IGxhc3RJZCkgdGhpcy5zZW5kU3NlRXZlbnQocmVzLCBldi5pZCwgZXYuZXZlbnQsIGV2LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJlcS5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlU3NlKHNlc3Npb24sICdjbGllbnQgY2xvc2VkIFNTRScpO1xuICAgICAgICAgICAgc2Vzc2lvbi5oYW5kbGVyLnNldE5vdGlmaWNhdGlvblNpbmsobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tIERFTEVURSAvbWNwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGhhbmRsZURlbGV0ZShyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiB2b2lkIHtcbiAgICAgICAgY29uc3Qgc2Vzc2lvbklkID0gaGVhZGVyU3RyaW5nKHJlcSwgJ21jcC1zZXNzaW9uLWlkJyk7XG4gICAgICAgIGlmICghc2Vzc2lvbklkIHx8ICF0aGlzLnNlc3Npb25zLmhhcyhzZXNzaW9uSWQpKSB7XG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5rbm93biBNY3AtU2Vzc2lvbi1JZCcgfSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLnNlc3Npb25zLmdldChzZXNzaW9uSWQpITtcbiAgICAgICAgdGhpcy5jbG9zZVNzZShzZXNzaW9uLCAnc2Vzc2lvbiB0ZXJtaW5hdGVkIGJ5IGNsaWVudCcpO1xuICAgICAgICBzZXNzaW9uLmhhbmRsZXIuY2FuY2VsQWxsKCdzZXNzaW9uIHRlcm1pbmF0ZWQgYnkgY2xpZW50Jyk7XG4gICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZCk7XG4gICAgICAgIHRoaXMub25UZXJtaW5hdGVkPy4oc2Vzc2lvbklkKTtcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDQpO1xuICAgICAgICByZXMuZW5kKCk7XG4gICAgfVxuXG4gICAgLy8gLS0gaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAgIHByaXZhdGUgY3JlYXRlU2Vzc2lvbihyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlKTogU2Vzc2lvbiB7XG4gICAgICAgIGlmICh0aGlzLnNldHRpbmdzLm1heENvbm5lY3Rpb25zID4gMCAmJiB0aGlzLnNlc3Npb25zLnNpemUgPj0gdGhpcy5zZXR0aW5ncy5tYXhDb25uZWN0aW9ucykge1xuICAgICAgICAgICAgLy8gRXZpY3QgdGhlIG9sZGVzdCBpZGxlIHNlc3Npb24uXG4gICAgICAgICAgICBsZXQgb2xkZXN0S2V5OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgICAgICAgIGxldCBvbGRlc3RUcyA9IEluZmluaXR5O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbaywgc10gb2YgdGhpcy5zZXNzaW9ucykge1xuICAgICAgICAgICAgICAgIGlmIChzLmxhc3RBY3Rpdml0eS5nZXRUaW1lKCkgPCBvbGRlc3RUcykgeyBvbGRlc3RUcyA9IHMubGFzdEFjdGl2aXR5LmdldFRpbWUoKTsgb2xkZXN0S2V5ID0gazsgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG9sZGVzdEtleSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGV2aWN0ZWQgPSB0aGlzLnNlc3Npb25zLmdldChvbGRlc3RLZXkpITtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlU3NlKGV2aWN0ZWQsICdldmljdGVkOiBtYXhDb25uZWN0aW9ucyByZWFjaGVkJyk7XG4gICAgICAgICAgICAgICAgZXZpY3RlZC5oYW5kbGVyLmNhbmNlbEFsbCgnZXZpY3RlZCcpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKG9sZGVzdEtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaWQgPSB1dWlkdjQoKTtcbiAgICAgICAgY29uc3Qgc2Vzc2lvbjogU2Vzc2lvbiA9IHtcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgaGFuZGxlcjogdGhpcy5jcmVhdGVIYW5kbGVyKGlkKSxcbiAgICAgICAgICAgIHNzZTogbnVsbCxcbiAgICAgICAgICAgIGxhc3RBY3Rpdml0eTogbmV3IERhdGUoKSxcbiAgICAgICAgICAgIHVzZXJBZ2VudDogKHJlcS5oZWFkZXJzWyd1c2VyLWFnZW50J10gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/PyB1bmRlZmluZWRcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5zZXNzaW9ucy5zZXQoaWQsIHNlc3Npb24pO1xuICAgICAgICByZXR1cm4gc2Vzc2lvbjtcbiAgICB9XG5cbiAgICBwcml2YXRlIGRlbGl2ZXJOb3RpZmljYXRpb24oc2Vzc2lvbjogU2Vzc2lvbiwgbm90aWZpY2F0aW9uOiBKc29uUnBjUmVxdWVzdCk6IHZvaWQge1xuICAgICAgICBjb25zdCBjaGFubmVsID0gc2Vzc2lvbi5zc2U7XG4gICAgICAgIGlmICghY2hhbm5lbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBldmVudElkID0gY2hhbm5lbC5uZXh0RXZlbnRJZCsrO1xuICAgICAgICBjb25zdCBkYXRhID0gSlNPTi5zdHJpbmdpZnkobm90aWZpY2F0aW9uKTtcbiAgICAgICAgY2hhbm5lbC5idWZmZXIucHVzaCh7IGlkOiBldmVudElkLCBldmVudDogJ21lc3NhZ2UnLCBkYXRhIH0pO1xuICAgICAgICBpZiAoY2hhbm5lbC5idWZmZXIubGVuZ3RoID4gTUFYX1JFUExBWV9CVUZGRVIpIGNoYW5uZWwuYnVmZmVyLnNoaWZ0KCk7XG4gICAgICAgIHRoaXMuc2VuZFNzZUV2ZW50KGNoYW5uZWwucmVzLCBldmVudElkLCAnbWVzc2FnZScsIGRhdGEpO1xuICAgIH1cblxuICAgIHByaXZhdGUgd3JpdGVTc2VIZWFkZXJzKHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSwgc2Vzc2lvbklkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHtcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAndGV4dC9ldmVudC1zdHJlYW0nLFxuICAgICAgICAgICAgJ0NhY2hlLUNvbnRyb2wnOiAnbm8tY2FjaGUsIG5vLXRyYW5zZm9ybScsXG4gICAgICAgICAgICBDb25uZWN0aW9uOiAna2VlcC1hbGl2ZScsXG4gICAgICAgICAgICAnTWNwLVNlc3Npb24tSWQnOiBzZXNzaW9uSWQsXG4gICAgICAgICAgICAnWC1BY2NlbC1CdWZmZXJpbmcnOiAnbm8nXG4gICAgICAgIH0pO1xuICAgICAgICAvLyBGbHVzaCBoZWFkZXJzIGVhZ2VybHkgc28gY3VybC9jbGllbnRzIHNob3cgXCJjb25uZWN0ZWRcIiBpbW1lZGlhdGVseS5cbiAgICAgICAgcmVzLndyaXRlKCc6IHN0cmVhbSBvcGVuZWRcXG5cXG4nKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNlbmRTc2VFdmVudChyZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UsIGlkOiBudW1iZXIgfCB1bmRlZmluZWQsIGV2ZW50OiBzdHJpbmcsIGRhdGE6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gICAgICAgICAgICBpZiAoZXZlbnQpIGxpbmVzLnB1c2goYGV2ZW50OiAke2V2ZW50fWApO1xuICAgICAgICAgICAgaWYgKGlkICE9PSB1bmRlZmluZWQpIGxpbmVzLnB1c2goYGlkOiAke2lkfWApO1xuICAgICAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGRhdGEuc3BsaXQoJ1xcbicpKSBsaW5lcy5wdXNoKGBkYXRhOiAke2xpbmV9YCk7XG4gICAgICAgICAgICByZXMud3JpdGUobGluZXMuam9pbignXFxuJykgKyAnXFxuXFxuJyk7XG4gICAgICAgIH0gY2F0Y2ggeyAvKiBzb2NrZXQgY2xvc2VkICovIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNsb3NlU3NlKHNlc3Npb246IFNlc3Npb24sIF9yZWFzb246IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBjaCA9IHNlc3Npb24uc3NlO1xuICAgICAgICBpZiAoIWNoKSByZXR1cm47XG4gICAgICAgIGNsZWFySW50ZXJ2YWwoY2gua2VlcEFsaXZlKTtcbiAgICAgICAgdHJ5IHsgY2gucmVzLmVuZCgpOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cbiAgICAgICAgc2Vzc2lvbi5zc2UgPSBudWxsO1xuICAgIH1cblxuICAgIHByaXZhdGUgcHJ1bmVTZXNzaW9ucygpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY3V0b2ZmID0gRGF0ZS5ub3coKSAtIENMSUVOVF9BQ1RJVklUWV9USU1FT1VUX01TO1xuICAgICAgICBmb3IgKGNvbnN0IFtrLCBzXSBvZiB0aGlzLnNlc3Npb25zKSB7XG4gICAgICAgICAgICBpZiAoIXMuc3NlICYmIHMubGFzdEFjdGl2aXR5LmdldFRpbWUoKSA8IGN1dG9mZikge1xuICAgICAgICAgICAgICAgIHMuaGFuZGxlci5jYW5jZWxBbGwoJ2lkbGUgdGltZW91dCcpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKGspO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjaGVja09yaWdpbkFuZEhvc3QocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICBjb25zdCBhbGxvd2VkID0gdGhpcy5zZXR0aW5ncy5hbGxvd2VkT3JpZ2lucyA/PyBbJyonXTtcbiAgICAgICAgY29uc3QgYWxsb3dBbGwgPSBhbGxvd2VkLmluY2x1ZGVzKCcqJyk7XG4gICAgICAgIGNvbnN0IG9yaWdpbiA9IHJlcS5oZWFkZXJzWydvcmlnaW4nXTtcbiAgICAgICAgaWYgKCFhbGxvd0FsbCAmJiBvcmlnaW4pIHtcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpblN0ciA9IEFycmF5LmlzQXJyYXkob3JpZ2luKSA/IG9yaWdpblswXSA6IG9yaWdpbjtcbiAgICAgICAgICAgIGlmICghYWxsb3dlZC5pbmNsdWRlcyhvcmlnaW5TdHIpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBPcmlnaW4gJHtvcmlnaW5TdHJ9IG5vdCBhbGxvd2VkYDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBIb3N0IGhlYWRlciBjaGVjayDigJQgcHJvdGVjdHMgYWdhaW5zdCBETlMgcmViaW5kaW5nIGV2ZW4gd2hlbiBubyBPcmlnaW4gaXMgc2VudC5cbiAgICAgICAgY29uc3QgaG9zdCA9IChyZXEuaGVhZGVyc1snaG9zdCddIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgICBpZiAoaG9zdCkge1xuICAgICAgICAgICAgY29uc3QgaG9zdE5hbWUgPSBob3N0LnNwbGl0KCc6JylbMF07XG4gICAgICAgICAgICBjb25zdCBhbGxvd2VkSG9zdHMgPSBuZXcgU2V0KFtcbiAgICAgICAgICAgICAgICAnbG9jYWxob3N0JywgJzEyNy4wLjAuMScsICc6OjEnLCAnWzo6MV0nLFxuICAgICAgICAgICAgICAgIC4uLih0aGlzLnNldHRpbmdzLmFsbG93ZWRIb3N0cyA/PyBbXSlcbiAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgaWYgKCFhbGxvd2VkSG9zdHMuaGFzKGhvc3ROYW1lKSAmJiAhYWxsb3dBbGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYEhvc3QgJHtob3N0TmFtZX0gbm90IGFsbG93ZWRgO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHByaXZhdGUgY2hlY2tBdXRoKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAgICAgY29uc3QgdG9rZW4gPSB0aGlzLnNldHRpbmdzLmF1dGhUb2tlbjtcbiAgICAgICAgaWYgKCF0b2tlbikgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnN0IGF1dGggPSAocmVxLmhlYWRlcnNbJ2F1dGhvcml6YXRpb24nXSB8fCAnJykudG9TdHJpbmcoKTtcbiAgICAgICAgaWYgKCFhdXRoLnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkgcmV0dXJuICdBdXRob3JpemF0aW9uOiAqKioqKiogcmVxdWlyZWQnO1xuICAgICAgICBjb25zdCBwcmVzZW50ZWQgPSBhdXRoLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKTtcbiAgICAgICAgLy8gQ29uc3RhbnTigJF0aW1lIGNvbXBhcmUgdG8gYXZvaWQgdGltaW5nIGxlYWtzLlxuICAgICAgICBpZiAoIWNvbnN0YW50VGltZUVxdWFsKHByZXNlbnRlZCwgdG9rZW4pKSByZXR1cm4gJ0ludmFsaWQgYmVhcmVyIHRva2VuJztcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB3cml0ZUNvcnMocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSwgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IG9yaWdpbiA9IChyZXEuaGVhZGVyc1snb3JpZ2luJ10gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/PyAnKic7XG4gICAgICAgIGNvbnN0IGFsbG93ZWQgPSB0aGlzLnNldHRpbmdzLmFsbG93ZWRPcmlnaW5zID8/IFsnKiddO1xuICAgICAgICBjb25zdCBhbGxvd0FsbCA9IGFsbG93ZWQuaW5jbHVkZXMoJyonKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgYWxsb3dBbGwgPyAnKicgOiAoYWxsb3dlZC5pbmNsdWRlcyhvcmlnaW4pID8gb3JpZ2luIDogJ251bGwnKSk7XG4gICAgICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnLCAnR0VULCBQT1NULCBERUxFVEUsIE9QVElPTlMnKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBNY3AtU2Vzc2lvbi1JZCwgTGFzdC1FdmVudC1JRCwgQWNjZXB0Jyk7XG4gICAgICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzJywgJ01jcC1TZXNzaW9uLUlkJyk7XG4gICAgfVxufVxuXG4vLyAtLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHJlYWRCb2R5KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGxldCBib2R5ID0gJyc7XG4gICAgICAgIHJlcS5vbignZGF0YScsIChjKSA9PiB7IGJvZHkgKz0gYy50b1N0cmluZygpOyB9KTtcbiAgICAgICAgcmVxLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKGJvZHkpKTtcbiAgICAgICAgcmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGhlYWRlclN0cmluZyhyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHYgPSByZXEuaGVhZGVyc1tuYW1lXTtcbiAgICBpZiAoIXYpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkodikgPyB2WzBdIDogdjtcbn1cblxuZnVuY3Rpb24gY29uc3RhbnRUaW1lRXF1YWwoYTogc3RyaW5nLCBiOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgbGV0IGRpZmYgPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykgZGlmZiB8PSBhLmNoYXJDb2RlQXQoaSkgXiBiLmNoYXJDb2RlQXQoaSk7XG4gICAgcmV0dXJuIGRpZmYgPT09IDA7XG59XG4iXX0=