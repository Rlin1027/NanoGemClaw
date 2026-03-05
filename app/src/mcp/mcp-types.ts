/**
 * MCP (Model Context Protocol) configuration types.
 */

export interface McpServerConfig {
    /** Unique server identifier (used in tool name prefix). Must match /^[a-z0-9_]+$/ */
    id: string;
    /** Human-readable name */
    name: string;
    /** Transport type */
    transport: 'stdio' | 'sse';
    /** For stdio: command to spawn */
    command?: string;
    /** For stdio: command arguments */
    args?: string[];
    /** For stdio: environment variables */
    env?: Record<string, string>;
    /** For SSE: server URL */
    url?: string;
    /** Permission level for all tools from this server */
    permission: 'main' | 'any';
    /** Whether this server is enabled */
    enabled: boolean;
    /** Connection timeout in ms (default: 10000) */
    timeout?: number;
    /** Auto-reconnect on disconnect (default: true) */
    autoReconnect?: boolean;
}

export interface McpServersConfig {
    servers: McpServerConfig[];
}

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
