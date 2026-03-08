import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
});

const mockGenerate = vi.fn();

vi.mock('../gemini-client.js', () => ({
  generate: (...args: any[]) => mockGenerate(...args),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { rewriteQuery, _cache, _fallbackQuery } from '../query-rewriter.js';

describe('query-rewriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _cache.clear();
  });

  describe('rewriteQuery', () => {
    it('rewrites query using conversation context', async () => {
      mockGenerate.mockResolvedValue({ text: 'TypeScript migration setup' });

      const result = await rewriteQuery('how do I do that?', [
        { role: 'user', text: 'Tell me about TypeScript migration' },
        { role: 'model', text: 'TypeScript migration involves...' },
      ]);

      expect(result).toBe('TypeScript migration setup');
      expect(mockGenerate).toHaveBeenCalledOnce();
      expect(mockGenerate.mock.calls[0][0].model).toBe(
        'gemini-3.1-flash-lite-preview',
      );
    });

    it('returns empty string when LLM returns NONE', async () => {
      mockGenerate.mockResolvedValue({ text: 'NONE' });

      const result = await rewriteQuery('hey!', []);

      expect(result).toBe('');
    });

    it('returns empty string for empty LLM response', async () => {
      mockGenerate.mockResolvedValue({ text: '' });

      const result = await rewriteQuery('hello', []);

      expect(result).toBe('');
    });

    it('falls back to original query on API error', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const result = await rewriteQuery('test <b>query</b>', []);

      expect(result).toBe('test query');
    });

    it('uses cache on repeated calls', async () => {
      mockGenerate.mockResolvedValue({ text: 'cached keywords' });

      const history = [{ role: 'user', text: 'context' }];
      const result1 = await rewriteQuery('same prompt', history);
      const result2 = await rewriteQuery('same prompt', history);

      expect(result1).toBe('cached keywords');
      expect(result2).toBe('cached keywords');
      expect(mockGenerate).toHaveBeenCalledOnce();
    });

    it('takes only first line of multi-line response', async () => {
      mockGenerate.mockResolvedValue({
        text: 'keywords here\nextra line\nmore',
      });

      const result = await rewriteQuery('test', []);

      expect(result).toBe('keywords here');
    });

    it('includes conversation history in the prompt', async () => {
      mockGenerate.mockResolvedValue({ text: 'result' });

      await rewriteQuery('what about that?', [
        { role: 'user', text: 'msg1' },
        { role: 'model', text: 'msg2' },
        { role: 'user', text: 'msg3' },
      ]);

      const userMessage =
        mockGenerate.mock.calls[0][0].contents[0].parts[0].text;
      expect(userMessage).toContain('Recent conversation:');
      expect(userMessage).toContain('User: msg1');
      expect(userMessage).toContain('Assistant: msg2');
      expect(userMessage).toContain('Current message: what about that?');
    });

    it('truncates long history messages to 500 chars', async () => {
      mockGenerate.mockResolvedValue({ text: 'result' });

      const longText = 'a'.repeat(1000);
      await rewriteQuery('test', [{ role: 'user', text: longText }]);

      const userMessage =
        mockGenerate.mock.calls[0][0].contents[0].parts[0].text;
      // Should contain truncated version (500 chars + "User: " prefix)
      expect(userMessage.length).toBeLessThan(longText.length);
    });
  });

  describe('_fallbackQuery', () => {
    it('strips HTML tags and truncates to 200 chars', () => {
      const result = _fallbackQuery('<b>bold</b> text <i>italic</i>');
      expect(result).toBe('bold text italic');
    });

    it('truncates long text to 200 chars', () => {
      const long = 'a'.repeat(300);
      expect(_fallbackQuery(long)).toHaveLength(200);
    });
  });
});
