/**
 * Message Consolidator - Debounce and merge consecutive messages
 * Prevents unnecessary container restarts by buffering rapid-fire messages
 */
import { EventEmitter } from 'events';

interface PendingMessage {
  chatId: string | number;
  text: string;
  timestamp: number;
  messageId?: number;
  messageThreadId?: number;
}

interface ConsolidatedResult {
  chatId: string | number;
  messages: PendingMessage[];
  combinedText: string;
  messageThreadId?: number;
}

export class MessageConsolidator extends EventEmitter {
  private buffers: Map<string, PendingMessage[]> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private activeStreaming: Set<string> = new Set();

  constructor(private defaultDebounceMs: number = 2000) {
    super();
  }

  /**
   * Add message to consolidation buffer
   * @returns true if message was buffered (awaiting merge), false if should process immediately
   */
  addMessage(
    chatId: string | number,
    text: string,
    options?: {
      messageId?: number;
      isMedia?: boolean;
      debounceMs?: number;
      messageThreadId?: number;
    },
  ): boolean {
    const key = `${chatId}:${options?.messageThreadId ?? 'null'}`;

    // Media messages (photos/voice) always process immediately
    if (options?.isMedia) return false;

    // If bot is streaming a response, queue new messages instead of merging
    if (this.activeStreaming.has(key)) return false;

    // Add to buffer
    const pending: PendingMessage = {
      chatId,
      text,
      timestamp: Date.now(),
      messageId: options?.messageId,
      messageThreadId: options?.messageThreadId,
    };

    const existing = this.buffers.get(key) || [];
    existing.push(pending);
    this.buffers.set(key, existing);

    // Reset debounce timer
    const existingTimer = this.timers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const debounceMs = options?.debounceMs ?? this.defaultDebounceMs;
    const timer = setTimeout(() => {
      this.flush(key);
    }, debounceMs);
    this.timers.set(key, timer);

    return true; // Message buffered
  }

  /**
   * Manually flush a chat's buffer
   */
  flush(chatKey: string): ConsolidatedResult | null {
    const messages = this.buffers.get(chatKey);
    if (!messages || messages.length === 0) return null;

    this.buffers.delete(chatKey);
    const timer = this.timers.get(chatKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(chatKey);
    }

    const combinedText = messages.map((m) => m.text).join('\n');
    const result: ConsolidatedResult = {
      chatId: messages[0].chatId,
      messages,
      combinedText,
      messageThreadId: messages[0].messageThreadId,
    };

    this.emit('consolidated', result);
    return result;
  }

  /**
   * Mark a chat as actively streaming (new messages won't be merged)
   */
  setStreaming(
    chatId: string | number,
    streaming: boolean,
    threadId?: number | null,
  ): void {
    const key = `${chatId}:${threadId ?? 'null'}`;
    if (streaming) {
      this.activeStreaming.add(key);
    } else {
      this.activeStreaming.delete(key);
    }
  }

  /**
   * Check if chat has pending messages
   */
  hasPending(chatId: string | number, threadId?: number | null): boolean {
    const key = `${chatId}:${threadId ?? 'null'}`;
    const msgs = this.buffers.get(key);
    return !!msgs && msgs.length > 0;
  }

  /**
   * Cleanup - clear all timers and buffers
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.buffers.clear();
    this.activeStreaming.clear();
  }
}

// Singleton instance
export const messageConsolidator = new MessageConsolidator();
