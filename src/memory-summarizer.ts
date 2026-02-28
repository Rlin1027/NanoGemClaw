/**
 * Memory Summarizer Module
 *
 * Handles automatic conversation summarization when context grows too large.
 * Uses Gemini to generate summaries and manages message archival.
 */

import { spawn } from 'child_process';
import {
  getGroupMessageStats,
  getMemorySummary,
  getMessagesForSummary,
  deleteOldMessages,
  upsertMemorySummary,
} from './db.js';
import { MEMORY } from './config.js';
import { logger } from './logger.js';
import type { RegisteredGroup } from './types.js';

// ============================================================================
// Types
// ============================================================================

interface SummaryResult {
  summary: string;
  messagesProcessed: number;
  charsProcessed: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check if a group's conversation needs summarization
 */
export function needsSummarization(chatJid: string): boolean {
  const stats = getGroupMessageStats(chatJid);
  if (!stats) return false;

  return (
    stats.total_chars >= MEMORY.SUMMARIZE_THRESHOLD_CHARS ||
    stats.message_count >= MEMORY.MAX_CONTEXT_MESSAGES
  );
}

/**
 * Generate a summary of the conversation using Gemini CLI
 */
async function generateSummary(
  messages: { sender_name: string; content: string; timestamp: string }[],
): Promise<string> {
  // C7: Sanitize sender names to prevent control character injection
  const conversationText = messages
    .map((m) => {
      const safeSenderName = m.sender_name
        .replace(/[\n\r\0\x08]/g, '')
        .slice(0, 50);
      return `[${safeSenderName}]: ${m.content}`;
    })
    .join('\n');

  // C7: Truncate prompt to prevent ARG_MAX issues (safe CLI arg limit ~100KB)
  const MAX_PROMPT_LENGTH = 100000;
  const truncatedConversation =
    conversationText.length > MAX_PROMPT_LENGTH
      ? conversationText.slice(0, MAX_PROMPT_LENGTH) + '\n[...truncated...]'
      : conversationText;

  const prompt = `${MEMORY.SUMMARY_PROMPT}

---
Conversation:
${truncatedConversation}
---

Summary:`;

  return new Promise((resolve, reject) => {
    // H9: Use settled flag to prevent double-resolve
    let settled = false;
    let stdout = '';
    let stderr = '';

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const gemini = spawn(
      'gemini',
      ['--model', model, '-p', prompt, '--output-format', 'text'],
      {
        env: {
          ...process.env,
          HOME: process.env.HOME,
        },
      },
    );

    // H9: Store timeout ID for proper cleanup
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      gemini.kill('SIGKILL');
      reject(new Error('Summary generation timed out'));
    }, 60000);

    gemini.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gemini.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gemini.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(`Gemini CLI failed (code ${code}): ${stderr || stdout}`),
        );
      }
    });

    gemini.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(`Gemini CLI spawn error: ${err.message}`));
    });
  });
}

/**
 * Summarize a group's conversation and archive old messages
 */
export async function summarizeConversation(
  group: RegisteredGroup,
  chatJid: string,
): Promise<SummaryResult | null> {
  const stats = getGroupMessageStats(chatJid);
  if (!stats) {
    logger.debug({ group: group.name }, 'No messages to summarize');
    return null;
  }

  const messages = getMessagesForSummary(chatJid, MEMORY.MAX_CONTEXT_MESSAGES);
  if (messages.length === 0) {
    return null;
  }

  const charsToArchive = messages.reduce((sum, m) => sum + m.content.length, 0);

  logger.info(
    { group: group.name, messageCount: messages.length, chars: charsToArchive },
    'Generating conversation summary',
  );

  try {
    // Get existing summary to merge with
    const existingSummary = getMemorySummary(group.folder);

    // Prepare context including previous summary
    let contextMessages = messages;
    if (existingSummary) {
      // Prepend existing summary as context
      contextMessages = [
        {
          sender_name: 'PREVIOUS_SUMMARY',
          content: existingSummary.summary,
          timestamp: '',
        },
        ...messages,
      ];
    }

    const newSummary = await generateSummary(contextMessages);

    // Get the timestamp of the last message to archive
    const lastMessage = messages[messages.length - 1];

    // Archive: delete old messages and save summary
    const deletedCount = deleteOldMessages(chatJid, lastMessage.timestamp);
    upsertMemorySummary(
      group.folder,
      newSummary,
      messages.length,
      charsToArchive,
    );

    logger.info(
      {
        group: group.name,
        deletedMessages: deletedCount,
        summaryLength: newSummary.length,
      },
      'Conversation summarized and archived',
    );

    return {
      summary: newSummary,
      messagesProcessed: messages.length,
      charsProcessed: charsToArchive,
    };
  } catch (err) {
    logger.error(
      {
        group: group.name,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to summarize conversation',
    );
    return null;
  }
}

/**
 * Get the memory context for a group (summary + stats)
 */
export function getMemoryContext(groupFolder: string): string | null {
  const summary = getMemorySummary(groupFolder);
  if (!summary) return null;

  return `[CONVERSATION HISTORY SUMMARY]
Last updated: ${summary.updated_at}
Messages archived: ${summary.messages_archived}

${summary.summary}
[END SUMMARY]`;
}
