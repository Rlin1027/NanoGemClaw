import { z } from 'zod';
import { folderParam, safeFileParam } from './shared.js';

/** GET /api/logs/container/:group */
export const containerLogsParams = z.object({
  group: folderParam,
});

/** GET /api/logs/container/:group/:file */
export const containerLogFileParams = z.object({
  group: folderParam,
  file: safeFileParam,
});

/** GET /api/usage/timeseries query */
export const usageTimeseriesQuery = z.object({
  period: z.enum(['1d', '7d', '30d', '90d']).optional(),
  granularity: z.enum(['hour', 'day']).optional(),
  groupFolder: folderParam.optional(),
});

/** GET /api/analytics/timeseries query — clamp days to [1, 365] via transform */
export const analyticsTimeseriesQuery = z.object({
  days: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '30', 10);
      return Math.min(365, Math.max(1, isNaN(n) ? 30 : n));
    }),
});

/** GET /api/analytics/token-ranking query — clamp limit to [1, 100] via transform */
export const analyticsTokenRankingQuery = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '10', 10);
      return Math.min(100, Math.max(1, isNaN(n) ? 10 : n));
    }),
});

/** GET /api/analytics/error-rate query */
export const analyticsErrorRateQuery = z.object({
  days: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '30', 10);
      return Math.min(365, Math.max(1, isNaN(n) ? 30 : n));
    }),
});
