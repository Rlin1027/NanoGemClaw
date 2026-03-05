import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../maintenance.js', () => ({
  isMaintenanceMode: vi.fn(() => false),
  setMaintenanceMode: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  setLogLevel: vi.fn(),
}));

vi.mock('../context-cache.js', () => ({
  getCacheStats: vi.fn(() => ({ hits: 10, misses: 5, size: 3 })),
}));

vi.mock('../gemini-client.js', () => ({
  isGeminiClientAvailable: vi.fn(() => true),
}));

vi.mock('../config.js', () => ({
  FAST_PATH: { ENABLED: true },
  GROUPS_DIR: '/test/groups',
  SCHEDULER: {
    CONCURRENCY: 2,
    getRecommendedConcurrency: vi.fn(() => 4),
  },
  getDefaultModel: vi.fn(() => 'gemini-3-flash-preview'),
}));

vi.mock('@nanogemclaw/gemini', () => ({
  getAvailableModels: vi.fn(() => ['gemini-3-flash-preview']),
  setExternalModels: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  resolveAuth: vi.fn(() => Promise.resolve(null)),
  discoverVertexModels: vi.fn(() => Promise.resolve([])),
}));

import request from 'supertest';
import { createTestApp } from './helpers/route-test-setup.js';
import { createConfigRouter } from '../routes/config.js';

function makeApp(
  overrides: Partial<Parameters<typeof createConfigRouter>[0]> = {},
) {
  return createTestApp(
    createConfigRouter({
      dashboardHost: '127.0.0.1',
      dashboardPort: 3000,
      getConnectedClients: vi.fn(() => 2),
      accessCode: 'test',
      ...overrides,
    }),
  );
}

describe('routes/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/health', () => {
    it('returns 200 with status ok and uptime', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  describe('GET /api/config', () => {
    it('returns 200 with config data fields', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(typeof data.maintenanceMode).toBe('boolean');
      expect(typeof data.logLevel).toBe('string');
      expect(data.dashboardHost).toBe('127.0.0.1');
      expect(data.dashboardPort).toBe(3000);
      expect(typeof data.uptime).toBe('number');
      expect(typeof data.connectedClients).toBe('number');
      expect(typeof data.authRequired).toBe('boolean');
    });

    it('returns 500 when import fails', async () => {
      const { isMaintenanceMode } = await import('../maintenance.js');
      vi.mocked(isMaintenanceMode).mockImplementationOnce(() => {
        throw new Error('module error');
      });
      const app = makeApp();
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch config' });
    });
  });

  describe('PUT /api/config', () => {
    it('updates maintenanceMode to true and returns 200', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/config')
        .send({ maintenanceMode: true });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('maintenanceMode');
      expect(res.body.data).toHaveProperty('logLevel');
    });

    it('updates logLevel and returns 200', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/config')
        .send({ logLevel: 'debug' });
      expect(res.status).toBe(200);
      expect(res.body.data.logLevel).toBe('debug');
    });

    it('updates both fields and returns 200', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/config')
        .send({ maintenanceMode: false, logLevel: 'warn' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('maintenanceMode');
      expect(res.body.data.logLevel).toBe('warn');
    });

    it('returns 500 when import fails', async () => {
      const { setMaintenanceMode } = await import('../maintenance.js');
      vi.mocked(setMaintenanceMode).mockImplementationOnce(() => {
        throw new Error('module error');
      });
      const app = makeApp();
      const res = await request(app)
        .put('/api/config')
        .send({ maintenanceMode: true });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to update config' });
    });
  });

  describe('GET /api/config/cache-stats', () => {
    it('returns 200 with cache data', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/config/cache-stats');
      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(typeof data.fastPathEnabled).toBe('boolean');
      expect(typeof data.geminiClientAvailable).toBe('boolean');
      expect(data.hits).toBe(10);
      expect(data.misses).toBe(5);
      expect(data.size).toBe(3);
    });

    it('returns 500 when import fails', async () => {
      const { getCacheStats } = await import('../context-cache.js');
      vi.mocked(getCacheStats).mockImplementationOnce(() => {
        throw new Error('module error');
      });
      const app = makeApp();
      const res = await request(app).get('/api/config/cache-stats');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch cache stats' });
    });
  });

  describe('GET /api/config/secrets', () => {
    it('returns 200 with secret status array', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/config/secrets');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const keys = res.body.data.map((s: { key: string }) => s.key);
      expect(keys).toContain('GEMINI_API_KEY');
      expect(keys).toContain('TELEGRAM_BOT_TOKEN');
      expect(keys).toContain('WEBHOOK_URL');
      expect(keys).toContain('DASHBOARD_API_KEY');
      res.body.data.forEach((s: { key: string; configured: boolean }) => {
        expect(typeof s.configured).toBe('boolean');
      });
    });
  });

  describe('GET /api/config/scheduler', () => {
    it('returns 200 with concurrency, recommended, cpuCores, totalMemoryGB', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/config/scheduler');
      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(data.concurrency).toBe(2);
      expect(data.recommended).toBe(4);
      expect(typeof data.cpuCores).toBe('number');
      expect(data.cpuCores).toBeGreaterThan(0);
      expect(typeof data.totalMemoryGB).toBe('number');
    });

    it('returns 500 when config import fails', async () => {
      const { SCHEDULER } = await import('../config.js');
      vi.mocked(SCHEDULER.getRecommendedConcurrency).mockImplementationOnce(
        () => {
          throw new Error('config error');
        },
      );
      const app = makeApp();
      const res = await request(app).get('/api/config/scheduler');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch scheduler info' });
    });
  });

  describe('GET /api/config/models', () => {
    it('returns 200 with base models when no OAuth auth', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/config/models');
      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(data.models).toEqual(['gemini-3-flash-preview']);
      expect(data.defaultModel).toBe('gemini-3-flash-preview');
    });

    it('calls setExternalModels when OAuth returns vertex models', async () => {
      const { resolveAuth, discoverVertexModels } = await import('../auth.js');
      const { setExternalModels } = await import('@nanogemclaw/gemini');
      vi.mocked(resolveAuth).mockResolvedValueOnce({
        type: 'oauth',
        token: 'tok',
        project: 'proj',
      } as never);
      vi.mocked(discoverVertexModels).mockResolvedValueOnce([
        'gemini-vertex-pro',
      ] as never);

      const app = makeApp();
      const res = await request(app).get('/api/config/models');
      expect(res.status).toBe(200);
      expect(vi.mocked(setExternalModels)).toHaveBeenCalledWith([
        'gemini-vertex-pro',
      ]);
      expect(res.body.data.models).toEqual(['gemini-vertex-pro']);
    });

    it('keeps base models when OAuth vertex returns empty list', async () => {
      const { resolveAuth, discoverVertexModels } = await import('../auth.js');
      const { setExternalModels } = await import('@nanogemclaw/gemini');
      vi.mocked(resolveAuth).mockResolvedValueOnce({
        type: 'oauth',
        token: 'tok',
        project: 'proj',
      } as never);
      vi.mocked(discoverVertexModels).mockResolvedValueOnce([] as never);

      const app = makeApp();
      const res = await request(app).get('/api/config/models');
      expect(res.status).toBe(200);
      expect(vi.mocked(setExternalModels)).not.toHaveBeenCalled();
      expect(res.body.data.models).toEqual(['gemini-3-flash-preview']);
    });

    it('returns 500 when getAvailableModels throws', async () => {
      const { getAvailableModels } = await import('@nanogemclaw/gemini');
      vi.mocked(getAvailableModels).mockImplementationOnce(() => {
        throw new Error('gemini error');
      });
      const app = makeApp();
      const res = await request(app).get('/api/config/models');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch available models' });
    });
  });
});
