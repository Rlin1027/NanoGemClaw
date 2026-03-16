/**
 * Memory Compounder — Transforms flat memory into temporally-layered,
 * compounding knowledge that grows richer over time.
 *
 * Three layers:
 *   Short-term  (7d)   — recent conversation themes, updated every message batch
 *   Medium-term (30d)  — weekly patterns & behavioral trends, updated daily via Flash
 *   Long-term   (perm) — core group identity & stable preferences, updated weekly via Pro
 *
 * Compaction pipeline:
 *   messages → short-term buffer
 *   daily cron  → Flash analyzes short-term → updates medium-term
 *   weekly cron → Pro synthesizes medium-term → updates long-term
 *   long-term   → injects into GEMINI.md [GROUP PROFILE] section
 */

import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, GROUPS_DIR, MEMORY_COMPOUNDER } from './config.js';
import {
  upsertTemporalMemory,
  getTemporalMemory,
  cleanExpiredTemporalMemories,
} from './db/temporal-memory.js';
export { getTemporalContext } from './db/temporal-memory.js';
import { getMessagesSince } from './db/messages.js';
import { getFacts } from './db/facts.js';
import { logger } from './logger.js';
import { recordCompressionScore } from './memory-metrics.js';
import type { RegisteredGroup } from './types.js';

// ============================================================================
// Configuration
// ============================================================================

export const COMPOUNDER = {
  /** Flash model for daily compaction (cheap) */
  FLASH_MODEL: process.env.COMPOUNDER_FLASH_MODEL || 'gemini-3-flash-preview',
  /** Pro model for weekly deep synthesis */
  PRO_MODEL: process.env.COMPOUNDER_PRO_MODEL || 'gemini-3-pro-preview',
  /** Maximum short-term content length (chars) */
  MAX_SHORT_CONTENT: 2000,
  /** Maximum medium-term content length (chars) */
  MAX_MEDIUM_CONTENT: 3000,
  /** Maximum long-term content length (chars) */
  MAX_LONG_CONTENT: 2000,
  /** Timeout for Gemini API calls (ms) */
  API_TIMEOUT_MS: 30000,
} as const;

// ============================================================================
// Short-term Layer — Updated on message batches
// ============================================================================

/**
 * Update short-term memory from recent messages.
 * Called after message processing or periodically.
 */
export async function updateShortTermMemory(
  group: RegisteredGroup,
  chatJid: string,
): Promise<boolean> {
  try {
    const existing = getTemporalMemory(group.folder, 'short');
    const lastUpdated = existing?.updated_at || '1970-01-01T00:00:00.000Z';

    // ASSISTANT_NAME is passed as botPrefix to filter out the bot's own messages
    const messages = getMessagesSince(chatJid, lastUpdated, ASSISTANT_NAME);
    if (messages.length < MEMORY_COMPOUNDER.MIN_MESSAGES_FOR_SHORT) {
      return false;
    }

    const { generate, isGeminiClientAvailable } =
      await import('./gemini-client.js');
    if (!isGeminiClientAvailable()) return false;

    const conversationSnippet = messages
      .map((m: { sender_name?: string; sender: string; content: string }) => {
        const name = (m.sender_name || m.sender || 'Unknown')
          .replace(/[\n\r\0]/g, '')
          .slice(0, 30);
        const content = (m.content || '').slice(0, 500);
        return `[${name}]: ${content}`;
      })
      .join('\n')
      .slice(0, 8000);

    const previousShort =
      existing?.content || '(no previous short-term memory)';

    const prompt = `You are analyzing recent chat messages for a group called "${group.name}".

Previous short-term memory:
${previousShort}

New messages (${messages.length} total):
${conversationSnippet}

Synthesize an updated short-term memory snapshot. Include:
1. Active conversation topics and themes
2. Current mood/energy of the group
3. Any questions or requests mentioned
4. Notable information shared

Output in the group's primary language. Keep under ${COMPOUNDER.MAX_SHORT_CONTENT} characters. Be concise and factual.`;

    const result = await withTimeout(
      generate({
        model: COMPOUNDER.FLASH_MODEL,
        contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
      }),
      COMPOUNDER.API_TIMEOUT_MS,
    );

    if (result.text) {
      const content = result.text.slice(0, COMPOUNDER.MAX_SHORT_CONTENT);
      upsertTemporalMemory(group.folder, 'short', content, {
        messagesProcessed: messages.length,
        model: COMPOUNDER.FLASH_MODEL,
      });

      logger.info(
        { group: group.name, messages: messages.length, len: content.length },
        'Short-term memory updated',
      );
      return true;
    }
  } catch (err) {
    logger.warn(
      {
        group: group.name,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to update short-term memory',
    );
  }
  return false;
}

// ============================================================================
// Medium-term Layer — Daily compaction via Flash
// ============================================================================

/**
 * Compact short-term into medium-term (daily).
 * Identifies weekly patterns, recurring topics, behavioral trends.
 */
export async function compactToMediumTerm(
  group: RegisteredGroup,
): Promise<boolean> {
  try {
    const shortTerm = getTemporalMemory(group.folder, 'short');
    if (!shortTerm) return false;

    const existingMedium = getTemporalMemory(group.folder, 'medium');
    const facts = getFacts(group.folder);

    const { generate, isGeminiClientAvailable } =
      await import('./gemini-client.js');
    if (!isGeminiClientAvailable()) return false;

    const factsText =
      facts.length > 0
        ? facts.map((f) => `- ${f.key}: ${f.value}`).join('\n')
        : '(no stored facts)';

    const previousMedium =
      existingMedium?.content || '(no previous medium-term memory)';

    const prompt = `You are building a medium-term memory profile for the group "${group.name}".

Current short-term observations:
${shortTerm.content}

Previous medium-term memory:
${previousMedium}

Stored facts about this group:
${factsText}

Synthesize an updated medium-term memory that captures:
1. Recurring conversation patterns and topics (what does this group talk about regularly?)
2. Communication style trends (formal/casual, language preferences, emoji usage)
3. Activity patterns (when is the group most active?)
4. Behavioral trends (how has the group changed recently?)
5. Notable recurring interests or concerns

Merge new observations with existing medium-term knowledge. Drop outdated info.
Output in the group's primary language. Keep under ${COMPOUNDER.MAX_MEDIUM_CONTENT} characters. Be analytical and structured.`;

    const result = await withTimeout(
      generate({
        model: COMPOUNDER.FLASH_MODEL,
        contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
      }),
      COMPOUNDER.API_TIMEOUT_MS,
    );

    if (result.text) {
      const content = result.text.slice(0, COMPOUNDER.MAX_MEDIUM_CONTENT);
      upsertTemporalMemory(group.folder, 'medium', content, {
        model: COMPOUNDER.FLASH_MODEL,
        compactedFrom: 'short',
      });

      recordCompressionScore(
        group.folder,
        'medium',
        shortTerm.content,
        content,
      );

      logger.info(
        { group: group.name, len: content.length },
        'Medium-term memory compacted',
      );
      return true;
    }
  } catch (err) {
    logger.warn(
      {
        group: group.name,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to compact medium-term memory',
    );
  }
  return false;
}

// ============================================================================
// Long-term Layer — Weekly synthesis via Pro
// ============================================================================

/**
 * Synthesize medium-term into long-term (weekly).
 * Produces the core group identity profile.
 */
export async function synthesizeLongTerm(
  group: RegisteredGroup,
): Promise<boolean> {
  try {
    const mediumTerm = getTemporalMemory(group.folder, 'medium');
    if (!mediumTerm) return false;

    const existingLong = getTemporalMemory(group.folder, 'long');
    const facts = getFacts(group.folder);

    const { generate, isGeminiClientAvailable } =
      await import('./gemini-client.js');
    if (!isGeminiClientAvailable()) return false;

    const factsText =
      facts.length > 0
        ? facts.map((f) => `- ${f.key}: ${f.value}`).join('\n')
        : '(no stored facts)';

    const previousLong =
      existingLong?.content || '(no previous long-term profile)';

    const prompt = `You are a group analyst creating a definitive long-term profile for "${group.name}".

Medium-term behavioral analysis:
${mediumTerm.content}

Previous long-term profile:
${previousLong}

Stored facts:
${factsText}

Create an updated long-term group profile covering:
1. **Core Identity**: What defines this group? Primary purpose and character.
2. **Communication Style**: Dominant language, tone, formality level, unique expressions.
3. **Stable Preferences**: Established likes, dislikes, recurring requests.
4. **Knowledge Domains**: Topics the group has deep familiarity with.
5. **Interaction Patterns**: How the group typically interacts with the AI assistant.

This profile will be injected into the AI's system prompt. Write it as concise directives
the AI can act on (e.g., "This group prefers casual Chinese, uses lots of emoji, and
frequently asks about tech topics").

Output in the group's primary language. Keep under ${COMPOUNDER.MAX_LONG_CONTENT} characters. Be definitive and actionable.`;

    const result = await withTimeout(
      generate({
        model: COMPOUNDER.PRO_MODEL,
        contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
      }),
      COMPOUNDER.API_TIMEOUT_MS,
    );

    if (result.text) {
      const content = result.text.slice(0, COMPOUNDER.MAX_LONG_CONTENT);
      upsertTemporalMemory(group.folder, 'long', content, {
        model: COMPOUNDER.PRO_MODEL,
        compactedFrom: 'medium',
      });

      recordCompressionScore(group.folder, 'long', mediumTerm.content, content);

      // Auto-update GEMINI.md with group profile
      await updateGeminiMdProfile(group.folder, content);

      logger.info(
        { group: group.name, len: content.length },
        'Long-term memory synthesized and GEMINI.md updated',
      );
      return true;
    }
  } catch (err) {
    logger.warn(
      {
        group: group.name,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to synthesize long-term memory',
    );
  }
  return false;
}

// ============================================================================
// GEMINI.md Profile Auto-Update
// ============================================================================

const PROFILE_START = '[GROUP PROFILE]';
const PROFILE_END = '[END GROUP PROFILE]';

/**
 * Update the [GROUP PROFILE] section in a group's GEMINI.md.
 * Preserves all other content in the file.
 */
async function updateGeminiMdProfile(
  groupFolder: string,
  profileContent: string,
): Promise<void> {
  const filePath = path.join(GROUPS_DIR, groupFolder, 'GEMINI.md');

  let existingContent = '';
  try {
    existingContent = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // File doesn't exist — will create with profile only
  }

  const profileSection = `${PROFILE_START}\n${profileContent}\n${PROFILE_END}`;

  let newContent: string;
  const startIdx = existingContent.indexOf(PROFILE_START);
  const endIdx = existingContent.indexOf(PROFILE_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing profile section
    newContent =
      existingContent.slice(0, startIdx) +
      profileSection +
      existingContent.slice(endIdx + PROFILE_END.length);
  } else {
    // Append profile section
    newContent = existingContent
      ? existingContent.trimEnd() + '\n\n' + profileSection + '\n'
      : profileSection + '\n';
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, newContent, 'utf-8');

  try {
    const { getEventBus } = await import('@nanogemclaw/event-bus');
    getEventBus().emit('memory:profile-updated', {
      groupFolder,
      sections: ['GROUP PROFILE'],
    });
  } catch {
    // Event bus may not be initialized
  }

  // Invalidate context cache since GEMINI.md changed
  try {
    const { invalidateCache } = await import('./context-cache.js');
    await invalidateCache(groupFolder);
  } catch {
    // Cache module may not be available
  }
}

// ============================================================================
// Scheduled Compaction Runner
// ============================================================================

/**
 * Run the daily compaction pipeline for all registered groups.
 * Called by the scheduler (or cron).
 */
export async function runDailyCompaction(
  groups: RegisteredGroup[],
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  for (const group of groups) {
    try {
      const result = await compactToMediumTerm(group);
      if (result) updated++;
    } catch {
      errors++;
    }
  }

  // Clean expired layers
  const cleaned = cleanExpiredTemporalMemories();
  if (cleaned > 0) {
    logger.info({ cleaned }, 'Cleaned expired temporal memories');
  }

  return { updated, errors };
}

/**
 * Run the weekly synthesis pipeline for all registered groups.
 * Called by the scheduler (or cron).
 */
export async function runWeeklySynthesis(
  groups: RegisteredGroup[],
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  for (const group of groups) {
    try {
      const result = await synthesizeLongTerm(group);
      if (result) updated++;
    } catch {
      errors++;
    }
  }

  return { updated, errors };
}

// ============================================================================
// Utilities
// ============================================================================

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}
