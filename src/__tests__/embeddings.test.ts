import { describe, expect, it, vi } from 'vitest';

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
  cosineSimilarity,
  embeddingToBlob,
} from '../embeddings.js';

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

    it('falls back to hard splits when no paragraph boundaries exist', () => {
      const result = chunkText('abcdefghij', 6, 2);
      expect(result.length).toBe(1);
      expect(result[0].text).toBe('abcdefghij');
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
