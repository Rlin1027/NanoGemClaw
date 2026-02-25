/**
 * NanoGemClaw App Entry Point
 *
 * Wires up all packages (core, db, gemini, telegram, server, plugin-api)
 * and manages the application lifecycle including plugin loading.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  GROUPS_DIR,
  STORE_DIR,
  saveJson,
} from '@nanogemclaw/core';
import { logger } from '@nanogemclaw/core/logger';

import {
  loadPlugins,
  discoverAndLoadPlugins,
  initPlugins,
  startPlugins,
  stopPlugins,
  getPluginRoutes,
  getPluginGeminiTools,
  getPluginIpcHandlers,
} from './plugin-loader.js';

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Starting NanoGemClaw...');

  // Initialize directories
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.mkdirSync(GROUPS_DIR, { recursive: true });

  // Initialize database
  const { initDatabase, closeDatabase, getDatabase } = await import('@nanogemclaw/db');
  initDatabase();
  const dbInstance = getDatabase();

  // Initialize search index (after database init)
  const { initSearchIndex } = await import('../../src/search.js');
  initSearchIndex(dbInstance);

  // Initialize knowledge base index
  const { initKnowledgeIndex } = await import('../../src/knowledge.js');
  initKnowledgeIndex(dbInstance);

  // Load state and maintenance
  const { loadState, saveState, registerGroup } = await import('../../src/group-manager.js');
  const { loadMaintenanceState } = await import('../../src/maintenance.js');
  await loadState();
  loadMaintenanceState();

  // Load custom personas
  const { loadCustomPersonas } = await import('../../src/personas.js');
  loadCustomPersonas();

  // Load IPC handlers (builtins)
  const { loadBuiltinHandlers } = await import('../../src/ipc-handlers/index.js');
  await loadBuiltinHandlers();

  // Load plugins
  const manifestPath = path.join(DATA_DIR, 'plugins.json');
  const projectRoot = path.resolve(DATA_DIR, '..');
  const { getRegisteredGroups } = await import('../../src/state.js');
  const { sendMessage } = await import('../../src/telegram-helpers.js');

  await discoverAndLoadPlugins(
    manifestPath,
    {
      getDatabase: () => dbInstance,
      sendMessage,
      getGroups: () => getRegisteredGroups() as any,
      dataDir: DATA_DIR,
    },
    {
      pluginsDir: path.join(projectRoot, 'plugins'),
      nodeModulesDir: path.join(projectRoot, 'node_modules'),
    },
  );

  // Register plugin IPC handlers
  const pluginIpcHandlers = getPluginIpcHandlers();
  if (pluginIpcHandlers.length > 0) {
    const { registerHandler } = await import('../../src/ipc-handlers/index.js');
    for (const handler of pluginIpcHandlers) {
      registerHandler(handler as any);
    }
  }

  // Initialize plugins (DB migrations, config loading)
  await initPlugins();

  // Start health check server
  const { setHealthCheckDependencies, startHealthCheckServer } =
    await import('../../src/health-check.js');
  setHealthCheckDependencies({
    getGroupCount: () => Object.keys(getRegisteredGroups()).length,
  });
  startHealthCheckServer();

  // Start Dashboard Server
  const { createDashboardServer } = await import('@nanogemclaw/server');
  const { getActiveTaskCountsBatch, getMessageCountsBatch, getErrorState } =
    await import('@nanogemclaw/db');

  const server = createDashboardServer({
    dashboardPort: 3000,
    dashboardHost: process.env.DASHBOARD_HOST || '127.0.0.1',
    accessCode: process.env.DASHBOARD_ACCESS_CODE,
    apiKey: process.env.DASHBOARD_API_KEY,
    groupsDir: GROUPS_DIR,
    getGroups: () => {
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
          persona: group.persona,
          requireTrigger: group.requireTrigger,
          enableWebSearch: group.enableWebSearch,
          enableFastPath: group.enableFastPath,
          folder: group.folder,
        };
      });
    },
    registerGroup: (chatId: string, name: string) => {
      const folder = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      registerGroup(chatId, {
        name,
        folder,
        trigger: `@${ASSISTANT_NAME}`,
        added_at: new Date().toISOString(),
      });
      return { id: folder, name, folder };
    },
    updateGroup: (folder: string, updates: Record<string, any>) => {
      const registeredGroups = getRegisteredGroups();
      const entry = Object.entries(registeredGroups).find(([, g]) => g.folder === folder);
      if (!entry) return null;
      const [chatId, group] = entry;

      if (updates.persona !== undefined) group.persona = updates.persona;
      if (updates.enableWebSearch !== undefined) group.enableWebSearch = updates.enableWebSearch;
      if (updates.requireTrigger !== undefined) group.requireTrigger = updates.requireTrigger;
      if (updates.name !== undefined) group.name = updates.name;
      if (updates.enableFastPath !== undefined) group.enableFastPath = updates.enableFastPath;

      if (updates.persona !== undefined || updates.enableWebSearch !== undefined) {
        import('@nanogemclaw/gemini/cache')
          .then(({ invalidateCache }) => { invalidateCache(folder); })
          .catch(() => {});
      }

      registeredGroups[chatId] = group;
      saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);
      return { ...group, id: folder };
    },
    resolveChatJid: (folder: string) => {
      const registeredGroups = getRegisteredGroups();
      const entry = Object.entries(registeredGroups).find(([, g]) => g.folder === folder);
      return entry ? entry[0] : null;
    },
  });

  // Mount plugin routes
  const pluginRoutes = getPluginRoutes();
  for (const { pluginId, contribution } of pluginRoutes) {
    const prefix = `/api/plugins/${pluginId}/${contribution.prefix}`;
    server.app.use(prefix, contribution.createRouter());
    logger.info({ pluginId, prefix }, 'Plugin route mounted');
  }

  server.start();

  // Wire container-runner → server dashboard event bridge
  const { setDashboardEventEmitter } = await import('../../src/container-runner.js');
  setDashboardEventEmitter(server.emitDashboardEvent);

  // Start automatic database backup
  const { startBackupSchedule } = await import('../../src/backup.js');
  startBackupSchedule();

  // Start plugins (background services)
  await startPlugins();

  // Connect to Telegram (starts bot + background services)
  const { connectTelegram } = await import('../../src/telegram-bot.js');
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
    // Stop plugins first
    await stopPlugins();

    // Stop health check server
    const { stopHealthCheckServer } = await import('../../src/health-check.js');
    await stopHealthCheckServer();

    // Stop Telegram polling
    const { getBot, getTypingIntervals } = await import('../../src/state.js');
    const bot = getBot();
    await bot?.stopPolling();

    // Stop backup schedule
    const { stopBackupSchedule } = await import('../../src/backup.js');
    stopBackupSchedule();

    // Clean up typing intervals
    const typingIntervals = getTypingIntervals();
    for (const interval of typingIntervals.values()) clearInterval(interval);
    typingIntervals.clear();

    // Clean up IPC watchers
    const { closeAllWatchers } = await import('../../src/ipc-watcher.js');
    closeAllWatchers();

    // Clean up consolidator + rate limiter
    const { messageConsolidator } = await import('@nanogemclaw/telegram/consolidator');
    messageConsolidator.destroy();
    const { telegramRateLimiter } = await import('@nanogemclaw/telegram/rate-limiter');
    telegramRateLimiter.destroy();

    // Save state and close database
    const { saveState } = await import('../../src/group-manager.js');
    const { closeDatabase } = await import('@nanogemclaw/db');
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
