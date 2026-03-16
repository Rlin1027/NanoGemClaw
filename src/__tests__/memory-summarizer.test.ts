import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import type { EventEmitter } from 'events';

// Hoist all mocks so they are available in vi.mock() factories
const mocks = vi.hoisted(() => ({
  getGroupMessageStats: vi.fn(),
  getMemorySummary: vi.fn(),
  getMessagesForSummary: vi.fn(),
  deleteOldMessages: vi.fn(() => 0),
  upsertMemorySummary: vi.fn(),
  getFacts: vi.fn(() => [] as Array<{ key: string; value: string }>),
  getTemporalContext: vi.fn(() => null as string | null),
  getCrossGroupFacts: vi.fn(() => [] as Array<{ key: string; value: string }>),
  trackContextUtilization: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  spawn: vi.fn(),
}));

vi.mock('../db.js', () => ({
  getGroupMessageStats: mocks.getGroupMessageStats,
  getMemorySummary: mocks.getMemorySummary,
  getMessagesForSummary: mocks.getMessagesForSummary,
  deleteOldMessages: mocks.deleteOldMessages,
  upsertMemorySummary: mocks.upsertMemorySummary,
  getFacts: mocks.getFacts,
}));

vi.mock('../config.js', () => ({
  MEMORY: {
    SUMMARIZE_THRESHOLD_CHARS: 50000,
    MAX_CONTEXT_MESSAGES: 100,
    CHECK_INTERVAL_HOURS: 4,
    SUMMARY_PROMPT: 'Summarize:',
  },
  CROSS_GROUP_MEMORY: {
    ENABLED: false,
    MAX_FACTS: 10,
  },
}));

vi.mock('../logger.js', () => ({
  logger: mocks.logger,
}));

vi.mock('../db/temporal-memory.js', () => ({
  getTemporalContext: mocks.getTemporalContext,
  getCrossGroupFacts: mocks.getCrossGroupFacts,
}));

vi.mock('../memory-metrics.js', () => ({
  trackContextUtilization: mocks.trackContextUtilization,
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

import {
  needsSummarization,
  summarizeConversation,
  getMemoryContext,
} from '../memory-summarizer.js';
import type { RegisteredGroup } from '../types.js';

const testGroup: RegisteredGroup = {
  folder: 'main',
  name: 'Main Group',
  preferredPath: 'fast',
  trigger: '@bot',
  added_at: '2026-01-01T00:00:00.000Z',
};

/** Build a minimal fake ChildProcess with controllable event emitters */
function makeFakeProcess() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stdoutListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stderrListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const makeEmitter = (
    map: Record<string, ((...args: unknown[]) => void)[]>,
  ) => ({
    on(event: string, cb: (...args: unknown[]) => void) {
      (map[event] = map[event] || []).push(cb);
    },
    emit(event: string, ...args: unknown[]) {
      (map[event] || []).forEach((cb) => cb(...args));
    },
  });

  const proc = {
    stdout: makeEmitter(stdoutListeners),
    stderr: makeEmitter(stderrListeners),
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
    },
    emit(event: string, ...args: unknown[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
    kill: vi.fn(),
  };

  return proc;
}

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    sender: `user${i}`,
    sender_name: `User ${i}`,
    content: `message content ${i}`,
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFacts.mockReturnValue([]);
  mocks.getTemporalContext.mockReturnValue(null);
  mocks.getCrossGroupFacts.mockReturnValue([]);
  mocks.deleteOldMessages.mockReturnValue(0);
  mocks.getMemorySummary.mockReturnValue(null);
});

describe('needsSummarization', () => {
  it('should return false when stats is null (no messages)', () => {
    mocks.getGroupMessageStats.mockReturnValue(null);
    expect(needsSummarization('-100')).toBe(false);
  });

  it('should return false when below both thresholds', () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 1000,
      message_count: 10,
    });
    expect(needsSummarization('-100')).toBe(false);
  });

  it('should return true when total_chars >= SUMMARIZE_THRESHOLD_CHARS', () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    expect(needsSummarization('-100')).toBe(true);
  });

  it('should return true when message_count >= MAX_CONTEXT_MESSAGES', () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 100,
      message_count: 100,
    });
    expect(needsSummarization('-100')).toBe(true);
  });

  it('should return true when both thresholds are exceeded', () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 99999,
      message_count: 200,
    });
    expect(needsSummarization('-100')).toBe(true);
  });
});

describe('summarizeConversation', () => {
  it('should return null when stats is null (no messages)', async () => {
    mocks.getGroupMessageStats.mockReturnValue(null);
    const result = await summarizeConversation(testGroup, '-100');
    expect(result).toBeNull();
    expect(mocks.logger.debug).toHaveBeenCalled();
  });

  it('should return null when getMessagesForSummary returns empty array', async () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    mocks.getMessagesForSummary.mockReturnValue([]);
    const result = await summarizeConversation(testGroup, '-100');
    expect(result).toBeNull();
  });

  it('should return a SummaryResult on successful Gemini CLI call', async () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    const messages = makeMessages(3);
    mocks.getMessagesForSummary.mockReturnValue(messages);

    const proc = makeFakeProcess();
    mocks.spawn.mockReturnValue(proc);

    const promise = summarizeConversation(testGroup, '-100');

    // Simulate Gemini CLI producing output and exiting cleanly
    proc.stdout.emit('data', 'This is the generated summary.');
    proc.emit('close', 0);

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.summary).toBe('This is the generated summary.');
    expect(result!.messagesProcessed).toBe(3);
    expect(result!.charsProcessed).toBeGreaterThan(0);
    expect(mocks.upsertMemorySummary).toHaveBeenCalled();
    expect(mocks.deleteOldMessages).toHaveBeenCalled();
  });

  it('should prepend existing summary as PREVIOUS_SUMMARY when one exists', async () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    mocks.getMessagesForSummary.mockReturnValue(makeMessages(2));
    mocks.getMemorySummary.mockReturnValue({
      summary: 'Previous chat summary',
      updated_at: '2026-01-01T00:00:00.000Z',
      messages_archived: 50,
    });

    const proc = makeFakeProcess();
    mocks.spawn.mockReturnValue(proc);

    const promise = summarizeConversation(testGroup, '-100');
    proc.stdout.emit('data', 'New summary with previous context.');
    proc.emit('close', 0);

    const result = await promise;
    expect(result).not.toBeNull();
    // spawn should have been called with a prompt that includes PREVIOUS_SUMMARY
    const spawnArgs = mocks.spawn.mock.calls[0];
    const promptArg = spawnArgs[1][3] as string; // ['--model', model, '-p', prompt, ...]
    expect(promptArg).toContain('PREVIOUS_SUMMARY');
  });

  it('should return null and log error when Gemini CLI exits with non-zero code', async () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    mocks.getMessagesForSummary.mockReturnValue(makeMessages(2));

    const proc = makeFakeProcess();
    mocks.spawn.mockReturnValue(proc);

    const promise = summarizeConversation(testGroup, '-100');
    proc.stderr.emit('data', 'API error details');
    proc.emit('close', 1);

    const result = await promise;
    expect(result).toBeNull();
    expect(mocks.logger.error).toHaveBeenCalled();
    expect(mocks.upsertMemorySummary).not.toHaveBeenCalled();
  });

  it('should return null and log warn when Gemini CLI times out', async () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    mocks.getMessagesForSummary.mockReturnValue(makeMessages(2));

    const proc = makeFakeProcess();
    mocks.spawn.mockReturnValue(proc);

    // Use fake timers to trigger the 180s timeout without waiting
    vi.useFakeTimers();
    const promise = summarizeConversation(testGroup, '-100');
    await vi.advanceTimersByTimeAsync(181000);
    vi.useRealTimers();

    const result = await promise;
    expect(result).toBeNull();
    expect(mocks.logger.warn).toHaveBeenCalled();
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('should return null and log error on spawn error event', async () => {
    mocks.getGroupMessageStats.mockReturnValue({
      total_chars: 50000,
      message_count: 5,
    });
    mocks.getMessagesForSummary.mockReturnValue(makeMessages(2));

    const proc = makeFakeProcess();
    mocks.spawn.mockReturnValue(proc);

    const promise = summarizeConversation(testGroup, '-100');
    proc.emit('error', new Error('ENOENT: gemini not found'));

    const result = await promise;
    expect(result).toBeNull();
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe('getMemoryContext', () => {
  it('should return null when no data available', () => {
    mocks.getMemorySummary.mockReturnValue(null);
    mocks.getFacts.mockReturnValue([]);
    mocks.getTemporalContext.mockReturnValue(null);
    const result = getMemoryContext('empty-group');
    expect(result).toBeNull();
  });

  it('should return context string when summary exists', () => {
    mocks.getMemorySummary.mockReturnValue({
      summary: 'Prior conversation about coding',
      updated_at: '2026-01-01T00:00:00.000Z',
      messages_archived: 20,
    });
    const result = getMemoryContext('group1');
    expect(result).toContain('CONVERSATION HISTORY SUMMARY');
    expect(result).toContain('Prior conversation about coding');
  });

  it('should include facts section when facts exist', () => {
    mocks.getFacts.mockReturnValue([
      { key: 'language', value: 'TypeScript' },
      { key: 'timezone', value: 'UTC+8' },
    ]);
    const result = getMemoryContext('group1');
    expect(result).toContain('[USER FACTS]');
    expect(result).toContain('language: TypeScript');
    expect(result).toContain('timezone: UTC+8');
  });

  it('should include temporal context when it exists', () => {
    mocks.getTemporalContext.mockReturnValue(
      '[GROUP PROFILE]\nHigh activity\n[END GROUP PROFILE]\nRecent: discussion',
    );
    const result = getMemoryContext('group1');
    expect(result).toContain('[GROUP PROFILE]');
    expect(result).toContain('High activity');
  });

  it('should call trackContextUtilization with result length', () => {
    mocks.getFacts.mockReturnValue([{ key: 'k', value: 'v' }]);
    const result = getMemoryContext('group1');
    expect(result).not.toBeNull();
    expect(mocks.trackContextUtilization).toHaveBeenCalledWith(
      'group1',
      result!.length,
      4000,
    );
  });

  it('should truncate context to ~4000 chars budget', () => {
    // Create a very large summary that would exceed budget
    const largeSummary = 'word '.repeat(1000); // ~5000 chars
    mocks.getMemorySummary.mockReturnValue({
      summary: largeSummary,
      updated_at: '2026-01-01T00:00:00.000Z',
      messages_archived: 100,
    });
    const result = getMemoryContext('group1');
    // Result should be at most 4000 chars (may be slightly under due to trim)
    expect(result!.length).toBeLessThanOrEqual(4000);
  });

  it('should not include cross-group facts when CROSS_GROUP_MEMORY is disabled', () => {
    // Config mock sets ENABLED: false, so getCrossGroupFacts should not be called
    mocks.getFacts.mockReturnValue([{ key: 'k', value: 'v' }]);
    getMemoryContext('group1', 'Alice');
    expect(mocks.getCrossGroupFacts).not.toHaveBeenCalled();
  });

  it('should return null when context string is empty after processing', () => {
    // All sources return empty/null
    mocks.getMemorySummary.mockReturnValue(null);
    mocks.getFacts.mockReturnValue([]);
    mocks.getTemporalContext.mockReturnValue(null);
    expect(getMemoryContext('group1')).toBeNull();
  });
});
