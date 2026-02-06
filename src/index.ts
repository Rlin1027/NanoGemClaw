/**
 * NanoGemClaw - Personal AI Assistant
 * Telegram Bot Frontend with Gemini CLI Backend
 */
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';

import {
  ASSISTANT_NAME,
  CLEANUP,
  CONTAINER,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  STORE_DIR,
  TELEGRAM,
  TELEGRAM_BOT_TOKEN,
  TIMEZONE,
  TRIGGER_PATTERN,
  GROUPS_DIR,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllTasks,
  getLastGroupSync,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  initDatabase,
  closeDatabase,
  setLastGroupSync,
  storeChatMetadata,
  storeMessage,
  updateChatName,
} from './db.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { NewMessage, RegisteredGroup, Session } from './types.js';
import { loadJson, saveJson, formatError } from './utils.js';

import { logger } from './logger.js';

let bot: TelegramBot;
let lastTimestamp = '';
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};

// ============================================================================
// State Management
// ============================================================================

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: lastTimestamp,
    last_agent_timestamp: lastAgentTimestamp,
  });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

function registerGroup(chatId: string, group: RegisteredGroup): void {
  registeredGroups[chatId] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(groupDir, 'media'), { recursive: true });

  logger.info(
    { chatId, name: group.name, folder: group.folder },
    'Group registered',
  );
}

// ============================================================================
// Media Cleanup
// ============================================================================

function cleanupOldMedia(): void {
  const now = Date.now();
  const maxAge = CLEANUP.MEDIA_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  try {
    // Iterate through all group folders
    const groupFolders = fs.readdirSync(GROUPS_DIR);
    for (const folder of groupFolders) {
      const mediaDir = path.join(GROUPS_DIR, folder, 'media');
      if (!fs.existsSync(mediaDir)) continue;

      const files = fs.readdirSync(mediaDir);
      for (const file of files) {
        const filePath = path.join(mediaDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {
          // Ignore individual file errors
        }
      }
    }

    if (deletedCount > 0) {
      logger.info({ deletedCount }, 'Old media files cleaned up');
    }
  } catch (err) {
    logger.error({ err: formatError(err) }, 'Error during media cleanup');
  }
}

function startMediaCleanupScheduler(): void {
  // Run immediately on startup
  cleanupOldMedia();
  // Then run periodically
  setInterval(cleanupOldMedia, CLEANUP.MEDIA_CLEANUP_INTERVAL_MS);
  logger.info({ intervalHours: CLEANUP.MEDIA_CLEANUP_INTERVAL_HOURS }, 'Media cleanup scheduler started');
}

// ============================================================================
// Media Handling
// ============================================================================

interface MediaInfo {
  type: 'photo' | 'voice' | 'audio' | 'video' | 'document';
  fileId: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

function extractMediaInfo(msg: TelegramBot.Message): MediaInfo | null {
  if (msg.photo && msg.photo.length > 0) {
    // Get highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    return {
      type: 'photo',
      fileId: photo.file_id,
      caption: msg.caption,
    };
  }
  if (msg.voice) {
    return {
      type: 'voice',
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type,
    };
  }
  if (msg.audio) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type,
    };
  }
  if (msg.video) {
    return {
      type: 'video',
      fileId: msg.video.file_id,
      mimeType: msg.video.mime_type,
      caption: msg.caption,
    };
  }
  if (msg.document) {
    return {
      type: 'document',
      fileId: msg.document.file_id,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      caption: msg.caption,
    };
  }
  return null;
}

async function downloadMedia(
  fileId: string,
  groupFolder: string,
  fileName?: string,
): Promise<string | null> {
  try {
    const fileInfo = await bot.getFile(fileId);
    if (!fileInfo.file_path) return null;

    const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    const ext = path.extname(fileInfo.file_path) || '.bin';
    const finalName = fileName || `${Date.now()}${ext}`;
    const localPath = path.join(mediaDir, finalName);

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      https.get(fileUrl, (response) => {
        // Check for successful HTTP response
        if (response.statusCode !== 200) {
          fs.unlink(localPath, () => { });
          reject(new Error(`HTTP ${response.statusCode}: Failed to download media`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(localPath, () => { });
        reject(err);
      });
    });

    logger.debug({ localPath }, 'Media downloaded');
    return localPath;
  } catch (err) {
    logger.error({ err, fileId }, 'Failed to download media');
    return null;
  }
}

// ============================================================================
// Admin Commands (Main Group Only)
// ============================================================================

const ADMIN_COMMANDS = {
  stats: 'Show usage statistics',
  groups: 'List all registered groups',
  tasks: 'List all scheduled tasks',
  help: 'Show available admin commands',
} as const;

async function handleAdminCommand(
  command: string,
  args: string[],
): Promise<string> {
  const { getAllTasks, getUsageStats } = await import('./db.js');

  switch (command) {
    case 'stats': {
      const groupCount = Object.keys(registeredGroups).length;
      const uptime = process.uptime();
      const uptimeHours = Math.floor(uptime / 3600);
      const uptimeMinutes = Math.floor((uptime % 3600) / 60);

      // Get usage stats
      const usage = getUsageStats();
      const avgDuration = usage.total_requests > 0
        ? Math.round(usage.avg_duration_ms / 1000)
        : 0;

      return `📊 **NanoGemClaw Stats**

• Registered Groups: ${groupCount}
• Uptime: ${uptimeHours}h ${uptimeMinutes}m
• Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

📈 **Usage Analytics**
• Total Requests: ${usage.total_requests}
• Avg Response Time: ${avgDuration}s
• Total Tokens: ${usage.total_prompt_tokens + usage.total_response_tokens}`;
    }

    case 'groups': {
      const groups = Object.values(registeredGroups);
      if (groups.length === 0) {
        return '📁 No groups registered.';
      }

      const groupList = groups.map((g, i) => {
        const isMain = g.folder === MAIN_GROUP_FOLDER;
        const searchStatus = g.enableWebSearch !== false ? '🔍' : '';
        const hasPrompt = g.systemPrompt ? '💬' : '';
        return `${i + 1}. **${g.name}** ${isMain ? '(main)' : ''} ${searchStatus}${hasPrompt}
   📁 ${g.folder} | 🎯 ${g.trigger}`;
      }).join('\n');

      return `📁 **Registered Groups** (${groups.length})

${groupList}

Legend: 🔍=Search 💬=Custom Prompt`;
    }

    case 'tasks': {
      const tasks = getAllTasks();
      if (tasks.length === 0) {
        return '📅 No scheduled tasks.';
      }

      const taskList = tasks.slice(0, 10).map((t, i) => {
        const status = t.status === 'active' ? '✅' : t.status === 'paused' ? '⏸️' : '✓';
        const nextRun = t.next_run ? new Date(t.next_run).toLocaleString() : 'N/A';
        return `${i + 1}. ${status} **${t.group_folder}**
   📋 ${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? '...' : ''}
   ⏰ ${t.schedule_type}: ${t.schedule_value} | Next: ${nextRun}`;
      }).join('\n');

      const moreText = tasks.length > 10 ? `\n\n_...and ${tasks.length - 10} more tasks_` : '';

      return `📅 **Scheduled Tasks** (${tasks.length})

${taskList}${moreText}`;
    }

    case 'help':
    default: {
      const commandList = Object.entries(ADMIN_COMMANDS)
        .map(([cmd, desc]) => `• \`/admin ${cmd}\` - ${desc}`)
        .join('\n');

      return `🛠️ **Admin Commands**

${commandList}

_Admin commands are only available in the main group._`;
    }
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process an incoming message.
 * Concurrency is handled at the container level (container-runner.ts).
 */
async function processMessage(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id.toString();
  const group = registeredGroups[chatId];
  if (!group) return;

  // Extract content (text or caption)
  let content = msg.text || msg.caption || '';
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Handle admin commands (main group only)
  if (isMainGroup && content.startsWith('/admin')) {
    const parts = content.slice(7).trim().split(/\s+/);
    const adminCmd = parts[0] || 'help';
    const adminArgs = parts.slice(1);

    try {
      const response = await handleAdminCommand(adminCmd, adminArgs);
      await sendMessage(chatId, response);
    } catch (err) {
      logger.error({ err: formatError(err) }, 'Admin command failed');
      await sendMessage(chatId, '❌ Admin command failed. Check logs for details.');
    }
    return;
  }

  // Main group responds to all messages; other groups require trigger prefix
  if (!isMainGroup && !TRIGGER_PATTERN.test(content)) return;

  // Handle media if present
  const mediaInfo = extractMediaInfo(msg);
  let mediaPath: string | null = null;

  if (mediaInfo) {
    mediaPath = await downloadMedia(mediaInfo.fileId, group.folder, mediaInfo.fileName);
    if (mediaPath) {
      // Add media reference to content for the agent
      const containerMediaPath = `/workspace/group/media/${path.basename(mediaPath)}`;
      content = `[Media: ${mediaInfo.type} at ${containerMediaPath}]\n${content}`;
    }
  }

  // Get all messages since last agent interaction
  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  const missedMessages = getMessagesSince(
    chatId,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  const lines = missedMessages.map((m) => {
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`;
  });
  const prompt = `<messages>\n${lines.join('\n')}\n</messages>`;

  if (!prompt) return;

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  await setTyping(chatId, true);
  const response = await runAgent(group, prompt, chatId);
  await setTyping(chatId, false);

  if (response) {
    const timestamp = new Date(msg.date * 1000).toISOString();
    lastAgentTimestamp[chatId] = timestamp;
    await sendMessage(chatId, `${ASSISTANT_NAME}: ${response}`);
  }
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatId: string,
): Promise<string | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
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

  // Update available groups snapshot
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  try {
    const output = await runContainerAgent(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid: chatId, // Using chatId as chatJid for compatibility
      isMain,
      systemPrompt: group.systemPrompt,
      enableWebSearch: group.enableWebSearch ?? true, // Default: enabled
    });

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return null;
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return null;
  }
}

// ============================================================================
// Telegram Helpers
// ============================================================================

async function setTyping(chatId: string, isTyping: boolean): Promise<void> {
  if (isTyping) {
    try {
      await bot.sendChatAction(parseInt(chatId), 'typing');
    } catch {
      // Ignore typing errors
    }
  }
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  try {
    // Split long messages (Telegram limit)
    const maxLen = TELEGRAM.MAX_MESSAGE_LENGTH - 96; // Leave room for safety margin
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }

    for (let i = 0; i < chunks.length; i++) {
      await bot.sendMessage(parseInt(chatId), chunks[i]);
      // Rate limiting: add delay between chunks to avoid Telegram limits
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, TELEGRAM.RATE_LIMIT_DELAY_MS));
      }
    }
    logger.info({ chatId, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ chatId, err: formatError(err) }, 'Failed to send message');
  }
}

function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
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

// ============================================================================
// IPC Watcher
// ============================================================================

function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  // Track active watchers for cleanup
  const watchers: fs.FSWatcher[] = [];

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
      logger.error({ err: formatError(err) }, 'Error reading IPC base directory');
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
        logger.error({ err: formatError(err), sourceGroup }, 'Error reading IPC tasks directory');
      }
    }
  };

  // Set up fs.watch for a directory
  const watchedDirs = new Set<string>();
  const setupWatcher = (dir: string) => {
    if (watchedDirs.has(dir)) return;

    try {
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          scheduleProcess();
        }
      });

      watcher.on('error', (err) => {
        logger.debug({ dir, err: formatError(err) }, 'Watch error, will use polling fallback');
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
    watchers.push(baseWatcher);
  } catch (err) {
    logger.warn({ err: formatError(err) }, 'Failed to watch IPC base directory');
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

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string,
  isMain: boolean,
): Promise<void> {
  const {
    createTask,
    updateTask,
    deleteTask,
    getTaskById: getTask,
  } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.groupFolder
      ) {
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetGroup },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const targetChatId = Object.entries(registeredGroups).find(
          ([, group]) => group.folder === targetGroup,
        )?.[0];

        if (!targetChatId) {
          logger.warn(
            { targetGroup },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetGroup,
          chat_jid: targetChatId,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetGroup, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'register_group':
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

// ============================================================================
// Telegram Connection
// ============================================================================

async function connectTelegram(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: TELEGRAM_BOT_TOKEN not set                           ║');
    console.error('║  Run: npm run setup:telegram                                 ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }

  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  // Handle incoming messages
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const content = msg.text || msg.caption || '';
    const senderId = msg.from?.id.toString() || '';
    const senderName = msg.from?.first_name || 'Unknown';
    const timestamp = new Date(msg.date * 1000).toISOString();
    const chatName = msg.chat.title || msg.chat.first_name || chatId;

    // Store chat metadata for group discovery
    storeChatMetadata(chatId, timestamp, chatName);

    // Store message if registered group
    if (registeredGroups[chatId] && content) {
      storeMessage(
        msg.message_id.toString(),
        chatId,
        senderId,
        senderName,
        content,
        timestamp,
        false,
      );
    }

    // Process if registered (concurrency handled in container-runner)
    if (registeredGroups[chatId]) {
      try {
        await processMessage(msg);
        saveState();
      } catch (err) {
        logger.error({ err, chatId }, 'Error processing message');
      }
    }
  });

  // Handle polling errors
  bot.on('polling_error', (err) => {
    logger.error({ err: err.message }, 'Telegram polling error');
  });

  // Get bot info
  const me = await bot.getMe();
  logger.info({ username: me.username, id: me.id }, 'Telegram bot connected');

  // Start background services
  startSchedulerLoop({
    sendMessage,
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
  });
  startIpcWatcher();
  startMediaCleanupScheduler();

  console.log(`\n✓ NanoGemClaw running (trigger: @${ASSISTANT_NAME})`);
  console.log(`  Bot: @${me.username}`);
  console.log(`  Registered groups: ${Object.keys(registeredGroups).length}\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Starting NanoGemClaw...');

  // Initialize
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.mkdirSync(GROUPS_DIR, { recursive: true });

  initDatabase();
  loadState();

  // Connect to Telegram
  await connectTelegram();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  try {
    await bot?.stopPolling();
    saveState();
    closeDatabase();
    console.log('State saved & database closed. Goodbye!');
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  try {
    await bot?.stopPolling();
    saveState();
    closeDatabase();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});
