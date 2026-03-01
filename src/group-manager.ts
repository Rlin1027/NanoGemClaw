/**
 * Group Manager - Group registration, state persistence, and group discovery.
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR, MAIN_GROUP_FOLDER } from './config.js';
import { getAllChats, deleteTasksByGroup, deleteFactsByGroup } from './db.js';
import { AvailableGroup } from './container-runner.js';
import { invalidateCache } from './context-cache.js';
import { logger } from './logger.js';
import {
  getRegisteredGroups,
  setRegisteredGroups,
  getSessions,
  setSessions,
  getLastAgentTimestamp,
  setLastAgentTimestamp,
} from './state.js';
import { getEventBus } from '@nanogemclaw/event-bus';
import { RegisteredGroup, GroupStateBag } from './types.js';
import { loadJson, saveJson } from './utils.js';

// ============================================================================
// State Persistence
// ============================================================================

export async function loadState(): Promise<void> {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    language?: string;
  }>(statePath, {});
  setLastAgentTimestamp(state.last_agent_timestamp || {});

  if (state.language) {
    const { setLanguage, availableLanguages } = await import('./i18n/index.js');
    type Language = import('./i18n/index.js').Language;
    if (availableLanguages.includes(state.language as Language)) {
      setLanguage(state.language as Language);
    }
  }

  setSessions(loadJson(path.join(DATA_DIR, 'sessions.json'), {}));
  setRegisteredGroups(
    loadJson(path.join(DATA_DIR, 'registered_groups.json'), {}),
  );
  logger.info(
    { groupCount: Object.keys(getRegisteredGroups()).length },
    'State loaded',
  );
}

export async function saveState(): Promise<void> {
  const { getLanguage } = await import('./i18n/index.js');
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: '',
    last_agent_timestamp: getLastAgentTimestamp(),
    language: getLanguage(),
  });
  saveJson(path.join(DATA_DIR, 'sessions.json'), getSessions());
}

// ============================================================================
// Group Registration
// ============================================================================

export function registerGroup(chatId: string, group: RegisteredGroup): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(group.folder)) {
    logger.warn({ folder: group.folder }, 'Invalid folder name rejected');
    return;
  }
  const registeredGroups = getRegisteredGroups();
  registeredGroups[chatId] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(groupDir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(groupDir, 'knowledge'), { recursive: true });

  // Copy default GEMINI.md from global template if available
  const globalPrompt = path.join(GROUPS_DIR, 'global', 'GEMINI.md');
  const groupPrompt = path.join(groupDir, 'GEMINI.md');
  if (fs.existsSync(globalPrompt) && !fs.existsSync(groupPrompt)) {
    fs.copyFileSync(globalPrompt, groupPrompt);
    logger.info(
      { folder: group.folder },
      'Created default GEMINI.md from global template',
    );
  }

  logger.info(
    { chatId, name: group.name, folder: group.folder },
    'Group registered',
  );

  try {
    getEventBus().emit('group:registered', {
      chatId,
      groupFolder: group.folder,
      name: group.name,
    });
  } catch {}
}

/**
 * Backfill GEMINI.md for all registered groups that are missing it.
 * Called at startup to patch existing groups.
 */
export function ensureGroupDefaults(): void {
  const globalPrompt = path.join(GROUPS_DIR, 'global', 'GEMINI.md');
  if (!fs.existsSync(globalPrompt)) return;

  const registeredGroups = getRegisteredGroups();
  for (const [chatId, group] of Object.entries(registeredGroups)) {
    const groupPrompt = path.join(GROUPS_DIR, group.folder, 'GEMINI.md');
    if (!fs.existsSync(groupPrompt)) {
      fs.copyFileSync(globalPrompt, groupPrompt);
      logger.info(
        { chatId, folder: group.folder },
        'Created default GEMINI.md from global template',
      );
    }
  }
}

// ============================================================================
// Group GEMINI.md Reader
// ============================================================================

/**
 * Read the GEMINI.md system prompt file for a group.
 * Returns the file content if it exists and is non-empty, otherwise undefined.
 */
export function readGroupGeminiMd(groupFolder: string): string | undefined {
  const filePath = path.join(GROUPS_DIR, groupFolder, 'GEMINI.md');
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Group State Accessor
// ============================================================================

/**
 * Get unified state for a group by chat ID.
 * Consolidates config, session, isMain, and derived fields into one bag.
 * Returns null if the chat ID is not registered.
 */
export function getGroupState(chatId: string): GroupStateBag | null {
  const registeredGroups = getRegisteredGroups();
  const config = registeredGroups[chatId];
  if (!config) return null;

  const sessions = getSessions();
  const isMain = config.folder === MAIN_GROUP_FOLDER;

  return {
    config,
    chatId,
    sessionId: sessions[config.folder],
    isMain,
    groupDir: path.join(GROUPS_DIR, config.folder),
    hasContextCache: false, // Will be enriched by caller if needed
  };
}

// ============================================================================
// Group Unregistration
// ============================================================================

/**
 * Unregister a group and clean up all associated resources:
 * - Scheduled tasks and their run logs
 * - Context cache
 * - Session entry
 * Does NOT delete the group directory (preserves history).
 */
export function unregisterGroup(folder: string): boolean {
  const registeredGroups = getRegisteredGroups();
  const entry = Object.entries(registeredGroups).find(
    ([, g]) => g.folder === folder,
  );
  if (!entry) return false;
  const [chatId] = entry;

  // Clean up scheduled tasks
  try {
    const deletedTasks = deleteTasksByGroup(folder);
    if (deletedTasks > 0) {
      logger.info(
        { folder, deletedTasks },
        'Cleaned up scheduled tasks for unregistered group',
      );
    }
  } catch (err) {
    logger.warn(
      { folder, err },
      'Failed to clean up tasks during unregistration',
    );
  }

  // Clean up facts
  try {
    const deletedFacts = deleteFactsByGroup(folder);
    if (deletedFacts > 0) {
      logger.info(
        { folder, deletedFacts },
        'Cleaned up facts for unregistered group',
      );
    }
  } catch (err) {
    logger.warn(
      { folder, err },
      'Failed to clean up facts during unregistration',
    );
  }

  // Invalidate context cache
  invalidateCache(folder).catch(() => {
    // Best-effort cache cleanup
  });

  // Clean up session
  const sessions = getSessions();
  if (sessions[folder]) {
    delete sessions[folder];
    saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
  }

  // Remove from registered groups
  delete registeredGroups[chatId];
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);
  logger.info(
    { chatId, folder },
    'Group unregistered (tasks, cache, session cleaned)',
  );

  try {
    getEventBus().emit('group:unregistered', { chatId, groupFolder: folder });
  } catch {}
  return true;
}

// ============================================================================
// Group Name Sync
// ============================================================================

export function updateGroupName(chatId: string, newName: string): boolean {
  const registeredGroups = getRegisteredGroups();
  const group = registeredGroups[chatId];
  if (!group || group.name === newName) return false;
  const oldName = group.name;
  group.name = newName;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);
  logger.info({ chatId, oldName, newName }, 'Group name synced from Telegram');

  try {
    getEventBus().emit('group:updated', {
      groupFolder: group.folder,
      changes: { name: newName },
    });
  } catch {}
  return true;
}

// ============================================================================
// Group Discovery
// ============================================================================

export function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredGroups = getRegisteredGroups();
  const registeredIds = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__')
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredIds.has(c.jid),
    }));
}
