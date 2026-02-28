/**
 * Agent Executor - Agent execution with retry logic and container/fast-path routing.
 */
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  FAST_PATH,
  MAIN_GROUP_FOLDER,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
  type ProgressInfo,
} from './container-runner.js';
import { getAllTasks } from './db.js';
import { logger } from './logger.js';
import { getBot, getRegisteredGroups, getSessions } from './state.js';
import { sendMessage } from './telegram-helpers.js';
import { getAvailableGroups, saveState } from './group-manager.js';
import { RegisteredGroup } from './types.js';
import { saveJson } from './utils.js';

// ============================================================================
// Agent Execution with Retry Helper
// ============================================================================

export interface RetryOptions {
  maxRetries: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < options.maxRetries && options.shouldRetry(err, attempt)) {
        options.onRetry?.(err, attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatId: string,
  mediaPath: string | null = null,
  statusMsg: TelegramBot.Message | null = null,
  messageThreadId?: number | null,
): Promise<string | null> {
  const bot = getBot();
  const sessions = getSessions();
  const registeredGroups = getRegisteredGroups();
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Import streaming utilities
  const { telegramRateLimiter, safeMarkdownTruncate } =
    await import('./telegram-rate-limiter.js');

  // Import i18n for progress messages
  const { tf: i18nTf, getGroupLang: i18nGetGroupLang } =
    await import('./i18n/index.js');
  const groupLang = i18nGetGroupLang(group.folder);

  // Create progress callback that updates Telegram statusMsg with streaming support
  const onProgress = async (info: ProgressInfo) => {
    if (!statusMsg) return;
    try {
      let progressText = `🤖 ${i18nTf('thinking', undefined, groupLang)}...`;
      if (info.type === 'tool_use') {
        const toolKeyMap: Record<string, string> = {
          google_search: 'searching',
          web_search: 'searching',
          read_file: 'readingFile',
          write_file: 'writingFile',
          generate_image: 'generatingImage',
          execute_code: 'executingCode',
          schedule_task: 'executingCode',
          set_preference: 'executingCode',
        };
        const toolKey = toolKeyMap[info.toolName || ''];
        progressText = toolKey
          ? i18nTf(toolKey, undefined, groupLang)
          : i18nTf('usingTool', { toolName: info.toolName || '' }, groupLang);
        await bot
          .editMessageText(progressText, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          })
          .catch(() => {});
      } else if (info.type === 'message') {
        // Use streaming for long responses (>100 chars)
        if (info.contentSnapshot && info.contentSnapshot.length > 100) {
          // Check rate limit before editing
          if (telegramRateLimiter.canEdit(chatId)) {
            const truncated = safeMarkdownTruncate(info.contentSnapshot, 4096);
            const streamingIndicator = info.isComplete ? '' : ' ⏳';
            await bot
              .editMessageText(`💬 ${truncated}${streamingIndicator}`, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
              })
              .catch(() => {});
            telegramRateLimiter.recordEdit(chatId);
          }
        } else if (info.content || info.contentSnapshot) {
          // Short response or fallback
          progressText = i18nTf('responding', undefined, groupLang);
          await bot
            .editMessageText(progressText, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Progress callback error');
    }
  };

  // Import message consolidator and mark streaming as active
  const { messageConsolidator } = await import('./message-consolidator.js');
  messageConsolidator.setStreaming(chatId, true, messageThreadId);

  try {
    // Get memory context from conversation summaries
    const { getMemoryContext } = await import('./memory-summarizer.js');
    const memoryContext = getMemoryContext(group.folder);

    // Read GEMINI.md system prompt (shared by both fast path and container path)
    const { readGroupGeminiMd } = await import('./group-manager.js');
    const geminiMdContent = readGroupGeminiMd(group.folder);

    // ========================================================================
    // Fast Path: Direct Gemini API with streaming + function calling
    // ========================================================================
    const { isFastPathEligible, runFastPath } = await import('./fast-path.js');
    const hasMedia = !!mediaPath;

    if (isFastPathEligible(group, hasMedia)) {
      logger.info({ group: group.name }, 'Using fast path (direct API)');

      // Resolve system prompt: GEMINI.md > group.systemPrompt > persona > default
      const { getEffectiveSystemPrompt } = await import('./personas.js');
      const systemPrompt = getEffectiveSystemPrompt(
        geminiMdContent || group.systemPrompt,
        group.persona,
      );

      // Build IPC context for function calling
      const ipcContext = {
        sourceGroup: group.folder,
        isMain,
        registeredGroups,
        sendMessage: async (jid: string, text: string) => {
          await sendMessage(jid, text, messageThreadId);
        },
        bot,
      };

      // Fetch recent conversation history for multi-turn context
      let conversationHistory: Array<{
        role: 'user' | 'model';
        text: string;
      }> = [];
      try {
        const { getRecentConversation } = await import('./db.js');
        conversationHistory = getRecentConversation(
          chatId,
          FAST_PATH.MAX_HISTORY_MESSAGES,
          messageThreadId?.toString(),
        );
      } catch {
        // DB may not have messages yet
      }

      const startTime = Date.now();

      const output = await runFastPath(
        group,
        {
          prompt,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt,
          memoryContext: memoryContext ?? undefined,
          enableWebSearch: group.enableWebSearch ?? true,
          conversationHistory,
        },
        ipcContext,
        onProgress,
      );

      const durationMs = Date.now() - startTime;

      // Log usage statistics (same mechanism as container runner)
      try {
        const { logUsage, resetErrors, recordError } = await import('./db.js');
        const { GEMINI_MODEL: defaultModel } = await import('./config.js');
        logUsage({
          group_folder: group.folder,
          timestamp: new Date().toISOString(),
          duration_ms: durationMs,
          prompt_tokens: output.promptTokens,
          response_tokens: output.responseTokens,
          model: `fast:${group.geminiModel || defaultModel}`,
        });

        if (output.status === 'error') {
          recordError(group.folder, output.error || 'Fast path error');
        } else {
          resetErrors(group.folder);
        }
      } catch (logErr) {
        logger.warn({ err: logErr }, 'Failed to log fast path usage stats');
      }

      if (output.status === 'error') {
        // Fast path failed - fall through to container as fallback
        logger.warn(
          { group: group.name, error: output.error },
          'Fast path failed, falling back to container',
        );
      } else {
        return output.result;
      }
    }

    // ========================================================================
    // Container Path: Full container-based execution (existing behavior)
    // ========================================================================

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

    // Helper to run container agent once
    const runOnce = async (useSessionId?: string) => {
      return await runContainerAgent(
        group,
        {
          prompt,
          sessionId: useSessionId,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt: geminiMdContent || group.systemPrompt,
          persona: group.persona,
          enableWebSearch: group.enableWebSearch ?? true,
          mediaPath: mediaPath
            ? `/workspace/group/media/${path.basename(mediaPath)}`
            : undefined,
          memoryContext: memoryContext ?? undefined,
        },
        onProgress,
      );
    };

    // First attempt with session
    const output = await runOnce(sessionId);

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      // Retry logic for session resume failure
      if (sessionId && output.error?.includes('No previous sessions found')) {
        logger.warn(
          { group: group.name },
          'Session resume failed, retrying without session',
        );
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runOnce(undefined);

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error(
            { group: group.name, error: retryOutput.error },
            'Container agent error (retry)',
          );
          return null;
        }
        return retryOutput.result;
      }

      // Retry logic for timeout or non-zero exit
      const isTimeout = output.error?.includes('Container timed out after');
      const isNonZeroExit = output.error?.includes(
        'Container exited with code',
      );

      if (isTimeout || isNonZeroExit) {
        logger.warn(
          { group: group.name, error: output.error },
          'Container timeout/error, retrying with fresh session',
        );

        // Send retry status update to chat
        try {
          await bot
            .sendMessage(
              parseInt(chatId),
              i18nTf('retrying', undefined, groupLang),
              {
                ...(messageThreadId
                  ? { message_thread_id: messageThreadId }
                  : {}),
              },
            )
            .catch(() => {});
        } catch (err) {
          logger.debug({ err }, 'Retry status message error');
        }

        // Wait 2 seconds before retry
        await new Promise((r) => setTimeout(r, 2000));

        // Clear session for fresh start
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runOnce(undefined);

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error(
            { group: group.name, error: retryOutput.error },
            'Container agent error (retry after timeout)',
          );
          return null;
        }
        return retryOutput.result;
      }

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
  } finally {
    // Clear streaming state
    messageConsolidator.setStreaming(chatId, false, messageThreadId);
  }
}
