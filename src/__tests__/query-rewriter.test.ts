import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('rewrites query using conversation context', async () => {
    mockGenerate.mockResolvedValue({ text: 'TypeScript migration setup' });

    const result = await rewriteQuery('how do I do that?', [
      { role: 'user', text: 'Tell me about TypeScript migration' },
      { role: 'model', text: 'TypeScript migration involves...' },
    ]);

    expect(result).toBe('TypeScript migration setup');
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('returns empty string when LLM returns NONE', async () => {
    mockGenerate.mockResolvedValue({ text: 'NONE' });
    await expect(rewriteQuery('hey!', [])).resolves.toBe('');
  });

  it('falls back to original query on API error', async () => {
    mockGenerate.mockRejectedValue(new Error('API error'));
    await expect(rewriteQuery('test <b>query</b>', [])).resolves.toBe(
      'test query',
    );
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
    mockGenerate.mockResolvedValue({ text: 'keywords here\nextra line' });
    await expect(rewriteQuery('test', [])).resolves.toBe('keywords here');
  });

  it('includes conversation history in the prompt', async () => {
    mockGenerate.mockResolvedValue({ text: 'result' });

    await rewriteQuery('what about that?', [
      { role: 'user', text: 'msg1' },
      { role: 'model', text: 'msg2' },
      { role: 'user', text: 'msg3' },
    ]);

    const userMessage = mockGenerate.mock.calls[0][0].contents[0].parts[0].text;
    expect(userMessage).toContain('Recent conversation:');
    expect(userMessage).toContain('User: msg1');
    expect(userMessage).toContain('Assistant: msg2');
    expect(userMessage).toContain('Current message: what about that?');
  });

  it('truncates long history messages', async () => {
    mockGenerate.mockResolvedValue({ text: 'result' });
    const longText = 'a'.repeat(1000);

    await rewriteQuery('test', [{ role: 'user', text: longText }]);

    const userMessage = mockGenerate.mock.calls[0][0].contents[0].parts[0].text;
    expect(userMessage.length).toBeLessThan(longText.length);
  });

  it('strips HTML tags in fallback query', () => {
    expect(_fallbackQuery('<b>bold</b> text')).toBe('bold text');
  });

  it('truncates long fallback queries to 200 chars', () => {
    expect(_fallbackQuery('a'.repeat(300))).toHaveLength(200);
  });
});
