/**
 * Compounder Scheduler — Registers and manages system cron tasks
 * for the Memory Compounder's daily/weekly compaction pipeline.
 *
 * Uses the existing scheduled_tasks infrastructure with a `_system_compounder`
 * group_folder prefix to hide from user-facing APIs.
 *
 * System tasks:
 *   - `_sys_daily_compaction`: Runs daily, compacts short→medium via Flash
 *   - `_sys_weekly_synthesis`: Runs weekly, synthesizes medium→long via Pro
 */

import { CronExpressionParser } from 'cron-parser';

import { MEMORY_COMPOUNDER, SYSTEM_TASK_PREFIX, TIMEZONE } from './config.js';
import { createTask, getTaskById } from './db.js';
import { logger } from './logger.js';
import {
  runDailyCompaction,
  runWeeklySynthesis,
  updateShortTermMemory,
} from './memory-compounder.js';
import type { RegisteredGroup } from './types.js';

// ============================================================================
// System Task IDs
// ============================================================================

const DAILY_COMPACTION_ID = '_sys_daily_compaction';
const WEEKLY_SYNTHESIS_ID = '_sys_weekly_synthesis';
const SYSTEM_GROUP = `${SYSTEM_TASK_PREFIX}compounder`;

// ============================================================================
// Task Registration
// ============================================================================

/**
 * Ensure system cron tasks exist in the database.
 * Called once at startup. Idempotent — skips if tasks already exist.
 */
export function registerCompactionTasks(): void {
  if (!MEMORY_COMPOUNDER.ENABLED) {
    logger.info(
      'Memory Compounder disabled — skipping system task registration',
    );
    return;
  }

  const hour = MEMORY_COMPOUNDER.DAILY_COMPACTION_HOUR;
  const dailyCron = `0 ${hour} * * *`; // Every day at configured hour

  const weekDay = MEMORY_COMPOUNDER.WEEKLY_SYNTHESIS_DAY;
  const weekHour = MEMORY_COMPOUNDER.WEEKLY_SYNTHESIS_HOUR;
  const weeklyCron = `0 ${weekHour} * * ${weekDay}`; // Weekly at configured day/hour

  // Register daily compaction task
  if (!getTaskById(DAILY_COMPACTION_ID)) {
    const nextRun = CronExpressionParser.parse(dailyCron, { tz: TIMEZONE })
      .next()
      .toISOString();
    createTask({
      id: DAILY_COMPACTION_ID,
      group_folder: SYSTEM_GROUP,
      chat_jid: '',
      prompt: '[SYSTEM] Daily memory compaction: short-term → medium-term',
      schedule_type: 'cron',
      schedule_value: dailyCron,
      context_mode: 'isolated',
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });
    logger.info(
      { taskId: DAILY_COMPACTION_ID, cron: dailyCron, nextRun },
      'Registered daily compaction system task',
    );
  }

  // Register weekly synthesis task
  if (!getTaskById(WEEKLY_SYNTHESIS_ID)) {
    const nextRun = CronExpressionParser.parse(weeklyCron, { tz: TIMEZONE })
      .next()
      .toISOString();
    createTask({
      id: WEEKLY_SYNTHESIS_ID,
      group_folder: SYSTEM_GROUP,
      chat_jid: '',
      prompt:
        '[SYSTEM] Weekly memory synthesis: medium-term → long-term + GEMINI.md update',
      schedule_type: 'cron',
      schedule_value: weeklyCron,
      context_mode: 'isolated',
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });
    logger.info(
      { taskId: WEEKLY_SYNTHESIS_ID, cron: weeklyCron, nextRun },
      'Registered weekly synthesis system task',
    );
  }
}

// ============================================================================
// System Task Execution
// ============================================================================

/**
 * Check if a task ID is a system compaction task.
 */
export function isCompactionTask(taskId: string): boolean {
  return taskId === DAILY_COMPACTION_ID || taskId === WEEKLY_SYNTHESIS_ID;
}

/**
 * Execute a system compaction task.
 * Called by the task scheduler when a system task is due.
 *
 * @returns Result summary string for task run log.
 */
export async function executeCompactionTask(
  taskId: string,
  getGroups: () => Record<string, RegisteredGroup>,
): Promise<string> {
  const groups = Object.values(getGroups());

  if (taskId === DAILY_COMPACTION_ID) {
    logger.info('Running daily memory compaction for all groups');

    // First update short-term memories from recent messages
    const groupEntries = Object.entries(getGroups());
    for (const [chatJid, group] of groupEntries) {
      try {
        await updateShortTermMemory(group, chatJid);
      } catch (err) {
        logger.warn(
          {
            group: group.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'Short-term update failed for group',
        );
      }
    }

    // Then compact short→medium
    const { updated, errors } = await runDailyCompaction(groups);
    return `Daily compaction: ${updated} groups updated, ${errors} errors`;
  }

  if (taskId === WEEKLY_SYNTHESIS_ID) {
    logger.info('Running weekly memory synthesis for all groups');
    const { updated, errors } = await runWeeklySynthesis(groups);
    return `Weekly synthesis: ${updated} groups updated, ${errors} errors`;
  }

  throw new Error(`Unknown system task: ${taskId}`);
}
