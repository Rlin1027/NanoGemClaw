import { getGeminiClient } from './gemini-client.js';
import { HYBRID_SEARCH } from './config.js';
import { logger } from './logger.js';

const MAX_CHUNKS_PER_DOC = 200;

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

export function chunkText(
  text: string,
  maxChars = HYBRID_SEARCH.CHUNK_SIZE,
  overlapChars = HYBRID_SEARCH.CHUNK_OVERLAP,
): Array<{ text: string; startOffset: number }> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const windows: Array<{ paragraphs: string[]; startOffset: number }> = [];
  let current: string[] = [];
  let currentLen = 0;
  let startOffset = 0;
  let cursor = 0;

  for (const para of paragraphs) {
    const addLen = current.length > 0 ? para.length + 2 : para.length;
    if (currentLen + addLen > maxChars && current.length > 0) {
      windows.push({ paragraphs: [...current], startOffset });
      startOffset = cursor;
      current = [para];
      currentLen = para.length;
    } else {
      current.push(para);
      currentLen += addLen;
    }
    cursor += para.length + 2;
  }

  if (current.length > 0) {
    windows.push({ paragraphs: current, startOffset });
  }

  const chunks: Array<{ text: string; startOffset: number }> = [];
  for (let i = 0; i < windows.length; i++) {
    let chunk = windows[i].paragraphs.join('\n\n');
    const chunkOffset = windows[i].startOffset;

    if (i > 0 && overlapChars > 0) {
      const overlapParts: string[] = [];
      let overlapLen = 0;
      const prevParas = windows[i - 1].paragraphs;
      for (let j = prevParas.length - 1; j >= 0; j--) {
        const addLen =
          overlapParts.length > 0
            ? prevParas[j].length + 2
            : prevParas[j].length;
        if (overlapLen + addLen > overlapChars) break;
        overlapParts.unshift(prevParas[j]);
        overlapLen += addLen;
      }
      if (overlapParts.length > 0) {
        chunk = overlapParts.join('\n\n') + '\n\n' + chunk;
      }
    }

    chunks.push({ text: chunk, startOffset: chunkOffset });
  }

  if (chunks.length === 0 && text.length > 0) {
    const step = Math.max(maxChars - overlapChars, 1);
    for (let i = 0; i < text.length; i += step) {
      chunks.push({ text: text.slice(i, i + maxChars), startOffset: i });
    }
  }

  if (chunks.length > MAX_CHUNKS_PER_DOC) {
    logger.warn(
      { total: chunks.length, limit: MAX_CHUNKS_PER_DOC },
      'chunkText: chunk count exceeds MAX_CHUNKS_PER_DOC, truncating',
    );
    chunks.splice(MAX_CHUNKS_PER_DOC);
  }

  return chunks;
}

const EMBED_MAX_RETRIES = 3;
const EMBED_BASE_DELAY_MS = 1000;

// Module-level query embedding cache (LRU via Map insertion order)
const queryCache = new Map<string, { embedding: number[]; ts: number }>();
const QUERY_CACHE_MAX = 200;
const QUERY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export function clearEmbeddingCache(): void {
  queryCache.clear();
}

export async function embedText(text: string): Promise<number[] | null> {
  const cacheKey = text.trim().toLowerCase();

  // Check cache hit (within TTL) — LRU refresh via delete + re-set
  const cached = queryCache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.ts < QUERY_CACHE_TTL_MS) {
    queryCache.delete(cacheKey);
    queryCache.set(cacheKey, cached);
    return cached.embedding;
  }

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

      // Add to cache, evict oldest entry if over max
      queryCache.set(cacheKey, { embedding: values, ts: Date.now() });
      if (queryCache.size > QUERY_CACHE_MAX) {
        const oldestKey = queryCache.keys().next().value;
        if (oldestKey !== undefined) {
          queryCache.delete(oldestKey);
        }
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
      await new Promise((resolve) =>
        setTimeout(resolve, EMBED_BASE_DELAY_MS * 2 ** (attempt - 1)),
      );
    }
  }

  return null;
}

const EMBED_CONCURRENCY = 4;

export async function embedBatch(
  texts: string[],
): Promise<Array<number[] | null>> {
  const results: Array<number[] | null> = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += EMBED_CONCURRENCY) {
    const batch = texts.slice(i, i + EMBED_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((t) => embedText(t)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      results[i + j] = r.status === 'fulfilled' ? r.value : null;
    }
  }

  return results;
}

export function embeddingToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export function blobToEmbedding(blob: Buffer): number[] {
  return Array.from(
    new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4),
  );
}
