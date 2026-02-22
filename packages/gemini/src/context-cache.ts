/**
 * Context Cache Manager
 *
 * Manages per-group Gemini context caches to reduce input token costs.
 * Caches static content (system prompt + persona + knowledge docs) that
 * doesn't change between requests.
 *
 * Cost savings: 75% on Gemini 2.0 models, 90% on Gemini 2.5+ models.
 */

import crypto from 'crypto';
import { FAST_PATH } from '@nanogemclaw/core';
import { getGeminiClient } from './gemini-client.js';
import { logger } from '@nanogemclaw/core/logger';

// ============================================================================
// Types
// ============================================================================

interface CacheEntry {
  /** Gemini cache resource name (e.g. 'cachedContents/abc123') */
  cacheName: string;
  /** Hash of the cached content for change detection */
  contentHash: string;
  /** When this cache expires */
  expiresAt: number;
  /** Model the cache was created for */
  model: string;
}

// ============================================================================
// Cache Registry (in-memory)
// ============================================================================

const cacheRegistry = new Map<string, CacheEntry>();

/**
 * Generate a short hash of content for change detection.
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Build the cacheable content string from group config.
 */
export function buildCacheableContent(
  systemPrompt: string,
  knowledgeContent?: string,
  memoryContext?: string,
): string {
  const parts: string[] = [];

  if (systemPrompt) {
    parts.push(
      `[SYSTEM INSTRUCTION]\n${systemPrompt}\n[END SYSTEM INSTRUCTION]`,
    );
  }

  if (knowledgeContent) {
    parts.push(`[KNOWLEDGE BASE]\n${knowledgeContent}\n[END KNOWLEDGE BASE]`);
  }

  if (memoryContext) {
    parts.push(memoryContext);
  }

  return parts.join('\n\n');
}

/**
 * Get or create a context cache for a group.
 *
 * Returns the cache name if caching is possible, null otherwise.
 * Caching is skipped if content is below the minimum threshold.
 */
export async function getOrCreateCache(
  groupFolder: string,
  model: string,
  systemPrompt: string,
  knowledgeContent?: string,
  memoryContext?: string,
): Promise<string | null> {
  const client = getGeminiClient();
  if (!client) return null;

  const cacheableContent = buildCacheableContent(
    systemPrompt,
    knowledgeContent,
    memoryContext,
  );

  // Skip caching if content is too small
  if (cacheableContent.length < FAST_PATH.MIN_CACHE_CHARS) {
    logger.debug(
      { groupFolder, contentLength: cacheableContent.length },
      'Content below cache threshold, skipping cache',
    );
    return null;
  }

  const contentHash = hashContent(cacheableContent);

  // Check existing cache
  const existing = cacheRegistry.get(groupFolder);
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.model === model &&
    existing.expiresAt > Date.now()
  ) {
    logger.debug(
      { groupFolder, cacheName: existing.cacheName },
      'Using existing context cache',
    );
    return existing.cacheName;
  }

  // Create new cache
  try {
    const cache = await client.caches.create({
      model,
      config: {
        contents: [
          {
            role: 'user' as const,
            parts: [{ text: cacheableContent }],
          },
        ],
        ttl: `${FAST_PATH.CACHE_TTL_SECONDS}s`,
        displayName: `nanoclaw-${groupFolder}`,
      },
    });

    if (cache.name) {
      cacheRegistry.set(groupFolder, {
        cacheName: cache.name,
        contentHash,
        expiresAt: Date.now() + FAST_PATH.CACHE_TTL_SECONDS * 1000,
        model,
      });

      logger.info(
        {
          groupFolder,
          cacheName: cache.name,
          contentLength: cacheableContent.length,
          ttlSeconds: FAST_PATH.CACHE_TTL_SECONDS,
        },
        'Context cache created',
      );

      return cache.name;
    }
  } catch (err) {
    // Cache creation can fail due to model limitations, content too small, etc.
    // This is expected for some configurations - fall back to uncached path.
    const msg = err instanceof Error ? err.message : String(err);

    // Don't log as error for expected failures (model doesn't support caching, etc.)
    if (msg.includes('not supported') || msg.includes('too few tokens')) {
      logger.debug(
        { groupFolder, reason: msg },
        'Context caching not available for this request',
      );
    } else {
      logger.warn({ groupFolder, err: msg }, 'Failed to create context cache');
    }
  }

  return null;
}

/**
 * Invalidate the cache for a group (e.g. when config changes).
 */
export function invalidateCache(groupFolder: string): void {
  const existing = cacheRegistry.get(groupFolder);
  if (existing) {
    cacheRegistry.delete(groupFolder);
    logger.debug({ groupFolder }, 'Context cache invalidated');

    // Best-effort delete from Gemini API
    const client = getGeminiClient();
    if (client) {
      client.caches.delete({ name: existing.cacheName }).catch(() => {
        // Ignore delete failures
      });
    }
  }
}

/**
 * Get cache stats for monitoring.
 */
export function getCacheStats(): {
  totalCaches: number;
  activeCaches: number;
  entries: Array<{
    groupFolder: string;
    model: string;
    expiresIn: number;
  }>;
} {
  const now = Date.now();
  const entries = Array.from(cacheRegistry.entries())
    .filter(([, entry]) => entry.expiresAt > now)
    .map(([groupFolder, entry]) => ({
      groupFolder,
      model: entry.model,
      expiresIn: Math.round((entry.expiresAt - now) / 1000),
    }));

  return {
    totalCaches: cacheRegistry.size,
    activeCaches: entries.length,
    entries,
  };
}
