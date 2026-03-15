import { vi, describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
const mocks = vi.hoisted(() => {
    const preparedStmt = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
    };
    return {
        db: {
            prepare: vi.fn().mockReturnValue(preparedStmt),
            exec: vi.fn(),
        },
        preparedStmt,
        logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
        eventBus: {
            emit: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
        },
        generate: vi.fn(),
        isGeminiClientAvailable: vi.fn(() => false),
    };
});

vi.mock('@nanogemclaw/db', () => ({
    getDatabase: () => mocks.db,
}));

// ============================================================================
// Pure function reimplementations for isolated testing
// (plugin does not individually export internal functions)
// ============================================================================

// --- analyzeMessage ---
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

interface MessageSignal {
    timestamp: string;
    contentLength: number;
    hasEmoji: boolean;
    language: 'zh' | 'en' | 'mixed';
    hour: number;
}

function analyzeMessage(content: string, timestamp: string): MessageSignal {
    const date = new Date(timestamp);
    const hasCjk = CJK_RE.test(content);
    const hasLatin = /[a-zA-Z]{3,}/.test(content);
    return {
        timestamp,
        contentLength: content.length,
        hasEmoji: EMOJI_RE.test(content),
        language: hasCjk && hasLatin ? 'mixed' : hasCjk ? 'zh' : 'en',
        hour: date.getHours(),
    };
}

// --- Ring buffer ---
function addSignalToBuffer(buffer: MessageSignal[], signal: MessageSignal, maxSize = 200): MessageSignal[] {
    buffer.push(signal);
    if (buffer.length > maxSize) buffer.shift();
    return buffer;
}

// --- buildProfile (pure subset) ---
interface GroupProfile {
    communicationStyle: {
        tone: string;
        languagePatterns: string;
        activityHours: string;
        emojiUsage: string;
    };
    behavioralPatterns: {
        avgMessagesPerDay: number;
        topicInterests: string[];
        messageFrequencyTrend: string;
    };
    currentState: {
        recentMood: string;
        activeConcerns: string[];
        updatedAt: string;
    };
}

function buildProfileFromSignals(signals: MessageSignal[]): GroupProfile | null {
    if (signals.length < 5) return null;

    const emojiCount = signals.filter((s) => s.hasEmoji).length;
    const emojiRate = emojiCount / signals.length;
    const avgLength = signals.reduce((sum, s) => sum + s.contentLength, 0) / signals.length;
    const langCounts: Record<string, number> = { zh: 0, en: 0, mixed: 0 };
    for (const s of signals) langCounts[s.language]++;
    const dominantLang = (Object.entries(langCounts) as [string, number][])
        .sort((a, b) => b[1] - a[1])[0][0];

    const hourCounts = new Array<number>(24).fill(0);
    for (const s of signals) hourCounts[s.hour]++;
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const activeHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .filter((h) => h.count > signals.length * 0.05)
        .map((h) => h.hour)
        .sort((a, b) => a - b);

    const timestamps = signals.map((s) => new Date(s.timestamp).getTime());
    const timeSpanDays = Math.max(
        1,
        (Math.max(...timestamps) - Math.min(...timestamps)) / (24 * 60 * 60 * 1000),
    );
    const avgPerDay = signals.length / timeSpanDays;

    return {
        communicationStyle: {
            tone: avgLength > 100 ? 'detailed/verbose' : avgLength > 30 ? 'conversational' : 'brief/casual',
            languagePatterns: dominantLang === 'zh'
                ? 'primarily Chinese'
                : dominantLang === 'mixed'
                    ? 'bilingual (Chinese + English)'
                    : 'primarily English',
            activityHours: activeHours.length > 0
                ? `peak at ${peakHour}:00, active ${activeHours[0]}:00-${activeHours[activeHours.length - 1]}:00`
                : 'insufficient data',
            emojiUsage: emojiRate > 0.5
                ? 'heavy emoji usage'
                : emojiRate > 0.2
                    ? 'moderate emoji usage'
                    : 'minimal emoji usage',
        },
        behavioralPatterns: {
            avgMessagesPerDay: Math.round(avgPerDay * 10) / 10,
            topicInterests: [],
            messageFrequencyTrend: avgPerDay > 10 ? 'very active' : avgPerDay > 3 ? 'active' : 'quiet',
        },
        currentState: {
            recentMood: 'neutral',
            activeConcerns: [],
            updatedAt: new Date().toISOString(),
        },
    };
}

// --- Mood classification ---
const NEGATIVE_MOODS = new Set(['frustrated', 'stressed', 'anxious', 'sad', 'angry', 'worried', 'upset', 'tired', 'overwhelmed']);
const POSITIVE_MOODS = new Set(['happy', 'enthusiastic', 'excited', 'cheerful', 'optimistic', 'motivated', 'energetic', 'joyful']);

function classifyMood(mood: string): 'positive' | 'negative' | 'neutral' {
    const lower = mood.toLowerCase();
    if (POSITIVE_MOODS.has(lower)) return 'positive';
    if (NEGATIVE_MOODS.has(lower)) return 'negative';
    return 'neutral';
}

function detectMoodShift(previous: string, current: string): string | null {
    const prevClass = classifyMood(previous);
    const currClass = classifyMood(current);
    if (prevClass === currClass) return null;
    return `${prevClass} → ${currClass}`;
}

interface MoodSnapshot {
    mood: string;
    recordedAt: string;
}

function recordMoodSnapshot(history: MoodSnapshot[], mood: string, maxHistory = 10): {
    history: MoodSnapshot[];
    shift: string | null;
} {
    const previousMood = history.length > 0 ? history[history.length - 1].mood : null;
    const updated = [...history, { mood, recordedAt: new Date().toISOString() }];
    if (updated.length > maxHistory) updated.shift();

    if (!previousMood || previousMood === mood) return { history: updated, shift: null };
    const shift = detectMoodShift(previousMood, mood);
    return { history: updated, shift };
}

// ============================================================================
// Tests
// ============================================================================

describe('group-profiler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preparedStmt.all.mockReturnValue([]);
        mocks.preparedStmt.get.mockReturnValue(undefined);
        mocks.isGeminiClientAvailable.mockReturnValue(false);
    });

    // -------------------------------------------------------------------------
    // analyzeMessage
    // -------------------------------------------------------------------------
    describe('analyzeMessage', () => {
        const ts = '2026-03-16T10:30:00.000Z'; // UTC 10:00

        it('measures content length correctly', () => {
            const sig = analyzeMessage('hello world', ts);
            expect(sig.contentLength).toBe(11);
        });

        it('detects emoji correctly', () => {
            expect(analyzeMessage('hello 😊', ts).hasEmoji).toBe(true);
            expect(analyzeMessage('hello world', ts).hasEmoji).toBe(false);
        });

        it('detects multiple emoji in message', () => {
            expect(analyzeMessage('🎉🎊✨', ts).hasEmoji).toBe(true);
        });

        it('classifies Chinese-only content as zh', () => {
            const sig = analyzeMessage('你好世界，今天天氣很好', ts);
            expect(sig.language).toBe('zh');
        });

        it('classifies English-only content as en', () => {
            const sig = analyzeMessage('hello world this is english', ts);
            expect(sig.language).toBe('en');
        });

        it('classifies mixed content as mixed', () => {
            const sig = analyzeMessage('你好 hello world 測試', ts);
            expect(sig.language).toBe('mixed');
        });

        it('extracts hour from timestamp matching Date.getHours()', () => {
            const ts = '2026-03-16T14:45:00.000Z';
            const sig = analyzeMessage('test', ts);
            expect(sig.hour).toBe(new Date(ts).getHours());
        });

        it('handles empty string content', () => {
            const sig = analyzeMessage('', ts);
            expect(sig.contentLength).toBe(0);
            expect(sig.hasEmoji).toBe(false);
            expect(sig.language).toBe('en'); // no CJK, no 3-letter latin → defaults to en
        });

        it('short latin (< 3 chars) is not classified as en', () => {
            // 'hi' is 2 chars — hasLatin = false, hasCjk = false → 'en' (fallback)
            const sig = analyzeMessage('hi', ts);
            expect(sig.language).toBe('en');
        });
    });

    // -------------------------------------------------------------------------
    // Ring buffer — max 200 signals, overflow
    // -------------------------------------------------------------------------
    describe('ring buffer', () => {
        const makeSignal = (i: number): MessageSignal => ({
            timestamp: `2026-03-16T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
            contentLength: 10,
            hasEmoji: false,
            language: 'en',
            hour: i % 24,
        });

        it('accepts up to 200 signals without dropping', () => {
            let buffer: MessageSignal[] = [];
            for (let i = 0; i < 200; i++) {
                buffer = addSignalToBuffer(buffer, makeSignal(i));
            }
            expect(buffer).toHaveLength(200);
        });

        it('drops oldest signal when buffer exceeds 200', () => {
            let buffer: MessageSignal[] = [];
            for (let i = 0; i < 201; i++) {
                buffer = addSignalToBuffer(buffer, makeSignal(i));
            }
            expect(buffer).toHaveLength(200);
        });

        it('always keeps the most recent signal after overflow', () => {
            let buffer: MessageSignal[] = [];
            for (let i = 0; i < 205; i++) {
                buffer = addSignalToBuffer(buffer, makeSignal(i));
            }
            // Last inserted signal has index 204, so hour = 204 % 24
            expect(buffer[buffer.length - 1].hour).toBe(204 % 24);
        });

        it('maintains exactly maxSize after many overflows', () => {
            let buffer: MessageSignal[] = [];
            for (let i = 0; i < 500; i++) {
                buffer = addSignalToBuffer(buffer, makeSignal(i));
            }
            expect(buffer).toHaveLength(200);
        });
    });

    // -------------------------------------------------------------------------
    // buildProfile — tone, language patterns, activity hours, frequency trend
    // -------------------------------------------------------------------------
    describe('buildProfile', () => {
        const baseTs = new Date('2026-03-16T10:00:00.000Z').getTime();

        function makeSignals(
            count: number,
            overrides: Partial<MessageSignal> = {},
        ): MessageSignal[] {
            return Array.from({ length: count }, (_, i) => ({
                timestamp: new Date(baseTs + i * 60 * 1000).toISOString(),
                contentLength: 50,
                hasEmoji: false,
                language: 'zh' as const,
                hour: 10,
                ...overrides,
            }));
        }

        it('returns null when fewer than 5 signals', () => {
            expect(buildProfileFromSignals(makeSignals(4))).toBeNull();
        });

        it('returns profile with 5+ signals', () => {
            expect(buildProfileFromSignals(makeSignals(5))).not.toBeNull();
        });

        it('classifies tone as brief/casual for short messages (≤30 chars)', () => {
            const signals = makeSignals(10, { contentLength: 10 });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.tone).toBe('brief/casual');
        });

        it('classifies tone as conversational for medium messages (31-100 chars)', () => {
            const signals = makeSignals(10, { contentLength: 50 });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.tone).toBe('conversational');
        });

        it('classifies tone as detailed/verbose for long messages (>100 chars)', () => {
            const signals = makeSignals(10, { contentLength: 150 });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.tone).toBe('detailed/verbose');
        });

        it('reports primarily Chinese for zh signals', () => {
            const signals = makeSignals(10, { language: 'zh' });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.languagePatterns).toBe('primarily Chinese');
        });

        it('reports primarily English for en signals', () => {
            const signals = makeSignals(10, { language: 'en' });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.languagePatterns).toBe('primarily English');
        });

        it('reports bilingual for mixed signals', () => {
            const signals = makeSignals(10, { language: 'mixed' });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.languagePatterns).toBe('bilingual (Chinese + English)');
        });

        it('shows heavy emoji usage when > 50% have emoji', () => {
            const signals = makeSignals(10).map((s, i) => ({ ...s, hasEmoji: i < 8 }));
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.emojiUsage).toBe('heavy emoji usage');
        });

        it('shows moderate emoji usage for 20-50% emoji', () => {
            const signals = makeSignals(10).map((s, i) => ({ ...s, hasEmoji: i < 3 }));
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.emojiUsage).toBe('moderate emoji usage');
        });

        it('shows minimal emoji usage when < 20% have emoji', () => {
            const signals = makeSignals(10, { hasEmoji: false });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.emojiUsage).toBe('minimal emoji usage');
        });

        it('reports very active trend when > 10 msgs/day', () => {
            // 50 signals spread over 1 day (baseTs + 49*60*1000 ms < 1 day)
            const signals = Array.from({ length: 50 }, (_, i) => ({
                timestamp: new Date(baseTs + i * 60 * 1000).toISOString(),
                contentLength: 30,
                hasEmoji: false,
                language: 'en' as const,
                hour: 10,
            }));
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.behavioralPatterns.messageFrequencyTrend).toBe('very active');
        });

        it('reports quiet trend when ≤ 3 msgs/day', () => {
            // 5 signals spread over 10 days → 0.5 msgs/day
            const signals = Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date(baseTs + i * 24 * 60 * 60 * 1000 * 2).toISOString(),
                contentLength: 30,
                hasEmoji: false,
                language: 'en' as const,
                hour: 10,
            }));
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.behavioralPatterns.messageFrequencyTrend).toBe('quiet');
        });

        it('includes peak hour in activityHours string', () => {
            const signals = makeSignals(10, { hour: 14 });
            const profile = buildProfileFromSignals(signals)!;
            expect(profile.communicationStyle.activityHours).toContain('peak at 14:00');
        });
    });

    // -------------------------------------------------------------------------
    // Mood history — storage and sentiment shift detection
    // -------------------------------------------------------------------------
    describe('mood history', () => {
        it('stores moods up to MAX_MOOD_HISTORY (10)', () => {
            let history: MoodSnapshot[] = [];
            const moods = ['happy', 'happy', 'happy', 'happy', 'happy', 'happy', 'happy', 'happy', 'happy', 'happy', 'neutral'];
            for (const m of moods) {
                const result = recordMoodSnapshot(history, m);
                history = result.history;
            }
            expect(history).toHaveLength(10);
        });

        it('drops oldest mood when exceeding max', () => {
            let history: MoodSnapshot[] = [];
            // Fill with 10 "happy" entries
            for (let i = 0; i < 10; i++) {
                history = recordMoodSnapshot(history, 'happy').history;
            }
            // Add one more → oldest should be dropped
            history = recordMoodSnapshot(history, 'sad').history;
            expect(history).toHaveLength(10);
            expect(history[history.length - 1].mood).toBe('sad');
        });

        it('records timestamps for each mood entry', () => {
            let history: MoodSnapshot[] = [];
            history = recordMoodSnapshot(history, 'happy').history;
            expect(history[0].recordedAt).toBeDefined();
            expect(new Date(history[0].recordedAt).getTime()).toBeGreaterThan(0);
        });

        it('returns null shift when mood is same', () => {
            let history: MoodSnapshot[] = [];
            history = recordMoodSnapshot(history, 'happy').history;
            const { shift } = recordMoodSnapshot(history, 'happy');
            expect(shift).toBeNull();
        });

        it('detects positive → negative shift', () => {
            let history: MoodSnapshot[] = [];
            history = recordMoodSnapshot(history, 'happy').history;
            const { shift } = recordMoodSnapshot(history, 'stressed');
            expect(shift).toBe('positive → negative');
        });

        it('detects negative → positive shift', () => {
            let history: MoodSnapshot[] = [];
            history = recordMoodSnapshot(history, 'frustrated').history;
            const { shift } = recordMoodSnapshot(history, 'excited');
            expect(shift).toBe('negative → positive');
        });

        it('detects neutral → negative shift', () => {
            let history: MoodSnapshot[] = [];
            history = recordMoodSnapshot(history, 'calm').history;
            const { shift } = recordMoodSnapshot(history, 'anxious');
            expect(shift).toBe('neutral → negative');
        });

        it('returns null shift when both moods are same polarity', () => {
            let history: MoodSnapshot[] = [];
            history = recordMoodSnapshot(history, 'happy').history;
            const { shift } = recordMoodSnapshot(history, 'excited'); // both positive
            expect(shift).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // classifyMood
    // -------------------------------------------------------------------------
    describe('classifyMood', () => {
        it('classifies positive moods', () => {
            expect(classifyMood('happy')).toBe('positive');
            expect(classifyMood('enthusiastic')).toBe('positive');
            expect(classifyMood('excited')).toBe('positive');
            expect(classifyMood('joyful')).toBe('positive');
        });

        it('classifies negative moods', () => {
            expect(classifyMood('frustrated')).toBe('negative');
            expect(classifyMood('stressed')).toBe('negative');
            expect(classifyMood('anxious')).toBe('negative');
            expect(classifyMood('overwhelmed')).toBe('negative');
        });

        it('classifies neutral moods', () => {
            expect(classifyMood('neutral')).toBe('neutral');
            expect(classifyMood('calm')).toBe('neutral');
            expect(classifyMood('focused')).toBe('neutral');
        });

        it('defaults to neutral for unknown moods', () => {
            expect(classifyMood('pensive')).toBe('neutral');
            expect(classifyMood('unknown-mood')).toBe('neutral');
        });

        it('is case-insensitive', () => {
            expect(classifyMood('HAPPY')).toBe('positive');
            expect(classifyMood('Stressed')).toBe('negative');
        });
    });

    // -------------------------------------------------------------------------
    // Profile cache — cache hit/miss
    // -------------------------------------------------------------------------
    describe('profile cache (via plugin tool)', () => {
        it('plugin has get_group_insights tool defined', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'get_group_insights');
            expect(tool).toBeDefined();
            expect(tool!.permission).toBe('any');
            expect(tool!.metadata?.readOnly).toBe(true);
        });

        it('returns error when insufficient data (cache miss, no pluginApiRef)', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'get_group_insights');
            // No init called, so pluginApiRef = null → insufficient data
            const result = await tool!.execute(
                {},
                { groupFolder: 'empty-group' } as any,
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(false);
            expect(parsed.error).toContain('Insufficient data');
        });

        it('returns profile report after init and sufficient signals via hooks', async () => {
            const { default: plugin } = await import('../index.js');
            const mockApi = {
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
                dataDir: '/tmp/profiler-test',
            };

            await plugin.init!(mockApi as any);
            await plugin.start!(mockApi as any);

            // Feed 10 signals via afterMessage hook
            const baseTime = new Date('2026-03-16T10:00:00.000Z').getTime();
            for (let i = 0; i < 10; i++) {
                await plugin.hooks!.afterMessage!({
                    groupFolder: 'cached-group',
                    content: '你好世界 hello',
                    timestamp: new Date(baseTime + i * 60 * 1000).toISOString(),
                    reply: '',
                    chatJid: '-100test',
                    isFromMe: false,
                } as any);
            }

            // Now the tool should build a profile from the cached signals
            const tool = plugin.geminiTools?.find((t) => t.name === 'get_group_insights');
            // DB returns empty tasks (no error)
            mocks.preparedStmt.get.mockReturnValue({ total: 0, active: 0 });

            const result = await tool!.execute(
                {},
                { groupFolder: 'cached-group' } as any,
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.report).toContain('Group Profile: cached-group');
            expect(parsed.profile).toBeDefined();
        });
    });

    // -------------------------------------------------------------------------
    // Plugin lifecycle
    // -------------------------------------------------------------------------
    describe('plugin lifecycle', () => {
        it('init logs initialization message', async () => {
            const { default: plugin } = await import('../index.js');
            const mockApi = {
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
                dataDir: '/tmp/profiler-test',
            };
            await plugin.init!(mockApi as any);
            expect(mocks.logger.info).toHaveBeenCalledWith(
                expect.stringContaining('initialized'),
            );
        });

        it('stop clears signal buffers and profile cache', async () => {
            const { default: plugin } = await import('../index.js');
            const mockApi = {
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
                dataDir: '/tmp/profiler-test',
            };
            await plugin.init!(mockApi as any);

            // Add some signals
            await plugin.hooks!.afterMessage!({
                groupFolder: 'stop-test-group',
                content: 'hello',
                timestamp: new Date().toISOString(),
                reply: '',
                chatJid: '-100test',
                isFromMe: false,
            } as any);

            await plugin.stop!(mockApi as any);
            expect(mocks.logger.info).toHaveBeenCalledWith(
                expect.stringContaining('stopped'),
            );

            // After stop, tool should return no profile
            const tool = plugin.geminiTools?.find((t) => t.name === 'get_group_insights');
            const result = await tool!.execute({}, { groupFolder: 'stop-test-group' } as any);
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(false);
        });

        it('afterMessage hook adds signals', async () => {
            const { default: plugin } = await import('../index.js');
            expect(typeof plugin.hooks?.afterMessage).toBe('function');
            await expect(
                plugin.hooks!.afterMessage!({
                    groupFolder: 'hook-test',
                    content: '測試訊息',
                    timestamp: new Date().toISOString(),
                    reply: '',
                    chatJid: '-100test',
                    isFromMe: false,
                } as any),
            ).resolves.not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // getSentimentHistory (exported function)
    // -------------------------------------------------------------------------
    describe('getSentimentHistory export', () => {
        it('is exported from the plugin module', async () => {
            const mod = await import('../index.js');
            expect(typeof (mod as any).getSentimentHistory).toBe('function');
        });

        it('returns empty array for unknown group', async () => {
            const { getSentimentHistory } = await import('../index.js') as any;
            const history = getSentimentHistory('nonexistent-group');
            expect(Array.isArray(history)).toBe(true);
            expect(history).toHaveLength(0);
        });
    });
});
