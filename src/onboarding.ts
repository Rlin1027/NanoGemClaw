/**
 * User Onboarding Module
 *
 * Provides welcome flow for new users with feature showcase and interactive demo.
 */

import { getUserPreference, setUserPreference } from './db.js';
import {
  sendMessage,
  sendMessageWithButtons,
  QuickReplyButton,
} from './telegram-helpers.js';
import { tf, getGroupLang } from './i18n/index.js';

const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

/**
 * Check if a group needs onboarding. Returns true if onboarding was triggered.
 */
export async function checkAndStartOnboarding(
  chatId: string,
  groupFolder: string,
  groupName: string,
  messageThreadId?: number | null,
): Promise<boolean> {
  // Check if already onboarded
  const completed = getUserPreference(chatId, ONBOARDING_COMPLETE_KEY);
  if (completed === 'true') return false;

  const lang = getGroupLang(groupFolder);

  // Step 1: Welcome message
  await sendMessage(
    chatId,
    tf('onboarding_welcome', { name: groupName }, lang),
    messageThreadId,
  );

  // Step 2: Feature showcase with buttons
  const buttons: QuickReplyButton[][] = [
    [
      {
        text: tf('onboarding_try_it', undefined, lang),
        callbackData: 'onboard_demo',
      },
      {
        text: tf('onboarding_skip', undefined, lang),
        callbackData: 'onboard_skip',
      },
    ],
  ];
  await sendMessageWithButtons(
    chatId,
    tf('onboarding_features', undefined, lang),
    buttons,
    messageThreadId,
  );

  return true;
}

/**
 * Handle onboarding callback from inline keyboard
 */
export async function handleOnboardingCallback(
  chatId: string,
  groupFolder: string,
  action: string,
  messageThreadId?: number | null,
): Promise<boolean> {
  if (!action.startsWith('onboard_')) return false;

  const lang = getGroupLang(groupFolder);

  if (action === 'onboard_skip' || action === 'onboard_complete') {
    setUserPreference(chatId, ONBOARDING_COMPLETE_KEY, 'true');
    await sendMessage(
      chatId,
      tf('onboarding_done', undefined, lang),
      messageThreadId,
    );
    return true;
  }

  if (action === 'onboard_demo') {
    await sendMessage(
      chatId,
      tf('onboarding_demo', undefined, lang),
      messageThreadId,
    );
    // Mark as complete after demo
    setUserPreference(chatId, ONBOARDING_COMPLETE_KEY, 'true');
    return true;
  }

  return false;
}
