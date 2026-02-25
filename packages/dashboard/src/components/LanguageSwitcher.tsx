import { useState, useRef, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface Language {
    code: string;
    label: string;
    nativeLabel: string;
}

const LANGUAGES: Language[] = [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'zh-TW', label: 'Traditional Chinese', nativeLabel: '繁體中文' },
    { code: 'zh-CN', label: 'Simplified Chinese', nativeLabel: '简体中文' },
    { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
    { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
    { code: 'ko', label: 'Korean', nativeLabel: '한국어' },
    { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
    { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
];

export function LanguageSwitcher() {
    const { i18n } = useTranslation();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const currentLang = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0];

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (code: string) => {
        i18n.changeLanguage(code);
        localStorage.setItem('nanogemclaw_language', code);
        setOpen(false);
    };

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(prev => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-xs font-medium"
                title={currentLang.nativeLabel}
            >
                <Globe size={14} />
                <span className="hidden lg:inline">{currentLang.nativeLabel}</span>
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-xl shadow-black/40 z-50 overflow-hidden">
                    {LANGUAGES.map(lang => (
                        <button
                            key={lang.code}
                            onClick={() => handleSelect(lang.code)}
                            className={cn(
                                'w-full flex items-center justify-between px-3 py-2 text-sm transition-colors text-left',
                                lang.code === i18n.language
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                            )}
                        >
                            <span>{lang.nativeLabel}</span>
                            {lang.code === i18n.language && (
                                <Check size={14} className="text-blue-400 flex-shrink-0" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
