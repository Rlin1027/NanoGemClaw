/**
 * IPC Watcher - File-based inter-process communication with containers.
 * Watches for IPC message and task files, processes them, and dispatches to handlers.
 */
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  CONTAINER,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
} from './config.js';
import { logger } from './logger.js';
import {
  getBot,
  getRegisteredGroups,
  getIpcMessageSentChats,
} from './state.js';
import { sendMessage } from './telegram-helpers.js';
import { registerGroup } from './group-manager.js';
import { formatError } from './utils.js';

// Track active watchers for cleanup
const watchers: fs.FSWatcher[] = [];

/**
 * Close all active file system watchers.
 * Called during graceful shutdown.
 */
export function closeAllWatchers(): void {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Ignore close errors during shutdown
    }
  }
  watchers.length = 0;
}

// ============================================================================
// IPC Task Processing
// ============================================================================

async function processTaskIpc(
  data: Record<string, any>,
  sourceGroup: string,
  isMain: boolean,
): Promise<void> {
  const { dispatchIpc } = await import('./ipc-handlers/index.js');

  const registeredGroups = getRegisteredGroups();
  const bot = getBot();

  const context: import('./types.js').IpcContext = {
    sourceGroup,
    isMain,
    registeredGroups,
    sendMessage,
    registerGroup,
    bot,
  };

  await dispatchIpc(data, context);
}

// ============================================================================
// IPC File Watcher
// ============================================================================

export function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  // Debounce mechanism to batch file system events
  let pendingProcess = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleProcess = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!pendingProcess) {
        pendingProcess = true;
        processIpcFiles().finally(() => {
          pendingProcess = false;
        });
      }
    }, CONTAINER.IPC_DEBOUNCE_MS);
  };

  const processIpcFiles = async () => {
    const registeredGroups = getRegisteredGroups();
    const ipcMessageSentChats = getIpcMessageSentChats();

    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        try {
          const stat = fs.statSync(path.join(ipcBaseDir, f));
          return stat.isDirectory() && f !== 'errors';
        } catch {
          return false;
        }
      });
    } catch (err) {
      logger.error(
        { err: formatError(err) },
        'Error reading IPC base directory',
      );
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Ensure directories exist and watch them
      for (const dir of [messagesDir, tasksDir]) {
        fs.mkdirSync(dir, { recursive: true });
        setupWatcher(dir);
      }

      // Process messages
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await sendMessage(
                    data.chatJid,
                    `${ASSISTANT_NAME}: ${data.text}`,
                  );
                  ipcMessageSentChats.add(data.chatJid);
                  logger.info(
                    { chatId: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatId: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err: formatError(err) },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err: formatError(err), sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err: formatError(err) },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err: formatError(err), sourceGroup },
          'Error reading IPC tasks directory',
        );
      }
    }
  };

  // Set up fs.watch for a directory
  const watchedDirs = new Set<string>();
  const setupWatcher = (dir: string) => {
    if (watchedDirs.has(dir)) return;

    try {
      const watcher = fs.watch(
        dir,
        { persistent: false },
        (eventType, filename) => {
          if (filename && filename.endsWith('.json')) {
            scheduleProcess();
          }
        },
      );

      watcher.on('error', (err) => {
        logger.debug(
          { dir, err: formatError(err) },
          'Watch error, will use polling fallback',
        );
        // Memory fix: close errored watcher and remove from tracking
        try {
          watcher.close();
        } catch {}
        const idx = watchers.indexOf(watcher);
        if (idx !== -1) watchers.splice(idx, 1);
        watchedDirs.delete(dir);
      });

      watchers.push(watcher);
      watchedDirs.add(dir);
    } catch (err) {
      logger.debug({ dir, err: formatError(err) }, 'Failed to set up watcher');
    }
  };

  // Watch base directory for new group folders
  try {
    const baseWatcher = fs.watch(ipcBaseDir, { persistent: false }, () => {
      scheduleProcess();
    });

    baseWatcher.on('error', (err) => {
      logger.debug({ err: formatError(err) }, 'Base watcher error');
      try {
        baseWatcher.close();
      } catch {}
      const idx = watchers.indexOf(baseWatcher);
      if (idx !== -1) watchers.splice(idx, 1);
    });

    watchers.push(baseWatcher);
  } catch (err) {
    logger.warn(
      { err: formatError(err) },
      'Failed to watch IPC base directory',
    );
  }

  // Initial process and fallback polling (slower interval as safety net)
  processIpcFiles();
  setInterval(() => {
    if (!pendingProcess) {
      processIpcFiles();
    }
  }, IPC_POLL_INTERVAL * CONTAINER.IPC_FALLBACK_POLLING_MULTIPLIER);

  logger.info('IPC watcher started (using fs.watch with polling fallback)');
}
