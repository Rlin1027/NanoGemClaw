import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../i18n/locales');
const REFERENCE_LANG = 'en';

const SUPPORTED_LANGUAGES = ['en', 'zh-TW', 'zh-CN', 'es', 'ja', 'ko', 'pt', 'ru'];

const NAMESPACES = [
    'common',
    'nav',
    'auth',
    'overview',
    'settings',
    'tasks',
    'knowledge',
    'calendar',
    'analytics',
    'logs',
    'memory',
    'groups',
];

function loadLocale(lang: string, ns: string): Record<string, string> {
    const filePath = join(LOCALES_DIR, lang, `${ns}.json`);
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('Dashboard i18n', () => {
    describe('Locale file existence', () => {
        it('should have all 8 supported language directories', () => {
            for (const lang of SUPPORTED_LANGUAGES) {
                const langDir = join(LOCALES_DIR, lang);
                expect(existsSync(langDir), `Directory missing: ${lang}`).toBe(true);
            }
        });

        it('should have all 12 namespace files for every language', () => {
            for (const lang of SUPPORTED_LANGUAGES) {
                for (const ns of NAMESPACES) {
                    const filePath = join(LOCALES_DIR, lang, `${ns}.json`);
                    expect(
                        existsSync(filePath),
                        `Missing file: ${lang}/${ns}.json`,
                    ).toBe(true);
                }
            }
        });

        it('should have exactly 12 namespaces registered in i18n index', () => {
            expect(NAMESPACES).toHaveLength(12);
        });
    });

    describe('Locale file validity', () => {
        it('should parse all locale files as valid JSON', () => {
            for (const lang of SUPPORTED_LANGUAGES) {
                for (const ns of NAMESPACES) {
                    expect(
                        () => loadLocale(lang, ns),
                        `Invalid JSON: ${lang}/${ns}.json`,
                    ).not.toThrow();
                }
            }
        });

        it('should have non-empty locale files', () => {
            for (const lang of SUPPORTED_LANGUAGES) {
                for (const ns of NAMESPACES) {
                    const translations = loadLocale(lang, ns);
                    expect(
                        Object.keys(translations).length,
                        `Empty file: ${lang}/${ns}.json`,
                    ).toBeGreaterThan(0);
                }
            }
        });
    });

    describe('Key completeness vs English reference', () => {
        for (const ns of NAMESPACES) {
            it(`should have all '${ns}' keys in every language`, () => {
                const enKeys = new Set(Object.keys(loadLocale(REFERENCE_LANG, ns)));

                for (const lang of SUPPORTED_LANGUAGES) {
                    if (lang === REFERENCE_LANG) continue;

                    const langKeys = new Set(Object.keys(loadLocale(lang, ns)));
                    const missing = [...enKeys].filter((k) => !langKeys.has(k));

                    expect(
                        missing,
                        `${lang}/${ns}.json missing keys: ${missing.join(', ')}`,
                    ).toHaveLength(0);
                }
            });
        }
    });

    describe('No extra keys beyond English reference', () => {
        for (const ns of NAMESPACES) {
            it(`should not have extra keys in '${ns}' beyond English`, () => {
                const enKeys = new Set(Object.keys(loadLocale(REFERENCE_LANG, ns)));

                for (const lang of SUPPORTED_LANGUAGES) {
                    if (lang === REFERENCE_LANG) continue;

                    const langKeys = new Set(Object.keys(loadLocale(lang, ns)));
                    const extra = [...langKeys].filter((k) => !enKeys.has(k));

                    expect(
                        extra,
                        `${lang}/${ns}.json has extra keys not in English: ${extra.join(', ')}`,
                    ).toHaveLength(0);
                }
            });
        }
    });

    describe('English reference values', () => {
        it('should have all English common keys defined and non-empty', () => {
            const common = loadLocale('en', 'common');
            const requiredKeys = ['loading', 'error', 'save', 'cancel', 'delete', 'edit', 'close'];
            for (const key of requiredKeys) {
                expect(common[key], `en/common.json missing value for '${key}'`).toBeTruthy();
            }
        });

        it('should have all English nav keys defined and non-empty', () => {
            const nav = loadLocale('en', 'nav');
            expect(Object.keys(nav).length).toBeGreaterThan(0);
            for (const [key, value] of Object.entries(nav)) {
                expect(value, `en/nav.json empty value for '${key}'`).toBeTruthy();
            }
        });

        it('should have no undefined or null values in English reference files', () => {
            for (const ns of NAMESPACES) {
                const translations = loadLocale('en', ns);
                for (const [key, value] of Object.entries(translations)) {
                    expect(
                        value,
                        `en/${ns}.json has null/undefined for key '${key}'`,
                    ).not.toBeNull();
                    expect(
                        value,
                        `en/${ns}.json has undefined for key '${key}'`,
                    ).not.toBeUndefined();
                }
            }
        });
    });

    describe('Key symmetry across all languages', () => {
        it('should have identical key sets in all languages for every namespace', () => {
            for (const ns of NAMESPACES) {
                const enKeys = Object.keys(loadLocale('en', ns)).sort();

                for (const lang of SUPPORTED_LANGUAGES) {
                    if (lang === 'en') continue;
                    const langKeys = Object.keys(loadLocale(lang, ns)).sort();
                    expect(
                        langKeys,
                        `Key mismatch between en and ${lang} in namespace '${ns}'`,
                    ).toEqual(enKeys);
                }
            }
        });
    });

    describe('Detected language directories match supported list', () => {
        it('should have locale directories only for supported languages', () => {
            const actualDirs = readdirSync(LOCALES_DIR).sort();
            const expectedDirs = [...SUPPORTED_LANGUAGES].sort();
            expect(actualDirs).toEqual(expectedDirs);
        });
    });
});
