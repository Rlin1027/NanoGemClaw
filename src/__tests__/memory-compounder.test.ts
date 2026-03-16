import { vi, describe, it, expect, beforeEach } from 'vitest';

// Hoist mocks
/* eslint-disable @typescript-eslint/no-explicit-any */
const mocks = vi.hoisted(() => ({
  generate: vi.fn<any>(),
  isGeminiClientAvailable: vi.fn<any>(() => true),
  getTemporalMemory: vi.fn<any>(() => null),
  upsertTemporalMemory: vi.fn<any>(),
  cleanExpiredTemporalMemories: vi.fn<any>(() => 0),
  getMessagesSince: vi.fn<any>(() => []),
  getFacts: vi.fn<any>(() => []),
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  readFileSync: vi.fn<any>(() => ''),
  writeFileSync: vi.fn<any>(),
  mkdirSync: vi.fn<any>(),
  existsSync: vi.fn<any>(() => false),
  getEventBus: vi.fn<any>(() => ({ emit: vi.fn() })),
  invalidateCache: vi.fn<any>(),
  recordCompressionScore: vi.fn<any>(() => ({ qualityScore: 0.8 })),
}));

vi.mock('../gemini-client.js', () => ({
  generate: mocks.generate,
  isGeminiClientAvailable: mocks.isGeminiClientAvailable,
}));

vi.mock('../db/temporal-memory.js', () => ({
  getTemporalMemory: mocks.getTemporalMemory,
  upsertTemporalMemory: mocks.upsertTemporalMemory,
  cleanExpiredTemporalMemories: mocks.cleanExpiredTemporalMemories,
  getAllTemporalMemories: vi.fn(() => []),
  getTemporalContext: vi.fn(() => null),
}));

vi.mock('../db/messages.js', () => ({
  getMessagesSince: mocks.getMessagesSince,
}));

vi.mock('../db/facts.js', () => ({
  getFacts: mocks.getFacts,
}));

vi.mock('../logger.js', () => ({
  logger: mocks.logger,
}));

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'TestBot',
  GROUPS_DIR: '/tmp/test-groups',
  MEMORY_COMPOUNDER: {
    ENABLED: true,
    DAILY_COMPACTION_HOUR: 3,
    WEEKLY_SYNTHESIS_DAY: 0,
    WEEKLY_SYNTHESIS_HOUR: 4,
    MIN_MESSAGES_FOR_SHORT: 5,
  },
  COMPOUNDER_QUALITY_GATE: false,
  COMPOUNDER_MIN_QUALITY: 0.5,
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
    mkdirSync: mocks.mkdirSync,
    existsSync: mocks.existsSync,
  },
}));

vi.mock('@nanogemclaw/event-bus', () => ({
  getEventBus: mocks.getEventBus,
}));

vi.mock('../context-cache.js', () => ({
  invalidateCache: mocks.invalidateCache,
}));

vi.mock('../memory-metrics.js', () => ({
  recordCompressionScore: mocks.recordCompressionScore,
}));

import {
  updateShortTermMemory,
  compactToMediumTerm,
  synthesizeLongTerm,
  runDailyCompaction,
  runWeeklySynthesis,
  COMPOUNDER,
} from '../memory-compounder.js';
import type { RegisteredGroup } from '../types.js';

const testGroup: RegisteredGroup = {
  folder: 'main',
  name: 'Main Group',
  preferredPath: 'fast',
  trigger: '@bot',
  added_at: '2026-01-01T00:00:00.000Z',
};

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sender: `user${i}`,
    sender_name: `User ${i}`,
    content: `message content ${i}`,
  }));
}

describe('memory-compounder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isGeminiClientAvailable.mockReturnValue(true);
    mocks.generate.mockResolvedValue({ text: 'generated summary' });
    mocks.getTemporalMemory.mockReturnValue(null);
    mocks.getMessagesSince.mockReturnValue([]);
    mocks.getFacts.mockReturnValue([]);
  });

  describe('COMPOUNDER config', () => {
    it('should have expected model constants', () => {
      expect(COMPOUNDER.FLASH_MODEL).toBe('gemini-3-flash-preview');
      expect(COMPOUNDER.PRO_MODEL).toBe('gemini-3-pro-preview');
    });
  });

  describe('updateShortTermMemory', () => {
    it('should return false when too few messages', async () => {
      mocks.getMessagesSince.mockReturnValue(makeMessages(3));
      const result = await updateShortTermMemory(testGroup, '-100');
      expect(result).toBe(false);
      expect(mocks.generate).not.toHaveBeenCalled();
    });

    it('should call generate and upsert when enough messages', async () => {
      mocks.getMessagesSince.mockReturnValue(makeMessages(10));
      const result = await updateShortTermMemory(testGroup, '-100');
      expect(result).toBe(true);
      expect(mocks.generate).toHaveBeenCalledOnce();
      expect(mocks.upsertTemporalMemory).toHaveBeenCalledWith(
        'main',
        'short',
        'generated summary',
        expect.objectContaining({ messagesProcessed: 10 }),
      );
    });

    it('should return false when Gemini is unavailable', async () => {
      mocks.getMessagesSince.mockReturnValue(makeMessages(10));
      mocks.isGeminiClientAvailable.mockReturnValue(false);
      const result = await updateShortTermMemory(testGroup, '-100');
      expect(result).toBe(false);
      expect(mocks.generate).not.toHaveBeenCalled();
    });

    it('should use Flash model', async () => {
      mocks.getMessagesSince.mockReturnValue(makeMessages(10));
      await updateShortTermMemory(testGroup, '-100');
      expect(mocks.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: COMPOUNDER.FLASH_MODEL }),
      );
    });

    it('should handle errors gracefully', async () => {
      mocks.getMessagesSince.mockReturnValue(makeMessages(10));
      mocks.generate.mockRejectedValue(new Error('API error'));
      const result = await updateShortTermMemory(testGroup, '-100');
      expect(result).toBe(false);
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('should truncate result to MAX_SHORT_CONTENT', async () => {
      mocks.getMessagesSince.mockReturnValue(makeMessages(10));
      mocks.generate.mockResolvedValue({
        text: 'x'.repeat(COMPOUNDER.MAX_SHORT_CONTENT + 500),
      });
      await updateShortTermMemory(testGroup, '-100');
      expect(mocks.upsertTemporalMemory).toHaveBeenCalledWith(
        'main',
        'short',
        expect.any(String),
        expect.any(Object),
      );
      const storedContent = mocks.upsertTemporalMemory.mock
        .calls[0][2] as string;
      expect(storedContent.length).toBeLessThanOrEqual(
        COMPOUNDER.MAX_SHORT_CONTENT,
      );
    });
  });

  describe('compactToMediumTerm', () => {
    it('should return false when no short-term memory exists', async () => {
      mocks.getTemporalMemory.mockReturnValue(null);
      const result = await compactToMediumTerm(testGroup);
      expect(result).toBe(false);
    });

    it('should compact short into medium', async () => {
      mocks.getTemporalMemory
        .mockReturnValueOnce({ content: 'short observations' }) // short
        .mockReturnValueOnce(null); // existing medium
      const result = await compactToMediumTerm(testGroup);
      expect(result).toBe(true);
      expect(mocks.upsertTemporalMemory).toHaveBeenCalledWith(
        'main',
        'medium',
        'generated summary',
        expect.objectContaining({ compactedFrom: 'short' }),
      );
    });

    it('should return false when Gemini is unavailable', async () => {
      mocks.getTemporalMemory.mockReturnValue({ content: 'short data' });
      mocks.isGeminiClientAvailable.mockReturnValue(false);
      const result = await compactToMediumTerm(testGroup);
      expect(result).toBe(false);
    });
  });

  describe('synthesizeLongTerm', () => {
    it('should return false when no medium-term memory exists', async () => {
      mocks.getTemporalMemory.mockReturnValue(null);
      const result = await synthesizeLongTerm(testGroup);
      expect(result).toBe(false);
    });

    it('should synthesize medium into long with Pro model', async () => {
      mocks.getTemporalMemory
        .mockReturnValueOnce({ content: 'medium patterns' }) // medium
        .mockReturnValueOnce(null); // existing long
      const result = await synthesizeLongTerm(testGroup);
      expect(result).toBe(true);
      expect(mocks.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: COMPOUNDER.PRO_MODEL }),
      );
      expect(mocks.upsertTemporalMemory).toHaveBeenCalledWith(
        'main',
        'long',
        'generated summary',
        expect.objectContaining({ compactedFrom: 'medium' }),
      );
    });

    it('should update GEMINI.md after long-term synthesis', async () => {
      mocks.getTemporalMemory.mockReturnValue({ content: 'medium data' });
      await synthesizeLongTerm(testGroup);
      expect(mocks.mkdirSync).toHaveBeenCalled();
      expect(mocks.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('runDailyCompaction', () => {
    it('should process multiple groups', async () => {
      mocks.getTemporalMemory.mockReturnValue({ content: 'short data' });
      const groups = [
        testGroup,
        {
          folder: 'group-b',
          name: 'Group B',
          preferredPath: 'fast' as const,
          trigger: '@bot',
          added_at: '2026-01-01T00:00:00.000Z',
        },
      ];
      const result = await runDailyCompaction(groups);
      expect(result.updated).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('should handle partial failures gracefully', async () => {
      // First group: short-term exists, generate succeeds → updated
      // Second group: no short-term → compactToMediumTerm returns false (not counted)
      mocks.getTemporalMemory
        .mockReturnValueOnce({ content: 'short data' }) // group1 short
        .mockReturnValueOnce(null) // group1 medium
        .mockReturnValueOnce(null); // group2 short (missing → skip)
      const groups = [
        testGroup,
        {
          folder: 'group-b',
          name: 'Group B',
          preferredPath: 'fast' as const,
          trigger: '@bot',
          added_at: '2026-01-01T00:00:00.000Z',
        },
      ];
      const result = await runDailyCompaction(groups);
      expect(result.updated).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('should call cleanExpiredTemporalMemories', async () => {
      await runDailyCompaction([]);
      expect(mocks.cleanExpiredTemporalMemories).toHaveBeenCalled();
    });
  });

  describe('runWeeklySynthesis', () => {
    it('should process multiple groups', async () => {
      mocks.getTemporalMemory.mockReturnValue({ content: 'medium data' });
      const groups = [testGroup];
      const result = await runWeeklySynthesis(groups);
      expect(result.updated).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('should return zeros for empty groups', async () => {
      const result = await runWeeklySynthesis([]);
      expect(result).toEqual({ updated: 0, errors: 0 });
    });
  });

  describe('quality gate', () => {
    it('should not retry when gate is disabled (default)', async () => {
      // COMPOUNDER_QUALITY_GATE is false in config mock — no retry even with low score
      mocks.getTemporalMemory
        .mockReturnValueOnce({ content: 'short observations' })
        .mockReturnValueOnce(null);
      mocks.recordCompressionScore.mockReturnValue({ qualityScore: 0.3 });
      await compactToMediumTerm(testGroup);
      // generate called exactly once (no retry)
      expect(mocks.generate).toHaveBeenCalledTimes(1);
    });

    it('recordCompressionScore is called with correct args in compactToMediumTerm', async () => {
      mocks.getTemporalMemory
        .mockReturnValueOnce({ content: 'short observations' })
        .mockReturnValueOnce(null);
      mocks.recordCompressionScore.mockReturnValue({ qualityScore: 0.8 });
      await compactToMediumTerm(testGroup);
      expect(mocks.recordCompressionScore).toHaveBeenCalledWith(
        'main',
        'medium',
        'short observations',
        'generated summary',
      );
    });

    it('recordCompressionScore is called with correct args in synthesizeLongTerm', async () => {
      mocks.getTemporalMemory
        .mockReturnValueOnce({ content: 'medium patterns' })
        .mockReturnValueOnce(null);
      mocks.recordCompressionScore.mockReturnValue({ qualityScore: 0.8 });
      await synthesizeLongTerm(testGroup);
      expect(mocks.recordCompressionScore).toHaveBeenCalledWith(
        'main',
        'long',
        'medium patterns',
        'generated summary',
      );
    });
  });
});
