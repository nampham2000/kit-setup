import * as fs from 'fs';
import * as path from 'path';
import { MCPServerSettings, ToolManagerSettings, ToolConfiguration, ToolConfig } from './types';

const DEFAULT_SETTINGS: MCPServerSettings = {
    port: 3000,
    autoStart: false,
    enableDebugLog: false,
    allowedOrigins: ['*'],
    maxConnections: 10
};

const DEFAULT_TOOL_MANAGER_SETTINGS: ToolManagerSettings = {
    configurations: [],
    currentConfigId: '',
    maxConfigSlots: 5
};

type StoredServerSettings = Partial<MCPServerSettings> & {
    debugLog?: boolean;
};

function getSettingsPath(): string {
    return path.join(Editor.Project.path, 'settings', 'mcp-server.json');
}

function getToolManagerSettingsPath(): string {
    return path.join(Editor.Project.path, 'settings', 'tool-manager.json');
}

function ensureSettingsDir(): void {
    const settingsDir = path.dirname(getSettingsPath());
    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }
}

function normalizeSettings(settings: StoredServerSettings): MCPServerSettings {
    return {
        port: settings.port ?? DEFAULT_SETTINGS.port,
        autoStart: settings.autoStart ?? DEFAULT_SETTINGS.autoStart,
        enableDebugLog: settings.enableDebugLog ?? settings.debugLog ?? DEFAULT_SETTINGS.enableDebugLog,
        allowedOrigins: settings.allowedOrigins ?? DEFAULT_SETTINGS.allowedOrigins,
        maxConnections: settings.maxConnections ?? DEFAULT_SETTINGS.maxConnections
    };
}

export function readSettings(): MCPServerSettings {
    try {
        ensureSettingsDir();
        const settingsFile = getSettingsPath();
        if (fs.existsSync(settingsFile)) {
            const content = fs.readFileSync(settingsFile, 'utf8');
            return normalizeSettings(JSON.parse(content));
        }
    } catch (e) {
        console.error('Failed to read settings:', e);
    }
    return normalizeSettings(DEFAULT_SETTINGS);
}

export function saveSettings(settings: StoredServerSettings): MCPServerSettings {
    try {
        ensureSettingsDir();
        const settingsFile = getSettingsPath();
        const normalizedSettings = normalizeSettings(settings);
        fs.writeFileSync(settingsFile, JSON.stringify(normalizedSettings, null, 2));
        return normalizedSettings;
    } catch (e) {
        console.error('Failed to save settings:', e);
        throw e;
    }
}

// Tool manager settings helpers.
export function readToolManagerSettings(): ToolManagerSettings {
    try {
        ensureSettingsDir();
        const settingsFile = getToolManagerSettingsPath();
        if (fs.existsSync(settingsFile)) {
            const content = fs.readFileSync(settingsFile, 'utf8');
            return { ...DEFAULT_TOOL_MANAGER_SETTINGS, ...JSON.parse(content) };
        }
    } catch (e) {
        console.error('Failed to read tool manager settings:', e);
    }
    return DEFAULT_TOOL_MANAGER_SETTINGS;
}

export function saveToolManagerSettings(settings: ToolManagerSettings): void {
    try {
        ensureSettingsDir();
        const settingsFile = getToolManagerSettingsPath();
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Failed to save tool manager settings:', e);
        throw e;
    }
}

export function exportToolConfiguration(config: ToolConfiguration): string {
    return JSON.stringify(config, null, 2);
}

export function importToolConfiguration(configJson: string): ToolConfiguration {
    try {
        const config = JSON.parse(configJson);
        // Validate the configuration structure.
        if (!config.id || !config.name || !Array.isArray(config.tools)) {
            throw new Error('Invalid configuration format');
        }
        return config;
    } catch (e) {
        console.error('Failed to parse tool configuration:', e);
        throw new Error('Invalid JSON format or configuration structure');
    }
}

export { DEFAULT_SETTINGS, DEFAULT_TOOL_MANAGER_SETTINGS, normalizeSettings };
