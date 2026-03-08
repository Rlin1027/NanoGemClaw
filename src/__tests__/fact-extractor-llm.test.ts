import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
  process.env.FACT_EXTRACTION_LLM_ENABLED = 'true';
});

const mockGenerate = vi.fn();
const mockUpsertFact = vi.fn();

vi.mock('../gemini-client.js', () => ({
  generate: (...args: any[]) => mockGenerate(...args),
}));

vi.mock('../db.js', () => ({
  upsertFact: (...args: any[]) => mockUpsertFact(...args),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  extractFacts,
  _messageCounters,
  _parseFacts,
  _extractWithLLM,
} from '../fact-extractor.js';

describe('fact-extractor (LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _messageCounters.clear();
  });

  describe('extractFacts', () => {
    it('extracts facts from user messages via LLM', async () => {
      mockGenerate.mockResolvedValue({
        text: '[{"key": "name", "value": "John", "confidence": 0.9}]',
      });

      // Rate: every 3rd message triggers extraction
      extractFacts('padding message one here', 'grp1');
      extractFacts('padding message two here', 'grp1');
      extractFacts("I'm John and I live in Taipei with my family", 'grp1');

      // Wait for async fire-and-forget
      await vi.waitFor(() => {
        expect(mockGenerate).toHaveBeenCalledOnce();
      });
    });

    it('skips short messages', () => {
      extractFacts('hi', 'grp1');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('skips long messages', () => {
      extractFacts('a'.repeat(2001), 'grp1');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('skips command messages starting with /', () => {
      extractFacts('/start something here now', 'grp1');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('respects rate limiting (1 in every 3)', () => {
      mockGenerate.mockResolvedValue({ text: '[]' });

      extractFacts('message one is long enough', 'grp1');
      extractFacts('message two is long enough', 'grp1');

      // Only the 3rd should trigger
      expect(mockGenerate).not.toHaveBeenCalled();

      extractFacts('message three is long enough', 'grp1');
      // Fire-and-forget, so generate may be called
    });
  });

  describe('_extractWithLLM', () => {
    it('calls generate and upserts extracted facts', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify([
          { key: 'name', value: 'John', confidence: 0.9 },
          { key: 'location', value: 'Taipei', confidence: 0.7 },
        ]),
      });

      await _extractWithLLM("I'm John and I live in Taipei", 'grp1');

      expect(mockUpsertFact).toHaveBeenCalledTimes(2);
      expect(mockUpsertFact).toHaveBeenCalledWith(
        'grp1',
        'name',
        'John',
        'llm_extracted',
        0.9,
      );
      expect(mockUpsertFact).toHaveBeenCalledWith(
        'grp1',
        'location',
        'Taipei',
        'llm_extracted',
        0.7,
      );
    });

    it('filters out low confidence facts', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify([
          { key: 'name', value: 'John', confidence: 0.9 },
          { key: 'maybe_hobby', value: 'coding', confidence: 0.3 },
        ]),
      });

      await _extractWithLLM('I am John and maybe I like coding', 'grp1');

      expect(mockUpsertFact).toHaveBeenCalledOnce();
      expect(mockUpsertFact).toHaveBeenCalledWith(
        'grp1',
        'name',
        'John',
        'llm_extracted',
        0.9,
      );
    });

    it('handles empty response gracefully', async () => {
      mockGenerate.mockResolvedValue({ text: '[]' });

      await _extractWithLLM('just chatting about the weather', 'grp1');

      expect(mockUpsertFact).not.toHaveBeenCalled();
    });

    it('handles API error gracefully', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(
        _extractWithLLM('some message for extraction', 'grp1'),
      ).rejects.toThrow('API error');
    });

    it('handles malformed JSON response', async () => {
      mockGenerate.mockResolvedValue({ text: 'not valid json at all' });

      await _extractWithLLM('some message about user info', 'grp1');

      expect(mockUpsertFact).not.toHaveBeenCalled();
    });
  });

  describe('_parseFacts', () => {
    it('parses valid JSON array of facts', () => {
      const result = _parseFacts(
        '[{"key": "name", "value": "Alice", "confidence": 0.95}]',
      );
      expect(result).toEqual([
        { key: 'name', value: 'Alice', confidence: 0.95 },
      ]);
    });

    it('extracts JSON from surrounding text', () => {
      const result = _parseFacts(
        'Here are the facts: [{"key": "age", "value": "25", "confidence": 0.8}] done.',
      );
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('age');
    });

    it('returns empty array for invalid JSON', () => {
      expect(_parseFacts('not json')).toEqual([]);
    });

    it('filters out objects with wrong shape', () => {
      const result = _parseFacts(
        '[{"key": "name", "value": "John", "confidence": 0.9}, {"wrong": "shape"}]',
      );
      expect(result).toHaveLength(1);
    });

    it('returns empty array for empty response', () => {
      expect(_parseFacts('')).toEqual([]);
    });
  });
});
