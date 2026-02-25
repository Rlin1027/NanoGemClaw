import { z } from 'zod';
import { folderParam, paginationQuery } from './shared.js';

/** Params for routes with :groupFolder */
export const groupFolderParams = z.object({
  groupFolder: folderParam,
});

/** GET /api/tasks query */
export const tasksPaginationQuery = paginationQuery;

/** POST /api/tasks body — note: natural_schedule is handled before validation */
export const createTaskBody = z
  .object({
    group_folder: folderParam,
    prompt: z.string().min(1, 'Prompt is required'),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional(),
    schedule_value: z.string().optional(),
    context_mode: z.string().optional(),
    natural_schedule: z.string().optional(),
  })
  .refine(
    (data) => {
      // Either natural_schedule OR (schedule_type + schedule_value) must be provided
      const hasNatural = !!data.natural_schedule;
      const hasExplicit = !!data.schedule_type && !!data.schedule_value;
      return hasNatural || hasExplicit;
    },
    {
      message:
        'Missing required fields: group_folder, prompt, schedule_type, schedule_value',
    },
  );

/** PUT /api/tasks/:taskId body */
export const updateTaskBody = z.object({
  prompt: z.string().optional(),
  schedule_type: z.enum(['cron', 'interval', 'once']).optional(),
  schedule_value: z.string().optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
});

/** PUT /api/tasks/:taskId/status body */
export const updateTaskStatusBody = z.object({
  status: z.enum(['active', 'paused']),
});

/** DELETE/PUT /api/tasks/:taskId params */
export const taskIdParams = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

/** GET /api/tasks/:taskId/runs query */
export const taskRunsQuery = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 10;
      const n = parseInt(val, 10);
      return isNaN(n) || n < 0 ? null : n;
    }),
});
