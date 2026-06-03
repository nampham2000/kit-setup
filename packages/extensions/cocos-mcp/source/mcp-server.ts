/**
 * Cocos Creator MCP server orchestrator.
 *
 * Owns the tool registry and the Streamable HTTP transport. The actual
 * JSON‑RPC / MCP protocol is implemented by {@link ProtocolHandler} so it
 * can be reused by stdio (and future WebSocket) transports.
 *
 * Phase 1 capabilities:
 *  - A1 Streamable HTTP transport (GET/POST/DELETE /mcp, Mcp-Session-Id, SSE)
 *  - A4 Origin allow‑list + DNS rebinding guard
 *  - A5 ****** auth
 *  - A6 logging/setLevel + notifications/message
 *  - A7 notifications/progress
 *  - A8 AbortSignal cancellation
 *  - G1 Tool annotations on tools/list
 *  - G3 outputSchema on tools/list + structuredContent on tools/call
 *  - G4 Pagination cursor on tools/list
 *  - G8 Ajv input validation → -32602
 *  - G9 protocolVersion handshake with feature flags
 */

import { MCPServerSettings, MCPClient, ServerStatus, ToolDefinition } from './types';
import { ProtocolHandler, ToolExecutionContext, ToolRegistry } from './protocol/protocol-handler';
import { StreamableHttpServer } from './transport/streamable-http';
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

/**
 * The tool registry used by all transports. Wraps the legacy per‑category
 * tool classes and exposes the unified {@link ToolRegistry} interface used by
 * {@link ProtocolHandler}.
 */
export class CocosToolRegistry implements ToolRegistry {
    private tools: Record<string, any> = {};
    private toolsList: ToolDefinition[] = [];
    private enabledTools: { category: string; name: string }[] = [];

    constructor() {
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
        this.rebuild();
    }

    public updateEnabledTools(enabled: { category: string; name: string }[]): void {
        this.enabledTools = enabled || [];
        this.rebuild();
    }

    public listTools(): ToolDefinition[] {
        return this.toolsList;
    }

    public getFilteredTools(enabled: { category: string; name: string }[]): ToolDefinition[] {
        if (!enabled || enabled.length === 0) return this.toolsList;
        const allowed = new Set(enabled.map((t) => `${t.category}_${t.name}`));
        return this.toolsList.filter((t) => allowed.has(t.name));
    }

    public async executeToolCall(name: string, args: any, ctx: ToolExecutionContext): Promise<any> {
        const idx = name.indexOf('_');
        if (idx < 0) throw new Error(`Invalid tool name: ${name}`);
        const category = name.slice(0, idx);
        const tool = name.slice(idx + 1);
        if (!this.tools[category]) throw new Error(`Tool category not found: ${category}`);

        // A8: surface AbortSignal to tools that support it. Legacy tools ignore the
        // 3rd argument harmlessly; new tools can take advantage. We still poll the
        // signal here so that even synchronous tools terminate promptly.
        if (ctx.signal.aborted) throw new Error('cancelled');
        return await this.tools[category].execute(tool, args, ctx);
    }

    private rebuild(): void {
        this.toolsList = [];
        const enabledNames = this.enabledTools.length
            ? new Set(this.enabledTools.map((t) => `${t.category}_${t.name}`))
            : null;
        for (const [category, toolSet] of Object.entries(this.tools)) {
            const defs: ToolDefinition[] = toolSet.getTools();
            for (const def of defs) {
                const fq = `${category}_${def.name}`;
                if (enabledNames && !enabledNames.has(fq)) continue;
                this.toolsList.push({
                    name: fq,
                    description: def.description,
                    inputSchema: def.inputSchema,
                    outputSchema: def.outputSchema,
                    annotations: def.annotations
                });
            }
        }
    }
}

export class MCPServer {
    private settings: MCPServerSettings;
    private registry: CocosToolRegistry;
    private transport: StreamableHttpServer;
    private handlersBySession = new Map<string, ProtocolHandler>();

    constructor(settings: MCPServerSettings) {
        this.settings = settings;
        this.registry = new CocosToolRegistry();
        this.transport = new StreamableHttpServer({
            settings,
            createHandler: (sessionId) => {
                const h = new ProtocolHandler({
                    registry: this.registry,
                    pageSize: this.settings.toolsPageSize ?? 100,
                    initialLogLevel: this.settings.logLevel ?? 'info'
                });
                this.handlersBySession.set(sessionId, h);
                return h;
            },
            onSessionTerminated: (sessionId) => this.handlersBySession.delete(sessionId)
        });
    }

    public async start(): Promise<void> {
        await this.transport.start();
        console.log(`[MCPServer] Streamable HTTP listening on http://127.0.0.1:${this.settings.port}/mcp`);
    }

    public stop(): void {
        this.transport.stop();
        this.handlersBySession.clear();
    }

    public updateSettings(settings: MCPServerSettings): void {
        this.settings = settings;
        this.transport.updateSettings(settings);
        for (const h of this.handlersBySession.values()) {
            if (settings.logLevel) h.setLogLevel(settings.logLevel);
        }
    }

    public updateEnabledTools(enabledTools: any[]): void {
        this.registry.updateEnabledTools(enabledTools);
        for (const h of this.handlersBySession.values()) h.clearValidatorCache();
    }

    public getRegistry(): CocosToolRegistry {
        return this.registry;
    }

    public getStatus(): ServerStatus {
        return {
            running: this.transport.getRunning(),
            port: this.transport.getPort(),
            clients: this.transport.getSessionCount()
        };
    }

    public getClients(): MCPClient[] {
        return this.transport.getClients();
    }

    public getSettings(): MCPServerSettings {
        return this.settings;
    }

    public getAvailableTools(): ToolDefinition[] {
        return this.registry.listTools();
    }

    public getFilteredTools(enabledTools: any[]): ToolDefinition[] {
        return this.registry.getFilteredTools(enabledTools);
    }
}
