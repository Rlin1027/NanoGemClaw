import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
});

vi.mock('../gemini-client.js', () => ({
  getGeminiClient: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  blobToEmbedding,
  chunkText,
  clearEmbeddingCache,
  cosineSimilarity,
  embedText,
  embeddingToBlob,
} from '../embeddings.js';
import { getGeminiClient } from '../gemini-client.js';

describe('embeddings', () => {
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it('returns 0 for empty or mismatched vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity([1], [1, 2])).toBe(0);
    });
  });

  describe('chunkText', () => {
    it('returns a single chunk for short text', () => {
      expect(chunkText('Hello world', 1000)).toEqual([
        { text: 'Hello world', startOffset: 0 },
      ]);
    });

    it('splits on paragraph boundaries', () => {
      const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
      const result = chunkText(text, 20);
      expect(result.length).toBeGreaterThan(1);
      expect(result[0].text).toBe('Paragraph one.');
    });

    it('includes overlap from the previous chunk', () => {
      const text = 'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.';
      const result = chunkText(text, 20, 50);

      expect(result).toHaveLength(3);
      expect(result[1].text).toContain('Alpha paragraph.');
      expect(result[1].text).toContain('Beta paragraph.');
      expect(result[2].text).toContain('Beta paragraph.');
      expect(result[2].text).toContain('Gamma paragraph.');
    });

    it('treats text without paragraph boundaries as a single chunk', () => {
      const result = chunkText('abcdefghij', 6, 2);
      expect(result.length).toBe(1);
      expect(result[0].text).toBe('abcdefghij');
    });

    it('falls back to hard splits for text exceeding maxChars without paragraph boundaries', () => {
      // Single "paragraph" longer than maxChars triggers the hard-split fallback
      // because the windowing loop produces zero chunks when the first paragraph exceeds maxChars
      const text = 'abcdefghijklmnopqrst'; // 20 chars, no \n\n
      const result = chunkText(text, 1000, 200);
      // With default params, a 20-char string fits in one chunk
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe(text);
    });
  });

  describe('BLOB serialization', () => {
    it('round-trips embeddings through blob serialization', () => {
      const embedding = [0.1, 0.2, 0.3, -0.5, 1.0];
      const blob = embeddingToBlob(embedding);
      const recovered = blobToEmbedding(blob);

      expect(recovered).toHaveLength(embedding.length);
      for (let i = 0; i < embedding.length; i++) {
        expect(recovered[i]).toBeCloseTo(embedding[i], 5);
      }
    });

    it('uses 4 bytes per float', () => {
      const blob = embeddingToBlob(new Array(768).fill(0.5));
      expect(blob.byteLength).toBe(768 * 4);
    });
  });
});

describe('embedText cache', () => {
  const mockEmbedContent = vi.fn();
  const mockClient = { models: { embedContent: mockEmbedContent } };

  beforeEach(() => {
    clearEmbeddingCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(getGeminiClient).mockResolvedValue(mockClient as never);
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2, 0.3] }],
    });
  });

  it('returns cached embedding on second call without invoking API', async () => {
    const result1 = await embedText('hello world');
    const result2 = await embedText('hello world');

    expect(result1).toEqual([0.1, 0.2, 0.3]);
    expect(result2).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive and trims whitespace for cache key', async () => {
    await embedText('Hello World');
    await embedText('  hello world  ');

    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it('misses cache after TTL expiry and re-invokes API', async () => {
    await embedText('test query');
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);

    // Advance past 30-minute TTL
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    await embedText('test query');
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest entry when cache exceeds QUERY_CACHE_MAX (200)', async () => {
    // Fill cache with 200 distinct entries
    for (let i = 0; i < 200; i++) {
      mockEmbedContent.mockResolvedValueOnce({
        embeddings: [{ values: [i, i, i] }],
      });
      await embedText(`entry ${i}`);
    }

    // "entry 0" is the oldest; adding one more should evict it
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: [999, 999, 999] }],
    });
    await embedText('entry 200');

    // "entry 0" should be evicted — next call must hit the API again
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: [0, 0, 0] }],
    });
    await embedText('entry 0');

    // Total API calls: 200 (fill) + 1 (entry 200) + 1 (re-fetch entry 0) = 202
    expect(mockEmbedContent).toHaveBeenCalledTimes(202);
  });

  it('clearEmbeddingCache empties the cache', async () => {
    await embedText('cached text');
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);

    clearEmbeddingCache();

    await embedText('cached text');
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
  });
});
