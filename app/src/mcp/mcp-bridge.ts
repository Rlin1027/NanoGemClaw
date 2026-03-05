/**
 * MCP Client Bridge
 *
 * Manages a connection to a single MCP server, converts its tools to
 * GeminiToolContribution format, and forwards tool calls.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '@nanogemclaw/core';
import type { GeminiToolContribution, ToolExecutionContext } from '@nanogemclaw/plugin-api';
import type { McpServerConfig, McpConnectionState } from './mcp-types.js';

// Dynamic import path for cache invalidation (avoids circular import at module load)
const GEMINI_TOOLS_PATH = '../../../src/gemini-tools.js';

interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

/**
 * Converts MCP JSON Schema to Gemini FunctionDeclaration parameters format.
 * Returns a minimal OBJECT schema on failure.
 */
function convertMcpSchemaToGemini(inputSchema?: Record<string, unknown>): Record<string, unknown> {
    if (!inputSchema || typeof inputSchema !== 'object') {
        return { type: 'OBJECT', properties: {} };
    }

    try {
        return convertJsonSchema(inputSchema);
    } catch {
        return { type: 'OBJECT', properties: {} };
    }
}

function convertJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const type = schema.type as string | undefined;

    if (type === 'object' || (!type && schema.properties)) {
        const props = schema.properties as Record<string, unknown> | undefined;
        const convertedProps: Record<string, unknown> = {};

        if (props) {
            for (const [key, val] of Object.entries(props)) {
                convertedProps[key] = convertJsonSchema(val as Record<string, unknown>);
            }
        }

        const result: Record<string, unknown> = {
            type: 'OBJECT',
            properties: convertedProps,
        };

        if (Array.isArray(schema.required) && schema.required.length > 0) {
            result.required = schema.required;
        }

        if (schema.description) {
            result.description = schema.description;
        }

        return result;
    }

    if (type === 'string') {
        const result: Record<string, unknown> = { type: 'STRING' };
        if (schema.description) result.description = schema.description;
        if (Array.isArray(schema.enum)) result.enum = schema.enum;
        return result;
    }

    if (type === 'number' || type === 'integer') {
        const result: Record<string, unknown> = { type: 'NUMBER' };
        if (schema.description) result.description = schema.description;
        return result;
    }

    if (type === 'boolean') {
        const result: Record<string, unknown> = { type: 'BOOLEAN' };
        if (schema.description) result.description = schema.description;
        return result;
    }

    if (type === 'array') {
        const items = schema.items as Record<string, unknown> | undefined;
        const result: Record<string, unknown> = {
            type: 'ARRAY',
            items: items ? convertJsonSchema(items) : { type: 'STRING' },
        };
        if (schema.description) result.description = schema.description;
        return result;
    }

    // Fallback for unsupported types
    return { type: 'STRING' };
}

export class McpBridge {
    private config: McpServerConfig;
    private client: Client | null = null;
    private transport: StdioClientTransport | SSEClientTransport | null = null;
    private state: McpConnectionState = 'disconnected';
    private mcpTools: McpTool[] = [];
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_DELAY = 30000;

    /** Track spawned stdio process PID for cleanup */
    private stdioPid: number | null = null;
    private processExitHandler: (() => void) | null = null;

    constructor(config: McpServerConfig) {
        this.config = config;
    }

    getState(): McpConnectionState {
        return this.state;
    }

    async connect(): Promise<void> {
        if (this.state === 'connecting' || this.state === 'connected') {
            return;
        }

        this.state = 'connecting';
        logger.info({ serverId: this.config.id }, 'Connecting to MCP server');

        try {
            this.client = new Client(
                { name: 'nanogemclaw', version: '1.0.0' },
                { capabilities: {} },
            );

            const timeout = this.config.timeout ?? 10000;

            if (this.config.transport === 'stdio') {
                const transport = new StdioClientTransport({
                    command: this.config.command!,
                    args: this.config.args,
                    env: this.config.env,
                });

                // Connect with timeout
                await Promise.race([
                    this.client.connect(transport),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout),
                    ),
                ]);

                this.transport = transport;

                // Track PID for cleanup
                this.stdioPid = transport.pid;

                // Register exit handler for synchronous SIGKILL fallback
                this.processExitHandler = () => this.killAllChildProcessesSync();
                process.on('exit', this.processExitHandler);

            } else {
                // SSE transport
                const url = new URL(this.config.url!);
                const transport = new SSEClientTransport(url);

                await Promise.race([
                    this.client.connect(transport),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout),
                    ),
                ]);

                this.transport = transport;
            }

            // Fetch tool list
            const toolsResult = await this.client.listTools();
            this.mcpTools = toolsResult.tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema as Record<string, unknown> | undefined,
            }));

            this.state = 'connected';
            this.reconnectAttempts = 0;

            logger.info(
                { serverId: this.config.id, toolCount: this.mcpTools.length },
                'MCP server connected',
            );

            // Invalidate declaration cache so new tools appear
            try {
                const { clearDeclarationCache } = await import(GEMINI_TOOLS_PATH);
                clearDeclarationCache();
            } catch {
                // Non-fatal: cache will be rebuilt on next access
            }

        } catch (err) {
            this.state = 'error';
            logger.error({ err, serverId: this.config.id }, 'MCP server connection failed');

            // Schedule reconnect if enabled
            if (this.config.autoReconnect !== false) {
                this.scheduleReconnect();
            }
        }
    }

    async disconnect(): Promise<void> {
        // Cancel any pending reconnect
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        const prevState = this.state;
        this.state = 'disconnected';
        this.mcpTools = [];

        // Close MCP client
        if (this.client) {
            try {
                await this.client.close();
            } catch (err) {
                logger.warn({ err, serverId: this.config.id }, 'Error closing MCP client');
            }
            this.client = null;
        }

        // Gracefully kill stdio child process
        if (this.config.transport === 'stdio' && this.stdioPid !== null) {
            await this.gracefulKillPid(this.stdioPid, this.config.id);
            this.stdioPid = null;
        }

        // Remove global exit handler
        if (this.processExitHandler) {
            process.removeListener('exit', this.processExitHandler);
            this.processExitHandler = null;
        }

        this.transport = null;

        if (prevState === 'connected') {
            logger.info({ serverId: this.config.id }, 'MCP server disconnected');

            // Invalidate declaration cache
            try {
                const { clearDeclarationCache } = await import(GEMINI_TOOLS_PATH);
                clearDeclarationCache();
            } catch {
                // Non-fatal
            }
        }
    }

    /**
     * Returns Gemini-compatible tool declarations.
     * Each execute() is a closure capturing this bridge instance.
     */
    getToolDeclarations(): GeminiToolContribution[] {
        if (this.state !== 'connected') {
            return [];
        }

        const bridge = this;

        return this.mcpTools.map((mcpTool) => {
            const prefixedName = `mcp_${bridge.config.id}_${mcpTool.name}`;

            return {
                name: prefixedName,
                description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
                parameters: convertMcpSchemaToGemini(mcpTool.inputSchema),
                permission: bridge.config.permission,
                metadata: {
                    readOnly: false,
                    requiresExplicitIntent: false,
                    dangerLevel: 'moderate' as const,
                },
                execute: async (
                    args: Record<string, unknown>,
                    ctx: ToolExecutionContext,
                ): Promise<string> => {
                    if (bridge.getState() !== 'connected') {
                        return JSON.stringify({
                            success: false,
                            error: `MCP server '${bridge.config.id}' is not connected`,
                        });
                    }
                    return bridge.executeTool(mcpTool.name, args, ctx);
                },
            };
        });
    }

    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        _context: ToolExecutionContext,
    ): Promise<string> {
        if (!this.client || this.state !== 'connected') {
            return JSON.stringify({
                success: false,
                error: `MCP server '${this.config.id}' is not connected`,
            });
        }

        try {
            const result = await Promise.race([
                this.client.callTool({ name: toolName, arguments: args }),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Tool execution timeout (30s)')),
                        30000,
                    ),
                ),
            ]);

            // MCP callTool returns { content: [...], isError?: boolean }
            const content = (result as { content?: unknown[]; isError?: boolean }).content ?? [];
            const isError = (result as { isError?: boolean }).isError ?? false;

            // Extract text content
            const text = content
                .filter((c): c is { type: string; text: string } =>
                    typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text',
                )
                .map((c) => c.text)
                .join('\n');

            if (isError) {
                return JSON.stringify({ success: false, error: text || 'Tool returned an error' });
            }

            return JSON.stringify({ success: true, data: { text } });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(
                { err: msg, toolName, serverId: this.config.id },
                'MCP tool execution failed',
            );
            return JSON.stringify({ success: false, error: msg });
        }
    }

    private scheduleReconnect(): void {
        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            this.MAX_RECONNECT_DELAY,
        );
        this.reconnectAttempts++;

        logger.info(
            { serverId: this.config.id, delayMs: delay, attempt: this.reconnectAttempts },
            'Scheduling MCP reconnect',
        );

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.state = 'disconnected';
            this.connect().catch((err) => {
                logger.error({ err, serverId: this.config.id }, 'MCP reconnect failed');
            });
        }, delay);
    }

    private async gracefulKillPid(pid: number, id: string): Promise<void> {
        return new Promise<void>((resolve) => {
            let killed = false;

            const timeout = setTimeout(() => {
                if (!killed) {
                    logger.warn(
                        { serverId: id, pid },
                        'MCP child process did not exit after SIGTERM, sending SIGKILL',
                    );
                    try {
                        process.kill(pid, 'SIGKILL');
                    } catch {
                        // Process may have already exited
                    }
                    resolve();
                }
            }, 5000);

            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                // Process may have already exited
                killed = true;
                clearTimeout(timeout);
                resolve();
                return;
            }

            // Poll for process exit
            const checkInterval = setInterval(() => {
                try {
                    // Signal 0 checks if process exists
                    process.kill(pid, 0);
                } catch {
                    // Process no longer exists
                    killed = true;
                    clearInterval(checkInterval);
                    clearTimeout(timeout);
                    resolve();
                }
            }, 100);
        });
    }

    /** Synchronous kill for process.on('exit') handler — cannot use async */
    private killAllChildProcessesSync(): void {
        if (this.stdioPid !== null) {
            try {
                process.kill(this.stdioPid, 'SIGKILL');
            } catch {
                // Process may have already exited
            }
        }
    }
}
