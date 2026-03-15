/**
 * Proactive Signal Engine Plugin
 *
 * Monitors multi-source signals and initiates contextually appropriate
 * messages when patterns warrant intervention.
 *
 * Signal types:
 * - Activity anomaly: frequency drops >50% vs 7-day average
 * - Calendar awareness: important event within 24h
 * - Task deadline: approaching deadline with no recent updates
 * - Commitment tracking: mentioned future commitments
 *
 * Extension points used:
 * - Background Services: signal monitoring loop
 * - Message Hooks (afterMessage): update signal state
 * - Gemini Tools: configure_proactive for user control
 * - Event Bus: subscribe to all relevant events
 */

import type {
    NanoPlugin,
    PluginApi,
    GeminiToolContribution,
    ToolExecutionContext,
    MessageHookContext,
    ServiceContribution,
} from '@nanogemclaw/plugin-api';

// ============================================================================
// Types
// ============================================================================

interface ProactiveFeedback {
    signalType: string;
    sentAt: string;
    score: number | null; // null = still in observation window
    responseTimeMs: number | null;
}

interface ObservationWindow {
    signalType: string;
    sentAt: number; // epoch ms
    chatJid: string;
}

interface SignalState {
    /** Message counts per day (last 7 days) */
    dailyCounts: number[];
    /** Timestamp of last message */
    lastMessageAt: string;
    /** Proactive messages sent recently (for spam prevention) */
    recentProactive: Array<{ type: string; sentAt: string }>;
    /** User-configured confidence threshold (0-1) */
    confidenceThreshold: number;
    /** Whether proactive messages are enabled */
    enabled: boolean;
    /** Maximum proactive messages per day */
    maxPerDay: number;
    /** Feedback history for auto-tuning */
    proactiveFeedback: ProactiveFeedback[];
    /** EMA of feedback scores */
    feedbackEma: number;
    /** Whether auto-tuning is enabled */
    autoTuneEnabled: boolean;
    /** Last known chat_jid for this group (from message hooks) */
    lastChatJid?: string;
}

interface DetectedSignal {
    type: 'activity_anomaly' | 'calendar_awareness' | 'task_deadline' | 'commitment_reminder' | 'sentiment_shift';
    confidence: number;
    context: string;
    suggestedMessage: string;
}

// ============================================================================
// State Management
// ============================================================================

const signalStates = new Map<string, SignalState>();
const observationWindows = new Map<string, ObservationWindow>(); // groupFolder → active window
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_MAX_PER_DAY = 3;
const PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours between proactive messages
const OBSERVATION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const FEEDBACK_EMA_ALPHA = 0.3;
const MIN_FEEDBACK_FOR_TUNING = 5;
const TUNE_STEP = 0.05;
const MIN_THRESHOLD = 0.4;
const MAX_THRESHOLD = 0.95;

function getOrCreateState(groupFolder: string): SignalState {
    let state = signalStates.get(groupFolder);
    if (!state) {
        state = {
            dailyCounts: new Array(7).fill(0),
            lastMessageAt: '',
            recentProactive: [],
            confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
            enabled: true,
            maxPerDay: DEFAULT_MAX_PER_DAY,
            proactiveFeedback: [],
            feedbackEma: 0.5,
            autoTuneEnabled: true,
        };
        signalStates.set(groupFolder, state);
    }
    // Migrate existing states that lack new fields
    if (state.proactiveFeedback === undefined) state.proactiveFeedback = [];
    if (state.feedbackEma === undefined) state.feedbackEma = 0.5;
    if (state.autoTuneEnabled === undefined) state.autoTuneEnabled = true;
    return state;
}

function recordMessage(groupFolder: string, timestamp: string, chatJid?: string): void {
    const state = getOrCreateState(groupFolder);
    state.lastMessageAt = timestamp;
    if (chatJid) state.lastChatJid = chatJid;
    // Increment today's count (index 6 = today)
    state.dailyCounts[6]++;
}

/**
 * Rotate daily counts — call once per day.
 * Shifts counts left (drops oldest), adds 0 for new day.
 */
function rotateDailyCounts(): void {
    for (const [, state] of signalStates) {
        state.dailyCounts.shift();
        state.dailyCounts.push(0);
    }
}

/**
 * Clean old proactive message records.
 */
function cleanRecentProactive(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const [, state] of signalStates) {
        state.recentProactive = state.recentProactive.filter(
            (p) => p.sentAt > cutoff,
        );
    }
}

// ============================================================================
// Feedback Tracking & Auto-Tuning
// ============================================================================

/**
 * Start a 30-minute observation window after sending a proactive message.
 * If the user responds within the window, score the effectiveness.
 */
function startObservationWindow(groupFolder: string, signalType: string, chatJid: string): void {
    observationWindows.set(groupFolder, {
        signalType,
        sentAt: Date.now(),
        chatJid,
    });
}

/**
 * Score a response: returns 1.0 (≤5 min), 0.7 (≤15 min), 0.3 (≤30 min), 0.0 (no response).
 */
function scoreResponse(responseTimeMs: number): number {
    if (responseTimeMs <= 5 * 60 * 1000) return 1.0;
    if (responseTimeMs <= 15 * 60 * 1000) return 0.7;
    if (responseTimeMs <= 30 * 60 * 1000) return 0.3;
    return 0.0;
}

/**
 * Record feedback score and run auto-tuning if enough data has accumulated.
 */
function recordFeedback(
    groupFolder: string,
    signalType: string,
    score: number,
    responseTimeMs: number,
    api: PluginApi,
): void {
    const state = getOrCreateState(groupFolder);

    const feedback: ProactiveFeedback = {
        signalType,
        sentAt: new Date().toISOString(),
        score,
        responseTimeMs,
    };
    state.proactiveFeedback.push(feedback);

    // Keep only last 50 feedback entries
    if (state.proactiveFeedback.length > 50) {
        state.proactiveFeedback.shift();
    }

    // Update EMA
    state.feedbackEma = FEEDBACK_EMA_ALPHA * score + (1 - FEEDBACK_EMA_ALPHA) * state.feedbackEma;

    // Emit feedback event
    if (api.eventBus) {
        api.eventBus.emit('proactive:feedback-received', {
            groupFolder,
            signalType,
            score,
            responseTimeMs,
        });
    }

    // Auto-tune after accumulating enough data
    if (state.autoTuneEnabled && state.proactiveFeedback.filter((f) => f.score !== null).length >= MIN_FEEDBACK_FOR_TUNING) {
        autoTuneThreshold(groupFolder, api);
    }
}

/**
 * Adjust confidence threshold based on EMA feedback score.
 */
function autoTuneThreshold(groupFolder: string, api: PluginApi): void {
    const state = getOrCreateState(groupFolder);
    const ema = state.feedbackEma;
    const oldThreshold = state.confidenceThreshold;

    if (ema > 0.6) {
        // Good engagement — lower threshold to be more proactive
        state.confidenceThreshold = Math.max(MIN_THRESHOLD, state.confidenceThreshold - TUNE_STEP);
    } else if (ema < 0.3) {
        // Poor engagement — raise threshold to be less proactive
        state.confidenceThreshold = Math.min(MAX_THRESHOLD, state.confidenceThreshold + TUNE_STEP);
    }

    if (state.confidenceThreshold !== oldThreshold) {
        api.logger.info(
            `Auto-tuned confidence threshold for ${groupFolder}: ${oldThreshold.toFixed(2)} → ${state.confidenceThreshold.toFixed(2)} (feedback EMA: ${ema.toFixed(2)})`,
        );
    }
}

/**
 * Check all active observation windows and close expired ones with score 0.
 */
function processExpiredObservationWindows(api: PluginApi): void {
    const now = Date.now();
    for (const [groupFolder, window] of observationWindows) {
        if (now - window.sentAt > OBSERVATION_WINDOW_MS) {
            // No response received — score 0
            recordFeedback(groupFolder, window.signalType, 0.0, OBSERVATION_WINDOW_MS, api);
            observationWindows.delete(groupFolder);
        }
    }
}

// ============================================================================
// Signal Detection
// ============================================================================

function detectActivityAnomaly(groupFolder: string): DetectedSignal | null {
    const state = getOrCreateState(groupFolder);
    const history = state.dailyCounts.slice(0, 6); // Exclude today
    const avg = history.reduce((a, b) => a + b, 0) / Math.max(1, history.filter((c) => c > 0).length);

    if (avg < 2) return null; // Not enough baseline

    const today = state.dailyCounts[6];
    const dropRate = avg > 0 ? (avg - today) / avg : 0;

    if (dropRate < 0.5) return null; // Less than 50% drop

    // Check if last message was more than 24h ago
    if (state.lastMessageAt) {
        const hoursSinceLastMessage =
            (Date.now() - new Date(state.lastMessageAt).getTime()) / (60 * 60 * 1000);
        if (hoursSinceLastMessage < 24) return null;
    }

    const confidence = Math.min(0.95, 0.5 + dropRate * 0.3);

    return {
        type: 'activity_anomaly',
        confidence,
        context: `Activity dropped ${Math.round(dropRate * 100)}% vs 7-day average (avg: ${avg.toFixed(1)}/day, today: ${today})`,
        suggestedMessage: '大家最近比較忙嗎？有什麼我可以幫忙的嗎？',
    };
}

async function detectTaskDeadlines(
    groupFolder: string,
    api: PluginApi,
): Promise<DetectedSignal | null> {
    try {
        const db = api.getDatabase() as import('better-sqlite3').Database;
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

        const dueTasks = db
            .prepare(
                `SELECT id, prompt, next_run FROM scheduled_tasks
         WHERE group_folder = ? AND status = 'active'
         AND schedule_type = 'once' AND next_run <= ? AND next_run > ?`,
            )
            .all(groupFolder, tomorrow, now.toISOString()) as Array<{
            id: string;
            prompt: string;
            next_run: string;
        }>;

        if (dueTasks.length === 0) return null;

        const task = dueTasks[0];
        const hoursUntil = Math.max(
            0,
            (new Date(task.next_run).getTime() - now.getTime()) / (60 * 60 * 1000),
        );

        return {
            type: 'task_deadline',
            confidence: hoursUntil < 6 ? 0.9 : 0.75,
            context: `Task "${task.prompt.slice(0, 50)}" due in ${Math.round(hoursUntil)}h`,
            suggestedMessage: `提醒：「${task.prompt.slice(0, 30)}」的截止時間快到了，需要我幫忙嗎？`,
        };
    } catch {
        return null;
    }
}

async function detectCalendarEvents(
    groupFolder: string,
    api: PluginApi,
): Promise<DetectedSignal | null> {
    // Try to access calendar data through the database
    // Calendar events are stored by the google-calendar-rw plugin
    try {
        const db = api.getDatabase() as import('better-sqlite3').Database;

        // Check if facts table has calendar-related entries
        const calendarFacts = db
            .prepare(
                "SELECT key, value FROM facts WHERE group_folder = ? AND key LIKE 'calendar_%' ORDER BY updated_at DESC LIMIT 5",
            )
            .all(groupFolder) as Array<{ key: string; value: string }>;

        if (calendarFacts.length === 0) return null;

        // Look for upcoming events in facts
        const upcomingEvent = calendarFacts.find((f) =>
            f.key.includes('upcoming') || f.key.includes('next_event'),
        );

        if (!upcomingEvent) return null;

        return {
            type: 'calendar_awareness',
            confidence: 0.8,
            context: `Upcoming calendar event: ${upcomingEvent.value}`,
            suggestedMessage: `明天有行程：${upcomingEvent.value.slice(0, 50)}，需要我幫你準備什麼嗎？`,
        };
    } catch {
        return null;
    }
}

// ============================================================================
// Commitment Reminder Detection
// ============================================================================

interface CommitmentSignal {
    commitment: string;
    estimatedDue: string;
    mentionedAt: string;
    followedUp: boolean;
}

const COMMITMENT_PATTERNS_ZH = [
    /我(?:會|要|想要|打算|準備)(.{3,40})/g,
    /明天(.{3,40})/g,
    /下週(.{3,40})/g,
    /等一下(.{3,40})/g,
    /之後(.{3,40})/g,
    /待會(.{3,40})/g,
];

const COMMITMENT_PATTERNS_EN = [
    /I(?:'ll| will| am going to) (.{3,60})/gi,
    /tomorrow[,\s]+(.{3,60})/gi,
    /next week[,\s]+(.{3,60})/gi,
    /later[,\s]+(?:I(?:'ll| will)? )?(.{3,60})/gi,
];

/**
 * Estimate due time from commitment keyword.
 */
function estimateDueTime(matchedText: string, mentionedAt: Date): string {
    const lower = matchedText.toLowerCase();
    const base = new Date(mentionedAt);
    if (/明天|tomorrow/.test(lower)) {
        base.setDate(base.getDate() + 1);
        return base.toISOString();
    }
    if (/下週|next week/.test(lower)) {
        base.setDate(base.getDate() + 7);
        return base.toISOString();
    }
    if (/等一下|待會|later/.test(lower)) {
        base.setMinutes(base.getMinutes() + 60);
        return base.toISOString();
    }
    // Default: 24 hours
    base.setDate(base.getDate() + 1);
    return base.toISOString();
}

async function detectCommitmentReminders(
    groupFolder: string,
    api: PluginApi,
): Promise<DetectedSignal | null> {
    try {
        const db = api.getDatabase() as import('better-sqlite3').Database;
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Resolve chat_jid for this group from stored state
        const state = getOrCreateState(groupFolder);
        if (!state.lastChatJid) return null;
        const chatJid = state.lastChatJid;

        // Get recent messages with potential commitments
        const recentMessages = db
            .prepare(
                `SELECT content, timestamp FROM messages
                 WHERE chat_jid = ?
                 AND timestamp > ? AND is_from_me = 0
                 AND content != '' AND length(content) > 5
                 ORDER BY timestamp DESC LIMIT 100`,
            )
            .all(chatJid, sevenDaysAgo) as Array<{ content: string; timestamp: string }>;

        if (recentMessages.length === 0) return null;

        const now = Date.now();
        const commitments: CommitmentSignal[] = [];

        for (const msg of recentMessages) {
            const mentionedAt = new Date(msg.timestamp);
            const allPatterns = [...COMMITMENT_PATTERNS_ZH, ...COMMITMENT_PATTERNS_EN];

            for (const pattern of allPatterns) {
                pattern.lastIndex = 0;
                const match = pattern.exec(msg.content);
                if (!match) continue;

                const commitmentText = (match[1] || match[0]).trim().slice(0, 80);
                const estimatedDue = estimateDueTime(msg.content, mentionedAt);

                // Only consider overdue or soon-due commitments
                const dueTime = new Date(estimatedDue).getTime();
                if (dueTime > now + 2 * 60 * 60 * 1000) continue; // Not due yet (>2h)

                // Check if there's a follow-up message after the commitment
                const followUpCount = db
                    .prepare(
                        `SELECT COUNT(*) as cnt FROM messages
                         WHERE chat_jid = ?
                         AND timestamp > ? AND content LIKE ?`,
                    )
                    .get(chatJid, msg.timestamp, `%${commitmentText.slice(0, 20)}%`) as { cnt: number };

                const followedUp = followUpCount.cnt > 0;
                if (!followedUp) {
                    commitments.push({
                        commitment: commitmentText,
                        estimatedDue,
                        mentionedAt: msg.timestamp,
                        followedUp: false,
                    });
                }
            }
        }

        if (commitments.length === 0) return null;

        // Pick the oldest unresolved commitment
        commitments.sort((a, b) => a.mentionedAt.localeCompare(b.mentionedAt));
        const top = commitments[0];
        const hoursOverdue = Math.max(
            0,
            (now - new Date(top.estimatedDue).getTime()) / (60 * 60 * 1000),
        );

        // Confidence based on how overdue: more overdue = higher confidence
        const confidence = Math.min(0.9, 0.55 + Math.min(hoursOverdue, 24) / 24 * 0.35);

        return {
            type: 'commitment_reminder',
            confidence,
            context: `Unfollowed commitment: "${top.commitment}" (mentioned ${top.mentionedAt}, due ~${top.estimatedDue})`,
            suggestedMessage: `之前提到的「${top.commitment.slice(0, 30)}」，後來怎麼樣了呢？需要我幫忙嗎？`,
        };
    } catch {
        return null;
    }
}

// ============================================================================
// Sentiment Shift Detection
// ============================================================================

interface PendingSentimentShift {
    previousMood: string;
    currentMood: string;
    shift: string;
    detectedAt: number; // epoch ms
}

// Stores unprocessed sentiment shift events from the profiler
const pendingSentimentShifts = new Map<string, PendingSentimentShift>();

function registerSentimentShiftListener(api: PluginApi): void {
    if (!api.eventBus) return;
    api.eventBus.on('profiler:sentiment-updated', (payload) => {
        pendingSentimentShifts.set(payload.groupFolder, {
            previousMood: payload.previousMood,
            currentMood: payload.currentMood,
            shift: payload.shift,
            detectedAt: Date.now(),
        });
    });
}

function detectSentimentShift(groupFolder: string): DetectedSignal | null {
    const pending = pendingSentimentShifts.get(groupFolder);
    if (!pending) return null;

    // Only surface shifts detected within the last 2 hours
    const ageMs = Date.now() - pending.detectedAt;
    if (ageMs > 2 * 60 * 60 * 1000) {
        pendingSentimentShifts.delete(groupFolder);
        return null;
    }

    // Confidence based on shift type
    const shiftLower = pending.shift.toLowerCase();
    let confidence = 0.65;
    if (shiftLower.includes('positive') && shiftLower.includes('negative')) confidence = 0.85;
    if (shiftLower.includes('neutral') && shiftLower.includes('negative')) confidence = 0.75;

    // Choose empathetic message based on direction
    let suggestedMessage: string;
    if (pending.shift.includes('negative')) {
        suggestedMessage = `大家最近感覺有點${pending.currentMood}？有什麼我可以幫上忙的嗎？`;
    } else if (pending.shift.includes('positive')) {
        suggestedMessage = `感覺大家最近氣氛不錯！有什麼好事嗎？`;
    } else {
        suggestedMessage = `最近群組的氣氛有些變化，大家都還好嗎？`;
    }

    // Clear after generating signal
    pendingSentimentShifts.delete(groupFolder);

    return {
        type: 'sentiment_shift',
        confidence,
        context: `Mood shifted: ${pending.shift} (${pending.previousMood} → ${pending.currentMood})`,
        suggestedMessage,
    };
}

// ============================================================================
// Proactive Decision Framework
// ============================================================================

function shouldSendProactive(
    state: SignalState,
    signal: DetectedSignal,
): { send: boolean; reason: string } {
    if (!state.enabled) {
        return { send: false, reason: 'Proactive messages disabled for this group' };
    }

    if (signal.confidence < state.confidenceThreshold) {
        return {
            send: false,
            reason: `Confidence ${signal.confidence.toFixed(2)} below threshold ${state.confidenceThreshold}`,
        };
    }

    // Check daily limit
    const todayProactive = state.recentProactive.filter((p) => {
        const sentDate = new Date(p.sentAt).toDateString();
        return sentDate === new Date().toDateString();
    });
    if (todayProactive.length >= state.maxPerDay) {
        return { send: false, reason: `Daily limit reached (${state.maxPerDay})` };
    }

    // Check cooldown (don't send too frequently)
    const lastProactive = state.recentProactive[state.recentProactive.length - 1];
    if (lastProactive) {
        const timeSinceLast = Date.now() - new Date(lastProactive.sentAt).getTime();
        if (timeSinceLast < PROACTIVE_COOLDOWN_MS) {
            return { send: false, reason: 'Cooldown period active' };
        }
    }

    // Check time-of-day appropriateness (avoid 23:00 - 07:00)
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 7) {
        return { send: false, reason: 'Outside appropriate hours (07:00-23:00)' };
    }

    return { send: true, reason: 'All checks passed' };
}

// ============================================================================
// Proactive Message Generation
// ============================================================================

async function generateProactiveMessage(
    signal: DetectedSignal,
    _groupFolder: string,
): Promise<string> {
    try {
        const { generate, isGeminiClientAvailable } = await import(
            /* @vite-ignore */ '../../../src/gemini-client.js'
        );
        if (!isGeminiClientAvailable()) return signal.suggestedMessage;

        const result = await generate({
            model: 'gemini-3-flash-preview',
            contents: [
                {
                    role: 'user' as const,
                    parts: [
                        {
                            text: `You are a friendly AI assistant for a group chat. Generate a natural, casual proactive message based on this context:

Signal type: ${signal.type}
Context: ${signal.context}
Suggested approach: ${signal.suggestedMessage}

Requirements:
- Keep it short (1-2 sentences)
- Match casual Chinese conversation style
- Don't be pushy or annoying
- Show genuine helpfulness
- Use the group's language (default: Traditional Chinese)

Output ONLY the message text, no quotes or formatting.`,
                        },
                    ],
                },
            ],
        });

        return result.text?.trim() || signal.suggestedMessage;
    } catch {
        return signal.suggestedMessage;
    }
}

// ============================================================================
// Plugin Definition
// ============================================================================

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let dailyRotateInterval: ReturnType<typeof setInterval> | null = null;
let pluginApiRef: PluginApi | null = null;

const proactiveEnginePlugin: NanoPlugin = {
    id: 'proactive-engine',
    name: 'Proactive Signal Engine',
    version: '0.1.0',
    description: 'Monitors signals and proactively initiates contextually appropriate messages',

    async init(api: PluginApi): Promise<void> {
        pluginApiRef = api;

        // Load persisted state from plugin data directory
        try {
            const fs = await import('fs');
            const statePath = `${api.dataDir}/signal-states.json`;
            if (fs.existsSync(statePath)) {
                const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                for (const [key, value] of Object.entries(data)) {
                    signalStates.set(key, value as SignalState);
                }
                api.logger.info(`Loaded signal states for ${signalStates.size} groups`);
            }
        } catch {
            // First run or corrupted state — start fresh
        }

        api.logger.info('Proactive Signal Engine initialized');
    },

    async start(api: PluginApi): Promise<void> {
        pluginApiRef = api;

        // Subscribe to event bus
        if (api.eventBus) {
            api.eventBus.on('message:received', (payload) => {
                recordMessage(payload.groupFolder, payload.timestamp, payload.chatId);
            });

            api.eventBus.on('task:completed', (payload) => {
                api.logger.debug(`Task completed signal: ${payload.groupFolder}`);
            });
        }

        // Listen for sentiment shift events from group-profiler
        registerSentimentShiftListener(api);

        api.logger.info('Proactive Signal Engine started');
    },

    async stop(api: PluginApi): Promise<void> {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        if (dailyRotateInterval) {
            clearInterval(dailyRotateInterval);
            dailyRotateInterval = null;
        }

        // Persist state
        try {
            const fs = await import('fs');
            const statePath = `${api.dataDir}/signal-states.json`;
            fs.mkdirSync(api.dataDir, { recursive: true });
            const data: Record<string, SignalState> = {};
            for (const [key, value] of signalStates) {
                data[key] = value;
            }
            fs.writeFileSync(statePath, JSON.stringify(data, null, 2));
        } catch {
            // Best-effort persistence
        }

        signalStates.clear();
        pluginApiRef = null;
        api.logger.info('Proactive Signal Engine stopped');
    },

    // --------------------------------------------------------------------------
    // Background Service: Signal monitoring loop
    // --------------------------------------------------------------------------
    services: [
        {
            name: 'signal-monitor',
            async start(api: PluginApi): Promise<void> {
                // Signal monitoring loop
                monitorInterval = setInterval(async () => {
                    cleanRecentProactive();
                    processExpiredObservationWindows(api);

                    const groups = api.getGroups();
                    for (const group of Object.values(groups)) {
                        try {
                            const state = getOrCreateState(group.folder);
                            const signals: DetectedSignal[] = [];

                            // Detect all signal types
                            const activitySignal = detectActivityAnomaly(group.folder);
                            if (activitySignal) signals.push(activitySignal);

                            const taskSignal = await detectTaskDeadlines(group.folder, api);
                            if (taskSignal) signals.push(taskSignal);

                            const calendarSignal = await detectCalendarEvents(group.folder, api);
                            if (calendarSignal) signals.push(calendarSignal);

                            const commitmentSignal = await detectCommitmentReminders(group.folder, api);
                            if (commitmentSignal) signals.push(commitmentSignal);

                            const sentimentSignal = detectSentimentShift(group.folder);
                            if (sentimentSignal) signals.push(sentimentSignal);

                            // Process strongest signal
                            if (signals.length === 0) continue;
                            signals.sort((a, b) => b.confidence - a.confidence);
                            const topSignal = signals[0];

                            // Emit detection event
                            const decision = shouldSendProactive(state, topSignal);

                            if (api.eventBus) {
                                api.eventBus.emit('proactive:signal-detected', {
                                    groupFolder: group.folder,
                                    signalType: topSignal.type,
                                    confidence: topSignal.confidence,
                                    suppressed: !decision.send,
                                });
                            }

                            if (!decision.send) {
                                api.logger.debug(
                                    `Signal suppressed for ${group.folder}: ${decision.reason}`,
                                );
                                continue;
                            }

                            // Generate and send proactive message
                            const message = await generateProactiveMessage(
                                topSignal,
                                group.folder,
                            );

                            // Find the chat JID for this group
                            const db = api.getDatabase() as import('better-sqlite3').Database;
                            const chat = db
                                .prepare(
                                    'SELECT jid FROM chats WHERE jid IN (SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE ?) LIMIT 1',
                                )
                                .get(`%`) as { jid: string } | undefined;

                            if (chat) {
                                await api.sendMessage(chat.jid, message);

                                const sentAt = new Date().toISOString();
                                state.recentProactive.push({
                                    type: topSignal.type,
                                    sentAt,
                                });

                                // Start 30-min observation window for feedback tracking
                                startObservationWindow(group.folder, topSignal.type, chat.jid);

                                if (api.eventBus) {
                                    api.eventBus.emit('proactive:message-sent', {
                                        groupFolder: group.folder,
                                        signalType: topSignal.type,
                                        message,
                                    });
                                }

                                api.logger.info(
                                    `Proactive message sent to ${group.folder}: [${topSignal.type}] confidence=${topSignal.confidence.toFixed(2)}`,
                                );
                            }
                        } catch (err) {
                            api.logger.warn(
                                `Signal processing failed for ${group.folder}: ${err instanceof Error ? err.message : String(err)}`,
                            );
                        }
                    }
                }, CHECK_INTERVAL_MS);

                // Daily count rotation (at midnight)
                const msUntilMidnight = (() => {
                    const now = new Date();
                    const midnight = new Date(now);
                    midnight.setHours(24, 0, 0, 0);
                    return midnight.getTime() - now.getTime();
                })();

                setTimeout(() => {
                    rotateDailyCounts();
                    // Then rotate every 24h
                    dailyRotateInterval = setInterval(
                        rotateDailyCounts,
                        24 * 60 * 60 * 1000,
                    );
                }, msUntilMidnight);
            },
            async stop(): Promise<void> {
                if (monitorInterval) {
                    clearInterval(monitorInterval);
                    monitorInterval = null;
                }
                if (dailyRotateInterval) {
                    clearInterval(dailyRotateInterval);
                    dailyRotateInterval = null;
                }
            },
        } satisfies ServiceContribution,
    ],

    // --------------------------------------------------------------------------
    // Message Hook: Update signal state on each message
    // --------------------------------------------------------------------------
    hooks: {
        async afterMessage(
            context: MessageHookContext & { reply: string },
        ): Promise<void> {
            recordMessage(context.groupFolder, context.timestamp, context.chatJid);

            // Check if this message closes an observation window
            const window = observationWindows.get(context.groupFolder);
            if (window && pluginApiRef) {
                const responseTimeMs = Date.now() - window.sentAt;
                if (responseTimeMs <= OBSERVATION_WINDOW_MS) {
                    const score = scoreResponse(responseTimeMs);
                    recordFeedback(
                        context.groupFolder,
                        window.signalType,
                        score,
                        responseTimeMs,
                        pluginApiRef,
                    );
                    observationWindows.delete(context.groupFolder);
                }
            }
        },
    },

    // --------------------------------------------------------------------------
    // Gemini Tool: Configure proactive behavior
    // --------------------------------------------------------------------------
    geminiTools: [
        {
            name: 'configure_proactive',
            description:
                'Configure proactive message settings. Use when the user wants to adjust how often or when the bot sends proactive messages.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    enabled: {
                        type: 'BOOLEAN',
                        description: 'Enable or disable proactive messages',
                    },
                    confidence_threshold: {
                        type: 'NUMBER',
                        description:
                            'Minimum confidence (0.0-1.0) to send a proactive message. Lower = more frequent. Default: 0.7',
                    },
                    max_per_day: {
                        type: 'NUMBER',
                        description: 'Maximum proactive messages per day (1-10). Default: 3',
                    },
                },
                required: [],
            },
            permission: 'any',
            metadata: {
                requiresExplicitIntent: true,
                dangerLevel: 'moderate',
            },

            async execute(
                args: Record<string, unknown>,
                context: ToolExecutionContext,
            ): Promise<string> {
                const state = getOrCreateState(context.groupFolder);
                const changes: string[] = [];

                if (typeof args.enabled === 'boolean') {
                    state.enabled = args.enabled;
                    changes.push(`enabled: ${args.enabled}`);
                }

                if (typeof args.confidence_threshold === 'number') {
                    const threshold = Math.max(0, Math.min(1, args.confidence_threshold));
                    state.confidenceThreshold = threshold;
                    changes.push(`confidence threshold: ${threshold}`);
                }

                if (typeof args.max_per_day === 'number') {
                    const max = Math.max(1, Math.min(10, Math.round(args.max_per_day)));
                    state.maxPerDay = max;
                    changes.push(`max per day: ${max}`);
                }

                if (changes.length === 0) {
                    return JSON.stringify({
                        success: true,
                        message: 'Current settings',
                        settings: {
                            enabled: state.enabled,
                            confidenceThreshold: state.confidenceThreshold,
                            maxPerDay: state.maxPerDay,
                            recentProactiveCount: state.recentProactive.length,
                        },
                    });
                }

                return JSON.stringify({
                    success: true,
                    message: `Proactive settings updated: ${changes.join(', ')}`,
                    settings: {
                        enabled: state.enabled,
                        confidenceThreshold: state.confidenceThreshold,
                        maxPerDay: state.maxPerDay,
                    },
                });
            },
        } satisfies GeminiToolContribution,
    ],
};

export default proactiveEnginePlugin;
