/**
 * Internationalization (i18n) Module
 * 
 * Provides multi-language support for admin commands and system messages.
 */

// ============================================================================
// Types
// ============================================================================

export type Language = 'zh-TW' | 'en';

interface Translations {
    // System messages
    rateLimited: string;
    retryIn: (minutes: number) => string;
    noErrors: string;
    noActiveErrors: string;
    groupsWithErrors: string;
    adminCommandsTitle: string;
    adminOnlyNote: string;

    // Admin commands
    statsTitle: string;
    registeredGroups: string;
    uptime: string;
    memory: string;
    usageAnalytics: string;
    totalRequests: string;
    avgResponseTime: string;
    totalTokens: string;

    // Feedback
    confirmed: string;
    cancelled: string;
    retrying: string;
    thanksFeedback: string;
    willImprove: string;

    // UI Phase 1
    processing: string;
    downloadingMedia: string;
    transcribing: string;
    thinking: string;
    retry: string;
    feedback: string;
    errorOccurred: string;
}

// ============================================================================
// Translations
// ============================================================================

const translations: Record<Language, Translations> = {
    'zh-TW': {
        rateLimited: '⏳ 請求過於頻繁，請稍後再試。',
        retryIn: (min) => `(${min} 分鐘後重試)`,
        noErrors: '✅ **無錯誤**\n\n所有群組運作正常。',
        noActiveErrors: '✅ **目前無錯誤**',
        groupsWithErrors: '⚠️ **有錯誤的群組**',
        adminCommandsTitle: '🛠️ **管理員指令**',
        adminOnlyNote: '_管理員指令僅限主群組使用。_',

        statsTitle: '📊 **NanoGemClaw 統計**',
        registeredGroups: '已註冊群組',
        uptime: '運行時間',
        memory: '記憶體',
        usageAnalytics: '📈 **使用分析**',
        totalRequests: '總請求數',
        avgResponseTime: '平均回應時間',
        totalTokens: 'Token 使用量',

        confirmed: '✅ 已確認',
        cancelled: '❌ 已取消',
        retrying: '🔄 重試中...',
        thanksFeedback: '👍 感謝反饋！',
        willImprove: '👎 收到，我會改進的！',

        processing: '處理中',
        downloadingMedia: '下載媒體中',
        transcribing: '轉錄語音中',
        thinking: '思考中',
        retry: '重試',
        feedback: '反饋',
        errorOccurred: '發生錯誤，請稍後再試。',
    },
    'en': {
        rateLimited: '⏳ Too many requests, please try again later.',
        retryIn: (min) => `(Retry in ${min} minutes)`,
        noErrors: '✅ **No Errors**\n\nAll groups running smoothly.',
        noActiveErrors: '✅ **No Active Errors**',
        groupsWithErrors: '⚠️ **Groups with Errors**',
        adminCommandsTitle: '🛠️ **Admin Commands**',
        adminOnlyNote: '_Admin commands are only available in the main group._',

        statsTitle: '📊 **NanoGemClaw Stats**',
        registeredGroups: 'Registered Groups',
        uptime: 'Uptime',
        memory: 'Memory',
        usageAnalytics: '📈 **Usage Analytics**',
        totalRequests: 'Total Requests',
        avgResponseTime: 'Avg Response Time',
        totalTokens: 'Total Tokens',

        confirmed: '✅ Confirmed',
        cancelled: '❌ Cancelled',
        retrying: '🔄 Retrying...',
        thanksFeedback: '👍 Thanks for the feedback!',
        willImprove: '👎 Got it, I\'ll improve!',

        processing: 'Processing',
        downloadingMedia: 'Downloading media',
        transcribing: 'Transcribing audio',
        thinking: 'Thinking',
        retry: 'Retry',
        feedback: 'Feedback',
        errorOccurred: 'An error occurred. Please try again.',
    },
};

// ============================================================================
// State
// ============================================================================

let currentLanguage: Language = 'zh-TW';

// ============================================================================
// Public API
// ============================================================================

export function setLanguage(lang: Language): void {
    currentLanguage = lang;
}

export function getLanguage(): Language {
    return currentLanguage;
}

export function t(): Translations {
    return translations[currentLanguage];
}

export function getTranslation(lang: Language): Translations {
    return translations[lang];
}

export const availableLanguages: Language[] = ['zh-TW', 'en'];
