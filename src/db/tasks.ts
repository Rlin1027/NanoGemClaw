import { ScheduledTask, TaskRunLog } from '../types.js';
import { getDatabase } from './connection.js';
import { getEventBus } from '@nanogemclaw/event-bus';

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );

  try {
    getEventBus().emit('task:created', {
      taskId: task.id,
      groupFolder: task.group_folder,
    });
  } catch {}
}

export function getTaskById(id: string): ScheduledTask | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const ALLOWED_COLUMNS = new Set([
    'prompt',
    'schedule_type',
    'schedule_value',
    'next_run',
    'status',
  ]);
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  for (const field of fields) {
    const col = field.split(' ')[0];
    if (!ALLOWED_COLUMNS.has(col)) {
      throw new Error(`Invalid column: ${col}`);
    }
  }

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  const db = getDatabase();
  // Delete child records first (FK constraint)
  const deleteTx = db.transaction((taskId: string) => {
    db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);
  });
  deleteTx(id);
}

/**
 * Delete all tasks (and their run logs) for a group folder.
 * Used during group unregistration to clean up resources.
 * Returns the number of tasks deleted.
 */
export function deleteTasksByGroup(groupFolder: string): number {
  const db = getDatabase();
  const deleteTx = db.transaction((folder: string) => {
    // Get task IDs first to delete run logs
    const taskIds = db
      .prepare('SELECT id FROM scheduled_tasks WHERE group_folder = ?')
      .all(folder) as Array<{ id: string }>;

    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => '?').join(',');
      const ids = taskIds.map((t) => t.id);
      db.prepare(
        `DELETE FROM task_run_logs WHERE task_id IN (${placeholders})`,
      ).run(...ids);
    }

    const result = db
      .prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?')
      .run(folder);
    return result.changes;
  });
  return deleteTx(groupFolder);
}

export function getDueTasks(): ScheduledTask[] {
  const db = getDatabase();
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

export function getAllTasksPaginated(
  limit: number,
  offset: number,
): { rows: ScheduledTask[]; total: number } {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM scheduled_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(limit, offset) as ScheduledTask[];
  const { total } = db
    .prepare('SELECT COUNT(*) as total FROM scheduled_tasks')
    .get() as { total: number };
  return { rows, total };
}

export function getTasksForGroupPaginated(
  groupFolder: string,
  limit: number,
  offset: number,
): { rows: ScheduledTask[]; total: number } {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(groupFolder, limit, offset) as ScheduledTask[];
  const { total } = db
    .prepare(
      'SELECT COUNT(*) as total FROM scheduled_tasks WHERE group_folder = ?',
    )
    .get(groupFolder) as { total: number };
  return { rows, total };
}

/**
 * Batch: Get active task counts for all groups at once.
 * Returns Map<folder, activeCount>
 */
/**
 * Get task run logs with joined task details (prompt, group_folder, schedule_type).
 * Used by the Activity Logs page.
 */
export function getTaskRunLogsWithDetails(
  days: number,
  groupFolder?: string,
): Array<
  TaskRunLog & { prompt: string; group_folder: string; schedule_type: string }
> {
  const db = getDatabase();
  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  if (groupFolder) {
    return db
      .prepare(
        `
      SELECT trl.task_id, trl.run_at, trl.duration_ms, trl.status, trl.result, trl.error,
             st.prompt, st.group_folder, st.schedule_type
      FROM task_run_logs trl
      JOIN scheduled_tasks st ON trl.task_id = st.id
      WHERE trl.run_at >= ? AND st.group_folder = ?
      ORDER BY trl.run_at DESC
    `,
      )
      .all(cutoff, groupFolder) as Array<
      TaskRunLog & {
        prompt: string;
        group_folder: string;
        schedule_type: string;
      }
    >;
  }

  return db
    .prepare(
      `
    SELECT trl.task_id, trl.run_at, trl.duration_ms, trl.status, trl.result, trl.error,
           st.prompt, st.group_folder, st.schedule_type
    FROM task_run_logs trl
    JOIN scheduled_tasks st ON trl.task_id = st.id
    WHERE trl.run_at >= ?
    ORDER BY trl.run_at DESC
  `,
    )
    .all(cutoff) as Array<
    TaskRunLog & {
      prompt: string;
      group_folder: string;
      schedule_type: string;
    }
  >;
}

/**
 * Get tasks that fall within a date range.
 * Returns active/paused cron/interval tasks + once tasks with next_run in range.
 */
export function getTasksInDateRange(
  start: string,
  end: string,
): ScheduledTask[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE (
      (schedule_type IN ('cron', 'interval') AND status IN ('active', 'paused'))
      OR
      (schedule_type = 'once' AND next_run >= ? AND next_run <= ?)
    )
    ORDER BY created_at DESC
  `,
    )
    .all(start, end) as ScheduledTask[];
}

export function getActiveTaskCountsBatch(): Map<string, number> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
    SELECT group_folder, COUNT(*) as cnt
    FROM scheduled_tasks WHERE status = 'active'
    GROUP BY group_folder
  `,
    )
    .all() as Array<{ group_folder: string; cnt: number }>;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.group_folder, row.cnt);
  return map;
}
