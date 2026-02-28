import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import { ConcurrencyLimiter } from './concurrency-limiter.js';
import {
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER,
  TIMEZONE,
} from './config.js';
import {
  runContainerAgent,
  writeTasksSnapshot,
  type ContainerOutput,
} from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTaskAfterRun,
} from './db.js';
import { isFastPathEligible, runFastPath } from './fast-path.js';
import { readGroupGeminiMd } from './group-manager.js';
import { logger } from './logger.js';
import { isMaintenanceMode } from './maintenance.js';
import { getEffectiveSystemPrompt } from './personas.js';
import { RegisteredGroup, ScheduledTask, type IpcContext } from './types.js';

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
    // Resolve system prompt: GEMINI.md > group.systemPrompt > persona > default
    const geminiMdContent = readGroupGeminiMd(task.group_folder);
    const systemPrompt = getEffectiveSystemPrompt(
      geminiMdContent || group.systemPrompt,
      group.persona,
    );

    // Enrich prompt with current time so Gemini doesn't need to call bash
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'medium' });
    const enrichedPrompt = `[Current time: ${timeStr}]\n[This is an automated scheduled task. Respond with text directly.]\n\n${task.prompt}`;

    // Choose execution path: fast path (preferred) or container fallback
    let output: ContainerOutput;
    const effectiveChatJid = chatJid || task.chat_jid;

    if (isFastPathEligible(group, false)) {
      logger.info(
        { taskId: task.id, group: task.group_folder },
        'Scheduled task using fast path',
      );

      const ipcContext: IpcContext = {
        sourceGroup: task.group_folder,
        isMain,
        registeredGroups: deps.registeredGroups(),
        sendMessage: deps.sendMessage,
      };

      output = await runFastPath(
        group,
        {
          prompt: enrichedPrompt,
          groupFolder: task.group_folder,
          chatJid: effectiveChatJid,
          isMain,
          systemPrompt,
          enableWebSearch: group.enableWebSearch ?? true,
          conversationHistory: [], // Scheduled tasks use independent context
        },
        ipcContext,
      );
    } else {
      logger.info(
        { taskId: task.id, group: task.group_folder },
        'Scheduled task using container path',
      );

      output = await runContainerAgent(group, {
        prompt: enrichedPrompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: effectiveChatJid,
        isMain,
        isScheduledTask: true,
        systemPrompt: geminiMdContent || group.systemPrompt,
        enableWebSearch: group.enableWebSearch ?? true,
      });
    }

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else {
      result = output.result;

      if (chatJid && result) {
        try {
          // Embed sentinel in result so plugins (e.g. google-tasks) can still detect it
          // but users see the actual content, not a raw sentinel
          await deps.sendMessage(chatJid, `${result}\n\n@task-complete:${task.id}`);
        } catch (sendErr) {
          logger.warn(
            { taskId: task.id, sendErr },
            'Failed to send task result',
          );
        }
      } else if (chatJid && !result) {
        // No result — log internally, don't send confusing sentinel to user
        logger.warn({ taskId: task.id }, 'Task produced no text output');
      }
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
  const limiter = new ConcurrencyLimiter(SCHEDULER.CONCURRENCY);

  logger.info(
    {
      concurrency: SCHEDULER.CONCURRENCY,
      recommended: SCHEDULER.getRecommendedConcurrency(),
    },
    'Scheduler started',
  );

  let stopped = false;
  let currentTimeout: NodeJS.Timeout | null = null;

  const loop = async () => {
    if (stopped) return;

    try {
      // Skip task processing in maintenance mode
      if (isMaintenanceMode()) {
        logger.debug('Scheduler skipping: maintenance mode active');
        if (!stopped) {
          currentTimeout = setTimeout(loop, SCHEDULER.POLL_INTERVAL_MS);
        }
        return;
      }

      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      // Fetch all tasks once per tick and pass cached list to each runTask call
      const allTasksSnapshot = dueTasks.length > 0 ? getAllTasks() : [];

      // Filter to valid tasks, then run in parallel with concurrency limit
      const validTasks = dueTasks.filter((task) => {
        const current = getTaskById(task.id);
        return current && current.status === 'active';
      });

      await Promise.allSettled(
        validTasks.map((task) =>
          limiter.run(() => runTask(task, deps, allTasksSnapshot)),
        ),
      );
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    if (!stopped) {
      currentTimeout = setTimeout(loop, SCHEDULER.POLL_INTERVAL_MS);
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
