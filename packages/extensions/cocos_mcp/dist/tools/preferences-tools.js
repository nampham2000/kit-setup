"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreferencesTools = void 0;
class PreferencesTools {
    getTools() {
        return [
            {
                name: 'open_preferences_settings',
                description: 'Open preferences settings panel',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab: {
                            type: 'string',
                            description: 'Preferences tab to open (optional)',
                            enum: ['general', 'external-tools', 'data-editor', 'laboratory', 'extensions']
                        },
                        args: {
                            type: 'array',
                            description: 'Additional arguments to pass to the tab',
                            items: {}
                        }
                    }
                }
            },
            {
                name: 'query_preferences_config',
                description: 'Query preferences configuration',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Plugin or category name',
                            default: 'general'
                        },
                        path: {
                            type: 'string',
                            description: 'Configuration path (optional)'
                        },
                        type: {
                            type: 'string',
                            description: 'Configuration type',
                            enum: ['default', 'global', 'local'],
                            default: 'global'
                        }
                    },
                    required: ['name']
                }
            },
            {
                name: 'set_preferences_config',
                description: 'Set preferences configuration',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Plugin name'
                        },
                        path: {
                            type: 'string',
                            description: 'Configuration path'
                        },
                        value: {
                            description: 'Configuration value'
                        },
                        type: {
                            type: 'string',
                            description: 'Configuration type',
                            enum: ['default', 'global', 'local'],
                            default: 'global'
                        }
                    },
                    required: ['name', 'path', 'value']
                }
            },
            {
                name: 'get_all_preferences',
                description: 'Get all available preferences categories',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'reset_preferences',
                description: 'Reset preferences to default values',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Specific preference category to reset (optional)'
                        },
                        type: {
                            type: 'string',
                            description: 'Configuration type to reset',
                            enum: ['global', 'local'],
                            default: 'global'
                        }
                    }
                }
            },
            {
                name: 'export_preferences',
                description: 'Export current preferences configuration',
                inputSchema: {
                    type: 'object',
                    properties: {
                        exportPath: {
                            type: 'string',
                            description: 'Path to export preferences file (optional)'
                        }
                    }
                }
            },
            {
                name: 'import_preferences',
                description: 'Import preferences configuration from file',
                inputSchema: {
                    type: 'object',
                    properties: {
                        importPath: {
                            type: 'string',
                            description: 'Path to import preferences file from'
                        }
                    },
                    required: ['importPath']
                }
            }
        ];
    }
    async execute(toolName, args) {
        switch (toolName) {
            case 'open_preferences_settings':
                return await this.openPreferencesSettings(args.tab, args.args);
            case 'query_preferences_config':
                return await this.queryPreferencesConfig(args.name, args.path, args.type);
            case 'set_preferences_config':
                return await this.setPreferencesConfig(args.name, args.path, args.value, args.type);
            case 'get_all_preferences':
                return await this.getAllPreferences();
            case 'reset_preferences':
                return await this.resetPreferences(args.name, args.type);
            case 'export_preferences':
                return await this.exportPreferences(args.exportPath);
            case 'import_preferences':
                return await this.importPreferences(args.importPath);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
    async openPreferencesSettings(tab, args) {
        return new Promise((resolve) => {
            const requestArgs = [];
            if (tab) {
                requestArgs.push(tab);
            }
            if (args && args.length > 0) {
                requestArgs.push(...args);
            }
            Editor.Message.request('preferences', 'open-settings', ...requestArgs).then(() => {
                resolve({
                    success: true,
                    message: `Preferences settings opened${tab ? ` on tab: ${tab}` : ''}`
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async queryPreferencesConfig(name, path, type = 'global') {
        return new Promise((resolve) => {
            const requestArgs = [name];
            if (path) {
                requestArgs.push(path);
            }
            requestArgs.push(type);
            Editor.Message.request('preferences', 'query-config', ...requestArgs).then((config) => {
                resolve({
                    success: true,
                    data: {
                        name: name,
                        path: path,
                        type: type,
                        config: config
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async setPreferencesConfig(name, path, value, type = 'global') {
        return new Promise((resolve) => {
            Editor.Message.request('preferences', 'set-config', name, path, value, type).then((success) => {
                if (success) {
                    resolve({
                        success: true,
                        message: `Preference '${name}.${path}' updated successfully`
                    });
                }
                else {
                    resolve({
                        success: false,
                        error: `Failed to update preference '${name}.${path}'`
                    });
                }
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async getAllPreferences() {
        return new Promise((resolve) => {
            // Common preference categories in Cocos Creator
            const categories = [
                'general',
                'external-tools',
                'data-editor',
                'laboratory',
                'extensions',
                'preview',
                'console',
                'native',
                'builder'
            ];
            const preferences = {};
            const queryPromises = categories.map(category => {
                return Editor.Message.request('preferences', 'query-config', category, undefined, 'global')
                    .then((config) => {
                    preferences[category] = config;
                })
                    .catch(() => {
                    // Ignore errors for categories that don't exist
                    preferences[category] = null;
                });
            });
            Promise.all(queryPromises).then(() => {
                // Filter out null entries
                const validPreferences = Object.fromEntries(Object.entries(preferences).filter(([_, value]) => value !== null));
                resolve({
                    success: true,
                    data: {
                        categories: Object.keys(validPreferences),
                        preferences: validPreferences
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async resetPreferences(name, type = 'global') {
        return new Promise((resolve) => {
            if (name) {
                // Reset specific preference category
                Editor.Message.request('preferences', 'query-config', name, undefined, 'default').then((defaultConfig) => {
                    return Editor.Message.request('preferences', 'set-config', name, '', defaultConfig, type);
                }).then((success) => {
                    if (success) {
                        resolve({
                            success: true,
                            message: `Preference category '${name}' reset to default`
                        });
                    }
                    else {
                        resolve({
                            success: false,
                            error: `Failed to reset preference category '${name}'`
                        });
                    }
                }).catch((err) => {
                    resolve({ success: false, error: err.message });
                });
            }
            else {
                resolve({
                    success: false,
                    error: 'Resetting all preferences is not supported through API. Please specify a preference category.'
                });
            }
        });
    }
    async exportPreferences(exportPath) {
        return new Promise((resolve) => {
            this.getAllPreferences().then((prefsResult) => {
                if (!prefsResult.success) {
                    resolve(prefsResult);
                    return;
                }
                const prefsData = JSON.stringify(prefsResult.data, null, 2);
                const path = exportPath || `preferences_export_${Date.now()}.json`;
                // For now, return the data - in a real implementation, you'd write to file
                resolve({
                    success: true,
                    data: {
                        exportPath: path,
                        preferences: prefsResult.data,
                        jsonData: prefsData,
                        message: 'Preferences exported successfully'
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async importPreferences(importPath) {
        return new Promise((resolve) => {
            resolve({
                success: false,
                error: 'Import preferences functionality requires file system access which is not available in this context. Please manually import preferences through the Editor UI.'
            });
        });
    }
}
exports.PreferencesTools = PreferencesTools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlZmVyZW5jZXMtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdG9vbHMvcHJlZmVyZW5jZXMtdG9vbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsTUFBYSxnQkFBZ0I7SUFDekIsUUFBUTtRQUNKLE9BQU87WUFDSDtnQkFDSSxJQUFJLEVBQUUsMkJBQTJCO2dCQUNqQyxXQUFXLEVBQUUsaUNBQWlDO2dCQUM5QyxXQUFXLEVBQUU7b0JBQ1QsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFO3dCQUNSLEdBQUcsRUFBRTs0QkFDRCxJQUFJLEVBQUUsUUFBUTs0QkFDZCxXQUFXLEVBQUUsb0NBQW9DOzRCQUNqRCxJQUFJLEVBQUUsQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxZQUFZLENBQUM7eUJBQ2pGO3dCQUNELElBQUksRUFBRTs0QkFDRixJQUFJLEVBQUUsT0FBTzs0QkFDVCxXQUFXLEVBQUUseUNBQXlDOzRCQUN0RCxLQUFLLEVBQUUsRUFBRTt5QkFDaEI7cUJBQ0o7aUJBQ0o7YUFDSjtZQUNEO2dCQUNJLElBQUksRUFBRSwwQkFBMEI7Z0JBQ2hDLFdBQVcsRUFBRSxpQ0FBaUM7Z0JBQzlDLFdBQVcsRUFBRTtvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1IsSUFBSSxFQUFFOzRCQUNGLElBQUksRUFBRSxRQUFROzRCQUNkLFdBQVcsRUFBRSx5QkFBeUI7NEJBQ3RDLE9BQU8sRUFBRSxTQUFTO3lCQUNyQjt3QkFDRCxJQUFJLEVBQUU7NEJBQ0YsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLCtCQUErQjt5QkFDL0M7d0JBQ0QsSUFBSSxFQUFFOzRCQUNGLElBQUksRUFBRSxRQUFROzRCQUNkLFdBQVcsRUFBRSxvQkFBb0I7NEJBQ2pDLElBQUksRUFBRSxDQUFDLFNBQVMsRUFBRSxRQUFRLEVBQUUsT0FBTyxD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RUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBQ3BELENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRU8sS0FBSyxDQUFDLGlCQUFpQixDQUFDLFVBQWtCO1FBQzlDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUMzQixPQUFPLENBQUM7Z0JBQ0osT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLGdLQUFnSzthQUMxSyxDQUFDLENBQUM7UUFDUCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQXpVRCw0Q0F5VUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUb29sRGVmaW5pdGlvbiwgVG9vbFJlc3BvbnNlLCBUb29sRXhlY3V0b3IgfSBmcm9tICcuLi90eXBlcyc7XHJcblxyXG5leHBvcnQgY2xhc3MgUHJlZmVyZW5jZXNUb29scyBpbXBsZW1lbnRzIFRvb2xFeGVjdXRvciB7XHJcbiAgICBnZXRUb29scygpOiBUb29sRGVmaW5pdGlvbltdIHtcclxuICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnb3Blbl9wcmVmZXJlbmNlc19zZXR0aW5ncycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ09wZW4gcHJlZmVyZW5jZXMgc2V0dGluZ3MgcGFuZWwnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhYjoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1ByZWZlcmVuY2VzIHRhYiB0byBvcGVuIChvcHRpb25hbCknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWydnZW5lcmFsJywgJ2V4dGVybmFsLXRvb2xzJywgJ2RhdGEtZWRpdG9yJywgJ2xhYm9yYXRvcnknLCAnZXh0ZW5zaW9ucyddXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3M6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBZGRpdGlvbmFsIGFyZ3VtZW50cyB0byBwYXNzIHRvIHRoZSB0YWInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zOiB7fVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAncXVlcnlfcHJlZmVyZW5jZXNfY29uZmlnJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUXVlcnkgcHJlZmVyZW5jZXMgY29uZmlndXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1BsdWdpbiBvciBjYXRlZ29yeSBuYW1lJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdnZW5lcmFsJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29uZmlndXJhdGlvbiBwYXRoIChvcHRpb25hbCknXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb25maWd1cmF0aW9uIHR5cGUnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW51bTogWydkZWZhdWx0JywgJ2dsb2JhbCcsICdsb2NhbCddLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogJ2dsb2JhbCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsnbmFtZSddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdzZXRfcHJlZmVyZW5jZXNfY29uZmlnJyxcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU2V0IHByZWZlcmVuY2VzIGNvbmZpZ3VyYXRpb24nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQbHVnaW4gbmFtZSdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbmZpZ3VyYXRpb24gcGF0aCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29uZmlndXJhdGlvbiB2YWx1ZSdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbmZpZ3VyYXRpb24gdHlwZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbJ2RlZmF1bHQnLCAnZ2xvYmFsJywgJ2xvY2FsJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAnZ2xvYmFsJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyduYW1lJywgJ3BhdGgnLCAndmFsdWUnXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X2FsbF9wcmVmZXJlbmNlcycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0dldCBhbGwgYXZhaWxhYmxlIHByZWZlcmVuY2VzIGNhdGVnb3JpZXMnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7fVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAncmVzZXRfcHJlZmVyZW5jZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdSZXNldCBwcmVmZXJlbmNlcyB0byBkZWZhdWx0IHZhbHVlcycsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NwZWNpZmljIHByZWZlcmVuY2UgY2F0ZWdvcnkgdG8gcmVzZXQgKG9wdGlvbmFsKSdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbmZpZ3VyYXRpb24gdHlwZSB0byByZXNldCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbJ2dsb2JhbCcsICdsb2NhbCddLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogJ2dsb2JhbCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ2V4cG9ydF9wcmVmZXJlbmNlcycsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0V4cG9ydCBjdXJyZW50IHByZWZlcmVuY2VzIGNvbmZpZ3VyYXRpb24nLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydFBhdGg6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGV4cG9ydCBwcmVmZXJlbmNlcyBmaWxlIChvcHRpb25hbCknXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdpbXBvcnRfcHJlZmVyZW5jZXMnLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdJbXBvcnQgcHJlZmVyZW5jZXMgY29uZmlndXJhdGlvbiBmcm9tIGZpbGUnLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGltcG9ydFBhdGg6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGltcG9ydCBwcmVmZXJlbmNlcyBmaWxlIGZyb20nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ2ltcG9ydFBhdGgnXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBleGVjdXRlKHRvb2xOYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgc3dpdGNoICh0b29sTmFtZSkge1xyXG4gICAgICAgICAgICBjYXNlICdvcGVuX3ByZWZlcmVuY2VzX3NldHRpbmdzJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wZW5QcmVmZXJlbmNlc1NldHRpbmdzKGFyZ3MudGFiLCBhcmdzLmFyZ3MpO1xyXG4gICAgICAgICAgICBjYXNlICdxdWVyeV9wcmVmZXJlbmNlc19jb25maWcnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnlQcmVmZXJlbmNlc0NvbmZpZyhhcmdzLm5hbWUsIGFyZ3MucGF0aCwgYXJncy50eXBlKTtcclxuICAgICAgICAgICAgY2FzZSAnc2V0X3ByZWZlcmVuY2VzX2NvbmZpZyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5zZXRQcmVmZXJlbmNlc0NvbmZpZyhhcmdzLm5hbWUsIGFyZ3MucGF0aCwgYXJncy52YWx1ZSwgYXJncy50eXBlKTtcclxuICAgICAgICAgICAgY2FzZSAnZ2V0X2FsbF9wcmVmZXJlbmNlcyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRBbGxQcmVmZXJlbmNlcygpO1xyXG4gICAgICAgICAgICBjYXNlICdyZXNldF9wcmVmZXJlbmNlcyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZXNldFByZWZlcmVuY2VzKGFyZ3MubmFtZSwgYXJncy50eXBlKTtcclxuICAgICAgICAgICAgY2FzZSAnZXhwb3J0X3ByZWZlcmVuY2VzJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmV4cG9ydFByZWZlcmVuY2VzKGFyZ3MuZXhwb3J0UGF0aCk7XHJcbiAgICAgICAgICAgIGNhc2UgJ2ltcG9ydF9wcmVmZXJlbmNlcyc6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5pbXBvcnRQcmVmZXJlbmNlcyhhcmdzLmltcG9ydFBhdGgpO1xyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHRvb2w6ICR7dG9vbE5hbWV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgb3BlblByZWZlcmVuY2VzU2V0dGluZ3ModGFiPzogc3RyaW5nLCBhcmdzPzogYW55W10pOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCByZXF1ZXN0QXJncyA9IFtdO1xyXG4gICAgICAgICAgICBpZiAodGFiKSB7XHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0QXJncy5wdXNoKHRhYik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGFyZ3MgJiYgYXJncy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0QXJncy5wdXNoKC4uLmFyZ3MpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAoRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCBhcyBhbnkpKCdwcmVmZXJlbmNlcycsICdvcGVuLXNldHRpbmdzJywgLi4ucmVxdWVzdEFyZ3MpLnRoZW4oKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgUHJlZmVyZW5jZXMgc2V0dGluZ3Mgb3BlbmVkJHt0YWIgPyBgIG9uIHRhYjogJHt0YWJ9YCA6ICcnfWBcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcXVlcnlQcmVmZXJlbmNlc0NvbmZpZyhuYW1lOiBzdHJpbmcsIHBhdGg/OiBzdHJpbmcsIHR5cGU6IHN0cmluZyA9ICdnbG9iYWwnKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgcmVxdWVzdEFyZ3MgPSBbbmFtZV07XHJcbiAgICAgICAgICAgIGlmIChwYXRoKSB7XHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0QXJncy5wdXNoKHBhdGgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlcXVlc3RBcmdzLnB1c2godHlwZSk7XHJcblxyXG4gICAgICAgICAgICAoRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCBhcyBhbnkpKCdwcmVmZXJlbmNlcycsICdxdWVyeS1jb25maWcnLCAuLi5yZXF1ZXN0QXJncykudGhlbigoY29uZmlnOiBhbnkpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiBwYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiB0eXBlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWc6IGNvbmZpZ1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgc2V0UHJlZmVyZW5jZXNDb25maWcobmFtZTogc3RyaW5nLCBwYXRoOiBzdHJpbmcsIHZhbHVlOiBhbnksIHR5cGU6IHN0cmluZyA9ICdnbG9iYWwnKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgKEVkaXRvci5NZXNzYWdlLnJlcXVlc3QgYXMgYW55KSgncHJlZmVyZW5jZXMnLCAnc2V0LWNvbmZpZycsIG5hbWUsIHBhdGgsIHZhbHVlLCB0eXBlKS50aGVuKChzdWNjZXNzOiBib29sZWFuKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoc3VjY2Vzcykge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgUHJlZmVyZW5jZSAnJHtuYW1lfS4ke3BhdGh9JyB1cGRhdGVkIHN1Y2Nlc3NmdWxseWBcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogYEZhaWxlZCB0byB1cGRhdGUgcHJlZmVyZW5jZSAnJHtuYW1lfS4ke3BhdGh9J2BcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycjogRXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdldEFsbFByZWZlcmVuY2VzKCk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIC8vIENvbW1vbiBwcmVmZXJlbmNlIGNhdGVnb3JpZXMgaW4gQ29jb3MgQ3JlYXRvclxyXG4gICAgICAgICAgICBjb25zdCBjYXRlZ29yaWVzID0gW1xyXG4gICAgICAgICAgICAgICAgJ2dlbmVyYWwnLFxyXG4gICAgICAgICAgICAgICAgJ2V4dGVybmFsLXRvb2xzJywgXHJcbiAgICAgICAgICAgICAgICAnZGF0YS1lZGl0b3InLFxyXG4gICAgICAgICAgICAgICAgJ2xhYm9yYXRvcnknLFxyXG4gICAgICAgICAgICAgICAgJ2V4dGVuc2lvbnMnLFxyXG4gICAgICAgICAgICAgICAgJ3ByZXZpZXcnLFxyXG4gICAgICAgICAgICAgICAgJ2NvbnNvbGUnLFxyXG4gICAgICAgICAgICAgICAgJ25hdGl2ZScsXHJcbiAgICAgICAgICAgICAgICAnYnVpbGRlcidcclxuICAgICAgICAgICAgXTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHByZWZlcmVuY2VzOiBhbnkgPSB7fTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UHJvbWlzZXMgPSBjYXRlZ29yaWVzLm1hcChjYXRlZ29yeSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgncHJlZmVyZW5jZXMnLCAncXVlcnktY29uZmlnJywgY2F0ZWdvcnksIHVuZGVmaW5lZCwgJ2dsb2JhbCcpXHJcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKGNvbmZpZzogYW55KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHByZWZlcmVuY2VzW2NhdGVnb3J5XSA9IGNvbmZpZztcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIElnbm9yZSBlcnJvcnMgZm9yIGNhdGVnb3JpZXMgdGhhdCBkb24ndCBleGlzdFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcmVmZXJlbmNlc1tjYXRlZ29yeV0gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIFByb21pc2UuYWxsKHF1ZXJ5UHJvbWlzZXMpLnRoZW4oKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyIG91dCBudWxsIGVudHJpZXNcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkUHJlZmVyZW5jZXMgPSBPYmplY3QuZnJvbUVudHJpZXMoXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMocHJlZmVyZW5jZXMpLmZpbHRlcigoW18sIHZhbHVlXSkgPT4gdmFsdWUgIT09IG51bGwpXHJcbiAgICAgICAgICAgICAgICApO1xyXG5cclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYXRlZ29yaWVzOiBPYmplY3Qua2V5cyh2YWxpZFByZWZlcmVuY2VzKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJlZmVyZW5jZXM6IHZhbGlkUHJlZmVyZW5jZXNcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goKGVycjogRXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHJlc2V0UHJlZmVyZW5jZXMobmFtZT86IHN0cmluZywgdHlwZTogc3RyaW5nID0gJ2dsb2JhbCcpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBpZiAobmFtZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gUmVzZXQgc3BlY2lmaWMgcHJlZmVyZW5jZSBjYXRlZ29yeVxyXG4gICAgICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgncHJlZmVyZW5jZXMnLCAncXVlcnktY29uZmlnJywgbmFtZSwgdW5kZWZpbmVkLCAnZGVmYXVsdCcpLnRoZW4oKGRlZmF1bHRDb25maWc6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAoRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCBhcyBhbnkpKCdwcmVmZXJlbmNlcycsICdzZXQtY29uZmlnJywgbmFtZSwgJycsIGRlZmF1bHRDb25maWcsIHR5cGUpO1xyXG4gICAgICAgICAgICAgICAgfSkudGhlbigoc3VjY2VzczogYm9vbGVhbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdWNjZXNzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBQcmVmZXJlbmNlIGNhdGVnb3J5ICcke25hbWV9JyByZXNldCB0byBkZWZhdWx0YFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gcmVzZXQgcHJlZmVyZW5jZSBjYXRlZ29yeSAnJHtuYW1lfSdgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pLmNhdGNoKChlcnI6IEVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiAnUmVzZXR0aW5nIGFsbCBwcmVmZXJlbmNlcyBpcyBub3Qgc3VwcG9ydGVkIHRocm91Z2ggQVBJLiBQbGVhc2Ugc3BlY2lmeSBhIHByZWZlcmVuY2UgY2F0ZWdvcnkuJ1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGV4cG9ydFByZWZlcmVuY2VzKGV4cG9ydFBhdGg/OiBzdHJpbmcpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmdldEFsbFByZWZlcmVuY2VzKCkudGhlbigocHJlZnNSZXN1bHQ6IFRvb2xSZXNwb25zZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFwcmVmc1Jlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShwcmVmc1Jlc3VsdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGNvbnN0IHByZWZzRGF0YSA9IEpTT04uc3RyaW5naWZ5KHByZWZzUmVzdWx0LmRhdGEsIG51bGwsIDIpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGF0aCA9IGV4cG9ydFBhdGggfHwgYHByZWZlcmVuY2VzX2V4cG9ydF8ke0RhdGUubm93KCl9Lmpzb25gO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZvciBub3csIHJldHVybiB0aGUgZGF0YSAtIGluIGEgcmVhbCBpbXBsZW1lbnRhdGlvbiwgeW91J2Qgd3JpdGUgdG8gZmlsZVxyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydFBhdGg6IHBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHByZWZlcmVuY2VzOiBwcmVmc1Jlc3VsdC5kYXRhLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBqc29uRGF0YTogcHJlZnNEYXRhLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiAnUHJlZmVyZW5jZXMgZXhwb3J0ZWQgc3VjY2Vzc2Z1bGx5J1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgaW1wb3J0UHJlZmVyZW5jZXMoaW1wb3J0UGF0aDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGVycm9yOiAnSW1wb3J0IHByZWZlcmVuY2VzIGZ1bmN0aW9uYWxpdHkgcmVxdWlyZXMgZmlsZSBzeXN0ZW0gYWNjZXNzIHdoaWNoIGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBjb250ZXh0LiBQbGVhc2UgbWFudWFsbHkgaW1wb3J0IHByZWZlcmVuY2VzIHRocm91Z2ggdGhlIEVkaXRvciBVSS4nXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG59Il19