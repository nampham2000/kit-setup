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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2V0dGluZ3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2Uvc2V0dGluZ3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBdURBLG9DQVlDO0FBRUQsb0NBV0M7QUFHRCwwREFZQztBQUVELDBEQVNDO0FBRUQsMERBRUM7QUFFRCwwREFZQztBQUV5RCw4Q0FBaUI7QUE5SDNFLHVDQUF5QjtBQUN6QiwyQ0FBNkI7QUFHN0IsTUFBTSxnQkFBZ0IsR0FBc0I7SUFDeEMsSUFBSSxFQUFFLElBQUk7SUFDVixTQUFTLEVBQUUsS0FBSztJQUNoQixjQUFjLEVBQUUsS0FBSztJQUNyQixjQUFjLEVBQUUsQ0FBQyxHQUFHLENBQUM7SUFDckIsY0FBYyxFQUFFLEVBQUU7SUFDbEIsU0FBUyxFQUFFLEVBQUU7SUFDYixZQUFZLEVBQUUsRUFBRTtJQUNoQixRQUFRLEVBQUUsTUFBTTtJQUNoQixhQUFhLEVBQUUsR0FBRztDQUNyQixDQUFDO0FBZ0hPLDRDQUFnQjtBQTlHekIsTUFBTSw2QkFBNkIsR0FBd0I7SUFDdkQsY0FBYyxFQUFFLEVBQUU7SUFDbEIsZUFBZSxFQUFFLEVBQUU7SUFDbkIsY0FBYyxFQUFFLENBQUM7Q0FDcEIsQ0FBQztBQTBHeUIsc0VBQTZCO0FBcEd4RCxTQUFTLGVBQWU7SUFDcEIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0FBQ3pFLENBQUM7QUFFRCxTQUFTLDBCQUEwQjtJQUMvQixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLG1CQUFtQixDQUFDLENBQUM7QUFDM0UsQ0FBQztBQUVELFNBQVMsaUJBQWlCO0lBQ3RCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMs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Q0FBQztZQUM3RCxNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUNELE9BQU8sTUFBTSxDQUFDO0lBQ2xCLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1QsT0FBTyxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUN4RCxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7SUFDdEUsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB7IE1DUFNlcnZlclNldHRpbmdzLCBUb29sTWFuYWdlclNldHRpbmdzLCBUb29sQ29uZmlndXJhdGlvbiwgVG9vbENvbmZpZyB9IGZyb20gJy4vdHlwZXMnO1xyXG5cclxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogTUNQU2VydmVyU2V0dGluZ3MgPSB7XHJcbiAgICBwb3J0OiAzMDAwLFxyXG4gICAgYXV0b1N0YXJ0OiBmYWxzZSxcclxuICAgIGVuYWJsZURlYnVnTG9nOiBmYWxzZSxcclxuICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcclxuICAgIG1heENvbm5lY3Rpb25zOiAxMCxcclxuICAgIGF1dGhUb2tlbjogJycsXHJcbiAgICBhbGxvd2VkSG9zdHM6IFtdLFxyXG4gICAgbG9nTGV2ZWw6ICdpbmZvJyxcclxuICAgIHRvb2xzUGFnZVNpemU6IDEwMFxyXG59O1xyXG5cclxuY29uc3QgREVGQVVMVF9UT09MX01BTkFHRVJfU0VUVElOR1M6IFRvb2xNYW5hZ2VyU2V0dGluZ3MgPSB7XHJcbiAgICBjb25maWd1cmF0aW9uczogW10sXHJcbiAgICBjdXJyZW50Q29uZmlnSWQ6ICcnLFxyXG4gICAgbWF4Q29uZmlnU2xvdHM6IDVcclxufTtcclxuXHJcbnR5cGUgU3RvcmVkU2VydmVyU2V0dGluZ3MgPSBQYXJ0aWFsPE1DUFNlcnZlclNldHRpbmdzPiAmIHtcclxuICAgIGRlYnVnTG9nPzogYm9vbGVhbjtcclxufTtcclxuXHJcbmZ1bmN0aW9uIGdldFNldHRpbmdzUGF0aCgpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIHBhdGguam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnc2V0dGluZ3MnLCAnbWNwLXNlcnZlci5qc29uJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRvb2xNYW5hZ2VyU2V0dGluZ3NQYXRoKCk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gcGF0aC5qb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsICdzZXR0aW5ncycsICd0b29sLW1hbmFnZXIuanNvbicpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlbnN1cmVTZXR0aW5nc0RpcigpOiB2b2lkIHtcclxuICAgIGNvbnN0IHNldHRpbmdzRGlyID0gcGF0aC5kaXJuYW1lKGdldFNldHRpbmdzUGF0aCgpKTtcclxuICAgIGlmICghZnMuZXhpc3RzU3luYyhzZXR0aW5nc0RpcikpIHtcclxuICAgICAgICBmcy5ta2RpclN5bmMoc2V0dGluZ3NEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVTZXR0aW5ncyhzZXR0aW5nczogU3RvcmVkU2VydmVyU2V0dGluZ3MpOiBNQ1BTZXJ2ZXJTZXR0aW5ncyB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHBvcnQ6IHNldHRpbmdzLnBvcnQgPz8gREVGQVVMVF9TRVRUSU5HUy5wb3J0LFxyXG4gICAgICAgIGF1dG9TdGFydDogc2V0dGluZ3MuYXV0b1N0YXJ0ID8/IERFRkFVTFRfU0VUVElOR1MuYXV0b1N0YXJ0LFxyXG4gICAgICAgIGVuYWJsZURlYnVnTG9nOiBzZXR0aW5ncy5lbmFibGVEZWJ1Z0xvZyA/PyBzZXR0aW5ncy5kZWJ1Z0xvZyA/PyBERUZBVUxUX1NFVFRJTkdTLmVuYWJsZURlYnVnTG9nLFxyXG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBzZXR0aW5ncy5hbGxvd2VkT3JpZ2lucyA/PyBERUZBVUxUX1NFVFRJTkdTLmFsbG93ZWRPcmlnaW5zLFxyXG4gICAgICAgIG1heENvbm5lY3Rpb25zOiBzZXR0aW5ncy5tYXhDb25uZWN0aW9ucyA/PyBERUZBVUxUX1NFVFRJTkdTLm1heENvbm5lY3Rpb25zLFxyXG4gICAgICAgIGF1dGhUb2tlbjogc2V0dGluZ3MuYXV0aFRva2VuID8/IERFRkFVTFRfU0VUVElOR1MuYXV0aFRva2VuLFxyXG4gICAgICAgIGFsbG93ZWRIb3N0czogc2V0dGluZ3MuYWxsb3dlZEhvc3RzID8/IERFRkFVTFRfU0VUVElOR1MuYWxsb3dlZEhvc3RzLFxyXG4gICAgICAgIGxvZ0xldmVsOiBzZXR0aW5ncy5sb2dMZXZlbCA/PyBERUZBVUxUX1NFVFRJTkdTLmxvZ0xldmVsLFxyXG4gICAgICAgIHRvb2xzUGFnZVNpemU6IHNldHRpbmdzLnRvb2xzUGFnZVNpemUgPz8gREVGQVVMVF9TRVRUSU5HUy50b29sc1BhZ2VTaXplXHJcbiAgICB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVhZFNldHRpbmdzKCk6IE1DUFNlcnZlclNldHRpbmdzIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgZW5zdXJlU2V0dGluZ3NEaXIoKTtcclxuICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSBnZXRTZXR0aW5nc1BhdGgoKTtcclxuICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhzZXR0aW5nc0ZpbGUpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoc2V0dGluZ3NGaWxlLCAndXRmOCcpO1xyXG4gICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplU2V0dGluZ3MoSlNPTi5wYXJzZShjb250ZW50KSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byByZWFkIHNldHRpbmdzOicsIGUpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5vcm1hbGl6ZVNldHRpbmdzKERFRkFVTFRfU0VUVElOR1MpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2F2ZVNldHRpbmdzKHNldHRpbmdzOiBTdG9yZWRTZXJ2ZXJTZXR0aW5ncyk6IE1DUFNlcnZlclNldHRpbmdzIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgZW5zdXJlU2V0dGluZ3NEaXIoKTtcclxuICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSBnZXRTZXR0aW5nc1BhdGgoKTtcclxuICAgICAgICBjb25zdCBub3JtYWxpemVkU2V0dGluZ3MgPSBub3JtYWxpemVTZXR0aW5ncyhzZXR0aW5ncyk7XHJcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhzZXR0aW5nc0ZpbGUsIEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWRTZXR0aW5ncywgbnVsbCwgMikpO1xyXG4gICAgICAgIHJldHVybiBub3JtYWxpemVkU2V0dGluZ3M7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNhdmUgc2V0dGluZ3M6JywgZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgIH1cclxufVxyXG5cclxuLy8gVG9vbCBtYW5hZ2VyIHNldHRpbmdzIGhlbHBlcnMuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWFkVG9vbE1hbmFnZXJTZXR0aW5ncygpOiBUb29sTWFuYWdlclNldHRpbmdzIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgZW5zdXJlU2V0dGluZ3NEaXIoKTtcclxuICAgICAgICBjb25zdCBzZXR0aW5nc0ZpbGUgPSBnZXRUb29sTWFuYWdlclNldHRpbmdzUGF0aCgpO1xyXG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKHNldHRpbmdzRmlsZSkpIHtcclxuICAgICAgICAgICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhzZXR0aW5nc0ZpbGUsICd1dGY4Jyk7XHJcbiAgICAgICAgICAgIHJldHVybiB7IC4uLkRFRkFVTFRfVE9PTF9NQU5BR0VSX1NFVFRJTkdTLCAuLi5KU09OLnBhcnNlKGNvbnRlbnQpIH07XHJcbiAgICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byByZWFkIHRvb2wgbWFuYWdlciBzZXR0aW5nczonLCBlKTtcclxuICAgIH1cclxuICAgIHJldHVybiBERUZBVUxUX1RPT0xfTUFOQUdFUl9TRVRUSU5HUztcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVUb29sTWFuYWdlclNldHRpbmdzKHNldHRpbmdzOiBUb29sTWFuYWdlclNldHRpbmdzKTogdm9pZCB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGVuc3VyZVNldHRpbmdzRGlyKCk7XHJcbiAgICAgICAgY29uc3Qgc2V0dGluZ3NGaWxlID0gZ2V0VG9vbE1hbmFnZXJTZXR0aW5nc1BhdGgoKTtcclxuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHNldHRpbmdzRmlsZSwgSlNPTi5zdHJpbmdpZnkoc2V0dGluZ3MsIG51bGwsIDIpKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2F2ZSB0b29sIG1hbmFnZXIgc2V0dGluZ3M6JywgZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGV4cG9ydFRvb2xDb25maWd1cmF0aW9uKGNvbmZpZzogVG9vbENvbmZpZ3VyYXRpb24pOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGNvbmZpZywgbnVsbCwgMik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbXBvcnRUb29sQ29uZmlndXJhdGlvbihjb25maWdKc29uOiBzdHJpbmcpOiBUb29sQ29uZmlndXJhdGlvbiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IEpTT04ucGFyc2UoY29uZmlnSnNvbik7XHJcbiAgICAgICAgLy8gVmFsaWRhdGUgdGhlIGNvbmZpZ3VyYXRpb24gc3RydWN0dXJlLlxyXG4gICAgICAgIGlmICghY29uZmlnLmlkIHx8ICFjb25maWcubmFtZSB8fCAhQXJyYXkuaXNBcnJheShjb25maWcudG9vbHMpKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb25maWd1cmF0aW9uIGZvcm1hdCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY29uZmlnO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBwYXJzZSB0b29sIGNvbmZpZ3VyYXRpb246JywgZSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEpTT04gZm9ybWF0IG9yIGNvbmZpZ3VyYXRpb24gc3RydWN0dXJlJyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCB7IERFRkFVTFRfU0VUVElOR1MsIERFRkFVTFRfVE9PTF9NQU5BR0VSX1NFVFRJTkdTLCBub3JtYWxpemVTZXR0aW5ncyB9O1xyXG4iXX0=