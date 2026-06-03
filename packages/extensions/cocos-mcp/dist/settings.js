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
exports.DEFAULT_TOOL_MANAGER_SETTINGS = exports.DEFAULT_SETTINGS = void 0;
exports.readSettings = readSettings;
exports.saveSettings = saveSettings;
exports.readToolManagerSettings = readToolManagerSettings;
exports.saveToolManagerSettings = saveToolManagerSettings;
exports.exportToolConfiguration = exportToolConfiguration;
exports.importToolConfiguration = importToolConfiguration;
exports.normalizeSettings = normalizeSettings;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_SETTINGS = {
    port: 3000,
    autoStart: false,
    enableDebugLog: false,
    allowedOrigins: ['*'],
    maxConnections: 10,
    authToken: '',
    allowedHosts: [],
    logLevel: 'info',
    toolsPageSize: 100
};
exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
const DEFAULT_TOOL_MANAGER_SETTINGS = {
    configurations: [],
    currentConfigId: '',
    maxConfigSlots: 5
};
exports.DEFAULT_TOOL_MANAGER_SETTINGS = DEFAULT_TOOL_MANAGER_SETTINGS;
function getSettingsPath() {
    return path.join(Editor.Project.path, 'settings', 'mcp-server.json');
}
function getToolManagerSettingsPath() {
    return path.join(Editor.Project.path, 'settings', 'tool-manager.json');
}
function ensureSettingsDir() {
    const settingsDir = path.dirname(getSettingsPath());
    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }
}
function normalizeSettings(settings) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    return {
        port: (_a = settings.port) !== null && _a !== void 0 ? _a : DEFAULT_SETTINGS.port,
        autoStart: (_b = settings.autoStart) !== null && _b !== void 0 ? _b : DEFAULT_SETTINGS.autoStart,
        enableDebugLog: (_d = (_c = settings.enableDebugLog) !== null && _c !== void 0 ? _c : settings.debugLog) !== null && _d !== void 0 ? _d : DEFAULT_SETTINGS.enableDebugLog,
        allowedOrigins: (_e = settings.allowedOrigins) !== null && _e !== void 0 ? _e : DEFAULT_SETTINGS.allowedOrigins,
        maxConnections: (_f = settings.maxConnections) !== null && _f !== void 0 ? _f : DEFAULT_SETTINGS.maxConnections,
        authToken: (_g = settings.authToken) !== null && _g !== void 0 ? _g : DEFAULT_SETTINGS.authToken,
        allowedHosts: (_h = settings.allowedHosts) !== null && _h !== void 0 ? _h : DEFAULT_SETTINGS.allowedHosts,
        logLevel: (_j = settings.logLevel) !== null && _j !== void 0 ? _j : DEFAULT_SETTINGS.logLevel,
        toolsPageSize: (_k = settings.toolsPageSize) !== null && _k !== void 0 ? _k : DEFAULT_SETTINGS.toolsPageSize
    };
}
function readSettings() {
    try {
        ensureSettingsDir();
        const settingsFile = getSettingsPath();
        if (fs.existsSync(settingsFile)) {
            const content = fs.readFileSync(settingsFile, 'utf8');
            return normalizeSettings(JSON.parse(content));
        }
    }
    catch (e) {
        console.error('Failed to read settings:', e);
    }
    return normalizeSettings(DEFAULT_SETTINGS);
}
function saveSettings(settings) {
    try {
        ensureSettingsDir();
        const settingsFile = getSettingsPath();
        const normalizedSettings = normalizeSettings(settings);
        fs.writeFileSync(settingsFile, JSON.stringify(normalizedSettings, null, 2));
        return normalizedSettings;
    }
    catch (e) {
        console.error('Failed to save settings:', e);
        throw e;
    }
}
// Tool manager settings helpers.
function readToolManagerSettings() {
    try {
        ensureSettingsDir();
        const settingsFile = getToolManagerSettingsPath();
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
function saveToolManagerSettings(settings) {
    try {
        ensureSettingsDir();
        const settingsFile = getToolManagerSettingsPath();
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    }
    catch (e) {
        console.error('Failed to save tool manager settings:', e);
        throw e;
    }
}
function exportToolConfiguration(config) {
    return JSON.stringify(config, null, 2);
}
function importToolConfiguration(configJson) {
    try {
        const config = JSON.parse(configJson);
        // Validate the configuration structure.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2V0dGluZ3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2Uvc2V0dGluZ3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBdURBLG9DQVlDO0FBRUQsb0NBV0M7QUFHRCwwREFZQztBQUVELDBEQVNDO0FBRUQsMERBRUM7QUFFRCwwREFZQztBQUV5RCw4Q0FBaUI7QUE5SDNFLHVDQUF5QjtBQUN6QiwyQ0FBNkI7QUFHN0IsTUFBTSxnQkFBZ0IsR0FBc0I7SUFDeEMsSUFBSSxFQUFFLElBQUk7SUFDVixTQUFTLEVBQUUsS0FBSztJQUNoQixjQUFjLEVBQUUsS0FBSztJQUNyQixjQUFjLEVBQUUsQ0FBQyxHQUFHLENBQUM7SUFDckIsY0FBYyxFQUFFLEVBQUU7SUFDbEIsU0FBUyxFQUFFLEVBQUU7SUFDYixZQUFZLEVBQUUsRUFBRTtJQUNoQixRQUFRLEVBQUUsTUFBTTtJQUNoQixhQUFhLEVBQUUsR0FBRztDQUNyQixDQUFDO0FBZ0hPLDRDQUFnQjtBQTlHekIsTUFBTSw2QkFBNkIsR0FBd0I7SUFDdkQsY0FBYyxFQUFFLEVBQUU7SUFDbEIsZUFBZSxFQUFFLEVBQUU7SUFDbkIsY0FBYyxFQUFFLENBQUM7Q0FDcEIsQ0FBQztBQTBHeUIsc0VBQTZCO0FBcEd4RCxTQUFTLGVBQWU7SUFDcEIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0FBQ3pFLENBQUM7QUFFRCxTQUFTLDBCQUEwQjtJQUMvQixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLG1CQUFtQixDQUFDLENBQUM7QUFDM0UsQ0FBQztBQUVELFNBQVMsaUJBQWlCO0lBQ3RCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQztJQUNwRCxJQUFJLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1FBQzlCLEVBQUUsQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7SUFDbkQsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLGlCQUFpQixDQUFDLFFBQThCOztJQUNyRCxPQUFPO1FBQ0gsSUFBSSxFQUFFLE1BQUEsUUFBUSxDQUFDLElBQUksbUNBQUksZ0JBQWdCLENBQUMsSUFBSTtRQUM1QyxTQUFTLEVBQUUsTUFBQSxRQUFRLENBQUMsU0FBUyxtQ0FBSSxnQkFBZ0IsQ0FBQyxTQUFTO1FBQzNELGNBQWMsRUFBRSxNQUFBLE1BQUEsUUFBUSxDQUFDLGNBQWMsbUNBQUksUUFBUSxDQUFDLFFBQVEsbUNBQUksZ0JBQWdCLENBQUMsY0FBYztRQUMvRixjQUFjLEVBQUUsTUFBQSxRQUFRLENBQUMsY0FBYyxtQ0FBSSxnQkFBZ0IsQ0FBQyxjQUFjO1FBQzFFLGNBQWMsRUFBRSxNQUFBLFFBQVEsQ0FBQyxjQUFjLG1DQUFJLGdCQUFnQixDQUFDLGNBQWM7UUFDMUUsU0FBUyxFQUFFLE1BQUEsUUFBUSxDQUFDLFNBQVMsbUNBQUksZ0JBQWdCLENBQUMsU0FBUztRQUMzRCxZQUFZLEVBQUUsTUFBQSxRQUFRLENBQUMsWUFBWSxtQ0FBSSxnQkFBZ0IsQ0FBQyxZQUFZO1FBQ3BFLFFBQVEsRUFBRSxNQUFBLFFBQVEsQ0FBQyxRQUFRLG1DQUFJLGdCQUFnQixDQUFDLFFBQVE7UUFDeEQsYUFBYSxFQUFFLE1BQUEsUUFBUSxDQUFDLGFBQWEsbUNBQUksZ0JBQWdCLENBQUMsYUFBYTtLQUMxRSxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQWdCLFlBQVk7SUFDeEIsSUFBSSxDQUFDO1FBQ0QsaUJBQWlCLEVBQUUsQ0FBQztRQUNwQixNQUFNLFlBQVksR0FBRyxlQUFlLEVBQUUsQ0FBQztRQUN2QyxJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUM5QixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUMsWUFBWSxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztZQUN0RCxPQUFPLGlCQUFpQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztRQUNsRCxDQUFDO0lBQ0wsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDVCxPQUFPLENBQUMsS0FBSyxDQUFDLDBCQUEwQixFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ2pELENBQUM7SUFDRCxPQUFPLGlCQUFpQixDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFDL0MsQ0FBQztBQUVELFNBQWdCLFlBQVksQ0FBQyxRQUE4QjtJQUN2RCxJQUFJLENBQUM7UUFDRCxpQkFBaUIsRUFBRSxDQUFDO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLGVBQWUsRUFBRSxDQUFDO1FBQ3ZDLE1BQU0sa0JBQWtCLEdBQUcsaUJBQWlCLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDdkQsRUFBRSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1RSxPQUFPLGtCQUFrQixDQUFDO0lBQzlCLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1QsT0FBTyxDQUFDLEtBQUssQ0FBQywwQkFBMEIsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUM3QyxNQUFNLENBQUMsQ0FBQztJQUNaLENBQUM7QUFDTCxDQUFDO0FBRUQsaUNBQWlDO0FBQ2pDLFNBQWdCLHVCQUF1QjtJQUNuQyxJQUFJLENBQUM7UUFDRCxpQkFBaUIsRUFBRSxDQUFDO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLDBCQUEwQixFQUFFLENBQUM7UUFDbEQsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7WUFDOUIsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFDdEQsdUNBQVksNkJBQTZCLEdBQUssSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRztRQUN4RSxDQUFDO0lBQ0wsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDVCxPQUFPLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQzlELENBQUM7SUFDRCxPQUFPLDZCQUE2QixDQUFDO0FBQ3pDLENBQUM7QUFFRCxTQUFnQix1QkFBdUIsQ0FBQyxRQUE2QjtJQUNqRSxJQUFJLENBQUM7UUFDRCxpQkFBaUIsRUFBRSxDQUFDO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLDBCQUEwQixFQUFFLENBQUM7UUFDbEQsRUFBRSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDdEUsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDVCxPQUFPLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQzFELE1BQU0sQ0FBQyxDQUFDO0lBQ1osQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFnQix1QkFBdUIsQ0FBQyxNQUF5QjtJQUM3RCxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMzQyxDQUFDO0FBRUQsU0FBZ0IsdUJBQXVCLENBQUMsVUFBa0I7SUFDdEQsSUFBSSxDQUFDO1FBQ0QsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN0Qyx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM3RCxNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUNELE9BQU8sTUFBTSxDQUFDO0lBQ2xCLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1QsT0FBTyxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUN4RCxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7SUFDdEUsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgTUNQU2VydmVyU2V0dGluZ3MsIFRvb2xNYW5hZ2VyU2V0dGluZ3MsIFRvb2xDb25maWd1cmF0aW9uLCBUb29sQ29uZmlnIH0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IE1DUFNlcnZlclNldHRpbmdzID0ge1xuICAgIHBvcnQ6IDMwMDAsXG4gICAgYXV0b1N0YXJ0OiBmYWxzZSxcbiAgICBlbmFibGVEZWJ1Z0xvZzogZmFsc2UsXG4gICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxuICAgIG1heENvbm5lY3Rpb25zOiAxMCxcbiAgICBhdXRoVG9rZW46ICcnLFxuICAgIGFsbG93ZWRIb3N0czogW10sXG4gICAgbG9nTGV2ZWw6ICdpbmZvJyxcbiAgICB0b29sc1BhZ2VTaXplOiAxMDBcbn07XG5cbmNvbnN0IERFRkFVTFRfVE9PTF9NQU5BR0VSX1NFVFRJTkdTOiBUb29sTWFuYWdlclNldHRpbmdzID0ge1xuICAgIGNvbmZpZ3VyYXRpb25zOiBbXSxcbiAgICBjdXJyZW50Q29uZmlnSWQ6ICcnLFxuICAgIG1heENvbmZpZ1Nsb3RzOiA1XG59O1xuXG50eXBlIFN0b3JlZFNlcnZlclNldHRpbmdzID0gUGFydGlhbDxNQ1BTZXJ2ZXJTZXR0aW5ncz4gJiB7XG4gICAgZGVidWdMb2c/OiBib29sZWFuO1xufTtcblxuZnVuY3Rpb24gZ2V0U2V0dGluZ3NQYXRoKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBhdGguam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnc2V0dGluZ3MnLCAnbWNwLXNlcnZlci5qc29uJyk7XG59XG5cbmZ1bmN0aW9uIGdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBhdGguam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnc2V0dGluZ3MnLCAndG9vbC1tYW5hZ2VyLmpzb24nKTtcbn1cblxuZnVuY3Rpb24gZW5zdXJlU2V0dGluZ3NEaXIoKTogdm9pZCB7XG4gICAgY29uc3Qgc2V0dGluZ3NEaXIgPSBwYXRoLmRpcm5hbWUoZ2V0U2V0dGluZ3NQYXRoKCkpO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhzZXR0aW5nc0RpcikpIHtcbiAgICAgICAgZnMubWtkaXJTeW5jKHNldHRpbmdzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNldHRpbmdzKHNldHRpbmdzOiBTdG9yZWRTZXJ2ZXJTZXR0aW5ncyk6IE1DUFNlcnZlclNldHRpbmdzIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBwb3J0OiBzZXR0aW5ncy5wb3J0ID8/IERFRkFVTFRfU0VUVElOR1MucG9ydCxcbiAgICAgICAgYXV0b1N0YXJ0OiBzZXR0aW5ncy5hdXRvU3RhcnQgPz8gREVGQVVMVF9TRVRUSU5HUy5hdXRvU3RhcnQsXG4gICAgICAgIGVuYWJsZURlYnVnTG9nOiBzZXR0aW5ncy5lbmFibGVEZWJ1Z0xvZyA/PyBzZXR0aW5ncy5kZWJ1Z0xvZyA/PyBERUZBVUxUX1NFVFRJTkdTLmVuYWJsZURlYnVnTG9nLFxuICAgICAgICBhbGxvd2VkT3JpZ2luczogc2V0dGluZ3MuYWxsb3dlZE9yaWdpbnMgPz8gREVGQVVMVF9TRVRUSU5HUy5hbGxvd2VkT3JpZ2lucyxcbiAgICAgICAgbWF4Q29ubmVjdGlvbnM6IHNldHRpbmdzLm1heENvbm5lY3Rpb25zID8/IERFRkFVTFRfU0VUVElOR1MubWF4Q29ubmVjdGlvbnMsXG4gICAgICAgIGF1dGhUb2tlbjogc2V0dGluZ3MuYXV0aFRva2VuID8/IERFRkFVTFRfU0VUVElOR1MuYXV0aFRva2VuLFxuICAgICAgICBhbGxvd2VkSG9zdHM6IHNldHRpbmdzLmFsbG93ZWRIb3N0cyA/PyBERUZBVUxUX1NFVFRJTkdTLmFsbG93ZWRIb3N0cyxcbiAgICAgICAgbG9nTGV2ZWw6IHNldHRpbmdzLmxvZ0xldmVsID8/IERFRkFVTFRfU0VUVElOR1MubG9nTGV2ZWwsXG4gICAgICAgIHRvb2xzUGFnZVNpemU6IHNldHRpbmdzLnRvb2xzUGFnZVNpemUgPz8gREVGQVVMVF9TRVRUSU5HUy50b29sc1BhZ2VTaXplXG4gICAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRTZXR0aW5ncygpOiBNQ1BTZXJ2ZXJTZXR0aW5ncyB7XG4gICAgdHJ5IHtcbiAgICAgICAgZW5zdXJlU2V0dGluZ3NEaXIoKTtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3NGaWxlID0gZ2V0U2V0dGluZ3NQYXRoKCk7XG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKHNldHRpbmdzRmlsZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoc2V0dGluZ3NGaWxlLCAndXRmOCcpO1xuICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZVNldHRpbmdzKEpTT04ucGFyc2UoY29udGVudCkpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gcmVhZCBzZXR0aW5nczonLCBlKTtcbiAgICB9XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVNldHRpbmdzKERFRkFVTFRfU0VUVElOR1MpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2F2ZVNldHRpbmdzKHNldHRpbmdzOiBTdG9yZWRTZXJ2ZXJTZXR0aW5ncyk6IE1DUFNlcnZlclNldHRpbmdzIHtcbiAgICB0cnkge1xuICAgICAgICBlbnN1cmVTZXR0aW5nc0RpcigpO1xuICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSBnZXRTZXR0aW5nc1BhdGgoKTtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZFNldHRpbmdzID0gbm9ybWFsaXplU2V0dGluZ3Moc2V0dGluZ3MpO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHNldHRpbmdzRmlsZSwgSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZFNldHRpbmdzLCBudWxsLCAyKSk7XG4gICAgICAgIHJldHVybiBub3JtYWxpemVkU2V0dGluZ3M7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2F2ZSBzZXR0aW5nczonLCBlKTtcbiAgICAgICAgdGhyb3cgZTtcbiAgICB9XG59XG5cbi8vIFRvb2wgbWFuYWdlciBzZXR0aW5ncyBoZWxwZXJzLlxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRUb29sTWFuYWdlclNldHRpbmdzKCk6IFRvb2xNYW5hZ2VyU2V0dGluZ3Mge1xuICAgIHRyeSB7XG4gICAgICAgIGVuc3VyZVNldHRpbmdzRGlyKCk7XG4gICAgICAgIGNvbnN0IHNldHRpbmdzRmlsZSA9IGdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk7XG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKHNldHRpbmdzRmlsZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoc2V0dGluZ3NGaWxlLCAndXRmOCcpO1xuICAgICAgICAgICAgcmV0dXJuIHsgLi4uREVGQVVMVF9UT09MX01BTkFHRVJfU0VUVElOR1MsIC4uLkpTT04ucGFyc2UoY29udGVudCkgfTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlYWQgdG9vbCBtYW5hZ2VyIHNldHRpbmdzOicsIGUpO1xuICAgIH1cbiAgICByZXR1cm4gREVGQVVMVF9UT09MX01BTkFHRVJfU0VUVElOR1M7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYXZlVG9vbE1hbmFnZXJTZXR0aW5ncyhzZXR0aW5nczogVG9vbE1hbmFnZXJTZXR0aW5ncyk6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICAgIGVuc3VyZVNldHRpbmdzRGlyKCk7XG4gICAgICAgIGNvbnN0IHNldHRpbmdzRmlsZSA9IGdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMoc2V0dGluZ3NGaWxlLCBKU09OLnN0cmluZ2lmeShzZXR0aW5ncywgbnVsbCwgMikpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNhdmUgdG9vbCBtYW5hZ2VyIHNldHRpbmdzOicsIGUpO1xuICAgICAgICB0aHJvdyBlO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4cG9ydFRvb2xDb25maWd1cmF0aW9uKGNvbmZpZzogVG9vbENvbmZpZ3VyYXRpb24pOiBzdHJpbmcge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb25maWcsIG51bGwsIDIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW1wb3J0VG9vbENvbmZpZ3VyYXRpb24oY29uZmlnSnNvbjogc3RyaW5nKTogVG9vbENvbmZpZ3VyYXRpb24ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IEpTT04ucGFyc2UoY29uZmlnSnNvbik7XG4gICAgICAgIC8vIFZhbGlkYXRlIHRoZSBjb25maWd1cmF0aW9uIHN0cnVjdHVyZS5cbiAgICAgICAgaWYgKCFjb25maWcuaWQgfHwgIWNvbmZpZy5uYW1lIHx8ICFBcnJheS5pc0FycmF5KGNvbmZpZy50b29scykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb25maWd1cmF0aW9uIGZvcm1hdCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb25maWc7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gcGFyc2UgdG9vbCBjb25maWd1cmF0aW9uOicsIGUpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgSlNPTiBmb3JtYXQgb3IgY29uZmlndXJhdGlvbiBzdHJ1Y3R1cmUnKTtcbiAgICB9XG59XG5cbmV4cG9ydCB7IERFRkFVTFRfU0VUVElOR1MsIERFRkFVTFRfVE9PTF9NQU5BR0VSX1NFVFRJTkdTLCBub3JtYWxpemVTZXR0aW5ncyB9O1xuIl19