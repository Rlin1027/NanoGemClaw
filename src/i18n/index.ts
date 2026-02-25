/**
 * Internationalization (i18n) Module
 *
 * Provides multi-language support for admin commands and system messages.
 * Loads translations from JSON locale files.
 */
import { createRequire } from 'module';

import { type Language, SUPPORTED_LANGUAGES } from '@nanogemclaw/core';

export type { Language } from '@nanogemclaw/core';
export {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  detectLanguage,
} from '@nanogemclaw/core';

// ============================================================================
// Types
// ============================================================================

export type TranslationRecord = Record<string, string>;

// ============================================================================
// Locale loading
// ============================================================================

const _require = createRequire(import.meta.url);

function loadLocale(lang: Language): TranslationRecord {
  try {
    return _require(`./locales/${lang}.json`) as TranslationRecord;
  } catch {
    // Fallback to English if locale file missing
    return _require(`./locales/en.json`) as TranslationRecord;
  }
}

const localeCache: Partial<Record<Language, TranslationRecord>> = {};

function getLocale(lang: Language): TranslationRecord {
  if (!localeCache[lang]) {
    localeCache[lang] = loadLocale(lang);
  }
  return localeCache[lang]!;
}

// ============================================================================
// Interpolation
// ============================================================================

/**
 * Replace {key} placeholders in a template string with values from params.
 */
export function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

// ============================================================================
// State
// ============================================================================

let currentLanguage: Language = 'zh-TW';

// Per-group language overrides: groupFolder -> Language
const groupLangMap: Map<string, Language> = new Map();

// ============================================================================
// Public API
// ============================================================================

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
}

export function getLanguage(): Language {
  return currentLanguage;
}

/**
 * Returns the full translation record for the current (or given) language.
 * Backward-compatible with old t() callers.
 */
export function t(lang?: Language): TranslationRecord {
  return getLocale(lang ?? currentLanguage);
}

/**
 * Get a single translated string with parameter interpolation.
 * tf('retryIn', { minutes: 5 }) => "Retry in 5 minutes"
 */
export function tf(
  key: string,
  params?: Record<string, string | number>,
  lang?: Language,
): string {
  const locale = getLocale(lang ?? currentLanguage);
  const template = locale[key] ?? key;
  if (!params) return template;
  return interpolate(template, params);
}

/**
 * Get the effective language for a group.
 * Uses per-group override if set, otherwise falls back to global language.
 */
export function getGroupLang(groupFolder: string): Language {
  return groupLangMap.get(groupFolder) ?? currentLanguage;
}

/**
 * Set the language for a specific group.
 */
export function setGroupLang(groupFolder: string, lang: Language): void {
  groupLangMap.set(groupFolder, lang);
}

/**
 * Load the group language from a stored preference value.
 * Returns the resolved Language.
 */
export function loadGroupLang(
  groupFolder: string,
  prefValue: string | null | undefined,
): Language {
  if (
    prefValue &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(prefValue)
  ) {
    const lang = prefValue as Language;
    groupLangMap.set(groupFolder, lang);
    return lang;
  }
  return currentLanguage;
}

export const availableLanguages: Language[] = [...SUPPORTED_LANGUAGES];

/**
 * @deprecated Use tf(key, params) for parameterized translations.
 * This alias is kept for backward compatibility.
 */
export function getTranslation(lang: Language): TranslationRecord {
  return getLocale(lang);
}
