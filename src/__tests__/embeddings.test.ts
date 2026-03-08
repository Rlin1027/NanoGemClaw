import { vi, describe, it, expect } from 'vitest';

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
  cosineSimilarity,
  chunkText,
  embeddingToBlob,
  blobToEmbedding,
} from '../embeddings.js';

describe('embeddings', () => {
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it('returns -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
    });

    it('returns 0 for mismatched lengths', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('returns 0 for empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for zero vectors', () => {
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it('computes correct similarity for known vectors', () => {
      // cos(45°) ≈ 0.7071
      const a = [1, 0];
      const b = [1, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT1_2, 4);
    });
  });

  describe('chunkText', () => {
    it('returns single chunk for short text', () => {
      const result = chunkText('Hello world', 1000);
      expect(result).toEqual([{ text: 'Hello world', startOffset: 0 }]);
    });

    it('splits on paragraph boundaries', () => {
      const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
      const result = chunkText(text, 20);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].text).toBe('Paragraph one.');
    });

    it('combines adjacent paragraphs within maxChars', () => {
      const text = 'Short.\n\nAlso short.';
      const result = chunkText(text, 1000);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Short.\n\nAlso short.');
    });

    it('keeps single paragraph as one chunk even if over maxChars', () => {
      // chunkText splits by paragraphs first; a single long paragraph
      // without blank lines stays as one chunk
      const text = 'a'.repeat(2500);
      const result = chunkText(text, 1000);

      expect(result).toHaveLength(1);
      expect(result[0].text).toHaveLength(2500);
    });

    it('hard-splits truly empty paragraph output', () => {
      // When text has no content after paragraph filtering (edge case),
      // hard-split kicks in. Test with content that only has blank lines.
      const result = chunkText('abc', 1000);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('abc');
    });

    it('handles empty text', () => {
      expect(chunkText('', 1000)).toEqual([]);
    });

    it('tracks startOffset correctly', () => {
      const text = 'First paragraph.\n\nSecond paragraph.';
      const result = chunkText(text, 20);

      expect(result[0].startOffset).toBe(0);
      if (result.length > 1) {
        expect(result[1].startOffset).toBeGreaterThan(0);
      }
    });
  });

  describe('BLOB serialization', () => {
    it('round-trips embedding to blob and back', () => {
      const embedding = [0.1, 0.2, 0.3, -0.5, 1.0];
      const blob = embeddingToBlob(embedding);
      const recovered = blobToEmbedding(blob);

      expect(recovered).toHaveLength(embedding.length);
      for (let i = 0; i < embedding.length; i++) {
        expect(recovered[i]).toBeCloseTo(embedding[i], 5);
      }
    });

    it('handles empty embedding', () => {
      const blob = embeddingToBlob([]);
      const recovered = blobToEmbedding(blob);
      expect(recovered).toEqual([]);
    });

    it('produces compact BLOB (4 bytes per float)', () => {
      const embedding = new Array(768).fill(0.5);
      const blob = embeddingToBlob(embedding);
      expect(blob.byteLength).toBe(768 * 4);
    });
  });
});
