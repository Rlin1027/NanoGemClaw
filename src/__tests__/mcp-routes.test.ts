import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMcpRouter } from '../routes/mcp.js';
import type { McpRouterDeps } from '../routes/mcp.js';

// Minimal bridge mock
function makeBridge(state: string = 'connected', tools: { name: string; description: string }[] = []) {
  return {
    getState: vi.fn(() => state),
    getToolDeclarations: vi.fn(() => tools),
  };
}

function makeApp(deps: McpRouterDeps) {
  const app = express();
  app.use(express.json());
  app.use('/api', createMcpRouter(deps));
  return app;
}

const baseServer = {
  id: 'test_server',
  name: 'Test Server',
  transport: 'stdio' as const,
  command: 'echo',
  permission: 'any' as const,
  enabled: true,
};

describe('MCP Routes', () => {
  let bridgeMap: Map<string, ReturnType<typeof makeBridge>>;
  let config: { servers: Record<string, unknown>[] };
  let deps: McpRouterDeps;

  beforeEach(() => {
    bridgeMap = new Map();
    config = { servers: [{ ...baseServer }] };

    deps = {
      getBridges: () => bridgeMap as any,
      addServer: vi.fn(async (cfg: unknown) => {
        config.servers.push(cfg as Record<string, unknown>);
      }),
      removeServer: vi.fn(async (id: string) => {
        const idx = config.servers.findIndex((s: any) => s.id === id);
        if (idx === -1) return false;
        config.servers.splice(idx, 1);
        return true;
      }),
      toggleServer: vi.fn(async () => true),
      reconnectServer: vi.fn(async () => {}),
      loadConfig: vi.fn(() => ({ ...config })),
      saveConfig: vi.fn((c: any) => { config = c; }),
    };
  });

  // ── GET /api/mcp/servers ─────────────────────────────────────────────────

  describe('GET /api/mcp/servers', () => {
    it('returns list with disconnected state when no bridge', async () => {
      const app = makeApp(deps);
      const res = await request(app).get('/api/mcp/servers');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('test_server');
      expect(res.body.data[0].connectionState).toBe('disconnected');
      expect(res.body.data[0].tools).toEqual([]);
    });

    it('returns connected state and tools when bridge exists', async () => {
      bridgeMap.set('test_server', makeBridge('connected', [{ name: 'mcp_test_server_foo', description: 'Foo tool' }]));
      const app = makeApp(deps);
      const res = await request(app).get('/api/mcp/servers');
      expect(res.status).toBe(200);
      expect(res.body.data[0].connectionState).toBe('connected');
      expect(res.body.data[0].tools).toHaveLength(1);
      expect(res.body.data[0].tools[0].name).toBe('mcp_test_server_foo');
    });
  });

  // ── POST /api/mcp/servers ────────────────────────────────────────────────

  describe('POST /api/mcp/servers', () => {
    it('adds a valid stdio server and returns 201', async () => {
      config.servers = [];
      (deps.loadConfig as any).mockReturnValue({ servers: [] });
      const app = makeApp(deps);
      const newServer = {
        id: 'new_server',
        name: 'New Server',
        transport: 'stdio',
        command: 'node',
        permission: 'any',
        enabled: true,
      };
      const res = await request(app).post('/api/mcp/servers').send(newServer);
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('new_server');
      expect(deps.addServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'new_server' }));
    });

    it('returns 400 for invalid config (missing command for stdio)', async () => {
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers').send({
        id: 'bad_server',
        name: 'Bad',
        transport: 'stdio',
        permission: 'any',
        enabled: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid/i);
      expect(res.body.details).toBeDefined();
    });

    it('returns 400 for invalid server ID format', async () => {
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers').send({
        id: 'INVALID-ID',
        name: 'Bad',
        transport: 'stdio',
        command: 'echo',
        permission: 'any',
        enabled: true,
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate server ID', async () => {
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers').send({ ...baseServer });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it('returns 400 for missing url on sse transport', async () => {
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers').send({
        id: 'sse_server',
        name: 'SSE',
        transport: 'sse',
        permission: 'any',
        enabled: true,
      });
      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/mcp/servers/:id ─────────────────────────────────────────────

  describe('PUT /api/mcp/servers/:id', () => {
    it('updates a server and returns updated config', async () => {
      const app = makeApp(deps);
      const res = await request(app)
        .put('/api/mcp/servers/test_server')
        .send({ ...baseServer, name: 'Updated Name' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
      expect(res.body.data.id).toBe('test_server');
      expect(deps.saveConfig).toHaveBeenCalled();
    });

    it('returns 404 for unknown server', async () => {
      const app = makeApp(deps);
      const res = await request(app)
        .put('/api/mcp/servers/unknown_server')
        .send({ ...baseServer, id: 'unknown_server' });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid server ID in path', async () => {
      const app = makeApp(deps);
      const res = await request(app)
        .put('/api/mcp/servers/INVALID-ID')
        .send({ ...baseServer });
      expect(res.status).toBe(400);
    });

    it('enforces id immutability from path param', async () => {
      const app = makeApp(deps);
      const res = await request(app)
        .put('/api/mcp/servers/test_server')
        .send({ ...baseServer, id: 'changed_id', name: 'Updated' });
      // id must remain test_server
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('test_server');
    });
  });

  // ── DELETE /api/mcp/servers/:id ──────────────────────────────────────────

  describe('DELETE /api/mcp/servers/:id', () => {
    it('removes an existing server', async () => {
      const app = makeApp(deps);
      const res = await request(app).delete('/api/mcp/servers/test_server');
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(deps.removeServer).toHaveBeenCalledWith('test_server');
    });

    it('returns 404 for unknown server', async () => {
      (deps.removeServer as any).mockResolvedValue(false);
      const app = makeApp(deps);
      const res = await request(app).delete('/api/mcp/servers/unknown_server');
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid server ID', async () => {
      const app = makeApp(deps);
      const res = await request(app).delete('/api/mcp/servers/INVALID-ID');
      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/mcp/servers/:id/reconnect ─────────────────────────────────

  describe('POST /api/mcp/servers/:id/reconnect', () => {
    it('reconnects existing server and returns updated state', async () => {
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers/test_server/reconnect');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('test_server');
      expect(deps.reconnectServer).toHaveBeenCalledWith('test_server');
    });

    it('returns 404 for unknown server', async () => {
      (deps.loadConfig as any).mockReturnValue({ servers: [] });
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers/unknown_server/reconnect');
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid server ID', async () => {
      const app = makeApp(deps);
      const res = await request(app).post('/api/mcp/servers/INVALID-ID/reconnect');
      expect(res.status).toBe(400);
    });
  });
});
