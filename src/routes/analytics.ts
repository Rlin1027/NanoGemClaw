import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '../config.js';
import { getLogBuffer } from '../logger.js';
import { validate } from '../middleware/validate.js';
import {
  containerLogsParams,
  containerLogFileParams,
  usageTimeseriesQuery,
  analyticsTimeseriesQuery,
  analyticsTokenRankingQuery,
  analyticsErrorRateQuery,
  usageGroupsQuery,
} from '../schemas/analytics.js';
import { folderParam } from '../schemas/shared.js';
import { z } from 'zod';

interface AnalyticsRouterDeps {
  // validateFolder removed — handled by Zod middleware
}

export function createAnalyticsRouter(_deps: AnalyticsRouterDeps = {}): Router {
  const router = Router();

  // GET /api/logs
  router.get('/logs', (_req, res) => {
    res.json({ data: getLogBuffer() });
  });

  // GET /api/logs/container/:group
  router.get(
    '/logs/container/:group',
    validate({ params: containerLogsParams }),
    (req, res) => {
      const { group } = req.params as unknown as z.infer<
        typeof containerLogsParams
      >;
      const logsDir = path.join(GROUPS_DIR, group, 'logs');
      try {
        if (!fs.existsSync(logsDir)) {
          res.json({ data: [] });
          return;
        }
        const files = fs
          .readdirSync(logsDir)
          .filter((f) => f.endsWith('.log'))
          .sort()
          .reverse();
        res.json({ data: files });
      } catch {
        res.status(500).json({ error: 'Failed to list container logs' });
      }
    },
  );

  // GET /api/logs/container/:group/:file
  router.get(
    '/logs/container/:group/:file',
    validate({ params: containerLogFileParams }),
    (req, res) => {
      const { group, file } = req.params as unknown as z.infer<
        typeof containerLogFileParams
      >;
      const filePath = path.join(GROUPS_DIR, group, 'logs', file);
      // Double-check path is within expected directory
      if (
        !path
          .resolve(filePath)
          .startsWith(path.resolve(path.join(GROUPS_DIR, group, 'logs')))
      ) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      try {
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: 'Log file not found' });
          return;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ data: { content } });
      } catch {
        res.status(500).json({ error: 'Failed to read log file' });
      }
    },
  );

  // GET /api/errors
  router.get('/errors', async (_req, res) => {
    try {
      const { getAllErrorStates } = await import('../db.js');
      res.json({ data: getAllErrorStates() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch errors' });
    }
  });

  // POST /api/errors/clear
  router.post('/errors/clear', async (_req, res) => {
    try {
      const { getAllErrorStates, resetErrors } = await import('../db.js');
      const errors = getAllErrorStates();
      for (const e of errors) {
        resetErrors(e.group);
      }
      const { logger } = await import('../logger.js');
      logger.info('All error states cleared via dashboard');
      res.json({ data: { cleared: errors.length } });
    } catch {
      res.status(500).json({ error: 'Failed to clear errors' });
    }
  });

  // GET /api/usage
  router.get('/usage', async (_req, res) => {
    try {
      const { getUsageStats } = await import('../db.js');
      res.json({ data: getUsageStats() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch usage' });
    }
  });

  // GET /api/usage/recent
  router.get('/usage/recent', async (_req, res) => {
    try {
      const { getRecentUsage } = await import('../db.js');
      res.json({ data: getRecentUsage() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch recent usage' });
    }
  });

  // GET /api/usage/timeseries
  router.get(
    '/usage/timeseries',
    validate({ query: usageTimeseriesQuery }),
    async (req, res) => {
      try {
        const { getUsageTimeseries } = await import('../db.js');
        const { period, granularity, groupFolder } =
          req.query as unknown as z.infer<typeof usageTimeseriesQuery>;
        res.json({
          data: getUsageTimeseries(
            period ?? '7d',
            granularity ?? 'day',
            groupFolder,
          ),
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch usage timeseries' });
      }
    },
  );

  // GET /api/usage/groups
  router.get(
    '/usage/groups',
    validate({ query: usageGroupsQuery }),
    async (req, res) => {
      try {
        const { getUsageByGroup } = await import('../db.js');
        const { since } = req.query as unknown as z.infer<
          typeof usageGroupsQuery
        >;
        res.json({ data: getUsageByGroup(since) });
      } catch {
        res.status(500).json({ error: 'Failed to fetch usage by group' });
      }
    },
  );

  // GET /api/analytics/timeseries
  router.get(
    '/analytics/timeseries',
    validate({ query: analyticsTimeseriesQuery }),
    async (req, res) => {
      try {
        const { getUsageTimeseriesDaily } = await import('../db.js');
        const { days } = req.query as unknown as z.infer<
          typeof analyticsTimeseriesQuery
        >;
        res.json({ data: getUsageTimeseriesDaily(days) });
      } catch {
        res.status(500).json({ error: 'Failed to fetch timeseries data' });
      }
    },
  );

  // GET /api/analytics/token-ranking
  router.get(
    '/analytics/token-ranking',
    validate({ query: analyticsTokenRankingQuery }),
    async (req, res) => {
      try {
        const { getGroupTokenRanking } = await import('../db.js');
        const { limit } = req.query as unknown as z.infer<
          typeof analyticsTokenRankingQuery
        >;
        res.json({ data: getGroupTokenRanking(limit) });
      } catch {
        res.status(500).json({ error: 'Failed to fetch token ranking' });
      }
    },
  );

  // GET /api/analytics/response-times
  router.get('/analytics/response-times', async (_req, res) => {
    try {
      const { getResponseTimePercentiles } = await import('../db.js');
      res.json({ data: getResponseTimePercentiles() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch response times' });
    }
  });

  // GET /api/analytics/error-rate
  router.get(
    '/analytics/error-rate',
    validate({ query: analyticsErrorRateQuery }),
    async (req, res) => {
      try {
        const { getErrorRateTimeseries } = await import('../db.js');
        const { days } = req.query as unknown as z.infer<
          typeof analyticsErrorRateQuery
        >;
        res.json({ data: getErrorRateTimeseries(days) });
      } catch {
        res.status(500).json({ error: 'Failed to fetch error rate' });
      }
    },
  );

  return router;
}
