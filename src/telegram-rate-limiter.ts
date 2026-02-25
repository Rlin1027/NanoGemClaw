/**
 * Telegram Rate Limiter - Per-chat editMessage throttling
 * Prevents hitting Telegram API rate limits (2s minimum interval per chat)
 */

interface ChatEditState {
  lastEditTime: number;
  editCount: number;
  countResetTime: number;
}

const MIN_EDIT_INTERVAL_MS = 2000; // 2 seconds per chat
const MAX_EDITS_PER_MINUTE = 30;
const EDIT_COUNT_WINDOW_MS = 60000; // 1 minute
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes
const INACTIVE_THRESHOLD_MS = 600000; // 10 minutes

export class TelegramRateLimiter {
  private chatStates: Map<string, ChatEditState> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Check if an edit can be sent for this chat (respects 2s minimum interval)
   */
  canEdit(chatId: string | number): boolean {
    const key = String(chatId);
    const state = this.chatStates.get(key);

    if (!state) {
      return true;
    }

    const now = Date.now();

    // Check 2-second minimum interval
    if (now - state.lastEditTime < MIN_EDIT_INTERVAL_MS) {
      return false;
    }

    // Check 30 edits/minute hard limit
    if (now - state.countResetTime > EDIT_COUNT_WINDOW_MS) {
      // Reset counter if window expired
      state.editCount = 0;
      state.countResetTime = now;
    }

    if (state.editCount >= MAX_EDITS_PER_MINUTE) {
      return false;
    }

    return true;
  }

  /**
   * Record an edit for this chat (updates rate limit counters)
   */
  recordEdit(chatId: string | number): void {
    const key = String(chatId);
    const now = Date.now();
    const state = this.chatStates.get(key);

    if (!state) {
      this.chatStates.set(key, {
        lastEditTime: now,
        editCount: 1,
        countResetTime: now,
      });
      return;
    }

    // Reset count if window expired
    if (now - state.countResetTime > EDIT_COUNT_WINDOW_MS) {
      state.editCount = 1;
      state.countResetTime = now;
    } else {
      state.editCount++;
    }

    state.lastEditTime = now;
  }

  /**
   * Clean up inactive chat entries (> 10 minutes no activity)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, state] of this.chatStates.entries()) {
      if (now - state.lastEditTime > INACTIVE_THRESHOLD_MS) {
        this.chatStates.delete(key);
      }
    }
  }

  /**
   * Destroy the rate limiter (clear interval)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.chatStates.clear();
  }
}

// Singleton instance
export const telegramRateLimiter = new TelegramRateLimiter();

/**
 * Safely truncate Markdown text without breaking formatting
 * - Avoids cutting inside code blocks (```)
 * - Avoids cutting inside bold (**) or italic (*)
 * - Auto-closes open code blocks if truncated
 */
export function safeMarkdownTruncate(
  text: string,
  maxLength: number = 4096,
): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Find safe truncation point
  let truncateAt = maxLength;

  // Count code blocks up to truncation point
  const beforeTruncate = text.substring(0, truncateAt);
  const codeBlockCount = (beforeTruncate.match(/```/g) || []).length;
  const isInsideCodeBlock = codeBlockCount % 2 === 1;

  if (isInsideCodeBlock) {
    // Try to find previous code block end
    const lastCodeBlockEnd = beforeTruncate.lastIndexOf('```');
    if (lastCodeBlockEnd !== -1) {
      truncateAt = lastCodeBlockEnd + 3; // Include the ```
    } else {
      // No code block end found, truncate before the opening ```
      const firstCodeBlockStart = beforeTruncate.indexOf('```');
      if (firstCodeBlockStart !== -1) {
        truncateAt = firstCodeBlockStart;
      }
    }
  }

  // Check for incomplete bold/italic markers
  let result = text.substring(0, truncateAt);

  // Count ** (bold) markers
  const boldCount = (result.match(/\*\*/g) || []).length;
  if (boldCount % 2 === 1) {
    // Incomplete bold, find last complete pair
    const lastBoldStart = result.lastIndexOf('**');
    if (lastBoldStart !== -1) {
      result = result.substring(0, lastBoldStart);
    }
  }

  // Count single * (italic) markers (excluding those in **)
  const italicMatches = result.match(/(?<!\*)\*(?!\*)/g) || [];
  if (italicMatches.length % 2 === 1) {
    // Incomplete italic, find last complete pair
    const lastItalicMatch = result.lastIndexOf('*');
    if (lastItalicMatch !== -1) {
      // Make sure it's not part of **
      if (
        result[lastItalicMatch - 1] !== '*' &&
        result[lastItalicMatch + 1] !== '*'
      ) {
        result = result.substring(0, lastItalicMatch);
      }
    }
  }

  // If we truncated inside a code block, close it
  const finalCodeBlockCount = (result.match(/```/g) || []).length;
  if (finalCodeBlockCount % 2 === 1) {
    result += '\n```';
  }

  return result.trimEnd();
}
