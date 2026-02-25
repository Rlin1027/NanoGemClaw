/**
 * Manual mock for react-i18next.
 *
 * Loads the real English locale JSON files so that t() resolves keys to their
 * actual English translations. Tests can therefore assert on human-readable
 * strings like "Enter Access Code" instead of raw i18n keys.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_EN_DIR = join(__dirname, '../src/i18n/locales/en');

const enTranslations: Record<string, Record<string, string>> = {};
if (existsSync(LOCALES_EN_DIR)) {
    for (const file of readdirSync(LOCALES_EN_DIR)) {
        if (file.endsWith('.json')) {
            const ns = file.replace('.json', '');
            enTranslations[ns] = JSON.parse(readFileSync(join(LOCALES_EN_DIR, file), 'utf-8'));
        }
    }
}

function resolveKey(ns: string, key: string): string {
    const dict = enTranslations[ns];
    if (dict && dict[key] !== undefined) return dict[key];
    // fallback: search all namespaces
    for (const translations of Object.values(enTranslations)) {
        if (translations[key] !== undefined) return translations[key];
    }
    return key;
}

export const useTranslation = (ns: string = 'common') => ({
    t: (key: string, _opts?: Record<string, unknown>) => resolveKey(ns, key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
});

export const Trans = ({ children }: { children: React.ReactNode }) => children;

export const initReactI18next = { type: '3rdParty', init: vi.fn() };
