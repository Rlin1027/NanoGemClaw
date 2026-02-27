import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageConsolidator } from '../message-consolidator.js';

describe('message-consolidator.ts', () => {
  let consolidator: MessageConsolidator;

  beforeEach(() => {
    vi.useFakeTimers();
    consolidator = new MessageConsolidator(2000);
  });

  afterEach(() => {
    consolidator.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create instance with default debounce', () => {
      const c = new MessageConsolidator();
      expect(c).toBeInstanceOf(MessageConsolidator);
      c.destroy();
    });

    it('should create instance with custom debounce', () => {
      const c = new MessageConsolidator(5000);
      expect(c).toBeInstanceOf(MessageConsolidator);
      c.destroy();
    });
  });

  describe('addMessage', () => {
    it('should buffer text message', () => {
      const result = consolidator.addMessage('123', 'Hello');
      expect(result).toBe(true);
      expect(consolidator.hasPending('123')).toBe(true);
    });

    it('should not buffer media messages', () => {
      const result = consolidator.addMessage('123', 'Photo', { isMedia: true });
      expect(result).toBe(false);
      expect(consolidator.hasPending('123')).toBe(false);
    });

    it('should not buffer when streaming', () => {
      consolidator.setStreaming('123', true);
      const result = consolidator.addMessage('123', 'Hello');
      expect(result).toBe(false);
      expect(consolidator.hasPending('123')).toBe(false);
    });

    it('should reset timer on subsequent messages', () => {
      consolidator.addMessage('123', 'Message 1');
      vi.advanceTimersByTime(1500); // 1.5s
      consolidator.addMessage('123', 'Message 2');
      vi.advanceTimersByTime(1500); // Another 1.5s (total 3s, but timer reset)
      expect(consolidator.hasPending('123')).toBe(true); // Still pending
    });

    it('should consolidate after debounce period', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message 1');
      consolidator.addMessage('123', 'Message 2');
      vi.advanceTimersByTime(2000);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].combinedText).toBe(
        'Message 1\nMessage 2',
      );
      expect(consolidator.hasPending('123')).toBe(false);
    });

    it('should use custom debounce if provided', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message', { debounceMs: 500 });
      vi.advanceTimersByTime(499);
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should track messageId if provided', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message', { messageId: 999 });
      vi.advanceTimersByTime(2000);

      const result = listener.mock.calls[0][0];
      expect(result.messages[0].messageId).toBe(999);
    });
  });

  describe('Multiple chats', () => {
    it('should handle different chats independently', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('chat1', 'Message 1');
      consolidator.addMessage('chat2', 'Message 2');

      vi.advanceTimersByTime(2000);

      expect(listener).toHaveBeenCalledTimes(2);
      expect(consolidator.hasPending('chat1')).toBe(false);
      expect(consolidator.hasPending('chat2')).toBe(false);
    });

    it('should consolidate each chat separately', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('chat1', 'A1');
      consolidator.addMessage('chat1', 'A2');
      consolidator.addMessage('chat2', 'B1');
      consolidator.addMessage('chat2', 'B2');

      vi.advanceTimersByTime(2000);

      const results = listener.mock.calls.map((call: any) => call[0]);
      expect(results).toHaveLength(2);

      const chat1Result = results.find((r: any) => r.chatId === 'chat1');
      const chat2Result = results.find((r: any) => r.chatId === 'chat2');

      expect(chat1Result.combinedText).toBe('A1\nA2');
      expect(chat2Result.combinedText).toBe('B1\nB2');
    });
  });

  describe('flush', () => {
    it('should manually flush pending messages', () => {
      consolidator.addMessage('123', 'Message 1');
      consolidator.addMessage('123', 'Message 2');

      const result = consolidator.flush('123:null');

      expect(result).toBeDefined();
      expect(result!.combinedText).toBe('Message 1\nMessage 2');
      expect(result!.messages).toHaveLength(2);
      expect(consolidator.hasPending('123')).toBe(false);
    });

    it('should return null for non-existent chat', () => {
      const result = consolidator.flush('non-existent:null');
      expect(result).toBeNull();
    });

    it('should emit consolidated event on flush', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message');
      consolidator.flush('123:null');

      expect(listener).toHaveBeenCalledOnce();
    });

    it('should clear timer on flush', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message');
      consolidator.flush('123:null');

      // Timer should be cleared, so advancing time shouldn't trigger again
      vi.advanceTimersByTime(5000);
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('setStreaming', () => {
    it('should mark chat as streaming', () => {
      consolidator.setStreaming('123', true);
      const result = consolidator.addMessage('123', 'Message');
      expect(result).toBe(false);
    });

    it('should unmark chat as not streaming', () => {
      consolidator.setStreaming('123', true);
      consolidator.setStreaming('123', false);
      const result = consolidator.addMessage('123', 'Message');
      expect(result).toBe(true);
    });

    it('should handle numeric chatId', () => {
      consolidator.setStreaming(123, true);
      const result = consolidator.addMessage(123, 'Message');
      expect(result).toBe(false);
    });
  });

  describe('hasPending', () => {
    it('should return false for empty buffer', () => {
      expect(consolidator.hasPending('123')).toBe(false);
    });

    it('should return true when messages pending', () => {
      consolidator.addMessage('123', 'Message');
      expect(consolidator.hasPending('123')).toBe(true);
    });

    it('should return false after flush', () => {
      consolidator.addMessage('123', 'Message');
      consolidator.flush('123:null');
      expect(consolidator.hasPending('123')).toBe(false);
    });

    it('should handle numeric chatId', () => {
      consolidator.addMessage(123, 'Message');
      expect(consolidator.hasPending(123)).toBe(true);
    });

    it('should check pending for specific thread', () => {
      consolidator.addMessage('chat1', 'Msg', { messageThreadId: 100 });
      expect(consolidator.hasPending('chat1', 100)).toBe(true);
      expect(consolidator.hasPending('chat1', 200)).toBe(false);
      expect(consolidator.hasPending('chat1')).toBe(false); // null thread ≠ thread 100
    });
  });

  describe('destroy', () => {
    it('should clear all timers', () => {
      consolidator.addMessage('chat1', 'Message 1');
      consolidator.addMessage('chat2', 'Message 2');
      consolidator.addMessage('chat3', 'Message 3');

      consolidator.destroy();

      expect(consolidator.hasPending('chat1')).toBe(false);
      expect(consolidator.hasPending('chat2')).toBe(false);
      expect(consolidator.hasPending('chat3')).toBe(false);
    });

    it('should clear streaming state', () => {
      consolidator.setStreaming('123', true);
      consolidator.destroy();

      // After destroy, setStreaming should still work (activeStreaming is cleared)
      const newConsolidator = new MessageConsolidator(2000);
      const result = newConsolidator.addMessage('123', 'Message');
      expect(result).toBe(true);
      newConsolidator.destroy();
    });

    it('should prevent timers from firing after destroy', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message');
      consolidator.destroy();
      vi.advanceTimersByTime(5000);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('ConsolidatedResult', () => {
    it('should include all message metadata', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Msg 1', { messageId: 1 });
      consolidator.addMessage('123', 'Msg 2', { messageId: 2 });
      vi.advanceTimersByTime(2000);

      const result = listener.mock.calls[0][0];
      expect(result.chatId).toBe('123');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe('Msg 1');
      expect(result.messages[0].messageId).toBe(1);
      expect(result.messages[1].text).toBe('Msg 2');
      expect(result.messages[1].messageId).toBe(2);
      expect(result.combinedText).toBe('Msg 1\nMsg 2');
    });

    it('should include timestamps', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Message');
      vi.advanceTimersByTime(2000);

      const result = listener.mock.calls[0][0];
      expect(result.messages[0].timestamp).toBeDefined();
      expect(typeof result.messages[0].timestamp).toBe('number');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message text', () => {
      consolidator.addMessage('123', '');
      const result = consolidator.flush('123:null');
      expect(result!.combinedText).toBe('');
    });

    it('should handle messages with newlines', () => {
      consolidator.addMessage('123', 'Line 1\nLine 2');
      consolidator.addMessage('123', 'Line 3');
      const result = consolidator.flush('123:null');
      expect(result!.combinedText).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle single message consolidation', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('123', 'Single');
      vi.advanceTimersByTime(2000);

      const result = listener.mock.calls[0][0];
      expect(result.messages).toHaveLength(1);
      expect(result.combinedText).toBe('Single');
    });
  });

  describe('Forum Topics Thread Isolation', () => {
    it('should not merge messages from different threads in same chat', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('chat1', 'Thread A msg', { messageThreadId: 100 });
      consolidator.addMessage('chat1', 'Thread B msg', { messageThreadId: 200 });

      vi.advanceTimersByTime(2000);

      expect(listener).toHaveBeenCalledTimes(2);
      const results = listener.mock.calls.map((call: any) => call[0]);
      expect(results[0].combinedText).toBe('Thread A msg');
      expect(results[1].combinedText).toBe('Thread B msg');
    });

    it('should merge messages within same thread', () => {
      const listener = vi.fn();
      consolidator.on('consolidated', listener);

      consolidator.addMessage('chat1', 'Msg 1', { messageThreadId: 100 });
      consolidator.addMessage('chat1', 'Msg 2', { messageThreadId: 100 });

      vi.advanceTimersByTime(2000);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].combinedText).toBe('Msg 1\nMsg 2');
      expect(listener.mock.calls[0][0].messageThreadId).toBe(100);
    });

    it('should isolate streaming per thread', () => {
      consolidator.setStreaming('chat1', true, 100);

      // Thread 100 should be blocked
      const blocked = consolidator.addMessage('chat1', 'Msg', { messageThreadId: 100 });
      expect(blocked).toBe(false);

      // Thread 200 should still buffer
      const buffered = consolidator.addMessage('chat1', 'Msg', { messageThreadId: 200 });
      expect(buffered).toBe(true);
    });
  });
});
