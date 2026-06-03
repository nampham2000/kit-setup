import * as http from 'http';
import * as url from 'url';
import { v4 as uuidv4 } from 'uuid';
import { MCPServerSettings, ServerStatus, MCPClient, ToolDefinition } from './types';
import { SceneTools } from './tools/scene-tools';
import { NodeTools } from './tools/node-tools';
import { ComponentTools } from './tools/component-tools';
import { PrefabTools } from './tools/prefab-tools';
import { ProjectTools } from './tools/project-tools';
import { DebugTools } from './tools/debug-tools';
import { PreferencesTools } from './tools/preferences-tools';
import { ServerTools } from './tools/server-tools';
import { BroadcastTools } from './tools/broadcast-tools';
import { SceneAdvancedTools } from './tools/scene-advanced-tools';
import { SceneViewTools } from './tools/scene-view-tools';
import { ReferenceImageTools } from './tools/reference-image-tools';
import { AssetAdvancedTools } from './tools/asset-advanced-tools';
import { ValidationTools } from './tools/validation-tools';

const CLIENT_ACTIVITY_TIMEOUT_MS = 30_000;

// JSON-RPC 2.0 / MCP standard error codes
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

// Protocol versions this server understands. The latest is preferred.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

class JsonRpcError extends Error {
    public readonly code: number;
    public readonly data?: any;
    constructor(code: number, message: string, data?: any) {
        super(message);
        this.code = code;
        this.data = data;
    }
}

export class MCPServer {
    private settings: MCPServerSettings;
    private httpServer: http.Server | null = null;
    private clients: Map<string, MCPClient> = new Map();
    private tools: Record<string, any> = {};
    private toolsList: ToolDefinition[] = [];
    private enabledTools: any[] = []; // Stores the list of enabled tools.

    constructor(settings: MCPServerSettings) {
        this.settings = settings;
        this.initializeTools();
    }

    private initializeTools(): void {
        try {
            console.log('[MCPServer] Initializing tools...');
            this.tools.scene = new SceneTools();
            this.tools.node = new NodeTools();
            this.tools.component = new ComponentTools();
            this.tools.prefab = new PrefabTools();
            this.tools.project = new ProjectTools();
            this.tools.debug = new DebugTools();
            this.tools.preferences = new PreferencesTools();
            this.tools.server = new ServerTools();
            this.tools.broadcast = new BroadcastTools();
            this.tools.sceneAdvanced = new SceneAdvancedTools();
            this.tools.sceneView = new SceneViewTools();
            this.tools.referenceImage = new ReferenceImageTools();
            this.tools.assetAdvanced = new AssetAdvancedTools();
            this.tools.validation = new ValidationTools();
            console.log('[MCPServer] Tools initialized successfully');
        } catch (error) {
            console.error('[MCPServer] Error initializing tools:', error);
            throw error;
        }
    }

    public async start(): Promise<void> {
        if (this.httpServer) {
            console.log('[MCPServer] Server is already running');
            return;
        }

        try {
            console.log(`[MCPServer] Starting HTTP server on port ${this.settings.port}...`);
            this.httpServer = http.createServer(this.handleHttpRequest.bind(this));

            await new Promise<void>((resolve, reject) => {
                this.httpServer!.listen(this.settings.port, '127.0.0.1', () => {
                    console.log(`[MCPServer] ✅ HTTP server started successfully on http://127.0.0.1:${this.settings.port}`);
                    console.log(`[MCPServer] Health check: http://127.0.0.1:${this.settings.port}/health`);
                    console.log(`[MCPServer] MCP endpoint: http://127.0.0.1:${this.settings.port}/mcp`);
                    resolve();
                });
                this.httpServer!.on('error', (err: any) => {
                    console.error('[MCPServer] ❌ Failed to start server:', err);
                    if (err.code === 'EADDRINUSE') {
                        console.error(`[MCPServer] Port ${this.settings.port} is already in use. Please change the port in settings.`);
                    }
                    reject(err);
                });
            });

            this.setupTools();
            console.log('[MCPServer] 🚀 MCP Server is ready for connections');
        } catch (error) {
            console.error('[MCPServer] ❌ Failed to start server:', error);
            throw error;
        }
    }

    private notifyToolsListChanged(): void {
        // MCP `notifications/tools/list_changed` is delivered over a server->client
        // channel (e.g. SSE). The HTTP transport here is request/response only, so
        // we just log it for now. When SSE/Streamable-HTTP support lands, broadcast
        // a JSON-RPC notification with method `notifications/tools/list_changed`.
        if (this.settings.enableDebugLog) {
            console.log('[MCPServer] tools/list_changed (no active SSE channel to notify)');
        }
    }

    private setupTools(): void {
        const previousCount = this.toolsList.length;
        this.toolsList = [];
        
        // If no tool configuration is enabled, expose all tools.
        if (!this.enabledTools || this.enabledTools.length === 0) {
            for (const [category, toolSet] of Object.entries(this.tools)) {
                const tools = toolSet.getTools();
                for (const tool of tools) {
                    this.toolsList.push({
                        name: `${category}_${tool.name}`,
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    });
                }
            }
        } else {
            // Filter tools based on the enabled tool configuration.
            const enabledToolNames = new Set(this.enabledTools.map(tool => `${tool.category}_${tool.name}`));
            
            for (const [category, toolSet] of Object.entries(this.tools)) {
                const tools = toolSet.getTools();
                for (const tool of tools) {
                    const toolName = `${category}_${tool.name}`;
                    if (enabledToolNames.has(toolName)) {
                        this.toolsList.push({
                            name: toolName,
                            description: tool.description,
                            inputSchema: tool.inputSchema
                        });
                    }
                }
            }
        }
        
        console.log(`[MCPServer] Setup tools: ${this.toolsList.length} tools available`);
        if (previousCount !== 0 && previousCount !== this.toolsList.length) {
            this.notifyToolsListChanged();
        }
    }

    public getFilteredTools(enabledTools: any[]): ToolDefinition[] {
        if (!enabledTools || enabledTools.length === 0) {
            return this.toolsList; // If no filter is configured, return all tools.
        }

        const enabledToolNames = new Set(enabledTools.map(tool => `${tool.category}_${tool.name}`));
        return this.toolsList.filter(tool => enabledToolNames.has(tool.name));
    }

    public async executeToolCall(toolName: string, args: any): Promise<any> {
        const parts = toolName.split('_');
        const category = parts[0];
        const toolMethodName = parts.slice(1).join('_');
        
        if (this.tools[category]) {
            return await this.tools[category].execute(toolMethodName, args);
        }
        
        throw new Error(`Tool ${toolName} not found`);
    }

    public getClients(): MCPClient[] {
        this.pruneInactiveClients();
        return Array.from(this.clients.values());
    }
    public getAvailableTools(): ToolDefinition[] {
        return this.toolsList;
    }

    public updateEnabledTools(enabledTools: any[]): void {
        console.log(`[MCPServer] Updating enabled tools: ${enabledTools.length} tools`);
        this.enabledTools = enabledTools;
        this.setupTools(); // Rebuild the tool list.
    }

    public getSettings(): MCPServerSettings {
        return this.settings;
    }

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;
        
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        try {
            if (pathname === '/mcp' && req.method === 'POST') {
                this.recordClientActivity(req);
                await this.handleMCPRequest(req, res);
            } else if (pathname === '/health' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'ok', tools: this.toolsList.length }));
            } else if (pathname?.startsWith('/api/') && req.method === 'POST') {
                await this.handleSimpleAPIRequest(req, res, pathname);
            } else if (pathname === '/api/tools' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ tools: this.getSimplifiedToolsList() }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (error) {
            console.error('HTTP request error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }
    
    private async handleMCPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            // Per JSON-RPC 2.0, parse errors must produce an error response with id=null.
            let message: any;
            try {
                message = body.length === 0 ? null : JSON.parse(body);
            } catch (parseError: any) {
                console.error('[MCPServer] JSON parse error:', parseError?.message);
                res.writeHead(400);
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: JSONRPC_PARSE_ERROR,
                        message: `Parse error: ${parseError?.message ?? 'invalid JSON'}`
                    }
                }));
                return;
            }

            try {
                // JSON-RPC 2.0 batch support: array of requests/notifications.
                if (Array.isArray(message)) {
                    if (message.length === 0) {
                        res.writeHead(400);
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: null,
                            error: { code: JSONRPC_INVALID_REQUEST, message: 'Invalid Request: empty batch' }
                        }));
                        return;
                    }
                    const responses: any[] = [];
                    for (const item of message) {
                        const response = await this.handleMessage(item);
                        if (response) responses.push(response);
                    }
                    if (responses.length === 0) {
                        // All entries were notifications -> no body, 202 Accepted.
                        res.writeHead(202);
                        res.end();
                        return;
                    }
                    res.writeHead(200);
                    res.end(JSON.stringify(responses));
                    return;
                }

                const response = await this.handleMessage(message);
                if (!response) {
                    // Notification: no response body per JSON-RPC 2.0.
                    res.writeHead(202);
                    res.end();
                    return;
                }
                res.writeHead(200);
                res.end(JSON.stringify(response));
            } catch (error: any) {
                console.error('Error handling MCP request:', error);
                res.writeHead(500);
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: JSONRPC_INTERNAL_ERROR,
                        message: `Internal error: ${error?.message ?? error}`
                    }
                }));
            }
        });
    }

    private recordClientActivity(req: http.IncomingMessage): void {
        this.pruneInactiveClients();

        const userAgent = req.headers['user-agent'];
        const clientKey = `${req.socket.remoteAddress || 'unknown'}|${userAgent || 'unknown'}`;
        const existingClient = this.clients.get(clientKey);

        this.clients.set(clientKey, {
            id: existingClient?.id || uuidv4(),
            lastActivity: new Date(),
            userAgent
        });
    }

    private pruneInactiveClients(): void {
        const cutoffTime = Date.now() - CLIENT_ACTIVITY_TIMEOUT_MS;

        for (const [key, client] of this.clients.entries()) {
            if (client.lastActivity.getTime() < cutoffTime) {
                this.clients.delete(key);
            }
        }
    }

    private async handleMessage(message: any): Promise<any | null> {
        // Validate JSON-RPC envelope.
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return {
                jsonrpc: '2.0',
                id: null,
                error: { code: JSONRPC_INVALID_REQUEST, message: 'Invalid Request' }
            };
        }
        if (message.jsonrpc !== '2.0') {
            return {
                jsonrpc: '2.0',
                id: message.id ?? null,
                error: { code: JSONRPC_INVALID_REQUEST, message: 'Invalid Request: jsonrpc must be "2.0"' }
            };
        }

        const { id, method, params } = message;
        const isNotification = id === undefined || id === null;

        // MCP/JSON-RPC notifications must not receive a response.
        if (typeof method !== 'string') {
            if (isNotification) return null;
            return {
                jsonrpc: '2.0',
                id,
                error: { code: JSONRPC_INVALID_REQUEST, message: 'Invalid Request: missing method' }
            };
        }

        try {
            let result: any;

            switch (method) {
                case 'initialize': {
                    const requested = params?.protocolVersion;
                    const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
                        ? requested
                        : DEFAULT_PROTOCOL_VERSION;
                    result = {
                        protocolVersion: negotiated,
                        capabilities: {
                            tools: { listChanged: true }
                        },
                        serverInfo: {
                            name: 'cocos-mcp-server',
                            version: '1.0.0'
                        }
                    };
                    break;
                }
                case 'notifications/initialized':
                case 'initialized':
                case 'notifications/cancelled':
                case 'notifications/roots/list_changed':
                    // Spec-defined notifications: acknowledge silently.
                    return null;
                case 'ping':
                    result = {};
                    break;
                case 'tools/list':
                    result = { tools: this.getAvailableTools() };
                    break;
                case 'tools/call': {
                    if (!params || typeof params.name !== 'string') {
                        throw new JsonRpcError(JSONRPC_INVALID_PARAMS, 'Invalid params: "name" is required');
                    }
                    const { name, arguments: args } = params;
                    // Per MCP spec, tool execution failures must NOT be returned as
                    // JSON-RPC errors. Instead, return a normal result with
                    // `isError: true` so the client/LLM can observe and react.
                    try {
                        const toolResult = await this.executeToolCall(name, args ?? {});
                        const isError = !!(toolResult && typeof toolResult === 'object' && toolResult.success === false);
                        result = {
                            content: [{ type: 'text', text: JSON.stringify(toolResult) }],
                            isError
                        };
                    } catch (toolError: any) {
                        result = {
                            content: [{ type: 'text', text: toolError?.message ?? String(toolError) }],
                            isError: true
                        };
                    }
                    break;
                }
                default:
                    throw new JsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
            }

            if (isNotification) return null;

            return {
                jsonrpc: '2.0',
                id,
                result
            };
        } catch (error: any) {
            if (isNotification) return null;
            const code = error instanceof JsonRpcError ? error.code : JSONRPC_INTERNAL_ERROR;
            const data = error instanceof JsonRpcError ? error.data : undefined;
            const errObj: any = { code, message: error?.message ?? String(error) };
            if (data !== undefined) errObj.data = data;
            return {
                jsonrpc: '2.0',
                id,
                error: errObj
            };
        }
    }

    private fixCommonJsonIssues(jsonStr: string): string {
        // Kept only for the legacy `/api/*` REST helper. Heuristic JSON-repair is
        // unsafe for the MCP endpoint (it can corrupt valid JSON, e.g. swap quotes
        // inside strings or double-escape newlines), so the MCP path no longer
        // calls into this; it must reject malformed JSON with -32700 per spec.
        let fixed = jsonStr;
        fixed = fixed
            .replace(/,(\s*[}\]])/g, '$1') // trailing commas
            .replace(/'/g, '"');           // single -> double quotes
        return fixed;
    }

    public stop(): void {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            console.log('[MCPServer] HTTP server stopped');
        }

        this.clients.clear();
    }

    public getStatus(): ServerStatus {
        this.pruneInactiveClients();

        return {
            running: !!this.httpServer,
            port: this.settings.port,
            clients: this.clients.size
        };
    }

    private async handleSimpleAPIRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
        let body = '';
        
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                // Extract tool name from path like /api/node/set_position
                const pathParts = pathname.split('/').filter(p => p);
                if (pathParts.length < 3) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid API path. Use /api/{category}/{tool_name}' }));
                    return;
                }
                
                const category = pathParts[1];
                const toolName = pathParts[2];
                const fullToolName = `${category}_${toolName}`;
                
                // Parse parameters with enhanced error handling
                let params;
                try {
                    params = body ? JSON.parse(body) : {};
                } catch (parseError: any) {
                    // Try to fix JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        params = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed API JSON parsing issue');
                    } catch (secondError: any) {
                        res.writeHead(400);
                        res.end(JSON.stringify({
                            error: 'Invalid JSON in request body',
                            details: parseError.message,
                            receivedBody: body.substring(0, 200)
                        }));
                        return;
                    }
                }
                
                // Execute tool
                const result = await this.executeToolCall(fullToolName, params);
                
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    tool: fullToolName,
                    result: result
                }));
                
            } catch (error: any) {
                console.error('Simple API error:', error);
                res.writeHead(500);
                res.end(JSON.stringify({
                    success: false,
                    error: error.message,
                    tool: pathname
                }));
            }
        });
    }

    private getSimplifiedToolsList(): any[] {
        return this.toolsList.map(tool => {
            const parts = tool.name.split('_');
            const category = parts[0];
            const toolName = parts.slice(1).join('_');
            
            return {
                name: tool.name,
                category: category,
                toolName: toolName,
                description: tool.description,
                apiPath: `/api/${category}/${toolName}`,
                curlExample: this.generateCurlExample(category, toolName, tool.inputSchema)
            };
        });
    }

    private generateCurlExample(category: string, toolName: string, schema: any): string {
        // Generate sample parameters based on schema
        const sampleParams = this.generateSampleParams(schema);
        const jsonString = JSON.stringify(sampleParams, null, 2);
        
        return `curl -X POST http://127.0.0.1:8585/api/${category}/${toolName} \\
  -H "Content-Type: application/json" \\
  -d '${jsonString}'`;
    }

    private generateSampleParams(schema: any): any {
        if (!schema || !schema.properties) return {};
        
        const sample: any = {};
        for (const [key, prop] of Object.entries(schema.properties as any)) {
            const propSchema = prop as any;
            switch (propSchema.type) {
                case 'string':
                    sample[key] = propSchema.default || 'example_string';
                    break;
                case 'number':
                    sample[key] = propSchema.default || 42;
                    break;
                case 'boolean':
                    sample[key] = propSchema.default || true;
                    break;
                case 'object':
                    sample[key] = propSchema.default || { x: 0, y: 0, z: 0 };
                    break;
                default:
                    sample[key] = 'example_value';
            }
        }
        return sample;
    }

    public updateSettings(settings: MCPServerSettings) {
        this.settings = settings;
    }
}
