import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Brain, Save, RotateCcw } from 'lucide-react';
import { useApiQuery } from '../hooks/useApi';
import { usePrompt } from '../hooks/useMemory';
import { useLocale } from '../hooks/useLocale';
import { GroupData } from '../hooks/useSocket';

interface MemorySummary {
    group_folder: string;
    summary: string;
    messages_archived: number;
    chars_archived: number;
    created_at: string;
    updated_at: string;
}

export function MemoryPage({ groups }: { groups: GroupData[] }) {
    const { t } = useTranslation('memory');
    const locale = useLocale();
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<'prompt' | 'memory'>('prompt');
    const [selectedGroup, setSelectedGroup] = useState<string>(searchParams.get('group') || '');

    // Set default group
    useEffect(() => {
        if (!selectedGroup && groups.length > 0) {
            setSelectedGroup(groups[0].id);
        }
    }, [groups, selectedGroup]);

    const prompt = usePrompt(selectedGroup || null);
    const { data: memorySummary, isLoading: memoryLoading } = useApiQuery<MemorySummary>(
        selectedGroup ? `/api/memory/${selectedGroup}` : '/api/health'
    );

    // Load prompt when group changes
    useEffect(() => {
        if (selectedGroup) {
            prompt.load();
        }
    }, [selectedGroup]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keyboard shortcut: Cmd+S / Ctrl+S to save
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                if (prompt.hasChanges && !prompt.saving) {
                    prompt.save();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [prompt.hasChanges, prompt.saving, prompt.save]);

    // Warn on navigate away with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (prompt.hasChanges) {
                e.preventDefault();
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [prompt.hasChanges]);

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)]">
            {/* Header: Group selector + Tabs */}
            <div className="flex items-center gap-4 mb-4">
                <select
                    value={selectedGroup}
                    onChange={e => setSelectedGroup(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                    <option value="">{t('selectGroup')}</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>

                <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-0.5">
                    <button
                        onClick={() => setActiveTab('prompt')}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'prompt' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <FileText size={14} /> {t('systemPrompt')}
                    </button>
                    <button
                        onClick={() => setActiveTab('memory')}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'memory' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Brain size={14} /> {t('title')}
                    </button>
                </div>

                {activeTab === 'prompt' && prompt.hasChanges && (
                    <div className="flex items-center gap-2 ml-auto">
                        <button
                            onClick={prompt.revert}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors"
                        >
                            <RotateCcw size={14} /> {t('cancelEdit')}
                        </button>
                        <button
                            onClick={prompt.save}
                            disabled={prompt.saving}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        >
                            <Save size={14} /> {prompt.saving ? t('saving') : t('saveMemory')}
                        </button>
                    </div>
                )}
            </div>

            {prompt.error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                    {prompt.error}
                </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'prompt' ? (
                    <div className="h-full flex flex-col">
                        {prompt.loading ? (
                            <div className="flex items-center justify-center h-full text-slate-500">{t('loadingMemory')}</div>
                        ) : (
                            <textarea
                                value={prompt.content}
                                onChange={e => prompt.setContent(e.target.value)}
                                placeholder={selectedGroup ? t('promptPlaceholder') : t('selectGroupPrompt')}
                                disabled={!selectedGroup}
                                className="flex-1 w-full bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-slate-200 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-slate-600"
                                spellCheck={false}
                            />
                        )}
                        {prompt.hasChanges && (
                            <div className="mt-2 text-xs text-yellow-400">
                                {t('unsavedChanges')}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto">
                        {!selectedGroup ? (
                            <div className="flex items-center justify-center h-full text-slate-500">{t('selectGroupPrompt')}</div>
                        ) : memoryLoading ? (
                            <div className="flex items-center justify-center h-full text-slate-500">{t('loadingMemory')}</div>
                        ) : memorySummary ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                                        <div className="text-xs text-slate-500 mb-1">{t('messagesArchived')}</div>
                                        <div className="text-slate-200 font-mono font-bold">{memorySummary.messages_archived}</div>
                                    </div>
                                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                                        <div className="text-xs text-slate-500 mb-1">{t('charsArchived')}</div>
                                        <div className="text-slate-200 font-mono font-bold">{memorySummary.chars_archived.toLocaleString(locale)}</div>
                                    </div>
                                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                                        <div className="text-xs text-slate-500 mb-1">{t('lastUpdated')}</div>
                                        <div className="text-slate-200 font-mono text-sm">{new Date(memorySummary.updated_at).toLocaleString(locale)}</div>
                                    </div>
                                </div>
                                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-slate-300 mb-2">{t('summary')}</h3>
                                    <p className="text-slate-400 text-sm whitespace-pre-wrap">{memorySummary.summary}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-500">
                                {t('noMemory')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
