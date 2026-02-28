/**
 * Fact Extractor — Extract structured facts from user messages.
 *
 * Uses regex pattern matching to identify facts like names, preferences,
 * pets, locations, etc. from both Chinese and English text.
 * Extracted facts are stored in the DB for injection into system prompts.
 */

import { upsertFact } from './db.js';
import { logger } from './logger.js';

// ============================================================================
// Pattern Definitions
// ============================================================================

interface ExtractionPattern {
  /** Regex to match against user text */
  pattern: RegExp;
  /** Fact key to store under */
  key: string;
  /** Which capture group contains the value (1-indexed) */
  valueGroup: number;
  /** Confidence score for this pattern */
  confidence: number;
}

/**
 * Extraction patterns — add entries here to enable automatic fact extraction.
 * Currently empty (infrastructure reserved). Facts are captured via the
 * `remember_fact` Gemini tool instead.
 *
 * Example pattern:
 *   { pattern: /我叫([^\s,，。]{1,10})/u, key: 'user_name', valueGroup: 1, confidence: 0.9 }
 */
const PATTERNS: ExtractionPattern[] = [];

// ============================================================================
// Extraction
// ============================================================================

/**
 * Extract facts from a user message and store them in the database.
 * Only facts with confidence >= 0.5 are stored.
 */
export function extractFacts(text: string, groupFolder: string): void {
  // Skip very short or very long messages (not useful for fact extraction)
  if (text.length < 3 || text.length > 2000) return;

  let extracted = 0;

  for (const { pattern, key, valueGroup, confidence } of PATTERNS) {
    if (confidence < 0.5) continue;

    const match = text.match(pattern);
    if (!match || !match[valueGroup]) continue;

    const value = match[valueGroup].trim();
    // Skip very short or empty values
    if (value.length < 1) continue;

    try {
      upsertFact(groupFolder, key, value, 'extracted', confidence);
      extracted++;
    } catch (err) {
      logger.debug(
        { key, value, err: err instanceof Error ? err.message : String(err) },
        'Failed to upsert extracted fact',
      );
    }
  }

  if (extracted > 0) {
    logger.debug(
      { groupFolder, extracted, textLength: text.length },
      'Facts extracted from message',
    );
  }
}
