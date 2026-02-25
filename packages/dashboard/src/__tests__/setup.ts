import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Build English translation lookup before mock hoisting using vi.hoisted().
const { resolveT } = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');

    // Absolute path to en locale dir — robust against cwd differences
    const enDir = path.resolve(
        '/Users/redlin/Desktop/nanoGemClaw/packages/dashboard/src/i18n/locales/en',
    );

    const en: Record<string, Record<string, string>> = {};

    if (fs.existsSync(enDir)) {
        for (const f of fs.readdirSync(enDir)) {
            if (typeof f === 'string' && f.endsWith('.json')) {
                en[f.replace('.json', '')] = JSON.parse(
                    fs.readFileSync(path.join(enDir, f), 'utf-8'),
                );
            }
        }
    }

    function resolveT(ns: string, key: string): string {
        if (en[ns]?.[key] !== undefined) return en[ns][key];
        for (const d of Object.values(en)) {
            if (d[key] !== undefined) return d[key];
        }
        return key;
    }

    return { resolveT };
});

// Mock react-i18next globally. t() resolves keys to real English translations
// so tests can assert on "Enter Access Code" instead of "accessCodePlaceholder".
vi.mock('react-i18next', () => ({
    useTranslation: (ns: string = 'common') => ({
        t: (key: string) => resolveT(ns, key),
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

afterEach(() => {
    cleanup();
});

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
        get length() {
            return Object.keys(store).length;
        },
        key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock window.location
Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:5173', href: 'http://localhost:5173', pathname: '/' },
    writable: true,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});
