/**
 * Telegram Helper Functions
 * Message sending, typing indicators, and message splitting utilities.
 */
import { TELEGRAM } from './config.js';
import { logger } from './logger.js';
import { getBot, setTypingInterval, clearTypingInterval } from './state.js';
import { formatError } from './utils.js';

// ============================================================================
// Suggestion Store (callback_data is limited to 64 bytes by Telegram)
// ============================================================================

const suggestionStore = new Map<number, string>();
let suggestionCounter = 0;
const MAX_SUGGESTIONS = 200;

/**
 * Store a suggestion text and return a short callback_data key.
 */
export function storeSuggestion(text: string): string {
  const id = ++suggestionCounter;
  suggestionStore.set(id, text);
  // Evict oldest entries when store grows too large
  if (suggestionStore.size > MAX_SUGGESTIONS) {
    const firstKey = suggestionStore.keys().next().value;
    if (firstKey !== undefined) suggestionStore.delete(firstKey);
  }
  return `suggest:${id}`;
}

/**
 * Retrieve a stored suggestion by callback_data key.
 */
export function getSuggestion(callbackData: string): string | undefined {
  const id = parseInt(callbackData.split(':')[1], 10);
  return Number.isNaN(id) ? undefined : suggestionStore.get(id);
}

// ============================================================================
// Typing Indicator
// ============================================================================

export async function setTyping(
  chatId: string,
  isTyping: boolean,
  messageThreadId?: number | null,
): Promise<void> {
  const bot = getBot();
  // Use compound key so parallel forum threads don't clobber each other's intervals
  const typingKey = `${chatId}:${messageThreadId ?? 'null'}`;
  if (isTyping) {
    // Clear any existing interval
    clearTypingInterval(typingKey);

    // Send initial typing indicator
    try {
      await bot.sendChatAction(parseInt(chatId), 'typing', {
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      });
    } catch {
      // Ignore typing errors
    }

    // Refresh typing indicator every 5 seconds (Telegram resets after ~5s)
    const interval = setInterval(async () => {
      try {
        await bot.sendChatAction(parseInt(chatId), 'typing', {
          ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        });
      } catch {
        // Stop if error
        clearTypingInterval(typingKey);
      }
    }, 5000);

    setTypingInterval(typingKey, interval);
  } else {
    // Stop typing indicator
    clearTypingInterval(typingKey);
  }
}

// ============================================================================
// Message Sending
// ============================================================================

export async function sendMessage(
  chatId: string,
  text: string,
  messageThreadId?: number | null,
): Promise<void> {
  const bot = getBot();
  try {
    const chunks = splitMessageIntelligently(
      text,
      TELEGRAM.MAX_MESSAGE_LENGTH - 96,
    );

    for (let i = 0; i < chunks.length; i++) {
      await bot.sendMessage(parseInt(chatId), chunks[i], {
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      });
      // Rate limiting: add delay between chunks to avoid Telegram limits
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, TELEGRAM.RATE_LIMIT_DELAY_MS));
      }
    }
    logger.info(
      { chatId, length: text.length, chunks: chunks.length },
      'Message sent',
    );
  } catch (err) {
    logger.error({ chatId, err: formatError(err) }, 'Failed to send message');
  }
}

// ============================================================================
// Message with Buttons
// ============================================================================

/**
 * Quick reply button definition
 */
export interface QuickReplyButton {
  text: string;
  callbackData: string;
}

/**
 * Send a message with inline keyboard buttons
 */
export async function sendMessageWithButtons(
  chatId: string,
  text: string,
  buttons: QuickReplyButton[][],
  messageThreadId?: number | null,
): Promise<void> {
  const bot = getBot();
  try {
    const inlineKeyboard = buttons.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        callback_data: btn.callbackData,
      })),
    );

    await bot.sendMessage(parseInt(chatId), text, {
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
    logger.info(
      { chatId, buttonRows: buttons.length },
      'Message with buttons sent',
    );
  } catch (err) {
    logger.error(
      { chatId, err: formatError(err) },
      'Failed to send message with buttons',
    );
  }
}

// ============================================================================
// Message Splitting
// ============================================================================

/**
 * Split a long message at natural breakpoints (paragraphs, then sentences)
 * while trying to preserve markdown code blocks.
 */
export function splitMessageIntelligently(
  text: string,
  maxLen: number,
): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point within maxLen
    const splitPoint = findSplitPoint(remaining, maxLen);

    chunks.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  return chunks;
}

/**
 * Find the best point to split a message, preferring:
 * 1. After a code block (```)
 * 2. After a paragraph break (double newline)
 * 3. After a single newline
 * 4. After a sentence (. ! ?)
 * 5. After a word boundary (space)
 * 6. Hard cut at maxLen (last resort)
 */
function findSplitPoint(text: string, maxLen: number): number {
  const searchText = text.slice(0, maxLen);

  // Priority 1: After code block closing
  const codeBlockEnd = searchText.lastIndexOf('\n```\n');
  if (codeBlockEnd > maxLen * 0.3) {
    return codeBlockEnd + 5;
  }

  // Priority 2: After paragraph break (double newline)
  const paragraphBreak = searchText.lastIndexOf('\n\n');
  if (paragraphBreak > maxLen * 0.5) {
    return paragraphBreak + 2;
  }

  // Priority 3: After single newline
  const lineBreak = searchText.lastIndexOf('\n');
  if (lineBreak > maxLen * 0.7) {
    return lineBreak + 1;
  }

  // Priority 4: After sentence ending
  const sentenceEnders = ['. ', '! ', '? ', '\u3002', '\uff01', '\uff1f'];
  let lastSentence = -1;
  for (const ender of sentenceEnders) {
    const pos = searchText.lastIndexOf(ender);
    if (pos > lastSentence) {
      lastSentence = pos;
    }
  }
  if (lastSentence > maxLen * 0.5) {
    return lastSentence + 2;
  }

  // Priority 5: After space (word boundary)
  const lastSpace = searchText.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.7) {
    return lastSpace + 1;
  }

  // Priority 6: Hard cut (avoid breaking markdown)
  return maxLen;
}
