export type Language =
  | 'en'
  | 'zh-TW'
  | 'zh-CN'
  | 'es'
  | 'ja'
  | 'ko'
  | 'pt'
  | 'ru';

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  'en',
  'zh-TW',
  'zh-CN',
  'es',
  'ja',
  'ko',
  'pt',
  'ru',
] as const;

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  es: 'Español',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский',
};

/**
 * Map a browser/navigator language string to the nearest supported Language.
 * Falls back to 'en' if no match is found.
 */
export function detectLanguage(browserLang: string): Language {
  const lang = browserLang.toLowerCase();

  if (lang.startsWith('zh-tw') || lang.startsWith('zh-hant')) return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('es')) return 'es';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('ko')) return 'ko';
  if (lang.startsWith('pt')) return 'pt';
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('en')) return 'en';

  return 'en';
}
