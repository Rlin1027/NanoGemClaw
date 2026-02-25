import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  getAllErrorStates: vi.fn(() => []),
  resetErrors: vi.fn(),
  getUsageStats: vi.fn(() => ({ totalMessages: 0, totalTokens: 0 })),
  getRecentUsage: vi.fn(() => []),
  getUsageTimeseries: vi.fn(() => []),
  getUsageByGroup: vi.fn(() => []),
  getUsageTimeseriesDaily: vi.fn(() => []),
  getGroupTokenRanking: vi.fn(() => []),
  getResponseTimePercentiles: vi.fn(() => ({ p50: 0, p90: 0, p99: 0 })),
  getErrorRateTimeseries: vi.fn(() => []),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  getLogBuffer: vi.fn(() => []),
}));

vi.mock('../config.js', () => ({
  GROUPS_DIR: '/test/groups',
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readdirSync: vi.fn(() => ['run-1.log', 'run-2.log']),
    readFileSync: vi.fn(() => 'log content'),
    statSync: vi.fn(() => ({ isFile: () => true })),
  },
}));

import request from 'supertest';
import { createTestApp, createMockDeps } from './helpers/route-test-setup.js';
import { createAnalyticsRouter } from '../routes/analytics.js';
import * as dbModule from '../db.js';
import * as loggerModule from '../logger.js';
import fs from 'fs';

function createAnalyticsDeps(overrides = {}) {
  const base = createMockDeps();
  return { validateFolder: base.validateFolder, ...overrides };
}

describe('routes/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // GET /api/logs
  describe('GET /api/logs', () => {
    it('returns log buffer', async () => {
      vi.mocked(loggerModule.getLogBuffer).mockReturnValue([
        'line1',
        'line2',
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/logs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns empty array when no logs', async () => {
      vi.mocked(loggerModule.getLogBuffer).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/logs');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // GET /api/logs/container/:group
  describe('GET /api/logs/container/:group', () => {
    it('returns list of container log files', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'run-2.log',
        'run-1.log',
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/logs/container/grp1');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty array when logs dir does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/logs/container/grp1');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 400 for invalid group folder', async () => {
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/logs/container/bad!folder');
      expect(res.status).toBe(400);
    });
  });

  // GET /api/logs/container/:group/:file
  describe('GET /api/logs/container/:group/:file', () => {
    it('returns log file content', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('log line 1\nlog line 2');
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/logs/container/grp1/run-1.log');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('content');
    });

    it('returns 400 for invalid group folder', async () => {
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/logs/container/bad!folder/run-1.log',
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid filename', async () => {
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/logs/container/grp1/bad!file.log',
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when log file not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/logs/container/grp1/missing.log',
      );
      expect(res.status).toBe(404);
    });
  });

  // GET /api/errors
  describe('GET /api/errors', () => {
    it('returns error states', async () => {
      vi.mocked(dbModule.getAllErrorStates).mockReturnValue([
        { group: 'grp1', error: 'Something failed' },
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/errors');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty when no errors', async () => {
      vi.mocked(dbModule.getAllErrorStates).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/errors');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getAllErrorStates).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/errors');
      expect(res.status).toBe(500);
    });
  });

  // POST /api/errors/clear
  describe('POST /api/errors/clear', () => {
    it('clears all error states', async () => {
      vi.mocked(dbModule.getAllErrorStates).mockReturnValue([
        { group: 'grp1' },
        { group: 'grp2' },
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).post('/api/errors/clear');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('cleared', 2);
    });

    it('reports zero cleared when no errors', async () => {
      vi.mocked(dbModule.getAllErrorStates).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).post('/api/errors/clear');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('cleared', 0);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getAllErrorStates).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).post('/api/errors/clear');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/usage
  describe('GET /api/usage', () => {
    it('returns usage stats', async () => {
      vi.mocked(dbModule.getUsageStats).mockReturnValue({
        totalMessages: 42,
        totalTokens: 1000,
      } as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getUsageStats).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/usage/recent
  describe('GET /api/usage/recent', () => {
    it('returns recent usage', async () => {
      vi.mocked(dbModule.getRecentUsage).mockReturnValue([
        { date: '2026-01-01', count: 5 },
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/recent');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getRecentUsage).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/recent');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/usage/timeseries
  describe('GET /api/usage/timeseries', () => {
    it('returns timeseries with defaults', async () => {
      vi.mocked(dbModule.getUsageTimeseries).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/timeseries');
      expect(res.status).toBe(200);
      expect(dbModule.getUsageTimeseries).toHaveBeenCalledWith(
        '7d',
        'day',
        undefined,
      );
    });

    it('accepts valid period and granularity', async () => {
      vi.mocked(dbModule.getUsageTimeseries).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/usage/timeseries?period=30d&granularity=hour',
      );
      expect(res.status).toBe(200);
      expect(dbModule.getUsageTimeseries).toHaveBeenCalledWith(
        '30d',
        'hour',
        undefined,
      );
    });

    it('filters by group folder', async () => {
      vi.mocked(dbModule.getUsageTimeseries).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/usage/timeseries?groupFolder=grp1',
      );
      expect(res.status).toBe(200);
      expect(dbModule.getUsageTimeseries).toHaveBeenCalledWith(
        '7d',
        'day',
        'grp1',
      );
    });

    it('returns 400 for invalid period', async () => {
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/timeseries?period=5y');
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid granularity', async () => {
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/usage/timeseries?granularity=week',
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid group folder', async () => {
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/usage/timeseries?groupFolder=bad!folder',
      );
      expect(res.status).toBe(400);
    });
  });

  // GET /api/usage/groups
  describe('GET /api/usage/groups', () => {
    it('returns usage by group', async () => {
      vi.mocked(dbModule.getUsageByGroup).mockReturnValue([
        { group: 'grp1', count: 10 },
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/groups');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('accepts since parameter', async () => {
      vi.mocked(dbModule.getUsageByGroup).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/groups?since=2026-01-01');
      expect(res.status).toBe(200);
      expect(dbModule.getUsageByGroup).toHaveBeenCalledWith('2026-01-01');
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getUsageByGroup).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/usage/groups');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/analytics/timeseries
  describe('GET /api/analytics/timeseries', () => {
    it('returns daily timeseries with default 30 days', async () => {
      vi.mocked(dbModule.getUsageTimeseriesDaily).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/timeseries');
      expect(res.status).toBe(200);
      expect(dbModule.getUsageTimeseriesDaily).toHaveBeenCalledWith(30);
    });

    it('accepts days parameter', async () => {
      vi.mocked(dbModule.getUsageTimeseriesDaily).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/timeseries?days=7');
      expect(res.status).toBe(200);
      expect(dbModule.getUsageTimeseriesDaily).toHaveBeenCalledWith(7);
    });

    it('clamps days to valid range', async () => {
      vi.mocked(dbModule.getUsageTimeseriesDaily).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/timeseries?days=9999');
      expect(res.status).toBe(200);
      expect(dbModule.getUsageTimeseriesDaily).toHaveBeenCalledWith(365);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getUsageTimeseriesDaily).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/timeseries');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/analytics/token-ranking
  describe('GET /api/analytics/token-ranking', () => {
    it('returns token ranking', async () => {
      vi.mocked(dbModule.getGroupTokenRanking).mockReturnValue([
        { group: 'grp1', tokens: 5000 },
      ] as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/token-ranking');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('accepts limit parameter', async () => {
      vi.mocked(dbModule.getGroupTokenRanking).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/analytics/token-ranking?limit=5',
      );
      expect(res.status).toBe(200);
      expect(dbModule.getGroupTokenRanking).toHaveBeenCalledWith(5);
    });

    it('clamps limit to valid range', async () => {
      vi.mocked(dbModule.getGroupTokenRanking).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get(
        '/api/analytics/token-ranking?limit=9999',
      );
      expect(res.status).toBe(200);
      expect(dbModule.getGroupTokenRanking).toHaveBeenCalledWith(100);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getGroupTokenRanking).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/token-ranking');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/analytics/response-times
  describe('GET /api/analytics/response-times', () => {
    it('returns response time percentiles', async () => {
      vi.mocked(dbModule.getResponseTimePercentiles).mockReturnValue({
        p50: 100,
        p90: 500,
        p99: 1000,
      } as any);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/response-times');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getResponseTimePercentiles).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/response-times');
      expect(res.status).toBe(500);
    });
  });

  // GET /api/analytics/error-rate
  describe('GET /api/analytics/error-rate', () => {
    it('returns error rate timeseries', async () => {
      vi.mocked(dbModule.getErrorRateTimeseries).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/error-rate');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('accepts days parameter', async () => {
      vi.mocked(dbModule.getErrorRateTimeseries).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/error-rate?days=14');
      expect(res.status).toBe(200);
      expect(dbModule.getErrorRateTimeseries).toHaveBeenCalledWith(14);
    });

    it('clamps days to max range', async () => {
      vi.mocked(dbModule.getErrorRateTimeseries).mockReturnValue([]);
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/error-rate?days=9999');
      expect(res.status).toBe(200);
      expect(dbModule.getErrorRateTimeseries).toHaveBeenCalledWith(365);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getErrorRateTimeseries).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createAnalyticsRouter(createAnalyticsDeps()));
      const res = await request(app).get('/api/analytics/error-rate');
      expect(res.status).toBe(500);
    });
  });
});
