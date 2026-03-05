/**
 * MCP Plugin Factory
 *
 * Creates a NanoPlugin that manages MCP server connections and exposes
 * their tools as Gemini function declarations.
 */

import { logger } from '@nanogemclaw/core';
import type { NanoPlugin, PluginApi, GeminiToolContribution } from '@nanogemclaw/plugin-api';
import { McpBridge } from './mcp-bridge.js';
import { loadMcpConfig } from './mcp-config.js';
import type { McpServerConfig } from './mcp-types.js';

export { McpBridge } from './mcp-bridge.js';
export { loadMcpConfig, validateMcpConfig } from './mcp-config.js';
export type { McpServerConfig, McpServersConfig, McpConnectionState } from './mcp-types.js';

/** Active bridges keyed by server ID */
const bridges = new Map<string, McpBridge>();

/**
 * Get all tool declarations from all connected MCP bridges.
 * Called by the declaration builder to include MCP tools.
 */
export function getMcpToolDeclarations(): GeminiToolContribution[] {
    const tools: GeminiToolContribution[] = [];
    for (const bridge of bridges.values()) {
        tools.push(...bridge.getToolDeclarations());
    }
    return tools;
}

/**
 * Factory function that creates the MCP internal plugin.
 * The returned plugin participates in the NanoPlugin lifecycle.
 */
export function createMcpPlugin(dataDir: string): NanoPlugin & { builtin: true } {
    let enabledServers: McpServerConfig[] = [];

    return {
        id: 'builtin-mcp-bridge',
        name: 'Built-in MCP Bridge',
        version: '1.0.0',
        description: 'Connects to external MCP servers and exposes their tools as Gemini functions',
        builtin: true as const,

        async init(_api: PluginApi): Promise<void> {
            const config = loadMcpConfig(dataDir);
            enabledServers = config.servers.filter((s) => s.enabled);

            if (enabledServers.length === 0) {
                logger.debug('No enabled MCP servers configured');
                return;
            }

            logger.info({ count: enabledServers.length }, 'MCP plugin initialized');
        },

        async start(_api: PluginApi): Promise<void> {
            if (enabledServers.length === 0) return;

            // Connect to all servers in parallel (failures are isolated)
            await Promise.allSettled(
                enabledServers.map(async (serverConfig) => {
                    const bridge = new McpBridge(serverConfig);
                    bridges.set(serverConfig.id, bridge);
                    try {
                        await bridge.connect();
                    } catch (err) {
                        logger.error(
                            { err, serverId: serverConfig.id },
                            'MCP bridge connect failed during start',
                        );
                    }
                }),
            );

            const connectedCount = [...bridges.values()].filter(
                (b) => b.getState() === 'connected',
            ).length;

            logger.info(
                { total: bridges.size, connected: connectedCount },
                'MCP bridges started',
            );
        },

        async stop(_api: PluginApi): Promise<void> {
            // Disconnect all bridges in parallel
            await Promise.allSettled(
                [...bridges.values()].map((bridge) => bridge.disconnect()),
            );
            bridges.clear();
            logger.info('MCP bridges stopped');
        },
    };
}
