/**
 * Fact Extractor — Extract structured facts from user messages.
 *
 * Uses regex pattern matching to identify facts like names, preferences,
 * pets, locations, etc. from both Chinese and English text.
 * Extracted facts are stored in the DB for injection into system prompts.
 */

import { logger } from './logger.js';
import { storeFactWithConflictCheck } from './knowledge.js';

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
 * Extraction patterns for automatic fact capture.
 * Supplements the `remember_fact` Gemini tool with regex-based extraction.
 */
const PATTERNS: ExtractionPattern[] = [
  // Names (Chinese)
  {
    pattern: /我(?:的名字)?叫([^\s,，。!！?？]{1,10})/u,
    key: 'user_name',
    valueGroup: 1,
    confidence: 0.85,
  },
  {
    pattern: /我是([^\s,，。!！?？]{1,10})(?:啦|呀|喔)?$/u,
    key: 'user_name',
    valueGroup: 1,
    confidence: 0.7,
  },
  // Names (English)
  {
    pattern: /(?:my name is|i'm|i am)\s+([A-Z][a-z]{1,15})/i,
    key: 'user_name',
    valueGroup: 1,
    confidence: 0.85,
  },
  {
    pattern: /(?:call me)\s+([A-Z][a-z]{1,15})/i,
    key: 'user_name',
    valueGroup: 1,
    confidence: 0.8,
  },
  // Location
  {
    pattern: /我住(?:在)?([^\s,，。!！?？]{2,15})/u,
    key: 'user_location',
    valueGroup: 1,
    confidence: 0.8,
  },
  {
    pattern: /我在([^\s,，。!！?？]{2,10})(?:工作|上班|生活)/u,
    key: 'user_location',
    valueGroup: 1,
    confidence: 0.75,
  },
  {
    pattern: /i (?:live|work|am based) in\s+([A-Za-z\s]{2,20})/i,
    key: 'user_location',
    valueGroup: 1,
    confidence: 0.8,
  },
  // Occupation
  {
    pattern: /我(?:的工作)?是(?:做)?([^\s,，。!！?？]{2,15})(?:的)?/u,
    key: 'user_occupation',
    valueGroup: 1,
    confidence: 0.7,
  },
  {
    pattern: /i(?:'m| am) (?:a |an )?([a-z\s]{3,25}?)(?:\s+at|\s+in|\.|,|$)/i,
    key: 'user_occupation',
    valueGroup: 1,
    confidence: 0.65,
  },
  // Pets
  {
    pattern:
      /我(?:養了?|有)(?:一[隻條])?([^\s,，。]{1,5}(?:狗|貓|兔|鳥|魚|龜|鼠|蛇))/u,
    key: 'user_pet',
    valueGroup: 1,
    confidence: 0.85,
  },
  // Birthday
  {
    pattern: /我(?:的)?生日(?:是)?(\d{1,2}[月\/]\d{1,2})/u,
    key: 'user_birthday',
    valueGroup: 1,
    confidence: 0.9,
  },
  {
    pattern: /my birthday is\s+(\w+ \d{1,2}|\d{1,2}\/\d{1,2})/i,
    key: 'user_birthday',
    valueGroup: 1,
    confidence: 0.9,
  },
  // Language preference
  {
    pattern: /(?:請|麻煩)?(?:用|以)([^\s,，。]{2,8}?)(?:回[答覆]|說|溝通)/u,
    key: 'preferred_language',
    valueGroup: 1,
    confidence: 0.8,
  },
];

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
      storeFactWithConflictCheck(groupFolder, key, value, 'extracted', confidence);
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
