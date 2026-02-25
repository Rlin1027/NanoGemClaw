import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../hooks/useApi';
import { cn } from '@/lib/utils';

interface TaskData {
    id: string;
    group_folder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    context_mode: string;
}

interface TaskFormModalProps {
    groups: { id: string; name: string }[];
    defaultGroup?: string;
    editTask?: TaskData;
    onClose: () => void;
    onCreated: () => void;
}

export function TaskFormModal({ groups, defaultGroup, editTask, onClose, onCreated }: TaskFormModalProps) {
    const { t } = useTranslation('tasks');
    const isEdit = !!editTask;

    const [form, setForm] = useState({
        group_folder: editTask?.group_folder || defaultGroup || groups[0]?.id || '',
        prompt: editTask?.prompt || '',
        schedule_type: (editTask?.schedule_type || 'cron') as 'cron' | 'interval' | 'once',
        schedule_value: editTask?.schedule_value || '',
        context_mode: (editTask?.context_mode || 'isolated') as 'group' | 'isolated',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            if (isEdit) {
                await apiFetch(`/api/tasks/${editTask.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        prompt: form.prompt,
                        schedule_type: form.schedule_type,
                        schedule_value: form.schedule_value,
                    }),
                });
            } else {
                await apiFetch('/api/tasks', {
                    method: 'POST',
                    body: JSON.stringify(form),
                });
            }
            onCreated();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : (isEdit ? t('failedToUpdateStatus') : t('failedToDelete')));
        } finally {
            setLoading(false);
        }
    };

    const scheduleValueLabel = () => {
        if (form.schedule_type === 'cron') return 'Cron Expression';
        if (form.schedule_type === 'interval') return t('interval') + ' (ms)';
        return 'Run At (ISO)';
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100">
                        {isEdit ? t('editTask') : t('createTask')}
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Group */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('groupFolder')}</label>
                        <select
                            value={form.group_folder}
                            onChange={e => setForm(f => ({ ...f, group_folder: e.target.value }))}
                            disabled={isEdit}
                            className={cn(
                                "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200",
                                isEdit && "opacity-60 cursor-not-allowed"
                            )}
                        >
                            {groups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Prompt */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('prompt')}</label>
                        <textarea
                            value={form.prompt}
                            onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                            rows={3}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none"
                            placeholder="Enter the task prompt..."
                        />
                    </div>

                    {/* Schedule Type */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('scheduleType')}</label>
                        <div className="flex gap-2">
                            {(['cron', 'interval', 'once'] as const).map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, schedule_type: type, schedule_value: '' }))}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                                        form.schedule_type === type
                                            ? "bg-blue-600 text-white"
                                            : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Schedule Value */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">
                            {scheduleValueLabel()}
                        </label>
                        {form.schedule_type === 'cron' && (
                            <div className="flex gap-1.5 mb-2 flex-wrap">
                                {([
                                    ['Every 5 min', '*/5 * * * *'],
                                    ['Every hour', '0 * * * *'],
                                    ['Daily 9am', '0 9 * * *'],
                                    ['Every Monday', '0 9 * * 1'],
                                ] as const).map(([label, value]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setForm(f => ({ ...f, schedule_value: value }))}
                                        className={cn(
                                            "px-2 py-1 rounded text-xs font-medium transition-colors",
                                            form.schedule_value === value
                                                ? "bg-blue-600/30 text-blue-300 border border-blue-500/30"
                                                : "bg-slate-800/80 text-slate-500 hover:text-slate-300 border border-slate-700/50"
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <input
                            value={form.schedule_value}
                            onChange={e => setForm(f => ({ ...f, schedule_value: e.target.value }))}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                            placeholder={
                                form.schedule_type === 'cron' ? '0 9 * * * (min hour day month weekday)' :
                                form.schedule_type === 'interval' ? '3600000' : '2025-12-31T00:00:00Z'
                            }
                        />
                    </div>

                    {/* Context Mode */}
                    {!isEdit && (
                        <div>
                            <label className="text-sm text-slate-400 block mb-1">{t('contextMode')}</label>
                            <div className="flex gap-2">
                                {(['isolated', 'group'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => setForm(f => ({ ...f, context_mode: mode }))}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                                            form.context_mode === mode
                                                ? "bg-blue-600 text-white"
                                                : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                        )}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {error && <div className="text-red-400 text-sm">{error}</div>}

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors">
                            {t('cancel', { ns: 'common' })}
                        </button>
                        <button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                            {loading
                                ? (isEdit ? 'Saving...' : 'Creating...')
                                : (isEdit ? t('save', { ns: 'common' }) : t('createTask'))
                            }
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
