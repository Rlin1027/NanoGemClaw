import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  groupFolderParams,
  tasksPaginationQuery,
  createTaskBody,
  updateTaskBody,
  updateTaskStatusBody,
  taskRunsQuery,
} from '../schemas/tasks.js';
import { paginationQuery } from '../schemas/shared.js';
import type { z } from 'zod';

interface TasksRouterDeps {
  // validateFolder and validateNumericParam removed — handled by Zod middleware
}

export function createTasksRouter(_deps: TasksRouterDeps = {}): Router {
  const router = Router();

  // GET /api/tasks
  router.get(
    '/tasks',
    validate({ query: tasksPaginationQuery }),
    async (req, res) => {
      try {
        const { getAllTasksPaginated } = await import('../db.js');
        const { limit, offset } = req.query as unknown as z.infer<
          typeof paginationQuery
        >;
        const { rows, total } = getAllTasksPaginated(limit, offset);
        res.json({
          data: rows,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + rows.length < total,
          },
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch tasks' });
      }
    },
  );

  // GET /api/tasks/group/:groupFolder
  router.get(
    '/tasks/group/:groupFolder',
    validate({ params: groupFolderParams, query: tasksPaginationQuery }),
    async (req, res) => {
      const { groupFolder } = req.params as unknown as z.infer<
        typeof groupFolderParams
      >;
      try {
        const { getTasksForGroupPaginated } = await import('../db.js');
        const { limit, offset } = req.query as unknown as z.infer<
          typeof paginationQuery
        >;
        const { rows, total } = getTasksForGroupPaginated(
          groupFolder,
          limit,
          offset,
        );
        res.json({
          data: rows,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + rows.length < total,
          },
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch tasks' });
      }
    },
  );

  // POST /api/tasks
  router.post('/tasks', async (req, res) => {
    try {
      const { createTask } = await import('../db.js');
      const { CronExpressionParser } = await import('cron-parser');

      const {
        group_folder,
        prompt,
        schedule_type,
        schedule_value,
        context_mode,
        natural_schedule,
      } = req.body;

      // Parse natural schedule if provided
      let effectiveScheduleType = schedule_type;
      let effectiveScheduleValue = schedule_value;

      if (!schedule_type && !schedule_value && natural_schedule) {
        const { parseNaturalSchedule } = await import('../natural-schedule.js');
        const parsed = parseNaturalSchedule(natural_schedule);
        if (!parsed) {
          res
            .status(400)
            .json({ error: 'Could not parse natural schedule text' });
          return;
        }
        effectiveScheduleType = parsed.schedule_type;
        effectiveScheduleValue = parsed.schedule_value;
      }

      if (
        !group_folder ||
        !prompt ||
        !effectiveScheduleType ||
        !effectiveScheduleValue
      ) {
        res.status(400).json({
          error:
            'Missing required fields: group_folder, prompt, schedule_type, schedule_value',
        });
        return;
      }

      // Validate group_folder
      if (!/^[a-zA-Z0-9_-]+$/.test(group_folder)) {
        res.status(400).json({ error: 'Invalid group folder' });
        return;
      }

      // Calculate next_run
      let next_run: string | null = null;
      if (effectiveScheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(effectiveScheduleValue);
          next_run = interval.next().toISOString();
        } catch {
          res.status(400).json({ error: 'Invalid cron expression' });
          return;
        }
      } else if (effectiveScheduleType === 'interval') {
        const ms = parseInt(effectiveScheduleValue, 10);
        if (isNaN(ms) || ms < 0 || ms <= 0) {
          res.status(400).json({ error: 'Invalid interval value' });
          return;
        }
        next_run = new Date(Date.now() + ms).toISOString();
      } else if (effectiveScheduleType === 'once') {
        const scheduled = new Date(effectiveScheduleValue);
        if (isNaN(scheduled.getTime())) {
          res.status(400).json({ error: 'Invalid date' });
          return;
        }
        next_run = scheduled.toISOString();
      } else {
        res.status(400).json({
          error: 'Invalid schedule_type. Must be: cron, interval, or once',
        });
        return;
      }

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      createTask({
        id: taskId,
        group_folder,
        chat_jid: '', // Will be resolved by scheduler
        prompt,
        schedule_type: effectiveScheduleType,
        schedule_value: effectiveScheduleValue,
        context_mode: context_mode || 'isolated',
        next_run,
        status: 'active',
        created_at: new Date().toISOString(),
      });

      res.status(201).json({ data: { id: taskId } });
    } catch {
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // PUT /api/tasks/:taskId
  router.put(
    '/tasks/:taskId',
    validate({ body: updateTaskBody }),
    async (req, res) => {
      try {
        const { updateTask, getTaskById } = await import('../db.js');
        const taskId = String(req.params.taskId);

        const task = getTaskById(taskId);
        if (!task) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }

        const { prompt, schedule_type, schedule_value, status } =
          req.body as z.infer<typeof updateTaskBody>;
        const updates: Record<string, unknown> = {};
        if (prompt !== undefined) updates.prompt = prompt;
        if (schedule_type !== undefined) updates.schedule_type = schedule_type;
        if (schedule_value !== undefined)
          updates.schedule_value = schedule_value;
        if (status !== undefined) updates.status = status;

        // Recalculate next_run if schedule changed
        if (schedule_type || schedule_value) {
          const type = String(schedule_type || task.schedule_type);
          const value = String(schedule_value || task.schedule_value);

          if (type === 'cron') {
            const { CronExpressionParser } = await import('cron-parser');
            try {
              const interval = CronExpressionParser.parse(value);
              updates.next_run = interval.next().toISOString();
            } catch {
              res.status(400).json({ error: 'Invalid cron expression' });
              return;
            }
          } else if (type === 'interval') {
            const ms = parseInt(value, 10);
            if (!isNaN(ms) && ms > 0) {
              updates.next_run = new Date(Date.now() + ms).toISOString();
            } else {
              res.status(400).json({ error: 'Invalid interval value' });
              return;
            }
          }
        }

        updateTask(taskId, updates);
        res.json({ data: { success: true } });
      } catch {
        res.status(500).json({ error: 'Failed to update task' });
      }
    },
  );

  // DELETE /api/tasks/:taskId
  router.delete('/tasks/:taskId', async (req, res) => {
    try {
      const { deleteTask, getTaskById } = await import('../db.js');
      const taskId = String(req.params.taskId);

      const task = getTaskById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      deleteTask(taskId);
      res.json({ data: { success: true } });
    } catch {
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  // PUT /api/tasks/:taskId/status
  router.put(
    '/tasks/:taskId/status',
    validate({ body: updateTaskStatusBody }),
    async (req, res) => {
      try {
        const { updateTask, getTaskById } = await import('../db.js');
        const taskId = String(req.params.taskId);
        const { status } = req.body as z.infer<typeof updateTaskStatusBody>;

        const task = getTaskById(taskId);
        if (!task) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }

        updateTask(taskId, { status });
        res.json({ data: { success: true } });
      } catch {
        res.status(500).json({ error: 'Failed to update task status' });
      }
    },
  );

  // GET /api/tasks/:taskId/runs
  router.get(
    '/tasks/:taskId/runs',
    validate({ query: taskRunsQuery }),
    async (req, res) => {
      try {
        const { getTaskRunLogs } = await import('../db.js');
        const taskId = String(req.params.taskId);
        const { limit } = req.query as unknown as z.infer<typeof taskRunsQuery>;

        if (limit === null) {
          res.status(400).json({ error: 'Invalid limit parameter' });
          return;
        }

        res.json({ data: getTaskRunLogs(taskId, limit) });
      } catch {
        res.status(500).json({ error: 'Failed to fetch task runs' });
      }
    },
  );

  return router;
}
