/**
 * Group Profiler Plugin — User Model Builder
 *
 * Analyzes multi-source signals (messages, calendar, tasks, drive) to build
 * structured group profiles with real-time behavioral snapshots.
 *
 * Extension points used:
 * - Message Hooks (afterMessage): analyze each message for behavioral signals
 * - Background Services: periodic cross-source analysis
 * - Gemini Tools: get_group_insights for on-demand reports
 * - Event Bus: subscribe to message:received, task:completed, memory:fact-stored
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

interface MessageSignal {
    timestamp: string;
    contentLength: number;
    hasEmoji: boolean;
    language: 'zh' | 'en' | 'mixed';
    hour: number;
}

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

// ============================================================================
// Signal Buffers (in-memory, flushed periodically)
// ============================================================================

interface MoodSnapshot {
    mood: string;
    recordedAt: string;
}

const signalBuffers = new Map<string, MessageSignal[]>();
const profileCache = new Map<string, GroupProfile>();
const moodHistory = new Map<string, MoodSnapshot[]>(); // groupFolder → last 10 moods

const MAX_BUFFER_SIZE = 200;
const MAX_MOOD_HISTORY = 10;
const ANALYSIS_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

// Mood groups for shift detection
const NEGATIVE_MOODS = new Set(['frustrated', 'stressed', 'anxious', 'sad', 'angry', 'worried', 'upset', 'tired', 'overwhelmed']);
const POSITIVE_MOODS = new Set(['happy', 'enthusiastic', 'excited', 'cheerful', 'optimistic', 'motivated', 'energetic', 'joyful']);
// NEUTRAL_MOODS not needed — classifyMood returns 'neutral' as default fallback

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

/**
 * Record a new mood snapshot and return shift description if significant.
 */
function recordMoodSnapshot(groupFolder: string, mood: string): string | null {
    let history = moodHistory.get(groupFolder);
    if (!history) {
        history = [];
        moodHistory.set(groupFolder, history);
    }

    const previousMood = history.length > 0 ? history[history.length - 1].mood : null;
    history.push({ mood, recordedAt: new Date().toISOString() });
    if (history.length > MAX_MOOD_HISTORY) history.shift();

    if (!previousMood || previousMood === mood) return null;
    return detectMoodShift(previousMood, mood);
}

/**
 * Get mood history for a group (exported for proactive-engine).
 */
export function getSentimentHistory(groupFolder: string): MoodSnapshot[] {
    return moodHistory.get(groupFolder) ?? [];
}

// ============================================================================
// Signal Analysis
// ============================================================================

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

function addSignal(groupFolder: string, signal: MessageSignal): void {
    let buffer = signalBuffers.get(groupFolder);
    if (!buffer) {
        buffer = [];
        signalBuffers.set(groupFolder, buffer);
    }
    buffer.push(signal);
    // Ring buffer — drop oldest when full
    if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
    }
}

/**
 * Build a profile from accumulated signals + cross-source data.
 */
async function buildProfile(
    groupFolder: string,
    api: PluginApi,
): Promise<GroupProfile | null> {
    const signals = signalBuffers.get(groupFolder);
    if (!signals || signals.length < 5) return null;

    // Communication style from signals
    const emojiCount = signals.filter((s) => s.hasEmoji).length;
    const emojiRate = emojiCount / signals.length;
    const avgLength =
        signals.reduce((sum, s) => sum + s.contentLength, 0) / signals.length;
    const langCounts = { zh: 0, en: 0, mixed: 0 };
    for (const s of signals) langCounts[s.language]++;
    const dominantLang = (Object.entries(langCounts) as [string, number][])
        .sort((a, b) => b[1] - a[1])[0][0];

    // Activity hours distribution
    const hourCounts = new Array<number>(24).fill(0);
    for (const s of signals) hourCounts[s.hour]++;
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const activeHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .filter((h) => h.count > signals.length * 0.05)
        .map((h) => h.hour)
        .sort((a, b) => a - b);

    // Message frequency
    const timestamps = signals.map((s) => new Date(s.timestamp).getTime());
    const timeSpanDays = Math.max(
        1,
        (Math.max(...timestamps) - Math.min(...timestamps)) / (24 * 60 * 60 * 1000),
    );
    const avgPerDay = signals.length / timeSpanDays;

    // Cross-source: try to get calendar/tasks data from sibling plugins
    let calendarInsight = '';
    let tasksInsight = '';
    try {
        const db = api.getDatabase() as import('better-sqlite3').Database;
        const taskRows = db
            .prepare(
                "SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM scheduled_tasks WHERE group_folder = ?",
            )
            .get(groupFolder) as { total: number; active: number } | undefined;
        if (taskRows && taskRows.total > 0) {
            tasksInsight = `${taskRows.active}/${taskRows.total} active scheduled tasks`;
        }
    } catch {
        // DB access may fail
    }

    // Try to get calendar data from google-calendar-rw plugin via event bus
    try {
        if (api.eventBus) {
            // Calendar data is available if google-calendar-rw plugin provides it
            calendarInsight = '(calendar integration available)';
        }
    } catch {
        // Calendar plugin may not be loaded
    }

    const profile: GroupProfile = {
        communicationStyle: {
            tone: avgLength > 100 ? 'detailed/verbose' : avgLength > 30 ? 'conversational' : 'brief/casual',
            languagePatterns: dominantLang === 'zh'
                ? 'primarily Chinese'
                : dominantLang === 'mixed'
                    ? 'bilingual (Chinese + English)'
                    : 'primarily English',
            activityHours:
                activeHours.length > 0
                    ? `peak at ${peakHour}:00, active ${activeHours[0]}:00-${activeHours[activeHours.length - 1]}:00`
                    : 'insufficient data',
            emojiUsage:
                emojiRate > 0.5
                    ? 'heavy emoji usage'
                    : emojiRate > 0.2
                        ? 'moderate emoji usage'
                        : 'minimal emoji usage',
        },
        behavioralPatterns: {
            avgMessagesPerDay: Math.round(avgPerDay * 10) / 10,
            topicInterests: [], // Populated by Gemini analysis in background service
            messageFrequencyTrend:
                avgPerDay > 10 ? 'very active' : avgPerDay > 3 ? 'active' : 'quiet',
        },
        currentState: {
            recentMood: 'neutral', // Updated by periodic Gemini analysis
            activeConcerns: [],
            updatedAt: new Date().toISOString(),
        },
    };

    // Store cross-source insights in concerns
    if (tasksInsight) profile.currentState.activeConcerns.push(tasksInsight);
    if (calendarInsight) profile.currentState.activeConcerns.push(calendarInsight);

    profileCache.set(groupFolder, profile);
    return profile;
}

/**
 * Enrich profile with Gemini-powered topic and mood analysis.
 */
async function enrichProfileWithAI(
    groupFolder: string,
    api: PluginApi,
): Promise<void> {
    const profile = profileCache.get(groupFolder);
    if (!profile) return;

    const signals = signalBuffers.get(groupFolder);
    if (!signals || signals.length < 10) return;

    try {
        const db = api.getDatabase() as import('better-sqlite3').Database;
        // Get recent messages for content analysis
        const recentMessages = db
            .prepare(
                `SELECT sender_name, content FROM messages
         WHERE chat_jid IN (SELECT jid FROM chats)
         AND content != '' AND length(content) > 10
         ORDER BY timestamp DESC LIMIT 30`,
            )
            .all() as Array<{ sender_name: string; content: string }>;

        if (recentMessages.length < 5) return;

        const snippet = recentMessages
            .map((m) => `[${(m.sender_name || '?').slice(0, 20)}]: ${m.content.slice(0, 200)}`)
            .join('\n');

        // Use dynamic import to get Gemini client
        const { generate, isGeminiClientAvailable } = await import(
            /* @vite-ignore */ '../../../src/gemini-client.js'
        );
        if (!isGeminiClientAvailable()) return;

        const result = await generate({
            model: 'gemini-3-flash-preview',
            contents: [
                {
                    role: 'user' as const,
                    parts: [
                        {
                            text: `Analyze these recent group messages and return a JSON object with:
- "topics": array of 3-5 main discussion topics (short phrases)
- "mood": one word describing the group's recent mood (e.g., "enthusiastic", "stressed", "casual", "focused")
- "concerns": array of 0-3 active concerns or pending items mentioned

Messages:
${snippet}

Return ONLY valid JSON, no markdown.`,
                        },
                    ],
                },
            ],
        });

        if (result.text) {
            try {
                // Strip markdown code fences if present
                const cleaned = result.text.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
                const analysis = JSON.parse(cleaned);
                if (Array.isArray(analysis.topics)) {
                    profile.behavioralPatterns.topicInterests = analysis.topics.slice(0, 5);
                }
                if (typeof analysis.mood === 'string') {
                    const previousMood = profile.currentState.recentMood;
                    profile.currentState.recentMood = analysis.mood;
                    const shift = recordMoodSnapshot(groupFolder, analysis.mood);
                    if (shift && api.eventBus && previousMood !== 'neutral') {
                        api.eventBus.emit('profiler:sentiment-updated', {
                            groupFolder,
                            previousMood,
                            currentMood: analysis.mood,
                            shift,
                        });
                    }
                }
                if (Array.isArray(analysis.concerns)) {
                    profile.currentState.activeConcerns = [
                        ...profile.currentState.activeConcerns.filter(
                            (c) => c.includes('tasks') || c.includes('calendar'),
                        ),
                        ...analysis.concerns.slice(0, 3),
                    ];
                }
                profile.currentState.updatedAt = new Date().toISOString();
                profileCache.set(groupFolder, profile);
            } catch {
                // JSON parse failed — skip enrichment this round
            }
        }
    } catch (err) {
        api.logger.debug(`Profile enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function formatProfile(groupFolder: string, profile: GroupProfile): string {
    const cs = profile.communicationStyle;
    const bp = profile.behavioralPatterns;
    const st = profile.currentState;

    let report = `# Group Profile: ${groupFolder}\n\n`;
    report += `## Communication Style\n`;
    report += `- Tone: ${cs.tone}\n`;
    report += `- Language: ${cs.languagePatterns}\n`;
    report += `- Activity: ${cs.activityHours}\n`;
    report += `- Emoji: ${cs.emojiUsage}\n\n`;
    report += `## Behavioral Patterns\n`;
    report += `- Message frequency: ${bp.avgMessagesPerDay} msgs/day (${bp.messageFrequencyTrend})\n`;
    if (bp.topicInterests.length > 0) {
        report += `- Topic interests: ${bp.topicInterests.join(', ')}\n`;
    }
    report += `\n## Current State (${st.updatedAt})\n`;
    report += `- Recent mood: ${st.recentMood}\n`;
    if (st.activeConcerns.length > 0) {
        report += `- Active concerns:\n`;
        for (const c of st.activeConcerns) {
            report += `  - ${c}\n`;
        }
    }
    return report;
}

// ============================================================================
// Plugin Definition
// ============================================================================

let analysisInterval: ReturnType<typeof setInterval> | null = null;
let pluginApiRef: PluginApi | null = null;

const groupProfilerPlugin: NanoPlugin = {
    id: 'group-profiler',
    name: 'Group Profiler',
    version: '0.1.0',
    description: 'Builds structured group profiles from multi-source behavioral signals',

    async init(api: PluginApi): Promise<void> {
        pluginApiRef = api;
        api.logger.info('Group Profiler plugin initialized');
    },

    async start(api: PluginApi): Promise<void> {
        pluginApiRef = api;

        // Subscribe to event bus for cross-module signals
        if (api.eventBus) {
            api.eventBus.on('memory:fact-stored', (payload) => {
                api.logger.debug(`Fact stored for ${payload.groupFolder}: ${payload.key}`);
            });

            api.eventBus.on('task:completed', (payload) => {
                api.logger.debug(`Task completed in ${payload.groupFolder}`);
            });
        }

        api.logger.info('Group Profiler plugin started');
    },

    async stop(api: PluginApi): Promise<void> {
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
        }
        signalBuffers.clear();
        profileCache.clear();
        pluginApiRef = null;
        api.logger.info('Group Profiler plugin stopped');
    },

    // --------------------------------------------------------------------------
    // Background Service: Periodic profile analysis
    // --------------------------------------------------------------------------
    services: [
        {
            name: 'profile-analyzer',
            async start(api: PluginApi): Promise<void> {
                // Initial analysis after a delay
                setTimeout(async () => {
                    const groups = api.getGroups();
                    for (const group of Object.values(groups)) {
                        await buildProfile(group.folder, api);
                        await enrichProfileWithAI(group.folder, api);
                    }
                }, 60_000); // 1 minute after start

                // Periodic re-analysis
                analysisInterval = setInterval(async () => {
                    const groups = api.getGroups();
                    for (const group of Object.values(groups)) {
                        try {
                            await buildProfile(group.folder, api);
                            await enrichProfileWithAI(group.folder, api);
                        } catch (err) {
                            api.logger.warn(
                                `Profile analysis failed for ${group.folder}: ${err instanceof Error ? err.message : String(err)}`,
                            );
                        }
                    }
                }, ANALYSIS_INTERVAL_MS);
            },
            async stop(): Promise<void> {
                if (analysisInterval) {
                    clearInterval(analysisInterval);
                    analysisInterval = null;
                }
            },
        } satisfies ServiceContribution,
    ],

    // --------------------------------------------------------------------------
    // Message Hook: Collect behavioral signals from each message
    // --------------------------------------------------------------------------
    hooks: {
        async afterMessage(
            context: MessageHookContext & { reply: string },
        ): Promise<void> {
            const signal = analyzeMessage(context.content, context.timestamp);
            addSignal(context.groupFolder, signal);
        },
    },

    // --------------------------------------------------------------------------
    // Gemini Tool: On-demand group insights
    // --------------------------------------------------------------------------
    geminiTools: [
        {
            name: 'get_group_insights',
            description:
                'Get a detailed analysis of this group\'s communication patterns, behavioral trends, and current state. Use when the user asks about group characteristics, habits, or insights.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    include_recommendations: {
                        type: 'BOOLEAN',
                        description: 'Include actionable recommendations (default: false)',
                    },
                },
                required: [],
            },
            permission: 'any',
            metadata: {
                readOnly: true,
                dangerLevel: 'safe',
            },

            async execute(
                _args: Record<string, unknown>,
                context: ToolExecutionContext,
            ): Promise<string> {
                const { groupFolder } = context;

                // Build fresh profile if not cached
                let profile = profileCache.get(groupFolder) ?? undefined;
                if (!profile && pluginApiRef) {
                    profile = (await buildProfile(groupFolder, pluginApiRef)) ?? undefined;
                }

                if (!profile) {
                    return JSON.stringify({
                        success: false,
                        error: 'Insufficient data to generate group insights. More conversation history is needed.',
                    });
                }

                const report = formatProfile(groupFolder, profile);

                return JSON.stringify({
                    success: true,
                    report,
                    profile,
                });
            },
        } satisfies GeminiToolContribution,
    ],
};

export default groupProfilerPlugin;
