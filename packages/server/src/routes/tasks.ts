import { Router } from 'express';

interface TasksRouterDeps {
    validateFolder: (folder: string) => boolean;
    validateNumericParam: (value: string, name: string) => number | null;
}

export function createTasksRouter(deps: TasksRouterDeps): Router {
    const router = Router();
    const { validateFolder, validateNumericParam } = deps;

    // GET /api/tasks
    router.get('/tasks', async (_req, res) => {
        try {
            const { getAllTasks } = await import('@nanogemclaw/db');
            res.json({ data: getAllTasks() });
        } catch {
            res.status(500).json({ error: 'Failed to fetch tasks' });
        }
    });

    // GET /api/tasks/group/:groupFolder
    router.get('/tasks/group/:groupFolder', async (req, res) => {
        const { groupFolder } = req.params;
        if (!validateFolder(groupFolder)) {
            res.status(400).json({ error: 'Invalid group folder' });
            return;
        }
        try {
            const { getTasksForGroup } = await import('@nanogemclaw/db');
            res.json({ data: getTasksForGroup(groupFolder) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch tasks' });
        }
    });

    // POST /api/tasks
    router.post('/tasks', async (req, res) => {
        try {
            const { createTask } = await import('@nanogemclaw/db');
            const { CronExpressionParser } = await import('cron-parser');

            const {
                group_folder,
                prompt,
                schedule_type,
                schedule_value,
                context_mode,
                natural_schedule,
            } = req.body;

            let effectiveScheduleType = schedule_type;
            let effectiveScheduleValue = schedule_value;

            if (!schedule_type && !schedule_value && natural_schedule) {
                const { parseNaturalSchedule } = await import('../../../../src/natural-schedule.js');
                const parsed = parseNaturalSchedule(natural_schedule);
                if (!parsed) {
                    res.status(400).json({ error: 'Could not parse natural schedule text' });
                    return;
                }
                effectiveScheduleType = parsed.schedule_type;
                effectiveScheduleValue = parsed.schedule_value;
            }

            if (!group_folder || !prompt || !effectiveScheduleType || !effectiveScheduleValue) {
                res.status(400).json({
                    error: 'Missing required fields: group_folder, prompt, schedule_type, schedule_value',
                });
                return;
            }

            if (!validateFolder(group_folder)) {
                res.status(400).json({ error: 'Invalid group folder' });
                return;
            }

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
                const ms = validateNumericParam(effectiveScheduleValue, 'interval');
                if (ms === null || ms <= 0) {
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
                chat_jid: '',
                prompt,
                schedule_type: effectiveScheduleType,
                schedule_value: effectiveScheduleValue,
                context_mode: context_mode || 'isolated',
                next_run,
                status: 'active',
                created_at: new Date().toISOString(),
            });

            res.json({ data: { id: taskId } });
        } catch {
            res.status(500).json({ error: 'Failed to create task' });
        }
    });

    // PUT /api/tasks/:taskId
    router.put('/tasks/:taskId', async (req, res) => {
        try {
            const { updateTask, getTaskById } = await import('@nanogemclaw/db');
            const { taskId } = req.params;

            const task = getTaskById(taskId);
            if (!task) {
                res.status(404).json({ error: 'Task not found' });
                return;
            }

            const { prompt, schedule_type, schedule_value, status } = req.body;
            const updates: Record<string, any> = {};
            if (prompt !== undefined) updates.prompt = prompt;
            if (schedule_type !== undefined) updates.schedule_type = schedule_type;
            if (schedule_value !== undefined) updates.schedule_value = schedule_value;
            if (status !== undefined) updates.status = status;

            if (schedule_type || schedule_value) {
                const type = schedule_type || task.schedule_type;
                const value = schedule_value || task.schedule_value;

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
                    const ms = validateNumericParam(value, 'interval');
                    if (ms !== null && ms > 0) {
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
    });

    // DELETE /api/tasks/:taskId
    router.delete('/tasks/:taskId', async (req, res) => {
        try {
            const { deleteTask, getTaskById } = await import('@nanogemclaw/db');
            const { taskId } = req.params;

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
    router.put('/tasks/:taskId/status', async (req, res) => {
        try {
            const { updateTask, getTaskById } = await import('@nanogemclaw/db');
            const { taskId } = req.params;
            const { status } = req.body;

            if (!['active', 'paused'].includes(status)) {
                res.status(400).json({ error: 'Status must be: active or paused' });
                return;
            }

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
    });

    // GET /api/tasks/:taskId/runs
    router.get('/tasks/:taskId/runs', async (req, res) => {
        try {
            const { getTaskRunLogs } = await import('@nanogemclaw/db');
            const { taskId } = req.params;

            let limit = 10;
            if (req.query.limit) {
                const parsedLimit = validateNumericParam(req.query.limit as string, 'limit');
                if (parsedLimit === null) {
                    res.status(400).json({ error: 'Invalid limit parameter' });
                    return;
                }
                limit = parsedLimit;
            }

            res.json({ data: getTaskRunLogs(taskId, limit) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch task runs' });
        }
    });

    return router;
}
