import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGroupDetail } from '../hooks/useGroupDetail';
import { PersonaSelector } from '../components/PersonaSelector';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { StatsCards } from '../components/StatsCards';
import { TaskList } from '../components/TaskList';
import { TaskFormModal } from '../components/TaskFormModal';
import { showToast } from '../hooks/useToast';
import { useAvailableSkills, useGroupSkills, useToggleSkill } from '../hooks/useSkills';
import { PreferencesPanel } from '../components/PreferencesPanel';
import { ExportButton } from '../components/ExportButton';
import { useLocale } from '../hooks/useLocale';
import { useAvailableModels } from '../hooks/useAvailableModels';

function ModelSelector({ value, onChange, disabled }: {
    value: string;
    onChange: (model: string) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation('groups');
    const { data, isLoading } = useAvailableModels();

    const models = data?.models ?? [];
    const defaultModel = data?.defaultModel ?? '';

    return (
        <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
            <label className="block text-sm font-medium text-slate-200 mb-2">{t('aiModel')}</label>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                disabled={disabled || isLoading}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
                <option value="auto">
                    {t('modelAuto')}{defaultModel ? ` (${defaultModel})` : ''}
                </option>
                {models.map(model => (
                    <option key={model.id} value={model.id}>
                        {model.displayName}
                    </option>
                ))}
            </select>
        </div>
    );
}

function SkillsPanel({ groupFolder }: { groupFolder: string }) {
    const { t } = useTranslation('groups');
    const { data: allSkills, isLoading: loadingAll } = useAvailableSkills();
    const { data: enabledSkills, isLoading: loadingEnabled, refetch } = useGroupSkills(groupFolder);
    const { mutate: toggleSkill } = useToggleSkill(groupFolder);

    if (loadingAll || loadingEnabled) {
        return <div className="text-slate-500 text-sm">{t('loadingSkills')}</div>;
    }

    if (!allSkills || allSkills.length === 0) {
        return <div className="text-slate-500 text-sm">{t('noSkills')}</div>;
    }

    const enabledSet = new Set(enabledSkills || []);

    const handleToggle = async (skillId: string, currentlyEnabled: boolean) => {
        try {
            await toggleSkill({ skillId, enabled: !currentlyEnabled });
            refetch();
            showToast(t(!currentlyEnabled ? 'skillEnabled' : 'skillDisabled'), 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : t('failedToToggleSkill'));
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {allSkills.map(skill => {
                const isEnabled = enabledSet.has(skill.id);
                return (
                    <div
                        key={skill.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            isEnabled
                                ? 'bg-blue-500/10 border-blue-500/30'
                                : 'bg-slate-800/50 border-slate-700/50'
                        }`}
                    >
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-white truncate">{skill.name}</div>
                            <div className="text-xs text-slate-400 truncate">{skill.description}</div>
                        </div>
                        <button
                            onClick={() => handleToggle(skill.id, isEnabled)}
                            className={`ml-3 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                isEnabled
                                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                        >
                            {isEnabled ? t('enabled') : t('disabled')}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

interface GroupDetailPageProps {
    groupFolder: string;
    onBack: () => void;
}

export function GroupDetailPage({ groupFolder, onBack }: GroupDetailPageProps) {
    const { t } = useTranslation('groups');
    const locale = useLocale();
    const { group, loading, error, refetch, updateSettings } = useGroupDetail(groupFolder);
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [editingTask, setEditingTask] = useState<any>(null);
    const [saving, setSaving] = useState(false);

    const handleSettingChange = async (updates: Record<string, any>) => {
        setSaving(true);
        try {
            await updateSettings(updates);
            showToast(t('settingsUpdated'), 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : t('failedToUpdateSettings'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500">
                <Loader2 className="animate-spin mr-2" /> {t('loading')}
            </div>
        );
    }

    if (error || !group) {
        return (
            <div className="text-center py-20">
                <p className="text-red-400 mb-4">{error || t('groupNotFound')}</p>
                <button onClick={onBack} className="text-blue-400 hover:text-blue-300">
                    {t('backToOverview')}
                </button>
            </div>
        );
    }

    const avgResponseTime = group.usage.total_requests > 0
        ? (group.usage.avg_duration_ms / 1000).toFixed(1) + 's'
        : 'N/A';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-xl font-bold text-white">{group.name}</h2>
                    <span className="text-sm text-slate-500">📁 {group.folder}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 ${
                    group.status === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'
                }`}>
                    {group.status}
                </span>
                <div className="ml-auto">
                    <ExportButton groupFolder={groupFolder} />
                </div>
            </div>

            {/* Stats */}
            <StatsCards stats={[
                { label: t('totalRequests'), value: group.usage.total_requests },
                { label: t('avgResponse'), value: avgResponseTime },
                { label: t('totalTokens'), value: (group.usage.total_prompt_tokens + group.usage.total_response_tokens).toLocaleString(locale) },
                { label: t('messages'), value: group.messageCount },
            ]} />

            {/* Settings */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('settings')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <PersonaSelector
                        value={group.persona}
                        onChange={persona => handleSettingChange({ persona })}
                        disabled={saving}
                    />
                    <ToggleSwitch
                        label={t('triggerMode')}
                        description={t('triggerModeDesc')}
                        enabled={group.requireTrigger !== false}
                        onChange={val => handleSettingChange({ requireTrigger: val })}
                        disabled={saving}
                    />
                    <ToggleSwitch
                        label={t('webSearch')}
                        description={t('webSearchDesc')}
                        enabled={group.enableWebSearch !== false}
                        onChange={val => handleSettingChange({ enableWebSearch: val })}
                        disabled={saving}
                    />
                    {/* Model Selector */}
                    <ModelSelector
                        value={(group as any).geminiModel || 'auto'}
                        onChange={model => handleSettingChange({ geminiModel: model })}
                        disabled={saving}
                    />
                </div>
            </div>

            {/* Skills */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('skills')}</h3>
                <SkillsPanel groupFolder={groupFolder} />
            </div>

            {/* Preferences */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('preferences')}</h3>
                <PreferencesPanel groupFolder={groupFolder} />
            </div>

            {/* Scheduled Tasks */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('scheduledTasks')}</h3>
                    <button
                        onClick={() => setShowTaskForm(true)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        + {t('newTask')}
                    </button>
                </div>
                <TaskList
                    tasks={group.tasks}
                    onRefresh={refetch}
                    onEdit={task => setEditingTask(task)}
                    showGroup={false}
                />
            </div>

            {/* Errors */}
            {group.errorState && group.errorState.consecutiveFailures > 0 && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <h3 className="text-sm font-medium text-red-400 mb-2">{t('recentErrors')}</h3>
                    <div className="text-sm text-red-300">
                        {t('consecutiveFailures', { count: group.errorState.consecutiveFailures })}
                    </div>
                    {group.errorState.lastError && (
                        <div className="text-xs text-red-400/70 mt-1 font-mono truncate">
                            {group.errorState.lastError}
                        </div>
                    )}
                </div>
            )}

            {showTaskForm && (
                <TaskFormModal
                    groups={[{ id: group.folder, name: group.name }]}
                    defaultGroup={group.folder}
                    onClose={() => setShowTaskForm(false)}
                    onCreated={refetch}
                />
            )}

            {editingTask && (
                <TaskFormModal
                    groups={[{ id: group.folder, name: group.name }]}
                    editTask={editingTask}
                    onClose={() => setEditingTask(null)}
                    onCreated={() => { setEditingTask(null); refetch(); }}
                />
            )}
        </div>
    );
}
