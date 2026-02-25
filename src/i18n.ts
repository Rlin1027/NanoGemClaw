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

  // STT Enhancement
  stt_transcribed: string;
  stt_too_long: string;
  stt_error: string;

  // Onboarding
  onboarding_welcome: (name: string) => string;
  onboarding_features: string;
  onboarding_try_it: string;
  onboarding_skip: string;
  onboarding_done: string;
  onboarding_demo: string;

  // Bot status and system messages
  botConnected: string;
  botRunning: (username: string, groupCount: number) => string;
  maintenanceMode: string;
  settingToggled: (setting: string, value: string) => string;
  unknownAction: (action: string) => string;
  retryFailed: string;
  feedbackPrompt: string;
  adminCommandFailed: string;
  ipcWatcherStarted: string;

  // Progress indicators
  searching: string;
  readingFile: string;
  writingFile: string;
  generatingImage: string;
  executingCode: string;
  usingTool: (toolName: string) => string;
  responding: string;
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

    stt_transcribed: '語音轉寫',
    stt_too_long: '語音訊息超過 5 分鐘，請改用文字訊息',
    stt_error: '語音轉寫失敗，請改用文字訊息',

    onboarding_welcome: (name) => `歡迎使用 ${name}！我是你的 AI 助手。`,
    onboarding_features:
      '以下是我能幫你做的事：\n• 回答問題和聊天\n• 搜尋網路資訊\n• 語音轉文字\n• 排程任務\n\n想試試看嗎？',
    onboarding_try_it: '試試看',
    onboarding_skip: '跳過',
    onboarding_done: '設定完成！直接傳訊息給我就可以開始了。',
    onboarding_demo:
      '好的！試著問我任何問題，例如「今天天氣如何？」或「幫我寫一封信」',

    botConnected: 'Telegram bot 已連接',
    botRunning: (username, groupCount) =>
      `NanoGemClaw 運行中 (@${username})\n已註冊群組: ${groupCount}`,
    maintenanceMode: '⚙️ 系統維護中，請稍後再試。',
    settingToggled: (setting, value) => `已切換設定: ${setting} = ${value}`,
    unknownAction: (action) => `處理中: ${action}...`,
    retryFailed: '重試失敗：找不到原始訊息',
    feedbackPrompt: '您對這個回復滿意嗎？',
    adminCommandFailed: '❌ 管理員指令失敗，請查看日誌。',
    ipcWatcherStarted: 'IPC 監視器已啟動',

    searching: '🔍 正在搜尋網路...',
    readingFile: '📄 正在讀取檔案...',
    writingFile: '✍️ 正在寫入...',
    generatingImage: '🎨 正在生成圖片...',
    executingCode: '⚙️ 正在執行程式...',
    usingTool: (toolName) => `🔧 使用工具: ${toolName}...`,
    responding: '💬 回應中...',
  },
  en: {
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
    willImprove: "👎 Got it, I'll improve!",

    processing: 'Processing',
    downloadingMedia: 'Downloading media',
    transcribing: 'Transcribing audio',
    thinking: 'Thinking',
    retry: 'Retry',
    feedback: 'Feedback',
    errorOccurred: 'An error occurred. Please try again.',

    stt_transcribed: 'Voice transcribed',
    stt_too_long: 'Voice message exceeds 5 minutes, please use text',
    stt_error: 'Voice transcription failed, please use text',

    onboarding_welcome: (name) => `Welcome to ${name}! I'm your AI assistant.`,
    onboarding_features:
      "Here's what I can do:\n• Answer questions and chat\n• Search the web\n• Voice to text\n• Schedule tasks\n\nWant to try?",
    onboarding_try_it: 'Try it',
    onboarding_skip: 'Skip',
    onboarding_done: 'Setup complete! Just send me a message to get started.',
    onboarding_demo:
      "Great! Try asking me anything, like 'How's the weather?' or 'Help me write a letter'",

    botConnected: 'Telegram bot connected',
    botRunning: (username, groupCount) =>
      `NanoGemClaw running (@${username})\nRegistered groups: ${groupCount}`,
    maintenanceMode:
      '⚙️ System maintenance in progress, please try again later.',
    settingToggled: (setting, value) =>
      `Setting toggled: ${setting} = ${value}`,
    unknownAction: (action) => `Processing: ${action}...`,
    retryFailed: 'Retry failed: original message not found',
    feedbackPrompt: 'Are you satisfied with this response?',
    adminCommandFailed: '❌ Admin command failed. Check logs for details.',
    ipcWatcherStarted: 'IPC watcher started',

    searching: '🔍 Searching the web...',
    readingFile: '📄 Reading file...',
    writingFile: '✍️ Writing...',
    generatingImage: '🎨 Generating image...',
    executingCode: '⚙️ Executing code...',
    usingTool: (toolName) => `🔧 Using tool: ${toolName}...`,
    responding: '💬 Responding...',
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

/**
 * Get language for a specific group based on current global language.
 * In the future, this could be extended to support per-group language preferences.
 */
export function getGroupLang(groupFolder: string): Language {
  // For now, use global language. Can be extended later.
  return currentLanguage;
}

export const availableLanguages: Language[] = ['zh-TW', 'en'];
