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
import { t, getGroupLang } from './i18n.js';

const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

/**
 * Check if a group needs onboarding. Returns true if onboarding was triggered.
 */
export async function checkAndStartOnboarding(
  chatId: string,
  groupFolder: string,
  groupName: string,
): Promise<boolean> {
  // Check if already onboarded
  const completed = getUserPreference(chatId, ONBOARDING_COMPLETE_KEY);
  if (completed === 'true') return false;

  const lang = getGroupLang(groupFolder);
  const translations = t();

  // Step 1: Welcome message
  await sendMessage(chatId, translations.onboarding_welcome(groupName));

  // Step 2: Feature showcase with buttons
  const buttons: QuickReplyButton[][] = [
    [
      { text: translations.onboarding_try_it, callbackData: 'onboard_demo' },
      { text: translations.onboarding_skip, callbackData: 'onboard_skip' },
    ],
  ];
  await sendMessageWithButtons(
    chatId,
    translations.onboarding_features,
    buttons,
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
): Promise<boolean> {
  if (!action.startsWith('onboard_')) return false;

  const lang = getGroupLang(groupFolder);
  const translations = t();

  if (action === 'onboard_skip' || action === 'onboard_complete') {
    setUserPreference(chatId, ONBOARDING_COMPLETE_KEY, 'true');
    await sendMessage(chatId, translations.onboarding_done);
    return true;
  }

  if (action === 'onboard_demo') {
    await sendMessage(chatId, translations.onboarding_demo);
    // Mark as complete after demo
    setUserPreference(chatId, ONBOARDING_COMPLETE_KEY, 'true');
    return true;
  }

  return false;
}
