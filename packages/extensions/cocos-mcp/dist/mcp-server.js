"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPServer = exports.CocosToolRegistry = void 0;
const protocol_handler_1 = require("./protocol/protocol-handler");
const streamable_http_1 = require("./transport/streamable-http");
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
/**
 * The tool registry used by all transports. Wraps the legacy per‑category
 * tool classes and exposes the unified {@link ToolRegistry} interface used by
 * {@link ProtocolHandler}.
 */
class CocosToolRegistry {
    constructor() {
        this.tools = {};
        this.toolsList = [];
        this.enabledTools = [];
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
        this.rebuild();
    }
    updateEnabledTools(enabled) {
        this.enabledTools = enabled || [];
        this.rebuild();
    }
    listTools() {
        return this.toolsList;
    }
    getFilteredTools(enabled) {
        if (!enabled || enabled.length === 0)
            return this.toolsList;
        const allowed = new Set(enabled.map((t) => `${t.category}_${t.name}`));
        return this.toolsList.filter((t) => allowed.has(t.name));
    }
    async executeToolCall(name, args, ctx) {
        const idx = name.indexOf('_');
        if (idx < 0)
            throw new Error(`Invalid tool name: ${name}`);
        const category = name.slice(0, idx);
        const tool = name.slice(idx + 1);
        if (!this.tools[category])
            throw new Error(`Tool category not found: ${category}`);
        // A8: surface AbortSignal to tools that support it. Legacy tools ignore the
        // 3rd argument harmlessly; new tools can take advantage. We still poll the
        // signal here so that even synchronous tools terminate promptly.
        if (ctx.signal.aborted)
            throw new Error('cancelled');
        return await this.tools[category].execute(tool, args, ctx);
    }
    rebuild() {
        this.toolsList = [];
        const enabledNames = this.enabledTools.length
            ? new Set(this.enabledTools.map((t) => `${t.category}_${t.name}`))
            : null;
        for (const [category, toolSet] of Object.entries(this.tools)) {
            const defs = toolSet.getTools();
            for (const def of defs) {
                const fq = `${category}_${def.name}`;
                if (enabledNames && !enabledNames.has(fq))
                    continue;
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
exports.CocosToolRegistry = CocosToolRegistry;
class MCPServer {
    constructor(settings) {
        this.handlersBySession = new Map();
        this.settings = settings;
        this.registry = new CocosToolRegistry();
        this.transport = new streamable_http_1.StreamableHttpServer({
            settings,
            createHandler: (sessionId) => {
                var _a, _b;
                const h = new protocol_handler_1.ProtocolHandler({
                    registry: this.registry,
                    pageSize: (_a = this.settings.toolsPageSize) !== null && _a !== void 0 ? _a : 100,
                    initialLogLevel: (_b = this.settings.logLevel) !== null && _b !== void 0 ? _b : 'info'
                });
                this.handlersBySession.set(sessionId, h);
                return h;
            },
            onSessionTerminated: (sessionId) => this.handlersBySession.delete(sessionId)
        });
    }
    async start() {
        await this.transport.start();
        console.log(`[MCPServer] Streamable HTTP listening on http://127.0.0.1:${this.settings.port}/mcp`);
    }
    stop() {
        this.transport.stop();
        this.handlersBySession.clear();
    }
    updateSettings(settings) {
        this.settings = settings;
        this.transport.updateSettings(settings);
        for (const h of this.handlersBySession.values()) {
            if (settings.logLevel)
                h.setLogLevel(settings.logLevel);
        }
    }
    updateEnabledTools(enabledTools) {
        this.registry.updateEnabledTools(enabledTools);
        for (const h of this.handlersBySession.values())
            h.clearValidatorCache();
    }
    getRegistry() {
        return this.registry;
    }
    getStatus() {
        return {
            running: this.transport.getRunning(),
            port: this.transport.getPort(),
            clients: this.transport.getSessionCount()
        };
    }
    getClients() {
        return this.transport.getClients();
    }
    getSettings() {
        return this.settings;
    }
    getAvailableTools() {
        return this.registry.listTools();
    }
    getFilteredTools(enabledTools) {
        return this.registry.getFilteredTools(enabledTools);
    }
}
exports.MCPServer = MCPServer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tY3Atc2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRzs7O0FBR0gsa0VBQWtHO0FBQ2xHLGlFQUFtRTtBQUNuRSxxREFBaUQ7QUFDakQsbURBQStDO0FBQy9DLDZEQUF5RDtBQUN6RCx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHFEQUFpRDtBQUNqRCxpRUFBNkQ7QUFDN0QsdURBQW1EO0FBQ25ELDZEQUF5RDtBQUN6RCx1RUFBa0U7QUFDbEUsK0RBQTBEO0FBQzFELHlFQUFvRTtBQUNwRSx1RUFBa0U7QUFDbEUsK0RBQTJEO0FBRTNEOzs7O0dBSUc7QUFDSCxNQUFhLGlCQUFpQjtJQUsxQjtRQUpRLFVBQUssR0FBd0IsRUFBRSxDQUFDO1FBQ2hDLGNBQVMsR0FBcUIsRUFBRSxDQUFDO1FBQ2pDLGlCQUFZLEdBQXlDLEVBQUUsQ0FBQztRQUc1RCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxJQUFJLHdCQUFVLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztRQUNsQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJLGdDQUFjLEVBQUUsQ0FBQztRQUM1QyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxJQUFJLDBCQUFXLEVBQUUsQ0FBQztRQUN0QyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sR0FBRyxJQUFJLDRCQUFZLEVBQUUsQ0FBQztRQUN4QyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxJQUFJLHdCQUFVLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJLG9DQUFnQixFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFN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QUFDLFlBQW1CO1FBQ3pDLElBQUksQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDL0MsS0FBSyxNQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsTUFBTSxFQUFFO1lBQUUsQ0FBQyxDQUFDLG1CQUFtQixFQUFFLENBQUM7SUFDN0UsQ0FBQztJQUVNLFdBQVc7UUFDZCxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUM7SUFDekIsQ0FBQztJQUVNLFNBQVM7UUFDWixPQUFPO1lBQ0gsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFO1lBQ3BDLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRTtZQUM5QixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxlQUFlLEVBQUU7U0FDNUMsQ0FBQztJQUNOLENBQUM7SUFFTSxVQUFVO1FBQ2IsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO0lBQ3ZDLENBQUM7SUFFTSxXQUFXO1FBQ2QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3pCLENBQUM7SUFFTSxpQkFBaUI7UUFDcEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxDQUFDO0lBQ3JDLENBQUM7SUFFTSxnQkFBZ0IsQ0FBQyxZQUFtQjtRQUN2QyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDeEQsQ0FBQztDQUNKO0FBMUVELDhCQTBFQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ29jb3MgQ3JlYXRvciBNQ1Agc2VydmVyIG9yY2hlc3RyYXRvci5cbiAqXG4gKiBPd25zIHRoZSB0b29sIHJlZ2lzdHJ5IGFuZCB0aGUgU3RyZWFtYWJsZSBIVFRQIHRyYW5zcG9ydC4gVGhlIGFjdHVhbFxuICogSlNPTuKAkVJQQyAvIE1DUCBwcm90b2NvbCBpcyBpbXBsZW1lbnRlZCBieSB7QGxpbmsgUHJvdG9jb2xIYW5kbGVyfSBzbyBpdFxuICogY2FuIGJlIHJldXNlZCBieSBzdGRpbyAoYW5kIGZ1dHVyZSBXZWJTb2NrZXQpIHRyYW5zcG9ydHMuXG4gKlxuICogUGhhc2UgMSBjYXBhYmlsaXRpZXM6XG4gKiAgLSBBMSBTdHJlYW1hYmxlIEhUVFAgdHJhbnNwb3J0IChHRVQvUE9TVC9ERUxFVEUgL21jcCwgTWNwLVNlc3Npb24tSWQsIFNTRSlcbiAqICAtIEE0IE9yaWdpbiBhbGxvd+KAkWxpc3QgKyBETlMgcmViaW5kaW5nIGd1YXJkXG4gKiAgLSBBNSAqKioqKiogYXV0aFxuICogIC0gQTYgbG9nZ2luZy9zZXRMZXZlbCArIG5vdGlmaWNhdGlvbnMvbWVzc2FnZVxuICogIC0gQTcgbm90aWZpY2F0aW9ucy9wcm9ncmVzc1xuICogIC0gQTggQWJvcnRTaWduYWwgY2FuY2VsbGF0aW9uXG4gKiAgLSBHMSBUb29sIGFubm90YXRpb25zIG9uIHRvb2xzL2xpc3RcbiAqICAtIEczIG91dHB1dFNjaGVtYSBvbiB0b29scy9saXN0ICsgc3RydWN0dXJlZENvbnRlbnQgb24gdG9vbHMvY2FsbFxuICogIC0gRzQgUGFnaW5hdGlvbiBjdXJzb3Igb24gdG9vbHMvbGlzdFxuICogIC0gRzggQWp2IGlucHV0IHZhbGlkYXRpb24g4oaSIC0zMjYwMlxuICogIC0gRzkgcHJvdG9jb2xWZXJzaW9uIGhhbmRzaGFrZSB3aXRoIGZlYXR1cmUgZmxhZ3NcbiAqL1xuXG5pbXBvcnQgeyBNQ1BTZXJ2ZXJTZXR0aW5ncywgTUNQQ2xpZW50LCBTZXJ2ZXJTdGF0dXMsIFRvb2xEZWZpbml0aW9uIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBQcm90b2NvbEhhbmRsZXIsIFRvb2xFeGVjdXRpb25Db250ZXh0LCBUb29sUmVnaXN0cnkgfSBmcm9tICcuL3Byb3RvY29sL3Byb3RvY29sLWhhbmRsZXInO1xuaW1wb3J0IHsgU3RyZWFtYWJsZUh0dHBTZXJ2ZXIgfSBmcm9tICcuL3RyYW5zcG9ydC9zdHJlYW1hYmxlLWh0dHAnO1xuaW1wb3J0IHsgU2NlbmVUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtdG9vbHMnO1xuaW1wb3J0IHsgTm9kZVRvb2xzIH0gZnJvbSAnLi90b29scy9ub2RlLXRvb2xzJztcbmltcG9ydCB7IENvbXBvbmVudFRvb2xzIH0gZnJvbSAnLi90b29scy9jb21wb25lbnQtdG9vbHMnO1xuaW1wb3J0IHsgUHJlZmFiVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3ByZWZhYi10b29scyc7XG5pbXBvcnQgeyBQcm9qZWN0VG9vbHMgfSBmcm9tICcuL3Rvb2xzL3Byb2plY3QtdG9vbHMnO1xuaW1wb3J0IHsgRGVidWdUb29scyB9IGZyb20gJy4vdG9vbHMvZGVidWctdG9vbHMnO1xuaW1wb3J0IHsgUHJlZmVyZW5jZXNUb29scyB9IGZyb20gJy4vdG9vbHMvcHJlZmVyZW5jZXMtdG9vbHMnO1xuaW1wb3J0IHsgU2VydmVyVG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NlcnZlci10b29scyc7XG5pbXBvcnQgeyBCcm9hZGNhc3RUb29scyB9IGZyb20gJy4vdG9vbHMvYnJvYWRjYXN0LXRvb2xzJztcbmltcG9ydCB7IFNjZW5lQWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvc2NlbmUtYWR2YW5jZWQtdG9vbHMnO1xuaW1wb3J0IHsgU2NlbmVWaWV3VG9vbHMgfSBmcm9tICcuL3Rvb2xzL3NjZW5lLXZpZXctdG9vbHMnO1xuaW1wb3J0IHsgUmVmZXJlbmNlSW1hZ2VUb29scyB9IGZyb20gJy4vdG9vbHMvcmVmZXJlbmNlLWltYWdlLXRvb2xzJztcbmltcG9ydCB7IEFzc2V0QWR2YW5jZWRUb29scyB9IGZyb20gJy4vdG9vbHMvYXNzZXQtYWR2YW5jZWQtdG9vbHMnO1xuaW1wb3J0IHsgVmFsaWRhdGlvblRvb2xzIH0gZnJvbSAnLi90b29scy92YWxpZGF0aW9uLXRvb2xzJztcblxuLyoqXG4gKiBUaGUgdG9vbCByZWdpc3RyeSB1c2VkIGJ5IGFsbCB0cmFuc3BvcnRzLiBXcmFwcyB0aGUgbGVnYWN5IHBlcuKAkWNhdGVnb3J5XG4gKiB0b29sIGNsYXNzZXMgYW5kIGV4cG9zZXMgdGhlIHVuaWZpZWQge0BsaW5rIFRvb2xSZWdpc3RyeX0gaW50ZXJmYWNlIHVzZWQgYnlcbiAqIHtAbGluayBQcm90b2NvbEhhbmRsZXJ9LlxuICovXG5leHBvcnQgY2xhc3MgQ29jb3NUb29sUmVnaXN0cnkgaW1wbGVtZW50cyBUb29sUmVnaXN0cnkge1xuICAgIHByaXZhdGUgdG9vbHM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBwcml2YXRlIHRvb2xzTGlzdDogVG9vbERlZmluaXRpb25bXSA9IFtdO1xuICAgIHByaXZhdGUgZW5hYmxlZFRvb2xzOiB7IGNhdGVnb3J5OiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9W10gPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICB0aGlzLnRvb2xzLnNjZW5lID0gbmV3IFNjZW5lVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5ub2RlID0gbmV3IE5vZGVUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLmNvbXBvbmVudCA9IG5ldyBDb21wb25lbnRUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnByZWZhYiA9IG5ldyBQcmVmYWJUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnByb2plY3QgPSBuZXcgUHJvamVjdFRvb2xzKCk7XG4gICAgICAgIHRoaXMudG9vbHMuZGVidWcgPSBuZXcgRGVidWdUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnByZWZlcmVuY2VzID0gbmV3IFByZWZlcmVuY2VzVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5zZXJ2ZXIgPSBuZXcgU2VydmVyVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5icm9hZGNhc3QgPSBuZXcgQnJvYWRjYXN0VG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5zY2VuZUFkdmFuY2VkID0gbmV3IFNjZW5lQWR2YW5jZWRUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnNjZW5lVmlldyA9IG5ldyBTY2VuZVZpZXdUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnJlZmVyZW5jZUltYWdlID0gbmV3IFJlZmVyZW5jZUltYWdlVG9vbHMoKTtcbiAgICAgICAgdGhpcy50b29scy5hc3NldEFkdmFuY2VkID0gbmV3IEFzc2V0QWR2YW5jZWRUb29scygpO1xuICAgICAgICB0aGlzLnRvb2xzLnZhbGlkYXRpb24gPSBuZXcgVmFsaWRhdGlvblRvb2xzKCk7XG4gICAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH1cblxuICAgIHB1YmxpYyB1cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZDogeyBjYXRlZ29yeTogc3RyaW5nOyBuYW1lOiBzdHJpbmcgfVtdKTogdm9pZCB7XG4gICAgICAgIHRoaXMuZW5hYmxlZFRvb2xzID0gZW5hYmxlZCB8fCBbXTtcbiAgICAgICAgdGhpcy5yZWJ1aWxkKCk7XG4gICAgfVxuXG4gICAgcHVibGljIGxpc3RUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0O1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWQ6IHsgY2F0ZWdvcnk6IHN0cmluZzsgbmFtZTogc3RyaW5nIH1bXSk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICBpZiAoIWVuYWJsZWQgfHwgZW5hYmxlZC5sZW5ndGggPT09IDApIHJldHVybiB0aGlzLnRvb2xzTGlzdDtcbiAgICAgICAgY29uc3QgYWxsb3dlZCA9IG5ldyBTZXQoZW5hYmxlZC5tYXAoKHQpID0+IGAke3QuY2F0ZWdvcnl9XyR7dC5uYW1lfWApKTtcbiAgICAgICAgcmV0dXJuIHRoaXMudG9vbHNMaXN0LmZpbHRlcigodCkgPT4gYWxsb3dlZC5oYXModC5uYW1lKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGV4ZWN1dGVUb29sQ2FsbChuYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSwgY3R4OiBUb29sRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGNvbnN0IGlkeCA9IG5hbWUuaW5kZXhPZignXycpO1xuICAgICAgICBpZiAoaWR4IDwgMCkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHRvb2wgbmFtZTogJHtuYW1lfWApO1xuICAgICAgICBjb25zdCBjYXRlZ29yeSA9IG5hbWUuc2xpY2UoMCwgaWR4KTtcbiAgICAgICAgY29uc3QgdG9vbCA9IG5hbWUuc2xpY2UoaWR4ICsgMSk7XG4gICAgICAgIGlmICghdGhpcy50b29sc1tjYXRlZ29yeV0pIHRocm93IG5ldyBFcnJvcihgVG9vbCBjYXRlZ29yeSBub3QgZm91bmQ6ICR7Y2F0ZWdvcnl9YCk7XG5cbiAgICAgICAgLy8gQTg6IHN1cmZhY2UgQWJvcnRTaWduYWwgdG8gdG9vbHMgdGhhdCBzdXBwb3J0IGl0LiBMZWdhY3kgdG9vbHMgaWdub3JlIHRoZVxuICAgICAgICAvLyAzcmQgYXJndW1lbnQgaGFybWxlc3NseTsgbmV3IHRvb2xzIGNhbiB0YWtlIGFkdmFudGFnZS4gV2Ugc3RpbGwgcG9sbCB0aGVcbiAgICAgICAgLy8gc2lnbmFsIGhlcmUgc28gdGhhdCBldmVuIHN5bmNocm9ub3VzIHRvb2xzIHRlcm1pbmF0ZSBwcm9tcHRseS5cbiAgICAgICAgaWYgKGN0eC5zaWduYWwuYWJvcnRlZCkgdGhyb3cgbmV3IEVycm9yKCdjYW5jZWxsZWQnKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudG9vbHNbY2F0ZWdvcnldLmV4ZWN1dGUodG9vbCwgYXJncywgY3R4KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYnVpbGQoKTogdm9pZCB7XG4gICAgICAgIHRoaXMudG9vbHNMaXN0ID0gW107XG4gICAgICAgIGNvbnN0IGVuYWJsZWROYW1lcyA9IHRoaXMuZW5hYmxlZFRvb2xzLmxlbmd0aFxuICAgICAgICAgICAgPyBuZXcgU2V0KHRoaXMuZW5hYmxlZFRvb2xzLm1hcCgodCkgPT4gYCR7dC5jYXRlZ29yeX1fJHt0Lm5hbWV9YCkpXG4gICAgICAgICAgICA6IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgW2NhdGVnb3J5LCB0b29sU2V0XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnRvb2xzKSkge1xuICAgICAgICAgICAgY29uc3QgZGVmczogVG9vbERlZmluaXRpb25bXSA9IHRvb2xTZXQuZ2V0VG9vbHMoKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgZGVmIG9mIGRlZnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmcSA9IGAke2NhdGVnb3J5fV8ke2RlZi5uYW1lfWA7XG4gICAgICAgICAgICAgICAgaWYgKGVuYWJsZWROYW1lcyAmJiAhZW5hYmxlZE5hbWVzLmhhcyhmcSkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIHRoaXMudG9vbHNMaXN0LnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBmcSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGRlZi5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IGRlZi5pbnB1dFNjaGVtYSxcbiAgICAgICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hOiBkZWYub3V0cHV0U2NoZW1hLFxuICAgICAgICAgICAgICAgICAgICBhbm5vdGF0aW9uczogZGVmLmFubm90YXRpb25zXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBNQ1BTZXJ2ZXIge1xuICAgIHByaXZhdGUgc2V0dGluZ3M6IE1DUFNlcnZlclNldHRpbmdzO1xuICAgIHByaXZhdGUgcmVnaXN0cnk6IENvY29zVG9vbFJlZ2lzdHJ5O1xuICAgIHByaXZhdGUgdHJhbnNwb3J0OiBTdHJlYW1hYmxlSHR0cFNlcnZlcjtcbiAgICBwcml2YXRlIGhhbmRsZXJzQnlTZXNzaW9uID0gbmV3IE1hcDxzdHJpbmcsIFByb3RvY29sSGFuZGxlcj4oKTtcblxuICAgIGNvbnN0cnVjdG9yKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncykge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSBuZXcgQ29jb3NUb29sUmVnaXN0cnkoKTtcbiAgICAgICAgdGhpcy50cmFuc3BvcnQgPSBuZXcgU3RyZWFtYWJsZUh0dHBTZXJ2ZXIoe1xuICAgICAgICAgICAgc2V0dGluZ3MsXG4gICAgICAgICAgICBjcmVhdGVIYW5kbGVyOiAoc2Vzc2lvbklkKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaCA9IG5ldyBQcm90b2NvbEhhbmRsZXIoe1xuICAgICAgICAgICAgICAgICAgICByZWdpc3RyeTogdGhpcy5yZWdpc3RyeSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVNpemU6IHRoaXMuc2V0dGluZ3MudG9vbHNQYWdlU2l6ZSA/PyAxMDAsXG4gICAgICAgICAgICAgICAgICAgIGluaXRpYWxMb2dMZXZlbDogdGhpcy5zZXR0aW5ncy5sb2dMZXZlbCA/PyAnaW5mbydcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLnNldChzZXNzaW9uSWQsIGgpO1xuICAgICAgICAgICAgICAgIHJldHVybiBoO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uU2Vzc2lvblRlcm1pbmF0ZWQ6IChzZXNzaW9uSWQpID0+IHRoaXMuaGFuZGxlcnNCeVNlc3Npb24uZGVsZXRlKHNlc3Npb25JZClcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLnRyYW5zcG9ydC5zdGFydCgpO1xuICAgICAgICBjb25zb2xlLmxvZyhgW01DUFNlcnZlcl0gU3RyZWFtYWJsZSBIVFRQIGxpc3RlbmluZyBvbiBodHRwOi8vMTI3LjAuMC4xOiR7dGhpcy5zZXR0aW5ncy5wb3J0fS9tY3BgKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc3RvcCgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy50cmFuc3BvcnQuc3RvcCgpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzQnlTZXNzaW9uLmNsZWFyKCk7XG4gICAgfVxuXG4gICAgcHVibGljIHVwZGF0ZVNldHRpbmdzKHNldHRpbmdzOiBNQ1BTZXJ2ZXJTZXR0aW5ncyk6IHZvaWQge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgICAgIHRoaXMudHJhbnNwb3J0LnVwZGF0ZVNldHRpbmdzKHNldHRpbmdzKTtcbiAgICAgICAgZm9yIChjb25zdCBoIG9mIHRoaXMuaGFuZGxlcnNCeVNlc3Npb24udmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChzZXR0aW5ncy5sb2dMZXZlbCkgaC5zZXRMb2dMZXZlbChzZXR0aW5ncy5sb2dMZXZlbCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgdXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29sczogYW55W10pOiB2b2lkIHtcbiAgICAgICAgdGhpcy5yZWdpc3RyeS51cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZFRvb2xzKTtcbiAgICAgICAgZm9yIChjb25zdCBoIG9mIHRoaXMuaGFuZGxlcnNCeVNlc3Npb24udmFsdWVzKCkpIGguY2xlYXJWYWxpZGF0b3JDYWNoZSgpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRSZWdpc3RyeSgpOiBDb2Nvc1Rvb2xSZWdpc3RyeSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5O1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRTdGF0dXMoKTogU2VydmVyU3RhdHVzIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJ1bm5pbmc6IHRoaXMudHJhbnNwb3J0LmdldFJ1bm5pbmcoKSxcbiAgICAgICAgICAgIHBvcnQ6IHRoaXMudHJhbnNwb3J0LmdldFBvcnQoKSxcbiAgICAgICAgICAgIGNsaWVudHM6IHRoaXMudHJhbnNwb3J0LmdldFNlc3Npb25Db3VudCgpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHVibGljIGdldENsaWVudHMoKTogTUNQQ2xpZW50W10ge1xuICAgICAgICByZXR1cm4gdGhpcy50cmFuc3BvcnQuZ2V0Q2xpZW50cygpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRTZXR0aW5ncygpOiBNQ1BTZXJ2ZXJTZXR0aW5ncyB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRBdmFpbGFibGVUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVnaXN0cnkubGlzdFRvb2xzKCk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEZpbHRlcmVkVG9vbHMoZW5hYmxlZFRvb2xzOiBhbnlbXSk6IFRvb2xEZWZpbml0aW9uW10ge1xuICAgICAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5nZXRGaWx0ZXJlZFRvb2xzKGVuYWJsZWRUb29scyk7XG4gICAgfVxufVxuIl19