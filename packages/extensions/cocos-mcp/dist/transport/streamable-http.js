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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RyZWFtYWJsZS1odHRwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc291cmNlL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILDJDQUE2QjtBQUM3Qix5Q0FBMkI7QUFDM0IsK0JBQW9DO0FBQ3BDLGlEQU82QjtBQUk3QixNQUFNLDBCQUEwQixHQUFHLENBQUMsR0FBRyxLQUFNLENBQUMsQ0FBQywrQ0FBK0M7QUFDOUYsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLENBQUM7QUF3QjlCLE1BQWEsb0JBQW9CO0lBTzdCLFlBQVksSUFBaUM7UUFMckMsV0FBTSxHQUF1QixJQUFJLENBQUM7UUFDbEMsYUFBUSxHQUFHLElBQUksR0FBRyxFQUFtQixDQUFDO1FBSzFDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUM7SUFDakQsQ0FBQztJQUVNLGNBQWMsQ0FBQyxRQUEyQjtRQUM3QyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUM3QixDQUFDO0lBRU0sS0FBSyxDQUFDLEtBQUs7UUFDZCxJQUFJLElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTztRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ3ZFLE1BQU0sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7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QUF5QixFQUFFLElBQVk7SUFDekQsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QixJQUFJLENBQUMsQ0FBQztRQUFFLE9BQU8sU0FBUyxDQUFDO0lBQ3pCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkMsQ0FBQztBQUVELFNBQVMsaUJBQWlCLENBQUMsQ0FBUyxFQUFFLENBQVM7SUFDM0MsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxNQUFNO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDeEMsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDO0lBQ2IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFO1FBQUUsSUFBSSxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM3RSxPQUFPLElBQUksS0FBSyxDQUFDLENBQUM7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RyZWFtYWJsZSBIVFRQIHRyYW5zcG9ydCDigJQgTUNQIDIwMjXigJEwM+KAkTI2LlxuICpcbiAqIEltcGxlbWVudHM6XG4gKiAgIC0gUE9TVCBgL21jcGAgICAgICAgICAgIDogY2xpZW50IOKGkiBzZXJ2ZXIgSlNPTuKAkVJQQyAocmVzcG9uc2UgaXMgZWl0aGVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBhcHBsaWNhdGlvbi9qc29uYCBvciBgdGV4dC9ldmVudC1zdHJlYW1gXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcGVuZGluZyBvbiB0aGUgYEFjY2VwdGAgaGVhZGVyKS5cbiAqICAgLSBHRVQgYC9tY3BgICAgICAgICAgICAgOiBvcGVuIGEgc2VydmVyIOKGkiBjbGllbnQgU1NFIGNoYW5uZWwuIFN1cHBvcnRzXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBMYXN0LUV2ZW50LUlEYCBmb3IgcmVzdW1lLlxuICogICAtIERFTEVURSBgL21jcGAgICAgICAgICA6IGV4cGxpY2l0IHNlc3Npb24gdGVybWluYXRpb24gKEExIHNwZWMpLlxuICogICAtIGBNY3AtU2Vzc2lvbi1JZGAgICAgICA6IGFzc2lnbmVkIG9uIGBpbml0aWFsaXplYCwgZWNob2VkIG9uIGV2ZXJ5XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1YnNlcXVlbnQgcmVxdWVzdCBmcm9tIHRoZSBzYW1lIGNsaWVudC5cbiAqICAgLSBgT3JpZ2luYCBhbGxvd+KAkWxpc3QgICA6IEROU+KAkXJlYmluZGluZyBtaXRpZ2F0aW9uIChBNCkuXG4gKiAgIC0gYEhvc3RgIGFsbG934oCRbGlzdCAgICAgOiBleHRyYSBETlPigJFyZWJpbmRpbmcgbWl0aWdhdGlvbiAoQTQpLlxuICogICAtIGBBdXRob3JpemF0aW9uOiAqKioqKipgOiBvcHRpb25hbCBzaGFyZWQgc2VjcmV0IChBNSkuXG4gKlxuICogRWFjaCBzZXNzaW9uIG93bnMgb25lIHtAbGluayBQcm90b2NvbEhhbmRsZXJ9LiBBIHNlc3Npb24gY2FuIGhhdmUgYXQgbW9zdFxuICogb25lIGFjdGl2ZSBHRVQgKFNTRSkgY2hhbm5lbCBhdCBhIHRpbWUg4oCUIHJl4oCRb3BlbmluZyByZXBsYWNlcyB0aGUgcHJpb3Igb25lLlxuICovXG5cbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnaHR0cCc7XG5pbXBvcnQgKiBhcyB1cmwgZnJvbSAndXJsJztcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHtcbiAgICBKU09OUlBDX0lOVEVSTkFMX0VSUk9SLFxuICAgIEpTT05SUENfUEFSU0VfRVJST1IsXG4gICAgSnNvblJwY1JlcXVlc3QsXG4gICAgSnNvblJwY1Jlc3BvbnNlLFxuICAgIE1DUF9VTkFVVEhPUklaRUQsXG4gICAgbWFrZUVycm9yXG59IGZyb20gJy4uL3Byb3RvY29sL2pzb25ycGMnO1xuaW1wb3J0IHsgUHJvdG9jb2xIYW5kbGVyIH0gZnJvbSAnLi4vcHJvdG9jb2wvcHJvdG9jb2wtaGFuZGxlcic7XG5pbXBvcnQgeyBNQ1BDbGllbnQsIE1DUFNlcnZlclNldHRpbmdzIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG5jb25zdCBDTElFTlRfQUNUSVZJVFlfVElNRU9VVF9NUyA9IDUgKiA2MF8wMDA7IC8vIDUgbWludXRlcyBpcyBtb3JlIHJlYWxpc3RpYyBmb3IgU1NFIGNsaWVudHMuXG5jb25zdCBNQVhfUkVQTEFZX0JVRkZFUiA9IDI1NjtcblxuaW50ZXJmYWNlIFNzZUNoYW5uZWwge1xuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZTtcbiAgICAvKiogQnVmZmVyZWQgZXZlbnRzIGZvciBgTGFzdC1FdmVudC1JRGAgcmVzdW1lLiAqL1xuICAgIGJ1ZmZlcjogeyBpZDogbnVtYmVyOyBldmVudDogc3RyaW5nOyBkYXRhOiBzdHJpbmcgfVtdO1xuICAgIG5leHRFdmVudElkOiBudW1iZXI7XG4gICAga2VlcEFsaXZlOiBOb2RlSlMuVGltZW91dDtcbn1cblxuaW50ZXJmYWNlIFNlc3Npb24ge1xuICAgIGlkOiBzdHJpbmc7XG4gICAgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyO1xuICAgIHNzZTogU3NlQ2hhbm5lbCB8IG51bGw7XG4gICAgbGFzdEFjdGl2aXR5OiBEYXRlO1xuICAgIHVzZXJBZ2VudD86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdHJlYW1hYmxlSHR0cFNlcnZlck9wdGlvbnMge1xuICAgIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcbiAgICBjcmVhdGVIYW5kbGVyKHNlc3Npb25JZDogc3RyaW5nKTogUHJvdG9jb2xIYW5kbGVyO1xuICAgIG9uU2Vzc2lvblRlcm1pbmF0ZWQ/KHNlc3Npb25JZDogc3RyaW5nKTogdm9pZDtcbn1cblxuZXhwb3J0IGNsYXNzIFN0cmVhbWFibGVIdHRwU2VydmVyIHtcbiAgICBwcml2YXRlIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcbiAgICBwcml2YXRlIHNlcnZlcjogaHR0cC5TZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgICBwcml2YXRlIHNlc3Npb25zID0gbmV3IE1hcDxzdHJpbmcsIFNlc3Npb24+KCk7XG4gICAgcHJpdmF0ZSBjcmVhdGVIYW5kbGVyOiAoc2Vzc2lvbklkOiBzdHJpbmcpID0+IFByb3RvY29sSGFuZGxlcjtcbiAgICBwcml2YXRlIG9uVGVybWluYXRlZD86IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZDtcblxuICAgIGNvbnN0cnVjdG9yKG9wdHM6IFN0cmVhbWFibGVIdHRwU2VydmVyT3B0aW9ucykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gb3B0cy5zZXR0aW5ncztcbiAgICAgICAgdGhpcy5jcmVhdGVIYW5kbGVyID0gb3B0cy5jcmVhdGVIYW5kbGVyO1xuICAgICAgICB0aGlzLm9uVGVybWluYXRlZCA9IG9wdHMub25TZXNzaW9uVGVybWluYXRlZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgdXBkYXRlU2V0dGluZ3Moc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzKTogdm9pZCB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBzZXR0aW5ncztcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLnNlcnZlcikgcmV0dXJuO1xuICAgICAgICB0aGlzLnNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4gdGhpcy5kaXNwYXRjaChyZXEsIHJlcykpO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNlcnZlciEub25jZSgnZXJyb3InLCByZWplY3QpO1xuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIhLmxpc3Rlbih0aGlzLnNldHRpbmdzLnBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiByZXNvbHZlKCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc3RvcCgpOiB2b2lkIHtcbiAgICAgICAgaWYgKCF0aGlzLnNlcnZlcikgcmV0dXJuO1xuICAgICAgICBmb3IgKGNvbnN0IHNlc3Npb24gb2YgdGhpcy5zZXNzaW9ucy52YWx1ZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5jbG9zZVNzZShzZXNzaW9uLCAnc2VydmVyIHN0b3BwaW5nJyk7XG4gICAgICAgICAgICBzZXNzaW9uLmhhbmRsZXIuY2FuY2VsQWxsKCdzZXJ2ZXIgc3RvcHBpbmcnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnNlc3Npb25zLmNsZWFyKCk7XG4gICAgICAgIHRoaXMuc2VydmVyLmNsb3NlKCk7XG4gICAgICAgIHRoaXMuc2VydmVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q2xpZW50cygpOiBNQ1BDbGllbnRbXSB7XG4gICAgICAgIHRoaXMucHJ1bmVTZXNzaW9ucygpO1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnNlc3Npb25zLnZhbHVlcygpKS5tYXAoKHMpID0+ICh7XG4gICAgICAgICAgICBpZDogcy5pZCxcbiAgICAgICAgICAgIGxhc3RBY3Rpdml0eTogcy5sYXN0QWN0aXZpdHksXG4gICAgICAgICAgICB1c2VyQWdlbnQ6IHMudXNlckFnZW50XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0U2Vzc2lvbkNvdW50KCk6IG51bWJlciB7XG4gICAgICAgIHRoaXMucHJ1bmVTZXNzaW9ucygpO1xuICAgICAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5zaXplO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRSdW5uaW5nKCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gISF0aGlzLnNlcnZlcjtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0UG9ydCgpOiBudW1iZXIge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXR0aW5ncy5wb3J0O1xuICAgIH1cblxuICAgIC8vIC0tIGRpc3BhdGNoIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGFzeW5jIGRpc3BhdGNoKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSB1cmwucGFyc2UocmVxLnVybCB8fCAnJywgdHJ1ZSk7XG4gICAgICAgIGNvbnN0IHBhdGhuYW1lID0gcGFyc2VkLnBhdGhuYW1lO1xuXG4gICAgICAgIC8vIENPUlMgcHJlZmxpZ2h0IGZpcnN0IOKAlCBuZXZlciByZWplY3QgYmVmb3JlIHRoZSBicm93c2VyIGhhbmRzaGFrZS5cbiAgICAgICAgaWYgKHJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgICAgICAgdGhpcy53cml0ZUNvcnMocmVxLCByZXMpO1xuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDQpO1xuICAgICAgICAgICAgcmVzLmVuZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQTQ6IE9yaWdpbiArIEhvc3QgYWxsb3figJFsaXN0IGNoZWNrcy5cbiAgICAgICAgY29uc3Qgb3JpZ2luRXJyb3IgPSB0aGlzLmNoZWNrT3JpZ2luQW5kSG9zdChyZXEpO1xuICAgICAgICBpZiAob3JpZ2luRXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMud3JpdGVDb3JzKHJlcSwgcmVzKTtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDAzLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IG9yaWdpbkVycm9yIH0pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEE1OiBiZWFyZXIgYXV0aCBvbiAvbWNwLlxuICAgICAgICBpZiAocGF0aG5hbWUgPT09ICcvbWNwJykge1xuICAgICAgICAgICAgY29uc3QgYXV0aEVycm9yID0gdGhpcy5jaGVja0F1dGgocmVxKTtcbiAgICAgICAgICAgIGlmIChhdXRoRXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aGlzLndyaXRlQ29ycyhyZXEsIHJlcyk7XG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDEsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KG1ha2VFcnJvcihudWxsLCBNQ1BfVU5BVVRIT1JJWkVELCBhdXRoRXJyb3IpKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy53cml0ZUNvcnMocmVxLCByZXMpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAocGF0aG5hbWUgPT09ICcvaGVhbHRoJyAmJiByZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ29rJyxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2NvY29zLW1jcC1zZXJ2ZXInLFxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiAnMS40LjAnLFxuICAgICAgICAgICAgICAgICAgICBzZXNzaW9uczogdGhpcy5zZXNzaW9ucy5zaXplLFxuICAgICAgICAgICAgICAgICAgICBtYXhDb25uZWN0aW9uczogdGhpcy5zZXR0aW5ncy5tYXhDb25uZWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNwb3J0OiAnc3RyZWFtYWJsZS1odHRwJyxcbiAgICAgICAgICAgICAgICAgICAgYXV0aDogdGhpcy5zZXR0aW5ncy5hdXRoVG9rZW4gPyAnYmVhcmVyJyA6ICdub25lJ1xuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocGF0aG5hbWUgIT09ICcvbWNwJykge1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTm90IGZvdW5kJyB9KSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzd2l0Y2ggKHJlcS5tZXRob2QpIHtcbiAgICAgICAgICAgICAgICBjYXNlICdHRVQnOlxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZVNzZU9wZW4ocmVxLCByZXMpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgY2FzZSAnUE9TVCc6XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlUG9zdChyZXEsIHJlcyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICBjYXNlICdERUxFVEUnOlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZURlbGV0ZShyZXEsIHJlcyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNSwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCBBbGxvdzogJ0dFVCwgUE9TVCwgREVMRVRFLCBPUFRJT05TJyB9KTtcbiAgICAgICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTWV0aG9kIG5vdCBhbGxvd2VkJyB9KSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNTAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShtYWtlRXJyb3IobnVsbCwgSlNPTlJQQ19JTlRFUk5BTF9FUlJPUiwgZT8ubWVzc2FnZSA/PyBTdHJpbmcoZSkpKSk7XG4gICAgICAgICAgICB9IGNhdGNoIHsgLyogc29ja2V0IG1heSBoYXZlIGJlZW4gY2xvc2VkICovIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tIFBPU1QgL21jcCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZVBvc3QocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSwgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQm9keShyZXEpO1xuICAgICAgICBsZXQgcGFyc2VkOiBhbnk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBwYXJzZWQgPSBib2R5Lmxlbmd0aCA9PT0gMCA/IG51bGwgOiBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KG1ha2VFcnJvcihudWxsLCBKU09OUlBDX1BBUlNFX0VSUk9SLCBgUGFyc2UgZXJyb3I6ICR7ZT8ubWVzc2FnZSA/PyAnaW52YWxpZCBKU09OJ31gKSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIHRoZSBzZXNzaW9uLiBgaW5pdGlhbGl6ZWAgcmVxdWVzdHMgY3JlYXRlIGEgbmV3IG9uZSBpZiBubyBpZCB3YXMgc3VwcGxpZWQuXG4gICAgICAgIGNvbnN0IHJlcXVlc3RlZElkID0gaGVhZGVyU3RyaW5nKHJlcSwgJ21jcC1zZXNzaW9uLWlkJyk7XG4gICAgICAgIGNvbnN0IGlzSW5pdGlhbGl6ZSA9IEFycmF5LmlzQXJyYXkocGFyc2VkKVxuICAgICAgICAgICAgPyBwYXJzZWQuc29tZSgobTogYW55KSA9PiBtPy5tZXRob2QgPT09ICdpbml0aWFsaXplJylcbiAgICAgICAgICAgIDogcGFyc2VkPy5tZXRob2QgPT09ICdpbml0aWFsaXplJztcblxuICAgICAgICBsZXQgc2Vzc2lvbjogU2Vzc2lvbjtcbiAgICAgICAgaWYgKCFyZXF1ZXN0ZWRJZCAmJiBpc0luaXRpYWxpemUpIHtcbiAgICAgICAgICAgIHNlc3Npb24gPSB0aGlzLmNyZWF0ZVNlc3Npb24ocmVxKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZXF1ZXN0ZWRJZCAmJiB0aGlzLnNlc3Npb25zLmhhcyhyZXF1ZXN0ZWRJZCkpIHtcbiAgICAgICAgICAgIHNlc3Npb24gPSB0aGlzLnNlc3Npb25zLmdldChyZXF1ZXN0ZWRJZCkhO1xuICAgICAgICAgICAgc2Vzc2lvbi5sYXN0QWN0aXZpdHkgPSBuZXcgRGF0ZSgpO1xuICAgICAgICB9IGVsc2UgaWYgKCFyZXF1ZXN0ZWRJZCAmJiBwYXJzZWQ/Lm1ldGhvZCAmJiAhaXNJbml0aWFsaXplKSB7XG4gICAgICAgICAgICAvLyBUb2xlcmFudCBmYWxsYmFjazogYWNjZXB0IGZpcnN0IFBPU1Qgd2l0aG91dCBzZXNzaW9uIGlkIGJ5IGNyZWF0aW5nIG9uZS5cbiAgICAgICAgICAgIC8vIFNwZWMgcmVxdWlyZXMgTWNwLVNlc3Npb24tSWQgYnV0IG1hbnkgU0RLIGV4YW1wbGVzIGVsaWRlIGl0LlxuICAgICAgICAgICAgc2Vzc2lvbiA9IHRoaXMuY3JlYXRlU2Vzc2lvbihyZXEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1Vua25vd24gTWNwLVNlc3Npb24tSWQnIH0pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgc2Vzc2lvbi5oYW5kbGVyLmhhbmRsZShwYXJzZWQpO1xuXG4gICAgICAgIC8vIE5vIHJlc3BvbnNlIChhbGwgbm90aWZpY2F0aW9ucykg4oaSIDIwMiBBY2NlcHRlZCwgcGVyIEpTT07igJFSUEMuXG4gICAgICAgIGlmICghcmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAyLCB7ICdNY3AtU2Vzc2lvbi1JZCc6IHNlc3Npb24uaWQgfSk7XG4gICAgICAgICAgICByZXMuZW5kKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY2NlcHQgPSAocmVxLmhlYWRlcnNbJ2FjY2VwdCddIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgICBjb25zdCB3YW50c1NzZSA9IGFjY2VwdC5pbmNsdWRlcygndGV4dC9ldmVudC1zdHJlYW0nKTtcblxuICAgICAgICBpZiAod2FudHNTc2UpIHtcbiAgICAgICAgICAgIC8vIFN0cmVhbSB0aGUgcmVzcG9uc2Ugb3ZlciBTU0Ugb24gdGhpcyB2ZXJ5IFBPU1QuXG4gICAgICAgICAgICB0aGlzLndyaXRlU3NlSGVhZGVycyhyZXMsIHNlc3Npb24uaWQpO1xuICAgICAgICAgICAgdGhpcy5zZW5kU3NlRXZlbnQocmVzLCB1bmRlZmluZWQsICdtZXNzYWdlJywgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgICAgIHJlcy5lbmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgJ01jcC1TZXNzaW9uLUlkJzogc2Vzc2lvbi5pZFxuICAgICAgICB9KTtcbiAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgIH1cblxuICAgIC8vIC0tIEdFVCAvbWNwIChvcGVuIFNTRSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlU3NlT3BlbihyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgYWNjZXB0ID0gKHJlcS5oZWFkZXJzWydhY2NlcHQnXSB8fCAnJykudG9TdHJpbmcoKTtcbiAgICAgICAgaWYgKCFhY2NlcHQuaW5jbHVkZXMoJ3RleHQvZXZlbnQtc3RyZWFtJykgJiYgYWNjZXB0ICE9PSAnKi8qJyAmJiBhY2NlcHQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDYsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0FjY2VwdDogdGV4dC9ldmVudC1zdHJlYW0gcmVxdWlyZWQnIH0pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSBoZWFkZXJTdHJpbmcocmVxLCAnbWNwLXNlc3Npb24taWQnKTtcbiAgICAgICAgaWYgKCFzZXNzaW9uSWQgfHwgIXRoaXMuc2Vzc2lvbnMuaGFzKHNlc3Npb25JZCkpIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmtub3duIE1jcC1TZXNzaW9uLUlkJyB9KSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuc2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCkhO1xuICAgICAgICBzZXNzaW9uLmxhc3RBY3Rpdml0eSA9IG5ldyBEYXRlKCk7XG5cbiAgICAgICAgLy8gUmVwbGFjZSBhbnkgcHJl4oCRZXhpc3RpbmcgU1NFIGNoYW5uZWwgZm9yIHRoaXMgc2Vzc2lvbi5cbiAgICAgICAgaWYgKHNlc3Npb24uc3NlKSB0aGlzLmNsb3NlU3NlKHNlc3Npb24sICdyZXBsYWNlZCBieSBuZXcgU1NFJyk7XG5cbiAgICAgICAgdGhpcy53cml0ZVNzZUhlYWRlcnMocmVzLCBzZXNzaW9uSWQpO1xuXG4gICAgICAgIGNvbnN0IGNoYW5uZWw6IFNzZUNoYW5uZWwgPSB7XG4gICAgICAgICAgICByZXMsXG4gICAgICAgICAgICBidWZmZXI6IFtdLFxuICAgICAgICAgICAgbmV4dEV2ZW50SWQ6IDAsXG4gICAgICAgICAgICBrZWVwQWxpdmU6IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkgeyByZXMud3JpdGUoJzoga2VlcC1hbGl2ZVxcblxcbicpOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cbiAgICAgICAgICAgIH0sIDE1XzAwMClcbiAgICAgICAgfTtcbiAgICAgICAgc2Vzc2lvbi5zc2UgPSBjaGFubmVsO1xuICAgICAgICBzZXNzaW9uLmhhbmRsZXIuc2V0Tm90aWZpY2F0aW9uU2luaygobikgPT4gdGhpcy5kZWxpdmVyTm90aWZpY2F0aW9uKHNlc3Npb24sIG4pKTtcblxuICAgICAgICAvLyBSZXN1bWUgZnJvbSBMYXN0LUV2ZW50LUlELiBXZSBkb24ndCBwZXJzaXN0IGFjcm9zcyByZWNvbm5lY3RzIG9mIG5ld1xuICAgICAgICAvLyBTU0UgY2hhbm5lbHMgKHRoZSBwcmlvciBjaGFubmVsIGJ1ZmZlciB3YXMgd2lwZWQgb24gY2xvc2UpLCBidXQgaWZcbiAgICAgICAgLy8gdGhlIGNsaWVudCByZWNvbm5lY3RzIHRvIHRoZSBzYW1lIGNoYW5uZWwgb2JqZWN0IChyYXJlKSByZXBsYXkgd29ya3MuXG4gICAgICAgIGNvbnN0IGxhc3RFdmVudElkID0gaGVhZGVyU3RyaW5nKHJlcSwgJ2xhc3QtZXZlbnQtaWQnKTtcbiAgICAgICAgaWYgKGxhc3RFdmVudElkKSB7XG4gICAgICAgICAgICBjb25zdCBsYXN0SWQgPSBOdW1iZXIucGFyc2VJbnQobGFzdEV2ZW50SWQsIDEwKTtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobGFzdElkKSkge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXYgb2YgY2hhbm5lbC5idWZmZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV2LmlkID4gbGFzdElkKSB0aGlzLnNlbmRTc2VFdmVudChyZXMsIGV2LmlkLCBldi5ldmVudCwgZXYuZGF0YSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxLm9uKCdjbG9zZScsICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2xvc2VTc2Uoc2Vzc2lvbiwgJ2NsaWVudCBjbG9zZWQgU1NFJyk7XG4gICAgICAgICAgICBzZXNzaW9uLmhhbmRsZXIuc2V0Tm90aWZpY2F0aW9uU2luayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0gREVMRVRFIC9tY3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAgIHByaXZhdGUgaGFuZGxlRGVsZXRlKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IHZvaWQge1xuICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSBoZWFkZXJTdHJpbmcocmVxLCAnbWNwLXNlc3Npb24taWQnKTtcbiAgICAgICAgaWYgKCFzZXNzaW9uSWQgfHwgIXRoaXMuc2Vzc2lvbnMuaGFzKHNlc3Npb25JZCkpIHtcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmtub3duIE1jcC1TZXNzaW9uLUlkJyB9KSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuc2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCkhO1xuICAgICAgICB0aGlzLmNsb3NlU3NlKHNlc3Npb24sICdzZXNzaW9uIHRlcm1pbmF0ZWQgYnkgY2xpZW50Jyk7XG4gICAgICAgIHNlc3Npb24uaGFuZGxlci5jYW5jZWxBbGwoJ3Nlc3Npb24gdGVybWluYXRlZCBieSBjbGllbnQnKTtcbiAgICAgICAgdGhpcy5zZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgICAgdGhpcy5vblRlcm1pbmF0ZWQ/LihzZXNzaW9uSWQpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwNCk7XG4gICAgICAgIHJlcy5lbmQoKTtcbiAgICB9XG5cbiAgICAvLyAtLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVTZXNzaW9uKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBTZXNzaW9uIHtcbiAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3MubWF4Q29ubmVjdGlvbnMgPiAwICYmIHRoaXMuc2Vzc2lvbnMuc2l6ZSA+PSB0aGlzLnNldHRpbmdzLm1heENvbm5lY3Rpb25zKSB7XG4gICAgICAgICAgICAvLyBFdmljdCB0aGUgb2xkZXN0IGlkbGUgc2Vzc2lvbi5cbiAgICAgICAgICAgIGxldCBvbGRlc3RLZXk6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgICAgICAgbGV0IG9sZGVzdFRzID0gSW5maW5pdHk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtrLCBzXSBvZiB0aGlzLnNlc3Npb25zKSB7XG4gICAgICAgICAgICAgICAgaWYgKHMubGFzdEFjdGl2aXR5LmdldFRpbWUoKSA8IG9sZGVzdFRzKSB7IG9sZGVzdFRzID0gcy5sYXN0QWN0aXZpdHkuZ2V0VGltZSgpOyBvbGRlc3RLZXkgPSBrOyB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAob2xkZXN0S2V5KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZXZpY3RlZCA9IHRoaXMuc2Vzc2lvbnMuZ2V0KG9sZGVzdEtleSkhO1xuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2VTc2UoZXZpY3RlZCwgJ2V2aWN0ZWQ6IG1heENvbm5lY3Rpb25zIHJlYWNoZWQnKTtcbiAgICAgICAgICAgICAgICBldmljdGVkLmhhbmRsZXIuY2FuY2VsQWxsKCdldmljdGVkJyk7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXNzaW9ucy5kZWxldGUob2xkZXN0S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpZCA9IHV1aWR2NCgpO1xuICAgICAgICBjb25zdCBzZXNzaW9uOiBTZXNzaW9uID0ge1xuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICBoYW5kbGVyOiB0aGlzLmNyZWF0ZUhhbmRsZXIoaWQpLFxuICAgICAgICAgICAgc3NlOiBudWxsLFxuICAgICAgICAgICAgbGFzdEFjdGl2aXR5OiBuZXcgRGF0ZSgpLFxuICAgICAgICAgICAgdXNlckFnZW50OiAocmVxLmhlYWRlcnNbJ3VzZXItYWdlbnQnXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpID8/IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlc3Npb25zLnNldChpZCwgc2Vzc2lvbik7XG4gICAgICAgIHJldHVybiBzZXNzaW9uO1xuICAgIH1cblxuICAgIHByaXZhdGUgZGVsaXZlck5vdGlmaWNhdGlvbihzZXNzaW9uOiBTZXNzaW9uLCBub3RpZmljYXRpb246IEpzb25ScGNSZXF1ZXN0KTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBzZXNzaW9uLnNzZTtcbiAgICAgICAgaWYgKCFjaGFubmVsKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGV2ZW50SWQgPSBjaGFubmVsLm5leHRFdmVudElkKys7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnN0cmluZ2lmeShub3RpZmljYXRpb24pO1xuICAgICAgICBjaGFubmVsLmJ1ZmZlci5wdXNoKHsgaWQ6IGV2ZW50SWQsIGV2ZW50OiAnbWVzc2FnZScsIGRhdGEgfSk7XG4gICAgICAgIGlmIChjaGFubmVsLmJ1ZmZlci5sZW5ndGggPiBNQVhfUkVQTEFZX0JVRkZFUikgY2hhbm5lbC5idWZmZXIuc2hpZnQoKTtcbiAgICAgICAgdGhpcy5zZW5kU3NlRXZlbnQoY2hhbm5lbC5yZXMsIGV2ZW50SWQsICdtZXNzYWdlJywgZGF0YSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB3cml0ZVNzZUhlYWRlcnMocmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLCBzZXNzaW9uSWQ6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwge1xuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L2V2ZW50LXN0cmVhbScsXG4gICAgICAgICAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1jYWNoZSwgbm8tdHJhbnNmb3JtJyxcbiAgICAgICAgICAgIENvbm5lY3Rpb246ICdrZWVwLWFsaXZlJyxcbiAgICAgICAgICAgICdNY3AtU2Vzc2lvbi1JZCc6IHNlc3Npb25JZCxcbiAgICAgICAgICAgICdYLUFjY2VsLUJ1ZmZlcmluZyc6ICdubydcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEZsdXNoIGhlYWRlcnMgZWFnZXJseSBzbyBjdXJsL2NsaWVudHMgc2hvdyBcImNvbm5lY3RlZFwiIGltbWVkaWF0ZWx5LlxuICAgICAgICByZXMud3JpdGUoJzogc3RyZWFtIG9wZW5lZFxcblxcbicpO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2VuZFNzZUV2ZW50KHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSwgaWQ6IG51bWJlciB8IHVuZGVmaW5lZCwgZXZlbnQ6IHN0cmluZywgZGF0YTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgICAgIGlmIChldmVudCkgbGluZXMucHVzaChgZXZlbnQ6ICR7ZXZlbnR9YCk7XG4gICAgICAgICAgICBpZiAoaWQgIT09IHVuZGVmaW5lZCkgbGluZXMucHVzaChgaWQ6ICR7aWR9YCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgZGF0YS5zcGxpdCgnXFxuJykpIGxpbmVzLnB1c2goYGRhdGE6ICR7bGluZX1gKTtcbiAgICAgICAgICAgIHJlcy53cml0ZShsaW5lcy5qb2luKCdcXG4nKSArICdcXG5cXG4nKTtcbiAgICAgICAgfSBjYXRjaCB7IC8qIHNvY2tldCBjbG9zZWQgKi8gfVxuICAgIH1cblxuICAgIHByaXZhdGUgY2xvc2VTc2Uoc2Vzc2lvbjogU2Vzc2lvbiwgX3JlYXNvbjogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGNoID0gc2Vzc2lvbi5zc2U7XG4gICAgICAgIGlmICghY2gpIHJldHVybjtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChjaC5rZWVwQWxpdmUpO1xuICAgICAgICB0cnkgeyBjaC5yZXMuZW5kKCk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgICAgICBzZXNzaW9uLnNzZSA9IG51bGw7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcnVuZVNlc3Npb25zKCk6IHZvaWQge1xuICAgICAgICBjb25zdCBjdXRvZmYgPSBEYXRlLm5vdygpIC0gQ0xJRU5UX0FDVElWSVRZX1RJTUVPVVRfTVM7XG4gICAgICAgIGZvciAoY29uc3QgW2ssIHNdIG9mIHRoaXMuc2Vzc2lvbnMpIHtcbiAgICAgICAgICAgIGlmICghcy5zc2UgJiYgcy5sYXN0QWN0aXZpdHkuZ2V0VGltZSgpIDwgY3V0b2ZmKSB7XG4gICAgICAgICAgICAgICAgcy5oYW5kbGVyLmNhbmNlbEFsbCgnaWRsZSB0aW1lb3V0Jyk7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXNzaW9ucy5kZWxldGUoayk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNoZWNrT3JpZ2luQW5kSG9zdChyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgICAgIGNvbnN0IGFsbG93ZWQgPSB0aGlzLnNldHRpbmdzLmFsbG93ZWRPcmlnaW5zID8/IFsnKiddO1xuICAgICAgICBjb25zdCBhbGxvd0FsbCA9IGFsbG93ZWQuaW5jbHVkZXMoJyonKTtcbiAgICAgICAgY29uc3Qgb3JpZ2luID0gcmVxLmhlYWRlcnNbJ29yaWdpbiddO1xuICAgICAgICBpZiAoIWFsbG93QWxsICYmIG9yaWdpbikge1xuICAgICAgICAgICAgY29uc3Qgb3JpZ2luU3RyID0gQXJyYXkuaXNBcnJheShvcmlnaW4pID8gb3JpZ2luWzBdIDogb3JpZ2luO1xuICAgICAgICAgICAgaWYgKCFhbGxvd2VkLmluY2x1ZGVzKG9yaWdpblN0cikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYE9yaWdpbiAke29yaWdpblN0cn0gbm90IGFsbG93ZWRgO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIEhvc3QgaGVhZGVyIGNoZWNrIOKAlCBwcm90ZWN0cyBhZ2FpbnN0IEROUyByZWJpbmRpbmcgZXZlbiB3aGVuIG5vIE9yaWdpbiBpcyBzZW50LlxuICAgICAgICBjb25zdCBob3N0ID0gKHJlcS5oZWFkZXJzWydob3N0J10gfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICAgIGlmIChob3N0KSB7XG4gICAgICAgICAgICBjb25zdCBob3N0TmFtZSA9IGhvc3Quc3BsaXQoJzonKVswXTtcbiAgICAgICAgICAgIGNvbnN0IGFsbG93ZWRIb3N0cyA9IG5ldyBTZXQoW1xuICAgICAgICAgICAgICAgICdsb2NhbGhvc3QnLCAnMTI3LjAuMC4xJywgJzo6MScsICdbOjoxXScsXG4gICAgICAgICAgICAgICAgLi4uKHRoaXMuc2V0dGluZ3MuYWxsb3dlZEhvc3RzID8/IFtdKVxuICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICBpZiAoIWFsbG93ZWRIb3N0cy5oYXMoaG9zdE5hbWUpICYmICFhbGxvd0FsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBgSG9zdCAke2hvc3ROYW1lfSBub3QgYWxsb3dlZGA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjaGVja0F1dGgocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRoaXMuc2V0dGluZ3MuYXV0aFRva2VuO1xuICAgICAgICBpZiAoIXRva2VuKSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29uc3QgYXV0aCA9IChyZXEuaGVhZGVyc1snYXV0aG9yaXphdGlvbiddIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgICBpZiAoIWF1dGguc3RhcnRzV2l0aCgnQmVhcmVyICcpKSByZXR1cm4gJ0F1dGhvcml6YXRpb246ICoqKioqKiByZXF1aXJlZCc7XG4gICAgICAgIGNvbnN0IHByZXNlbnRlZCA9IGF1dGguc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpO1xuICAgICAgICAvLyBDb25zdGFudOKAkXRpbWUgY29tcGFyZSB0byBhdm9pZCB0aW1pbmcgbGVha3MuXG4gICAgICAgIGlmICghY29uc3RhbnRUaW1lRXF1YWwocHJlc2VudGVkLCB0b2tlbikpIHJldHVybiAnSW52YWxpZCBiZWFyZXIgdG9rZW4nO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBwcml2YXRlIHdyaXRlQ29ycyhyZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLCByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UpOiB2b2lkIHtcbiAgICAgICAgY29uc3Qgb3JpZ2luID0gKHJlcS5oZWFkZXJzWydvcmlnaW4nXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpID8/ICcqJztcbiAgICAgICAgY29uc3QgYWxsb3dlZCA9IHRoaXMuc2V0dGluZ3MuYWxsb3dlZE9yaWdpbnMgPz8gWycqJ107XG4gICAgICAgIGNvbnN0IGFsbG93QWxsID0gYWxsb3dlZC5pbmNsdWRlcygnKicpO1xuICAgICAgICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCBhbGxvd0FsbCA/ICcqJyA6IChhbGxvd2VkLmluY2x1ZGVzKG9yaWdpbikgPyBvcmlnaW4gOiAnbnVsbCcpKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsICdHRVQsIFBPU1QsIERFTEVURSwgT1BUSU9OUycpO1xuICAgICAgICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJyxcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIE1jcC1TZXNzaW9uLUlkLCBMYXN0LUV2ZW50LUlELCBBY2NlcHQnKTtcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtRXhwb3NlLUhlYWRlcnMnLCAnTWNwLVNlc3Npb24tSWQnKTtcbiAgICB9XG59XG5cbi8vIC0tIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcmVhZEJvZHkocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgbGV0IGJvZHkgPSAnJztcbiAgICAgICAgcmVxLm9uKCdkYXRhJywgKGMpID0+IHsgYm9keSArPSBjLnRvU3RyaW5nKCk7IH0pO1xuICAgICAgICByZXEub24oJ2VuZCcsICgpID0+IHJlc29sdmUoYm9keSkpO1xuICAgICAgICByZXEub24oJ2Vycm9yJywgcmVqZWN0KTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gaGVhZGVyU3RyaW5nKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgdiA9IHJlcS5oZWFkZXJzW25hbWVdO1xuICAgIGlmICghdikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheSh2KSA/IHZbMF0gOiB2O1xufVxuXG5mdW5jdGlvbiBjb25zdGFudFRpbWVFcXVhbChhOiBzdHJpbmcsIGI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgZGlmZiA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSBkaWZmIHw9IGEuY2hhckNvZGVBdChpKSBeIGIuY2hhckNvZGVBdChpKTtcbiAgICByZXR1cm4gZGlmZiA9PT0gMDtcbn1cbiJdfQ==