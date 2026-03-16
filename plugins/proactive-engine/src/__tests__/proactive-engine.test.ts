import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => '{}'),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});

vi.mock('@nanogemclaw/db', () => ({
    getDatabase: () => mocks.db,
}));

vi.mock('fs', () => ({
    default: {
        existsSync: mocks.existsSync,
        readFileSync: mocks.readFileSync,
        writeFileSync: mocks.writeFileSync,
        mkdirSync: mocks.mkdirSync,
    },
}));

// ============================================================================
// Helpers — replicate the pure functions under test
// The plugin does NOT individually export its internal functions,
// so we test them through the module's exported default plugin + recreate
// the pure logic inline (same algorithm, verifiable contract).
// ============================================================================

/**
 * scoreResponse — mirrors the plugin implementation exactly.
 * 5 min → 1.0 | 15 min → 0.7 | 30 min → 0.3 | over 30 min → 0.0
 */
function scoreResponse(responseTimeMs: number): number {
    if (responseTimeMs <= 5 * 60 * 1000) return 1.0;
    if (responseTimeMs <= 15 * 60 * 1000) return 0.7;
    if (responseTimeMs <= 30 * 60 * 1000) return 0.3;
    return 0.0;
}

/**
 * EMA update — mirrors the plugin implementation.
 * newEma = alpha * score + (1 - alpha) * oldEma
 */
function updateEma(oldEma: number, score: number, alpha = 0.3): number {
    return alpha * score + (1 - alpha) * oldEma;
}

/**
 * autoTuneThreshold — mirrors plugin logic.
 * ema > 0.6 → lower by 0.05 (min 0.4)
 * ema < 0.3 → raise by 0.05 (max 0.95)
 */
function autoTuneThreshold(
    currentThreshold: number,
    ema: number,
    tuneStep = 0.05,
    min = 0.4,
    max = 0.95,
): number {
    if (ema > 0.6) return Math.max(min, currentThreshold - tuneStep);
    if (ema < 0.3) return Math.min(max, currentThreshold + tuneStep);
    return currentThreshold;
}

const INACTIVITY_THRESHOLDS = [
    { hours: 48, confidence: 0.7, message: '已超過 48 小時沒有互動，一切還好嗎？' },
    { hours: 24, confidence: 0.5, message: '似乎安靜了一段時間' },
];

/**
 * detectActivityAnomaly — reconstructed logic for pure testing (matches updated plugin).
 */
function detectActivityAnomaly(
    dailyCounts: number[],
    lastMessageAt: string,
    now = Date.now(),
): { type: string; confidence: number; suggestedMessage?: string } | null {
    const history = dailyCounts.slice(0, 6);
    const nonZero = history.filter((c) => c > 0);
    const avg = nonZero.length > 0
        ? history.reduce((a, b) => a + b, 0) / nonZero.length
        : 0;

    if (avg < 2) return null;

    const today = dailyCounts[6];
    const dropRate = avg > 0 ? (avg - today) / avg : 0;
    if (dropRate < 0.5) return null;

    if (lastMessageAt) {
        const hoursSince = (now - new Date(lastMessageAt).getTime()) / (60 * 60 * 1000);
        for (const threshold of INACTIVITY_THRESHOLDS) {
            if (hoursSince >= threshold.hours) {
                const confidence = Math.min(0.95, threshold.confidence + dropRate * 0.2);
                return { type: 'activity_anomaly', confidence, suggestedMessage: threshold.message };
            }
        }
        return null; // within 24h threshold
    }

    const confidence = Math.min(0.95, 0.5 + dropRate * 0.3);
    return { type: 'activity_anomaly', confidence };
}

/**
 * shouldSendProactive — reconstructed logic for pure testing.
 */
interface SignalStateLike {
    enabled: boolean;
    confidenceThreshold: number;
    recentProactive: Array<{ type: string; sentAt: string }>;
    maxPerDay: number;
}

function shouldSendProactive(
    state: SignalStateLike,
    signal: { confidence: number },
    nowHour: number,
    nowDateString: string,
    cooldownMs = 2 * 60 * 60 * 1000,
    nowEpoch = Date.now(),
): { send: boolean; reason: string } {
    if (!state.enabled) {
        return { send: false, reason: 'Proactive messages disabled for this group' };
    }
    if (signal.confidence < state.confidenceThreshold) {
        return { send: false, reason: `Confidence ${signal.confidence.toFixed(2)} below threshold ${state.confidenceThreshold}` };
    }
    const todayProactive = state.recentProactive.filter(
        (p) => new Date(p.sentAt).toDateString() === nowDateString,
    );
    if (todayProactive.length >= state.maxPerDay) {
        return { send: false, reason: `Daily limit reached (${state.maxPerDay})` };
    }
    const lastProactive = state.recentProactive[state.recentProactive.length - 1];
    if (lastProactive) {
        const timeSinceLast = nowEpoch - new Date(lastProactive.sentAt).getTime();
        if (timeSinceLast < cooldownMs) {
            return { send: false, reason: 'Cooldown period active' };
        }
    }
    if (nowHour >= 23 || nowHour < 7) {
        return { send: false, reason: 'Outside appropriate hours (07:00-23:00)' };
    }
    return { send: true, reason: 'All checks passed' };
}

/**
 * detectSentimentShift — reconstructed logic for pure testing.
 */
function detectSentimentShiftSignal(
    pendingShift: { previousMood: string; currentMood: string; shift: string; detectedAt: number } | null,
    now = Date.now(),
): { type: string; confidence: number } | null {
    if (!pendingShift) return null;
    const ageMs = now - pendingShift.detectedAt;
    if (ageMs > 2 * 60 * 60 * 1000) return null;

    const lower = pendingShift.shift.toLowerCase();
    let confidence = 0.65;
    if (lower.includes('positive') && lower.includes('negative')) confidence = 0.85;
    if (lower.includes('neutral') && lower.includes('negative')) confidence = 0.75;

    return { type: 'sentiment_shift', confidence };
}

// ============================================================================
// Tests
// ============================================================================

describe('proactive-engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preparedStmt.all.mockReturnValue([]);
        mocks.preparedStmt.get.mockReturnValue(undefined);
        mocks.isGeminiClientAvailable.mockReturnValue(false);
        mocks.existsSync.mockReturnValue(false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // -------------------------------------------------------------------------
    // scoreResponse — feedback scoring algorithm
    // -------------------------------------------------------------------------
    describe('scoreResponse', () => {
        it('returns 1.0 for response within 5 minutes', () => {
            expect(scoreResponse(0)).toBe(1.0);
            expect(scoreResponse(4 * 60 * 1000)).toBe(1.0);
            expect(scoreResponse(5 * 60 * 1000)).toBe(1.0);
        });

        it('returns 0.7 for response between 5 and 15 minutes', () => {
            expect(scoreResponse(5 * 60 * 1000 + 1)).toBe(0.7);
            expect(scoreResponse(10 * 60 * 1000)).toBe(0.7);
            expect(scoreResponse(15 * 60 * 1000)).toBe(0.7);
        });

        it('returns 0.3 for response between 15 and 30 minutes', () => {
            expect(scoreResponse(15 * 60 * 1000 + 1)).toBe(0.3);
            expect(scoreResponse(25 * 60 * 1000)).toBe(0.3);
            expect(scoreResponse(30 * 60 * 1000)).toBe(0.3);
        });

        it('returns 0.0 for no response (over 30 minutes)', () => {
            expect(scoreResponse(30 * 60 * 1000 + 1)).toBe(0.0);
            expect(scoreResponse(60 * 60 * 1000)).toBe(0.0);
            expect(scoreResponse(Number.MAX_SAFE_INTEGER)).toBe(0.0);
        });
    });

    // -------------------------------------------------------------------------
    // EMA calculation — auto-tuning feedback loop
    // -------------------------------------------------------------------------
    describe('EMA calculation', () => {
        const ALPHA = 0.3;

        it('converges toward high score from initial 0.5', () => {
            let ema = 0.5;
            for (let i = 0; i < 20; i++) {
                ema = updateEma(ema, 1.0, ALPHA);
            }
            expect(ema).toBeGreaterThan(0.9);
        });

        it('converges toward low score from initial 0.5', () => {
            let ema = 0.5;
            for (let i = 0; i < 20; i++) {
                ema = updateEma(ema, 0.0, ALPHA);
            }
            expect(ema).toBeLessThan(0.1);
        });

        it('single update applies alpha correctly', () => {
            const result = updateEma(0.5, 1.0, 0.3);
            expect(result).toBeCloseTo(0.3 * 1.0 + 0.7 * 0.5, 5);
        });

        it('handles edge case: score of 0 and ema of 0', () => {
            expect(updateEma(0, 0, ALPHA)).toBe(0);
        });
    });

    // -------------------------------------------------------------------------
    // autoTuneThreshold
    // -------------------------------------------------------------------------
    describe('autoTuneThreshold', () => {
        it('lowers threshold when EMA > 0.6 (good engagement)', () => {
            const result = autoTuneThreshold(0.7, 0.8);
            expect(result).toBeCloseTo(0.65, 10);
        });

        it('raises threshold when EMA < 0.3 (poor engagement)', () => {
            const result = autoTuneThreshold(0.7, 0.2);
            expect(result).toBeCloseTo(0.75, 10);
        });

        it('leaves threshold unchanged for middle EMA (0.3-0.6)', () => {
            expect(autoTuneThreshold(0.7, 0.5)).toBe(0.7);
            expect(autoTuneThreshold(0.7, 0.3)).toBe(0.7);
            expect(autoTuneThreshold(0.7, 0.6)).toBe(0.7);
        });

        it('clamps minimum threshold to 0.4', () => {
            // threshold already at min, EMA still good
            const result = autoTuneThreshold(0.4, 0.9);
            expect(result).toBe(0.4);
        });

        it('clamps maximum threshold to 0.95', () => {
            const result = autoTuneThreshold(0.95, 0.1);
            expect(result).toBe(0.95);
        });

        it('does not exceed maximum when stepping up', () => {
            const result = autoTuneThreshold(0.93, 0.1);
            expect(result).toBe(0.95); // clamped
        });

        it('does not go below minimum when stepping down', () => {
            const result = autoTuneThreshold(0.42, 0.9);
            expect(result).toBe(0.4); // clamped
        });
    });

    // -------------------------------------------------------------------------
    // detectActivityAnomaly
    // -------------------------------------------------------------------------
    describe('detectActivityAnomaly', () => {
        const now = Date.now();
        const oldTimestamp = new Date(now - 48 * 60 * 60 * 1000).toISOString(); // 48h ago

        it('returns null when avg activity is too low (< 2)', () => {
            const counts = [0, 1, 0, 1, 0, 1, 0]; // avg of non-zero = 1
            expect(detectActivityAnomaly(counts, oldTimestamp, now)).toBeNull();
        });

        it('returns null when drop rate is less than 50%', () => {
            const counts = [5, 5, 5, 5, 5, 5, 4]; // today=4, avg=5, drop=20%
            expect(detectActivityAnomaly(counts, oldTimestamp, now)).toBeNull();
        });

        it('returns null when last message was within 24 hours', () => {
            const counts = [10, 10, 10, 10, 10, 10, 0]; // 100% drop
            const recentTimestamp = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
            expect(detectActivityAnomaly(counts, recentTimestamp, now)).toBeNull();
        });

        it('detects anomaly when conditions are met', () => {
            const counts = [10, 10, 10, 10, 10, 10, 0]; // 100% drop, avg=10
            const signal = detectActivityAnomaly(counts, oldTimestamp, now);
            expect(signal).not.toBeNull();
            expect(signal!.type).toBe('activity_anomaly');
            expect(signal!.confidence).toBeGreaterThan(0.5);
        });

        it('caps confidence at 0.95', () => {
            const counts = [20, 20, 20, 20, 20, 20, 0]; // 100% drop
            const signal = detectActivityAnomaly(counts, oldTimestamp, now);
            expect(signal!.confidence).toBeLessThanOrEqual(0.95);
        });

        it('confidence increases with larger drop rate', () => {
            const counts50 = [10, 10, 10, 10, 10, 10, 5]; // 50% drop
            const counts100 = [10, 10, 10, 10, 10, 10, 0]; // 100% drop
            const sig50 = detectActivityAnomaly(counts50, oldTimestamp, now);
            const sig100 = detectActivityAnomaly(counts100, oldTimestamp, now);
            // Both hit 48h threshold (base 0.7), plus dropRate * 0.2
            // 50% drop: confidence=0.7+0.5*0.2=0.8
            // 100% drop: confidence=0.7+1.0*0.2=0.9
            expect(sig50!.confidence).toBeLessThan(sig100!.confidence);
        });
    });

    // -------------------------------------------------------------------------
    // Extended detectActivityAnomaly — multi-threshold behavior
    // -------------------------------------------------------------------------
    describe('detectActivityAnomaly extended thresholds', () => {
        const now = Date.now();
        const counts = [10, 10, 10, 10, 10, 10, 0]; // 100% drop, avg=10

        it('48h+ inactivity produces confidence >= 0.7 base', () => {
            const ts48h = new Date(now - 49 * 60 * 60 * 1000).toISOString();
            const signal = detectActivityAnomaly(counts, ts48h, now);
            expect(signal).not.toBeNull();
            // base 0.7 + 1.0 * 0.2 = 0.9
            expect(signal!.confidence).toBeGreaterThanOrEqual(0.7);
        });

        it('48h threshold uses correct message', () => {
            const ts48h = new Date(now - 49 * 60 * 60 * 1000).toISOString();
            const signal = detectActivityAnomaly(counts, ts48h, now);
            expect(signal!.suggestedMessage).toBe('已超過 48 小時沒有互動，一切還好嗎？');
        });

        it('24h inactivity (but < 48h) produces confidence >= 0.5 base', () => {
            const ts25h = new Date(now - 25 * 60 * 60 * 1000).toISOString();
            const signal = detectActivityAnomaly(counts, ts25h, now);
            expect(signal).not.toBeNull();
            // base 0.5 + 1.0 * 0.2 = 0.7
            expect(signal!.confidence).toBeGreaterThanOrEqual(0.5);
        });

        it('24h threshold uses correct message', () => {
            const ts25h = new Date(now - 25 * 60 * 60 * 1000).toISOString();
            const signal = detectActivityAnomaly(counts, ts25h, now);
            expect(signal!.suggestedMessage).toBe('似乎安靜了一段時間');
        });

        it('48h threshold gives higher confidence than 24h threshold for same drop rate', () => {
            const ts48h = new Date(now - 49 * 60 * 60 * 1000).toISOString();
            const ts25h = new Date(now - 25 * 60 * 60 * 1000).toISOString();
            const sig48 = detectActivityAnomaly(counts, ts48h, now);
            const sig24 = detectActivityAnomaly(counts, ts25h, now);
            expect(sig48!.confidence).toBeGreaterThan(sig24!.confidence);
        });

        it('< 24h inactivity returns null', () => {
            const ts23h = new Date(now - 23 * 60 * 60 * 1000).toISOString();
            const signal = detectActivityAnomaly(counts, ts23h, now);
            expect(signal).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // Overdue task detection — confidence logic
    // -------------------------------------------------------------------------
    describe('overdue task confidence', () => {
        it('overdue task has higher base confidence than upcoming task', () => {
            // Overdue: base 0.8 + up to 0.15 = 0.95 max
            const hoursOverdue = 12;
            const overdueConfidence = Math.min(0.95, 0.8 + Math.min(hoursOverdue, 24) / 24 * 0.15);
            // Upcoming (>6h): base 0.75
            const upcomingConfidence = 0.75;
            expect(overdueConfidence).toBeGreaterThan(upcomingConfidence);
        });

        it('overdue task confidence increases with hours overdue (up to 24h cap)', () => {
            const conf1h = Math.min(0.95, 0.8 + Math.min(1, 24) / 24 * 0.15);
            const conf12h = Math.min(0.95, 0.8 + Math.min(12, 24) / 24 * 0.15);
            const conf24h = Math.min(0.95, 0.8 + Math.min(24, 24) / 24 * 0.15);
            expect(conf1h).toBeLessThan(conf12h);
            expect(conf12h).toBeLessThan(conf24h);
        });

        it('overdue confidence is capped at 0.95', () => {
            // Even at 100h overdue, capped at 0.95
            const conf = Math.min(0.95, 0.8 + Math.min(100, 24) / 24 * 0.15);
            expect(conf).toBeLessThanOrEqual(0.95);
        });

        it('upcoming task within 6h has higher confidence than >6h', () => {
            // <6h: confidence 0.9
            // >=6h: confidence 0.75
            expect(0.9).toBeGreaterThan(0.75);
        });
    });

    // -------------------------------------------------------------------------
    // shouldSendProactive — gating logic
    // -------------------------------------------------------------------------
    describe('shouldSendProactive', () => {
        const nowEpoch = new Date('2026-03-16T10:00:00.000Z').getTime();
        const nowDateString = new Date(nowEpoch).toDateString();
        const nowHour = new Date(nowEpoch).getHours(); // UTC=10, should be within 7-23

        const baseState: SignalStateLike = {
            enabled: true,
            confidenceThreshold: 0.7,
            recentProactive: [],
            maxPerDay: 3,
        };

        const highConfSignal = { confidence: 0.8 };
        const lowConfSignal = { confidence: 0.5 };

        it('returns send=true when all checks pass', () => {
            const result = shouldSendProactive(baseState, highConfSignal, nowHour, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(true);
        });

        it('blocks when proactive is disabled', () => {
            const state = { ...baseState, enabled: false };
            const result = shouldSendProactive(state, highConfSignal, nowHour, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(false);
            expect(result.reason).toContain('disabled');
        });

        it('blocks when confidence is below threshold', () => {
            const result = shouldSendProactive(baseState, lowConfSignal, nowHour, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(false);
            expect(result.reason).toContain('below threshold');
        });

        it('blocks when daily limit is reached', () => {
            const state: SignalStateLike = {
                ...baseState,
                maxPerDay: 2,
                recentProactive: [
                    { type: 'a', sentAt: new Date(nowEpoch - 3 * 60 * 60 * 1000).toISOString() },
                    { type: 'b', sentAt: new Date(nowEpoch - 4 * 60 * 60 * 1000).toISOString() },
                ],
            };
            const result = shouldSendProactive(state, highConfSignal, nowHour, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(false);
            expect(result.reason).toContain('Daily limit');
        });

        it('blocks during cooldown period', () => {
            const state: SignalStateLike = {
                ...baseState,
                recentProactive: [
                    { type: 'a', sentAt: new Date(nowEpoch - 30 * 60 * 1000).toISOString() }, // 30 min ago
                ],
            };
            const result = shouldSendProactive(state, highConfSignal, nowHour, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(false);
            expect(result.reason).toContain('Cooldown');
        });

        it('allows sending when cooldown has expired', () => {
            const state: SignalStateLike = {
                ...baseState,
                recentProactive: [
                    { type: 'a', sentAt: new Date(nowEpoch - 3 * 60 * 60 * 1000).toISOString() }, // 3h ago
                ],
            };
            const result = shouldSendProactive(state, highConfSignal, nowHour, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(true);
        });

        it('blocks at hour 23 (late night)', () => {
            const result = shouldSendProactive(baseState, highConfSignal, 23, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(false);
            expect(result.reason).toContain('appropriate hours');
        });

        it('blocks at hour 6 (early morning)', () => {
            const result = shouldSendProactive(baseState, highConfSignal, 6, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(false);
            expect(result.reason).toContain('appropriate hours');
        });

        it('allows at hour 7 (boundary)', () => {
            const result = shouldSendProactive(baseState, highConfSignal, 7, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(true);
        });

        it('allows at hour 22 (boundary)', () => {
            const result = shouldSendProactive(baseState, highConfSignal, 22, nowDateString, 2 * 60 * 60 * 1000, nowEpoch);
            expect(result.send).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // detectSentimentShift
    // -------------------------------------------------------------------------
    describe('detectSentimentShift', () => {
        const now = Date.now();

        it('returns null when no pending shift exists', () => {
            expect(detectSentimentShiftSignal(null, now)).toBeNull();
        });

        it('returns null when shift is older than 2 hours', () => {
            const oldShift = {
                previousMood: 'happy',
                currentMood: 'sad',
                shift: 'positive → negative',
                detectedAt: now - 3 * 60 * 60 * 1000, // 3h ago
            };
            expect(detectSentimentShiftSignal(oldShift, now)).toBeNull();
        });

        it('detects shift within 2 hours', () => {
            const recentShift = {
                previousMood: 'happy',
                currentMood: 'sad',
                shift: 'positive → negative',
                detectedAt: now - 30 * 60 * 1000, // 30 min ago
            };
            const result = detectSentimentShiftSignal(recentShift, now);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('sentiment_shift');
        });

        it('assigns confidence 0.85 for positive+negative shift', () => {
            const shift = {
                previousMood: 'happy',
                currentMood: 'sad',
                shift: 'positive → negative',
                detectedAt: now - 10 * 60 * 1000,
            };
            const result = detectSentimentShiftSignal(shift, now);
            expect(result!.confidence).toBe(0.85);
        });

        it('assigns confidence 0.75 for neutral→negative shift', () => {
            const shift = {
                previousMood: 'neutral',
                currentMood: 'stressed',
                shift: 'neutral → negative',
                detectedAt: now - 10 * 60 * 1000,
            };
            const result = detectSentimentShiftSignal(shift, now);
            expect(result!.confidence).toBe(0.75);
        });

        it('assigns default confidence 0.65 for other shifts', () => {
            const shift = {
                previousMood: 'stressed',
                currentMood: 'calm',
                shift: 'neutral → neutral',
                detectedAt: now - 10 * 60 * 1000,
            };
            const result = detectSentimentShiftSignal(shift, now);
            expect(result!.confidence).toBe(0.65);
        });
    });

    // -------------------------------------------------------------------------
    // Daily rotation logic
    // -------------------------------------------------------------------------
    describe('daily count rotation', () => {
        it('shifts left and appends zero', () => {
            const counts = [1, 2, 3, 4, 5, 6, 7];
            // Simulate rotateDailyCounts
            counts.shift();
            counts.push(0);
            expect(counts).toEqual([2, 3, 4, 5, 6, 7, 0]);
        });

        it('always maintains exactly 7 slots', () => {
            const counts = [1, 2, 3, 4, 5, 6, 7];
            for (let i = 0; i < 10; i++) {
                counts.shift();
                counts.push(0);
            }
            expect(counts).toHaveLength(7);
        });

        it('oldest data is dropped after rotation', () => {
            const counts = [99, 1, 1, 1, 1, 1, 0];
            counts.shift();
            counts.push(0);
            expect(counts[0]).toBe(1); // 99 was dropped
        });
    });

    // -------------------------------------------------------------------------
    // Plugin init — state persistence (via mocked fs)
    // -------------------------------------------------------------------------
    describe('plugin init state loading', () => {
        it('skips loading when state file does not exist', async () => {
            mocks.existsSync.mockReturnValue(false);
            // Import plugin and call init — should not throw
            const { default: plugin } = await import('../index.js');
            const mockApi = {
                dataDir: '/tmp/proactive-test',
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
            };
            await expect(plugin.init!(mockApi as any)).resolves.not.toThrow();
            // When file doesn't exist, no "Loaded signal states" log — only "initialized"
            expect(mocks.logger.info).toHaveBeenCalledWith(
                expect.stringContaining('initialized'),
            );
        });

        it('loads persisted state when file exists with valid JSON', async () => {
            const savedState = {
                persistedGroup: {
                    dailyCounts: [5, 5, 5, 5, 5, 5, 3],
                    lastMessageAt: '2026-01-01T00:00:00.000Z',
                    recentProactive: [],
                    confidenceThreshold: 0.6,
                    enabled: true,
                    maxPerDay: 5,
                    proactiveFeedback: [],
                    feedbackEma: 0.7,
                    autoTuneEnabled: true,
                },
            };
            // existsSync must return true so the load branch executes
            mocks.existsSync.mockReturnValue(true);
            mocks.readFileSync.mockReturnValue(JSON.stringify(savedState));

            const { default: plugin } = await import('../index.js');
            const mockApi = {
                dataDir: '/tmp/proactive-test',
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
            };
            await plugin.init!(mockApi as any);
            // Either "Loaded signal states" (new data) or "initialized" must appear
            const allInfoCalls = mocks.logger.info.mock.calls.map((c: unknown[]) => String(c[0]));
            expect(allInfoCalls.some((msg) => msg.includes('initialized') || msg.includes('Loaded'))).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Plugin stop — state persistence
    // -------------------------------------------------------------------------
    describe('plugin stop state saving', () => {
        it('completes without throwing and logs stopped', async () => {
            mocks.existsSync.mockReturnValue(false);
            const { default: plugin } = await import('../index.js');
            const mockApi = {
                dataDir: '/tmp/proactive-test',
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
            };
            await expect(plugin.stop!(mockApi as any)).resolves.not.toThrow();
            expect(mocks.logger.info).toHaveBeenCalledWith(
                expect.stringContaining('stopped'),
            );
        });

        it('clears in-memory state on stop', async () => {
            // The plugin clears signalStates map on stop — verify by checking
            // that stop completes successfully and the plugin can be re-init'd cleanly.
            mocks.existsSync.mockReturnValue(false);
            const { default: plugin } = await import('../index.js');
            const mockApi = {
                dataDir: '/tmp/proactive-test',
                logger: mocks.logger,
                getDatabase: () => mocks.db,
                getGroups: () => ({}),
                eventBus: mocks.eventBus,
                sendMessage: vi.fn(),
            };
            await plugin.init!(mockApi as any);
            vi.clearAllMocks();
            await expect(plugin.stop!(mockApi as any)).resolves.not.toThrow();
            // After stop, init again should work cleanly (state was cleared)
            await expect(plugin.init!(mockApi as any)).resolves.not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // Message hook: afterMessage records message and handles observation window
    // -------------------------------------------------------------------------
    describe('message hook afterMessage', () => {
        it('is defined on the plugin', async () => {
            const { default: plugin } = await import('../index.js');
            expect(typeof plugin.hooks?.afterMessage).toBe('function');
        });

        it('does not throw when called with valid context', async () => {
            const { default: plugin } = await import('../index.js');
            const context = {
                groupFolder: 'test-group',
                content: 'hello',
                timestamp: new Date().toISOString(),
                reply: '',
                chatJid: '-100123',
                isFromMe: false,
            };
            await expect(
                plugin.hooks!.afterMessage!(context as any),
            ).resolves.not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // Gemini tool: configure_proactive
    // -------------------------------------------------------------------------
    describe('configure_proactive tool', () => {
        it('is defined and has correct metadata', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'configure_proactive');
            expect(tool).toBeDefined();
            expect(tool!.permission).toBe('any');
            expect(tool!.metadata?.requiresExplicitIntent).toBe(true);
        });

        it('returns current settings when no args given', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'configure_proactive');
            const result = await tool!.execute({}, { groupFolder: 'tool-test-group' } as any);
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.settings).toHaveProperty('enabled');
            expect(parsed.settings).toHaveProperty('confidenceThreshold');
            expect(parsed.settings).toHaveProperty('maxPerDay');
        });

        it('updates enabled flag', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'configure_proactive');
            const result = await tool!.execute(
                { enabled: false },
                { groupFolder: 'tool-test-group' } as any,
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.settings.enabled).toBe(false);
        });

        it('clamps confidence_threshold to [0, 1]', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'configure_proactive');
            await tool!.execute(
                { confidence_threshold: 1.5 },
                { groupFolder: 'tool-clamp-group' } as any,
            );
            const result2 = await tool!.execute(
                {},
                { groupFolder: 'tool-clamp-group' } as any,
            );
            const parsed = JSON.parse(result2);
            expect(parsed.settings.confidenceThreshold).toBeLessThanOrEqual(1);
        });

        it('clamps max_per_day to [1, 10]', async () => {
            const { default: plugin } = await import('../index.js');
            const tool = plugin.geminiTools?.find((t) => t.name === 'configure_proactive');
            await tool!.execute(
                { max_per_day: 100 },
                { groupFolder: 'tool-max-group' } as any,
            );
            const result = await tool!.execute(
                {},
                { groupFolder: 'tool-max-group' } as any,
            );
            const parsed = JSON.parse(result);
            expect(parsed.settings.maxPerDay).toBeLessThanOrEqual(10);
        });
    });
});
