/**
 * Query Rewriter — Rewrites user queries using conversation context
 * for more effective knowledge retrieval.
 *
 * Uses a lightweight Gemini model to resolve pronouns, coreferences,
 * and abbreviations in user messages by considering recent conversation history.
 */

import { createHash } from 'crypto';
import { generate } from './gemini-client.js';
import { QUERY_REWRITE } from './config.js';
import { logger } from './logger.js';

// ============================================================================
// LRU Cache
// ============================================================================

const cache = new Map<string, { query: string; ts: number }>();

function getCacheKey(prompt: string, history: Array<{ text: string }>): string {
  const last3 = history
    .slice(-3)
    .map((m) => m.text.slice(0, 200))
    .join('|');
  return createHash('sha256')
    .update(prompt + '||' + last3)
    .digest('hex')
    .slice(0, 16);
}

function getFromCache(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  // Expire after 5 minutes
  if (Date.now() - entry.ts > 5 * 60 * 1000) {
    cache.delete(key);
    return null;
  }
  return entry.query;
}

function setCache(key: string, query: string): void {
  // Evict oldest entries if cache is full
  if (cache.size >= QUERY_REWRITE.CACHE_SIZE) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  cache.set(key, { query, ts: Date.now() });
}

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a search query optimizer. Given a user's message and recent conversation context, extract the core search intent as 2-5 keywords or short phrases suitable for full-text search.

Rules:
- Resolve pronouns and references using conversation context (e.g. "that thing" → the actual topic)
- Output ONLY the search keywords, space-separated, on a single line
- If the message is a greeting, casual chat, or doesn't need knowledge retrieval, output exactly: NONE
- Prefer nouns and specific terms over verbs and stop words
- Keep keywords in the same language as the user's message
- Do NOT add explanations or formatting`;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Rewrite a user query using conversation context for better knowledge retrieval.
 *
 * Returns optimized search keywords, empty string if knowledge is not needed,
 * or falls back to truncated original prompt on error.
 */
export async function rewriteQuery(
  prompt: string,
  conversationHistory: Array<{ role: string; text: string }>,
): Promise<string> {
  if (!QUERY_REWRITE.ENABLED) {
    return fallbackQuery(prompt);
  }

  // Build cache key and check cache
  const cacheKey = getCacheKey(prompt, conversationHistory);
  const cached = getFromCache(cacheKey);
  if (cached !== null) {
    logger.debug({ cached }, 'Query rewrite cache hit');
    return cached;
  }

  try {
    const result = await rewriteWithTimeout(prompt, conversationHistory);
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'Query rewrite failed, using fallback',
    );
    return fallbackQuery(prompt);
  }
}

async function rewriteWithTimeout(
  prompt: string,
  history: Array<{ role: string; text: string }>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_REWRITE.TIMEOUT_MS);

  try {
    // Build conversation context from recent history
    const recentHistory = history.slice(-QUERY_REWRITE.MAX_HISTORY);
    const contextLines = recentHistory.map(
      (msg) =>
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text.slice(0, 500)}`,
    );
    const contextBlock =
      contextLines.length > 0
        ? `Recent conversation:\n${contextLines.join('\n')}\n\n`
        : '';

    const userMessage = `${contextBlock}Current message: ${prompt.slice(0, 500)}`;

    const response = await generate({
      model: QUERY_REWRITE.MODEL,
      systemInstruction: SYSTEM_PROMPT,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    });

    const text = (response.text || '').trim();

    if (!text || text === 'NONE') {
      return '';
    }

    // Sanitize: take first line only, limit length
    const firstLine = text.split('\n')[0].trim().slice(0, 300);
    logger.debug(
      { original: prompt.slice(0, 100), rewritten: firstLine },
      'Query rewritten',
    );
    return firstLine;
  } finally {
    clearTimeout(timer);
  }
}

function fallbackQuery(prompt: string): string {
  return prompt.replace(/<[^>]*>/g, '').slice(0, 200);
}

/** Exposed for testing */
export { cache as _cache, fallbackQuery as _fallbackQuery };
