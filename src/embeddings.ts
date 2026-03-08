/**
 * Embeddings — Shared embedding utilities for semantic search.
 *
 * Provides text chunking, embedding generation via Gemini API,
 * and cosine similarity computation. Used by the hybrid search
 * system in knowledge.ts.
 */

import { getGeminiClient } from './gemini-client.js';
import { HYBRID_SEARCH } from './config.js';
import { logger } from './logger.js';

// ============================================================================
// Vector Math
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector is zero-length or mismatched.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================================
// Text Chunking
// ============================================================================

/**
 * Split text into chunks at paragraph boundaries, combining adjacent
 * paragraphs until the combined length approaches maxChars.
 */
export function chunkText(
  text: string,
  maxChars = HYBRID_SEARCH.CHUNK_SIZE,
): Array<{ text: string; startOffset: number }> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: Array<{ text: string; startOffset: number }> = [];

  let current = '';
  let startOffset = 0;
  let cursor = 0;

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push({ text: current, startOffset });
      startOffset = cursor;
      current = para;
    } else {
      current = candidate;
    }
    cursor += para.length + 2;
  }

  if (current.length > 0) {
    chunks.push({ text: current, startOffset });
  }

  // Fallback: hard-split if no blank lines found
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({ text: text.slice(i, i + maxChars), startOffset: i });
    }
  }

  return chunks;
}

// ============================================================================
// Embedding Generation
// ============================================================================

const EMBED_MAX_RETRIES = 3;
const EMBED_BASE_DELAY_MS = 1000;

/**
 * Generate an embedding vector for a text string.
 * Returns null if the Gemini client is unavailable.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const client = await getGeminiClient();
  if (!client) return null;

  for (let attempt = 1; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      const response = await client.models.embedContent({
        model: HYBRID_SEARCH.EMBED_MODEL,
        contents: [{ parts: [{ text }] }],
      });
      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
        throw new Error('Empty embedding returned');
      }
      return values;
    } catch (err) {
      if (attempt === EMBED_MAX_RETRIES) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'Embedding generation failed after retries',
        );
        return null;
      }
      await new Promise((r) =>
        setTimeout(r, EMBED_BASE_DELAY_MS * 2 ** (attempt - 1)),
      );
    }
  }
  return null;
}

/**
 * Generate embeddings for multiple texts sequentially.
 * Returns null entries for any texts that fail.
 */
export async function embedBatch(
  texts: string[],
): Promise<Array<number[] | null>> {
  const results: Array<number[] | null> = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}

// ============================================================================
// BLOB Serialization
// ============================================================================

/** Serialize a number array to a Buffer for SQLite BLOB storage. */
export function embeddingToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/** Deserialize a Buffer from SQLite BLOB storage to a number array. */
export function blobToEmbedding(blob: Buffer): number[] {
  return Array.from(
    new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4),
  );
}
