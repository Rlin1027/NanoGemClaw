import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { folderParam } from '../schemas/shared.js';

const toolCallsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '1', 10);
      return Math.max(1, isNaN(n) ? 1 : n);
    }),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '50', 10);
      return Math.min(200, Math.max(1, isNaN(n) ? 50 : n));
    }),
  group: folderParam.optional(),
  injection: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

const toolCallsStatsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  group: folderParam.optional(),
});

export function createToolCallsRouter(): Router {
  const router = Router();

  // GET /api/tool-calls?page=1&limit=50&group=main&injection=true
  router.get(
    '/tool-calls',
    validate({ query: toolCallsQuerySchema }),
    async (req, res) => {
      try {
        const { page, limit, group, injection } =
          req.query as unknown as z.infer<typeof toolCallsQuerySchema>;
        const offset = (page - 1) * limit;

        const { getToolCallLogs } = await import('../db.js');
        const { rows, total } = getToolCallLogs(
          limit,
          offset,
          group,
          injection,
        );

        const records = rows.map((r) => ({
          id: r.id,
          timestamp: r.created_at,
          groupFolder: r.group_folder,
          toolName: r.tool_name,
          status: r.result_status,
          durationMs: r.duration_ms ?? 0,
          injectionDetected: r.injection_detected === 1,
          errorMessage:
            r.result_status === 'error' ? r.args_summary : undefined,
        }));

        res.json({
          data: {
            records,
            total,
            page,
            pageSize: limit,
          },
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch tool call logs' });
      }
    },
  );

  // GET /api/tool-calls/stats?from=2026-03-01&to=2026-03-05&group=main
  router.get(
    '/tool-calls/stats',
    validate({ query: toolCallsStatsQuerySchema }),
    async (req, res) => {
      try {
        const { from, to, group } = req.query as unknown as z.infer<
          typeof toolCallsStatsQuerySchema
        >;

        const { getToolCallStats } = await import('../db.js');

        // Calculate days range from from/to params
        let days = 7;
        if (from) {
          const fromDate = new Date(from);
          const toDate = to ? new Date(to) : new Date();
          if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
            days = Math.max(
              1,
              Math.ceil(
                (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
              ),
            );
          }
        }

        const stats = getToolCallStats(days, group);
        res.json({ data: stats });
      } catch {
        res.status(500).json({ error: 'Failed to fetch tool call stats' });
      }
    },
  );

  return router;
}
