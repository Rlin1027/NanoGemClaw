import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { runContainerAgent, writeTasksSnapshot } from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTaskAfterRun,
} from './db.js';
import { logger } from './logger.js';
import { isMaintenanceMode } from './maintenance.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  cachedTasks?: ScheduledTask[],
): Promise<void> {
  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  let chatJid = task.chat_jid;
  const group = (() => {
    for (const [key, g] of Object.entries(groups)) {
      if (g.folder === task.group_folder) {
        if (!chatJid) chatJid = key;
        return g;
      }
    }
    return undefined;
  })();

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = cachedTasks ?? getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  try {
    const output = await runContainerAgent(group, {
      prompt: task.prompt,
      sessionId,
      groupFolder: task.group_folder,
      chatJid: chatJid || task.chat_jid,
      isMain,
      isScheduledTask: true,
      systemPrompt: group.systemPrompt,
      enableWebSearch: group.enableWebSearch ?? true,
    });

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else {
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  let nextRun: string | null = null;
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    nextRun = interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    nextRun = new Date(Date.now() + ms).toISOString();
  }
  // 'once' tasks have no next run

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

export function startSchedulerLoop(deps: SchedulerDependencies): {
  stop: () => void;
} {
  logger.info('Scheduler loop started');

  let stopped = false;
  let currentTimeout: NodeJS.Timeout | null = null;

  const loop = async () => {
    if (stopped) return;

    try {
      // Skip task processing in maintenance mode
      if (isMaintenanceMode()) {
        logger.debug('Scheduler skipping: maintenance mode active');
        if (!stopped) {
          currentTimeout = setTimeout(loop, SCHEDULER_POLL_INTERVAL);
        }
        return;
      }

      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      // Fetch all tasks once per tick and pass cached list to each runTask call
      const allTasksSnapshot = dueTasks.length > 0 ? getAllTasks() : [];

      for (const task of dueTasks) {
        if (stopped) break;

        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        // Isolate each task - one failure shouldn't block others
        try {
          await runTask(currentTask, deps, allTasksSnapshot);
        } catch (taskErr) {
          logger.error(
            {
              taskId: task.id,
              err: taskErr instanceof Error ? taskErr.message : String(taskErr),
            },
            'Task execution failed (isolated)',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    if (!stopped) {
      currentTimeout = setTimeout(loop, SCHEDULER_POLL_INTERVAL);
    }
  };

  loop();

  return {
    stop: () => {
      stopped = true;
      if (currentTimeout) clearTimeout(currentTimeout);
    },
  };
}
