import { ArrowLeft, Loader2, Trash2, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGroupDetail } from '../hooks/useGroupDetail';
import { PersonaBrowser } from '../components/PersonaBrowser';
import { CreateEditPersonaModal } from '../components/CreateEditPersonaModal';
import { usePersonas } from '../hooks/usePersonas';
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
import { apiFetch, useApiQuery } from '../hooks/useApi';

interface DriveFolder {
    id: string;
    name: string;
}

function RagFolderPanel({ groupFolder, currentRagFolderIds }: {
    groupFolder: string;
    currentRagFolderIds: string[];
}) {
    const { data: folders, isLoading, error } = useApiQuery<DriveFolder[]>(
        '/api/plugins/drive-knowledge-rag/folders',
    );
    const [selected, setSelected] = useState<Set<string>>(new Set(currentRagFolderIds));
    const [saving, setSaving] = useState(false);

    const toggle = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await apiFetch(`/api/groups/${groupFolder}`, {
                method: 'PUT',
                body: JSON.stringify({ ragFolderIds: Array.from(selected) }),
            });
            showToast('RAG folders saved', 'success');
        } catch {
            showToast('Failed to save RAG folders');
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return <div className="text-sm text-slate-500">Loading folders...</div>;
    }

    // Distinguish error states: 401 = not authenticated, 404 = plugin not loaded
    if (error) {
        const msg = error.message || '';
        if (msg.includes('Unauthorized') || msg.includes('401')) {
            return (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="text-sm text-yellow-300 font-medium mb-1">Google account not connected</div>
                    <div className="text-xs text-slate-400">
                        Connect your Google account in the <span className="text-blue-400">Settings</span> page (Google Auth plugin) to browse Drive folders.
                    </div>
                </div>
            );
        }
        if (msg.includes('Not Found') || msg.includes('404')) {
            return (
                <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                    <div className="text-sm text-slate-400">Drive Knowledge RAG plugin is not installed or not loaded.</div>
                </div>
            );
        }
        return (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="text-sm text-red-400">Failed to load Drive folders: {msg}</div>
            </div>
        );
    }

    const folderList = folders ?? [];

    if (folderList.length === 0) {
        return (
            <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                <div className="text-sm text-slate-400">No folders found in Drive root.</div>
                <div className="text-xs text-slate-500 mt-1">
                    Make sure your Google Drive has folders, or check that the Google Auth plugin is properly configured.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {folderList.map(folder => {
                    const checked = selected.has(folder.id);
                    return (
                        <label
                            key={folder.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                checked
                                    ? 'bg-blue-500/10 border-blue-500/30'
                                    : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(folder.id)}
                                className="w-4 h-4 accent-blue-500"
                            />
                            <FolderOpen size={16} className={checked ? 'text-blue-400' : 'text-slate-500'} />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-200 truncate">{folder.name}</div>
                            </div>
                        </label>
                    );
                })}
            </div>
            <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save RAG Folders
            </button>
        </div>
    );
}

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
    const { data: allPersonas } = usePersonas();
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [editingTask, setEditingTask] = useState<any>(null);
    const [saving, setSaving] = useState(false);
    const [unregistering, setUnregistering] = useState(false);
    const [showCreatePersona, setShowCreatePersona] = useState(false);
    const [editingPersona, setEditingPersona] = useState<{ key: string; persona: any } | null>(null);
    const [personaRefreshKey, setPersonaRefreshKey] = useState(0);

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

    const handleUnregister = async () => {
        if (!confirm(t('unregisterConfirm'))) return;
        setUnregistering(true);
        try {
            await apiFetch(`/api/groups/${groupFolder}`, { method: 'DELETE' });
            showToast(t('unregisterSuccess'), 'success');
            onBack();
        } catch (err) {
            showToast(err instanceof Error ? err.message : t('failedToUnregister'));
        } finally {
            setUnregistering(false);
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
            <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('settings')}</h3>

                {/* Persona Browser - full width */}
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
                    <div className="text-sm font-medium text-slate-200 mb-3">{t('persona', 'Persona')}</div>
                    <PersonaBrowser
                        selectedKey={group.persona}
                        onSelect={persona => handleSettingChange({ persona })}
                        onCreateNew={() => setShowCreatePersona(true)}
                        onEdit={(key, persona) => setEditingPersona({ key, persona })}
                        disabled={saving}
                        refreshKey={personaRefreshKey}
                    />
                </div>

                {/* Toggles + Model + Path in grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
                    <ModelSelector
                        value={group.geminiModel || 'auto'}
                        onChange={model => handleSettingChange({ geminiModel: model })}
                        disabled={saving}
                    />
                    <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
                        <label className="block text-sm font-medium text-slate-200 mb-2">{t('preferredPath')}</label>
                        <select
                            value={group.preferredPath || 'fast'}
                            onChange={e => handleSettingChange({ preferredPath: e.target.value })}
                            disabled={saving}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        >
                            <option value="fast">Fast Path (API, {t('paid')})</option>
                            <option value="container">Container ({t('free')})</option>
                        </select>
                        <p className="mt-1.5 text-xs text-slate-500">{t('preferredPathDesc')}</p>
                    </div>
                </div>
            </div>

            {/* Skills */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('skills')}</h3>
                <SkillsPanel groupFolder={groupFolder} />
            </div>

            {/* Drive Knowledge (RAG) */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Drive Knowledge (RAG)</h3>
                <RagFolderPanel
                    groupFolder={groupFolder}
                    currentRagFolderIds={(group as any).ragFolderIds ?? []}
                />
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

            {/* Danger Zone */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('dangerZone')}</h3>
                <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-slate-200">{t('unregister')}</div>
                        <div className="text-xs text-slate-400">{t('unregisterDesc')}</div>
                    </div>
                    <button
                        onClick={handleUnregister}
                        disabled={unregistering}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        {unregistering ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        {t('unregister')}
                    </button>
                </div>
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

            {showCreatePersona && (
                <CreateEditPersonaModal
                    templates={allPersonas ?? undefined}
                    onClose={() => setShowCreatePersona(false)}
                    onSaved={() => { setShowCreatePersona(false); setPersonaRefreshKey(k => k + 1); }}
                />
            )}

            {editingPersona && (
                <CreateEditPersonaModal
                    editKey={editingPersona.key}
                    editPersona={editingPersona.persona}
                    templates={allPersonas ?? undefined}
                    onClose={() => setEditingPersona(null)}
                    onSaved={() => { setEditingPersona(null); setPersonaRefreshKey(k => k + 1); }}
                />
            )}
        </div>
    );
}
