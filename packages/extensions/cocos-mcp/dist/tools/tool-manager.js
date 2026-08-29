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
        else {
            this.reconcileConfigurations();
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
            const { EditorRuntimeTools } = require('./editor-runtime-tools');
            const { EngineFeatureTools } = require('./engine-feature-tools');
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
                validation: new ValidationTools(),
                editorRuntime: new EditorRuntimeTools(),
                engineFeature: new EngineFeatureTools()
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
    /**
     * Saved configurations used to be a closed whitelist. After an extension
     * update, newly shipped tools therefore stayed invisible forever. Merge
     * new definitions into every saved configuration, enabled by default,
     * while preserving every explicit user toggle.
     */
    reconcileConfigurations() {
        const available = new Map(this.availableTools.map((tool) => [`${tool.category}_${tool.name}`, tool]));
        let changed = false;
        for (const config of this.settings.configurations) {
            let configChanged = false;
            const saved = new Map(config.tools.map((tool) => [`${tool.category}_${tool.name}`, tool]));
            for (const [key, tool] of available) {
                const existing = saved.get(key);
                if (!existing) {
                    config.tools.push(Object.assign(Object.assign({}, tool), { enabled: true }));
                    configChanged = true;
                }
                else if (existing.description !== tool.description) {
                    existing.description = tool.description;
                    configChanged = true;
                }
            }
            if (configChanged) {
                config.updatedAt = new Date().toISOString();
                changed = true;
            }
        }
        if (changed)
            this.saveToolManagerSettings(this.settings);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9vbC1tYW5hZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc291cmNlL3Rvb2xzL3Rvb2wtbWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSwrQkFBb0M7QUFFcEMsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUU3QixNQUFhLFdBQVc7SUFJcEI7UUFGUSxtQkFBYyxHQUFpQixFQUFFLENBQUM7UUFHdEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztRQUMvQyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztRQUVoQyxpRUFBaUU7UUFDakUsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDNUMsT0FBTyxDQUFDLEdBQUcsQ0FBQywwRUFBMEUsQ0FBQyxDQUFDO1lBQ3hGLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyx1QkFBdUIsRUFBRSxrREFBa0QsQ0FBQyxDQUFDO1FBQzFHLENBQUM7YUFBTSxDQUFDO1lBQ0osSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFDbkMsQ0FBQztJQUNMLENBQUM7SUFFTywwQkFBMEI7UUFDOUIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO0lBQzNFLENBQUM7SUFFTyxpQkFBaUI7UUFDckIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQyxDQUFDO1FBQ3BFLElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDOUIsRUFBRSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFF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UUFDdkcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM1QyxPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7SUFDbkQsQ0FBQztDQUNKO0FBM2NELGtDQTJjQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5pbXBvcnQgeyBUb29sQ29uZmlnLCBUb29sQ29uZmlndXJhdGlvbiwgVG9vbE1hbmFnZXJTZXR0aW5ncywgVG9vbERlZmluaXRpb24gfSBmcm9tICcuLi90eXBlcyc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuXHJcbmV4cG9ydCBjbGFzcyBUb29sTWFuYWdlciB7XHJcbiAgICBwcml2YXRlIHNldHRpbmdzOiBUb29sTWFuYWdlclNldHRpbmdzO1xyXG4gICAgcHJpdmF0ZSBhdmFpbGFibGVUb29sczogVG9vbENvbmZpZ1tdID0gW107XHJcblxyXG4gICAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHRoaXMucmVhZFRvb2xNYW5hZ2VyU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVBdmFpbGFibGVUb29scygpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIG5vIGNvbmZpZ3VyYXRpb24gZXhpc3RzLCBjcmVhdGUgYSBkZWZhdWx0IG9uZSBhdXRvbWF0aWNhbGx5XHJcbiAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVG9vbE1hbmFnZXJdIE5vIGNvbmZpZ3VyYXRpb25zIGZvdW5kLCBjcmVhdGluZyBkZWZhdWx0IGNvbmZpZ3VyYXRpb24uLi4nKTtcclxuICAgICAgICAgICAgdGhpcy5jcmVhdGVDb25maWd1cmF0aW9uKCdEZWZhdWx0IENvbmZpZ3VyYXRpb24nLCAnRGVmYXVsdCB0b29sIGNvbmZpZ3VyYXRpb24gY3JlYXRlZCBhdXRvbWF0aWNhbGx5Jyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5yZWNvbmNpbGVDb25maWd1cmF0aW9ucygpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk6IHN0cmluZyB7XHJcbiAgICAgICAgcmV0dXJuIHBhdGguam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnc2V0dGluZ3MnLCAndG9vbC1tYW5hZ2VyLmpzb24nKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGVuc3VyZVNldHRpbmdzRGlyKCk6IHZvaWQge1xyXG4gICAgICAgIGNvbnN0IHNldHRpbmdzRGlyID0gcGF0aC5kaXJuYW1lKHRoaXMuZ2V0VG9vbE1hbmFnZXJTZXR0aW5nc1BhdGgoKSk7XHJcbiAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKHNldHRpbmdzRGlyKSkge1xyXG4gICAgICAgICAgICBmcy5ta2RpclN5bmMoc2V0dGluZ3NEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlYWRUb29sTWFuYWdlclNldHRpbmdzKCk6IFRvb2xNYW5hZ2VyU2V0dGluZ3Mge1xyXG4gICAgICAgIGNvbnN0IERFRkFVTFRfVE9PTF9NQU5BR0VSX1NFVFRJTkdTOiBUb29sTWFuYWdlclNldHRpbmdzID0ge1xyXG4gICAgICAgICAgICBjb25maWd1cmF0aW9uczogW10sXHJcbiAgICAgICAgICAgIGN1cnJlbnRDb25maWdJZDogJycsXHJcbiAgICAgICAgICAgIG1heENvbmZpZ1Nsb3RzOiA1XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhpcy5lbnN1cmVTZXR0aW5nc0RpcigpO1xyXG4gICAgICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSB0aGlzLmdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk7XHJcbiAgICAgICAgICAgIGlmIChmcy5leGlzdHNTeW5jKHNldHRpbmdzRmlsZSkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoc2V0dGluZ3NGaWxlLCAndXRmOCcpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4uREVGQVVMVF9UT09MX01BTkFHRVJfU0VUVElOR1MsIC4uLkpTT04ucGFyc2UoY29udGVudCkgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlYWQgdG9vbCBtYW5hZ2VyIHNldHRpbmdzOicsIGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gREVGQVVMVF9UT09MX01BTkFHRVJfU0VUVElOR1M7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBzYXZlVG9vbE1hbmFnZXJTZXR0aW5ncyhzZXR0aW5nczogVG9vbE1hbmFnZXJTZXR0aW5ncyk6IHZvaWQge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRoaXMuZW5zdXJlU2V0dGluZ3NEaXIoKTtcclxuICAgICAgICAgICAgY29uc3Qgc2V0dGluZ3NGaWxlID0gdGhpcy5nZXRUb29sTWFuYWdlclNldHRpbmdzUGF0aCgpO1xyXG4gICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHNldHRpbmdzRmlsZSwgSlNPTi5zdHJpbmdpZnkoc2V0dGluZ3MsIG51bGwsIDIpKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzYXZlIHRvb2wgbWFuYWdlciBzZXR0aW5nczonLCBlKTtcclxuICAgICAgICAgICAgdGhyb3cgZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBleHBvcnRUb29sQ29uZmlndXJhdGlvbihjb25maWc6IFRvb2xDb25maWd1cmF0aW9uKTogc3RyaW5nIHtcclxuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoY29uZmlnLCBudWxsLCAyKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGltcG9ydFRvb2xDb25maWd1cmF0aW9uKGNvbmZpZ0pzb246IHN0cmluZyk6IFRvb2xDb25maWd1cmF0aW9uIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKGNvbmZpZ0pzb24pO1xyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBjb25maWd1cmF0aW9uIGZvcm1hdFxyXG4gICAgICAgICAgICBpZiAoIWNvbmZpZy5pZCB8fCAhY29uZmlnLm5hbWUgfHwgIUFycmF5LmlzQXJyYXkoY29uZmlnLnRvb2xzKSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvbmZpZ3VyYXRpb24gZm9ybWF0Jyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIGNvbmZpZztcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBwYXJzZSB0b29sIGNvbmZpZ3VyYXRpb246JywgZSk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBKU09OIGZvcm1hdCBvciBjb25maWd1cmF0aW9uIHN0cnVjdHVyZScpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGluaXRpYWxpemVBdmFpbGFibGVUb29scygpOiB2b2lkIHtcclxuICAgICAgICAvLyBHZXQgdGhlIGFjdHVhbCB0b29sIGxpc3QgZnJvbSB0aGUgTUNQIHNlcnZlclxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEltcG9ydCBhbGwgdG9vbCBjbGFzc2VzXHJcbiAgICAgICAgICAgIGNvbnN0IHsgU2NlbmVUb29scyB9ID0gcmVxdWlyZSgnLi9zY2VuZS10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IE5vZGVUb29scyB9ID0gcmVxdWlyZSgnLi9ub2RlLXRvb2xzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgQ29tcG9uZW50VG9vbHMgfSA9IHJlcXVpcmUoJy4vY29tcG9uZW50LXRvb2xzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgUHJlZmFiVG9vbHMgfSA9IHJlcXVpcmUoJy4vcHJlZmFiLXRvb2xzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgUHJvamVjdFRvb2xzIH0gPSByZXF1aXJlKCcuL3Byb2plY3QtdG9vbHMnKTtcclxuICAgICAgICAgICAgY29uc3QgeyBEZWJ1Z1Rvb2xzIH0gPSByZXF1aXJlKCcuL2RlYnVnLXRvb2xzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgUHJlZmVyZW5jZXNUb29scyB9ID0gcmVxdWlyZSgnLi9wcmVmZXJlbmNlcy10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IFNlcnZlclRvb2xzIH0gPSByZXF1aXJlKCcuL3NlcnZlci10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IEJyb2FkY2FzdFRvb2xzIH0gPSByZXF1aXJlKCcuL2Jyb2FkY2FzdC10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IFNjZW5lQWR2YW5jZWRUb29scyB9ID0gcmVxdWlyZSgnLi9zY2VuZS1hZHZhbmNlZC10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IFNjZW5lVmlld1Rvb2xzIH0gPSByZXF1aXJlKCcuL3NjZW5lLXZpZXctdG9vbHMnKTtcclxuICAgICAgICAgICAgY29uc3QgeyBSZWZlcmVuY2VJbWFnZVRvb2xzIH0gPSByZXF1aXJlKCcuL3JlZmVyZW5jZS1pbWFnZS10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IEFzc2V0QWR2YW5jZWRUb29scyB9ID0gcmVxdWlyZSgnLi9hc3NldC1hZHZhbmNlZC10b29scycpO1xyXG4gICAgICAgICAgICBjb25zdCB7IFZhbGlkYXRpb25Ub29scyB9ID0gcmVxdWlyZSgnLi92YWxpZGF0aW9uLXRvb2xzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgRWRpdG9yUnVudGltZVRvb2xzIH0gPSByZXF1aXJlKCcuL2VkaXRvci1ydW50aW1lLXRvb2xzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgRW5naW5lRmVhdHVyZVRvb2xzIH0gPSByZXF1aXJlKCcuL2VuZ2luZS1mZWF0dXJlLXRvb2xzJyk7XHJcblxyXG4gICAgICAgICAgICAvLyBJbml0aWFsaXplIHRvb2wgaW5zdGFuY2VzXHJcbiAgICAgICAgICAgIGNvbnN0IHRvb2xzID0ge1xyXG4gICAgICAgICAgICAgICAgc2NlbmU6IG5ldyBTY2VuZVRvb2xzKCksXHJcbiAgICAgICAgICAgICAgICBub2RlOiBuZXcgTm9kZVRvb2xzKCksXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ6IG5ldyBDb21wb25lbnRUb29scygpLFxyXG4gICAgICAgICAgICAgICAgcHJlZmFiOiBuZXcgUHJlZmFiVG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIHByb2plY3Q6IG5ldyBQcm9qZWN0VG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIGRlYnVnOiBuZXcgRGVidWdUb29scygpLFxyXG4gICAgICAgICAgICAgICAgcHJlZmVyZW5jZXM6IG5ldyBQcmVmZXJlbmNlc1Rvb2xzKCksXHJcbiAgICAgICAgICAgICAgICBzZXJ2ZXI6IG5ldyBTZXJ2ZXJUb29scygpLFxyXG4gICAgICAgICAgICAgICAgYnJvYWRjYXN0OiBuZXcgQnJvYWRjYXN0VG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIHNjZW5lQWR2YW5jZWQ6IG5ldyBTY2VuZUFkdmFuY2VkVG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIHNjZW5lVmlldzogbmV3IFNjZW5lVmlld1Rvb2xzKCksXHJcbiAgICAgICAgICAgICAgICByZWZlcmVuY2VJbWFnZTogbmV3IFJlZmVyZW5jZUltYWdlVG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIGFzc2V0QWR2YW5jZWQ6IG5ldyBBc3NldEFkdmFuY2VkVG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IG5ldyBWYWxpZGF0aW9uVG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIGVkaXRvclJ1bnRpbWU6IG5ldyBFZGl0b3JSdW50aW1lVG9vbHMoKSxcclxuICAgICAgICAgICAgICAgIGVuZ2luZUZlYXR1cmU6IG5ldyBFbmdpbmVGZWF0dXJlVG9vbHMoKVxyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0b29sIGxpc3QgZnJvbSBlYWNoIHRvb2wgY2xhc3NcclxuICAgICAgICAgICAgdGhpcy5hdmFpbGFibGVUb29scyA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtjYXRlZ29yeSwgdG9vbFNldF0gb2YgT2JqZWN0LmVudHJpZXModG9vbHMpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0b29sRGVmaW5pdGlvbnMgPSB0b29sU2V0LmdldFRvb2xzKCk7XHJcbiAgICAgICAgICAgICAgICB0b29sRGVmaW5pdGlvbnMuZm9yRWFjaCgodG9vbDogYW55KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hdmFpbGFibGVUb29scy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2F0ZWdvcnk6IGNhdGVnb3J5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB0b29sLm5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZWQgYnkgZGVmYXVsdFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogdG9vbC5kZXNjcmlwdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVG9vbE1hbmFnZXJdIEluaXRpYWxpemVkICR7dGhpcy5hdmFpbGFibGVUb29scy5sZW5ndGh9IHRvb2xzIGZyb20gTUNQIHNlcnZlcmApO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tUb29sTWFuYWdlcl0gRmFpbGVkIHRvIGluaXRpYWxpemUgdG9vbHMgZnJvbSBNQ1Agc2VydmVyOicsIGVycm9yKTtcclxuICAgICAgICAgICAgLy8gSWYgZmV0Y2hpbmcgZmFpbHMsIHVzZSB0aGUgZGVmYXVsdCB0b29sIGxpc3QgYXMgYSBmYWxsYmFja1xyXG4gICAgICAgICAgICB0aGlzLmluaXRpYWxpemVEZWZhdWx0VG9vbHMoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTYXZlZCBjb25maWd1cmF0aW9ucyB1c2VkIHRvIGJlIGEgY2xvc2VkIHdoaXRlbGlzdC4gQWZ0ZXIgYW4gZXh0ZW5zaW9uXHJcbiAgICAgKiB1cGRhdGUsIG5ld2x5IHNoaXBwZWQgdG9vbHMgdGhlcmVmb3JlIHN0YXllZCBpbnZpc2libGUgZm9yZXZlci4gTWVyZ2VcclxuICAgICAqIG5ldyBkZWZpbml0aW9ucyBpbnRvIGV2ZXJ5IHNhdmVkIGNvbmZpZ3VyYXRpb24sIGVuYWJsZWQgYnkgZGVmYXVsdCxcclxuICAgICAqIHdoaWxlIHByZXNlcnZpbmcgZXZlcnkgZXhwbGljaXQgdXNlciB0b2dnbGUuXHJcbiAgICAgKi9cclxuICAgIHByaXZhdGUgcmVjb25jaWxlQ29uZmlndXJhdGlvbnMoKTogdm9pZCB7XHJcbiAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gbmV3IE1hcChcclxuICAgICAgICAgICAgdGhpcy5hdmFpbGFibGVUb29scy5tYXAoKHRvb2wpID0+IFtgJHt0b29sLmNhdGVnb3J5fV8ke3Rvb2wubmFtZX1gLCB0b29sXSlcclxuICAgICAgICApO1xyXG4gICAgICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgY29uZmlnIG9mIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMpIHtcclxuICAgICAgICAgICAgbGV0IGNvbmZpZ0NoYW5nZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgY29uc3Qgc2F2ZWQgPSBuZXcgTWFwKGNvbmZpZy50b29scy5tYXAoKHRvb2wpID0+IFtgJHt0b29sLmNhdGVnb3J5fV8ke3Rvb2wubmFtZX1gLCB0b29sXSkpO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHRvb2xdIG9mIGF2YWlsYWJsZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBzYXZlZC5nZXQoa2V5KTtcclxuICAgICAgICAgICAgICAgIGlmICghZXhpc3RpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25maWcudG9vbHMucHVzaCh7IC4uLnRvb2wsIGVuYWJsZWQ6IHRydWUgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGV4aXN0aW5nLmRlc2NyaXB0aW9uICE9PSB0b29sLmRlc2NyaXB0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcuZGVzY3JpcHRpb24gPSB0b29sLmRlc2NyaXB0aW9uO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZ0NoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChjb25maWdDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBjb25maWcudXBkYXRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChjaGFuZ2VkKSB0aGlzLnNhdmVUb29sTWFuYWdlclNldHRpbmdzKHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgaW5pdGlhbGl6ZURlZmF1bHRUb29scygpOiB2b2lkIHtcclxuICAgICAgICAvLyBEZWZhdWx0IHRvb2wgbGlzdCBhcyBhIGZhbGxiYWNrXHJcbiAgICAgICAgY29uc3QgdG9vbENhdGVnb3JpZXMgPSBbXHJcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdzY2VuZScsIG5hbWU6ICdTY2VuZSBUb29scycsIHRvb2xzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRDdXJyZW50U2NlbmVJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgY3VycmVudCBzY2VuZSBpbmZvcm1hdGlvbicgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFNjZW5lSGllcmFyY2h5JywgZGVzY3JpcHRpb246ICdHZXQgc2NlbmUgaGllcmFyY2h5JyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnY3JlYXRlTmV3U2NlbmUnLCBkZXNjcmlwdGlvbjogJ0NyZWF0ZSBuZXcgc2NlbmUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdzYXZlU2NlbmUnLCBkZXNjcmlwdGlvbjogJ1NhdmUgc2NlbmUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdsb2FkU2NlbmUnLCBkZXNjcmlwdGlvbjogJ0xvYWQgc2NlbmUnIH1cclxuICAgICAgICAgICAgXX0sXHJcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdub2RlJywgbmFtZTogJ05vZGUgVG9vbHMnLCB0b29sczogW1xyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0QWxsTm9kZXMnLCBkZXNjcmlwdGlvbjogJ0dldCBhbGwgbm9kZXMnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdmaW5kTm9kZUJ5TmFtZScsIGRlc2NyaXB0aW9uOiAnRmluZCBub2RlIGJ5IG5hbWUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdjcmVhdGVOb2RlJywgZGVzY3JpcHRpb246ICdDcmVhdGUgbm9kZScgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2RlbGV0ZU5vZGUnLCBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBub2RlJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnc2V0Tm9kZVByb3BlcnR5JywgZGVzY3JpcHRpb246ICdTZXQgbm9kZSBwcm9wZXJ0aWVzJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0Tm9kZUluZm8nLCBkZXNjcmlwdGlvbjogJ0dldCBub2RlIGluZm9ybWF0aW9uJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnY29tcG9uZW50JywgbmFtZTogJ0NvbXBvbmVudCBUb29scycsIHRvb2xzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdhZGRDb21wb25lbnRUb05vZGUnLCBkZXNjcmlwdGlvbjogJ0FkZCBjb21wb25lbnQgdG8gbm9kZScgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3JlbW92ZUNvbXBvbmVudEZyb21Ob2RlJywgZGVzY3JpcHRpb246ICdSZW1vdmUgY29tcG9uZW50IGZyb20gbm9kZScgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3NldENvbXBvbmVudFByb3BlcnR5JywgZGVzY3JpcHRpb246ICdTZXQgY29tcG9uZW50IHByb3BlcnRpZXMnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRDb21wb25lbnRJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgY29tcG9uZW50IGluZm9ybWF0aW9uJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAncHJlZmFiJywgbmFtZTogJ1ByZWZhYiBUb29scycsIHRvb2xzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdjcmVhdGVQcmVmYWJGcm9tTm9kZScsIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIHByZWZhYiBmcm9tIG5vZGUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdpbnN0YW50aWF0ZVByZWZhYicsIGRlc2NyaXB0aW9uOiAnSW5zdGFudGlhdGUgcHJlZmFiJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0UHJlZmFiSW5mbycsIGRlc2NyaXB0aW9uOiAnR2V0IHByZWZhYiBpbmZvcm1hdGlvbicgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3NhdmVQcmVmYWInLCBkZXNjcmlwdGlvbjogJ1NhdmUgcHJlZmFiJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAncHJvamVjdCcsIG5hbWU6ICdQcm9qZWN0IFRvb2xzJywgdG9vbHM6IFtcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldFByb2plY3RJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgcHJvamVjdCBpbmZvcm1hdGlvbicgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldEFzc2V0TGlzdCcsIGRlc2NyaXB0aW9uOiAnR2V0IGFzc2V0IGxpc3QnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdjcmVhdGVBc3NldCcsIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIGFzc2V0JyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZGVsZXRlQXNzZXQnLCBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBhc3NldCcgfVxyXG4gICAgICAgICAgICBdfSxcclxuICAgICAgICAgICAgeyBjYXRlZ29yeTogJ2RlYnVnJywgbmFtZTogJ0RlYnVnIFRvb2xzJywgdG9vbHM6IFtcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldENvbnNvbGVMb2dzJywgZGVzY3JpcHRpb246ICdHZXQgY29uc29sZSBsb2dzJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0UGVyZm9ybWFuY2VTdGF0cycsIGRlc2NyaXB0aW9uOiAnR2V0IHBlcmZvcm1hbmNlIHN0YXRpc3RpY3MnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICd2YWxpZGF0ZVNjZW5lJywgZGVzY3JpcHRpb246ICdWYWxpZGF0ZSBzY2VuZScgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldEVycm9yTG9ncycsIGRlc2NyaXB0aW9uOiAnR2V0IGVycm9yIGxvZ3MnIH1cclxuICAgICAgICAgICAgXX0sXHJcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICdwcmVmZXJlbmNlcycsIG5hbWU6ICdQcmVmZXJlbmNlcyBUb29scycsIHRvb2xzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRQcmVmZXJlbmNlcycsIGRlc2NyaXB0aW9uOiAnR2V0IHByZWZlcmVuY2VzJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnc2V0UHJlZmVyZW5jZXMnLCBkZXNjcmlwdGlvbjogJ1NldCBwcmVmZXJlbmNlcycgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ3Jlc2V0UHJlZmVyZW5jZXMnLCBkZXNjcmlwdGlvbjogJ1Jlc2V0IHByZWZlcmVuY2VzJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnc2VydmVyJywgbmFtZTogJ1NlcnZlciBUb29scycsIHRvb2xzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRTZXJ2ZXJTdGF0dXMnLCBkZXNjcmlwdGlvbjogJ0dldCBzZXJ2ZXIgc3RhdHVzJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0Q29ubmVjdGVkQ2xpZW50cycsIGRlc2NyaXB0aW9uOiAnR2V0IGNvbm5lY3RlZCBjbGllbnRzJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0U2VydmVyTG9ncycsIGRlc2NyaXB0aW9uOiAnR2V0IHNlcnZlciBsb2dzJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnYnJvYWRjYXN0JywgbmFtZTogJ0Jyb2FkY2FzdCBUb29scycsIHRvb2xzOiBbXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdicm9hZGNhc3RNZXNzYWdlJywgZGVzY3JpcHRpb246ICdCcm9hZGNhc3QgbWVzc2FnZScgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dldEJyb2FkY2FzdEhpc3RvcnknLCBkZXNjcmlwdGlvbjogJ0dldCBicm9hZGNhc3QgaGlzdG9yeScgfVxyXG4gICAgICAgICAgICBdfSxcclxuICAgICAgICAgICAgeyBjYXRlZ29yeTogJ3NjZW5lQWR2YW5jZWQnLCBuYW1lOiAnQWR2YW5jZWQgU2NlbmUgVG9vbHMnLCB0b29sczogW1xyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnb3B0aW1pemVTY2VuZScsIGRlc2NyaXB0aW9uOiAnT3B0aW1pemUgc2NlbmUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdhbmFseXplU2NlbmUnLCBkZXNjcmlwdGlvbjogJ0FuYWx5emUgc2NlbmUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdiYXRjaE9wZXJhdGlvbicsIGRlc2NyaXB0aW9uOiAnQmF0Y2ggb3BlcmF0aW9uJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAnc2NlbmVWaWV3JywgbmFtZTogJ1NjZW5lIFZpZXcgVG9vbHMnLCB0b29sczogW1xyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnZ2V0Vmlld3BvcnRJbmZvJywgZGVzY3JpcHRpb246ICdHZXQgdmlld3BvcnQgaW5mb3JtYXRpb24nIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdzZXRWaWV3cG9ydENhbWVyYScsIGRlc2NyaXB0aW9uOiAnU2V0IHZpZXdwb3J0IGNhbWVyYScgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2ZvY3VzT25Ob2RlJywgZGVzY3JpcHRpb246ICdGb2N1cyBvbiBub2RlJyB9XHJcbiAgICAgICAgICAgIF19LFxyXG4gICAgICAgICAgICB7IGNhdGVnb3J5OiAncmVmZXJlbmNlSW1hZ2UnLCBuYW1lOiAnUmVmZXJlbmNlIEltYWdlIFRvb2xzJywgdG9vbHM6IFtcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2FkZFJlZmVyZW5jZUltYWdlJywgZGVzY3JpcHRpb246ICdBZGQgcmVmZXJlbmNlIGltYWdlJyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAncmVtb3ZlUmVmZXJlbmNlSW1hZ2UnLCBkZXNjcmlwdGlvbjogJ1JlbW92ZSByZWZlcmVuY2UgaW1hZ2UnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdnZXRSZWZlcmVuY2VJbWFnZXMnLCBkZXNjcmlwdGlvbjogJ0dldCByZWZlcmVuY2UgaW1hZ2UgbGlzdCcgfVxyXG4gICAgICAgICAgICBdfSxcclxuICAgICAgICAgICAgeyBjYXRlZ29yeTogJ2Fzc2V0QWR2YW5jZWQnLCBuYW1lOiAnQWR2YW5jZWQgQXNzZXQgVG9vbHMnLCB0b29sczogW1xyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAnaW1wb3J0QXNzZXQnLCBkZXNjcmlwdGlvbjogJ0ltcG9ydCBhc3NldCcgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2V4cG9ydEFzc2V0JywgZGVzY3JpcHRpb246ICdFeHBvcnQgYXNzZXQnIH0sXHJcbiAgICAgICAgICAgICAgICB7IG5hbWU6ICdwcm9jZXNzQXNzZXQnLCBkZXNjcmlwdGlvbjogJ1Byb2Nlc3MgYXNzZXQnIH1cclxuICAgICAgICAgICAgXX0sXHJcbiAgICAgICAgICAgIHsgY2F0ZWdvcnk6ICd2YWxpZGF0aW9uJywgbmFtZTogJ1ZhbGlkYXRpb24gVG9vbHMnLCB0b29sczogW1xyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAndmFsaWRhdGVQcm9qZWN0JywgZGVzY3JpcHRpb246ICdWYWxpZGF0ZSBwcm9qZWN0JyB9LFxyXG4gICAgICAgICAgICAgICAgeyBuYW1lOiAndmFsaWRhdGVBc3NldHMnLCBkZXNjcmlwdGlvbjogJ1ZhbGlkYXRlIGFzc2V0cycgfSxcclxuICAgICAgICAgICAgICAgIHsgbmFtZTogJ2dlbmVyYXRlUmVwb3J0JywgZGVzY3JpcHRpb246ICdHZW5lcmF0ZSByZXBvcnQnIH1cclxuICAgICAgICAgICAgXX1cclxuICAgICAgICBdO1xyXG5cclxuICAgICAgICB0aGlzLmF2YWlsYWJsZVRvb2xzID0gW107XHJcbiAgICAgICAgdG9vbENhdGVnb3JpZXMuZm9yRWFjaChjYXRlZ29yeSA9PiB7XHJcbiAgICAgICAgICAgIGNhdGVnb3J5LnRvb2xzLmZvckVhY2godG9vbCA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmF2YWlsYWJsZVRvb2xzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeS5jYXRlZ29yeSxcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiB0b29sLm5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSwgLy8gRW5hYmxlZCBieSBkZWZhdWx0XHJcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IHRvb2wuZGVzY3JpcHRpb25cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFtUb29sTWFuYWdlcl0gSW5pdGlhbGl6ZWQgJHt0aGlzLmF2YWlsYWJsZVRvb2xzLmxlbmd0aH0gZGVmYXVsdCB0b29sc2ApO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRBdmFpbGFibGVUb29scygpOiBUb29sQ29uZmlnW10ge1xyXG4gICAgICAgIHJldHVybiBbLi4udGhpcy5hdmFpbGFibGVUb29sc107XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldENvbmZpZ3VyYXRpb25zKCk6IFRvb2xDb25maWd1cmF0aW9uW10ge1xyXG4gICAgICAgIHJldHVybiBbLi4udGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9uc107XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGdldEN1cnJlbnRDb25maWd1cmF0aW9uKCk6IFRvb2xDb25maWd1cmF0aW9uIHwgbnVsbCB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnNldHRpbmdzLmN1cnJlbnRDb25maWdJZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZChjb25maWcgPT4gY29uZmlnLmlkID09PSB0aGlzLnNldHRpbmdzLmN1cnJlbnRDb25maWdJZCkgfHwgbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgY3JlYXRlQ29uZmlndXJhdGlvbihuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uPzogc3RyaW5nKTogVG9vbENvbmZpZ3VyYXRpb24ge1xyXG4gICAgICAgIGlmICh0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmxlbmd0aCA+PSB0aGlzLnNldHRpbmdzLm1heENvbmZpZ1Nsb3RzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWF4aW11bSBudW1iZXIgb2YgY29uZmlndXJhdGlvbiBzbG90cyByZWFjaGVkICgke3RoaXMuc2V0dGluZ3MubWF4Q29uZmlnU2xvdHN9KWApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgY29uZmlnOiBUb29sQ29uZmlndXJhdGlvbiA9IHtcclxuICAgICAgICAgICAgaWQ6IHV1aWR2NCgpLFxyXG4gICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbixcclxuICAgICAgICAgICAgdG9vbHM6IHRoaXMuYXZhaWxhYmxlVG9vbHMubWFwKHRvb2wgPT4gKHsgLi4udG9vbCB9KSksXHJcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMucHVzaChjb25maWcpO1xyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY3VycmVudENvbmZpZ0lkID0gY29uZmlnLmlkO1xyXG4gICAgICAgIHRoaXMuc2F2ZVNldHRpbmdzKCk7XHJcblxyXG4gICAgICAgIHJldHVybiBjb25maWc7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHVwZGF0ZUNvbmZpZ3VyYXRpb24oY29uZmlnSWQ6IHN0cmluZywgdXBkYXRlczogUGFydGlhbDxUb29sQ29uZmlndXJhdGlvbj4pOiBUb29sQ29uZmlndXJhdGlvbiB7XHJcbiAgICAgICAgY29uc3QgY29uZmlnSW5kZXggPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmRJbmRleChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XHJcbiAgICAgICAgaWYgKGNvbmZpZ0luZGV4ID09PSAtMSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmZpZ3VyYXRpb24gbm90IGZvdW5kJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb25maWcgPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zW2NvbmZpZ0luZGV4XTtcclxuICAgICAgICBjb25zdCB1cGRhdGVkQ29uZmlnOiBUb29sQ29uZmlndXJhdGlvbiA9IHtcclxuICAgICAgICAgICAgLi4uY29uZmlnLFxyXG4gICAgICAgICAgICAuLi51cGRhdGVzLFxyXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnNbY29uZmlnSW5kZXhdID0gdXBkYXRlZENvbmZpZztcclxuICAgICAgICB0aGlzLnNhdmVTZXR0aW5ncygpO1xyXG5cclxuICAgICAgICByZXR1cm4gdXBkYXRlZENvbmZpZztcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgZGVsZXRlQ29uZmlndXJhdGlvbihjb25maWdJZDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICAgICAgY29uc3QgY29uZmlnSW5kZXggPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmRJbmRleChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XHJcbiAgICAgICAgaWYgKGNvbmZpZ0luZGV4ID09PSAtMSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmZpZ3VyYXRpb24gbm90IGZvdW5kJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLnNwbGljZShjb25maWdJbmRleCwgMSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSWYgdGhlIGRlbGV0ZWQgY29uZmlndXJhdGlvbiBpcyB0aGUgY3VycmVudCBvbmUsIGNsZWFyIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24gSURcclxuICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5jdXJyZW50Q29uZmlnSWQgPT09IGNvbmZpZ0lkKSB7XHJcbiAgICAgICAgICAgIHRoaXMuc2V0dGluZ3MuY3VycmVudENvbmZpZ0lkID0gdGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9ucy5sZW5ndGggPiAwIFxyXG4gICAgICAgICAgICAgICAgPyB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zWzBdLmlkIFxyXG4gICAgICAgICAgICAgICAgOiAnJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMuc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIHNldEN1cnJlbnRDb25maWd1cmF0aW9uKGNvbmZpZ0lkOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICBjb25zdCBjb25maWcgPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmQoY29uZmlnID0+IGNvbmZpZy5pZCA9PT0gY29uZmlnSWQpO1xyXG4gICAgICAgIGlmICghY29uZmlnKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29uZmlndXJhdGlvbiBub3QgZm91bmQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY3VycmVudENvbmZpZ0lkID0gY29uZmlnSWQ7XHJcbiAgICAgICAgdGhpcy5zYXZlU2V0dGluZ3MoKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdXBkYXRlVG9vbFN0YXR1cyhjb25maWdJZDogc3RyaW5nLCBjYXRlZ29yeTogc3RyaW5nLCB0b29sTmFtZTogc3RyaW5nLCBlbmFibGVkOiBib29sZWFuKTogdm9pZCB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IFVwZGF0aW5nIHRvb2wgc3RhdHVzIC0gY29uZmlnSWQ6ICR7Y29uZmlnSWR9LCBjYXRlZ29yeTogJHtjYXRlZ29yeX0sIHRvb2xOYW1lOiAke3Rvb2xOYW1lfSwgZW5hYmxlZDogJHtlbmFibGVkfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XHJcbiAgICAgICAgaWYgKCFjb25maWcpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgQmFja2VuZDogQ29uZmlnIG5vdCBmb3VuZCB3aXRoIElEOiAke2NvbmZpZ0lkfWApO1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmZpZ3VyYXRpb24gbm90IGZvdW5kJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgQmFja2VuZDogRm91bmQgY29uZmlnOiAke2NvbmZpZy5uYW1lfWApO1xyXG5cclxuICAgICAgICBjb25zdCB0b29sID0gY29uZmlnLnRvb2xzLmZpbmQodCA9PiB0LmNhdGVnb3J5ID09PSBjYXRlZ29yeSAmJiB0Lm5hbWUgPT09IHRvb2xOYW1lKTtcclxuICAgICAgICBpZiAoIXRvb2wpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgQmFja2VuZDogVG9vbCBub3QgZm91bmQgLSBjYXRlZ29yeTogJHtjYXRlZ29yeX0sIG5hbWU6ICR7dG9vbE5hbWV9YCk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVG9vbCBub3QgZm91bmQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBGb3VuZCB0b29sOiAke3Rvb2wubmFtZX0sIGN1cnJlbnQgZW5hYmxlZDogJHt0b29sLmVuYWJsZWR9LCBuZXcgZW5hYmxlZDogJHtlbmFibGVkfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRvb2wuZW5hYmxlZCA9IGVuYWJsZWQ7XHJcbiAgICAgICAgY29uZmlnLnVwZGF0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhgQmFja2VuZDogVG9vbCB1cGRhdGVkLCBzYXZpbmcgc2V0dGluZ3MuLi5gKTtcclxuICAgICAgICB0aGlzLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBTZXR0aW5ncyBzYXZlZCBzdWNjZXNzZnVsbHlgKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgdXBkYXRlVG9vbFN0YXR1c0JhdGNoKGNvbmZpZ0lkOiBzdHJpbmcsIHVwZGF0ZXM6IHsgY2F0ZWdvcnk6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBlbmFibGVkOiBib29sZWFuIH1bXSk6IHZvaWQge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiB1cGRhdGVUb29sU3RhdHVzQmF0Y2ggY2FsbGVkIHdpdGggY29uZmlnSWQ6ICR7Y29uZmlnSWR9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IEN1cnJlbnQgY29uZmlndXJhdGlvbnMgY291bnQ6ICR7dGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9ucy5sZW5ndGh9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYEJhY2tlbmQ6IEN1cnJlbnQgY29uZmlnIElEczpgLCB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLm1hcChjID0+IGMuaWQpKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBjb25maWcgPSB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmZpbmQoY29uZmlnID0+IGNvbmZpZy5pZCA9PT0gY29uZmlnSWQpO1xyXG4gICAgICAgIGlmICghY29uZmlnKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEJhY2tlbmQ6IENvbmZpZyBub3QgZm91bmQgd2l0aCBJRDogJHtjb25maWdJZH1gKTtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgQmFja2VuZDogQXZhaWxhYmxlIGNvbmZpZyBJRHM6YCwgdGhpcy5zZXR0aW5ncy5jb25maWd1cmF0aW9ucy5tYXAoYyA9PiBjLmlkKSk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29uZmlndXJhdGlvbiBub3QgZm91bmQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBGb3VuZCBjb25maWc6ICR7Y29uZmlnLm5hbWV9LCB1cGRhdGluZyAke3VwZGF0ZXMubGVuZ3RofSB0b29sc2ApO1xyXG5cclxuICAgICAgICB1cGRhdGVzLmZvckVhY2godXBkYXRlID0+IHtcclxuICAgICAgICAgICAgY29uc3QgdG9vbCA9IGNvbmZpZy50b29scy5maW5kKHQgPT4gdC5jYXRlZ29yeSA9PT0gdXBkYXRlLmNhdGVnb3J5ICYmIHQubmFtZSA9PT0gdXBkYXRlLm5hbWUpO1xyXG4gICAgICAgICAgICBpZiAodG9vbCkge1xyXG4gICAgICAgICAgICAgICAgdG9vbC5lbmFibGVkID0gdXBkYXRlLmVuYWJsZWQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uZmlnLnVwZGF0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgICAgICB0aGlzLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBCYXRjaCB1cGRhdGUgY29tcGxldGVkIHN1Y2Nlc3NmdWxseWApO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBleHBvcnRDb25maWd1cmF0aW9uKGNvbmZpZ0lkOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMuZmluZChjb25maWcgPT4gY29uZmlnLmlkID09PSBjb25maWdJZCk7XHJcbiAgICAgICAgaWYgKCFjb25maWcpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb25maWd1cmF0aW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhwb3J0VG9vbENvbmZpZ3VyYXRpb24oY29uZmlnKTtcclxuICAgIH1cclxuXHJcbiAgICBwdWJsaWMgaW1wb3J0Q29uZmlndXJhdGlvbihjb25maWdKc29uOiBzdHJpbmcpOiBUb29sQ29uZmlndXJhdGlvbiB7XHJcbiAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5pbXBvcnRUb29sQ29uZmlndXJhdGlvbihjb25maWdKc29uKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZW5lcmF0ZSBhIG5ldyBJRCBhbmQgdGltZXN0YW1wc1xyXG4gICAgICAgIGNvbmZpZy5pZCA9IHV1aWR2NCgpO1xyXG4gICAgICAgIGNvbmZpZy5jcmVhdGVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICAgICAgY29uZmlnLnVwZGF0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuY29uZmlndXJhdGlvbnMubGVuZ3RoID49IHRoaXMuc2V0dGluZ3MubWF4Q29uZmlnU2xvdHMpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNYXhpbXVtIG51bWJlciBvZiBjb25maWd1cmF0aW9uIHNsb3RzIHJlYWNoZWQgKCR7dGhpcy5zZXR0aW5ncy5tYXhDb25maWdTbG90c30pYCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLnB1c2goY29uZmlnKTtcclxuICAgICAgICB0aGlzLnNhdmVTZXR0aW5ncygpO1xyXG5cclxuICAgICAgICByZXR1cm4gY29uZmlnO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRFbmFibGVkVG9vbHMoKTogVG9vbENvbmZpZ1tdIHtcclxuICAgICAgICBjb25zdCBjdXJyZW50Q29uZmlnID0gdGhpcy5nZXRDdXJyZW50Q29uZmlndXJhdGlvbigpO1xyXG4gICAgICAgIGlmICghY3VycmVudENvbmZpZykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hdmFpbGFibGVUb29scy5maWx0ZXIodG9vbCA9PiB0b29sLmVuYWJsZWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY3VycmVudENvbmZpZy50b29scy5maWx0ZXIodG9vbCA9PiB0b29sLmVuYWJsZWQpO1xyXG4gICAgfVxyXG5cclxuICAgIHB1YmxpYyBnZXRUb29sTWFuYWdlclN0YXRlKCkge1xyXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDb25maWcgPSB0aGlzLmdldEN1cnJlbnRDb25maWd1cmF0aW9uKCk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgYXZhaWxhYmxlVG9vbHM6IGN1cnJlbnRDb25maWcgPyBjdXJyZW50Q29uZmlnLnRvb2xzIDogdGhpcy5nZXRBdmFpbGFibGVUb29scygpLFxyXG4gICAgICAgICAgICBzZWxlY3RlZENvbmZpZ0lkOiB0aGlzLnNldHRpbmdzLmN1cnJlbnRDb25maWdJZCxcclxuICAgICAgICAgICAgY29uZmlndXJhdGlvbnM6IHRoaXMuZ2V0Q29uZmlndXJhdGlvbnMoKSxcclxuICAgICAgICAgICAgbWF4Q29uZmlnU2xvdHM6IHRoaXMuc2V0dGluZ3MubWF4Q29uZmlnU2xvdHNcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgc2F2ZVNldHRpbmdzKCk6IHZvaWQge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBTYXZpbmcgc2V0dGluZ3MsIGN1cnJlbnQgY29uZmlncyBjb3VudDogJHt0aGlzLnNldHRpbmdzLmNvbmZpZ3VyYXRpb25zLmxlbmd0aH1gKTtcclxuICAgICAgICB0aGlzLnNhdmVUb29sTWFuYWdlclNldHRpbmdzKHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBCYWNrZW5kOiBTZXR0aW5ncyBzYXZlZCB0byBmaWxlYCk7XHJcbiAgICB9XHJcbn1cclxuIl19