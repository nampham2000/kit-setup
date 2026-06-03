"use strict";
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
exports.MCPServer = void 0;
const http = __importStar(require("http"));
const url = __importStar(require("url"));
const uuid_1 = require("uuid");
const scene_tools_1 = require("./tools/scene-tools");
const node_tools_1 = require("./tools/node-tools");
const component_tools_1 = require("./tools/component-tools");
const prefab_tools_1 = require("./tools/prefab-tools");
const project_tools_1 = require("./tools/project-tools");
const debug_tools_1 = require("./tools/debug-tools");
const preferences_tools_1 = require("./tools/preferences-tools");
const server_tools_1 = require("./tools/server-tools");
const broadcast_tools_1 = require("./tools/broadcast-tools");
const scene_advanced_tools_1 = require("./tools/scene-advanced-tools");
const scene_view_tools_1 = require("./tools/scene-view-tools");
const reference_image_tools_1 = require("./tools/reference-image-tools");
const asset_advanced_tools_1 = require("./tools/asset-advanced-tools");
const validation_tools_1 = require("./tools/validation-tools");
const CLIENT_ACTIVITY_TIMEOUT_MS = 30000;
class MCPServer {
    constructor(settings) {
        this.httpServer = null;
        this.clients = new Map();
        this.tools = {};
        this.toolsList = [];
        this.enabledTools = []; // Stores the list of enabled tools.
        this.settings = settings;
        this.initializeTools();
    }
    initializeTools() {
        try {
            console.log('[MCPServer] Initializing tools...');
            this.tools.scene = new scene_tools_1.SceneTools();
            this.tools.node = new node_tools_1.NodeTools();
            this.tools.component = new component_tools_1.ComponentTools();
            this.tools.prefab = new prefab_tools_1.PrefabTools();
            this.tools.project = new project_tools_1.ProjectTools();
            this.tools.debug = new debug_tools_1.DebugTools();
            this.tools.preferences = new preferences_tools_1.PreferencesTools();
            this.tools.server = new server_tools_1.ServerTools();
            this.tools.broadcast = new broadcast_tools_1.BroadcastTools();
            this.tools.sceneAdvanced = new scene_advanced_tools_1.SceneAdvancedTools();
            this.tools.sceneView = new scene_view_tools_1.SceneViewTools();
            this.tools.referenceImage = new reference_image_tools_1.ReferenceImageTools();
            this.tools.assetAdvanced = new asset_advanced_tools_1.AssetAdvancedTools();
            this.tools.validation = new validation_tools_1.ValidationTools();
            console.log('[MCPServer] Tools initialized successfully');
        }
        catch (error) {
            console.error('[MCPServer] Error initializing tools:', error);
            throw error;
        }
    }
    async start() {
        if (this.httpServer) {
            console.log('[MCPServer] Server is already running');
            return;
        }
        try {
            console.log(`[MCPServer] Starting HTTP server on port ${this.settings.port}...`);
            this.httpServer = http.createServer(this.handleHttpRequest.bind(this));
            await new Promise((resolve, reject) => {
                this.httpServer.listen(this.settings.port, '127.0.0.1', () => {
                    console.log(`[MCPServer] ✅ HTTP server started successfully on http://127.0.0.1:${this.settings.port}`);
                    console.log(`[MCPServer] Health check: http://127.0.0.1:${this.settings.port}/health`);
                    console.log(`[MCPServer] MCP endpoint: http://127.0.0.1:${this.settings.port}/mcp`);
                    resolve();
                });
                this.httpServer.on('error', (err) => {
                    console.error('[MCPServer] ❌ Failed to start server:', err);
                    if (err.code === 'EADDRINUSE') {
                        console.error(`[MCPServer] Port ${this.settings.port} is already in use. Please change the port in settings.`);
                    }
                    reject(err);
                });
            });
            this.setupTools();
            console.log('[MCPServer] 🚀 MCP Server is ready for connections');
        }
        catch (error) {
            console.error('[MCPServer] ❌ Failed to start server:', error);
            throw error;
        }
    }
    setupTools() {
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
        }
        else {
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
    }
    getFilteredTools(enabledTools) {
        if (!enabledTools || enabledTools.length === 0) {
            return this.toolsList; // If no filter is configured, return all tools.
        }
        const enabledToolNames = new Set(enabledTools.map(tool => `${tool.category}_${tool.name}`));
        return this.toolsList.filter(tool => enabledToolNames.has(tool.name));
    }
    async executeToolCall(toolName, args) {
        const parts = toolName.split('_');
        const category = parts[0];
        const toolMethodName = parts.slice(1).join('_');
        if (this.tools[category]) {
            return await this.tools[category].execute(toolMethodName, args);
        }
        throw new Error(`Tool ${toolName} not found`);
    }
    getClients() {
        this.pruneInactiveClients();
        return Array.from(this.clients.values());
    }
    getAvailableTools() {
        return this.toolsList;
    }
    updateEnabledTools(enabledTools) {
        console.log(`[MCPServer] Updating enabled tools: ${enabledTools.length} tools`);
        this.enabledTools = enabledTools;
        this.setupTools(); // Rebuild the tool list.
    }
    getSettings() {
        return this.settings;
    }
    async handleHttpRequest(req, res) {
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
            }
            else if (pathname === '/health' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'ok', tools: this.toolsList.length }));
            }
            else if ((pathname === null || pathname === void 0 ? void 0 : pathname.startsWith('/api/')) && req.method === 'POST') {
                await this.handleSimpleAPIRequest(req, res, pathname);
            }
            else if (pathname === '/api/tools' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify({ tools: this.getSimplifiedToolsList() }));
            }
            else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        }
        catch (error) {
            console.error('HTTP request error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }
    async handleMCPRequest(req, res) {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                // Enhanced JSON parsing with better error handling
                let message;
                try {
                    message = JSON.parse(body);
                }
                catch (parseError) {
                    // Try to fix common JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        message = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed JSON parsing issue');
                    }
                    catch (secondError) {
                        throw new Error(`JSON parsing failed: ${parseError.message}. Original body: ${body.substring(0, 500)}...`);
                    }
                }
                const response = await this.handleMessage(message);
                res.writeHead(200);
                res.end(JSON.stringify(response));
            }
            catch (error) {
                console.error('Error handling MCP request:', error);
                res.writeHead(400);
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: `Parse error: ${error.message}`
                    }
                }));
            }
        });
    }
    recordClientActivity(req) {
        this.pruneInactiveClients();
        const userAgent = req.headers['user-agent'];
        const clientKey = `${req.socket.remoteAddress || 'unknown'}|${userAgent || 'unknown'}`;
        const existingClient = this.clients.get(clientKey);
        this.clients.set(clientKey, {
            id: (existingClient === null || existingClient === void 0 ? void 0 : existingClient.id) || (0, uuid_1.v4)(),
            lastActivity: new Date(),
            userAgent
        });
    }
    pruneInactiveClients() {
        const cutoffTime = Date.now() - CLIENT_ACTIVITY_TIMEOUT_MS;
        for (const [key, client] of this.clients.entries()) {
            if (client.lastActivity.getTime() < cutoffTime) {
                this.clients.delete(key);
            }
        }
    }
    async handleMessage(message) {
        const { id, method, params } = message;
        try {
            let result;
            switch (method) {
                case 'tools/list':
                    result = { tools: this.getAvailableTools() };
                    break;
                case 'tools/call':
                    const { name, arguments: args } = params;
                    const toolResult = await this.executeToolCall(name, args);
                    result = { content: [{ type: 'text', text: JSON.stringify(toolResult) }] };
                    break;
                case 'initialize':
                    // MCP initialization
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'cocos-mcp-server',
                            version: '1.0.0'
                        }
                    };
                    break;
                default:
                    throw new Error(`Unknown method: ${method}`);
            }
            return {
                jsonrpc: '2.0',
                id,
                result
            };
        }
        catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: error.message
                }
            };
        }
    }
    fixCommonJsonIssues(jsonStr) {
        let fixed = jsonStr;
        // Fix common escape character issues
        fixed = fixed
            // Fix unescaped quotes in strings
            .replace(/([^\\])"([^"]*[^\\])"([^,}\]:])/g, '$1\\"$2\\"$3')
            // Fix unescaped backslashes
            .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2')
            // Fix trailing commas
            .replace(/,(\s*[}\]])/g, '$1')
            // Fix single quotes (should be double quotes)
            .replace(/'/g, '"')
            // Fix common control characters
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
        return fixed;
    }
    stop() {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            console.log('[MCPServer] HTTP server stopped');
        }
        this.clients.clear();
    }
    getStatus() {
        this.pruneInactiveClients();
        return {
            running: !!this.httpServer,
            port: this.settings.port,
            clients: this.clients.size
        };
    }
    async handleSimpleAPIRequest(req, res, pathname) {
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
                }
                catch (parseError) {
                    // Try to fix JSON issues
                    const fixedBody = this.fixCommonJsonIssues(body);
                    try {
                        params = JSON.parse(fixedBody);
                        console.log('[MCPServer] Fixed API JSON parsing issue');
                    }
                    catch (secondError) {
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
            }
            catch (error) {
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
    getSimplifiedToolsList() {
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
    generateCurlExample(category, toolName, schema) {
        // Generate sample parameters based on schema
        const sampleParams = this.generateSampleParams(schema);
        const jsonString = JSON.stringify(sampleParams, null, 2);
        return `curl -X POST http://127.0.0.1:8585/api/${category}/${toolName} \\
  -H "Content-Type: application/json" \\
  -d '${jsonString}'`;
    }
    generateSampleParams(schema) {
        if (!schema || !schema.properties)
            return {};
        const sample = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
            const propSchema = prop;
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
    updateSettings(settings) {
        this.settings = settings;
    }
}
exports.MCPServer = MCPServer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tY3Atc2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJDQUE2QjtBQUM3Qix5Q0FBMkI7QUFDM0IsK0JBQW9DO0FBRXBDLHFEQUFpRDtBQUNqRCxtREFBK0M7QUFDL0MsNkRBQXlEO0FBQ3pELHVEQUFtRDtBQUNuRCx5REFBcUQ7QUFDckQscURBQWlEO0FBQ2pELGlFQUE2RDtBQUM3RCx1REFBbUQ7QUFDbkQsNkRBQXlEO0FBQ3pELHVFQUFrRTtBQUNsRSwrREFBMEQ7QUFDMUQseUVBQW9FO0FBQ3BFLHVFQUFrRTtBQUNsRSwrREFBMkQ7QUFFM0QsTUFBTSwwQkFBMEIsR0FBRyxLQUFNLENBQUM7QUFFMUMsTUFBYSxTQUFTO0lBUWxCLFlBQVksUUFBMkI7UUFOL0IsZUFBVSxHQUF1QixJQUFJLENBQUM7UUFDdEMsWUFBTyxHQUEyQixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQzVDLFVBQUssR0FBd0IsRUFBRSxDQUFDO1FBQ2hDLGNBQVMsR0FBcUIsRUFBRSxDQUFDO1FBQ2pDLGlCQUFZLEdBQVUsRUFBRSxDQUFDLENBQUMsb0NBQW9DO1FBR2xFLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBRU8sZUFBZTtRQUNuQixJQUFJLENBQUM7WUFDRCxPQUFPLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxDQUFDLENBQUM7WUFDakQsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7WUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7WUFDbEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxFQUFFLENBQUM7WUFDNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7WUFDdEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEdBQUcsSUFBSSw0QkFBWSxFQUFFLENBQUM7WUFDeEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7WUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxvQ0FBZ0IsRUFBRSxDQUFDO1lBQ2hELElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLElBQUksMEJBQVcsRUFBRSxDQUFDO1lBQ3RDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFDO1lBQzVDLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxHQUFHLElBQUkseUNBQWtCLEVBQUUsQ0FBQztZQUNwRCxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJLGlDQUFjLEVBQUUsQ0FBQztZQUM1QyxJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxJQUFJLDJDQUFtQixFQUFFLENBQUM7WUFDdEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLEdBQUcsSUFBSSx5Q0FBa0IsRUFBRSxDQUFDO1lBQ3BELElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxHQUFHLElBQUksa0NBQWUsRUFBRSxDQUFDO1lBQzlDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNENBQTRDLENBQUMsQ0FBQztRQUM5RCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsdUNBQXVDLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDOUQsTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7SUFFTSxLQUFLLENBQUMsS0FBSztRQUNkLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUNBQXVDLENBQUMsQ0FBQztZQUNyRCxPQUFPO1FBQ1gsQ0FBQztRQUVELElBQUksQ0FBQztZQUNELE9BQU8sQ0FBQyxHQUFHLENBQUMsNENBQTRDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQztZQUNqRixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBRXZFLE1BQU0sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7Z0JBQ3hDLElBQUksQ0FBQyxVQUFXLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUU7b0JBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsc0VBQXNFLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztvQkFDeEcsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxDQUFDO29CQUN2RixPQUFPLENBQUMsR0FBRyxDQUFDLDhDQUE4QyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksTUFBTSxDQUFDLENBQUM7b0JBQ3BGLE9BQU8sRUFBRSxDQUFDO2dCQUNkLENBQUMsQ0FBQyxDQUFDO2dCQUNILElBQUksQ0FBQyxVQUFXLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQVEsRUFBRSxFQUFFO29CQUN0QyxPQUFPLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxFQUFFLEdBQUcsQ0FBQyxDQUFDO29CQUM1RCxJQUFJLEdBQUcsQ0FBQyxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUM7d0JBQzVCLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSx5REFBeUQsQ0FBQyxDQUFDO29CQUNuSCxDQUFDO29CQUNELE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDaEIsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDLENBQUMsQ0FBQztZQUVILElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNsQixPQUFPLENBQUMsR0FBRyxDQUFDLG9EQUFvRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzlELE1BQU0sS0FBSyxDQUFDO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0lBRU8sVUFBVTtRQUNkLElBQUksQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFDO1FBRXBCLHlEQUF5RDtRQUN6RCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN2RCxLQUFLLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDM0QsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUNqQyxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO29CQUN2QixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt3QkFDaEIsSUFBSSxFQUFFLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUU7d0JBQ2hDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVzt3QkFDN0IsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXO3FCQUNoQyxDQUFDLENBQUM7Z0JBQ1AsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO2FBQU0sQ0FBQztZQUNKLHdEQUF3RDtZQUN4RCxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFFakcsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQzNELE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDakMsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztvQkFDdkIsTUFBTSxRQUFRLEdBQUcsR0FBRyxRQUFRLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO29CQUM1QyxJQUFJLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO3dCQUNqQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzs0QkFDaEIsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXOzRCQUM3QixXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7eUJBQ2hDLENBQUMsQ0FBQztvQkFDUCxDQUFDO2dCQUNMLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxrQkFBa0IsQ0FBQyxDQUFDO0lBQ3JGLENBQUM7SUFFTSxnQkFBZ0IsQ0FBQyxZQUFtQjtRQUN2QyxJQUFJLENBQUMsWUFBWSxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0MsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsZ0RBQWdEO1FBQzNFLENBQUM7UUFFRCxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUM1RixPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQzFFLENBQUM7SUFFTSxLQUFLLENBQUMsZUFBZSxDQUFDLFFBQWdCLEVBQUUsSUFBUztRQUNwRCxNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2xDLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMxQixNQUFNLGNBQWMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUVoRCxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUN2QixPQUFPLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3BFLENBQUM7UUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLFFBQVEsUUFBUSxZQUFZLENBQUMsQ0FBQztJQUNsRCxDQUFDO0lBRU0sVUFBVTtRQUNiLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQzVCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDN0MsQ0FBQztJQUNNLGlCQUFpQjtRQUNwQixPQUFPLElBQUksQ0FBQyxTQUFTLENBQUM7SUFDMUIsQ0FBQztJQUVNLGtCQUFrQixDQUFDLFlBQW1CO1FBQ3pDLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUNBQXVDLFlBQVksQ0FBQyxNQUFNLFFBQVEsQ0FBQyxDQUFDO1FBQ2hGLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO1FBQ2pDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLHlCQUF5QjtJQUNoRCxDQUFDO0lBRU0sV0FBVztRQUNkLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN6QixDQUFDO0lBRU8sS0FBSyxDQUFDLGlCQUFpQixDQUFDLEdBQXlCLEVBQUUsR0FBd0I7UUFDL0UsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNqRCxNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsUUFBUSxDQUFDO1FBRXBDLG1CQUFtQjtRQUNuQixHQUFHLENBQUMsU0FBUyxDQUFDLDZCQUE2QixFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ2xELEdBQUcsQ0FBQyxTQUFTLENBQUMsOEJBQThCLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUNwRSxHQUFHLENBQUMsU0FBUyxDQUFDLDhCQUE4QixFQUFFLDZCQUE2QixDQUFDLENBQUM7UUFDN0UsR0FBRyxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztRQUVsRCxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDM0IsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNuQixHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDVixPQUFPO1FBQ1gsQ0FBQztRQUVELElBQUksQ0FBQztZQUNELElBQUksUUFBUSxLQUFLLE1BQU0sSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRSxDQUFDO2dCQUMvQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQy9CLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUMxQyxDQUFDO2lCQUFNLElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLEtBQUssRUFBRSxDQUFDO2dCQUN4RCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNuQixHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQztZQUM1RSxDQUFDO2lCQUFNLElBQUksQ0FBQSxRQUFRLGFBQVIsUUFBUSx1QkFBUixRQUFRLENBQUUsVUFBVSxDQUFDLE9BQU8sQ0FBQyxLQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssTUFBTSxFQUFFLENBQUM7Z0JBQ2hFLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDMUQsQ0FBQztpQkFBTSxJQUFJLFFBQVEsS0FBSyxZQUFZLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxLQUFLLEVBQUUsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDbkIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3RFLENBQUM7aUJBQU0sQ0FBQztnQkFDSixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNuQixHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3BELENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDNUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNuQixHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDaEUsQ0FBQztJQUNMLENBQUM7SUFFTyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsR0FBeUIsRUFBRSxHQUF3QjtRQUM5RSxJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7UUFFZCxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ3JCLElBQUksSUFBSSxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDN0IsQ0FBQyxDQUFDLENBQUM7UUFFSCxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxLQUFLLElBQUksRUFBRTtZQUNyQixJQUFJLENBQUM7Z0JBQ0QsbURBQW1EO2dCQUNuRCxJQUFJLE9BQU8sQ0FBQztnQkFDWixJQUFJLENBQUM7b0JBQ0QsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQy9CLENBQUM7Z0JBQUMsT0FBTyxVQUFlLEVBQUUsQ0FBQztvQkFDdkIsZ0NBQWdDO29CQUNoQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ2pELElBQUksQ0FBQzt3QkFDRCxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQzt3QkFDaEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO29CQUN4RCxDQUFDO29CQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7d0JBQ25CLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLFVBQVUsQ0FBQyxPQUFPLG9CQUFvQixJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7b0JBQy9HLENBQUM7Z0JBQ0wsQ0FBQztnQkFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7Z0JBQ25ELEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ25CLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO1lBQ3RDLENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNsQixPQUFPLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUNwRCxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNuQixHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLE9BQU8sRUFBRSxLQUFLO29CQUNkLEVBQUUsRUFBRSxJQUFJO29CQUNSLEtBQUssRUFBRTt3QkFDSCxJQUFJLEVBQUUsQ0FBQyxLQUFLO3dCQUNaLE9BQU8sRUFBRSxnQkFBZ0IsS0FBSyxDQUFDLE9BQU8sRUFBRTtxQkFDM0M7aUJBQ0osQ0FBQyxDQUFDLENBQUM7WUFDUixDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRU8sb0JBQW9CLENBQUMsR0FBeUI7UUFDbEQsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7UUFFNUIsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUM1QyxNQUFNLFNBQVMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsYUFBYSxJQUFJLFNBQVMsSUFBSSxTQUFTLElBQUksU0FBUyxFQUFFLENBQUM7UUFDdkYsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFbkQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFO1lBQ3hCLEVBQUUsRUFBRSxDQUFBLGNBQWMsYUFBZCxjQUFjLHVCQUFkLGNBQWMsQ0FBRSxFQUFFLEtBQUksSUFBQSxTQUFNLEdBQUU7WUFDbEMsWUFBWSxFQUFFLElBQUksSUFBSSxFQUFFO1lBQ3hCLFNBQVM7U0FDWixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRU8sb0JBQW9CO1FBQ3hCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRywwQkFBMEIsQ0FBQztRQUUzRCxLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsTUFBTSxDQUFDLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO1lBQ2pELElBQUksTUFBTSxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsR0FBRyxVQUFVLEVBQUUsQ0FBQztnQkFDN0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDN0IsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRU8sS0FBSyxDQUFDLGFBQWEsQ0FBQyxPQUFZO1FBQ3BDLE1BQU0sRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQztRQUV2QyxJQUFJLENBQUM7WUFDRCxJQUFJLE1BQVcsQ0FBQztZQUVoQixRQUFRLE1BQU0sRUFBRSxDQUFDO2dCQUNiLEtBQUssWUFBWTtvQkFDYixNQUFNLEdBQUcsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixFQUFFLEVBQUUsQ0FBQztvQkFDN0MsTUFBTTtnQkFDVixLQUFLLFlBQVk7b0JBQ2IsTUFBTSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDO29CQUN6QyxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO29CQUMxRCxNQUFNLEdBQUcsRUFBRSxPQUFPLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7b0JBQzNFLE1BQU07Z0JBQ1YsS0FBSyxZQUFZO29CQUNiLHFCQUFxQjtvQkFDckIsTUFBTSxHQUFHO3dCQUNMLGVBQWUsRUFBRSxZQUFZO3dCQUM3QixZQUFZLEVBQUU7NEJBQ1YsS0FBSyxFQUFFLEVBQUU7eUJBQ1o7d0JBQ0QsVUFBVSxFQUFFOzRCQUNSLElBQUksRUFBRSxrQkFBa0I7NEJBQ3hCLE9BQU8sRUFBRSxPQUFPO3lCQUNuQjtxQkFDSixDQUFDO29CQUNGLE1BQU07Z0JBQ1Y7b0JBQ0ksTUFBTSxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUNyRCxDQUFDO1lBRUQsT0FBTztnQkFDSCxPQUFPLEVBQUUsS0FBSztnQkFDZCxFQUFFO2dCQUNGLE1BQU07YUFDVCxDQUFDO1FBQ04sQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDbEIsT0FBTztnQkFDSCxPQUFPLEVBQUUsS0FBSztnQkFDZCxFQUFFO2dCQUNGLEtBQUssRUFBRTtvQkFDSCxJQUFJLEVBQUUsQ0FBQyxLQUFLO29CQUNaLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztpQkFDekI7YUFDSixDQUFDO1FBQ04sQ0FBQztJQUNMLENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxPQUFlO1FBQ3ZDLElBQUksS0FBSyxHQUFHLE9BQU8sQ0FBQztRQUVwQixxQ0FBcUM7UUFDckMsS0FBSyxHQUFHLEtBQUs7WUFDVCxrQ0FBa0M7YUFDakMsT0FBTyxDQUFDLGtDQUFrQyxFQUFFLGNBQWMsQ0FBQztZQUM1RCw0QkFBNEI7YUFDM0IsT0FBTyxDQUFDLDJCQUEyQixFQUFFLFVBQVUsQ0FBQztZQUNqRCxzQkFBc0I7YUFDckIsT0FBTyxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUM7WUFDOUIsOENBQThDO2FBQzdDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDO1lBQ25CLGdDQUFnQzthQUMvQixPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQzthQUNyQixPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQzthQUNyQixPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRTNCLE9BQU8sS0FBSyxDQUFDO0lBQ2pCLENBQUM7SUFFTSxJQUFJO1FBQ1AsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDbEIsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztZQUN2QixPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7UUFDbkQsQ0FBQztRQUVELElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVNLFNBQVM7UUFDWixJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUU1QixPQUFPO1lBQ0gsT0FBTyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVTtZQUMxQixJQUFJLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJO1lBQ3hCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUk7U0FDN0IsQ0FBQztJQUNOLENBQUM7SUFFTyxLQUFLLENBQUMsc0JBQXNCLENBQUMsR0FBeUIsRUFBRSxHQUF3QixFQUFFLFFBQWdCO1FBQ3RHLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUVkLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDckIsSUFBSSxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM3QixDQUFDLENBQUMsQ0FBQztRQUVILEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3JCLElBQUksQ0FBQztnQkFDRCwwREFBMEQ7Z0JBQzFELE1BQU0sU0FBUyxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3JELElBQUksU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDdkIsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDbkIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLG1EQUFtRCxFQUFFLENBQUMsQ0FBQyxDQUFDO29CQUN4RixPQUFPO2dCQUNYLENBQUM7Z0JBRUQsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUM5QixNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQzlCLE1BQU0sWUFBWSxHQUFHLEdBQUcsUUFBUSxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUUvQyxnREFBZ0Q7Z0JBQ2hELElBQUksTUFBTSxDQUFDO2dCQUNYLElBQUksQ0FBQztvQkFDRCxNQUFNLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQzFDLENBQUM7Z0JBQUMsT0FBTyxVQUFlLEVBQUUsQ0FBQztvQkFDdkIseUJBQXlCO29CQUN6QixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ2pELElBQUksQ0FBQzt3QkFDRCxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQzt3QkFDL0IsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO29CQUM1RCxDQUFDO29CQUFDLE9BQU8sV0FBZ0IsRUFBRSxDQUFDO3dCQUN4QixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3dCQUNuQixHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7NEJBQ25CLEtBQUssRUFBRSw4QkFBOEI7NEJBQ3JDLE9BQU8sRUFBRSxVQUFVLENBQUMsT0FBTzs0QkFDM0IsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQzt5QkFDdkMsQ0FBQyxDQUFDLENBQUM7d0JBQ0osT0FBTztvQkFDWCxDQUFDO2dCQUNMLENBQUM7Z0JBRUQsZUFBZTtnQkFDZixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUVoRSxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNuQixHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLE9BQU8sRUFBRSxJQUFJO29CQUNiLElBQUksRUFBRSxZQUFZO29CQUNsQixNQUFNLEVBQUUsTUFBTTtpQkFDakIsQ0FBQyxDQUFDLENBQUM7WUFFUixDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFDbEIsT0FBTyxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDMUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDbkIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQU87b0JBQ3BCLElBQUksRUFBRSxRQUFRO2lCQUNqQixDQUFDLENBQUMsQ0FBQztZQUNSLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFTyxzQkFBc0I7UUFDMUIsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUM3QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNuQyxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDMUIsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFMUMsT0FBTztnQkFDSCxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7Z0JBQ2YsUUFBUSxFQUFFLFFBQVE7Z0JBQ2xCLFFBQVEsRUFBRSxRQUFRO2dCQUNsQixXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7Z0JBQzdCLE9BQU8sRUFBRSxRQUFRLFFBQVEsSUFBSSxRQUFRLEVBQUU7Z0JBQ3ZDLFdBQVcsRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDO2FBQzlFLENBQUM7UUFDTixDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxRQUFnQixFQUFFLFFBQWdCLEVBQUUsTUFBVztRQUN2RSw2Q0FBNkM7UUFDN0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3ZELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUV6RCxPQUFPLDBDQUEwQyxRQUFRLElBQUksUUFBUTs7UUFFckUsVUFBVSxHQUFHLENBQUM7SUFDbEIsQ0FBQztJQUVPLG9CQUFvQixDQUFDLE1BQVc7UUFDcEMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVO1lBQUUsT0FBTyxFQUFFLENBQUM7UUFFN0MsTUFBTSxNQUFNLEdBQVEsRUFBRSxDQUFDO1FBQ3ZCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxVQUFpQixDQUFDLEVBQUUsQ0FBQztZQUNqRSxNQUFNLFVBQVUsR0FBRyxJQUFXLENBQUM7WUFDL0IsUUFBUSxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ3RCLEtBQUssUUFBUTtvQkFDVCxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLE9BQU8sSUFBSSxnQkFBZ0IsQ0FBQztvQkFDckQsTUFBTTtnQkFDVixLQUFLLFFBQVE7b0JBQ1QsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDO29CQUN2QyxNQUFNO2dCQUNWLEtBQUssU0FBUztvQkFDVixNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUM7b0JBQ3pDLE1BQU07Z0JBQ1YsS0FBSyxRQUFRO29CQUNULE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztvQkFDekQsTUFBTTtnQkFDVjtvQkFDSSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsZUFBZSxDQUFDO1lBQ3RDLENBQUM7UUFDTCxDQUFDO1FBQ0QsT0FBTyxNQUFNLENBQUM7SUFDbEIsQ0FBQztJQUVNLGNBQWMsQ0FBQyxRQUEyQjtRQUM3QyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUM3QixDQUFDO0NBQ0o7QUE5Y0QsOEJBOGNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgaHR0cCBmcm9tICdodHRwJztcclxuaW1wb3J0ICogYXMgdXJsIGZyb20gJ3VybCc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5pbXBvcnQgeyBNQ1BTZXJ2ZXJTZXR0aW5ncywgU2VydmVyU3RhdHVzLCBNQ1BDbGllbnQsIFRvb2xEZWZpbml0aW9uIH0gZnJvbSAnLi90eXBlcyc7XHJcbmltcG9ydCB7IFNjZW5lVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLXRvb2xzJztcclxuaW1wb3J0IHsgTm9kZVRvb2xzIH0gZnJvbSAnLi90b29scy9ub2RlLXRvb2xzJztcclxuaW1wb3J0IHsgQ29tcG9uZW50VG9vbHMgfSBmcm9tICcuL3Rvb2xzL2NvbXBvbmVudC10b29scyc7XHJcbmltcG9ydCB7IFByZWZhYlRvb2xzIH0gZnJvbSAnLi90b29scy9wcmVmYWItdG9vbHMnO1xyXG5pbXBvcnQgeyBQcm9qZWN0VG9vbHMgfSBmcm9tICcuL3Rvb2xzL3Byb2plY3QtdG9vbHMnO1xyXG5pbXBvcnQgeyBEZWJ1Z1Rvb2xzIH0gZnJvbSAnLi90b29scy9kZWJ1Zy10b29scyc7XHJcbmltcG9ydCB7IFByZWZlcmVuY2VzVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ByZWZlcmVuY2VzLXRvb2xzJztcclxuaW1wb3J0IHsgU2VydmVyVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NlcnZlci10b29scyc7XHJcbmltcG9ydCB7IEJyb2FkY2FzdFRvb2xzIH0gZnJvbSAnLi90b29scy9icm9hZGNhc3QtdG9vbHMnO1xyXG5pbXBvcnQgeyBTY2VuZUFkdmFuY2VkVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLWFkdmFuY2VkLXRvb2xzJztcclxuaW1wb3J0IHsgU2NlbmVWaWV3VG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLXZpZXctdG9vbHMnO1xyXG5pbXBvcnQgeyBSZWZlcmVuY2VJbWFnZVRvb2xzIH0gZnJvbSAnLi90b29scy9yZWZlcmVuY2UtaW1hZ2UtdG9vbHMnO1xyXG5pbXBvcnQgeyBBc3NldEFkdmFuY2VkVG9vbHMgfSBmcm9tICcuL3Rvb2xzL2Fzc2V0LWFkdmFuY2VkLXRvb2xzJztcbmltcG9ydCB7IFZhbGlkYXRpb25Ub29scyB9IGZyb20gJy4vdG9vbHMvdmFsaWRhdGlvbi10b29scyc7XG5cbmNvbnN0IENMSUVOVF9BQ1RJVklUWV9USU1FT1VUX01TID0gMzBfMDAwO1xuXG5leHBvcnQgY2xhc3MgTUNQU2VydmVyIHtcbiAgICBwcml2YXRlIHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncztcclxuICAgIHByaXZhdGUgaHR0cFNlcnZlcjogaHR0cC5TZXJ2ZXIgfCBudWxsID0gbnVsbDtcclxuICAgIHByaXZhdGUgY2xpZW50czogTWFwPHN0cmluZywgTUNQQ2xpZW50PiA9IG5ldyBNYXAoKTtcclxuICAgIHByaXZhdGUgdG9vbHM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcclxuICAgIHByaXZhdGUgdG9vbHNMaXN0OiBUb29sRGVmaW5pdGlvbltdID0gW107XHJcbiAgICBwcml2YXRlIGVuYWJsZWRUb29sczogYW55W10gPSBbXTsgLy8gU3RvcmVzIHRoZSBsaXN0IG9mIGVuYWJsZWQgdG9vbHMuXHJcblxyXG4gICAgY29uc3RydWN0b3Ioc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzKSB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHNldHRpbmdzO1xyXG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZVRvb2xzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBpbml0aWFsaXplVG9vbHMoKTogdm9pZCB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1BTZXJ2ZXJdIEluaXRpYWxpemluZyB0b29scy4uLicpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnNjZW5lID0gbmV3IFNjZW5lVG9vbHMoKTtcclxuICAgICAgICAgICAgdGhpcy50b29scy5ub2RlID0gbmV3IE5vZGVUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLmNvbXBvbmVudCA9IG5ldyBDb21wb25lbnRUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnByZWZhYiA9IG5ldyBQcmVmYWJUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnByb2plY3QgPSBuZXcgUHJvamVjdFRvb2xzKCk7XHJcbiAgICAgICAgICAgIHRoaXMudG9vbHMuZGVidWcgPSBuZXcgRGVidWdUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnByZWZlcmVuY2VzID0gbmV3IFByZWZlcmVuY2VzVG9vbHMoKTtcclxuICAgICAgICAgICAgdGhpcy50b29scy5zZXJ2ZXIgPSBuZXcgU2VydmVyVG9vbHMoKTtcclxuICAgICAgICAgICAgdGhpcy50b29scy5icm9hZGNhc3QgPSBuZXcgQnJvYWRjYXN0VG9vbHMoKTtcclxuICAgICAgICAgICAgdGhpcy50b29scy5zY2VuZUFkdmFuY2VkID0gbmV3IFNjZW5lQWR2YW5jZWRUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnNjZW5lVmlldyA9IG5ldyBTY2VuZVZpZXdUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnJlZmVyZW5jZUltYWdlID0gbmV3IFJlZmVyZW5jZUltYWdlVG9vbHMoKTtcclxuICAgICAgICAgICAgdGhpcy50b29scy5hc3NldEFkdmFuY2VkID0gbmV3IEFzc2V0QWR2YW5jZWRUb29scygpO1xyXG4gICAgICAgICAgICB0aGlzLnRvb2xzLnZhbGlkYXRpb24gPSBuZXcgVmFsaWRhdGlvblRvb2xzKCk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbTUNQU2VydmVyXSBUb29scyBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHknKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTUNQU2VydmVyXSBFcnJvciBpbml0aWFsaXppbmcgdG9vbHM6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGlmICh0aGlzLmh0dHBTZXJ2ZXIpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1BTZXJ2ZXJdIFNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmcnKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNQ1BTZXJ2ZXJdIFN0YXJ0aW5nIEhUVFAgc2VydmVyIG9uIHBvcnQgJHt0aGlzLnNldHRpbmdzLnBvcnR9Li4uYCk7XHJcbiAgICAgICAgICAgIHRoaXMuaHR0cFNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKHRoaXMuaGFuZGxlSHR0cFJlcXVlc3QuYmluZCh0aGlzKSk7XHJcblxyXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmh0dHBTZXJ2ZXIhLmxpc3Rlbih0aGlzLnNldHRpbmdzLnBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNQ1BTZXJ2ZXJdIOKchSBIVFRQIHNlcnZlciBzdGFydGVkIHN1Y2Nlc3NmdWxseSBvbiBodHRwOi8vMTI3LjAuMC4xOiR7dGhpcy5zZXR0aW5ncy5wb3J0fWApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBIZWFsdGggY2hlY2s6IGh0dHA6Ly8xMjcuMC4wLjE6JHt0aGlzLnNldHRpbmdzLnBvcnR9L2hlYWx0aGApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTUNQU2VydmVyXSBNQ1AgZW5kcG9pbnQ6IGh0dHA6Ly8xMjcuMC4wLjE6JHt0aGlzLnNldHRpbmdzLnBvcnR9L21jcGApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5odHRwU2VydmVyIS5vbignZXJyb3InLCAoZXJyOiBhbnkpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTUNQU2VydmVyXSDinYwgRmFpbGVkIHRvIHN0YXJ0IHNlcnZlcjonLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PT0gJ0VBRERSSU5VU0UnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNQ1BTZXJ2ZXJdIFBvcnQgJHt0aGlzLnNldHRpbmdzLnBvcnR9IGlzIGFscmVhZHkgaW4gdXNlLiBQbGVhc2UgY2hhbmdlIHRoZSBwb3J0IGluIHNldHRpbmdzLmApO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuc2V0dXBUb29scygpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUFNlcnZlcl0g8J+agCBNQ1AgU2VydmVyIGlzIHJlYWR5IGZvciBjb25uZWN0aW9ucycpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNQ1BTZXJ2ZXJdIOKdjCBGYWlsZWQgdG8gc3RhcnQgc2VydmVyOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgc2V0dXBUb29scygpOiB2b2lkIHtcclxuICAgICAgICB0aGlzLnRvb2xzTGlzdCA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIG5vIHRvb2wgY29uZmlndXJhdGlvbiBpcyBlbmFibGVkLCBleHBvc2UgYWxsIHRvb2xzLlxyXG4gICAgICAgIGlmICghdGhpcy5lbmFibGVkVG9vbHMgfHwgdGhpcy5lbmFibGVkVG9vbHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgW2NhdGVnb3J5LCB0b29sU2V0XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnRvb2xzKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdG9vbHMgPSB0b29sU2V0LmdldFRvb2xzKCk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHRvb2wgb2YgdG9vbHMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnRvb2xzTGlzdC5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYCR7Y2F0ZWdvcnl9XyR7dG9vbC5uYW1lfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0b29sLmRlc2NyaXB0aW9uLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogdG9vbC5pbnB1dFNjaGVtYVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gRmlsdGVyIHRvb2xzIGJhc2VkIG9uIHRoZSBlbmFibGVkIHRvb2wgY29uZmlndXJhdGlvbi5cclxuICAgICAgICAgICAgY29uc3QgZW5hYmxlZFRvb2xOYW1lcyA9IG5ldyBTZXQodGhpcy5lbmFibGVkVG9vbHMubWFwKHRvb2wgPT4gYCR7dG9vbC5jYXRlZ29yeX1fJHt0b29sLm5hbWV9YCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbY2F0ZWdvcnksIHRvb2xTZXRdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMudG9vbHMpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0b29scyA9IHRvb2xTZXQuZ2V0VG9vbHMoKTtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdG9vbCBvZiB0b29scykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xOYW1lID0gYCR7Y2F0ZWdvcnl9XyR7dG9vbC5uYW1lfWA7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVuYWJsZWRUb29sTmFtZXMuaGFzKHRvb2xOYW1lKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnRvb2xzTGlzdC5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHRvb2xOYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IHRvb2wuZGVzY3JpcHRpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogdG9vbC5pbnB1dFNjaGVtYVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coYFtNQ1BTZXJ2ZXJdIFNldHVwIHRvb2xzOiAke3RoaXMudG9vbHNMaXN0Lmxlbmd0aH0gdG9vbHMgYXZhaWxhYmxlYCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldEZpbHRlcmVkVG9vbHMoZW5hYmxlZFRvb2xzOiBhbnlbXSk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIGlmICghZW5hYmxlZFRvb2xzIHx8IGVuYWJsZWRUb29scy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0OyAvLyBJZiBubyBmaWx0ZXIgaXMgY29uZmlndXJlZCwgcmV0dXJuIGFsbCB0b29scy5cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGVuYWJsZWRUb29sTmFtZXMgPSBuZXcgU2V0KGVuYWJsZWRUb29scy5tYXAodG9vbCA9PiBgJHt0b29sLmNhdGVnb3J5fV8ke3Rvb2wubmFtZX1gKSk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0LmZpbHRlcih0b29sID0+IGVuYWJsZWRUb29sTmFtZXMuaGFzKHRvb2wubmFtZSkpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBhc3luYyBleGVjdXRlVG9vbENhbGwodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxhbnk+IHtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHRvb2xOYW1lLnNwbGl0KCdfJyk7XHJcbiAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSBwYXJ0c1swXTtcclxuICAgICAgICBjb25zdCB0b29sTWV0aG9kTmFtZSA9IHBhcnRzLnNsaWNlKDEpLmpvaW4oJ18nKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy50b29sc1tjYXRlZ29yeV0pIHtcclxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudG9vbHNbY2F0ZWdvcnldLmV4ZWN1dGUodG9vbE1ldGhvZE5hbWUsIGFyZ3MpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRvb2wgJHt0b29sTmFtZX0gbm90IGZvdW5kYCk7XHJcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q2xpZW50cygpOiBNQ1BDbGllbnRbXSB7XG4gICAgICAgIHRoaXMucHJ1bmVJbmFjdGl2ZUNsaWVudHMoKTtcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5jbGllbnRzLnZhbHVlcygpKTtcbiAgICB9XG4gICAgcHVibGljIGdldEF2YWlsYWJsZVRvb2xzKCk6IFRvb2xEZWZpbml0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnRvb2xzTGlzdDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29sczogYW55W10pOiB2b2lkIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01DUFNlcnZlcl0gVXBkYXRpbmcgZW5hYmxlZCB0b29sczogJHtlbmFibGVkVG9vbHMubGVuZ3RofSB0b29sc2ApO1xyXG4gICAgICAgIHRoaXMuZW5hYmxlZFRvb2xzID0gZW5hYmxlZFRvb2xzO1xyXG4gICAgICAgIHRoaXMuc2V0dXBUb29scygpOyAvLyBSZWJ1aWxkIHRoZSB0b29sIGxpc3QuXHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldFNldHRpbmdzKCk6IE1DUFNlcnZlclNldHRpbmdzIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5zZXR0aW5ncztcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZUh0dHBSZXF1ZXN0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IHVybC5wYXJzZShyZXEudXJsIHx8ICcnLCB0cnVlKTtcclxuICAgICAgICBjb25zdCBwYXRobmFtZSA9IHBhcnNlZFVybC5wYXRobmFtZTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZXQgQ09SUyBoZWFkZXJzXHJcbiAgICAgICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKTtcclxuICAgICAgICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJywgJ0dFVCwgUE9TVCwgT1BUSU9OUycpO1xyXG4gICAgICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uJyk7XHJcbiAgICAgICAgcmVzLnNldEhlYWRlcignQ29udGVudC1UeXBlJywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XHJcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwKTtcclxuICAgICAgICAgICAgcmVzLmVuZCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAocGF0aG5hbWUgPT09ICcvbWNwJyAmJiByZXEubWV0aG9kID09PSAnUE9TVCcpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlY29yZENsaWVudEFjdGl2aXR5KHJlcSk7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oYW5kbGVNQ1BSZXF1ZXN0KHJlcSwgcmVzKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocGF0aG5hbWUgPT09ICcvaGVhbHRoJyAmJiByZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwKTtcclxuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXM6ICdvaycsIHRvb2xzOiB0aGlzLnRvb2xzTGlzdC5sZW5ndGggfSkpO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhdGhuYW1lPy5zdGFydHNXaXRoKCcvYXBpLycpICYmIHJlcS5tZXRob2QgPT09ICdQT1NUJykge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTaW1wbGVBUElSZXF1ZXN0KHJlcSwgcmVzLCBwYXRobmFtZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocGF0aG5hbWUgPT09ICcvYXBpL3Rvb2xzJyAmJiByZXEubWV0aG9kID09PSAnR0VUJykge1xyXG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDApO1xyXG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IHRvb2xzOiB0aGlzLmdldFNpbXBsaWZpZWRUb29sc0xpc3QoKSB9KSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwNCk7XHJcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdOb3QgZm91bmQnIH0pKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0hUVFAgcmVxdWVzdCBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNTAwKTtcclxuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yJyB9KSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIGFzeW5jIGhhbmRsZU1DUFJlcXVlc3QocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSwgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgbGV0IGJvZHkgPSAnJztcclxuICAgICAgICBcclxuICAgICAgICByZXEub24oJ2RhdGEnLCAoY2h1bmspID0+IHtcclxuICAgICAgICAgICAgYm9keSArPSBjaHVuay50b1N0cmluZygpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJlcS5vbignZW5kJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgLy8gRW5oYW5jZWQgSlNPTiBwYXJzaW5nIHdpdGggYmV0dGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgICAgICBsZXQgbWVzc2FnZTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZSA9IEpTT04ucGFyc2UoYm9keSk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChwYXJzZUVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBUcnkgdG8gZml4IGNvbW1vbiBKU09OIGlzc3Vlc1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpeGVkQm9keSA9IHRoaXMuZml4Q29tbW9uSnNvbklzc3Vlcyhib2R5KTtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlID0gSlNPTi5wYXJzZShmaXhlZEJvZHkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUFNlcnZlcl0gRml4ZWQgSlNPTiBwYXJzaW5nIGlzc3VlJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoc2Vjb25kRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBKU09OIHBhcnNpbmcgZmFpbGVkOiAke3BhcnNlRXJyb3IubWVzc2FnZX0uIE9yaWdpbmFsIGJvZHk6ICR7Ym9keS5zdWJzdHJpbmcoMCwgNTAwKX0uLi5gKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5oYW5kbGVNZXNzYWdlKG1lc3NhZ2UpO1xyXG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDApO1xyXG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBoYW5kbGluZyBNQ1AgcmVxdWVzdDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCk7XHJcbiAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgICAgICAgICBqc29ucnBjOiAnMi4wJyxcclxuICAgICAgICAgICAgICAgICAgICBpZDogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiAtMzI3MDAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBQYXJzZSBlcnJvcjogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlY29yZENsaWVudEFjdGl2aXR5KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5wcnVuZUluYWN0aXZlQ2xpZW50cygpO1xuXG4gICAgICAgIGNvbnN0IHVzZXJBZ2VudCA9IHJlcS5oZWFkZXJzWyd1c2VyLWFnZW50J107XG4gICAgICAgIGNvbnN0IGNsaWVudEtleSA9IGAke3JlcS5zb2NrZXQucmVtb3RlQWRkcmVzcyB8fCAndW5rbm93bid9fCR7dXNlckFnZW50IHx8ICd1bmtub3duJ31gO1xuICAgICAgICBjb25zdCBleGlzdGluZ0NsaWVudCA9IHRoaXMuY2xpZW50cy5nZXQoY2xpZW50S2V5KTtcblxuICAgICAgICB0aGlzLmNsaWVudHMuc2V0KGNsaWVudEtleSwge1xuICAgICAgICAgICAgaWQ6IGV4aXN0aW5nQ2xpZW50Py5pZCB8fCB1dWlkdjQoKSxcbiAgICAgICAgICAgIGxhc3RBY3Rpdml0eTogbmV3IERhdGUoKSxcbiAgICAgICAgICAgIHVzZXJBZ2VudFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHBydW5lSW5hY3RpdmVDbGllbnRzKCk6IHZvaWQge1xuICAgICAgICBjb25zdCBjdXRvZmZUaW1lID0gRGF0ZS5ub3coKSAtIENMSUVOVF9BQ1RJVklUWV9USU1FT1VUX01TO1xuXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgY2xpZW50XSBvZiB0aGlzLmNsaWVudHMuZW50cmllcygpKSB7XG4gICAgICAgICAgICBpZiAoY2xpZW50Lmxhc3RBY3Rpdml0eS5nZXRUaW1lKCkgPCBjdXRvZmZUaW1lKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbGllbnRzLmRlbGV0ZShrZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKG1lc3NhZ2U6IGFueSk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGNvbnN0IHsgaWQsIG1ldGhvZCwgcGFyYW1zIH0gPSBtZXNzYWdlO1xyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBsZXQgcmVzdWx0OiBhbnk7XHJcblxyXG4gICAgICAgICAgICBzd2l0Y2ggKG1ldGhvZCkge1xyXG4gICAgICAgICAgICAgICAgY2FzZSAndG9vbHMvbGlzdCc6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0geyB0b29sczogdGhpcy5nZXRBdmFpbGFibGVUb29scygpIH07XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICBjYXNlICd0b29scy9jYWxsJzpcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB7IG5hbWUsIGFyZ3VtZW50czogYXJncyB9ID0gcGFyYW1zO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xSZXN1bHQgPSBhd2FpdCB0aGlzLmV4ZWN1dGVUb29sQ2FsbChuYW1lLCBhcmdzKTtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB7IGNvbnRlbnQ6IFt7IHR5cGU6ICd0ZXh0JywgdGV4dDogSlNPTi5zdHJpbmdpZnkodG9vbFJlc3VsdCkgfV0gfTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ2luaXRpYWxpemUnOlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIE1DUCBpbml0aWFsaXphdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvdG9jb2xWZXJzaW9uOiAnMjAyNC0xMS0wNScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhcGFiaWxpdGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHM6IHt9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZlckluZm86IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdjb2Nvcy1tY3Atc2VydmVyJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZlcnNpb246ICcxLjAuMCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBtZXRob2Q6ICR7bWV0aG9kfWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAganNvbnJwYzogJzIuMCcsXHJcbiAgICAgICAgICAgICAgICBpZCxcclxuICAgICAgICAgICAgICAgIHJlc3VsdFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGpzb25ycGM6ICcyLjAnLFxyXG4gICAgICAgICAgICAgICAgaWQsXHJcbiAgICAgICAgICAgICAgICBlcnJvcjoge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IC0zMjYwMyxcclxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZml4Q29tbW9uSnNvbklzc3Vlcyhqc29uU3RyOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgICAgIGxldCBmaXhlZCA9IGpzb25TdHI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRml4IGNvbW1vbiBlc2NhcGUgY2hhcmFjdGVyIGlzc3Vlc1xyXG4gICAgICAgIGZpeGVkID0gZml4ZWRcclxuICAgICAgICAgICAgLy8gRml4IHVuZXNjYXBlZCBxdW90ZXMgaW4gc3RyaW5nc1xyXG4gICAgICAgICAgICAucmVwbGFjZSgvKFteXFxcXF0pXCIoW15cIl0qW15cXFxcXSlcIihbXix9XFxdOl0pL2csICckMVxcXFxcIiQyXFxcXFwiJDMnKVxyXG4gICAgICAgICAgICAvLyBGaXggdW5lc2NhcGVkIGJhY2tzbGFzaGVzXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC8oW15cXFxcXSlcXFxcKFteXCJcXFxcXFwvYmZucnRdKS9nLCAnJDFcXFxcXFxcXCQyJylcclxuICAgICAgICAgICAgLy8gRml4IHRyYWlsaW5nIGNvbW1hc1xyXG4gICAgICAgICAgICAucmVwbGFjZSgvLChcXHMqW31cXF1dKS9nLCAnJDEnKVxyXG4gICAgICAgICAgICAvLyBGaXggc2luZ2xlIHF1b3RlcyAoc2hvdWxkIGJlIGRvdWJsZSBxdW90ZXMpXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC8nL2csICdcIicpXHJcbiAgICAgICAgICAgIC8vIEZpeCBjb21tb24gY29udHJvbCBjaGFyYWN0ZXJzXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXG4vZywgJ1xcXFxuJylcclxuICAgICAgICAgICAgLnJlcGxhY2UoL1xcci9nLCAnXFxcXHInKVxyXG4gICAgICAgICAgICAucmVwbGFjZSgvXFx0L2csICdcXFxcdCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBmaXhlZDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgc3RvcCgpOiB2b2lkIHtcclxuICAgICAgICBpZiAodGhpcy5odHRwU2VydmVyKSB7XHJcbiAgICAgICAgICAgIHRoaXMuaHR0cFNlcnZlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB0aGlzLmh0dHBTZXJ2ZXIgPSBudWxsO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUFNlcnZlcl0gSFRUUCBzZXJ2ZXIgc3RvcHBlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5jbGllbnRzLmNsZWFyKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldFN0YXR1cygpOiBTZXJ2ZXJTdGF0dXMge1xuICAgICAgICB0aGlzLnBydW5lSW5hY3RpdmVDbGllbnRzKCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJ1bm5pbmc6ICEhdGhpcy5odHRwU2VydmVyLFxuICAgICAgICAgICAgcG9ydDogdGhpcy5zZXR0aW5ncy5wb3J0LFxuICAgICAgICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemVcbiAgICAgICAgfTtcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTaW1wbGVBUElSZXF1ZXN0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSwgcGF0aG5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGxldCBib2R5ID0gJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmVxLm9uKCdkYXRhJywgKGNodW5rKSA9PiB7XHJcbiAgICAgICAgICAgIGJvZHkgKz0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICByZXEub24oJ2VuZCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgdG9vbCBuYW1lIGZyb20gcGF0aCBsaWtlIC9hcGkvbm9kZS9zZXRfcG9zaXRpb25cclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGhuYW1lLnNwbGl0KCcvJykuZmlsdGVyKHAgPT4gcCk7XHJcbiAgICAgICAgICAgICAgICBpZiAocGF0aFBhcnRzLmxlbmd0aCA8IDMpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCBBUEkgcGF0aC4gVXNlIC9hcGkve2NhdGVnb3J5fS97dG9vbF9uYW1lfScgfSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSBwYXRoUGFydHNbMV07XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0b29sTmFtZSA9IHBhdGhQYXJ0c1syXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZ1bGxUb29sTmFtZSA9IGAke2NhdGVnb3J5fV8ke3Rvb2xOYW1lfWA7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFBhcnNlIHBhcmFtZXRlcnMgd2l0aCBlbmhhbmNlZCBlcnJvciBoYW5kbGluZ1xyXG4gICAgICAgICAgICAgICAgbGV0IHBhcmFtcztcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zID0gYm9keSA/IEpTT04ucGFyc2UoYm9keSkgOiB7fTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHBhcnNlRXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRyeSB0byBmaXggSlNPTiBpc3N1ZXNcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaXhlZEJvZHkgPSB0aGlzLmZpeENvbW1vbkpzb25Jc3N1ZXMoYm9keSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1zID0gSlNPTi5wYXJzZShmaXhlZEJvZHkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUFNlcnZlcl0gRml4ZWQgQVBJIEpTT04gcGFyc2luZyBpc3N1ZScpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHNlY29uZEVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXRhaWxzOiBwYXJzZUVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWNlaXZlZEJvZHk6IGJvZHkuc3Vic3RyaW5nKDAsIDIwMClcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBFeGVjdXRlIHRvb2xcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZXhlY3V0ZVRvb2xDYWxsKGZ1bGxUb29sTmFtZSwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDApO1xyXG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICB0b29sOiBmdWxsVG9vbE5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiByZXN1bHRcclxuICAgICAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdTaW1wbGUgQVBJIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNTAwKTtcclxuICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRvb2w6IHBhdGhuYW1lXHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldFNpbXBsaWZpZWRUb29sc0xpc3QoKTogYW55W10ge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnRvb2xzTGlzdC5tYXAodG9vbCA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gdG9vbC5uYW1lLnNwbGl0KCdfJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5ID0gcGFydHNbMF07XHJcbiAgICAgICAgICAgIGNvbnN0IHRvb2xOYW1lID0gcGFydHMuc2xpY2UoMSkuam9pbignXycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6IHRvb2wubmFtZSxcclxuICAgICAgICAgICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeSxcclxuICAgICAgICAgICAgICAgIHRvb2xOYW1lOiB0b29sTmFtZSxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0b29sLmRlc2NyaXB0aW9uLFxyXG4gICAgICAgICAgICAgICAgYXBpUGF0aDogYC9hcGkvJHtjYXRlZ29yeX0vJHt0b29sTmFtZX1gLFxyXG4gICAgICAgICAgICAgICAgY3VybEV4YW1wbGU6IHRoaXMuZ2VuZXJhdGVDdXJsRXhhbXBsZShjYXRlZ29yeSwgdG9vbE5hbWUsIHRvb2wuaW5wdXRTY2hlbWEpXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBnZW5lcmF0ZUN1cmxFeGFtcGxlKGNhdGVnb3J5OiBzdHJpbmcsIHRvb2xOYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55KTogc3RyaW5nIHtcclxuICAgICAgICAvLyBHZW5lcmF0ZSBzYW1wbGUgcGFyYW1ldGVycyBiYXNlZCBvbiBzY2hlbWFcclxuICAgICAgICBjb25zdCBzYW1wbGVQYXJhbXMgPSB0aGlzLmdlbmVyYXRlU2FtcGxlUGFyYW1zKHNjaGVtYSk7XHJcbiAgICAgICAgY29uc3QganNvblN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHNhbXBsZVBhcmFtcywgbnVsbCwgMik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGBjdXJsIC1YIFBPU1QgaHR0cDovLzEyNy4wLjAuMTo4NTg1L2FwaS8ke2NhdGVnb3J5fS8ke3Rvb2xOYW1lfSBcXFxcXHJcbiAgLUggXCJDb250ZW50LVR5cGU6IGFwcGxpY2F0aW9uL2pzb25cIiBcXFxcXHJcbiAgLWQgJyR7anNvblN0cmluZ30nYDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdlbmVyYXRlU2FtcGxlUGFyYW1zKHNjaGVtYTogYW55KTogYW55IHtcclxuICAgICAgICBpZiAoIXNjaGVtYSB8fCAhc2NoZW1hLnByb3BlcnRpZXMpIHJldHVybiB7fTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBzYW1wbGU6IGFueSA9IHt9O1xyXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgcHJvcF0gb2YgT2JqZWN0LmVudHJpZXMoc2NoZW1hLnByb3BlcnRpZXMgYXMgYW55KSkge1xyXG4gICAgICAgICAgICBjb25zdCBwcm9wU2NoZW1hID0gcHJvcCBhcyBhbnk7XHJcbiAgICAgICAgICAgIHN3aXRjaCAocHJvcFNjaGVtYS50eXBlKSB7XHJcbiAgICAgICAgICAgICAgICBjYXNlICdzdHJpbmcnOlxyXG4gICAgICAgICAgICAgICAgICAgIHNhbXBsZVtrZXldID0gcHJvcFNjaGVtYS5kZWZhdWx0IHx8ICdleGFtcGxlX3N0cmluZyc7XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICBjYXNlICdudW1iZXInOlxyXG4gICAgICAgICAgICAgICAgICAgIHNhbXBsZVtrZXldID0gcHJvcFNjaGVtYS5kZWZhdWx0IHx8IDQyO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSAnYm9vbGVhbic6XHJcbiAgICAgICAgICAgICAgICAgICAgc2FtcGxlW2tleV0gPSBwcm9wU2NoZW1hLmRlZmF1bHQgfHwgdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIGNhc2UgJ29iamVjdCc6XHJcbiAgICAgICAgICAgICAgICAgICAgc2FtcGxlW2tleV0gPSBwcm9wU2NoZW1hLmRlZmF1bHQgfHwgeyB4OiAwLCB5OiAwLCB6OiAwIH07XHJcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgICAgIHNhbXBsZVtrZXldID0gJ2V4YW1wbGVfdmFsdWUnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBzYW1wbGU7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHVwZGF0ZVNldHRpbmdzKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgfVxufVxuIl19