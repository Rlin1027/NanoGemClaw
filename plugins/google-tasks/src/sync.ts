/**
 * Bidirectional sync logic between NanoGemClaw scheduled tasks and Google Tasks.
 *
 * Google Tasks is treated as the source of truth for external changes.
 * Sync state is persisted in {dataDir}/sync-state.json.
 */

import fs from 'fs';
import path from 'path';
import { isAuthenticated } from 'nanogemclaw-plugin-google-auth';
import type { PluginApi } from '@nanogemclaw/plugin-api';
import { listTaskLists, listTasks, completeTask } from './tasks-api.js';

// ============================================================================
// Types
// ============================================================================

export interface TaskMapping {
  /** Local NanoGemClaw task ID or title (used for matching) */
  localId: string;
  /** Google Task ID */
  googleTaskId: string;
  /** Google Task list ID the task lives in */
  googleListId: string;
}

export interface SyncState {
  lastSync: string | null;
  taskMappings: TaskMapping[];
}

// ============================================================================
// State persistence
// ============================================================================

function getSyncStatePath(dataDir: string): string {
  return path.join(dataDir, 'sync-state.json');
}

export function loadSyncState(dataDir: string): SyncState {
  const filePath = getSyncStatePath(dataDir);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as SyncState;
    }
  } catch {
    // Corrupt file — start fresh
  }
  return { lastSync: null, taskMappings: [] };
}

export function saveSyncState(dataDir: string, state: SyncState): void {
  const filePath = getSyncStatePath(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  // Atomic write: write to tmp file then rename to prevent corruption
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Add or update a mapping between a local task and a Google Task.
 */
export function upsertTaskMapping(dataDir: string, mapping: TaskMapping): void {
  const state = loadSyncState(dataDir);
  const idx = state.taskMappings.findIndex(
    (m) => m.localId === mapping.localId,
  );
  if (idx >= 0) {
    state.taskMappings[idx] = mapping;
  } else {
    state.taskMappings.push(mapping);
  }
  saveSyncState(dataDir, state);
}

/**
 * Remove a mapping by local ID.
 */
export function removeTaskMapping(dataDir: string, localId: string): void {
  const state = loadSyncState(dataDir);
  state.taskMappings = state.taskMappings.filter((m) => m.localId !== localId);
  saveSyncState(dataDir, state);
}

// ============================================================================
// Sync logic
// ============================================================================

/**
 * Main sync function. Pulls all tasks from Google Tasks and refreshes local
 * tracking state. Should be called periodically (every 15 minutes).
 *
 * Gracefully no-ops when Google Auth is not available.
 */
export async function syncTasks(api: PluginApi): Promise<void> {
  if (!isAuthenticated()) {
    api.logger.debug('Google Tasks sync skipped: not authenticated');
    return;
  }

  try {
    api.logger.info('Google Tasks: starting sync');

    const lists = await listTaskLists();
    const state = loadSyncState(api.dataDir);

    // For each task list, fetch active tasks and refresh mappings
    for (const list of lists) {
      const tasks = await listTasks(list.id, { showCompleted: false });

      // Update mappings: any mapping whose googleListId matches this list
      // should still have a valid googleTaskId
      const listMappings = state.taskMappings.filter(
        (m) => m.googleListId === list.id,
      );

      for (const mapping of listMappings) {
        const stillExists = tasks.some((t) => t.id === mapping.googleTaskId);
        if (!stillExists) {
          // Task was deleted externally — remove from tracking
          api.logger.debug(
            `Google Tasks: removing stale mapping for local task "${mapping.localId}"`,
          );
          state.taskMappings = state.taskMappings.filter(
            (m) => m.localId !== mapping.localId,
          );
        }
      }
    }

    state.lastSync = new Date().toISOString();
    saveSyncState(api.dataDir, state);
    api.logger.info(
      `Google Tasks: sync complete — ${lists.length} list(s) checked`,
    );
  } catch (err) {
    api.logger.error(`Google Tasks: sync failed — ${err}`);
  }
}

/**
 * When a NanoGemClaw scheduled task completes, find the matching Google Task
 * by title and mark it completed.
 *
 * @param dataDir Plugin data directory (for sync-state.json)
 * @param localTaskId The local task ID or title used to locate the mapping
 * @param logger Plugin logger
 */
export async function markGoogleTaskComplete(
  dataDir: string,
  localTaskId: string,
  logger: PluginApi['logger'],
): Promise<void> {
  if (!isAuthenticated()) {
    return;
  }

  const state = loadSyncState(dataDir);
  const mapping = state.taskMappings.find((m) => m.localId === localTaskId);
  if (!mapping) {
    // No tracked Google Task for this local task
    return;
  }

  try {
    await completeTask(mapping.googleListId, mapping.googleTaskId);
    logger.info(
      `Google Tasks: marked task "${localTaskId}" as completed in Google (id: ${mapping.googleTaskId})`,
    );
  } catch (err) {
    logger.warn(
      `Google Tasks: failed to complete remote task "${localTaskId}" — ${err}`,
    );
  }
}

/**
 * Search all tracked task lists for a Google Task by title (case-insensitive).
 * Returns the first match found, or null.
 *
 * **Note**: Title-based matching is inherently ambiguous when multiple tasks
 * share the same name.  A warning is logged when duplicates are detected.
 * Callers should prefer ID-based lookups via task mappings when possible.
 */
export async function findGoogleTaskByTitle(
  title: string,
  logger: PluginApi['logger'],
): Promise<{ task: { id: string; title: string }; listId: string } | null> {
  if (!isAuthenticated()) {
    return null;
  }

  try {
    const lists = await listTaskLists();
    const lower = title.toLowerCase();
    let firstMatch: {
      task: { id: string; title: string };
      listId: string;
    } | null = null;
    let duplicateCount = 0;

    for (const list of lists) {
      const tasks = await listTasks(list.id, { showCompleted: false });
      for (const t of tasks) {
        if (t.title.toLowerCase() === lower) {
          if (!firstMatch) {
            firstMatch = { task: t, listId: list.id };
          } else {
            duplicateCount++;
          }
        }
      }
    }

    if (duplicateCount > 0) {
      logger.warn(
        `Google Tasks: found ${duplicateCount + 1} tasks named "${title}" — ` +
          `returning first match (id: ${firstMatch!.task.id}). Use task mappings for unambiguous lookups.`,
      );
    }

    return firstMatch;
  } catch (err) {
    logger.warn(`Google Tasks: title search failed — ${err}`);
  }

  return null;
}
