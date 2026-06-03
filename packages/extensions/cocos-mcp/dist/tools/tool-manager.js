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
exports.ToolManager = void 0;
const uuid_1 = require("uuid");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ToolManager {
    constructor() {
        this.availableTools = [];
        this.settings = this.readToolManagerSettings();
        this.initializeAvailableTools();
        // If no configuration exists, create a default one automatically
        if (this.settings.configurations.length === 0) {
            console.log('[ToolManager] No configurations found, creating default configuration...');
            this.createConfiguration('Default Configuration', 'Default tool configuration created automatically');
        }
    }
    getToolManagerSettingsPath() {
        return path.join(Editor.Project.path, 'settings', 'tool-manager.json');
    }
    ensureSettingsDir() {
        const settingsDir = path.dirname(this.getToolManagerSettingsPath());
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true });
        }
    }
    readToolManagerSettings() {
        const DEFAULT_TOOL_MANAGER_SETTINGS = {
            configurations: [],
            currentConfigId: '',
            maxConfigSlots: 5
        };
        try {
            this.ensureSettingsDir();
            const settingsFile = this.getToolManagerSettingsPath();
            if (fs.existsSync(settingsFile)) {
                const content = fs.readFileSync(settingsFile, 'utf8');
                return Object.assign(Object.assign({}, DEFAULT_TOOL_MANAGER_SETTINGS), JSON.parse(content));
            }
        }
        catch (e) {
            console.error('Failed to read tool manager settings:', e);
        }
        return DEFAULT_TOOL_MANAGER_SETTINGS;
    }
    saveToolManagerSettings(settings) {
        try {
            this.ensureSettingsDir();
            const settingsFile = this.getToolManagerSettingsPath();
            fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        }
        catch (e) {
            console.error('Failed to save tool manager settings:', e);
            throw e;
        }
    }
    exportToolConfiguration(config) {
        return JSON.stringify(config, null, 2);
    }
    importToolConfiguration(configJson) {
        try {
            const config = JSON.parse(configJson);
            // Validate configuration format
            if (!config.id || !config.name || !Array.isArray(config.tools)) {
                throw new Error('Invalid configuration format');
            }
            return config;
        }
        catch (e) {
            console.error('Failed to parse tool configuration:', e);
            throw new Error('Invalid JSON format or configuration structure');
        }
    }
    initializeAvailableTools() {
        // Get the actual tool list from the MCP server
        try {
            // Import all tool classes
            const { SceneTools } = require('./scene-tools');
            const { NodeTools } = require('./node-tools');
            const { ComponentTools } = require('./component-tools');
            const { PrefabTools } = require('./prefab-tools');
            const { ProjectTools } = require('./project-tools');
            const { DebugTools } = require('./debug-tools');
            const { PreferencesTools } = require('./preferences-tools');
            const { ServerTools } = require('./server-tools');
            const { BroadcastTools } = require('./broadcast-tools');
            const { SceneAdvancedTools } = require('./scene-advanced-tools');
            const { SceneViewTools } = require('./scene-view-tools');
            const { ReferenceImageTools } = require('./reference-image-tools');
            const { AssetAdvancedTools } = require('./asset-advanced-tools');
            const { ValidationTools } = require('./validation-tools');
            // Initialize tool instances
            const tools = {
                scene: new SceneTools(),
                node: new NodeTools(),
                component: new ComponentTools(),
                prefab: new PrefabTools(),
                project: new ProjectTools(),
                debug: new DebugTools(),
                preferences: new PreferencesTools(),
                server: new ServerTools(),
                broadcast: new BroadcastTools(),
                sceneAdvanced: new SceneAdvancedTools(),
                sceneView: new SceneViewTools(),
                referenceImage: new ReferenceImageTools(),
                assetAdvanced: new AssetAdvancedTools(),
                validation: new ValidationTools()
            };
            // Get the tool list from each tool class
            this.availableTools = [];
            for (const [category, toolSet] of Object.entries(tools)) {
                const toolDefinitions = toolSet.getTools();
                toolDefinitions.forEach((tool) => {
                    this.availableTools.push({
                        category: category,
                        name: tool.name,
                        enabled: true, // Enabled by default
                        description: tool.description
                    });
                });
            }
            console.log(`[ToolManager] Initialized ${this.availableTools.length} tools from MCP server`);
        }
        catch (error) {
            console.error('[ToolManager] Failed to initialize tools from MCP server:', error);
            // If fetching fails, use the default tool list as a fallback
            this.initializeDefaultTools();
        }
    }
    initializeDefaultTools() {
        // Default tool list as a fallback
        const toolCategories = [
            { category: 'scene', name: 'Scene Tools', tools: [
                    { name: 'getCurrentSceneInfo', description: 'Get current scene information' },
                    { name: 'getSceneHierarchy', description: 'Get scene hierarchy' },
                    { name: 'createNewScene', description: 'Create new scene' },
                    { name: 'saveScene', description: 'Save scene' },
                    { name: 'loadScene', description: 'Load scene' }
                ] },
            { category: 'node', name: 'Node Tools', tools: [
                    { name: 'getAllNodes', description: 'Get all nodes' },
                    { name: 'findNodeByName', description: 'Find node by name' },
                    { name: 'createNode', description: 'Create node' },
                    { name: 'deleteNode', description: 'Delete node' },
                    { name: 'setNodeProperty', description: 'Set node properties' },
                    { name: 'getNodeInfo', description: 'Get node information' }
                ] },
            { category: 'component', name: 'Component Tools', tools: [
                    { name: 'addComponentToNode', description: 'Add component to node' },
                    { name: 'removeComponentFromNode', description: 'Remove component from node' },
                    { name: 'setComponentProperty', description: 'Set component properties' },
                    { name: 'getComponentInfo', description: 'Get component information' }
                ] },
            { category: 'prefab', name: 'Prefab Tools', tools: [
                    { name: 'createPrefabFromNode', description: 'Create prefab from node' },
                    { name: 'instantiatePrefab', description: 'Instantiate prefab' },
                    { name: 'getPrefabInfo', description: 'Get prefab information' },
                    { name: 'savePrefab', description: 'Save prefab' }
                ] },
            { category: 'project', name: 'Project Tools', tools: [
                    { name: 'getProjectInfo', description: 'Get project information' },
                    { name: 'getAssetList', description: 'Get asset list' },
                    { name: 'createAsset', description: 'Create asset' },
                    { name: 'deleteAsset', description: 'Delete asset' }
                ] },
            { category: 'debug', name: 'Debug Tools', tools: [
                    { name: 'getConsoleLogs', description: 'Get console logs' },
                    { name: 'getPerformanceStats', description: 'Get performance statistics' },
                    { name: 'validateScene', description: 'Validate scene' },
                    { name: 'getErrorLogs', description: 'Get error logs' }
                ] },
            { category: 'preferences', name: 'Preferences Tools', tools: [
                    { name: 'getPreferences', description: 'Get preferences' },
                    { name: 'setPreferences', description: 'Set preferences' },
                    { name: 'resetPreferences', description: 'Reset preferences' }
                ] },
            { category: 'server', name: 'Server Tools', tools: [
                    { name: 'getServerStatus', description: 'Get server status' },
                    { name: 'getConnectedClients', description: 'Get connected clients' },
                    { name: 'getServerLogs', description: 'Get server logs' }
                ] },
            { category: 'broadcast', name: 'Broadcast Tools', tools: [
                    { name: 'broadcastMessage', description: 'Broadcast message' },
                    { name: 'getBroadcastHistory', description: 'Get broadcast history' }
                ] },
            { category: 'sceneAdvanced', name: 'Advanced Scene Tools', tools: [
                    { name: 'optimizeScene', description: 'Optimize scene' },
                    { name: 'analyzeScene', description: 'Analyze scene' },
                    { name: 'batchOperation', description: 'Batch operation' }
                ] },
            { category: 'sceneView', name: 'Scene View Tools', tools: [
                    { name: 'getViewportInfo', description: 'Get viewport information' },
                    { name: 'setViewportCamera', description: 'Set viewport camera' },
                    { name: 'focusOnNode', description: 'Focus on node' }
                ] },
            { category: 'referenceImage', name: 'Reference Image Tools', tools: [
                    { name: 'addReferenceImage', description: 'Add reference image' },
                    { name: 'removeReferenceImage', description: 'Remove reference image' },
                    { name: 'getReferenceImages', description: 'Get reference image list' }
                ] },
            { category: 'assetAdvanced', name: 'Advanced Asset Tools', tools: [
                    { name: 'importAsset', description: 'Import asset' },
                    { name: 'exportAsset', description: 'Export asset' },
                    { name: 'processAsset', description: 'Process asset' }
                ] },
            { category: 'validation', name: 'Validation Tools', tools: [
                    { name: 'validateProject', description: 'Validate project' },
                    { name: 'validateAssets', description: 'Validate assets' },
                    { name: 'generateReport', description: 'Generate report' }
                ] }
        ];
        this.availableTools = [];
        toolCategories.forEach(category => {
            category.tools.forEach(tool => {
                this.availableTools.push({
                    category: category.category,
                    name: tool.name,
                    enabled: true, // Enabled by default
                    description: tool.description
                });
            });
        });
        console.log(`[ToolManager] Initialized ${this.availableTools.length} default tools`);
    }
    getAvailableTools() {
        return [...this.availableTools];
    }
    getConfigurations() {
        return [...this.settings.configurations];
    }
    getCurrentConfiguration() {
        if (!this.settings.currentConfigId) {
            return null;
        }
        return this.settings.configurations.find(config => config.id === this.settings.currentConfigId) || null;
    }
    createConfiguration(name, description) {
        if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
            throw new Error(`Maximum number of configuration slots reached (${this.settings.maxConfigSlots})`);
        }
        const config = {
            id: (0, uuid_1.v4)(),
            name,
            description,
            tools: this.availableTools.map(tool => (Object.assign({}, tool))),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.settings.configurations.push(config);
        this.settings.currentConfigId = config.id;
        this.saveSettings();
        return config;
    }
    updateConfiguration(configId, updates) {
        const configIndex = this.settings.configurations.findIndex(config => config.id === configId);
        if (configIndex === -1) {
            throw new Error('Configuration not found');
        }
        const config = this.settings.configurations[configIndex];
        const updatedConfig = Object.assign(Object.assign(Object.assign({}, config), updates), { updatedAt: new Date().toISOString() });
        this.settings.configurations[configIndex] = updatedConfig;
        this.saveSettings();
        return updatedConfig;
    }
    deleteConfiguration(configId) {
        const configIndex = this.settings.configurations.findIndex(config => config.id === configId);
        if (configIndex === -1) {
            throw new Error('Configuration not found');
        }
        this.settings.configurations.splice(configIndex, 1);
        // If the deleted configuration is the current one, clear the current configuration ID
        if (this.settings.currentConfigId === configId) {
            this.settings.currentConfigId = this.settings.configurations.length > 0
                ? this.settings.configurations[0].id
                : '';
        }
        this.saveSettings();
    }
    setCurrentConfiguration(configId) {
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            throw new Error('Configuration not found');
        }
        this.settings.currentConfigId = configId;
        this.saveSettings();
    }
    updateToolStatus(configId, category, toolName, enabled) {
        console.log(`Backend: Updating tool status - configId: ${configId}, category: ${category}, toolName: ${toolName}, enabled: ${enabled}`);
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            console.error(`Backend: Config not found with ID: ${configId}`);
            throw new Error('Configuration not found');
        }
        console.log(`Backend: Found config: ${config.name}`);
        const tool = config.tools.find(t => t.category === category && t.name === toolName);
        if (!tool) {
            console.error(`Backend: Tool not found - category: ${category}, name: ${toolName}`);
            throw new Error('Tool not found');
        }
        console.log(`Backend: Found tool: ${tool.name}, current enabled: ${tool.enabled}, new enabled: ${enabled}`);
        tool.enabled = enabled;
        config.updatedAt = new Date().toISOString();
        console.log(`Backend: Tool updated, saving settings...`);
        this.saveSettings();
        console.log(`Backend: Settings saved successfully`);
    }
    updateToolStatusBatch(configId, updates) {
        console.log(`Backend: updateToolStatusBatch called with configId: ${configId}`);
        console.log(`Backend: Current configurations count: ${this.settings.configurations.length}`);
        console.log(`Backend: Current config IDs:`, this.settings.configurations.map(c => c.id));
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            console.error(`Backend: Config not found with ID: ${configId}`);
            console.error(`Backend: Available config IDs:`, this.settings.configurations.map(c => c.id));
            throw new Error('Configuration not found');
        }
        console.log(`Backend: Found config: ${config.name}, updating ${updates.length} tools`);
        updates.forEach(update => {
            const tool = config.tools.find(t => t.category === update.category && t.name === update.name);
            if (tool) {
                tool.enabled = update.enabled;
            }
        });
        config.updatedAt = new Date().toISOString();
        this.saveSettings();
        console.log(`Backend: Batch update completed successfully`);
    }
    exportConfiguration(configId) {
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            throw new Error('Configuration not found');
        }
        return this.exportToolConfiguration(config);
    }
    importConfiguration(configJson) {
        const config = this.importToolConfiguration(configJson);
        // Generate a new ID and timestamps
        config.id = (0, uuid_1.v4)();
        config.createdAt = new Date().toISOString();
        config.updatedAt = new Date().toISOString();
        if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
            throw new Error(`Maximum number of configuration slots reached (${this.settings.maxConfigSlots})`);
        }
        this.settings.configurations.push(config);
        this.saveSettings();
        return config;
    }
    getEnabledTools() {
        const currentConfig = this.getCurrentConfiguration();
        if (!currentConfig) {
            return this.availableTools.filter(tool => tool.enabled);
        }
        return currentConfig.tools.filter(tool => tool.enabled);
    }
    getToolManagerState() {
        const currentConfig = this.getCurrentConfiguration();
        return {
            success: true,
            availableTools: currentConfig ? currentConfig.tools : this.getAvailableTools(),
            selectedConfigId: this.settings.currentConfigId,
            configurations: this.getConfigurations(),
            maxConfigSlots: this.settings.maxConfigSlots
        };
    }
    saveSettings() {
        console.log(`Backend: Saving settings, current configs count: ${this.settings.configurations.length}`);
        this.saveToolManagerSettings(this.settings);
        console.log(`Backend: Settings saved to file`);
    }
}
exports.ToolManager = ToolManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9vbC1tYW5hZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc291cmNlL3Rvb2xzL3Rvb2wtbWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSwrQkFBb0M7QUFFcEMsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUU3QixNQUFhLFdBQVc7SUFJcEI7UUFGUSxtQkFBYyxHQUFpQixFQUFFLENBQUM7UUFHdEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztRQUMvQyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztRQUVoQyxpRUFBaUU7UUFDakUsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDNUMsT0FBTyxDQUFDLEdBQUcsQ0FBQywwRUFBMEUsQ0FBQyxDQUFDO1lBQ3hGLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyx1QkFBdUIsRUFBRSxrREFBa0QsQ0FBQyxDQUFDO1FBQzFHLENBQUM7SUFDTCxDQUFDO0lBRU8sMEJBQTBCO1FBQzlCLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztJQUMzRSxDQUFDO0lBRU8saUJBQWlCO1FBQ3JCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUMsQ0FBQztRQUNwRSxJQUFJLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQzlCLEVBQUUsQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDbkQsQ0FBQztJQUNMLENBQUM7SUFFTyx1QkFBdUI7UUFDM0IsTUFB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LE9BQU8sQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFTSxtQkFBbUI7UUFDdEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFDckQsT0FBTztZQUNILE9BQU8sRUFBRSxJQUFJO1lBQ2IsY0FBYyxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFO1lBQzlFLGdCQUFnQixFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZTtZQUMvQyxjQUFjLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixFQUFFO1lBQ3hDLGNBQWMsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWM7U0FDL0MsQ0FBQztJQUNOLENBQUM7SUFFTyxZQUFZO1FBQ2hCLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0RBQW9ELElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDdkcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM1QyxPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7SUFDbkQsQ0FBQztDQUNKO0FBbmFELGtDQW1hQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHsgVG9vbENvbmZpZywgVG9vbENvbmZpZ3VyYXRpb24sIFRvb2xNYW5hZ2VyU2V0dGluZ3MsIFRvb2xEZWZpbml0aW9uIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGNsYXNzIFRvb2xNYW5hZ2VyIHtcbiAgICBwcml2YXRlIHNldHRpbmdzOiBUb29sTWFuYWdlclNldHRpbmdzO1xuICAgIHByaXZhdGUgYXZhaWxhYmxlVG9vbHM6IFRvb2xDb25maWdbXSA9IFtdO1xuXG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSB0aGlzLnJlYWRUb29sTWFuYWdlclNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZUF2YWlsYWJsZVRvb2xzKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBJZiBubyBjb25maWd1cmF0aW9uIGV4aXN0cywgY3JlYXRlIGEgZGVmYXVsdCBvbmUgYXV0b21hdGljYWxseVxuICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVG9vbE1hbmFnZXJdIE5vIGNvbmZpZ3VyYXRpb25zIGZvdW5kLCBjcmVhdGluZyBkZWZhdWx0IGNvbmZpZ3VyYXRpb24uLi4nKTtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlQ29uZmlndXJhdGlvbignRGVmYXVsdCBDb25maWd1cmF0aW9uJywgJ0RlZmF1bHQgdG9vbCBjb25maWd1cmF0aW9uIGNyZWF0ZWQgYXV0b21hdGljYWxseScpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRUb29sTWFuYWdlclNldHRpbmdzUGF0aCgpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gcGF0aC5qb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsICdzZXR0aW5ncycsICd0b29sLW1hbmFnZXIuanNvbicpO1xuICAgIH1cblxuICAgIHByaXZhdGUgZW5zdXJlU2V0dGluZ3NEaXIoKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IHNldHRpbmdzRGlyID0gcGF0aC5kaXJuYW1lKHRoaXMuZ2V0VG9vbE1hbmFnZXJTZXR0aW5nc1BhdGgoKSk7XG4gICAgICAgIGlmICghZnMuZXhpc3RzU3luYyhzZXR0aW5nc0RpcikpIHtcbiAgICAgICAgICAgIGZzLm1rZGlyU3luYyhzZXR0aW5nc0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRUb29sTWFuYWdlclNldHRpbmdzKCk6IFRvb2xNYW5hZ2VyU2V0dGluZ3Mge1xuICAgICAgICBjb25zdCBERUZBVUxUX1RPT0xfTUFOQUdFUl9TRVRUSU5HUzogVG9vbE1hbmFnZXJTZXR0aW5ncyA9IHtcbiAgICAgICAgICAgIGNvbmZpZ3VyYXRpb25zOiBbXSxcbiAgICAgICAgICAgIGN1cnJlbnRDb25maWdJZDogJycsXG4gICAgICAgICAgICBtYXhDb25maWdTbG90czogNVxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmVuc3VyZVNldHRpbmdzRGlyKCk7XG4gICAgICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSB0aGlzLmdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk7XG4gICAgICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhzZXR0aW5nc0ZpbGUpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhzZXR0aW5nc0ZpbGUsICd1dGY4Jyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4uREVGQVVMVF9UT09MX01BTkFHRVJfU0VUVElOR1MsIC4uLkpTT04ucGFyc2UoY29udGVudCkgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlYWQgdG9vbCBtYW5hZ2VyIHNldHRpbmdzOicsIGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBERUZBVUxUX1RPT0xfTUFOQUdFUl9TRVRUSU5HUztcbiAgICB9XG5cbiAgICBwcml2YXRlIHNhdmVUb29sTWFuYWdlclNldHRpbmdzKHNldHRpbmdzOiBUb29sTWFuYWdlclNldHRpbmdzKTogdm9pZCB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmVuc3VyZVNldHRpbmdzRGlyKCk7XG4gICAgICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSB0aGlzLmdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk7XG4gICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHNldHRpbmdzRmlsZSwgSlNPTi5zdHJpbmdpZnkoc2V0dGluZ3MsIG51bGwsIDIpKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNhdmUgdG9vbCBtYW5hZ2VyIHNldHRpbmdzOicsIGUpO1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZXhwb3J0VG9vbENvbmZpZ3VyYXRpb24oY29uZmlnOiBUb29sQ29uZmlndXJhdGlvbik6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb25maWcsIG51bGwsIDIpO1xuICAgIH1cblxuICAgIHByaXZhdGUgaW1wb3J0VG9vbENvbmZpZ3VyYXRpb24oY29uZmlnSnNvbjogc3RyaW5nKTogVG9vbENvbmZpZ3VyYXRpb24ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gSlNPTi5wYXJzZShjb25maWdKc29uKTtcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIGNvbmZpZ3VyYXRpb24gZm9ybWF0XG4gICAgICAgICAgICBpZiAoIWNvbmZpZy5pZCB8fCAhY29uZmlnLm5hbWUgfHwgIUFycmF5LmlzQXJyYXkoY29uZmlnLnRvb2xzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb25maWd1cmF0aW9uIGZvcm1hdCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvbmZpZztcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHBhcnNlIHRvb2wgY29uZmlndXJhdGlvbjonLCBlKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBKU09OIGZvcm1hdCBvciBjb25maWd1cmF0aW9uIHN0cnVjdHVyZScpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBpbml0aWFsaXplQXZhaWxhYmxlVG9vbHMoKTogdm9pZCB7XG4gICAgICAgIC8vIEdldCB0aGUgYWN0dWFsIHRvb2wgbGlzdCBmcm9tIHRoZSBNQ1Agc2VydmVyXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBJbXBvcnQgYWxsIHRvb2wgY2xhc3Nlc1xuICAgICAgICAgICAgY29uc3QgeyBTY2VuZVRvb2xzIH0gPSByZXF1aXJlKCcuL3NjZW5lLXRvb2xzJyk7XG4gICAgICAgICAgICBjb25zdCB7IE5vZGVUb29scyB9ID0gcmVxdWlyZSgnLi9ub2RlLXRvb2xzJyk7XG4gICAgICAgICAgICBjb25zdCB7IENvbXBvbmVudFRvb2xzIH0gPSByZXF1aXJlKCcuL2NvbXBvbmVudC10b29scycpO1xuICAgICAgICAgICAgY29uc3QgeyBQcmVmYWJUb29scyB9ID0gcmVxdWlyZSgnLi9wcmVmYWItdG9vbHMnKTtcbiAgICAgICAgICAgIGNvbnN0IHsgUHJvamVjdFRvb2xzIH0gPSByZXF1aXJlKCcuL3Byb2plY3QtdG9vbHMnKTtcbiAgICAgICAgICAgIGNvbnN0IHsgRGVidWdUb29scyB9ID0gcmVxdWlyZSgnLi9kZWJ1Zy10b29scycpO1xuICAgICAgICAgICAgY29uc3QgeyBQcmVmZXJlbmNlc1Rvb2xzIH0gPSByZXF1aXJlKCcuL3ByZWZlcmVuY2VzLXRvb2xzJyk7XG4gICAgICAgICAgICBjb25zdCB7IFNlcnZlclRvb2xzIH0gPSByZXF1aXJlKCcuL3NlcnZlci10b29scycpO1xuICAgICAgICAgICAgY29uc3QgeyBCcm9hZGNhc3RUb29scyB9ID0gcmVxdWlyZSgnLi9icm9hZGNhc3QtdG9vbHMnKTtcbiAgICAgICAgICAgIGNvbnN0IHsgU2NlbmVBZHZhbmNlZFRvb2xzIH0gPSByZXF1aXJlKCcuL3NjZW5lLWFkdmFuY2VkLXRvb2xzJyk7XG4gICAgICAgICAgICBjb25zdCB7IFNjZW5lVmlld1Rvb2xzIH0gPSByZXF1aXJlKCcuL3NjZW5lLXZpZXctdG9vbHMnKTtcbiAgICAgICAgICAgIGNvbnN0IHsgUmVmZXJlbmNlSW1hZ2VUb29scyB9ID0gcmVxdWlyZSgnLi9yZWZlcmVuY2UtaW1hZ2UtdG9vbHMnKTtcbiAgICAgICAgICAgIGNvbnN0IHsgQXNzZXRBZHZhbmNlZFRvb2xzIH0gPSByZXF1aXJlKCcuL2Fzc2V0LWFkdmFuY2VkLXRvb2xzJyk7XG4gICAgICAgICAgICBjb25zdCB7IFZhbGlkYXRpb25Ub29scyB9ID0gcmVxdWlyZSgnLi92YWxpZGF0aW9uLXRvb2xzJyk7XG5cbiAgICAgICAgICAgIC8vIEluaXRpYWxpemUgdG9vbCBpbnN0YW5jZXNcbiAgICAgICAgICAgIGNvbnN0IHRvb2xzID0ge1xuICAgICAgICAgICAgICAgIHNjZW5lOiBuZXcgU2NlbmVUb29scygpLFxuICAgICAgICAgICAgICAgIG5vZGU6IG5ldyBOb2RlVG9vbHMoKSxcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ6IG5ldyBDb21wb25lbnRUb29scygpLFxuICAgICAgICAgICAgICAgIHByZWZhYjogbmV3IFByZWZhYlRvb2xzKCksXG4gICAgICAgICAgICAgICAgcHJvamVjdDogbmV3IFByb2plY3RUb29scygpLFxuICAgICAgICAgICAgICAgIGRlYnVnOiBuZXcgRGVidWdUb29scygpLFxuICAgICAgICAgICAgICAgIHByZWZlcmVuY2VzOiBuZXcgUHJlZmVyZW5jZXNUb29scygpLFxuICAgICAgICAgICAgICAgIHNlcnZlcjogbmV3IFNlcnZlclRvb2xzKCksXG4gICAgICAgICAgICAgICAgYnJvYWRjYXN0OiBuZXcgQnJvYWRjYXN0VG9vbHMoKSxcbiAgICAgICAgICAgICAgICBzY2VuZUFkdmFuY2VkOiBuZXcgU2NlbmVBZHZhbmNlZFRvb2xzKCksXG4gICAgICAgICAgICAgICAgc2NlbmVWaWV3OiBuZXcgU2NlbmVWaWV3VG9vbHMoKSxcbiAgICAgICAgICAgICAgICByZWZlcmVuY2VJbWFnZTogbmV3IFJlZmVyZW5jZUltYWdlVG9vbHMoKSxcbiAgICAgICAgICAgICAgICBhc3NldEFkdmFuY2VkOiBuZXcgQXNzZXRBZHZhbmNlZFRvb2xzKCksXG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogbmV3IFZhbGlkYXRpb25Ub29scygpXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBHZXQgdGhlIHRvb2wgbGlzdCBmcm9tIGVhY2ggdG9vbCBjbGFzc1xuICAgICAgICAgICAgdGhpcy5hdmFpbGFibGVUb29scyA9IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbY2F0ZWdvcnksIHRvb2xTZXRdIG9mIE9iamVjdC5lbnRyaWVzKHRvb2xzKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xEZWZpbml0aW9ucyA9IHRvb2xTZXQuZ2V0VG9vbHMoKTtcbiAgICAgICAgICAgICAgICB0b29sRGVmaW5pdGlvbnMuZm9yRWFjaCgodG9vbDogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYXZhaWxhYmxlVG9vbHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXRlZ29yeTogY2F0ZWdvcnksXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB0b29sLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLCAvLyBFbmFibGVkIGJ5IGRlZmF1bHRcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0b29sLmRlc2NyaXB0aW9uXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1Rvb2xNYW5hZ2VyXSBJbml0aWFsaXplZCAke3RoaXMuYXZhaWxhYmxlVG9vbHMubGVuZ3RofSB0b29scyBmcm9tIE1DUCBzZXJ2ZXJgKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tUb29sTWFuYWdlcl0gRmFpbGVkIHRvIGluaXRpYWxpemUgdG9vbHMgZnJvbSBNQ1Agc2VydmVyOicsIGVycm9yKTtcbiAgICAgICAgICAgIC8vIElmIGZldGNoaW5nIGZhaWxzLCB1c2UgdGhlIGRlZmF1bHQgdG9vbCBsaXN0IGFzIGEgZmFsbGJhY2tcbiAgICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZURlZmF1bHRUb29scygpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBpbml0aWFsaXplRGVmYXVsdFRvb2xzKCk6IHZvaWQge1xuICAgICAgICAvLyBEZWZhdWx0IHRvb2wgbGlzdCBhcyBhIGZhbGxiYWNrXG4gICAgICAgIGNvbnN0IHRvb2xDYXRlZ29yaWVzID0gW1xuICAgICAgICAgICAgeyBjYXRlZ29yeTogJ3NjZW5lJywgbmFtZTogJ1NjZW5lIFRvb2xzJywgdG9vbHM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRDdXJyZW50U2NlbmVJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgY3VycmVudCBzY2VuZSBpbmZvcm1hdGlvbicgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRTY2VuZUhpZXJhcmNoeScsIGRlc2NyaXB0aW9uOiAnR2V0IHNjZW5lIGhpZXJhcmNoeScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdjcmVhdGVOZXdTY2VuZScsIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIG5ldyBzY2VuZScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdzYXZlU2NlbmUnLCBkZXNjcmlwdGlvbjogJ1NhdmUgc2NlbmUnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnbG9hZFNjZW5lJywgZGVzY3JpcHRpb246ICdMb2FkIHNjZW5lJyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdub2RlJywgbmFtZTogJ05vZGUgVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldEFsbE5vZGVzJywgZGVzY3JpcHRpb246ICdHZXQgYWxsIG5vZGVzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2ZpbmROb2RlQnlOYW1lJywgZGVzY3JpcHRpb246ICdGaW5kIG5vZGUgYnkgbmFtZScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdjcmVhdGVOb2RlJywgZGVzY3JpcHRpb246ICdDcmVhdGUgbm9kZScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdkZWxldGVOb2RlJywgZGVzY3JpcHRpb246ICdEZWxldGUgbm9kZScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdzZXROb2RlUHJvcGVydHknLCBkZXNjcmlwdGlvbjogJ1NldCBub2RlIHByb3BlcnRpZXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0Tm9kZUluZm8nLCBkZXNjcmlwdGlvbjogJ0dldCBub2RlIGluZm9ybWF0aW9uJyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdjb21wb25lbnQnLCBuYW1lOiAnQ29tcG9uZW50IFRvb2xzJywgdG9vbHM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdhZGRDb21wb25lbnRUb05vZGUnLCBkZXNjcmlwdGlvbjogJ0FkZCBjb21wb25lbnQgdG8gbm9kZScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdyZW1vdmVDb21wb25lbnRGcm9tTm9kZScsIGRlc2NyaXB0aW9uOiAnUmVtb3ZlIGNvbXBvbmVudCBmcm9tIG5vZGUnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnc2V0Q29tcG9uZW50UHJvcGVydHknLCBkZXNjcmlwdGlvbjogJ1NldCBjb21wb25lbnQgcHJvcGVydGllcycgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRDb21wb25lbnRJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgY29tcG9uZW50IGluZm9ybWF0aW9uJyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdwcmVmYWInLCBuYW1lOiAnUHJlZmFiIFRvb2xzJywgdG9vbHM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdjcmVhdGVQcmVmYWJGcm9tTm9kZScsIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIHByZWZhYiBmcm9tIG5vZGUnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnaW5zdGFudGlhdGVQcmVmYWInLCBkZXNjcmlwdGlvbjogJ0luc3RhbnRpYXRlIHByZWZhYicgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRQcmVmYWJJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgcHJlZmFiIGluZm9ybWF0aW9uJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3NhdmVQcmVmYWInLCBkZXNjcmlwdGlvbjogJ1NhdmUgcHJlZmFiJyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdwcm9qZWN0JywgbmFtZTogJ1Byb2plY3QgVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFByb2plY3RJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgcHJvamVjdCBpbmZvcm1hdGlvbicgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRBc3NldExpc3QnLCBkZXNjcmlwdGlvbjogJ0dldCBhc3NldCBsaXN0JyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2NyZWF0ZUFzc2V0JywgZGVzY3JpcHRpb246ICdDcmVhdGUgYXNzZXQnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZGVsZXRlQXNzZXQnLCBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBhc3NldCcgfVxuICAgICAgICAgICAgXX0sXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnZGVidWcnLCBuYW1lOiAnRGVidWcgVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldENvbnNvbGVMb2dzJywgZGVzY3JpcHRpb246ICdHZXQgY29uc29sZSBsb2dzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFBlcmZvcm1hbmNlU3RhdHMnLCBkZXNjcmlwdGlvbjogJ0dldCBwZXJmb3JtYW5jZSBzdGF0aXN0aWNzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3ZhbGlkYXRlU2NlbmUnLCBkZXNjcmlwdGlvbjogJ1ZhbGlkYXRlIHNjZW5lJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldEVycm9yTG9ncycsIGRlc2NyaXB0aW9uOiAnR2V0IGVycm9yIGxvZ3MnIH1cbiAgICAgICAgICAgIF19LFxuICAgICAgICAgICAgeyBjYXRlZ29yeTogJ3ByZWZlcmVuY2VzJywgbmFtZTogJ1ByZWZlcmVuY2VzIFRvb2xzJywgdG9vbHM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRQcmVmZXJlbmNlcycsIGRlc2NyaXB0aW9uOiAnR2V0IHByZWZlcmVuY2VzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3NldFByZWZlcmVuY2VzJywgZGVzY3JpcHRpb246ICdTZXQgcHJlZmVyZW5jZXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAncmVzZXRQcmVmZXJlbmNlcycsIGRlc2NyaXB0aW9uOiAnUmVzZXQgcHJlZmVyZW5jZXMnIH1cbiAgICAgICAgICAgIF19LFxuICAgICAgICAgICAgeyBjYXRlZ29yeTogJ3NlcnZlcicsIG5hbWU6ICdTZXJ2ZXIgVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFNlcnZlclN0YXR1cycsIGRlc2NyaXB0aW9uOiAnR2V0IHNlcnZlciBzdGF0dXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0Q29ubmVjdGVkQ2xpZW50cycsIGRlc2NyaXB0aW9uOiAnR2V0IGNvbm5lY3RlZCBjbGllbnRzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFNlcnZlckxvZ3MnLCBkZXNjcmlwdGlvbjogJ0dldCBzZXJ2ZXIgbG9ncycgfVxuICAgICAgICAgICAgXX0sXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnYnJvYWRjYXN0JywgbmFtZTogJ0Jyb2FkY2FzdCBUb29scycsIHRvb2xzOiBbXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnYnJvYWRjYXN0TWVzc2FnZScsIGRlc2NyaXB0aW9uOiAnQnJvYWRjYXN0IG1lc3NhZ2UnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0QnJvYWRjYXN0SGlzdG9yeScsIGRlc2NyaXB0aW9uOiAnR2V0IGJyb2FkY2FzdCBoaXN0b3J5JyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdzY2VuZUFkdmFuY2VkJywgbmFtZTogJ0FkdmFuY2VkIFNjZW5lIFRvb2xzJywgdG9vbHM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdvcHRpbWl6ZVNjZW5lJywgZGVzY3JpcHRpb246ICdPcHRpbWl6ZSBzY2VuZScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdhbmFseXplU2NlbmUnLCBkZXNjcmlwdGlvbjogJ0FuYWx5emUgc2NlbmUnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnYmF0Y2hPcGVyYXRpb24nLCBkZXNjcmlwdGlvbjogJ0JhdGNoIG9wZXJhdGlvbicgfVxuICAgICAgICAgICAgXX0sXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnc2NlbmVWaWV3JywgbmFtZTogJ1NjZW5lIFZpZXcgVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFZpZXdwb3J0SW5mbycsIGRlc2NyaXB0aW9uOiAnR2V0IHZpZXdwb3J0IGluZm9ybWF0aW9uJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3NldFZpZXdwb3J0Q2FtZXJhJywgZGVzY3JpcHRpb246ICdTZXQgdmlld3BvcnQgY2FtZXJhJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2ZvY3VzT25Ob2RlJywgZGVzY3JpcHRpb246ICdGb2N1cyBvbiBub2RlJyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdyZWZlcmVuY2VJbWFnZScsIG5hbWU6ICdSZWZlcmVuY2UgSW1hZ2UgVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2FkZFJlZmVyZW5jZUltYWdlJywgZGVzY3JpcHRpb246ICdBZGQgcmVmZXJlbmNlIGltYWdlJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3JlbW92ZVJlZmVyZW5jZUltYWdlJywgZGVzY3JpcHRpb246ICdSZW1vdmUgcmVmZXJlbmNlIGltYWdlJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFJlZmVyZW5jZUltYWdlcycsIGRlc2NyaXB0aW9uOiAnR2V0IHJlZmVyZW5jZSBpbWFnZSBsaXN0JyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdhc3NldEFkdmFuY2VkJywgbmFtZTogJ0FkdmFuY2VkIEFzc2V0IFRvb2xzJywgdG9vbHM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdpbXBvcnRBc3NldCcsIGRlc2NyaXB0aW9uOiAnSW1wb3J0IGFzc2V0JyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2V4cG9ydEFzc2V0JywgZGVzY3JpcHRpb246ICdFeHBvcnQgYXNzZXQnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAncHJvY2Vzc0Fzc2V0JywgZGVzY3JpcHRpb246ICdQcm9jZXNzIGFzc2V0JyB9XG4gICAgICAgICAgICBdfSxcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICd2YWxpZGF0aW9uJywgbmFtZTogJ1ZhbGlkYXRpb24gVG9vbHMnLCB0b29sczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3ZhbGlkYXRlUHJvamVjdCcsIGRlc2NyaXB0aW9uOiAnVmFsaWRhdGUgcHJvamVjdCcgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICd2YWxpZGF0ZUFzc2V0cycsIGRlc2NyaXB0aW9uOiAnVmFsaWRhdGUgYXNzZXRzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dlbmVyYXRlUmVwb3J0JywgZGVzY3JpcHRpb246ICdHZW5lcmF0ZSByZXBvcnQnIH1cbiAgICAgICAgICAgIF19XG4gICAgICAgIF07XG5cbiAgICAgICAgdGhpcy5hdmFpbGFibGVUb29scyA9IFtdO1xuICAgICAgICB0b29sQ2F0ZWdvcmllcy5mb3JFYWNoKGNhdGVnb3J5ID0+IHtcbiAgICAgICAgICAgIGNhdGVnb3J5LnRvb2xzLmZvckVhY2godG9vbCA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5hdmFpbGFibGVUb29scy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgY2F0ZWdvcnk6IGNhdGVnb3J5LmNhdGVnb3J5LFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiB0b29sLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZWQgYnkgZGVmYXVsdFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogdG9vbC5kZXNjcmlwdGlvblxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBbVG9vbE1hbmFnZXJdIEluaXRpYWxpemVkICR7dGhpcy5hdmFpbGFibGVUb29scy5sZW5ndGh9IGRlZmF1bHQgdG9vbHNgKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0QXZhaWxhYmxlVG9vbHMoKTogVG9vbENvbmZpZ1tdIHtcbiAgICAgICAgcmV0dXJuIFsuLi50aGlzLmF2YWlsYWJsZVRvb2xzXTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q29uZmlndXJhdGlvbnMoKTogVG9vbENvbmZpZ3VyYXRpb25bXSB7XG4gICAgICAgIHJldHVybiBbLi4udGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9uc107XG4gICAgfVxuXG4gICAgcHVibGljIGdldEN1cnJlbnRDb25maWd1cmF0aW9uKCk6IFRvb2xDb25maWd1cmF0aW9uIHwgbnVsbCB7XG4gICAgICAgIGlmICghdGhpcy5zZXR0aW5ncy5jdXJyZW50Q29uZmlnSWQpIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmQoY29uZmlnID0+IGNvbmZpZy5pZCA9PT0gdGhpcy5zZXR0aW5ncy5jdXJyZW50Q29uZmlnSWQpIHx8IG51bGw7XG4gICAgfVxuXG4gICAgcHVibGljIGNyZWF0ZUNvbmZpZ3VyYXRpb24obmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbj86IHN0cmluZyk6IFRvb2xDb25maWd1cmF0aW9uIHtcbiAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMubGVuZ3RoID49IHRoaXMuc2V0dGluZ3MubWF4Q29uZmlnU2xvdHMpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWF4aW11bSBudW1iZXIgb2YgY29uZmlndXJhdGlvbiBzbG90cyByZWFjaGVkICgke3RoaXMuc2V0dGluZ3MubWF4Q29uZmlnU2xvdHN9KWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uZmlnOiBUb29sQ29uZmlndXJhdGlvbiA9IHtcbiAgICAgICAgICAgIGlkOiB1dWlkdjQoKSxcbiAgICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgICAgIHRvb2xzOiB0aGlzLmF2YWlsYWJsZVRvb2xzLm1hcCh0b29sID0+ICh7IC4uLnRvb2wgfSkpLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMucHVzaChjb25maWcpO1xuICAgICAgICB0aGlzLnNldHRpbmdzLmN1cnJlbnRDb25maWdJZCA9IGNvbmZpZy5pZDtcbiAgICAgICAgdGhpcy5zYXZlU2V0dGluZ3MoKTtcblxuICAgICAgICByZXR1cm4gY29uZmlnO1xuICAgIH1cblxuICAgIHB1YmxpYyB1cGRhdGVDb25maWd1cmF0aW9uKGNvbmZpZ0lkOiBzdHJpbmcsIHVwZGF0ZXM6IFBhcnRpYWw8VG9vbENvbmZpZ3VyYXRpb24+KTogVG9vbENvbmZpZ3VyYXRpb24ge1xuICAgICAgICBjb25zdCBjb25maWdJbmRleCA9IHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZEluZGV4KGNvbmZpZyA9PiBjb25maWcuaWQgPT09IGNvbmZpZ0lkKTtcbiAgICAgICAgaWYgKGNvbmZpZ0luZGV4ID09PSAtMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb25maWd1cmF0aW9uIG5vdCBmb3VuZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9uc1tjb25maWdJbmRleF07XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRDb25maWc6IFRvb2xDb25maWd1cmF0aW9uID0ge1xuICAgICAgICAgICAgLi4uY29uZmlnLFxuICAgICAgICAgICAgLi4udXBkYXRlcyxcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH07XG5cbiAgICAgICAgdGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9uc1tjb25maWdJbmRleF0gPSB1cGRhdGVkQ29uZmlnO1xuICAgICAgICB0aGlzLnNhdmVTZXR0aW5ncygpO1xuXG4gICAgICAgIHJldHVybiB1cGRhdGVkQ29uZmlnO1xuICAgIH1cblxuICAgIHB1YmxpYyBkZWxldGVDb25maWd1cmF0aW9uKGNvbmZpZ0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY29uZmlnSW5kZXggPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmRJbmRleChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XG4gICAgICAgIGlmIChjb25maWdJbmRleCA9PT0gLTEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29uZmlndXJhdGlvbiBub3QgZm91bmQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuc3BsaWNlKGNvbmZpZ0luZGV4LCAxKTtcbiAgICAgICAgXG4gICAgICAgIC8vIElmIHRoZSBkZWxldGVkIGNvbmZpZ3VyYXRpb24gaXMgdGhlIGN1cnJlbnQgb25lLCBjbGVhciB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uIElEXG4gICAgICAgIGlmICh0aGlzLnNldHRpbmdzLmN1cnJlbnRDb25maWdJZCA9PT0gY29uZmlnSWQpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0dGluZ3MuY3VycmVudENvbmZpZ0lkID0gdGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9ucy5sZW5ndGggPiAwIFxuICAgICAgICAgICAgICAgID8gdGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9uc1swXS5pZCBcbiAgICAgICAgICAgICAgICA6ICcnO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0Q3VycmVudENvbmZpZ3VyYXRpb24oY29uZmlnSWQ6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBjb25maWcgPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmQoY29uZmlnID0+IGNvbmZpZy5pZCA9PT0gY29uZmlnSWQpO1xuICAgICAgICBpZiAoIWNvbmZpZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb25maWd1cmF0aW9uIG5vdCBmb3VuZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zZXR0aW5ncy5jdXJyZW50Q29uZmlnSWQgPSBjb25maWdJZDtcbiAgICAgICAgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgdXBkYXRlVG9vbFN0YXR1cyhjb25maWdJZDogc3RyaW5nLCBjYXRlZ29yeTogc3RyaW5nLCB0b29sTmFtZTogc3RyaW5nLCBlbmFibGVkOiBib29sZWFuKTogdm9pZCB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBVcGRhdGluZyB0b29sIHN0YXR1cyAtIGNvbmZpZ0lkOiAke2NvbmZpZ0lkfSwgY2F0ZWdvcnk6ICR7Y2F0ZWdvcnl9LCB0b29sTmFtZTogJHt0b29sTmFtZX0sIGVuYWJsZWQ6ICR7ZW5hYmxlZH1gKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XG4gICAgICAgIGlmICghY29uZmlnKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBCYWNrZW5kOiBDb25maWcgbm90IGZvdW5kIHdpdGggSUQ6ICR7Y29uZmlnSWR9YCk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmZpZ3VyYXRpb24gbm90IGZvdW5kJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhgQmFja2VuZDogRm91bmQgY29uZmlnOiAke2NvbmZpZy5uYW1lfWApO1xuXG4gICAgICAgIGNvbnN0IHRvb2wgPSBjb25maWcudG9vbHMuZmluZCh0ID0+IHQuY2F0ZWdvcnkgPT09IGNhdGVnb3J5ICYmIHQubmFtZSA9PT0gdG9vbE5hbWUpO1xuICAgICAgICBpZiAoIXRvb2wpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEJhY2tlbmQ6IFRvb2wgbm90IGZvdW5kIC0gY2F0ZWdvcnk6ICR7Y2F0ZWdvcnl9LCBuYW1lOiAke3Rvb2xOYW1lfWApO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUb29sIG5vdCBmb3VuZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IEZvdW5kIHRvb2w6ICR7dG9vbC5uYW1lfSwgY3VycmVudCBlbmFibGVkOiAke3Rvb2wuZW5hYmxlZH0sIG5ldyBlbmFibGVkOiAke2VuYWJsZWR9YCk7XG4gICAgICAgIFxuICAgICAgICB0b29sLmVuYWJsZWQgPSBlbmFibGVkO1xuICAgICAgICBjb25maWcudXBkYXRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBcbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IFRvb2wgdXBkYXRlZCwgc2F2aW5nIHNldHRpbmdzLi4uYCk7XG4gICAgICAgIHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBTZXR0aW5ncyBzYXZlZCBzdWNjZXNzZnVsbHlgKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgdXBkYXRlVG9vbFN0YXR1c0JhdGNoKGNvbmZpZ0lkOiBzdHJpbmcsIHVwZGF0ZXM6IHsgY2F0ZWdvcnk6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBlbmFibGVkOiBib29sZWFuIH1bXSk6IHZvaWQge1xuICAgICAgICBjb25zb2xlLmxvZyhgQmFja2VuZDogdXBkYXRlVG9vbFN0YXR1c0JhdGNoIGNhbGxlZCB3aXRoIGNvbmZpZ0lkOiAke2NvbmZpZ0lkfWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgQmFja2VuZDogQ3VycmVudCBjb25maWd1cmF0aW9ucyBjb3VudDogJHt0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmxlbmd0aH1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IEN1cnJlbnQgY29uZmlnIElEczpgLCB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLm1hcChjID0+IGMuaWQpKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XG4gICAgICAgIGlmICghY29uZmlnKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBCYWNrZW5kOiBDb25maWcgbm90IGZvdW5kIHdpdGggSUQ6ICR7Y29uZmlnSWR9YCk7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBCYWNrZW5kOiBBdmFpbGFibGUgY29uZmlnIElEczpgLCB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLm1hcChjID0+IGMuaWQpKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29uZmlndXJhdGlvbiBub3QgZm91bmQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBGb3VuZCBjb25maWc6ICR7Y29uZmlnLm5hbWV9LCB1cGRhdGluZyAke3VwZGF0ZXMubGVuZ3RofSB0b29sc2ApO1xuXG4gICAgICAgIHVwZGF0ZXMuZm9yRWFjaCh1cGRhdGUgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9vbCA9IGNvbmZpZy50b29scy5maW5kKHQgPT4gdC5jYXRlZ29yeSA9PT0gdXBkYXRlLmNhdGVnb3J5ICYmIHQubmFtZSA9PT0gdXBkYXRlLm5hbWUpO1xuICAgICAgICAgICAgaWYgKHRvb2wpIHtcbiAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSB1cGRhdGUuZW5hYmxlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uZmlnLnVwZGF0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IEJhdGNoIHVwZGF0ZSBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5YCk7XG4gICAgfVxuXG4gICAgcHVibGljIGV4cG9ydENvbmZpZ3VyYXRpb24oY29uZmlnSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XG4gICAgICAgIGlmICghY29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmZpZ3VyYXRpb24gbm90IGZvdW5kJyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5leHBvcnRUb29sQ29uZmlndXJhdGlvbihjb25maWcpO1xuICAgIH1cblxuICAgIHB1YmxpYyBpbXBvcnRDb25maWd1cmF0aW9uKGNvbmZpZ0pzb246IHN0cmluZyk6IFRvb2xDb25maWd1cmF0aW9uIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5pbXBvcnRUb29sQ29uZmlndXJhdGlvbihjb25maWdKc29uKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEdlbmVyYXRlIGEgbmV3IElEIGFuZCB0aW1lc3RhbXBzXG4gICAgICAgIGNvbmZpZy5pZCA9IHV1aWR2NCgpO1xuICAgICAgICBjb25maWcuY3JlYXRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBjb25maWcudXBkYXRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgICAgIGlmICh0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmxlbmd0aCA+PSB0aGlzLnNldHRpbmdzLm1heENvbmZpZ1Nsb3RzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1heGltdW0gbnVtYmVyIG9mIGNvbmZpZ3VyYXRpb24gc2xvdHMgcmVhY2hlZCAoJHt0aGlzLnNldHRpbmdzLm1heENvbmZpZ1Nsb3RzfSlgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMucHVzaChjb25maWcpO1xuICAgICAgICB0aGlzLnNhdmVTZXR0aW5ncygpO1xuXG4gICAgICAgIHJldHVybiBjb25maWc7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEVuYWJsZWRUb29scygpOiBUb29sQ29uZmlnW10ge1xuICAgICAgICBjb25zdCBjdXJyZW50Q29uZmlnID0gdGhpcy5nZXRDdXJyZW50Q29uZmlndXJhdGlvbigpO1xuICAgICAgICBpZiAoIWN1cnJlbnRDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmF2YWlsYWJsZVRvb2xzLmZpbHRlcih0b29sID0+IHRvb2wuZW5hYmxlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGN1cnJlbnRDb25maWcudG9vbHMuZmlsdGVyKHRvb2wgPT4gdG9vbC5lbmFibGVkKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0VG9vbE1hbmFnZXJTdGF0ZSgpIHtcbiAgICAgICAgY29uc3QgY3VycmVudENvbmZpZyA9IHRoaXMuZ2V0Q3VycmVudENvbmZpZ3VyYXRpb24oKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBhdmFpbGFibGVUb29sczogY3VycmVudENvbmZpZyA/IGN1cnJlbnRDb25maWcudG9vbHMgOiB0aGlzLmdldEF2YWlsYWJsZVRvb2xzKCksXG4gICAgICAgICAgICBzZWxlY3RlZENvbmZpZ0lkOiB0aGlzLnNldHRpbmdzLmN1cnJlbnRDb25maWdJZCxcbiAgICAgICAgICAgIGNvbmZpZ3VyYXRpb25zOiB0aGlzLmdldENvbmZpZ3VyYXRpb25zKCksXG4gICAgICAgICAgICBtYXhDb25maWdTbG90czogdGhpcy5zZXR0aW5ncy5tYXhDb25maWdTbG90c1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgc2F2ZVNldHRpbmdzKCk6IHZvaWQge1xuICAgICAgICBjb25zb2xlLmxvZyhgQmFja2VuZDogU2F2aW5nIHNldHRpbmdzLCBjdXJyZW50IGNvbmZpZ3MgY291bnQ6ICR7dGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9ucy5sZW5ndGh9YCk7XG4gICAgICAgIHRoaXMuc2F2ZVRvb2xNYW5hZ2VyU2V0dGluZ3ModGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBTZXR0aW5ncyBzYXZlZCB0byBmaWxlYCk7XG4gICAgfVxufSAiXX0=