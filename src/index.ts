/**
 * NanoGemClaw - Personal AI Assistant
 * Telegram Bot Frontend with Gemini CLI Backend
 *
 * Entry point: DI wiring, initialization, and graceful shutdown.
 * All logic has been decomposed into:
 *   - state.ts            (shared mutable state)
 *   - telegram-helpers.ts  (message sending, typing, splitting)
 *   - group-manager.ts     (group registration, state persistence)
 *   - message-handler.ts   (message processing, admin commands, agent execution)
 *   - ipc-watcher.ts       (IPC file watcher)
 *   - telegram-bot.ts      (bot connection, event handlers, background services)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, GROUPS_DIR, STORE_DIR } from './config.js';
import { initDatabase, closeDatabase } from './db.js';
import { loadMaintenanceState } from './maintenance.js';
import { getBot, getRegisteredGroups, getTypingIntervals } from './state.js';
import { loadState, saveState, registerGroup } from './group-manager.js';
import { connectTelegram } from './telegram-bot.js';
import { closeAllWatchers } from './ipc-watcher.js';
import { saveJson } from './utils.js';

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Starting NanoGemClaw...');

  // Initialize directories
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.mkdirSync(GROUPS_DIR, { recursive: true });

  initDatabase();

  // Initialize search index (after database init)
  const { initSearchIndex } = await import('./search.js');
  const { getDatabase } = await import('./db.js');
  const dbInstance = getDatabase();
  initSearchIndex(dbInstance);

  // Initialize knowledge base index
  const { initKnowledgeIndex } = await import('./knowledge.js');
  initKnowledgeIndex(dbInstance);

  await loadState();
  loadMaintenanceState();

  // Load custom personas
  const { loadCustomPersonas } = await import('./personas.js');
  loadCustomPersonas();

  // Load IPC handlers
  const { loadBuiltinHandlers } = await import('./ipc-handlers/index.js');
  await loadBuiltinHandlers();

  // Start health check server
  const { setHealthCheckDependencies, startHealthCheckServer } =
    await import('./health-check.js');
  setHealthCheckDependencies({
    getGroupCount: () => Object.keys(getRegisteredGroups()).length,
  });
  startHealthCheckServer();

  // Check system dependencies
  const { checkFFmpegAvailability, isSTTAvailable } = await import('./stt.js');
  if (isSTTAvailable()) {
    const hasFFmpeg = await checkFFmpegAvailability();
    if (!hasFFmpeg) {
      console.warn(
        '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
      );
      console.warn(
        '\u2551  WARNING: ffmpeg not found on host system                    \u2551',
      );
      console.warn(
        '\u2551  STT audio conversion may fail.                              \u2551',
      );
      console.warn(
        '\u2551  Please install: brew install ffmpeg                         \u2551',
      );
      console.warn(
        '\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d',
      );
    }
  }

  // Start Dashboard Server
  const {
    startDashboardServer,
    setGroupsProvider,
    setGroupRegistrar,
    setGroupUpdater,
    setChatJidResolver,
  } = await import('./server.js');
  const { getActiveTaskCountsBatch, getMessageCountsBatch, getErrorState } =
    await import('./db.js');

  startDashboardServer();

  // Wire up container-runner → server dashboard event bridge
  const { emitDashboardEvent } = await import('./server.js');
  const { setDashboardEventEmitter } = await import('./container-runner.js');
  setDashboardEventEmitter(emitDashboardEvent);

  // Inject data provider
  setGroupsProvider(() => {
    const registeredGroups = getRegisteredGroups();
    const activeTaskCounts = getActiveTaskCountsBatch();
    const messageCounts = getMessageCountsBatch();

    return Object.entries(registeredGroups).map(([chatId, group]) => {
      const activeTasks = activeTaskCounts.get(group.folder) || 0;
      const errorState = getErrorState(group.folder);

      let status = 'idle';
      if (errorState && errorState.consecutiveFailures > 0) status = 'error';

      return {
        id: group.folder,
        name: group.name,
        status,
        messageCount: chatId ? messageCounts.get(chatId) || 0 : 0,
        activeTasks,
        // Extended fields
        persona: group.persona,
        requireTrigger: group.requireTrigger,
        enableWebSearch: group.enableWebSearch,
        enableFastPath: group.enableFastPath,
        folder: group.folder,
      };
    });
  });

  // Inject group registrar
  setGroupRegistrar((chatId: string, name: string) => {
    const folder = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    registerGroup(chatId, {
      name,
      folder,
      trigger: `@${ASSISTANT_NAME}`,
      added_at: new Date().toISOString(),
    });
    return { id: folder, name, folder };
  });

  // Inject group updater for dashboard settings API
  setGroupUpdater((folder: string, updates: Record<string, any>) => {
    const registeredGroups = getRegisteredGroups();
    // Find chatId by folder
    const entry = Object.entries(registeredGroups).find(
      ([, g]) => g.folder === folder,
    );
    if (!entry) return null;

    const [chatId, group] = entry;

    // Apply updates
    if (updates.persona !== undefined) group.persona = updates.persona;
    if (updates.enableWebSearch !== undefined)
      group.enableWebSearch = updates.enableWebSearch;
    if (updates.requireTrigger !== undefined)
      group.requireTrigger = updates.requireTrigger;
    if (updates.name !== undefined) group.name = updates.name;
    if (updates.enableFastPath !== undefined)
      group.enableFastPath = updates.enableFastPath;

    // Invalidate context cache if relevant settings changed
    if (
      updates.persona !== undefined ||
      updates.enableWebSearch !== undefined
    ) {
      import('./context-cache.js')
        .then(({ invalidateCache }) => {
          invalidateCache(folder);
        })
        .catch(() => {});
    }

    // Save
    registeredGroups[chatId] = group;
    saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

    return { ...group, id: folder };
  });

  // Inject chat JID resolver for export API
  setChatJidResolver((folder: string) => {
    const registeredGroups = getRegisteredGroups();
    const entry = Object.entries(registeredGroups).find(
      ([, g]) => g.folder === folder,
    );
    return entry ? entry[0] : null;
  });

  // Start automatic database backup
  const { startBackupSchedule } = await import('./backup.js');
  startBackupSchedule();

  // Connect to Telegram (starts bot + background services)
  await connectTelegram();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down gracefully...`);
  try {
    // Stop health check server
    const { stopHealthCheckServer } = await import('./health-check.js');
    await stopHealthCheckServer();

    // Stop Telegram polling
    const bot = getBot();
    await bot?.stopPolling();

    // Stop backup schedule
    const { stopBackupSchedule } = await import('./backup.js');
    stopBackupSchedule();

    // Clean up typing intervals (memory leak fix)
    const typingIntervals = getTypingIntervals();
    for (const interval of typingIntervals.values()) clearInterval(interval);
    typingIntervals.clear();

    // Clean up IPC watchers (memory leak fix)
    closeAllWatchers();

    // Clean up consolidator + rate limiter
    const { messageConsolidator } = await import('./message-consolidator.js');
    messageConsolidator.destroy();
    const { telegramRateLimiter } = await import('./telegram-rate-limiter.js');
    telegramRateLimiter.destroy();

    // Stop Dashboard server
    const { stopDashboardServer } = await import('./server.js');
    stopDashboardServer();

    // Save state and close database
    await saveState();
    closeDatabase();
    console.log('State saved & database closed. Goodbye!');
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
