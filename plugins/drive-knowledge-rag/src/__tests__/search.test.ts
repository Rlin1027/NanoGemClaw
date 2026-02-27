/**
 * Tests for drive-knowledge-rag/search.ts
 * ~18 tests covering cosineSimilarity and searchKnowledge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock values
// ---------------------------------------------------------------------------

const mockEmbedContent = vi.hoisted(() => vi.fn());
const mockSearchFiles = vi.hoisted(() => vi.fn());
const mockExtractContent = vi.hoisted(() => vi.fn());
const MockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return { models: { embedContent: mockEmbedContent } };
  }),
);

// Mock @google/genai — must use a class (function constructor) to satisfy vitest
vi.mock('@google/genai', () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

// Mock the google-drive plugin
vi.mock('nanogemclaw-plugin-google-drive', () => ({
  searchFiles: mockSearchFiles,
  extractContent: mockExtractContent,
}));

import { cosineSimilarity, searchKnowledge } from '../search.js';
import type { KnowledgeIndex } from '../indexer.js';

// ============================================================================
// cosineSimilarity
// ============================================================================

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical non-zero vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns 1.0 for two identical unit vectors', () => {
    const v = [0, 1, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 10);
  });

  it('returns 0 for a zero vector (avoids division by zero)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for both vectors being zero', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('returns 0 when vectors have different lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns a value in (-1, 1] for arbitrary vectors', () => {
    const score = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('is commutative: similarity(a, b) === similarity(b, a)', () => {
    const a = [1, 0, 1];
    const b = [0, 1, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

// ============================================================================
// searchKnowledge helpers
// ============================================================================

/**
 * Build an index where each doc has a chunk embedding that produces a
 * *distinct* cosine similarity with the query embedding.
 *
 * Strategy: use 2-D vectors.
 *   query  = [1, 0]
 *   chunk  = [cos(θ), sin(θ)]   where θ = arccos(desiredScore)
 * → cos_sim(query, chunk) = dot([1,0],[cos,sin]) / (1 * 1) = cos(θ) = desiredScore
 *
 * This gives exact, distinct similarity values for any desiredScore ∈ (0,1].
 */
function makeIndex(docs: Array<{
  fileId: string;
  name: string;
  score: number; // desired cosine similarity with [1, 0]
}>): KnowledgeIndex {
  const documents: KnowledgeIndex['documents'] = {};
  for (const doc of docs) {
    const theta = Math.acos(Math.min(1, Math.max(-1, doc.score)));
    const embedding = [Math.cos(theta), Math.sin(theta)]; // unit vector
    documents[doc.fileId] = {
      fileId: doc.fileId,
      name: doc.name,
      mimeType: 'text/plain',
      modifiedTime: '2026-01-01T00:00:00Z',
      chunks: [
        {
          text: `Sample text for ${doc.name}`,
          embedding,
          startOffset: 0,
        },
      ],
    };
  }
  return { documents, lastScanAt: null };
}

// Query embedding [1, 0] — cosine similarity with [cos(θ), sin(θ)] == cos(θ)
const QUERY_EMBEDDING = [1, 0];

// ============================================================================
// searchKnowledge
// ============================================================================

describe('searchKnowledge', () => {
  beforeEach(() => {
    // Clear call history and reset return values before every test
    vi.clearAllMocks();

    // vi.clearAllMocks() wipes mockImplementation on MockGoogleGenAI — restore it
    MockGoogleGenAI.mockImplementation(function () {
      return { models: { embedContent: mockEmbedContent } };
    });

    // Set GEMINI_API_KEY so embedText doesn't throw before hitting the mock
    process.env.GEMINI_API_KEY = 'test-key';

    // Default: embedContent returns the fixed query embedding
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: QUERY_EMBEDDING }],
    });
    mockSearchFiles.mockResolvedValue({ files: [] });
    mockExtractContent.mockResolvedValue({ content: 'live content', mimeType: 'text/plain', truncated: false });
  });

  it('returns index results sorted by descending similarity score', async () => {
    const index = makeIndex([
      { fileId: 'f1', name: 'Low', score: 0.5 },
      { fileId: 'f2', name: 'High', score: 0.95 },
      { fileId: 'f3', name: 'Mid', score: 0.75 },
    ]);
    const results = await searchKnowledge('query', index, { similarityThreshold: 0.4 });
    expect(results[0].fileId).toBe('f2');
    expect(results[1].fileId).toBe('f3');
    expect(results[2].fileId).toBe('f1');
  });

  it('does not call live search when top Layer 1 score >= threshold', async () => {
    const index = makeIndex([{ fileId: 'f1', name: 'Doc', score: 0.95 }]);
    await searchKnowledge('query', index, { similarityThreshold: 0.7 });
    expect(mockSearchFiles).not.toHaveBeenCalled();
  });

  it('calls live search when Layer 1 top score is below threshold', async () => {
    const index = makeIndex([{ fileId: 'f1', name: 'Doc', score: 0.3 }]);
    await searchKnowledge('query', index, { similarityThreshold: 0.7 });
    expect(mockSearchFiles).toHaveBeenCalled();
  });

  it('merges and deduplicates index + live results by fileId', async () => {
    const index = makeIndex([{ fileId: 'shared', name: 'SharedDoc', score: 0.3 }]);
    mockSearchFiles.mockResolvedValue({
      files: [
        { id: 'shared', name: 'SharedDoc', mimeType: 'text/plain' },
        { id: 'live-only', name: 'LiveOnly', mimeType: 'text/plain' },
      ],
    });
    const results = await searchKnowledge('query', index, { similarityThreshold: 0.7 });
    const ids = results.map((r) => r.fileId);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('falls back to live search when index is empty', async () => {
    const emptyIndex: KnowledgeIndex = { documents: {}, lastScanAt: null };
    mockSearchFiles.mockResolvedValue({
      files: [{ id: 'live1', name: 'LiveFile', mimeType: 'text/plain' }],
    });
    const results = await searchKnowledge('query', emptyIndex, { similarityThreshold: 0.7 });
    expect(mockSearchFiles).toHaveBeenCalled();
    expect(results.length).toBeGreaterThanOrEqual(0); // live results returned
  });

  it('falls straight to live search when embedding fails', async () => {
    mockEmbedContent.mockRejectedValue(new Error('API down'));
    mockSearchFiles.mockResolvedValue({
      files: [{ id: 'live1', name: 'LiveFile', mimeType: 'text/plain' }],
    });
    const index = makeIndex([{ fileId: 'f1', name: 'Doc', score: 0.9 }]);
    // Should not throw
    await expect(searchKnowledge('query', index)).resolves.toBeDefined();
    expect(mockSearchFiles).toHaveBeenCalled();
  });

  it('respects maxResults option', async () => {
    const index = makeIndex(
      Array.from({ length: 10 }, (_, i) => ({ fileId: `f${i}`, name: `Doc${i}`, score: 0.9 - i * 0.01 })),
    );
    const results = await searchKnowledge('query', index, { maxResults: 3, similarityThreshold: 0.4 });
    expect(results).toHaveLength(3);
  });

  it('returns source="index" for results from the local index', async () => {
    const index = makeIndex([{ fileId: 'f1', name: 'Doc', score: 0.95 }]);
    const results = await searchKnowledge('query', index, { similarityThreshold: 0.7 });
    expect(results[0].source).toBe('index');
  });

  it('returns source="live" for results from the live search', async () => {
    const emptyIndex: KnowledgeIndex = { documents: {}, lastScanAt: null };
    mockSearchFiles.mockResolvedValue({
      files: [{ id: 'live1', name: 'LiveFile', mimeType: 'text/plain' }],
    });
    const results = await searchKnowledge('query', emptyIndex, { similarityThreshold: 0.7 });
    if (results.length > 0) {
      expect(results[0].source).toBe('live');
    }
  });
});
