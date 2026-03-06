/**
 * MCP configuration loader and validator.
 * Reads data/mcp-servers.json and validates with Zod.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '@nanogemclaw/core';
import type { McpServerConfig, McpServersConfig } from './mcp-types.js';

const SERVER_ID_RE = /^[a-z0-9_]+$/;

const McpServerConfigSchema = z.object({
    id: z.string().regex(SERVER_ID_RE, 'Server ID must match /^[a-z0-9_]+$/'),
    name: z.string().min(1),
    transport: z.enum(['stdio', 'sse']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional(),
    permission: z.enum(['main', 'any']),
    enabled: z.boolean(),
    timeout: z.number().positive().optional(),
    autoReconnect: z.boolean().optional(),
    allowedTools: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
    if (data.transport === 'stdio' && !data.command) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'stdio transport requires "command" field',
            path: ['command'],
        });
    }
    if (data.transport === 'sse' && !data.url) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'sse transport requires "url" field',
            path: ['url'],
        });
    }
});

const McpServersConfigSchema = z.object({
    servers: z.array(McpServerConfigSchema),
});

export function loadMcpConfig(dataDir: string): McpServersConfig {
    const configPath = path.join(dataDir, 'mcp-servers.json');

    if (!fs.existsSync(configPath)) {
        logger.debug({ configPath }, 'No mcp-servers.json found, MCP disabled');
        return { servers: [] };
    }

    let raw: unknown;
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        raw = JSON.parse(content);
    } catch (err) {
        logger.error({ err, configPath }, 'Failed to parse mcp-servers.json');
        return { servers: [] };
    }

    return validateMcpConfig(raw);
}

export function saveMcpConfig(dataDir: string, config: McpServersConfig): void {
    const configPath = path.join(dataDir, 'mcp-servers.json');
    const tmpPath = `${configPath}.tmp`;
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, configPath);
}

/**
 * One-time migration: for servers with allowedTools === undefined,
 * populate allowedTools with all known tools from the running bridge.
 * Call this after bridges are initialized.
 */
export function migrateAllowedTools(
    config: McpServersConfig,
    getServerTools: (serverId: string) => string[],
    dataDir: string,
): McpServersConfig {
    let changed = false;

    const migratedServers = config.servers.map((server) => {
        if (server.allowedTools !== undefined) {
            // Already has explicit allowedTools — no-op
            return server;
        }
        // allowedTools undefined = pre-upgrade server: auto-populate with all current tools
        const tools = getServerTools(server.id);
        changed = true;
        logger.info(
            { serverId: server.id, toolCount: tools.length },
            'Migrating allowedTools for existing MCP server',
        );
        return { ...server, allowedTools: tools };
    });

    const migrated: McpServersConfig = { servers: migratedServers };

    if (changed) {
        saveMcpConfig(dataDir, migrated);
    }

    return migrated;
}

export function validateMcpConfig(raw: unknown): McpServersConfig {
    const result = McpServersConfigSchema.safeParse(raw);
    if (!result.success) {
        logger.error({ errors: result.error.issues }, 'Invalid MCP config');
        return { servers: [] };
    }

    // Filter invalid servers and log warnings
    const validServers: McpServerConfig[] = [];
    const seenIds = new Set<string>();

    for (const server of result.data.servers) {
        if (seenIds.has(server.id)) {
            logger.warn({ serverId: server.id }, 'Duplicate MCP server ID, skipping');
            continue;
        }
        seenIds.add(server.id);
        validServers.push(server as McpServerConfig);
    }

    return { servers: validServers };
}
