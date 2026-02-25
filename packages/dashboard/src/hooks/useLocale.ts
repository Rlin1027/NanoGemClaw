import { useTranslation } from 'react-i18next';

const LANGUAGE_TO_LOCALE: Record<string, string> = {
    en: 'en-US',
    'zh-TW': 'zh-TW',
    'zh-CN': 'zh-CN',
    es: 'es-ES',
    ja: 'ja-JP',
    ko: 'ko-KR',
    pt: 'pt-BR',
    ru: 'ru-RU',
};

export function useLocale(): string {
    const { i18n } = useTranslation();
    return LANGUAGE_TO_LOCALE[i18n.language] ?? 'en-US';
}
