export interface MCPServerSettings {
    port: number;
    autoStart: boolean;
    enableDebugLog: boolean;
    /**
     * Allowed `Origin` header values for the Streamable HTTP transport. Used as
     * a DNS-rebinding mitigation. `['*']` disables the check.
     */
    allowedOrigins: string[];
    maxConnections: number;
    /**
     * Optional shared secret. When set, every HTTP request to `/mcp` must
     * carry `Authorization: ******; SSE connections too.
     */
    authToken?: string;
    /**
     * Comma‑separated list of allowed Host headers. `localhost` and `127.0.0.1`
     * are always permitted regardless of this list.
     */
    allowedHosts?: string[];
    /**
     * Default minimum log level for `notifications/message` (RFC 5424 levels).
     */
    logLevel?: McpLogLevel;
    /**
     * Maximum number of tools per `tools/list` page. Defaults to 100.
     */
    toolsPageSize?: number;
}

/** RFC 5424 syslog severity levels accepted by MCP `logging/setLevel`. */
export type McpLogLevel =
    | 'debug'
    | 'info'
    | 'notice'
    | 'warning'
    | 'error'
    | 'critical'
    | 'alert'
    | 'emergency';

export interface ServerStatus {
    running: boolean;
    port: number;
    clients: number;
}

export interface ToolAnnotations {
    /** Human‑readable title shown in clients. */
    title?: string;
    /** Tool only reads state and never mutates the editor / project. */
    readOnlyHint?: boolean;
    /** Tool may delete or irreversibly modify state. */
    destructiveHint?: boolean;
    /** Calling the tool repeatedly with the same args produces the same effect. */
    idempotentHint?: boolean;
    /** Tool can interact with arbitrary external resources (network, FS outside project). */
    openWorldHint?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
    /** JSON Schema for the structured result (MCP 2025‑06‑18 `outputSchema`). */
    outputSchema?: any;
    /** Behaviour hints surfaced to clients (MCP 2025‑03‑26 `annotations`). */
    annotations?: ToolAnnotations;
}

export interface ToolResponse {
    success: boolean;
    data?: any;
    message?: string;
    error?: string;
    instruction?: string;
    warning?: string;
    verificationData?: any;
    updatedProperties?: string[];
}

export interface NodeInfo {
    uuid: string;
    name: string;
    active: boolean;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    parent?: string;
    children?: string[];
    components?: ComponentInfo[];
    layer?: number;
    mobility?: number;
}

export interface ComponentInfo {
    type: string;
    enabled: boolean;
    properties?: Record<string, any>;
}

export interface SceneInfo {
    name: string;
    uuid: string;
    path: string;
}

export interface PrefabInfo {
    name: string;
    uuid: string;
    path: string;
    folder: string;
    createTime?: string;
    modifyTime?: string;
    dependencies?: string[];
}

export interface AssetInfo {
    name: string;
    uuid: string;
    path: string;
    type: string;
    size?: number;
    isDirectory: boolean;
    meta?: {
        ver: string;
        importer: string;
    };
}

export interface ProjectInfo {
    name: string;
    path: string;
    uuid: string;
    version: string;
    cocosVersion: string;
}

export interface ConsoleMessage {
    timestamp: string;
    type: 'log' | 'warn' | 'error' | 'info';
    message: string;
    stack?: string;
}

export interface PerformanceStats {
    nodeCount: number;
    componentCount: number;
    drawCalls: number;
    triangles: number;
    memory: Record<string, any>;
}

export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    details?: any;
    suggestion?: string;
}

export interface ValidationResult {
    valid: boolean;
    issueCount: number;
    issues: ValidationIssue[];
}

export interface MCPClient {
    id: string;
    lastActivity: Date;
    userAgent?: string;
}

// -- MCP resources / prompts / sampling (Phase 2) ---------------------------

/** A static resource exposed via `resources/list` (MCP 2025-06-18). */
export interface McpResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    /** Hint for clients about the cost of reading. */
    size?: number;
}

/** A URI-template resource exposed via `resources/templates/list`. */
export interface McpResourceTemplate {
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
}

/** Result returned by `resources/read`. */
export interface McpResourceContents {
    /** One entry per concrete resource matched by the URI. */
    contents: Array<{
        uri: string;
        mimeType?: string;
        /** UTF-8 text payload. Mutually exclusive with `blob`. */
        text?: string;
        /** Base64-encoded payload. Mutually exclusive with `text`. */
        blob?: string;
    }>;
}

/** A prompt template exposed via `prompts/list`. */
export interface McpPrompt {
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}

/** Single message inside a prompt expansion. */
export interface McpPromptMessage {
    role: 'user' | 'assistant' | 'system';
    content:
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
        | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } };
}

/** Result returned by `prompts/get`. */
export interface McpPromptExpansion {
    description?: string;
    messages: McpPromptMessage[];
}

/** Argument shape for `sampling/createMessage` (server → client request). */
export interface McpSamplingRequest {
    messages: Array<{
        role: 'user' | 'assistant';
        content: { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
    }>;
    modelPreferences?: {
        hints?: Array<{ name?: string }>;
        costPriority?: number;
        speedPriority?: number;
        intelligencePriority?: number;
    };
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    metadata?: Record<string, any>;
}

export interface ToolExecutor {
    getTools(): ToolDefinition[];
    execute(toolName: string, args: any, ctx?: any): Promise<ToolResponse>;
}

// Interfaces related to tool configuration management.
export interface ToolConfig {
    category: string;
    name: string;
    enabled: boolean;
    description: string;
}

export interface ToolConfiguration {
    id: string;
    name: string;
    description?: string;
    tools: ToolConfig[];
    createdAt: string;
    updatedAt: string;
}

export interface ToolManagerSettings {
    configurations: ToolConfiguration[];
    currentConfigId: string;
    maxConfigSlots: number;
}

export interface ToolManagerState {
    availableTools: ToolConfig[];
    currentConfiguration: ToolConfiguration | null;
    configurations: ToolConfiguration[];
}