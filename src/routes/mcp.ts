import { Router } from 'express';
import { z } from 'zod';

const SERVER_ID_RE = /^[a-z0-9_]+$/;

const McpServerConfigSchema = z
  .object({
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
  })
  .superRefine((data, ctx) => {
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

/** Serialized MCP server info for API responses */
interface McpServerInfo {
  id: string;
  name: string;
  transport: string;
  connectionState: string;
  tools: { name: string; description: string }[];
  [key: string]: unknown;
}

/** Dependencies injected by server.ts — no direct app/ imports */
export interface McpRouterDeps {
  getBridges: () => Map<
    string,
    {
      getState(): string;
      getToolDeclarations(): { name: string; description: string }[];
    }
  >;
  addServer: (config: unknown) => Promise<void>;
  removeServer: (id: string) => Promise<boolean>;
  toggleServer: (id: string, enabled: boolean) => Promise<boolean>;
  reconnectServer: (id: string) => Promise<void>;
  loadConfig: () => { servers: Record<string, unknown>[] };
  saveConfig: (config: { servers: Record<string, unknown>[] }) => void;
}

function serializeServer(
  config: Record<string, unknown>,
  bridge:
    | {
        getState(): string;
        getToolDeclarations(): { name: string; description: string }[];
      }
    | undefined,
): McpServerInfo {
  const state = bridge ? bridge.getState() : 'disconnected';
  const tools = bridge
    ? bridge
        .getToolDeclarations()
        .map((t) => ({ name: t.name, description: t.description }))
    : [];
  return {
    ...(config as object),
    connectionState: state,
    tools,
  } as McpServerInfo;
}

export function createMcpRouter(deps: McpRouterDeps): Router {
  const router = Router();

  // GET /api/mcp/servers
  router.get('/mcp/servers', (_req, res) => {
    try {
      const config = deps.loadConfig();
      const bridgeMap = deps.getBridges();
      const data = config.servers.map((s: any) =>
        serializeServer(s, bridgeMap.get(s.id)),
      );
      res.json({ data });
    } catch {
      res.status(500).json({ error: 'Failed to list MCP servers' });
    }
  });

  // POST /api/mcp/servers
  router.post('/mcp/servers', async (req, res) => {
    const parsed = McpServerConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid server config', details: parsed.error.issues });
      return;
    }

    // Check for duplicate ID
    const existing = deps.loadConfig();
    if (existing.servers.some((s: any) => s.id === parsed.data.id)) {
      res
        .status(409)
        .json({ error: `Server with id '${parsed.data.id}' already exists` });
      return;
    }

    try {
      await deps.addServer(parsed.data);
      const bridge = deps.getBridges().get(parsed.data.id);
      res
        .status(201)
        .json({ data: serializeServer(parsed.data as any, bridge) });
    } catch {
      res.status(500).json({ error: 'Failed to add MCP server' });
    }
  });

  // PUT /api/mcp/servers/:id
  router.put('/mcp/servers/:id', async (req, res) => {
    const { id } = req.params;
    if (!SERVER_ID_RE.test(id)) {
      res.status(400).json({ error: 'Invalid server ID' });
      return;
    }

    const current = deps.loadConfig();
    const idx = current.servers.findIndex((s: any) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }

    // id is immutable — merge everything except id
    const body = { ...req.body, id };
    const parsed = McpServerConfigSchema.safeParse(body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid server config', details: parsed.error.issues });
      return;
    }

    try {
      current.servers[idx] = parsed.data as any;
      deps.saveConfig(current);
      // Reconnect with updated config
      await deps.reconnectServer(id);
      const bridge = deps.getBridges().get(id);
      res.json({ data: serializeServer(parsed.data as any, bridge) });
    } catch {
      res.status(500).json({ error: 'Failed to update MCP server' });
    }
  });

  // DELETE /api/mcp/servers/:id
  router.delete('/mcp/servers/:id', async (req, res) => {
    const { id } = req.params;
    if (!SERVER_ID_RE.test(id)) {
      res.status(400).json({ error: 'Invalid server ID' });
      return;
    }

    try {
      const removed = await deps.removeServer(id);
      if (!removed) {
        res.status(404).json({ error: 'MCP server not found' });
        return;
      }
      res.json({ data: { success: true } });
    } catch {
      res.status(500).json({ error: 'Failed to remove MCP server' });
    }
  });

  // POST /api/mcp/servers/:id/reconnect
  router.post('/mcp/servers/:id/reconnect', async (req, res) => {
    const { id } = req.params;
    if (!SERVER_ID_RE.test(id)) {
      res.status(400).json({ error: 'Invalid server ID' });
      return;
    }

    const config = deps.loadConfig();
    const serverConfig = config.servers.find((s: any) => s.id === id);
    if (!serverConfig) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }

    try {
      await deps.reconnectServer(id);
      const bridge = deps.getBridges().get(id);
      res.json({ data: serializeServer(serverConfig, bridge) });
    } catch {
      res.status(500).json({ error: 'Failed to reconnect MCP server' });
    }
  });

  return router;
}
