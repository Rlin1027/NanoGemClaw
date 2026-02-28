/**
 * Group Manager - Group registration, state persistence, and group discovery.
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';
import { getAllChats } from './db.js';
import { AvailableGroup } from './container-runner.js';
import { logger } from './logger.js';
import {
  getRegisteredGroups,
  setRegisteredGroups,
  getSessions,
  setSessions,
  getLastAgentTimestamp,
  setLastAgentTimestamp,
} from './state.js';
import { RegisteredGroup } from './types.js';
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

  logger.info(
    { chatId, name: group.name, folder: group.folder },
    'Group registered',
  );
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
