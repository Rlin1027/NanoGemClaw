import { describe, it, expect, beforeEach } from 'vitest';
import {
    type Language,
    setLanguage,
    getLanguage,
    t,
    getTranslation,
    availableLanguages,
} from '../i18n.js';

describe('i18n', () => {
    beforeEach(() => {
        // Reset to default language before each test
        setLanguage('zh-TW');
    });

    describe('Language Management', () => {
        it('should have zh-TW as default language', () => {
            expect(getLanguage()).toBe('zh-TW');
        });

        it('should switch language when setLanguage is called', () => {
            setLanguage('en');
            expect(getLanguage()).toBe('en');

            setLanguage('zh-TW');
            expect(getLanguage()).toBe('zh-TW');
        });

        it('should include zh-TW and en in availableLanguages', () => {
            expect(availableLanguages).toContain('zh-TW');
            expect(availableLanguages).toContain('en');
            expect(availableLanguages).toHaveLength(2);
        });
    });

    describe('Translation Retrieval', () => {
        it('should return current language translations via t()', () => {
            const translations = t();
            expect(translations).toBeDefined();
            expect(typeof translations.rateLimited).toBe('string');
        });

        it('should return zh-TW translations when language is zh-TW', () => {
            setLanguage('zh-TW');
            const translations = t();
            expect(translations.rateLimited).toBe('⏳ 請求過於頻繁，請稍後再試。');
            expect(translations.noErrors).toBe('✅ **無錯誤**\n\n所有群組運作正常。');
        });

        it('should return en translations when language is en', () => {
            setLanguage('en');
            const translations = t();
            expect(translations.rateLimited).toBe('⏳ Too many requests, please try again later.');
            expect(translations.noErrors).toBe('✅ **No Errors**\n\nAll groups running smoothly.');
        });

        it('should return correct translations after language switch', () => {
            setLanguage('zh-TW');
            expect(t().confirmed).toBe('✅ 已確認');

            setLanguage('en');
            expect(t().confirmed).toBe('✅ Confirmed');

            setLanguage('zh-TW');
            expect(t().confirmed).toBe('✅ 已確認');
        });

        it('should return specified language translations via getTranslation()', () => {
            const zhTranslations = getTranslation('zh-TW');
            const enTranslations = getTranslation('en');

            expect(zhTranslations.rateLimited).toBe('⏳ 請求過於頻繁，請稍後再試。');
            expect(enTranslations.rateLimited).toBe('⏳ Too many requests, please try again later.');
        });

        it('should return translations independent of current language', () => {
            setLanguage('en');
            const zhTranslations = getTranslation('zh-TW');
            expect(zhTranslations.rateLimited).toBe('⏳ 請求過於頻繁，請稍後再試。');
        });
    });

    describe('retryIn Function', () => {
        it('should format retry message correctly in zh-TW', () => {
            setLanguage('zh-TW');
            expect(t().retryIn(5)).toBe('(5 分鐘後重試)');
            expect(t().retryIn(10)).toBe('(10 分鐘後重試)');
            expect(t().retryIn(1)).toBe('(1 分鐘後重試)');
        });

        it('should format retry message correctly in en', () => {
            setLanguage('en');
            expect(t().retryIn(5)).toBe('(Retry in 5 minutes)');
            expect(t().retryIn(10)).toBe('(Retry in 10 minutes)');
            expect(t().retryIn(1)).toBe('(Retry in 1 minutes)');
        });

        it('should handle edge case values', () => {
            setLanguage('zh-TW');
            expect(t().retryIn(0)).toBe('(0 分鐘後重試)');
            expect(t().retryIn(60)).toBe('(60 分鐘後重試)');
        });
    });

    describe('Translation Completeness', () => {
        it('should have all translation keys in both languages', () => {
            const zhKeys = Object.keys(getTranslation('zh-TW')).sort();
            const enKeys = Object.keys(getTranslation('en')).sort();

            expect(zhKeys).toEqual(enKeys);
        });

        it('should have all string translations defined', () => {
            const languages: Language[] = ['zh-TW', 'en'];

            languages.forEach((lang) => {
                const translations = getTranslation(lang);

                // System messages
                expect(translations.rateLimited).toBeTruthy();
                expect(translations.noErrors).toBeTruthy();
                expect(translations.noActiveErrors).toBeTruthy();
                expect(translations.groupsWithErrors).toBeTruthy();
                expect(translations.adminCommandsTitle).toBeTruthy();
                expect(translations.adminOnlyNote).toBeTruthy();

                // Admin commands
                expect(translations.statsTitle).toBeTruthy();
                expect(translations.registeredGroups).toBeTruthy();
                expect(translations.uptime).toBeTruthy();
                expect(translations.memory).toBeTruthy();
                expect(translations.usageAnalytics).toBeTruthy();
                expect(translations.totalRequests).toBeTruthy();
                expect(translations.avgResponseTime).toBeTruthy();
                expect(translations.totalTokens).toBeTruthy();

                // Feedback
                expect(translations.confirmed).toBeTruthy();
                expect(translations.cancelled).toBeTruthy();
                expect(translations.retrying).toBeTruthy();
                expect(translations.thanksFeedback).toBeTruthy();
                expect(translations.willImprove).toBeTruthy();

                // UI Phase 1
                expect(translations.processing).toBeTruthy();
                expect(translations.downloadingMedia).toBeTruthy();
                expect(translations.transcribing).toBeTruthy();
                expect(translations.thinking).toBeTruthy();
                expect(translations.retry).toBeTruthy();
                expect(translations.feedback).toBeTruthy();
                expect(translations.errorOccurred).toBeTruthy();
            });
        });

        it('should have retryIn as a function in all languages', () => {
            const languages: Language[] = ['zh-TW', 'en'];

            languages.forEach((lang) => {
                const translations = getTranslation(lang);
                expect(typeof translations.retryIn).toBe('function');
            });
        });
    });

    describe('Type Safety', () => {
        it('should enforce Language type constraints', () => {
            const validLanguages: Language[] = ['zh-TW', 'en'];

            validLanguages.forEach((lang) => {
                setLanguage(lang);
                expect(getLanguage()).toBe(lang);
            });
        });

        it('should return consistent translation object structure', () => {
            const zhTranslations = getTranslation('zh-TW');
            const enTranslations = getTranslation('en');

            const zhProps = Object.getOwnPropertyNames(zhTranslations).sort();
            const enProps = Object.getOwnPropertyNames(enTranslations).sort();

            expect(zhProps).toEqual(enProps);
        });
    });
});
