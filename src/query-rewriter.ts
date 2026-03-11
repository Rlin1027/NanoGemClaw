import { createHash } from 'crypto';

import { generate } from './gemini-client.js';
import { QUERY_REWRITE } from './config.js';
import { logger } from './logger.js';

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
  if (Date.now() - entry.ts > 5 * 60 * 1000) {
    cache.delete(key);
    return null;
  }
  return entry.query;
}

function setCache(key: string, query: string): void {
  if (cache.size >= QUERY_REWRITE.CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { query, ts: Date.now() });
}

const SYSTEM_PROMPT = `You are a search query optimizer. Given a user's message and recent conversation context, extract the core search intent as 2-5 keywords or short phrases suitable for full-text search.

Rules:
- Resolve pronouns and references using conversation context
- Output ONLY the search keywords, space-separated, on a single line
- If the message is a greeting, casual chat, or doesn't need knowledge retrieval, output exactly: NONE
- Prefer nouns and specific terms over verbs and stop words
- Keep keywords in the same language as the user's message
- Do NOT add explanations or formatting`;

export async function rewriteQuery(
  prompt: string,
  conversationHistory: Array<{ role: string; text: string }>,
): Promise<string> {
  if (!QUERY_REWRITE.ENABLED) {
    return fallbackQuery(prompt);
  }

  const cacheKey = getCacheKey(prompt, conversationHistory);
  const cached = getFromCache(cacheKey);
  if (cached !== null) {
    logger.debug({ cached }, 'Query rewrite cache hit');
    return cached;
  }

  try {
    const result = await Promise.race([
      rewriteWithContext(prompt, conversationHistory),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error('Query rewrite timed out')),
          QUERY_REWRITE.TIMEOUT_MS,
        ),
      ),
    ]);
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

async function rewriteWithContext(
  prompt: string,
  history: Array<{ role: string; text: string }>,
): Promise<string> {
  const recentHistory = history.slice(-QUERY_REWRITE.MAX_HISTORY);
  const contextLines = recentHistory.map((msg) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    return `${role}: ${msg.text.slice(0, 500)}`;
  });
  const contextBlock =
    contextLines.length > 0
      ? `Recent conversation:\n${contextLines.join('\n')}\n\n`
      : '';

  const response = await generate({
    model: QUERY_REWRITE.MODEL,
    systemInstruction: SYSTEM_PROMPT,
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${contextBlock}Current message: ${prompt.slice(0, 500)}` },
        ],
      },
    ],
  });

  const text = (response.text || '').trim();
  if (!text || text === 'NONE') return '';

  const firstLine = text.split('\n')[0].trim().slice(0, 300);
  logger.debug(
    { original: prompt.slice(0, 100), rewritten: firstLine },
    'Query rewritten',
  );
  return firstLine;
}

function fallbackQuery(prompt: string): string {
  return prompt.replace(/<[^>]*>/g, '').slice(0, 200);
}

export { cache as _cache, fallbackQuery as _fallbackQuery };
