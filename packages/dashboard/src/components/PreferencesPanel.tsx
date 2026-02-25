import { useState, useEffect } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, apiFetch } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';

interface Preferences {
    language?: string;
    nickname?: string;
    response_style?: string;
    interests?: string;
    timezone?: string;
    custom_instructions?: string;
}

const STYLE_OPTIONS = ['formal', 'casual', 'technical', 'friendly'] as const;

export function PreferencesPanel({ groupFolder }: { groupFolder: string }) {
    const { t } = useTranslation('common');
    const { data: prefs, isLoading } = useApiQuery<Preferences>(`/api/groups/${groupFolder}/preferences`);
    const [localPrefs, setLocalPrefs] = useState<Preferences>({});
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => {
        if (prefs) setLocalPrefs(prefs);
    }, [prefs]);

    const handleSave = async (key: keyof Preferences) => {
        setSaving(key);
        try {
            await apiFetch(`/api/groups/${groupFolder}/preferences`, {
                method: 'PUT',
                body: JSON.stringify({ key, value: localPrefs[key] || '' }),
            });
            showToast(t('preferenceSaved'), 'success');
        } catch {
            showToast(t('failedToSavePreference'));
        } finally {
            setSaving(null);
        }
    };

    const PREF_FIELDS: { key: keyof Preferences; label: string; type: 'text' | 'select' | 'textarea'; placeholder: string }[] = [
        { key: 'language', label: 'Language', type: 'text', placeholder: 'e.g. zh-TW, en' },
        { key: 'nickname', label: 'Nickname', type: 'text', placeholder: 'How the bot calls this group' },
        { key: 'response_style', label: 'Response Style', type: 'select', placeholder: '' },
        { key: 'interests', label: 'Interests', type: 'textarea', placeholder: 'Topics this group is interested in' },
        { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'e.g. Asia/Taipei' },
        { key: 'custom_instructions', label: 'Custom Instructions', type: 'textarea', placeholder: 'Additional instructions for the bot' },
    ];

    if (isLoading) {
        return <div className="text-slate-500 text-sm">{t('loadingPreferences')}</div>;
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PREF_FIELDS.map(field => {
                const value = localPrefs[field.key] || '';
                const changed = value !== (prefs?.[field.key] || '');

                return (
                    <div key={field.key} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-slate-400">{field.label}</label>
                            {changed && (
                                <button
                                    onClick={() => handleSave(field.key)}
                                    disabled={saving === field.key}
                                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                                >
                                    {saving === field.key ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                                    {t('save')}
                                </button>
                            )}
                        </div>
                        {field.type === 'select' ? (
                            <select
                                value={value}
                                onChange={e => {
                                    setLocalPrefs(p => ({ ...p, [field.key]: e.target.value }));
                                }}
                                onBlur={() => { if (changed) handleSave(field.key); }}
                                className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                            >
                                <option value="">{t('notSet')}</option>
                                {STYLE_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        ) : field.type === 'textarea' ? (
                            <textarea
                                value={value}
                                onChange={e => setLocalPrefs(p => ({ ...p, [field.key]: e.target.value }))}
                                rows={2}
                                className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 resize-none focus:outline-none focus:border-blue-500"
                                placeholder={field.placeholder}
                            />
                        ) : (
                            <input
                                value={value}
                                onChange={e => setLocalPrefs(p => ({ ...p, [field.key]: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                                placeholder={field.placeholder}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
