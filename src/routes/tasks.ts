import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  groupFolderParams,
  tasksPaginationQuery,
  createTaskBody,
  updateTaskBody,
  updateTaskStatusBody,
  taskRunsQuery,
  taskRunsActivityQuery,
  tasksWeekQuery,
  taskIdParams,
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

  // GET /api/task-runs (Activity Logs — must be before :taskId routes)
  router.get(
    '/task-runs',
    validate({ query: taskRunsActivityQuery }),
    async (req, res) => {
      try {
        const { getTaskRunLogsWithDetails } = await import('../db.js');
        const { days, groupFolder } = req.query as unknown as z.infer<
          typeof taskRunsActivityQuery
        >;
        const logs = getTaskRunLogsWithDetails(days, groupFolder);
        res.json({ data: logs });
      } catch {
        res.status(500).json({ error: 'Failed to fetch activity logs' });
      }
    },
  );

  // GET /api/tasks/week (Weekly Schedule — must be before :taskId routes)
  router.get(
    '/tasks/week',
    validate({ query: tasksWeekQuery }),
    async (req, res) => {
      try {
        const { getTasksInDateRange } = await import('../db.js');
        const { CronExpressionParser } = await import('cron-parser');
        const { start, end } = req.query as unknown as z.infer<
          typeof tasksWeekQuery
        >;

        const tasks = getTasksInDateRange(start, end);
        const startDate = new Date(start);
        const endDate = new Date(end);

        interface ResolvedSlot {
          task_id: string;
          group_folder: string;
          prompt: string;
          schedule_type: string;
          schedule_value: string;
          status: string;
          start_time: string;
        }

        const slots: ResolvedSlot[] = [];
        const MAX_SLOTS_PER_TASK = 500;

        for (const task of tasks) {
          if (task.schedule_type === 'cron') {
            try {
              const interval = CronExpressionParser.parse(task.schedule_value, {
                currentDate: startDate,
                endDate,
              });
              let count = 0;
              let next = interval.next();
              while (next.toDate() <= endDate && count < MAX_SLOTS_PER_TASK) {
                slots.push({
                  task_id: task.id,
                  group_folder: task.group_folder,
                  prompt: task.prompt,
                  schedule_type: task.schedule_type,
                  schedule_value: task.schedule_value,
                  status: task.status,
                  start_time: next.toDate().toISOString(),
                });
                count++;
                try {
                  next = interval.next();
                } catch {
                  break;
                }
              }
            } catch {
              // Skip tasks with invalid cron expressions
            }
          } else if (task.schedule_type === 'interval') {
            const ms = parseInt(task.schedule_value, 10);
            if (!isNaN(ms) && ms > 0 && task.next_run) {
              let nextRun = new Date(task.next_run);
              // Walk backwards to find first occurrence in range
              while (nextRun > startDate) {
                nextRun = new Date(nextRun.getTime() - ms);
              }
              // Walk forward through range
              let count = 0;
              while (nextRun <= endDate && count < MAX_SLOTS_PER_TASK) {
                if (nextRun >= startDate) {
                  slots.push({
                    task_id: task.id,
                    group_folder: task.group_folder,
                    prompt: task.prompt,
                    schedule_type: task.schedule_type,
                    schedule_value: task.schedule_value,
                    status: task.status,
                    start_time: nextRun.toISOString(),
                  });
                  count++;
                }
                nextRun = new Date(nextRun.getTime() + ms);
              }
            }
          } else if (task.schedule_type === 'once' && task.next_run) {
            slots.push({
              task_id: task.id,
              group_folder: task.group_folder,
              prompt: task.prompt,
              schedule_type: task.schedule_type,
              schedule_value: task.schedule_value,
              status: task.status,
              start_time: task.next_run,
            });
          }
        }

        res.json({ data: slots });
      } catch {
        res.status(500).json({ error: 'Failed to fetch weekly schedule' });
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
  router.post(
    '/tasks',
    validate({ body: createTaskBody }),
    async (req, res) => {
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
        } = req.body as z.infer<typeof createTaskBody>;

        // Parse natural schedule if provided
        let effectiveScheduleType = schedule_type;
        let effectiveScheduleValue = schedule_value;

        if (!schedule_type && !schedule_value && natural_schedule) {
          const { parseNaturalSchedule } =
            await import('../natural-schedule.js');
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

        // At this point Zod refine guarantees effectiveScheduleType/Value are set
        const resolvedScheduleType = effectiveScheduleType as
          | 'cron'
          | 'interval'
          | 'once';
        const resolvedScheduleValue = effectiveScheduleValue as string;

        // Calculate next_run
        let next_run: string | null = null;
        if (resolvedScheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(resolvedScheduleValue);
            next_run = interval.next().toISOString();
          } catch {
            res.status(400).json({ error: 'Invalid cron expression' });
            return;
          }
        } else if (resolvedScheduleType === 'interval') {
          const ms = parseInt(resolvedScheduleValue, 10);
          if (isNaN(ms) || ms < 0 || ms <= 0) {
            res.status(400).json({ error: 'Invalid interval value' });
            return;
          }
          next_run = new Date(Date.now() + ms).toISOString();
        } else if (resolvedScheduleType === 'once') {
          const scheduled = new Date(resolvedScheduleValue);
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
          schedule_type: resolvedScheduleType,
          schedule_value: resolvedScheduleValue,
          context_mode: (context_mode as 'group' | 'isolated') || 'isolated',
          next_run,
          status: 'active',
          created_at: new Date().toISOString(),
        });

        res.status(201).json({ data: { id: taskId } });
      } catch {
        res.status(500).json({ error: 'Failed to create task' });
      }
    },
  );

  // PUT /api/tasks/:taskId
  router.put(
    '/tasks/:taskId',
    validate({ params: taskIdParams, body: updateTaskBody }),
    async (req, res) => {
      try {
        const { updateTask, getTaskById } = await import('../db.js');
        const { taskId } = req.params as unknown as z.infer<
          typeof taskIdParams
        >;

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
  router.delete(
    '/tasks/:taskId',
    validate({ params: taskIdParams }),
    async (req, res) => {
      try {
        const { deleteTask, getTaskById } = await import('../db.js');
        const { taskId } = req.params as unknown as z.infer<
          typeof taskIdParams
        >;

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
    },
  );

  // PUT /api/tasks/:taskId/status
  router.put(
    '/tasks/:taskId/status',
    validate({ params: taskIdParams, body: updateTaskStatusBody }),
    async (req, res) => {
      try {
        const { updateTask, getTaskById } = await import('../db.js');
        const { taskId } = req.params as unknown as z.infer<
          typeof taskIdParams
        >;
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
    validate({ params: taskIdParams, query: taskRunsQuery }),
    async (req, res) => {
      try {
        const { getTaskRunLogs } = await import('../db.js');
        const { taskId } = req.params as unknown as z.infer<
          typeof taskIdParams
        >;
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
