/**
 * Fact Extractor — Extract structured facts from user messages.
 *
 * When LLM extraction is enabled (FACT_EXTRACTION_LLM_ENABLED=true),
 * uses Gemini to intelligently extract facts from conversations.
 * Otherwise, acts as a no-op (preserving backward compatibility).
 *
 * Extracted facts are stored in the DB for injection into system prompts
 * via the [USER FACTS] block in memory context.
 */

import { upsertFact } from './db.js';
import { getFacts, deleteFact } from './db/facts.js';
import { generate } from './gemini-client.js';
import { FACT_EXTRACTION } from './config.js';
import { logger } from './logger.js';

// ============================================================================
// Rate Limiting
// ============================================================================

/** Per-group message counter for rate limiting */
const messageCounters = new Map<string, number>();

function shouldExtract(groupFolder: string): boolean {
  const count = (messageCounters.get(groupFolder) || 0) + 1;
  messageCounters.set(groupFolder, count);
  return count % FACT_EXTRACTION.RATE === 0;
}

// ============================================================================
// LLM Extraction Prompt
// ============================================================================

const EXTRACTION_PROMPT = `Extract any personal facts about the user from this message.
Output a JSON array of objects: [{"key": "...", "value": "...", "confidence": 0.0-1.0, "supersedes": "..."}]

Categories: name, nickname, age, birthday, location, timezone, occupation, pet, pet_name, food_preference, language_preference, hobby, family_member, daily_routine, project_context

Rules:
- Only extract facts explicitly stated, not implied
- Use snake_case keys from the categories above, or create specific keys like "favorite_food", "work_location"
- IMPORTANT: Reuse existing keys when the new fact updates a previous one (see KNOWN FACTS below)
- If the new fact contradicts or replaces an existing fact, set "supersedes" to the old key being replaced (e.g. if user said "I moved from Taipei to Kaohsiung", use key "location" and set supersedes to "location")
- If a new fact replaces a fact stored under a DIFFERENT key, set "supersedes" to that old key (e.g. if "work_location" replaces "location", set supersedes to "location")
- "supersedes" is optional — omit it if the fact is entirely new
- confidence: 0.9+ for explicit statements ("I'm John"), 0.7 for contextual ("going home to Taipei")
- If no facts found, output: []
- Output ONLY the JSON array, no other text`;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Extract facts from a user message and store them in the database.
 * Fire-and-forget: errors are silently logged, never thrown.
 *
 * When FACT_EXTRACTION.ENABLED is false, this is a no-op.
 */
export function extractFacts(text: string, groupFolder: string): void {
  if (!FACT_EXTRACTION.ENABLED) return;

  // Skip messages that are too short, too long, or commands
  if (text.length < FACT_EXTRACTION.MIN_LENGTH) return;
  if (text.length > FACT_EXTRACTION.MAX_LENGTH) return;
  if (text.startsWith('/')) return;

  // Rate limiting: extract from 1 in every N messages
  if (!shouldExtract(groupFolder)) return;

  // Fire-and-forget async extraction
  extractWithLLM(text, groupFolder).catch((err) => {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), groupFolder },
      'LLM fact extraction failed',
    );
  });
}

// ============================================================================
// LLM Extraction
// ============================================================================

interface ExtractedFact {
  key: string;
  value: string;
  confidence: number;
  supersedes?: string;
}

async function extractWithLLM(
  text: string,
  groupFolder: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    FACT_EXTRACTION.TIMEOUT_MS,
  );

  try {
    // Provide existing facts so LLM can detect contradictions and reuse keys
    let existingFactsBlock = '';
    try {
      const existing = getFacts(groupFolder);
      if (existing.length > 0) {
        const factLines = existing.map((f) => `${f.key}: ${f.value}`).join('\n');
        existingFactsBlock = `\n\nKNOWN FACTS:\n${factLines}`;
      }
    } catch {
      // DB may not be ready
    }

    const userMessage = text + existingFactsBlock;

    const response = await generate({
      model: FACT_EXTRACTION.MODEL,
      systemInstruction: EXTRACTION_PROMPT,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    });

    const responseText = (response.text || '').trim();
    if (!responseText || responseText === '[]') return;

    const facts = parseFacts(responseText);
    let stored = 0;

    for (const fact of facts) {
      if (fact.confidence < 0.5) continue;
      if (!fact.key || !fact.value) continue;

      try {
        // Delete superseded fact if it's a different key
        if (fact.supersedes && fact.supersedes !== fact.key) {
          deleteFact(groupFolder, fact.supersedes);
          logger.debug(
            { groupFolder, old: fact.supersedes, new: fact.key },
            'Superseded old fact',
          );
        }

        upsertFact(
          groupFolder,
          fact.key,
          fact.value,
          'llm_extracted',
          fact.confidence,
        );
        stored++;
      } catch (err) {
        logger.debug(
          {
            key: fact.key,
            err: err instanceof Error ? err.message : String(err),
          },
          'Failed to upsert LLM-extracted fact',
        );
      }
    }

    if (stored > 0) {
      logger.debug(
        { groupFolder, stored, textLength: text.length },
        'Facts extracted via LLM',
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseFacts(text: string): ExtractedFact[] {
  try {
    // Try to extract JSON array from response (may have surrounding text)
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: any) =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.key === 'string' &&
          typeof item.value === 'string' &&
          typeof item.confidence === 'number',
      )
      .map((item: any) => ({
        key: item.key,
        value: item.value,
        confidence: item.confidence,
        ...(typeof item.supersedes === 'string' && item.supersedes
          ? { supersedes: item.supersedes }
          : {}),
      }));
  } catch {
    logger.debug({ text: text.slice(0, 100) }, 'Failed to parse LLM facts');
    return [];
  }
}

/** Exposed for testing */
export {
  messageCounters as _messageCounters,
  shouldExtract as _shouldExtract,
  extractWithLLM as _extractWithLLM,
  parseFacts as _parseFacts,
};
