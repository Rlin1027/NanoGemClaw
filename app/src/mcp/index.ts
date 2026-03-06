/**
 * MCP Plugin Factory
 *
 * Creates a NanoPlugin that manages MCP server connections and exposes
 * their tools as Gemini function declarations.
 */

import { logger } from '@nanogemclaw/core';
import type { NanoPlugin, PluginApi, GeminiToolContribution } from '@nanogemclaw/plugin-api';
import { McpBridge } from './mcp-bridge.js';
import { loadMcpConfig, migrateAllowedTools } from './mcp-config.js';
import type { McpServerConfig } from './mcp-types.js';

export { McpBridge } from './mcp-bridge.js';
export { loadMcpConfig, validateMcpConfig, saveMcpConfig, migrateAllowedTools } from './mcp-config.js';
export type { McpServerConfig, McpServersConfig, McpConnectionState } from './mcp-types.js';

/** Active bridges keyed by server ID */
const bridges = new Map<string, McpBridge>();

/**
 * Get all active bridges for status inspection.
 */
export function getBridges(): Map<string, McpBridge> {
    return bridges;
}

/**
 * Add a new server config and connect a bridge for it.
 */
export async function addServer(config: McpServerConfig, dataDir: string): Promise<void> {
    const { saveMcpConfig: save, loadMcpConfig: load } = await import('./mcp-config.js');
    const current = load(dataDir);
    current.servers.push(config);
    save(dataDir, current);

    if (config.enabled) {
        const bridge = new McpBridge(config);
        bridges.set(config.id, bridge);
        await bridge.connect();
    }
}

/**
 * Remove a server by ID — disconnect bridge and update config.
 */
export async function removeServer(id: string, dataDir: string): Promise<boolean> {
    const { saveMcpConfig: save, loadMcpConfig: load } = await import('./mcp-config.js');
    const current = load(dataDir);
    const idx = current.servers.findIndex((s) => s.id === id);
    if (idx === -1) return false;

    current.servers.splice(idx, 1);
    save(dataDir, current);

    const bridge = bridges.get(id);
    if (bridge) {
        await bridge.disconnect();
        bridges.delete(id);
    }
    return true;
}

/**
 * Toggle enabled state for a server and connect/disconnect accordingly.
 */
export async function toggleServer(id: string, enabled: boolean, dataDir: string): Promise<boolean> {
    const { saveMcpConfig: save, loadMcpConfig: load } = await import('./mcp-config.js');
    const current = load(dataDir);
    const server = current.servers.find((s) => s.id === id);
    if (!server) return false;

    server.enabled = enabled;
    save(dataDir, current);

    if (enabled) {
        const bridge = new McpBridge(server);
        bridges.set(id, bridge);
        await bridge.connect();
    } else {
        const bridge = bridges.get(id);
        if (bridge) {
            await bridge.disconnect();
            bridges.delete(id);
        }
    }
    return true;
}

/**
 * Update the allowed tools whitelist for a server and hot-reload.
 * Returns true if the server was found, false otherwise.
 */
export async function updateAllowedTools(id: string, allowedTools: string[], dataDir: string): Promise<boolean> {
    const { saveMcpConfig: save, loadMcpConfig: load } = await import('./mcp-config.js');
    const current = load(dataDir);
    const server = current.servers.find((s) => s.id === id);
    if (!server) return false;

    server.allowedTools = allowedTools;
    save(dataDir, current);

    const bridge = bridges.get(id);
    if (bridge) {
        bridge.updateAllowedTools(allowedTools);
    }
    return true;
}

/**
 * Get raw (unfiltered) tools for a server by ID.
 * Returns empty array if server has no active bridge.
 */
export function getRawTools(id: string): { name: string; description?: string }[] {
    const bridge = bridges.get(id);
    if (!bridge) return [];
    return bridge.getRawTools();
}

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

            // One-time migration: populate allowedTools for pre-upgrade servers
            const config = loadMcpConfig(dataDir);
            migrateAllowedTools(
                config,
                (serverId) => {
                    const bridge = bridges.get(serverId);
                    return bridge ? bridge.getRawTools().map((t) => t.name) : [];
                },
                dataDir,
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
