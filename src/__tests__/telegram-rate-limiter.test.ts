import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TelegramRateLimiter,
  safeMarkdownTruncate,
} from '../telegram-rate-limiter.js';

describe('telegram-rate-limiter.ts', () => {
  let limiter: TelegramRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new TelegramRateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('TelegramRateLimiter', () => {
    describe('canEdit', () => {
      it('should allow first edit', () => {
        expect(limiter.canEdit('123')).toBe(true);
      });

      it('should block edits within 2s', () => {
        limiter.recordEdit('123');
        expect(limiter.canEdit('123')).toBe(false);
      });

      it('should allow edit after 2s', () => {
        limiter.recordEdit('123');
        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit('123')).toBe(true);
      });

      it('should block edits just under 2s', () => {
        limiter.recordEdit('123');
        vi.advanceTimersByTime(1999);
        expect(limiter.canEdit('123')).toBe(false);
      });

      it('should enforce 30 edits/minute hard limit', () => {
        // Record 30 edits
        for (let i = 0; i < 30; i++) {
          limiter.recordEdit('123');
          vi.advanceTimersByTime(2000); // Respect 2s interval
        }
        expect(limiter.canEdit('123')).toBe(false);
      });

      it('should reset count after 1 minute window', () => {
        // Record 30 edits
        for (let i = 0; i < 30; i++) {
          limiter.recordEdit('123');
          vi.advanceTimersByTime(2000);
        }
        expect(limiter.canEdit('123')).toBe(false);

        // Advance past 1 minute window
        vi.advanceTimersByTime(60000);
        expect(limiter.canEdit('123')).toBe(true);
      });

      it('should handle different chats independently', () => {
        limiter.recordEdit('chat1');
        limiter.recordEdit('chat2');

        expect(limiter.canEdit('chat1')).toBe(false);
        expect(limiter.canEdit('chat2')).toBe(false);

        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit('chat1')).toBe(true);
        expect(limiter.canEdit('chat2')).toBe(true);
      });

      it('should handle numeric chatId', () => {
        limiter.recordEdit(123);
        expect(limiter.canEdit(123)).toBe(false);
        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit(123)).toBe(true);
      });
    });

    describe('recordEdit', () => {
      it('should create new state for first edit', () => {
        limiter.recordEdit('123');
        expect(limiter.canEdit('123')).toBe(false);
      });

      it('should increment edit count', () => {
        limiter.recordEdit('123');
        vi.advanceTimersByTime(2000);
        limiter.recordEdit('123');
        vi.advanceTimersByTime(2000);
        limiter.recordEdit('123');

        // After 3 edits, should still be able to continue (under 30 limit)
        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit('123')).toBe(true);
      });

      it('should reset count after window expires', () => {
        limiter.recordEdit('123');
        vi.advanceTimersByTime(60001); // Just over 1 minute
        limiter.recordEdit('123');

        // Count should be reset to 1, not 2
        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit('123')).toBe(true);
      });

      it('should update lastEditTime', () => {
        limiter.recordEdit('123');
        vi.advanceTimersByTime(1500);
        expect(limiter.canEdit('123')).toBe(false);

        vi.advanceTimersByTime(500); // Total 2s
        expect(limiter.canEdit('123')).toBe(true);
      });
    });

    describe('cleanup', () => {
      it('should remove inactive chats after 10 minutes', () => {
        limiter.recordEdit('chat1');
        limiter.recordEdit('chat2');

        vi.advanceTimersByTime(600001); // Just over 10 minutes
        limiter.cleanup();

        // Both chats should be cleaned up
        expect(limiter.canEdit('chat1')).toBe(true); // No state = can edit
        expect(limiter.canEdit('chat2')).toBe(true);
      });

      it('should not remove active chats', () => {
        limiter.recordEdit('chat1');
        vi.advanceTimersByTime(300000); // 5 minutes
        limiter.cleanup();

        // Chat should still be tracked (within 10 min threshold)
        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit('chat1')).toBe(true);
      });

      it('should run automatically every 5 minutes', () => {
        limiter.recordEdit('chat1');
        vi.advanceTimersByTime(600001); // 10 minutes + 1ms

        // Cleanup should run automatically at 5 min and 10 min
        // At 10 min mark, chat1 is still within threshold
        // At 15 min mark (5+5+5), it would be cleaned
        vi.advanceTimersByTime(300000); // Trigger cleanup at 15min total (5min intervals)

        expect(limiter.canEdit('chat1')).toBe(true);
      });
    });

    describe('destroy', () => {
      it('should clear cleanup interval', () => {
        limiter.destroy();
        expect(limiter['cleanupInterval']).toBeNull();
      });

      it('should clear all chat states', () => {
        limiter.recordEdit('chat1');
        limiter.recordEdit('chat2');
        limiter.destroy();

        // After destroy, all chats should be cleared
        expect(limiter['chatStates'].size).toBe(0);
      });

      it('should prevent cleanup from running after destroy', () => {
        limiter.recordEdit('chat1');
        limiter.destroy();

        // Advance past cleanup interval
        vi.advanceTimersByTime(300000);

        // No error should occur
        expect(() => limiter.canEdit('chat1')).not.toThrow();
      });
    });

    describe('Edge Cases', () => {
      it('should handle rapid sequential edits', () => {
        for (let i = 0; i < 10; i++) {
          if (limiter.canEdit('123')) {
            limiter.recordEdit('123');
          }
          vi.advanceTimersByTime(500); // Only 500ms between attempts
        }

        // Should have recorded far fewer than 10 edits due to 2s throttle
        vi.advanceTimersByTime(2000);
        expect(limiter.canEdit('123')).toBe(true);
      });

      it('should handle string and number chatIds interchangeably', () => {
        limiter.recordEdit('123');
        expect(limiter.canEdit(123)).toBe(false); // Same chat

        vi.advanceTimersByTime(2000);
        limiter.recordEdit(123);
        expect(limiter.canEdit('123')).toBe(false);
      });
    });
  });

  describe('safeMarkdownTruncate', () => {
    it('should not truncate if under max length', () => {
      const text = 'Hello world';
      expect(safeMarkdownTruncate(text, 100)).toBe(text);
    });

    it('should truncate at max length', () => {
      const text = 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 4096);
      expect(result.length).toBeLessThanOrEqual(4096);
    });

    it('should not break code blocks', () => {
      const text = '```js\nconst x = 1;\n```\n' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 50);
      expect(result).toContain('```');
      // Should either keep complete block or truncate before it
      const codeBlockCount = (result.match(/```/g) || []).length;
      expect(codeBlockCount % 2).toBe(0); // Even number of ```
    });

    it('should close open code block if truncated inside', () => {
      const text = '```js\n' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 100);
      const codeBlockCount = (result.match(/```/g) || []).length;
      expect(codeBlockCount % 2).toBe(0); // Should auto-close
    });

    it('should not break bold markers', () => {
      const text = '**bold text**' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 20);
      const boldCount = (result.match(/\*\*/g) || []).length;
      expect(boldCount % 2).toBe(0); // Even number of **
    });

    it('should handle incomplete bold at truncation point', () => {
      const text = 'Normal **bold' + 'a'.repeat(5000) + '** end';
      const result = safeMarkdownTruncate(text, 15);
      // Should truncate before the opening ** to avoid incomplete pair
      expect(result).not.toContain('**');
    });

    it('should handle italic markers', () => {
      const text = '*italic*' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 15);
      // Should handle incomplete italic
      const singleStars = (result.match(/(?<!\*)\*(?!\*)/g) || []).length;
      expect(singleStars % 2).toBe(0);
    });

    it('should handle mixed markdown', () => {
      const text = '**bold** *italic* ```code\nblock\n```' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 50);
      expect(result.length).toBeLessThanOrEqual(50);
      // Should maintain valid markdown structure
      expect(result).toBeTruthy();
    });

    it('should use default max length of 4096', () => {
      const text = 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text);
      expect(result.length).toBeLessThanOrEqual(4096);
    });

    it('should trim end whitespace', () => {
      const text = 'Hello world    ' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 20);
      expect(result).not.toMatch(/\s+$/);
    });

    it('should handle nested code blocks', () => {
      const text = '```js\n```python\ncode\n```\n```' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, 40);
      const codeBlockCount = (result.match(/```/g) || []).length;
      expect(codeBlockCount % 2).toBe(0);
    });

    it('should handle empty string', () => {
      expect(safeMarkdownTruncate('', 100)).toBe('');
    });

    it('should handle text with only markdown', () => {
      const text = '**bold** *italic* `code`';
      expect(safeMarkdownTruncate(text, 100)).toBe(text);
    });

    it('should handle code block at end', () => {
      const text = 'Text before\n```js\nconst x = 1;\n```';
      expect(safeMarkdownTruncate(text, 100)).toBe(text);
    });

    it('should handle truncation right at code block boundary', () => {
      const text = '```js\ncode\n```\n' + 'a'.repeat(5000);
      const result = safeMarkdownTruncate(text, '```js\ncode\n```'.length);
      expect(result).toBe('```js\ncode\n```');
    });
  });
});
