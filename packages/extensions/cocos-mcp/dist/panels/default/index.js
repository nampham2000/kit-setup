"use strict";
/* eslint-disable vue/one-component-per-file */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const vue_1 = require("vue");
const panelDataMap = new WeakMap();
module.exports = Editor.Panel.define({
    listeners: {
        show() {
            console.log('[MCP Panel] Panel shown');
        },
        hide() {
            console.log('[MCP Panel] Panel hidden');
        },
    },
    template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
        panelTitle: '#panelTitle',
    },
    ready() {
        if (this.$.app) {
            const app = (0, vue_1.createApp)({});
            app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
            // Create the main app component
            app.component('McpServerApp', (0, vue_1.defineComponent)({
                setup() {
                    // Reactive state
                    const activeTab = (0, vue_1.ref)('server');
                    const serverRunning = (0, vue_1.ref)(false);
                    const serverStatus = (0, vue_1.ref)('Stopped');
                    const connectedClients = (0, vue_1.ref)(0);
                    const httpUrl = (0, vue_1.ref)('');
                    const isProcessing = (0, vue_1.ref)(false);
                    const settings = (0, vue_1.ref)({
                        port: 3000,
                        autoStart: false,
                        debugLog: false,
                        maxConnections: 10
                    });
                    const availableTools = (0, vue_1.ref)([]);
                    const toolCategories = (0, vue_1.ref)([]);
                    // Computed properties
                    const statusClass = (0, vue_1.computed)(() => ({
                        'status-running': serverRunning.value,
                        'status-stopped': !serverRunning.value
                    }));
                    const totalTools = (0, vue_1.computed)(() => availableTools.value.length);
                    const enabledTools = (0, vue_1.computed)(() => availableTools.value.filter(t => t.enabled).length);
                    const disabledTools = (0, vue_1.computed)(() => totalTools.value - enabledTools.value);
                    const settingsChanged = (0, vue_1.ref)(false);
                    // Methods
                    const buildServerSettings = () => ({
                        port: settings.value.port,
                        autoStart: settings.value.autoStart,
                        enableDebugLog: settings.value.debugLog,
                        maxConnections: settings.value.maxConnections
                    });
                    const updateBooleanSetting = (key) => {
                        settings.value[key] = !settings.value[key];
                        settingsChanged.value = true;
                    };
                    const updateNumberSetting = (key, event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) {
                            settings.value[key] = value;
                            settingsChanged.value = true;
                        }
                    };
                    const switchTab = (tabName) => {
                        activeTab.value = tabName;
                        if (tabName === 'tools') {
                            loadToolManagerState();
                        }
                    };
                    const toggleServer = async () => {
                        try {
                            if (serverRunning.value) {
                                await Editor.Message.request('cocos-mcp-server', 'stop-server');
                            }
                            else {
                                // Use the current panel settings when starting the server
                                await Editor.Message.request('cocos-mcp-server', 'update-settings', buildServerSettings());
                                await Editor.Message.request('cocos-mcp-server', 'start-server');
                            }
                            console.log('[Vue App] Server toggled');
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to toggle server:', error);
                        }
                    };
                    const saveSettings = async () => {
                        try {
                            const result = await Editor.Message.request('cocos-mcp-server', 'update-settings', buildServerSettings());
                            console.log('[Vue App] Save settings result:', result);
                            settingsChanged.value = false;
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to save settings:', error);
                        }
                    };
                    const copyUrl = async () => {
                        try {
                            await navigator.clipboard.writeText(httpUrl.value);
                            console.log('[Vue App] URL copied to clipboard');
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to copy URL:', error);
                        }
                    };
                    const loadToolManagerState = async () => {
                        try {
                            const result = await Editor.Message.request('cocos-mcp-server', 'getToolManagerState');
                            if (result && result.success) {
                                // Always load backend state so the data stays current
                                availableTools.value = result.availableTools || [];
                                console.log('[Vue App] Loaded tools:', availableTools.value.length);
                                // Update tool categories
                                const categories = new Set(availableTools.value.map(tool => tool.category));
                                toolCategories.value = Array.from(categories);
                            }
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to load tool manager state:', error);
                        }
                    };
                    const updateToolStatus = async (category, name, enabled) => {
                        try {
                            console.log('[Vue App] updateToolStatus called:', category, name, enabled);
                            // Update local state first
                            const toolIndex = availableTools.value.findIndex(t => t.category === category && t.name === name);
                            if (toolIndex !== -1) {
                                availableTools.value[toolIndex].enabled = enabled;
                                // Force a reactive update
                                availableTools.value = [...availableTools.value];
                                console.log('[Vue App] Local state updated, tool enabled:', availableTools.value[toolIndex].enabled);
                            }
                            // Sync the change to the backend
                            const result = await Editor.Message.request('cocos-mcp-server', 'updateToolStatus', category, name, enabled);
                            if (!result || !result.success) {
                                // Roll back local state if the backend update fails
                                if (toolIndex !== -1) {
                                    availableTools.value[toolIndex].enabled = !enabled;
                                    availableTools.value = [...availableTools.value];
                                }
                                console.error('[Vue App] Backend update failed, rolled back local state');
                            }
                            else {
                                console.log('[Vue App] Backend update successful');
                            }
                        }
                        catch (error) {
                            // Roll back local state if an error occurs
                            const toolIndex = availableTools.value.findIndex(t => t.category === category && t.name === name);
                            if (toolIndex !== -1) {
                                availableTools.value[toolIndex].enabled = !enabled;
                                availableTools.value = [...availableTools.value];
                            }
                            console.error('[Vue App] Failed to update tool status:', error);
                        }
                    };
                    const selectAllTools = async () => {
                        try {
                            // Update local state directly, then save
                            availableTools.value.forEach(tool => tool.enabled = true);
                            await saveChanges();
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to select all tools:', error);
                        }
                    };
                    const deselectAllTools = async () => {
                        try {
                            // Update local state directly, then save
                            availableTools.value.forEach(tool => tool.enabled = false);
                            await saveChanges();
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to deselect all tools:', error);
                        }
                    };
                    const saveChanges = async () => {
                        try {
                            // Create plain objects to avoid Vue 3 reactive clone errors
                            const updates = availableTools.value.map(tool => ({
                                category: String(tool.category),
                                name: String(tool.name),
                                enabled: Boolean(tool.enabled)
                            }));
                            console.log('[Vue App] Sending updates:', updates.length, 'tools');
                            const result = await Editor.Message.request('cocos-mcp-server', 'updateToolStatusBatch', updates);
                            if (result && result.success) {
                                console.log('[Vue App] Tool changes saved successfully');
                            }
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to save tool changes:', error);
                        }
                    };
                    const toggleCategoryTools = async (category, enabled) => {
                        try {
                            // Update local state directly, then save
                            availableTools.value.forEach(tool => {
                                if (tool.category === category) {
                                    tool.enabled = enabled;
                                }
                            });
                            await saveChanges();
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to toggle category tools:', error);
                        }
                    };
                    const getToolsByCategory = (category) => {
                        return availableTools.value.filter(tool => tool.category === category);
                    };
                    const getCategoryDisplayName = (category) => {
                        const categoryNames = {
                            'scene': 'Scene Tools',
                            'node': 'Node Tools',
                            'component': 'Component Tools',
                            'prefab': 'Prefab Tools',
                            'project': 'Project Tools',
                            'debug': 'Debug Tools',
                            'preferences': 'Preferences Tools',
                            'server': 'Server Tools',
                            'broadcast': 'Broadcast Tools',
                            'sceneAdvanced': 'Advanced Scene Tools',
                            'sceneView': 'Scene View Tools',
                            'referenceImage': 'Reference Image Tools',
                            'assetAdvanced': 'Advanced Asset Tools',
                            'validation': 'Validation Tools'
                        };
                        return categoryNames[category] || category;
                    };
                    // Load data when the component mounts
                    (0, vue_1.onMounted)(async () => {
                        var _a, _b, _c, _d, _e;
                        // Load tool manager state
                        await loadToolManagerState();
                        // Load settings from the server status
                        try {
                            const initialStatus = await Editor.Message.request('cocos-mcp-server', 'get-server-status');
                            if (initialStatus && initialStatus.settings) {
                                settings.value = {
                                    port: (_a = initialStatus.settings.port) !== null && _a !== void 0 ? _a : 3000,
                                    autoStart: (_b = initialStatus.settings.autoStart) !== null && _b !== void 0 ? _b : false,
                                    debugLog: (_d = (_c = initialStatus.settings.enableDebugLog) !== null && _c !== void 0 ? _c : initialStatus.settings.debugLog) !== null && _d !== void 0 ? _d : false,
                                    maxConnections: (_e = initialStatus.settings.maxConnections) !== null && _e !== void 0 ? _e : 10
                                };
                                console.log('[Vue App] Server settings loaded from status:', initialStatus.settings);
                            }
                            else if (initialStatus && initialStatus.port) {
                                // Backward compatibility: only read the port from older versions
                                settings.value.port = initialStatus.port;
                                console.log('[Vue App] Port loaded from server status:', initialStatus.port);
                            }
                        }
                        catch (error) {
                            console.error('[Vue App] Failed to get server status:', error);
                            console.log('[Vue App] Using default server settings');
                        }
                        // Refresh server status periodically
                        setInterval(async () => {
                            try {
                                const result = await Editor.Message.request('cocos-mcp-server', 'get-server-status');
                                if (result) {
                                    serverRunning.value = result.running;
                                    serverStatus.value = result.running ? 'Running' : 'Stopped';
                                    connectedClients.value = result.clients || 0;
                                    httpUrl.value = result.running ? `http://localhost:${result.port}/mcp` : '';
                                    isProcessing.value = false;
                                }
                            }
                            catch (error) {
                                console.error('[Vue App] Failed to get server status:', error);
                            }
                        }, 2000);
                    });
                    return {
                        // State
                        activeTab,
                        serverRunning,
                        serverStatus,
                        connectedClients,
                        httpUrl,
                        isProcessing,
                        settings,
                        availableTools,
                        toolCategories,
                        settingsChanged,
                        // Computed properties
                        statusClass,
                        totalTools,
                        enabledTools,
                        disabledTools,
                        // Methods
                        switchTab,
                        updateBooleanSetting,
                        updateNumberSetting,
                        toggleServer,
                        saveSettings,
                        copyUrl,
                        loadToolManagerState,
                        updateToolStatus,
                        selectAllTools,
                        deselectAllTools,
                        saveChanges,
                        toggleCategoryTools,
                        getToolsByCategory,
                        getCategoryDisplayName
                    };
                },
                template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/vue/mcp-server-app.html'), 'utf-8'),
            }));
            app.mount(this.$.app);
            panelDataMap.set(this, app);
            console.log('[MCP Panel] Vue3 app mounted successfully');
        }
    },
    beforeClose() { },
    close() {
        const app = panelDataMap.get(this);
        if (app) {
            app.unmount();
        }
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLCtDQUErQzs7QUFFL0MsdUNBQXdDO0FBQ3hDLCtCQUE0QjtBQUM1Qiw2QkFBZ0Y7QUFFaEYsTUFBTSxZQUFZLEdBQUcsSUFBSSxPQUFPLEVBQVksQ0FBQztBQTRCN0MsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztJQUNqQyxTQUFTLEVBQUU7UUFDUCxJQUFJO1lBQ0EsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFDRCxJQUFJO1lBQ0EsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO1FBQzVDLENBQUM7S0FDSjtJQUNELFFBQVEsRUFBRSxJQUFBLHVCQUFZLEVBQUMsSUFBQSxXQUFJLEVBQUMsU0FBUyxFQUFFLDZDQUE2QyxDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQy9GLEtBQUssRUFBRSxJQUFBLHVCQUFZLEVBQUMsSUFBQSxXQUFJLEVBQUMsU0FBUyxFQUFFLHlDQUF5QyxDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQ3hGLENBQUMsRUFBRTtRQUNDLEdBQUcsRUFBRSxNQUFNO1FBQ1gsVUFBVSxFQUFFLGFBQWE7S0FDNUI7SUFDRCxLQUFLO1FBQ0QsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ2IsTUFBTSxHQUFHLEdBQUcsSUFBQSxlQUFTLEVBQUMsRUFBRSxDQUFDLENBQUM7WUFDMUIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsZUFBZSxHQUFHLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTVFLGdDQUFnQztZQUNoQyxHQUFHLENBQUMsU0FBUyxDQUFD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LENBQUM7WUFFSixHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEIsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFFNUIsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO1FBQzdELENBQUM7SUFDTCxDQUFDO0lBQ0QsV0FBVyxLQUFLLENBQUM7SUFDakIsS0FBSztRQUNELE1BQU0sR0FBRyxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbkMsSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUNOLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNsQixDQUFDO0lBQ0wsQ0FBQztDQUNKLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGVzbGludC1kaXNhYmxlIHZ1ZS9vbmUtY29tcG9uZW50LXBlci1maWxlICovXG5cbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcbmltcG9ydCB7IGNyZWF0ZUFwcCwgQXBwLCBkZWZpbmVDb21wb25lbnQsIHJlZiwgY29tcHV0ZWQsIG9uTW91bnRlZCB9IGZyb20gJ3Z1ZSc7XG5cbmNvbnN0IHBhbmVsRGF0YU1hcCA9IG5ldyBXZWFrTWFwPGFueSwgQXBwPigpO1xuXG4vLyBEZWZpbmUgdG9vbCBjb25maWd1cmF0aW9uIGludGVyZmFjZVxuaW50ZXJmYWNlIFRvb2xDb25maWcge1xuICAgIGNhdGVnb3J5OiBzdHJpbmc7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbn1cblxuLy8gRGVmaW5lIGNvbmZpZ3VyYXRpb24gaW50ZXJmYWNlXG5pbnRlcmZhY2UgQ29uZmlndXJhdGlvbiB7XG4gICAgaWQ6IHN0cmluZztcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICB0b29sczogVG9vbENvbmZpZ1tdO1xuICAgIGNyZWF0ZWRBdDogc3RyaW5nO1xuICAgIHVwZGF0ZWRBdDogc3RyaW5nO1xufVxuXG4vLyBEZWZpbmUgc2VydmVyIHNldHRpbmdzIGludGVyZmFjZVxuaW50ZXJmYWNlIFNlcnZlclNldHRpbmdzIHtcbiAgICBwb3J0OiBudW1iZXI7XG4gICAgYXV0b1N0YXJ0OiBib29sZWFuO1xuICAgIGRlYnVnTG9nOiBib29sZWFuO1xuICAgIG1heENvbm5lY3Rpb25zOiBudW1iZXI7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gRWRpdG9yLlBhbmVsLmRlZmluZSh7XG4gICAgbGlzdGVuZXJzOiB7XG4gICAgICAgIHNob3coKSB7IFxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNQ1AgUGFuZWxdIFBhbmVsIHNob3duJyk7IFxuICAgICAgICB9LFxuICAgICAgICBoaWRlKCkgeyBcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbTUNQIFBhbmVsXSBQYW5lbCBoaWRkZW4nKTsgXG4gICAgICAgIH0sXG4gICAgfSxcbiAgICB0ZW1wbGF0ZTogcmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vc3RhdGljL3RlbXBsYXRlL2RlZmF1bHQvaW5kZXguaHRtbCcpLCAndXRmLTgnKSxcbiAgICBzdHlsZTogcmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vc3RhdGljL3N0eWxlL2RlZmF1bHQvaW5kZXguY3NzJyksICd1dGYtOCcpLFxuICAgICQ6IHtcbiAgICAgICAgYXBwOiAnI2FwcCcsXG4gICAgICAgIHBhbmVsVGl0bGU6ICcjcGFuZWxUaXRsZScsXG4gICAgfSxcbiAgICByZWFkeSgpIHtcbiAgICAgICAgaWYgKHRoaXMuJC5hcHApIHtcbiAgICAgICAgICAgIGNvbnN0IGFwcCA9IGNyZWF0ZUFwcCh7fSk7XG4gICAgICAgICAgICBhcHAuY29uZmlnLmNvbXBpbGVyT3B0aW9ucy5pc0N1c3RvbUVsZW1lbnQgPSAodGFnKSA9PiB0YWcuc3RhcnRzV2l0aCgndWktJyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSB0aGUgbWFpbiBhcHAgY29tcG9uZW50XG4gICAgICAgICAgICBhcHAuY29tcG9uZW50KCdNY3BTZXJ2ZXJBcHAnLCBkZWZpbmVDb21wb25lbnQoe1xuICAgICAgICAgICAgICAgIHNldHVwKCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBSZWFjdGl2ZSBzdGF0ZVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmVUYWIgPSByZWYoJ3NlcnZlcicpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZXJ2ZXJSdW5uaW5nID0gcmVmKGZhbHNlKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VydmVyU3RhdHVzID0gcmVmKCdTdG9wcGVkJyk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbm5lY3RlZENsaWVudHMgPSByZWYoMCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGh0dHBVcmwgPSByZWYoJycpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpc1Byb2Nlc3NpbmcgPSByZWYoZmFsc2UpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSByZWY8U2VydmVyU2V0dGluZ3M+KHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvcnQ6IDMwMDAsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdXRvU3RhcnQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGVidWdMb2c6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4Q29ubmVjdGlvbnM6IDEwXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlVG9vbHMgPSByZWY8VG9vbENvbmZpZ1tdPihbXSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xDYXRlZ29yaWVzID0gcmVmPHN0cmluZ1tdPihbXSk7XG4gICAgICAgICAgICAgICAgICAgIFxuXG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDb21wdXRlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXR1c0NsYXNzID0gY29tcHV0ZWQoKCkgPT4gKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGF0dXMtcnVubmluZyc6IHNlcnZlclJ1bm5pbmcudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhdHVzLXN0b3BwZWQnOiAhc2VydmVyUnVubmluZy52YWx1ZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0b3RhbFRvb2xzID0gY29tcHV0ZWQoKCkgPT4gYXZhaWxhYmxlVG9vbHMudmFsdWUubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5hYmxlZFRvb2xzID0gY29tcHV0ZWQoKCkgPT4gYXZhaWxhYmxlVG9vbHMudmFsdWUuZmlsdGVyKHQgPT4gdC5lbmFibGVkKS5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXNhYmxlZFRvb2xzID0gY29tcHV0ZWQoKCkgPT4gdG90YWxUb29scy52YWx1ZSAtIGVuYWJsZWRUb29scy52YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIFxuXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZXR0aW5nc0NoYW5nZWQgPSByZWYoZmFsc2UpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBNZXRob2RzXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJ1aWxkU2VydmVyU2V0dGluZ3MgPSAoKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcG9ydDogc2V0dGluZ3MudmFsdWUucG9ydCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9TdGFydDogc2V0dGluZ3MudmFsdWUuYXV0b1N0YXJ0LFxuICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlRGVidWdMb2c6IHNldHRpbmdzLnZhbHVlLmRlYnVnTG9nLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4Q29ubmVjdGlvbnM6IHNldHRpbmdzLnZhbHVlLm1heENvbm5lY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZUJvb2xlYW5TZXR0aW5nID0gKGtleTogJ2F1dG9TdGFydCcgfCAnZGVidWdMb2cnKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXR0aW5ncy52YWx1ZVtrZXldID0gIXNldHRpbmdzLnZhbHVlW2tleV07XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXR0aW5nc0NoYW5nZWQudmFsdWUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZU51bWJlclNldHRpbmcgPSAoa2V5OiAncG9ydCcgfCAnbWF4Q29ubmVjdGlvbnMnLCBldmVudDogRXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gTnVtYmVyKChldmVudC50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXR0aW5ncy52YWx1ZVtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3NDaGFuZ2VkLnZhbHVlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzd2l0Y2hUYWIgPSAodGFiTmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUYWIudmFsdWUgPSB0YWJOYW1lO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhYk5hbWUgPT09ICd0b29scycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2FkVG9vbE1hbmFnZXJTdGF0ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9nZ2xlU2VydmVyID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2VydmVyUnVubmluZy52YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdjb2Nvcy1tY3Atc2VydmVyJywgJ3N0b3Atc2VydmVyJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBjdXJyZW50IHBhbmVsIHNldHRpbmdzIHdoZW4gc3RhcnRpbmcgdGhlIHNlcnZlclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdjb2Nvcy1tY3Atc2VydmVyJywgJ3VwZGF0ZS1zZXR0aW5ncycsIGJ1aWxkU2VydmVyU2V0dGluZ3MoKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAnc3RhcnQtc2VydmVyJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gU2VydmVyIHRvZ2dsZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byB0b2dnbGUgc2VydmVyOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNhdmVTZXR0aW5ncyA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICd1cGRhdGUtc2V0dGluZ3MnLCBidWlsZFNlcnZlclNldHRpbmdzKCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gU2F2ZSBzZXR0aW5ncyByZXN1bHQ6JywgcmVzdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXR0aW5nc0NoYW5nZWQudmFsdWUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byBzYXZlIHNldHRpbmdzOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvcHlVcmwgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KGh0dHBVcmwudmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gVVJMIGNvcGllZCB0byBjbGlwYm9hcmQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byBjb3B5IFVSTDonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBsb2FkVG9vbE1hbmFnZXJTdGF0ZSA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICdnZXRUb29sTWFuYWdlclN0YXRlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBBbHdheXMgbG9hZCBiYWNrZW5kIHN0YXRlIHNvIHRoZSBkYXRhIHN0YXlzIGN1cnJlbnRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXZhaWxhYmxlVG9vbHMudmFsdWUgPSByZXN1bHQuYXZhaWxhYmxlVG9vbHMgfHwgW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gTG9hZGVkIHRvb2xzOicsIGF2YWlsYWJsZVRvb2xzLnZhbHVlLmxlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVcGRhdGUgdG9vbCBjYXRlZ29yaWVzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3JpZXMgPSBuZXcgU2V0KGF2YWlsYWJsZVRvb2xzLnZhbHVlLm1hcCh0b29sID0+IHRvb2wuY2F0ZWdvcnkpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbENhdGVnb3JpZXMudmFsdWUgPSBBcnJheS5mcm9tKGNhdGVnb3JpZXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byBsb2FkIHRvb2wgbWFuYWdlciBzdGF0ZTonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCB1cGRhdGVUb29sU3RhdHVzID0gYXN5bmMgKGNhdGVnb3J5OiBzdHJpbmcsIG5hbWU6IHN0cmluZywgZW5hYmxlZDogYm9vbGVhbikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1Z1ZSBBcHBdIHVwZGF0ZVRvb2xTdGF0dXMgY2FsbGVkOicsIGNhdGVnb3J5LCBuYW1lLCBlbmFibGVkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVcGRhdGUgbG9jYWwgc3RhdGUgZmlyc3RcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b29sSW5kZXggPSBhdmFpbGFibGVUb29scy52YWx1ZS5maW5kSW5kZXgodCA9PiB0LmNhdGVnb3J5ID09PSBjYXRlZ29yeSAmJiB0Lm5hbWUgPT09IG5hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0b29sSW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVRvb2xzLnZhbHVlW3Rvb2xJbmRleF0uZW5hYmxlZCA9IGVuYWJsZWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvcmNlIGEgcmVhY3RpdmUgdXBkYXRlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVRvb2xzLnZhbHVlID0gWy4uLmF2YWlsYWJsZVRvb2xzLnZhbHVlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tWdWUgQXBwXSBMb2NhbCBzdGF0ZSB1cGRhdGVkLCB0b29sIGVuYWJsZWQ6JywgYXZhaWxhYmxlVG9vbHMudmFsdWVbdG9vbEluZGV4XS5lbmFibGVkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gU3luYyB0aGUgY2hhbmdlIHRvIHRoZSBiYWNrZW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICd1cGRhdGVUb29sU3RhdHVzJywgY2F0ZWdvcnksIG5hbWUsIGVuYWJsZWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0IHx8ICFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBSb2xsIGJhY2sgbG9jYWwgc3RhdGUgaWYgdGhlIGJhY2tlbmQgdXBkYXRlIGZhaWxzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0b29sSW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdmFpbGFibGVUb29scy52YWx1ZVt0b29sSW5kZXhdLmVuYWJsZWQgPSAhZW5hYmxlZDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVRvb2xzLnZhbHVlID0gWy4uLmF2YWlsYWJsZVRvb2xzLnZhbHVlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVnVlIEFwcF0gQmFja2VuZCB1cGRhdGUgZmFpbGVkLCByb2xsZWQgYmFjayBsb2NhbCBzdGF0ZScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gQmFja2VuZCB1cGRhdGUgc3VjY2Vzc2Z1bCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUm9sbCBiYWNrIGxvY2FsIHN0YXRlIGlmIGFuIGVycm9yIG9jY3Vyc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xJbmRleCA9IGF2YWlsYWJsZVRvb2xzLnZhbHVlLmZpbmRJbmRleCh0ID0+IHQuY2F0ZWdvcnkgPT09IGNhdGVnb3J5ICYmIHQubmFtZSA9PT0gbmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRvb2xJbmRleCAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXZhaWxhYmxlVG9vbHMudmFsdWVbdG9vbEluZGV4XS5lbmFibGVkID0gIWVuYWJsZWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVRvb2xzLnZhbHVlID0gWy4uLmF2YWlsYWJsZVRvb2xzLnZhbHVlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byB1cGRhdGUgdG9vbCBzdGF0dXM6JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VsZWN0QWxsVG9vbHMgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBsb2NhbCBzdGF0ZSBkaXJlY3RseSwgdGhlbiBzYXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXZhaWxhYmxlVG9vbHMudmFsdWUuZm9yRWFjaCh0b29sID0+IHRvb2wuZW5hYmxlZCA9IHRydWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHNhdmVDaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tWdWUgQXBwXSBGYWlsZWQgdG8gc2VsZWN0IGFsbCB0b29sczonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZXNlbGVjdEFsbFRvb2xzID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVcGRhdGUgbG9jYWwgc3RhdGUgZGlyZWN0bHksIHRoZW4gc2F2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVRvb2xzLnZhbHVlLmZvckVhY2godG9vbCA9PiB0b29sLmVuYWJsZWQgPSBmYWxzZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgc2F2ZUNoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byBkZXNlbGVjdCBhbGwgdG9vbHM6JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzYXZlQ2hhbmdlcyA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHBsYWluIG9iamVjdHMgdG8gYXZvaWQgVnVlIDMgcmVhY3RpdmUgY2xvbmUgZXJyb3JzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlcyA9IGF2YWlsYWJsZVRvb2xzLnZhbHVlLm1hcCh0b29sID0+ICh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhdGVnb3J5OiBTdHJpbmcodG9vbC5jYXRlZ29yeSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IFN0cmluZyh0b29sLm5hbWUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiBCb29sZWFuKHRvb2wuZW5hYmxlZClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tWdWUgQXBwXSBTZW5kaW5nIHVwZGF0ZXM6JywgdXBkYXRlcy5sZW5ndGgsICd0b29scycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAndXBkYXRlVG9vbFN0YXR1c0JhdGNoJywgdXBkYXRlcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1Z1ZSBBcHBdIFRvb2wgY2hhbmdlcyBzYXZlZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tWdWUgQXBwXSBGYWlsZWQgdG8gc2F2ZSB0b29sIGNoYW5nZXM6JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBcblxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9nZ2xlQ2F0ZWdvcnlUb29scyA9IGFzeW5jIChjYXRlZ29yeTogc3RyaW5nLCBlbmFibGVkOiBib29sZWFuKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBsb2NhbCBzdGF0ZSBkaXJlY3RseSwgdGhlbiBzYXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXZhaWxhYmxlVG9vbHMudmFsdWUuZm9yRWFjaCh0b29sID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRvb2wuY2F0ZWdvcnkgPT09IGNhdGVnb3J5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSBlbmFibGVkO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgc2F2ZUNoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1Z1ZSBBcHBdIEZhaWxlZCB0byB0b2dnbGUgY2F0ZWdvcnkgdG9vbHM6JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZ2V0VG9vbHNCeUNhdGVnb3J5ID0gKGNhdGVnb3J5OiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhdmFpbGFibGVUb29scy52YWx1ZS5maWx0ZXIodG9vbCA9PiB0b29sLmNhdGVnb3J5ID09PSBjYXRlZ29yeSk7XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBnZXRDYXRlZ29yeURpc3BsYXlOYW1lID0gKGNhdGVnb3J5OiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnlOYW1lczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc2NlbmUnOiAnU2NlbmUgVG9vbHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdub2RlJzogJ05vZGUgVG9vbHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb21wb25lbnQnOiAnQ29tcG9uZW50IFRvb2xzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAncHJlZmFiJzogJ1ByZWZhYiBUb29scycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3Byb2plY3QnOiAnUHJvamVjdCBUb29scycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2RlYnVnJzogJ0RlYnVnIFRvb2xzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAncHJlZmVyZW5jZXMnOiAnUHJlZmVyZW5jZXMgVG9vbHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzZXJ2ZXInOiAnU2VydmVyIFRvb2xzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYnJvYWRjYXN0JzogJ0Jyb2FkY2FzdCBUb29scycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NjZW5lQWR2YW5jZWQnOiAnQWR2YW5jZWQgU2NlbmUgVG9vbHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzY2VuZVZpZXcnOiAnU2NlbmUgVmlldyBUb29scycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3JlZmVyZW5jZUltYWdlJzogJ1JlZmVyZW5jZSBJbWFnZSBUb29scycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fzc2V0QWR2YW5jZWQnOiAnQWR2YW5jZWQgQXNzZXQgVG9vbHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICd2YWxpZGF0aW9uJzogJ1ZhbGlkYXRpb24gVG9vbHMnXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNhdGVnb3J5TmFtZXNbY2F0ZWdvcnldIHx8IGNhdGVnb3J5O1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBcblxuICAgICAgICAgICAgICAgICAgICBcblxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gTG9hZCBkYXRhIHdoZW4gdGhlIGNvbXBvbmVudCBtb3VudHNcbiAgICAgICAgICAgICAgICAgICAgb25Nb3VudGVkKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIExvYWQgdG9vbCBtYW5hZ2VyIHN0YXRlXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2FkVG9vbE1hbmFnZXJTdGF0ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBMb2FkIHNldHRpbmdzIGZyb20gdGhlIHNlcnZlciBzdGF0dXNcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5pdGlhbFN0YXR1cyA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAnZ2V0LXNlcnZlci1zdGF0dXMnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5pdGlhbFN0YXR1cyAmJiBpbml0aWFsU3RhdHVzLnNldHRpbmdzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldHRpbmdzLnZhbHVlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9ydDogaW5pdGlhbFN0YXR1cy5zZXR0aW5ncy5wb3J0ID8/IDMwMDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdXRvU3RhcnQ6IGluaXRpYWxTdGF0dXMuc2V0dGluZ3MuYXV0b1N0YXJ0ID8/IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVidWdMb2c6IGluaXRpYWxTdGF0dXMuc2V0dGluZ3MuZW5hYmxlRGVidWdMb2cgPz8gaW5pdGlhbFN0YXR1cy5zZXR0aW5ncy5kZWJ1Z0xvZyA/PyBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heENvbm5lY3Rpb25zOiBpbml0aWFsU3RhdHVzLnNldHRpbmdzLm1heENvbm5lY3Rpb25zID8/IDEwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gU2VydmVyIHNldHRpbmdzIGxvYWRlZCBmcm9tIHN0YXR1czonLCBpbml0aWFsU3RhdHVzLnNldHRpbmdzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGluaXRpYWxTdGF0dXMgJiYgaW5pdGlhbFN0YXR1cy5wb3J0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHk6IG9ubHkgcmVhZCB0aGUgcG9ydCBmcm9tIG9sZGVyIHZlcnNpb25zXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldHRpbmdzLnZhbHVlLnBvcnQgPSBpbml0aWFsU3RhdHVzLnBvcnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVnVlIEFwcF0gUG9ydCBsb2FkZWQgZnJvbSBzZXJ2ZXIgc3RhdHVzOicsIGluaXRpYWxTdGF0dXMucG9ydCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVnVlIEFwcF0gRmFpbGVkIHRvIGdldCBzZXJ2ZXIgc3RhdHVzOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1Z1ZSBBcHBdIFVzaW5nIGRlZmF1bHQgc2VydmVyIHNldHRpbmdzJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlZnJlc2ggc2VydmVyIHN0YXR1cyBwZXJpb2RpY2FsbHlcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEludGVydmFsKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdjb2Nvcy1tY3Atc2VydmVyJywgJ2dldC1zZXJ2ZXItc3RhdHVzJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZlclJ1bm5pbmcudmFsdWUgPSByZXN1bHQucnVubmluZztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZlclN0YXR1cy52YWx1ZSA9IHJlc3VsdC5ydW5uaW5nID8gJ1J1bm5pbmcnIDogJ1N0b3BwZWQnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29ubmVjdGVkQ2xpZW50cy52YWx1ZSA9IHJlc3VsdC5jbGllbnRzIHx8IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBodHRwVXJsLnZhbHVlID0gcmVzdWx0LnJ1bm5pbmcgPyBgaHR0cDovL2xvY2FsaG9zdDoke3Jlc3VsdC5wb3J0fS9tY3BgIDogJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc1Byb2Nlc3NpbmcudmFsdWUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tWdWUgQXBwXSBGYWlsZWQgdG8gZ2V0IHNlcnZlciBzdGF0dXM6JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0sIDIwMDApO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBTdGF0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGFiLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VydmVyUnVubmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZlclN0YXR1cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbm5lY3RlZENsaWVudHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBodHRwVXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXNQcm9jZXNzaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3MsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdmFpbGFibGVUb29scyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xDYXRlZ29yaWVzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3NDaGFuZ2VkLFxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDb21wdXRlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDbGFzcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvdGFsVG9vbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkVG9vbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXNhYmxlZFRvb2xzLFxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBNZXRob2RzXG4gICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2hUYWIsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVCb29sZWFuU2V0dGluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZU51bWJlclNldHRpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICB0b2dnbGVTZXJ2ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBzYXZlU2V0dGluZ3MsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb3B5VXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgbG9hZFRvb2xNYW5hZ2VyU3RhdGUsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVUb29sU3RhdHVzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0QWxsVG9vbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNlbGVjdEFsbFRvb2xzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2F2ZUNoYW5nZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICB0b2dnbGVDYXRlZ29yeVRvb2xzLFxuICAgICAgICAgICAgICAgICAgICAgICAgZ2V0VG9vbHNCeUNhdGVnb3J5LFxuICAgICAgICAgICAgICAgICAgICAgICAgZ2V0Q2F0ZWdvcnlEaXNwbGF5TmFtZVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdGVtcGxhdGU6IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJy4uLy4uLy4uL3N0YXRpYy90ZW1wbGF0ZS92dWUvbWNwLXNlcnZlci1hcHAuaHRtbCcpLCAndXRmLTgnKSxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYXBwLm1vdW50KHRoaXMuJC5hcHApO1xuICAgICAgICAgICAgcGFuZWxEYXRhTWFwLnNldCh0aGlzLCBhcHApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01DUCBQYW5lbF0gVnVlMyBhcHAgbW91bnRlZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgfVxuICAgIH0sXG4gICAgYmVmb3JlQ2xvc2UoKSB7IH0sXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGNvbnN0IGFwcCA9IHBhbmVsRGF0YU1hcC5nZXQodGhpcyk7XG4gICAgICAgIGlmIChhcHApIHtcbiAgICAgICAgICAgIGFwcC51bm1vdW50KCk7XG4gICAgICAgIH1cbiAgICB9LFxufSk7XG4iXX0=