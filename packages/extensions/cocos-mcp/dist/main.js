"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const mcp_server_1 = require("./mcp-server");
const settings_1 = require("./settings");
const tool_manager_1 = require("./tools/tool-manager");
const texture_compression_policy_1 = require("./texture-compression-policy");
let mcpServer = null;
let toolManager;
/**
 * @en Registration method for the main process of Extension
 * @zh Registration method for the extension main process
 */
exports.methods = {
    /**
     * @en Open the MCP server panel
     * @zh Open the MCP server panel
     */
    openPanel() {
        Editor.Panel.open('cocos-mcp-server');
    },
    /**
     * @en Start the MCP server
     * @zh Start the MCP server
     */
    async startServer() {
        if (mcpServer) {
            // Ensure the latest tool configuration is used.
            const enabledTools = toolManager.getEnabledTools();
            mcpServer.updateEnabledTools(enabledTools);
            await mcpServer.start();
        }
        else {
            console.warn('[MCP Plugin] mcpServer is not initialized');
        }
    },
    /**
     * @en Stop the MCP server
     * @zh Stop the MCP server
     */
    async stopServer() {
        if (mcpServer) {
            mcpServer.stop();
        }
        else {
            console.warn('[MCP Plugin] mcpServer is not initialized');
        }
    },
    /**
     * @en Get server status
     * @zh Get server status
     */
    getServerStatus() {
        const status = mcpServer ? mcpServer.getStatus() : { running: false, port: 0, clients: 0 };
        const settings = mcpServer ? mcpServer.getSettings() : (0, settings_1.readSettings)();
        return Object.assign(Object.assign({}, status), { settings: settings });
    },
    /**
     * @en Update server settings
     * @zh Update server settings
     */
    async updateSettings(settings) {
        const previousSettings = mcpServer ? mcpServer.getSettings() : (0, settings_1.readSettings)();
        const wasRunning = mcpServer ? mcpServer.getStatus().running : false;
        const updatedSettings = (0, settings_1.saveSettings)(Object.assign(Object.assign({}, previousSettings), settings));
        // Updating auto-start or log preferences must not interrupt a running server.
        if (mcpServer && wasRunning && previousSettings.port === updatedSettings.port) {
            mcpServer.updateSettings(updatedSettings);
            return { success: true, settings: updatedSettings };
        }
        if (mcpServer) {
            mcpServer.stop();
        }
        mcpServer = new mcp_server_1.MCPServer(updatedSettings);
        mcpServer.updateEnabledTools(toolManager.getEnabledTools());
        if (wasRunning) {
            await mcpServer.start();
        }
        return { success: true, settings: updatedSettings };
    },
    /**
     * @en Get tools list
     * @zh Get the tools list
     */
    getToolsList() {
        return mcpServer ? mcpServer.getAvailableTools() : [];
    },
    getFilteredToolsList() {
        if (!mcpServer)
            return [];
        // Get the currently enabled tools.
        const enabledTools = toolManager.getEnabledTools();
        // Update the MCP server's enabled tool list.
        mcpServer.updateEnabledTools(enabledTools);
        return mcpServer.getFilteredTools(enabledTools);
    },
    /**
     * @en Get server settings
     * @zh Get server settings
     */
    async getServerSettings() {
        return mcpServer ? mcpServer.getSettings() : (0, settings_1.readSettings)();
    },
    /**
     * @en Get server settings (alternative method)
     * @zh Get server settings (alternative method)
     */
    async getSettings() {
        return mcpServer ? mcpServer.getSettings() : (0, settings_1.readSettings)();
    },
    // Tool manager related methods.
    async getToolManagerState() {
        return toolManager.getToolManagerState();
    },
    async createToolConfiguration(name, description) {
        try {
            const config = toolManager.createConfiguration(name, description);
            return { success: true, id: config.id, config };
        }
        catch (error) {
            throw new Error(`Failed to create configuration: ${error.message}`);
        }
    },
    async updateToolConfiguration(configId, updates) {
        try {
            return toolManager.updateConfiguration(configId, updates);
        }
        catch (error) {
            throw new Error(`Failed to update configuration: ${error.message}`);
        }
    },
    async deleteToolConfiguration(configId) {
        try {
            toolManager.deleteConfiguration(configId);
            return { success: true };
        }
        catch (error) {
            throw new Error(`Failed to delete configuration: ${error.message}`);
        }
    },
    async setCurrentToolConfiguration(configId) {
        try {
            toolManager.setCurrentConfiguration(configId);
            return { success: true };
        }
        catch (error) {
            throw new Error(`Failed to set the current configuration: ${error.message}`);
        }
    },
    async updateToolStatus(category, toolName, enabled) {
        try {
            const currentConfig = toolManager.getCurrentConfiguration();
            if (!currentConfig) {
                throw new Error('No current configuration selected');
            }
            toolManager.updateToolStatus(currentConfig.id, category, toolName, enabled);
            // Update the MCP server tool list.
            if (mcpServer) {
                const enabledTools = toolManager.getEnabledTools();
                mcpServer.updateEnabledTools(enabledTools);
            }
            return { success: true };
        }
        catch (error) {
            throw new Error(`Failed to update tool status: ${error.message}`);
        }
    },
    async updateToolStatusBatch(updates) {
        try {
            console.log(`[Main] updateToolStatusBatch called with updates count:`, updates ? updates.length : 0);
            const currentConfig = toolManager.getCurrentConfiguration();
            if (!currentConfig) {
                throw new Error('No current configuration selected');
            }
            toolManager.updateToolStatusBatch(currentConfig.id, updates);
            // Update the MCP server tool list.
            if (mcpServer) {
                const enabledTools = toolManager.getEnabledTools();
                mcpServer.updateEnabledTools(enabledTools);
            }
            return { success: true };
        }
        catch (error) {
            throw new Error(`Failed to update tool status in batch: ${error.message}`);
        }
    },
    async exportToolConfiguration(configId) {
        try {
            return { configJson: toolManager.exportConfiguration(configId) };
        }
        catch (error) {
            throw new Error(`Failed to export configuration: ${error.message}`);
        }
    },
    async importToolConfiguration(configJson) {
        try {
            return toolManager.importConfiguration(configJson);
        }
        catch (error) {
            throw new Error(`Failed to import configuration: ${error.message}`);
        }
    },
    async getEnabledTools() {
        return toolManager.getEnabledTools();
    }
};
/**
 * @en Method Triggered on Extension Startup
 * @zh Method triggered when the extension starts
 */
function load() {
    console.log('Cocos MCP Server extension loaded');
    // Initialize the tool manager.
    toolManager = new tool_manager_1.ToolManager();
    // Read settings.
    const settings = (0, settings_1.readSettings)();
    mcpServer = new mcp_server_1.MCPServer(settings);
    // Initialize the MCP server tool list.
    const enabledTools = toolManager.getEnabledTools();
    mcpServer.updateEnabledTools(enabledTools);
    // Keep PNG/JPG/JPEG importer metadata portable and build-ready. The policy
    // is idempotent and writes through Cocos Asset DB/Profile APIs only.
    (0, texture_compression_policy_1.startTextureCompressionAutomation)();
    // Start the server if auto-start is enabled.
    if (settings.autoStart) {
        mcpServer.start().catch(err => {
            console.error('Failed to auto-start MCP server:', err);
        });
    }
}
/**
 * @en Method triggered when uninstalling the extension
 * @zh Method triggered when the extension is unloaded
 */
function unload() {
    (0, texture_compression_policy_1.stopTextureCompressionAutomation)();
    if (mcpServer) {
        mcpServer.stop();
        mcpServer = null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQTZPQSxvQkF3QkM7QUFNRCx3QkFNQztBQWpSRCw2Q0FBeUM7QUFDekMseUNBQXdEO0FBRXhELHVEQUFtRDtBQUNuRCw2RUFBbUg7QUFFbkgsSUFBSSxTQUFTLEdBQXFCLElBQUksQ0FBQztBQUN2QyxJQUFJLFdBQXdCLENBQUM7QUFFN0I7OztHQUdHO0FBQ1UsUUFBQSxPQUFPLEdBQTRDO0lBQzVEOzs7T0FHRztJQUNILFNBQVM7UUFDTCxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFJRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsV0FBVztRQUNiLElBQUksU0FBUyxFQUFFLENBQUM7WUFDWixnREFBZ0Q7WUFDaEQsTUFBTSxZQUFZLEdBQUcsV0FBVyxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ25ELFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUMzQyxNQUFNLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUM1QixDQUFDO2FBQU0sQ0FBQztZQUNKLE9BQU8sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLENBQUMsQ0FBQztRQUM5RCxDQUFDO0lBQ0wsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxVQUFVO1FBQ1osSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNaLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNyQixDQUFDO2FBQU0sQ0FBQztZQUNKLE9BQU8sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLENBQUMsQ0FBQztRQUM5RCxDQUFDO0lBQ0wsQ0FBQztJQUVEOzs7T0FHRztJQUNILGVBQWU7UUFDWCxNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMs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QUFPLFdBQVcsQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUN6QyxDQUFDO0NBQ0osQ0FBQztBQUVGOzs7R0FHRztBQUNILFNBQWdCLElBQUk7SUFDaEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO0lBRWpELCtCQUErQjtJQUMvQixXQUFXLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7SUFFaEMsaUJBQWlCO0lBQ2pCLE1BQU0sUUFBUSxHQUFHLElBQUEsdUJBQVksR0FBRSxDQUFDO0lBQ2hDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsUUFBUSxDQUFDLENBQUM7SUFFcEMsdUNBQXVDO0lBQ3ZDLE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUNuRCxTQUFTLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFFM0MsMkVBQTJFO0lBQzNFLHFFQUFxRTtJQUNyRSxJQUFBLDhEQUFpQyxHQUFFLENBQUM7SUFFcEMsNkNBQTZDO0lBQzdDLElBQUksUUFBUSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ3JCLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDMUIsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUMzRCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7QUFDTCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsTUFBTTtJQUNsQixJQUFBLDZEQUFnQyxHQUFFLENBQUM7SUFDbkMsSUFBSSxTQUFTLEVBQUUsQ0FBQztRQUNaLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNqQixTQUFTLEdBQUcsSUFBSSxDQUFDO0lBQ3JCLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTUNQU2VydmVyIH0gZnJvbSAnLi9tY3Atc2VydmVyJztcclxuaW1wb3J0IHsgcmVhZFNldHRpbmdzLCBzYXZlU2V0dGluZ3MgfSBmcm9tICcuL3NldHRpbmdzJztcclxuaW1wb3J0IHsgTUNQU2VydmVyU2V0dGluZ3MgfSBmcm9tICcuL3R5cGVzJztcclxuaW1wb3J0IHsgVG9vbE1hbmFnZXIgfSBmcm9tICcuL3Rvb2xzL3Rvb2wtbWFuYWdlcic7XG5pbXBvcnQgeyBzdGFydFRleHR1cmVDb21wcmVzc2lvbkF1dG9tYXRpb24sIHN0b3BUZXh0dXJlQ29tcHJlc3Npb25BdXRvbWF0aW9uIH0gZnJvbSAnLi90ZXh0dXJlLWNvbXByZXNzaW9uLXBvbGljeSc7XG5cclxubGV0IG1jcFNlcnZlcjogTUNQU2VydmVyIHwgbnVsbCA9IG51bGw7XHJcbmxldCB0b29sTWFuYWdlcjogVG9vbE1hbmFnZXI7XHJcblxyXG4vKipcclxuICogQGVuIFJlZ2lzdHJhdGlvbiBtZXRob2QgZm9yIHRoZSBtYWluIHByb2Nlc3Mgb2YgRXh0ZW5zaW9uXHJcbiAqIEB6aCBSZWdpc3RyYXRpb24gbWV0aG9kIGZvciB0aGUgZXh0ZW5zaW9uIG1haW4gcHJvY2Vzc1xyXG4gKi9cclxuZXhwb3J0IGNvbnN0IG1ldGhvZHM6IHsgW2tleTogc3RyaW5nXTogKC4uLmFueTogYW55KSA9PiBhbnkgfSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogQGVuIE9wZW4gdGhlIE1DUCBzZXJ2ZXIgcGFuZWxcclxuICAgICAqIEB6aCBPcGVuIHRoZSBNQ1Agc2VydmVyIHBhbmVsXHJcbiAgICAgKi9cclxuICAgIG9wZW5QYW5lbCgpIHtcclxuICAgICAgICBFZGl0b3IuUGFuZWwub3BlbignY29jb3MtbWNwLXNlcnZlcicpO1xyXG4gICAgfSxcclxuXHJcblxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQGVuIFN0YXJ0IHRoZSBNQ1Agc2VydmVyXHJcbiAgICAgKiBAemggU3RhcnQgdGhlIE1DUCBzZXJ2ZXJcclxuICAgICAqL1xyXG4gICAgYXN5bmMgc3RhcnRTZXJ2ZXIoKSB7XHJcbiAgICAgICAgaWYgKG1jcFNlcnZlcikge1xyXG4gICAgICAgICAgICAvLyBFbnN1cmUgdGhlIGxhdGVzdCB0b29sIGNvbmZpZ3VyYXRpb24gaXMgdXNlZC5cclxuICAgICAgICAgICAgY29uc3QgZW5hYmxlZFRvb2xzID0gdG9vbE1hbmFnZXIuZ2V0RW5hYmxlZFRvb2xzKCk7XHJcbiAgICAgICAgICAgIG1jcFNlcnZlci51cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZFRvb2xzKTtcclxuICAgICAgICAgICAgYXdhaXQgbWNwU2VydmVyLnN0YXJ0KCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKCdbTUNQIFBsdWdpbl0gbWNwU2VydmVyIGlzIG5vdCBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAZW4gU3RvcCB0aGUgTUNQIHNlcnZlclxyXG4gICAgICogQHpoIFN0b3AgdGhlIE1DUCBzZXJ2ZXJcclxuICAgICAqL1xyXG4gICAgYXN5bmMgc3RvcFNlcnZlcigpIHtcclxuICAgICAgICBpZiAobWNwU2VydmVyKSB7XHJcbiAgICAgICAgICAgIG1jcFNlcnZlci5zdG9wKCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKCdbTUNQIFBsdWdpbl0gbWNwU2VydmVyIGlzIG5vdCBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAZW4gR2V0IHNlcnZlciBzdGF0dXNcclxuICAgICAqIEB6aCBHZXQgc2VydmVyIHN0YXR1c1xyXG4gICAgICovXHJcbiAgICBnZXRTZXJ2ZXJTdGF0dXMoKSB7XHJcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gbWNwU2VydmVyID8gbWNwU2VydmVyLmdldFN0YXR1cygpIDogeyBydW5uaW5nOiBmYWxzZSwgcG9ydDogMCwgY2xpZW50czogMCB9O1xyXG4gICAgICAgIGNvbnN0IHNldHRpbmdzID0gbWNwU2VydmVyID8gbWNwU2VydmVyLmdldFNldHRpbmdzKCkgOiByZWFkU2V0dGluZ3MoKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAuLi5zdGF0dXMsXHJcbiAgICAgICAgICAgIHNldHRpbmdzOiBzZXR0aW5nc1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQGVuIFVwZGF0ZSBzZXJ2ZXIgc2V0dGluZ3NcclxuICAgICAqIEB6aCBVcGRhdGUgc2VydmVyIHNldHRpbmdzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHVwZGF0ZVNldHRpbmdzKHNldHRpbmdzOiBQYXJ0aWFsPE1DUFNlcnZlclNldHRpbmdzPikge1xyXG4gICAgICAgIGNvbnN0IHByZXZpb3VzU2V0dGluZ3MgPSBtY3BTZXJ2ZXIgPyBtY3BTZXJ2ZXIuZ2V0U2V0dGluZ3MoKSA6IHJlYWRTZXR0aW5ncygpO1xyXG4gICAgICAgIGNvbnN0IHdhc1J1bm5pbmcgPSBtY3BTZXJ2ZXIgPyBtY3BTZXJ2ZXIuZ2V0U3RhdHVzKCkucnVubmluZyA6IGZhbHNlO1xyXG4gICAgICAgIGNvbnN0IHVwZGF0ZWRTZXR0aW5ncyA9IHNhdmVTZXR0aW5ncyh7IC4uLnByZXZpb3VzU2V0dGluZ3MsIC4uLnNldHRpbmdzIH0pO1xyXG5cclxuICAgICAgICAvLyBVcGRhdGluZyBhdXRvLXN0YXJ0IG9yIGxvZyBwcmVmZXJlbmNlcyBtdXN0IG5vdCBpbnRlcnJ1cHQgYSBydW5uaW5nIHNlcnZlci5cclxuICAgICAgICBpZiAobWNwU2VydmVyICYmIHdhc1J1bm5pbmcgJiYgcHJldmlvdXNTZXR0aW5ncy5wb3J0ID09PSB1cGRhdGVkU2V0dGluZ3MucG9ydCkge1xyXG4gICAgICAgICAgICBtY3BTZXJ2ZXIudXBkYXRlU2V0dGluZ3ModXBkYXRlZFNldHRpbmdzKTtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgc2V0dGluZ3M6IHVwZGF0ZWRTZXR0aW5ncyB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKG1jcFNlcnZlcikge1xyXG4gICAgICAgICAgICBtY3BTZXJ2ZXIuc3RvcCgpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbWNwU2VydmVyID0gbmV3IE1DUFNlcnZlcih1cGRhdGVkU2V0dGluZ3MpO1xyXG4gICAgICAgIG1jcFNlcnZlci51cGRhdGVFbmFibGVkVG9vbHModG9vbE1hbmFnZXIuZ2V0RW5hYmxlZFRvb2xzKCkpO1xyXG5cclxuICAgICAgICBpZiAod2FzUnVubmluZykge1xyXG4gICAgICAgICAgICBhd2FpdCBtY3BTZXJ2ZXIuc3RhcnQoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIHNldHRpbmdzOiB1cGRhdGVkU2V0dGluZ3MgfTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAZW4gR2V0IHRvb2xzIGxpc3RcclxuICAgICAqIEB6aCBHZXQgdGhlIHRvb2xzIGxpc3RcclxuICAgICAqL1xyXG4gICAgZ2V0VG9vbHNMaXN0KCkge1xyXG4gICAgICAgIHJldHVybiBtY3BTZXJ2ZXIgPyBtY3BTZXJ2ZXIuZ2V0QXZhaWxhYmxlVG9vbHMoKSA6IFtdO1xyXG4gICAgfSxcclxuXHJcbiAgICBnZXRGaWx0ZXJlZFRvb2xzTGlzdCgpIHtcclxuICAgICAgICBpZiAoIW1jcFNlcnZlcikgcmV0dXJuIFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEdldCB0aGUgY3VycmVudGx5IGVuYWJsZWQgdG9vbHMuXHJcbiAgICAgICAgY29uc3QgZW5hYmxlZFRvb2xzID0gdG9vbE1hbmFnZXIuZ2V0RW5hYmxlZFRvb2xzKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVXBkYXRlIHRoZSBNQ1Agc2VydmVyJ3MgZW5hYmxlZCB0b29sIGxpc3QuXHJcbiAgICAgICAgbWNwU2VydmVyLnVwZGF0ZUVuYWJsZWRUb29scyhlbmFibGVkVG9vbHMpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtY3BTZXJ2ZXIuZ2V0RmlsdGVyZWRUb29scyhlbmFibGVkVG9vbHMpO1xyXG4gICAgfSxcclxuICAgIC8qKlxyXG4gICAgICogQGVuIEdldCBzZXJ2ZXIgc2V0dGluZ3NcclxuICAgICAqIEB6aCBHZXQgc2VydmVyIHNldHRpbmdzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFNlcnZlclNldHRpbmdzKCkge1xyXG4gICAgICAgIHJldHVybiBtY3BTZXJ2ZXIgPyBtY3BTZXJ2ZXIuZ2V0U2V0dGluZ3MoKSA6IHJlYWRTZXR0aW5ncygpO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEBlbiBHZXQgc2VydmVyIHNldHRpbmdzIChhbHRlcm5hdGl2ZSBtZXRob2QpXHJcbiAgICAgKiBAemggR2V0IHNlcnZlciBzZXR0aW5ncyAoYWx0ZXJuYXRpdmUgbWV0aG9kKVxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZXRTZXR0aW5ncygpIHtcclxuICAgICAgICByZXR1cm4gbWNwU2VydmVyID8gbWNwU2VydmVyLmdldFNldHRpbmdzKCkgOiByZWFkU2V0dGluZ3MoKTtcclxuICAgIH0sXHJcblxyXG4gICAgLy8gVG9vbCBtYW5hZ2VyIHJlbGF0ZWQgbWV0aG9kcy5cclxuICAgIGFzeW5jIGdldFRvb2xNYW5hZ2VyU3RhdGUoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRvb2xNYW5hZ2VyLmdldFRvb2xNYW5hZ2VyU3RhdGUoKTtcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgY3JlYXRlVG9vbENvbmZpZ3VyYXRpb24obmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbj86IHN0cmluZykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IHRvb2xNYW5hZ2VyLmNyZWF0ZUNvbmZpZ3VyYXRpb24obmFtZSwgZGVzY3JpcHRpb24pO1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBpZDogY29uZmlnLmlkLCBjb25maWcgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBjb25maWd1cmF0aW9uOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyB1cGRhdGVUb29sQ29uZmlndXJhdGlvbihjb25maWdJZDogc3RyaW5nLCB1cGRhdGVzOiBhbnkpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICByZXR1cm4gdG9vbE1hbmFnZXIudXBkYXRlQ29uZmlndXJhdGlvbihjb25maWdJZCwgdXBkYXRlcyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byB1cGRhdGUgY29uZmlndXJhdGlvbjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgZGVsZXRlVG9vbENvbmZpZ3VyYXRpb24oY29uZmlnSWQ6IHN0cmluZykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRvb2xNYW5hZ2VyLmRlbGV0ZUNvbmZpZ3VyYXRpb24oY29uZmlnSWQpO1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgY29uZmlndXJhdGlvbjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgc2V0Q3VycmVudFRvb2xDb25maWd1cmF0aW9uKGNvbmZpZ0lkOiBzdHJpbmcpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB0b29sTWFuYWdlci5zZXRDdXJyZW50Q29uZmlndXJhdGlvbihjb25maWdJZCk7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHNldCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyB1cGRhdGVUb29sU3RhdHVzKGNhdGVnb3J5OiBzdHJpbmcsIHRvb2xOYW1lOiBzdHJpbmcsIGVuYWJsZWQ6IGJvb2xlYW4pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50Q29uZmlnID0gdG9vbE1hbmFnZXIuZ2V0Q3VycmVudENvbmZpZ3VyYXRpb24oKTtcclxuICAgICAgICAgICAgaWYgKCFjdXJyZW50Q29uZmlnKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGN1cnJlbnQgY29uZmlndXJhdGlvbiBzZWxlY3RlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0b29sTWFuYWdlci51cGRhdGVUb29sU3RhdHVzKGN1cnJlbnRDb25maWcuaWQsIGNhdGVnb3J5LCB0b29sTmFtZSwgZW5hYmxlZCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIE1DUCBzZXJ2ZXIgdG9vbCBsaXN0LlxyXG4gICAgICAgICAgICBpZiAobWNwU2VydmVyKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBlbmFibGVkVG9vbHMgPSB0b29sTWFuYWdlci5nZXRFbmFibGVkVG9vbHMoKTtcclxuICAgICAgICAgICAgICAgIG1jcFNlcnZlci51cGRhdGVFbmFibGVkVG9vbHMoZW5hYmxlZFRvb2xzKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gdXBkYXRlIHRvb2wgc3RhdHVzOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyB1cGRhdGVUb29sU3RhdHVzQmF0Y2godXBkYXRlczogYW55W10pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01haW5dIHVwZGF0ZVRvb2xTdGF0dXNCYXRjaCBjYWxsZWQgd2l0aCB1cGRhdGVzIGNvdW50OmAsIHVwZGF0ZXMgPyB1cGRhdGVzLmxlbmd0aCA6IDApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgY3VycmVudENvbmZpZyA9IHRvb2xNYW5hZ2VyLmdldEN1cnJlbnRDb25maWd1cmF0aW9uKCk7XHJcbiAgICAgICAgICAgIGlmICghY3VycmVudENvbmZpZykge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBjdXJyZW50IGNvbmZpZ3VyYXRpb24gc2VsZWN0ZWQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdG9vbE1hbmFnZXIudXBkYXRlVG9vbFN0YXR1c0JhdGNoKGN1cnJlbnRDb25maWcuaWQsIHVwZGF0ZXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBNQ1Agc2VydmVyIHRvb2wgbGlzdC5cclxuICAgICAgICAgICAgaWYgKG1jcFNlcnZlcikge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZW5hYmxlZFRvb2xzID0gdG9vbE1hbmFnZXIuZ2V0RW5hYmxlZFRvb2xzKCk7XHJcbiAgICAgICAgICAgICAgICBtY3BTZXJ2ZXIudXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29scyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHVwZGF0ZSB0b29sIHN0YXR1cyBpbiBiYXRjaDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgZXhwb3J0VG9vbENvbmZpZ3VyYXRpb24oY29uZmlnSWQ6IHN0cmluZykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbmZpZ0pzb246IHRvb2xNYW5hZ2VyLmV4cG9ydENvbmZpZ3VyYXRpb24oY29uZmlnSWQpIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBleHBvcnQgY29uZmlndXJhdGlvbjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgaW1wb3J0VG9vbENvbmZpZ3VyYXRpb24oY29uZmlnSnNvbjogc3RyaW5nKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmV0dXJuIHRvb2xNYW5hZ2VyLmltcG9ydENvbmZpZ3VyYXRpb24oY29uZmlnSnNvbik7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBpbXBvcnQgY29uZmlndXJhdGlvbjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgZ2V0RW5hYmxlZFRvb2xzKCkge1xyXG4gICAgICAgIHJldHVybiB0b29sTWFuYWdlci5nZXRFbmFibGVkVG9vbHMoKTtcclxuICAgIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBAZW4gTWV0aG9kIFRyaWdnZXJlZCBvbiBFeHRlbnNpb24gU3RhcnR1cFxyXG4gKiBAemggTWV0aG9kIHRyaWdnZXJlZCB3aGVuIHRoZSBleHRlbnNpb24gc3RhcnRzXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpIHtcbiAgICBjb25zb2xlLmxvZygnQ29jb3MgTUNQIFNlcnZlciBleHRlbnNpb24gbG9hZGVkJyk7XHJcbiAgICBcclxuICAgIC8vIEluaXRpYWxpemUgdGhlIHRvb2wgbWFuYWdlci5cclxuICAgIHRvb2xNYW5hZ2VyID0gbmV3IFRvb2xNYW5hZ2VyKCk7XHJcbiAgICBcclxuICAgIC8vIFJlYWQgc2V0dGluZ3MuXHJcbiAgICBjb25zdCBzZXR0aW5ncyA9IHJlYWRTZXR0aW5ncygpO1xyXG4gICAgbWNwU2VydmVyID0gbmV3IE1DUFNlcnZlcihzZXR0aW5ncyk7XHJcbiAgICBcclxuICAgIC8vIEluaXRpYWxpemUgdGhlIE1DUCBzZXJ2ZXIgdG9vbCBsaXN0LlxyXG4gICAgY29uc3QgZW5hYmxlZFRvb2xzID0gdG9vbE1hbmFnZXIuZ2V0RW5hYmxlZFRvb2xzKCk7XHJcbiAgICBtY3BTZXJ2ZXIudXBkYXRlRW5hYmxlZFRvb2xzKGVuYWJsZWRUb29scyk7XG5cbiAgICAvLyBLZWVwIFBORy9KUEcvSlBFRyBpbXBvcnRlciBtZXRhZGF0YSBwb3J0YWJsZSBhbmQgYnVpbGQtcmVhZHkuIFRoZSBwb2xpY3lcbiAgICAvLyBpcyBpZGVtcG90ZW50IGFuZCB3cml0ZXMgdGhyb3VnaCBDb2NvcyBBc3NldCBEQi9Qcm9maWxlIEFQSXMgb25seS5cbiAgICBzdGFydFRleHR1cmVDb21wcmVzc2lvbkF1dG9tYXRpb24oKTtcbiAgICBcclxuICAgIC8vIFN0YXJ0IHRoZSBzZXJ2ZXIgaWYgYXV0by1zdGFydCBpcyBlbmFibGVkLlxyXG4gICAgaWYgKHNldHRpbmdzLmF1dG9TdGFydCkge1xyXG4gICAgICAgIG1jcFNlcnZlci5zdGFydCgpLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBhdXRvLXN0YXJ0IE1DUCBzZXJ2ZXI6JywgZXJyKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEBlbiBNZXRob2QgdHJpZ2dlcmVkIHdoZW4gdW5pbnN0YWxsaW5nIHRoZSBleHRlbnNpb25cclxuICogQHpoIE1ldGhvZCB0cmlnZ2VyZWQgd2hlbiB0aGUgZXh0ZW5zaW9uIGlzIHVubG9hZGVkXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdW5sb2FkKCkge1xuICAgIHN0b3BUZXh0dXJlQ29tcHJlc3Npb25BdXRvbWF0aW9uKCk7XG4gICAgaWYgKG1jcFNlcnZlcikge1xuICAgICAgICBtY3BTZXJ2ZXIuc3RvcCgpO1xyXG4gICAgICAgIG1jcFNlcnZlciA9IG51bGw7XHJcbiAgICB9XHJcbn1cclxuIl19