import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// English translations
import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enAuth from './locales/en/auth.json';
import enOverview from './locales/en/overview.json';
import enSettings from './locales/en/settings.json';
import enTasks from './locales/en/tasks.json';
import enKnowledge from './locales/en/knowledge.json';
import enCalendar from './locales/en/calendar.json';
import enAnalytics from './locales/en/analytics.json';
import enLogs from './locales/en/logs.json';
import enMemory from './locales/en/memory.json';
import enGroups from './locales/en/groups.json';

// Traditional Chinese translations
import zhTWCommon from './locales/zh-TW/common.json';
import zhTWNav from './locales/zh-TW/nav.json';
import zhTWAuth from './locales/zh-TW/auth.json';
import zhTWOverview from './locales/zh-TW/overview.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWTasks from './locales/zh-TW/tasks.json';
import zhTWKnowledge from './locales/zh-TW/knowledge.json';
import zhTWCalendar from './locales/zh-TW/calendar.json';
import zhTWAnalytics from './locales/zh-TW/analytics.json';
import zhTWLogs from './locales/zh-TW/logs.json';
import zhTWMemory from './locales/zh-TW/memory.json';
import zhTWGroups from './locales/zh-TW/groups.json';

// Simplified Chinese translations
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNNav from './locales/zh-CN/nav.json';
import zhCNAuth from './locales/zh-CN/auth.json';
import zhCNOverview from './locales/zh-CN/overview.json';
import zhCNSettings from './locales/zh-CN/settings.json';
import zhCNTasks from './locales/zh-CN/tasks.json';
import zhCNKnowledge from './locales/zh-CN/knowledge.json';
import zhCNCalendar from './locales/zh-CN/calendar.json';
import zhCNAnalytics from './locales/zh-CN/analytics.json';
import zhCNLogs from './locales/zh-CN/logs.json';
import zhCNMemory from './locales/zh-CN/memory.json';
import zhCNGroups from './locales/zh-CN/groups.json';

// Spanish translations
import esCommon from './locales/es/common.json';
import esNav from './locales/es/nav.json';
import esAuth from './locales/es/auth.json';
import esOverview from './locales/es/overview.json';
import esSettings from './locales/es/settings.json';
import esTasks from './locales/es/tasks.json';
import esKnowledge from './locales/es/knowledge.json';
import esCalendar from './locales/es/calendar.json';
import esAnalytics from './locales/es/analytics.json';
import esLogs from './locales/es/logs.json';
import esMemory from './locales/es/memory.json';
import esGroups from './locales/es/groups.json';

// Japanese translations
import jaCommon from './locales/ja/common.json';
import jaNav from './locales/ja/nav.json';
import jaAuth from './locales/ja/auth.json';
import jaOverview from './locales/ja/overview.json';
import jaSettings from './locales/ja/settings.json';
import jaTasks from './locales/ja/tasks.json';
import jaKnowledge from './locales/ja/knowledge.json';
import jaCalendar from './locales/ja/calendar.json';
import jaAnalytics from './locales/ja/analytics.json';
import jaLogs from './locales/ja/logs.json';
import jaMemory from './locales/ja/memory.json';
import jaGroups from './locales/ja/groups.json';

// Korean translations
import koCommon from './locales/ko/common.json';
import koNav from './locales/ko/nav.json';
import koAuth from './locales/ko/auth.json';
import koOverview from './locales/ko/overview.json';
import koSettings from './locales/ko/settings.json';
import koTasks from './locales/ko/tasks.json';
import koKnowledge from './locales/ko/knowledge.json';
import koCalendar from './locales/ko/calendar.json';
import koAnalytics from './locales/ko/analytics.json';
import koLogs from './locales/ko/logs.json';
import koMemory from './locales/ko/memory.json';
import koGroups from './locales/ko/groups.json';

// Portuguese translations
import ptCommon from './locales/pt/common.json';
import ptNav from './locales/pt/nav.json';
import ptAuth from './locales/pt/auth.json';
import ptOverview from './locales/pt/overview.json';
import ptSettings from './locales/pt/settings.json';
import ptTasks from './locales/pt/tasks.json';
import ptKnowledge from './locales/pt/knowledge.json';
import ptCalendar from './locales/pt/calendar.json';
import ptAnalytics from './locales/pt/analytics.json';
import ptLogs from './locales/pt/logs.json';
import ptMemory from './locales/pt/memory.json';
import ptGroups from './locales/pt/groups.json';

// Russian translations
import ruCommon from './locales/ru/common.json';
import ruNav from './locales/ru/nav.json';
import ruAuth from './locales/ru/auth.json';
import ruOverview from './locales/ru/overview.json';
import ruSettings from './locales/ru/settings.json';
import ruTasks from './locales/ru/tasks.json';
import ruKnowledge from './locales/ru/knowledge.json';
import ruCalendar from './locales/ru/calendar.json';
import ruAnalytics from './locales/ru/analytics.json';
import ruLogs from './locales/ru/logs.json';
import ruMemory from './locales/ru/memory.json';
import ruGroups from './locales/ru/groups.json';

i18n.use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: {
                common: enCommon,
                nav: enNav,
                auth: enAuth,
                overview: enOverview,
                settings: enSettings,
                tasks: enTasks,
                knowledge: enKnowledge,
                calendar: enCalendar,
                analytics: enAnalytics,
                logs: enLogs,
                memory: enMemory,
                groups: enGroups,
            },
            'zh-TW': {
                common: zhTWCommon,
                nav: zhTWNav,
                auth: zhTWAuth,
                overview: zhTWOverview,
                settings: zhTWSettings,
                tasks: zhTWTasks,
                knowledge: zhTWKnowledge,
                calendar: zhTWCalendar,
                analytics: zhTWAnalytics,
                logs: zhTWLogs,
                memory: zhTWMemory,
                groups: zhTWGroups,
            },
            'zh-CN': {
                common: zhCNCommon,
                nav: zhCNNav,
                auth: zhCNAuth,
                overview: zhCNOverview,
                settings: zhCNSettings,
                tasks: zhCNTasks,
                knowledge: zhCNKnowledge,
                calendar: zhCNCalendar,
                analytics: zhCNAnalytics,
                logs: zhCNLogs,
                memory: zhCNMemory,
                groups: zhCNGroups,
            },
            es: {
                common: esCommon,
                nav: esNav,
                auth: esAuth,
                overview: esOverview,
                settings: esSettings,
                tasks: esTasks,
                knowledge: esKnowledge,
                calendar: esCalendar,
                analytics: esAnalytics,
                logs: esLogs,
                memory: esMemory,
                groups: esGroups,
            },
            ja: {
                common: jaCommon,
                nav: jaNav,
                auth: jaAuth,
                overview: jaOverview,
                settings: jaSettings,
                tasks: jaTasks,
                knowledge: jaKnowledge,
                calendar: jaCalendar,
                analytics: jaAnalytics,
                logs: jaLogs,
                memory: jaMemory,
                groups: jaGroups,
            },
            ko: {
                common: koCommon,
                nav: koNav,
                auth: koAuth,
                overview: koOverview,
                settings: koSettings,
                tasks: koTasks,
                knowledge: koKnowledge,
                calendar: koCalendar,
                analytics: koAnalytics,
                logs: koLogs,
                memory: koMemory,
                groups: koGroups,
            },
            pt: {
                common: ptCommon,
                nav: ptNav,
                auth: ptAuth,
                overview: ptOverview,
                settings: ptSettings,
                tasks: ptTasks,
                knowledge: ptKnowledge,
                calendar: ptCalendar,
                analytics: ptAnalytics,
                logs: ptLogs,
                memory: ptMemory,
                groups: ptGroups,
            },
            ru: {
                common: ruCommon,
                nav: ruNav,
                auth: ruAuth,
                overview: ruOverview,
                settings: ruSettings,
                tasks: ruTasks,
                knowledge: ruKnowledge,
                calendar: ruCalendar,
                analytics: ruAnalytics,
                logs: ruLogs,
                memory: ruMemory,
                groups: ruGroups,
            },
        },
        defaultNS: 'common',
        fallbackLng: 'en',
        detection: {
            order: ['localStorage', 'navigator'],
            lookupLocalStorage: 'nanogemclaw_language',
            caches: ['localStorage'],
        },
        interpolation: {
            escapeValue: false,
        },
    });

export default i18n;
